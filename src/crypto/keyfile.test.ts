import { afterEach, describe, expect, it, vi } from "vitest";

import { InvalidKeyfileError } from "./errors";
import {
  generateKeyfile,
  installKeyfile,
  KEYFILE_FILENAME,
  KEYFILE_FORMAT,
  keyfileFromKey,
  loadInstalledKeyfile,
  parseKeyfile,
  serializeKeyfile,
  uninstallKeyfile,
} from "./keyfile";
import { decodeRecoveryKey, encodeRecoveryKey } from "./recovery";

describe("keyfile", () => {
  it("generates, serializes and parses back", async () => {
    const { keyfile, json } = await generateKeyfile();
    const doc = JSON.parse(json);
    expect(doc.format).toBe(KEYFILE_FORMAT);
    expect(doc.version).toBe(1);
    expect(doc.kid).toMatch(/^[0-9a-f]{16}$/);

    const parsed = await parseKeyfile(json);
    expect(parsed.key).toEqual(keyfile.key);
    expect(parsed.kid).toBe(keyfile.kid);
  });

  it("keyfileFromKey rebuilds a keyfile with the matching kid", async () => {
    const { keyfile } = await generateKeyfile();
    const rebuilt = await keyfileFromKey(keyfile.key);
    expect(rebuilt.key).toEqual(keyfile.key);
    expect(rebuilt.kid).toBe(keyfile.kid);
    await expect(keyfileFromKey(new Uint8Array(8))).rejects.toThrow(
      InvalidKeyfileError,
    );
  });

  it("generates unique keys", async () => {
    const a = await generateKeyfile();
    const b = await generateKeyfile();
    expect(a.keyfile.key).not.toEqual(b.keyfile.key);
    expect(a.keyfile.kid).not.toBe(b.keyfile.kid);
  });

  it("rejects malformed files", async () => {
    await expect(parseKeyfile("not json {")).rejects.toThrow(InvalidKeyfileError);
    await expect(parseKeyfile('{"format":"other","version":1,"key":"AA"}')).rejects.toThrow(InvalidKeyfileError);
    await expect(parseKeyfile('{"format":"portunus-keyfile","version":2,"key":"AA"}')).rejects.toThrow(InvalidKeyfileError);
    await expect(parseKeyfile('{"format":"portunus-keyfile","version":1}')).rejects.toThrow(InvalidKeyfileError);
    await expect(parseKeyfile('{"format":"portunus-keyfile","version":1,"key":"AA"}')).rejects.toThrow(InvalidKeyfileError);
  });

  it("rejects a kid that does not match the key", async () => {
    const { json } = await generateKeyfile();
    const doc = JSON.parse(json);
    doc.kid = "0000000000000000";
    await expect(parseKeyfile(JSON.stringify(doc))).rejects.toThrow(
      InvalidKeyfileError,
    );
  });

  it("computes a kid when the file omits one", async () => {
    const { keyfile, json } = await generateKeyfile();
    const doc = JSON.parse(json);
    delete doc.kid;
    const parsed = await parseKeyfile(JSON.stringify(doc));
    expect(parsed.kid).toBe(keyfile.kid);
  });

  it("serializeKeyfile output parses back", async () => {
    const { keyfile } = await generateKeyfile();
    const parsed = await parseKeyfile(serializeKeyfile(keyfile));
    expect(parsed.key).toEqual(keyfile.key);
  });

  it("uses the documented download filename", () => {
    expect(KEYFILE_FILENAME).toBe("portunus.key");
  });
});

describe("keyfile localStorage install", () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });

  afterEach(() => store.clear());

  it("installs, loads and uninstalls", async () => {
    const { keyfile } = await generateKeyfile();
    installKeyfile(keyfile);
    expect(await loadInstalledKeyfile()).toEqual(keyfile);
    uninstallKeyfile();
    expect(await loadInstalledKeyfile()).toBeNull();
  });

  it("returns null when nothing is installed", async () => {
    expect(await loadInstalledKeyfile()).toBeNull();
  });

  it("rejects a corrupted stored keyfile", async () => {
    store.set("portunus.keyfile", '{"format":"nope"}');
    await expect(loadInstalledKeyfile()).rejects.toThrow(InvalidKeyfileError);
  });
});

describe("recovery encoding", () => {
  it("encodes 32 bytes as 13 dash-separated groups of 4", async () => {
    const { keyfile } = await generateKeyfile();
    const code = encodeRecoveryKey(keyfile.key);
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("round-trips", async () => {
    const { keyfile } = await generateKeyfile();
    expect(decodeRecoveryKey(encodeRecoveryKey(keyfile.key))).toEqual(
      keyfile.key,
    );
  });

  it("tolerates lowercase and arbitrary separators", async () => {
    const { keyfile } = await generateKeyfile();
    const code = encodeRecoveryKey(keyfile.key);
    const messy = code.toLowerCase().replaceAll("-", " ");
    expect(decodeRecoveryKey(messy)).toEqual(keyfile.key);
    expect(decodeRecoveryKey(code.replaceAll("-", ""))).toEqual(keyfile.key);
  });

  it("maps ambiguous chars o→0, i/l→1", () => {
    // '0' and '1' are valid Crockford chars; encode a key whose code contains
    // them, then spell it with O/I and expect the same bytes back.
    const code = "0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000";
    const a = decodeRecoveryKey(code);
    expect(decodeRecoveryKey(code.replaceAll("0", "O"))).toEqual(a);
    const ones = "1111-1111-1111-1111-1111-1111-1111-1111-1111-1111-1111-1111-1110";
    expect(decodeRecoveryKey(ones.replace(/1/g, "l").replace("l", "I"))).toEqual(
      decodeRecoveryKey(ones),
    );
  });

  it("rejects wrong length", () => {
    expect(() => decodeRecoveryKey("AAAA")).toThrow(InvalidKeyfileError);
  });

  it("rejects chars outside the alphabet (U)", async () => {
    const { keyfile } = await generateKeyfile();
    const code = encodeRecoveryKey(keyfile.key);
    expect(() => decodeRecoveryKey(code.slice(0, -1) + "U")).toThrow(
      InvalidKeyfileError,
    );
  });

  it("rejects nonzero padding bits in the last char", async () => {
    const { keyfile } = await generateKeyfile();
    const code = encodeRecoveryKey(keyfile.key);
    // Last char is 0 or G (1 real bit + 4 zero pad bits). '1' sets a pad bit,
    // which would decode to a different key — must reject.
    expect(() => decodeRecoveryKey(code.slice(0, -1) + "1")).toThrow(
      InvalidKeyfileError,
    );
  });

  it("rejects encoding a wrong-length key", () => {
    expect(() => encodeRecoveryKey(new Uint8Array(16))).toThrow(
      InvalidKeyfileError,
    );
  });
});
