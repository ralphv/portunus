// End-to-end vault round-trip: client-side crypto → /api/vault → Google Drive
// store provider → (stubbed) Drive REST API → back. Only fetch() is faked;
// the route handlers, store provider, and crypto engine are the real ones.

import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defaultEngine,
  generateKeyfile,
  getEngine,
  headerOf,
  parseEnvelope,
  serializeEnvelope,
  VaultUnlockError,
} from "@/crypto";
import type { VaultSecrets } from "@/crypto";

import { createFakeDrive } from "./store/fake-drive.test-helper";

const TOKEN = "ya29.integration-token";

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { email: "user@example.com" } })),
  getAccessToken: vi.fn(async () => ({ accessToken: TOKEN })),
}));

import { GET, PUT } from "@/app/api/vault/route";

const te = new TextEncoder();
const td = new TextDecoder();

type DriveCall = { url: string; body?: string };
let driveCalls: DriveCall[];

beforeEach(() => {
  vi.stubEnv("PORTUNUS_DEMO_MODE", "");
  driveCalls = [];
  const drive = createFakeDrive(TOKEN);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      driveCalls.push({
        url: String(input),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return drive(input, init);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function putVault(body: Record<string, unknown>) {
  const res = await PUT(
    new Request("http://localhost/api/vault", {
      method: "PUT",
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );
  return { status: res.status, json: await res.json() };
}

async function getVault() {
  const res = await GET(
    new Request("http://localhost/api/vault") as unknown as NextRequest,
  );
  return { status: res.status, json: await res.json() };
}

async function newSecrets(password = "correct horse battery staple") {
  const { keyfile } = await generateKeyfile();
  return { password, keyfile: keyfile.key } satisfies VaultSecrets;
}

async function loadAndDecrypt(secrets: VaultSecrets) {
  const remote = await getVault();
  expect(remote.status).toBe(200);
  const envelope = parseEnvelope(remote.json.contents);
  const engine = getEngine(envelope.engine);
  const dataKey = await engine.unlock(headerOf(envelope), secrets);
  const plaintext = td.decode(await engine.decrypt(envelope, dataKey));
  return { remote: remote.json, envelope, plaintext };
}

describe("vault round-trip through /api/vault and Google Drive", () => {
  it("creates, saves, loads, and decrypts a vault; updates round-trip too", async () => {
    const secrets = await newSecrets();
    const engine = defaultEngine();
    const { header, dataKey } = await engine.initNew(secrets);

    expect((await getVault()).status).toBe(404);

    const doc = JSON.stringify({ entries: [{ title: "bank", password: "s3cr3t-pw" }] });
    const envelope = await engine.encrypt(header, dataKey, te.encode(doc));
    const created = await putVault({ contents: serializeEnvelope(envelope) });
    expect(created.status).toBe(200);
    expect(created.json.fileId).toEqual(expect.any(String));

    const loaded = await loadAndDecrypt(secrets);
    expect(loaded.plaintext).toBe(doc);
    expect(loaded.remote.fileId).toBe(created.json.fileId);

    // Re-save with the unlocked header + data key (what the client does).
    const doc2 = JSON.stringify({ entries: [{ title: "bank", password: "rotated-pw" }] });
    const env2 = await engine.encrypt(
      headerOf(loaded.envelope),
      dataKey,
      te.encode(doc2),
    );
    const updated = await putVault({
      fileId: loaded.remote.fileId,
      baseModifiedTime: loaded.remote.modifiedTime,
      contents: serializeEnvelope(env2),
    });
    expect(updated.status).toBe(200);
    expect((await loadAndDecrypt(secrets)).plaintext).toBe(doc2);

    // A stale base modifiedTime is rejected rather than overwriting.
    const stale = await putVault({
      fileId: loaded.remote.fileId,
      baseModifiedTime: loaded.remote.modifiedTime,
      contents: serializeEnvelope(envelope),
    });
    expect(stale.status).toBe(409);
  });

  it("only ever sends ciphertext to Drive", async () => {
    const secrets = await newSecrets();
    const engine = defaultEngine();
    const { header, dataKey } = await engine.initNew(secrets);
    const marker = "PLAINTEXT-MARKER-6f1d";
    const envelope = await engine.encrypt(header, dataKey, te.encode(marker));
    await putVault({ contents: serializeEnvelope(envelope) });
    await getVault();

    const sent = driveCalls.map((c) => `${c.url}\n${c.body ?? ""}`).join("\n");
    expect(sent).toContain(envelope.ciphertext as string);
    expect(sent).not.toContain(marker);
    expect(sent).not.toContain(secrets.password);
  });

  it("rejects a wrong password or a wrong keyfile with VaultUnlockError", async () => {
    const secrets = await newSecrets();
    const engine = defaultEngine();
    const { header, dataKey } = await engine.initNew(secrets);
    const envelope = await engine.encrypt(header, dataKey, te.encode("{}"));
    await putVault({ contents: serializeEnvelope(envelope) });

    const { json } = await getVault();
    const stored = parseEnvelope(json.contents);
    const storedEngine = getEngine(stored.engine);
    const otherKeyfile = (await generateKeyfile()).keyfile.key;

    await expect(
      storedEngine.unlock(headerOf(stored), { ...secrets, password: "wrong password" }),
    ).rejects.toThrow(VaultUnlockError);
    await expect(
      storedEngine.unlock(headerOf(stored), { ...secrets, keyfile: otherKeyfile }),
    ).rejects.toThrow(VaultUnlockError);
  });
});
