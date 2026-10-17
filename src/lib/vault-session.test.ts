import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateKeyfile,
  getEngine,
  parseEnvelope,
  VaultUnlockError,
} from "@/crypto";
import type { VaultSecrets } from "@/crypto";
import {
  fetchRemoteVault,
  VaultRemoteError,
  VaultSession,
} from "./vault-session";

// In-memory stand-in for /api/vault (which itself proxies Drive).
let store: { fileId: string; modifiedTime: string; contents: string } | null;
let mtCounter: number;
let putBodies: Record<string, unknown>[];

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

beforeEach(() => {
  store = null;
  mtCounter = 0;
  putBodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        putBodies.push(body);
        if (body.fileId && (!store || store.fileId !== body.fileId)) {
          return json(404, { error: "file_gone" });
        }
        if (
          body.baseModifiedTime &&
          store &&
          body.baseModifiedTime !== store.modifiedTime
        ) {
          return json(409, { error: "conflict" });
        }
        const modifiedTime = `t${++mtCounter}`;
        store = {
          fileId: (body.fileId as string) ?? "file-1",
          modifiedTime,
          contents: body.contents as string,
        };
        return json(200, { fileId: store.fileId, modifiedTime });
      }
      if (!store) return json(404, { error: "vault_not_found" });
      return json(200, {
        fileId: store.fileId,
        modifiedTime: store.modifiedTime,
        contents: store.contents,
      });
    }),
  );
});

async function makeSecrets(password = "pw"): Promise<VaultSecrets> {
  const { keyfile } = await generateKeyfile();
  return { password, keyfile: keyfile.key };
}

const te = new TextEncoder();
const EMPTY_VAULT = te.encode('{"entries":[]}');

describe("VaultSession", () => {
  it("unlock returns null when no vault exists", async () => {
    expect(await VaultSession.unlock(await makeSecrets())).toBeNull();
  });

  it("create uploads only ciphertext — plaintext never leaves", async () => {
    const secrets = await makeSecrets();
    const session = await VaultSession.create(
      secrets,
      te.encode('{"entries":[{"site":"a.com","password":"s3cret"}]}'),
    );
    expect(putBodies).toHaveLength(1);
    const contents = putBodies[0].contents as string;
    expect(contents).not.toContain("s3cret");
    expect(contents).not.toContain("a.com");
    expect(JSON.parse(contents).engine).toBe("argon2id-xchacha20");
    session.lock();
  });

  it("unlocks a created vault and exposes the plaintext", async () => {
    const secrets = await makeSecrets();
    const created = await VaultSession.create(secrets, EMPTY_VAULT);
    created.lock();

    const session = await VaultSession.unlock(secrets);
    expect(session).not.toBeNull();
    expect(new TextDecoder().decode(session!.data)).toBe('{"entries":[]}');
  });

  it("rejects unlock with the wrong password", async () => {
    await VaultSession.create(await makeSecrets("right"), EMPTY_VAULT);
    await expect(
      VaultSession.unlock(await makeSecrets("wrong")),
    ).rejects.toThrow(VaultUnlockError);
  });

  it("tracks dirty state across update and save", async () => {
    const secrets = await makeSecrets();
    const session = await VaultSession.create(secrets, EMPTY_VAULT);
    expect(session.dirty).toBe(false);

    const next = te.encode('{"entries":[{"site":"b.com"}]}');
    session.update(next);
    expect(session.dirty).toBe(true);

    await session.save();
    expect(session.dirty).toBe(false);
    expect(putBodies).toHaveLength(2);

    const reloaded = await VaultSession.unlock(secrets);
    expect(reloaded!.data).toEqual(next);
  });

  it("verifyPassword accepts the right password and rejects a wrong one", async () => {
    const secrets = await makeSecrets("hunter2");
    const session = (await VaultSession.unlock(secrets)) ??
      (await VaultSession.create(secrets, EMPTY_VAULT));
    await expect(session.verifyPassword("hunter2")).resolves.toBeUndefined();
    await expect(session.verifyPassword("nope")).rejects.toThrow(
      VaultUnlockError,
    );
  });

  it("changePassword re-wraps — the old password no longer unlocks", async () => {
    const secrets = await makeSecrets("old-pw");
    const session = await VaultSession.create(secrets, EMPTY_VAULT);
    await session.changePassword("new-pw");
    expect(session.dirty).toBe(false);

    // Session state: new password verifies, old one doesn't.
    await expect(session.verifyPassword("new-pw")).resolves.toBeUndefined();
    await expect(session.verifyPassword("old-pw")).rejects.toThrow(
      VaultUnlockError,
    );

    // The remote envelope itself now requires the new password.
    const remote = await fetchRemoteVault();
    const env = parseEnvelope(remote!.contents);
    const engine = getEngine(env.engine);
    await expect(
      engine.unlock(env, { password: "new-pw", keyfile: secrets.keyfile }),
    ).resolves.toBeTruthy();
    await expect(
      engine.unlock(env, { password: "old-pw", keyfile: secrets.keyfile }),
    ).rejects.toThrow(VaultUnlockError);
  });

  it("exportKeyfile returns the held keyfile with its kid", async () => {
    const secrets = await makeSecrets();
    const session = await VaultSession.create(secrets, EMPTY_VAULT);
    const kf = await session.exportKeyfile();
    expect(kf.key).toEqual(secrets.keyfile);
    expect(kf.kid).toMatch(/^[0-9a-f]{16}$/);
  });

  it("surfaces a write conflict and stays dirty", async () => {
    const secrets = await makeSecrets();
    const session = await VaultSession.create(secrets, EMPTY_VAULT);
    // Simulate another device writing behind our back.
    store!.modifiedTime = "elsewhere";
    session.update(te.encode("{}"));
    await expect(session.save()).rejects.toThrow(VaultRemoteError);
    expect(session.dirty).toBe(true);
  });

  it("reports no engine upgrade for a current-engine vault", async () => {
    const session = await VaultSession.create(await makeSecrets(), EMPTY_VAULT);
    expect(session.needsEngineUpgrade).toBe(false);
  });
});
