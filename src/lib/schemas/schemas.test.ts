import { describe, expect, it } from "vitest";

import { MAX_VAULT_BYTES, TOTP_CODE_MAX_LENGTH } from "@/constants";
import { createSchemaValidatorFactory } from "@/factory";
import { WRAPPER_SIGNATURE_CONTEXT } from "@/lib/signing";

import { driveFileIdSchema } from "./drive-file-id.schema";
import { driveFileListSchema } from "./drive-file-list.schema";
import { driveFileMetaSchema } from "./drive-file-meta.schema";
import { driveFolderListSchema } from "./drive-folder-list.schema";
import { googleTokenResponseSchema } from "./google-token-response.schema";
import { storedVaultWrapperSchema, vaultTotpBlockSchema } from "./stored-vault-wrapper.schema";
import { vaultPutBodySchema } from "./vault-put-body.schema";
import { vaultUnlockBodySchema } from "./vault-unlock-body.schema";

const validator = createSchemaValidatorFactory();
const ok = (schema: Parameters<typeof validator.check>[0], payload: unknown) =>
  validator.check(schema, payload).ok;

// 32 base32 chars = 20 bytes, within isValidTotpSecret's 16–64.
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

describe("vaultPutBodySchema (strict: our own API)", () => {
  it("accepts a create, an update, and each totp change", () => {
    expect(ok(vaultPutBodySchema, { contents: "v1" })).toBe(true);
    expect(ok(vaultPutBodySchema, { fileId: null, baseModifiedTime: null, contents: "v1" })).toBe(true);
    expect(ok(vaultPutBodySchema, { fileId: "f", baseModifiedTime: "t", contents: "v2" })).toBe(true);
    expect(ok(vaultPutBodySchema, { fileId: "f", contents: "v", totp: { secret: TOTP_SECRET, code: "123456" } })).toBe(true);
    expect(ok(vaultPutBodySchema, { fileId: "f", contents: "v", totp: null })).toBe(true);
  });

  it("refuses missing, empty, oversized or reserved contents", () => {
    expect(ok(vaultPutBodySchema, {})).toBe(false);
    expect(ok(vaultPutBodySchema, { contents: "" })).toBe(false);
    expect(ok(vaultPutBodySchema, { contents: "x".repeat(MAX_VAULT_BYTES + 1) })).toBe(false);
    expect(ok(vaultPutBodySchema, { contents: `${WRAPPER_SIGNATURE_CONTEXT}x` })).toBe(false);
  });

  it("refuses wrong types", () => {
    expect(ok(vaultPutBodySchema, { contents: "v", fileId: 1 })).toBe(false);
    expect(ok(vaultPutBodySchema, { contents: "v", baseModifiedTime: 1 })).toBe(false);
    expect(ok(vaultPutBodySchema, { contents: 1 })).toBe(false);
  });

  it("refuses an invalid or loose totp change, or one on a create", () => {
    expect(ok(vaultPutBodySchema, { fileId: "f", contents: "v", totp: { secret: "short", code: "1" } })).toBe(false);
    expect(ok(vaultPutBodySchema, { fileId: "f", contents: "v", totp: { secret: TOTP_SECRET } })).toBe(false);
    expect(
      ok(vaultPutBodySchema, { fileId: "f", contents: "v", totp: { secret: TOTP_SECRET, code: "1", extra: 1 } }),
    ).toBe(false);
    expect(ok(vaultPutBodySchema, { contents: "v", totp: { secret: TOTP_SECRET, code: "123456" } })).toBe(false);
    expect(ok(vaultPutBodySchema, { contents: "v", totp: null })).toBe(false);
  });

  it("refuses unknown fields", () => {
    expect(ok(vaultPutBodySchema, { contents: "v", admin: true })).toBe(false);
  });
});

describe("vaultUnlockBodySchema (strict: our own API)", () => {
  it("accepts a code, with or without deliver", () => {
    expect(ok(vaultUnlockBodySchema, { code: "123456" })).toBe(true);
    expect(ok(vaultUnlockBodySchema, { code: "123456", deliver: false })).toBe(true);
  });

  it("refuses a missing or overlong code, a non-boolean deliver, unknown fields", () => {
    expect(ok(vaultUnlockBodySchema, {})).toBe(false);
    expect(ok(vaultUnlockBodySchema, { code: "1".repeat(TOTP_CODE_MAX_LENGTH + 1) })).toBe(false);
    expect(ok(vaultUnlockBodySchema, { code: "123456", deliver: "no" })).toBe(false);
    expect(ok(vaultUnlockBodySchema, { code: "123456", extra: 1 })).toBe(false);
  });
});

describe("Drive response schemas (lenient: Google's API)", () => {
  it("accepts file metadata, with extra fields kept", () => {
    const result = validator.check(driveFileMetaSchema, { id: "f", modifiedTime: "t", kind: "drive#file" });
    expect(result).toEqual({ ok: true, value: { id: "f", modifiedTime: "t", kind: "drive#file" } });
    expect(ok(driveFileMetaSchema, { id: "f", modifiedTime: "t", parents: ["p"] })).toBe(true);
  });

  it("refuses metadata without an id or modifiedTime", () => {
    expect(ok(driveFileMetaSchema, { modifiedTime: "t" })).toBe(false);
    expect(ok(driveFileMetaSchema, { id: "", modifiedTime: "t" })).toBe(false);
    expect(ok(driveFileMetaSchema, { id: "f" })).toBe(false);
    expect(ok(driveFileMetaSchema, { id: "f", modifiedTime: "t", parents: "p" })).toBe(false);
  });

  it("accepts file and folder lists, including no matches", () => {
    expect(ok(driveFileListSchema, { files: [{ id: "f", modifiedTime: "t" }] })).toBe(true);
    expect(ok(driveFileListSchema, {})).toBe(true);
    expect(ok(driveFolderListSchema, { files: [{ id: "d" }], nextPageToken: "x" })).toBe(true);
    expect(ok(driveFolderListSchema, {})).toBe(true);
  });

  it("refuses lists with malformed entries", () => {
    expect(ok(driveFileListSchema, { files: [{ id: "f" }] })).toBe(false);
    expect(ok(driveFileListSchema, { files: {} })).toBe(false);
    expect(ok(driveFolderListSchema, { files: [{}] })).toBe(false);
  });

  it("checks a created file's id", () => {
    expect(ok(driveFileIdSchema, { id: "d" })).toBe(true);
    expect(ok(driveFileIdSchema, {})).toBe(false);
  });
});

describe("googleTokenResponseSchema (lenient: Google's API)", () => {
  it("accepts a refresh response, with or without a rotated refresh token", () => {
    expect(ok(googleTokenResponseSchema, { access_token: "a", expires_in: 3599, token_type: "Bearer" })).toBe(true);
    expect(ok(googleTokenResponseSchema, { access_token: "a", expires_in: 3599, refresh_token: "r" })).toBe(true);
  });

  it("refuses a missing token or expiry", () => {
    expect(ok(googleTokenResponseSchema, { expires_in: 3599 })).toBe(false);
    expect(ok(googleTokenResponseSchema, { access_token: "a" })).toBe(false);
    expect(ok(googleTokenResponseSchema, { access_token: "a", expires_in: "3599" })).toBe(false);
    expect(ok(googleTokenResponseSchema, { access_token: "a", expires_in: 0 })).toBe(false);
  });
});

describe("storedVaultWrapperSchema (lenient wrapper, strict totp block)", () => {
  it("accepts a wrapper with or without a totp block, and unknown top-level fields", () => {
    expect(ok(storedVaultWrapperSchema, { payload: "p", signature: "s" })).toBe(true);
    expect(ok(storedVaultWrapperSchema, { payload: "p", signature: "s", totp: { secret: "S" } })).toBe(true);
    expect(ok(storedVaultWrapperSchema, { payload: "p", signature: "s", addedLater: 1 })).toBe(true);
  });

  it("refuses a wrapper missing its payload or signature", () => {
    expect(ok(storedVaultWrapperSchema, { signature: "s" })).toBe(false);
    expect(ok(storedVaultWrapperSchema, { payload: "p" })).toBe(false);
  });

  it("refuses a totp block with anything but a non-empty secret", () => {
    expect(ok(vaultTotpBlockSchema, { secret: "" })).toBe(false);
    expect(ok(vaultTotpBlockSchema, { secret: "S", unsigned: true })).toBe(false);
    expect(ok(storedVaultWrapperSchema, { payload: "p", signature: "s", totp: null })).toBe(false);
  });
});
