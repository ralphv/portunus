import { describe, expect, it } from "vitest";

import { isVaultSignatureInvalid, VaultRemoteError, vaultRemoteErrorCode } from "./vault-remote";

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
