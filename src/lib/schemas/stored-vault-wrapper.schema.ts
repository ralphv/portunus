import { z } from "zod";

import { VAULT_WRAPPER_VERSION_BOUND } from "@/constants";

// The vault's two-factor block. Exactly one field: the signed message covers
// the secret alone, so any extra key would sit outside the signature.
export const vaultTotpBlockSchema = z.strictObject({
  secret: z.string().min(1),
});

export type VaultTotpBlock = z.infer<typeof vaultTotpBlockSchema>;

// The signed `{ version?, payload, totp?, signature }` wrapper stored as the
// Drive file (src/lib/signing.ts). Stored data that another app version may
// have written, so unknown top-level fields are allowed. `version` names the
// signed-message format: VAULT_WRAPPER_VERSION_BOUND (the signature also
// covers the Drive file id) or absent (a legacy wrapper). Any other value is
// a format this version can't verify, so the wrapper is malformed.
export const storedVaultWrapperSchema = z.looseObject({
  version: z.literal(VAULT_WRAPPER_VERSION_BOUND).optional(),
  payload: z.string(),
  signature: z.string(),
  totp: vaultTotpBlockSchema.optional(),
});

export type StoredVaultWrapper = z.infer<typeof storedVaultWrapperSchema>;
