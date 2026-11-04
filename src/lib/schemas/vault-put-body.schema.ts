import { z } from "zod";

import { MAX_VAULT_BYTES } from "@/constants";
import { WRAPPER_SIGNATURE_CONTEXT } from "@/lib/signing";
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
      // Reserved for the signed message of totp wrappers.
      .refine((c) => !c.startsWith(WRAPPER_SIGNATURE_CONTEXT)),
    totp: z
      .strictObject({
        secret: z.string().refine(isValidTotpSecret),
        code: z.string(),
      })
      .nullish(),
  })
  // Two-factor is set on an existing vault only.
  .refine((b) => b.totp === undefined || typeof b.fileId === "string", { path: ["totp"] });

export type VaultPutBody = z.infer<typeof vaultPutBodySchema>;
