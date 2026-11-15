import { z } from "zod";

import { MAX_VAULT_BYTES, TOTP_CODE_MAX_LENGTH } from "@/constants";
import { hasReservedPrefix } from "@/lib/signing";
import { isValidTotpSecret } from "@/lib/vault-totp";

// PUT /api/vault body (src/app/api/vault/route.ts). Our own API, so unknown
// fields are refused. `fileId` set → update, absent → create; `totp` absent
// keeps the stored two-factor block, `{ secret, code }` replaces it, `null`
// removes it.
export const vaultPutBodySchema = z
  .strictObject({
    fileId: z.string().nullish(),
    baseModifiedTime: z.string().nullish(),
    contents: z
      .string()
      .min(1)
      .max(MAX_VAULT_BYTES)
      // The v2/v3 domain tags start the signed messages; refused so stored
      // contents can never double as a tagged message.
      .refine((c) => !hasReservedPrefix(c)),
    totp: z
      .strictObject({
        secret: z.string().refine(isValidTotpSecret),
        code: z.string().max(TOTP_CODE_MAX_LENGTH),
      })
      .nullish(),
  })
  // Two-factor is set on an existing vault only.
  .refine((b) => b.totp === undefined || typeof b.fileId === "string", { path: ["totp"] });

export type VaultPutBody = z.infer<typeof vaultPutBodySchema>;
