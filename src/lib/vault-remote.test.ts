import { afterEach, describe, expect, it, vi } from "vitest";

import { VAULT_CACHE_KEY } from "@/constants";

import {
  CACHE_OFF,
  CACHE_ON,
  installVaultApiStub,
} from "./vault-api-stub.test-helper";
import {
  fetchRemoteVault,
  isTotpRequired,
  isVaultExists,
  isVaultSignatureInvalid,
  isTotpInvalid,
  totpErrorMessage,
  VaultRemoteError,
  uploadVault,
  vaultRemoteErrorCode,
  writeVaultCache,
} from "./vault-remote";

describe("isVaultSignatureInvalid", () => {
  const body = JSON.stringify({ error: "vault_signature_invalid" });

  it("matches the server's 422 vault_signature_invalid response", () => {
    expect(vaultRemoteErrorCode(new VaultRemoteError(422, body))).toBe("vault_signature_invalid");
    expect(isVaultSignatureInvalid(new VaultRemoteError(422, body))).toBe(true);
  });

  it.each([
    ["another status", new VaultRemoteError(502, body)],
    ["another code", new VaultRemoteError(422, JSON.stringify({ error: "bad_request" }))],
    ["a non-JSON body", new VaultRemoteError(422, "oops")],
    ["a plain error", new Error(body)],
  ])("ignores %s", (_name, e) => {
    expect(isVaultSignatureInvalid(e)).toBe(false);
  });
});

describe("isVaultExists", () => {
  const body = JSON.stringify({ error: "vault_exists" });
  it("matches only the create PUT's 409 vault_exists", () => {
    expect(isVaultExists(new VaultRemoteError(409, body))).toBe(true);
    expect(isVaultExists(new VaultRemoteError(409, JSON.stringify({ error: "conflict" })))).toBe(false);
    expect(isVaultExists(new VaultRemoteError(400, body))).toBe(false);
    expect(isVaultExists(new Error(body))).toBe(false);
  });
});

describe("two-factor errors", () => {
  const err = (status: number, error: string) =>
    new VaultRemoteError(status, JSON.stringify({ error }));

  it("recognizes totp_required and maps each code to a message", () => {
    expect(isTotpRequired(err(401, "totp_required"))).toBe(true);
    expect(isTotpRequired(err(401, "totp_invalid"))).toBe(false);
    expect(isTotpRequired(err(401, "unauthorized"))).toBe(false);
    expect(isTotpInvalid(err(401, "totp_invalid"))).toBe(true);
    expect(isTotpInvalid(err(401, "totp_required"))).toBe(false);
    expect(isTotpInvalid(new Error("x"))).toBe(false);
    expect(totpErrorMessage(err(401, "totp_invalid"))).toMatch(/didn't match/);
    expect(totpErrorMessage(err(429, "totp_locked"))).toMatch(/Too many/);
    expect(totpErrorMessage(err(401, "unauthorized"))).toBeNull();
    expect(totpErrorMessage(new Error("x"))).toBeNull();
  });
});

describe("offline cache policy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const VAULT = { fileId: "file-1", modifiedTime: "t1", contents: "CIPHERTEXT" };
  const goOffline = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

  it("caches the fetched envelope and falls back to it offline when on", async () => {
    installVaultApiStub().store = VAULT;
    expect(await fetchRemoteVault(CACHE_ON)).toMatchObject(VAULT);
    expect(localStorage.getItem(VAULT_CACHE_KEY)).toContain("CIPHERTEXT");
    goOffline();
    expect(await fetchRemoteVault(CACHE_ON)).toMatchObject({ ...VAULT, offline: true });
  });

  it("never writes the cache and wipes a stale one when off", async () => {
    installVaultApiStub().store = VAULT;
    writeVaultCache(VAULT, CACHE_ON); // left over from before the flag was set
    expect(await fetchRemoteVault(CACHE_OFF)).toMatchObject(VAULT);
    expect(localStorage.getItem(VAULT_CACHE_KEY)).toBeNull();
    writeVaultCache(VAULT, CACHE_OFF);
    expect(localStorage.getItem(VAULT_CACHE_KEY)).toBeNull();
  });

  it("does not unlock from a cached envelope offline when off", async () => {
    installVaultApiStub();
    writeVaultCache(VAULT, CACHE_ON);
    goOffline();
    await expect(fetchRemoteVault(CACHE_OFF)).rejects.toThrow(TypeError);
  });

  // The original bug: the browser read process.env.DISABLE_OFFLINE_MODE,
  // which Next never ships to client bundles. Only the policy may decide.
  it("ignores the DISABLE_OFFLINE_MODE env var on the client", async () => {
    vi.stubEnv("DISABLE_OFFLINE_MODE", "1");
    installVaultApiStub().store = VAULT;
    await fetchRemoteVault(CACHE_ON);
    expect(localStorage.getItem(VAULT_CACHE_KEY)).not.toBeNull();
  });

  it("uploadVault leaves the cache alone (it runs in the Worker)", async () => {
    installVaultApiStub();
    await uploadVault(null, null, "CIPHERTEXT");
    expect(localStorage.getItem(VAULT_CACHE_KEY)).toBeNull();
  });
});
