import { z } from "zod";

// The vault's two-factor block. Exactly one field: the signed message covers
// the secret alone, so any extra key would sit outside the signature.
export const vaultTotpBlockSchema = z.strictObject({
  secret: z.string().min(1),
});

export type VaultTotpBlock = z.infer<typeof vaultTotpBlockSchema>;

// The signed `{ payload, totp?, signature }` wrapper stored as the Drive file
// (src/lib/signing.ts). Stored data that another app version may have
// written, so unknown top-level fields are allowed.
export const storedVaultWrapperSchema = z.looseObject({
  payload: z.string(),
  signature: z.string(),
  totp: vaultTotpBlockSchema.optional(),
});

export type StoredVaultWrapper = z.infer<typeof storedVaultWrapperSchema>;
