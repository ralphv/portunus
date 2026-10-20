import { beforeAll, describe, expect, it } from "vitest";

import {
  defaultEngine,
  getEngine,
  headerOf,
  parseEnvelope,
  serializeEnvelope,
  VAULT_FORMAT,
  VAULT_VERSION,
  VAULT_WEBSITE,
} from "./index";
import {
  MalformedEnvelopeError,
  UnsupportedEngineError,
  VaultDecryptError,
  VaultError,
  VaultUnlockError,
} from "./errors";
import { aadBytes, canonicalJson } from "./aad";
import { b64decode, b64encode } from "./base64";
import { generateKeyfile } from "./keyfile";
import type { VaultEnvelope, VaultSecrets } from "./types";

const te = new TextEncoder();

describe("base64", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    expect(b64decode(b64encode(bytes))).toEqual(bytes);
  });

  it("produces url-safe unpadded output", () => {
    const s = b64encode(new Uint8Array([251, 255, 190, 239]));
    expect(s).not.toMatch(/[+/=]/);
  });
});

describe("canonicalJson / aadBytes", () => {
  it("is independent of object key order", () => {
    const a = canonicalJson({ x: 1, y: { b: 2, a: [3, null] } });
    const b = canonicalJson({ y: { a: [3, null], b: 2 }, x: 1 });
    expect(a).toBe(b);
    expect(aadBytes({ b: 2, a: 1 })).toEqual(aadBytes({ a: 1, b: 2 }));
  });
});

describe("parseEnvelope", () => {
  const minimal = JSON.stringify({
    format: VAULT_FORMAT,
    version: VAULT_VERSION,
    engine: "argon2id-xchacha20",
  });

  it("accepts a valid envelope", () => {
    expect(parseEnvelope(minimal).engine).toBe("argon2id-xchacha20");
  });

  it("writes the app website into the serialized envelope", () => {
    const env = parseEnvelope(minimal);
    const out = JSON.parse(serializeEnvelope(env));
    expect(out.website).toBe(VAULT_WEBSITE);
    // a stale or foreign value is overwritten, not trusted
    expect(JSON.parse(serializeEnvelope({ ...env, website: "https://evil.example" })).website).toBe(
      VAULT_WEBSITE,
    );
  });

  it.each([
    ["not json", "not json {"],
    ["a JSON scalar", "42"],
    ["wrong format", JSON.stringify({ format: "other", version: 1, engine: "x" })],
    ["wrong version", JSON.stringify({ format: VAULT_FORMAT, version: 2, engine: "x" })],
    ["missing engine", JSON.stringify({ format: VAULT_FORMAT, version: 1 })],
  ])("rejects %s", (_name, text) => {
    expect(() => parseEnvelope(text)).toThrow(MalformedEnvelopeError);
  });
});

describe("headerOf", () => {
  it("strips nonce and ciphertext, keeps everything else", () => {
    const env = parseEnvelope(
      JSON.stringify({
        format: VAULT_FORMAT,
        version: VAULT_VERSION,
        engine: "e",
        kdf: { mem: 1 },
        wrappedDataKey: "w",
        nonce: "n",
        ciphertext: "c",
      }),
    );
    const header = headerOf(env);
    expect(header).not.toHaveProperty("nonce");
    expect(header).not.toHaveProperty("ciphertext");
    expect(header.wrappedDataKey).toBe("w");
    expect(header.kdf).toEqual({ mem: 1 });
  });
});

describe("registry", () => {
  it("dispatches to the v1 engine by id", () => {
    expect(getEngine("argon2id-xchacha20").id).toBe("argon2id-xchacha20");
  });

  it("rejects unknown engine ids", () => {
    expect(() => getEngine("rot13")).toThrow(UnsupportedEngineError);
  });

  it("defaultEngine is non-deprecated", () => {
    expect(defaultEngine().deprecated).toBeFalsy();
  });
});

describe("engine argon2id-xchacha20", () => {
  const engine = defaultEngine();
  let secrets: VaultSecrets;
  let env: VaultEnvelope;
  let dataKey: Uint8Array;
  const plaintext = te.encode('{"entries":[{"site":"example.com"}]}');

  beforeAll(async () => {
    const { keyfile } = await generateKeyfile();
    secrets = { password: "correct horse battery staple", keyfile: keyfile.key };
    const init = await engine.initNew(secrets);
    dataKey = init.dataKey;
    env = await engine.encrypt(init.header, dataKey, plaintext);
  });

  it("initNew produces a well-formed header", () => {
    expect(env.format).toBe(VAULT_FORMAT);
    expect(env.version).toBe(VAULT_VERSION);
    expect(env.engine).toBe("argon2id-xchacha20");
    const kdf = env.kdf as Record<string, unknown>;
    expect(kdf.algo).toBe("argon2id");
    expect(kdf.time).toBe(2);
    expect(kdf.mem).toBe(19 * 1024);
    expect(kdf.lanes).toBe(1);
    expect(typeof env.wrappedDataKey).toBe("string");
    expect(typeof env.nonce).toBe("string");
    expect(typeof env.ciphertext).toBe("string");
  });

  it("round-trips through serialize → parse → unlock → decrypt", async () => {
    const parsed = parseEnvelope(serializeEnvelope(env));
    const key = await getEngine(parsed.engine).unlock(parsed, secrets);
    expect(await engine.decrypt(parsed, key)).toEqual(plaintext);
  });

  it("re-saves via headerOf without re-wrapping", async () => {
    const env2 = await engine.encrypt(headerOf(env), dataKey, plaintext);
    const key = await engine.unlock(env2, secrets);
    expect(await engine.decrypt(env2, key)).toEqual(plaintext);
    expect(env2.nonce).not.toBe(env.nonce); // fresh nonce per save
  });

  it("rejects a wrong master password", async () => {
    await expect(
      engine.unlock(env, { ...secrets, password: "wrong" }),
    ).rejects.toThrow(VaultUnlockError);
  });

  it("rejects a wrong keyfile", async () => {
    const { keyfile: other } = await generateKeyfile();
    await expect(
      engine.unlock(env, { ...secrets, keyfile: other.key }),
    ).rejects.toThrow(VaultUnlockError);
  });

  it.each([
    ["empty password", { password: "", keyfile: new Uint8Array(32) }],
    ["empty keyfile", { password: "pw", keyfile: new Uint8Array(0) }],
  ])("rejects %s without running the KDF", async (_n, bad) => {
    await expect(engine.initNew(bad)).rejects.toThrow(VaultError);
    await expect(engine.unlock(env, bad)).rejects.toThrow(VaultError);
  });

  it("rejects tampered kdf params (bound via wrap AAD)", async () => {
    const tampered = { ...env, kdf: { ...(env.kdf as object), mem: 1024 } };
    await expect(engine.unlock(tampered, secrets)).rejects.toThrow(
      VaultUnlockError,
    );
  });

  it("rejects out-of-bounds kdf params", async () => {
    const tampered = {
      ...env,
      kdf: { ...(env.kdf as object), mem: 1024 * 1024 * 1024 },
    };
    await expect(engine.unlock(tampered, secrets)).rejects.toThrow(
      MalformedEnvelopeError,
    );
  });

  it("rejects a tampered ciphertext", async () => {
    const ct = env.ciphertext as string;
    const tampered = {
      ...env,
      ciphertext: (ct[0] === "A" ? "B" : "A") + ct.slice(1),
    };
    await expect(engine.decrypt(tampered, dataKey)).rejects.toThrow(
      VaultDecryptError,
    );
  });

  it("rejects a tampered nonce", async () => {
    const n = env.nonce as string;
    const tampered = { ...env, nonce: (n[0] === "A" ? "B" : "A") + n.slice(1) };
    await expect(engine.decrypt(tampered, dataKey)).rejects.toThrow(
      VaultDecryptError,
    );
  });

  it("rejects a swapped wrappedDataKey (bound via vault AAD)", async () => {
    const { keyfile: other } = await generateKeyfile();
    const otherInit = await engine.initNew({
      password: "x",
      keyfile: other.key,
    });
    const franken = { ...env, wrappedDataKey: otherInit.header.wrappedDataKey };
    await expect(engine.decrypt(franken, dataKey)).rejects.toThrow(
      VaultDecryptError,
    );
  });

  it("rejects a tampered engine field", async () => {
    const tampered = { ...env, engine: "argon2id-xchacha20 " };
    await expect(engine.unlock(tampered, secrets)).rejects.toThrow(
      MalformedEnvelopeError,
    );
  });
});
