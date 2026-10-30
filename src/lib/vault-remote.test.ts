import { describe, expect, it } from "vitest";

import {
  isTotpRequired,
  isVaultSignatureInvalid,
  totpErrorMessage,
  VaultRemoteError,
  vaultRemoteErrorCode,
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

describe("two-factor errors", () => {
  const err = (status: number, error: string) =>
    new VaultRemoteError(status, JSON.stringify({ error }));

  it("recognizes totp_required and maps each code to a message", () => {
    expect(isTotpRequired(err(401, "totp_required"))).toBe(true);
    expect(isTotpRequired(err(401, "totp_invalid"))).toBe(false);
    expect(isTotpRequired(err(401, "unauthorized"))).toBe(false);
    expect(totpErrorMessage(err(401, "totp_invalid"))).toMatch(/didn't match/);
    expect(totpErrorMessage(err(429, "totp_locked"))).toMatch(/Too many/);
    expect(totpErrorMessage(err(401, "unauthorized"))).toBeNull();
    expect(totpErrorMessage(new Error("x"))).toBeNull();
  });
});
