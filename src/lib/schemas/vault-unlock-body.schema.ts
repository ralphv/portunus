import { z } from "zod";

import { TOTP_CODE_MAX_LENGTH } from "@/constants";

// POST /api/vault/unlock body (src/app/api/vault/unlock/route.ts). Our own
// API, so unknown fields are refused. `deliver: false` (a save-time
// re-prompt) skips the single-use delivery grant.
export const vaultUnlockBodySchema = z.strictObject({
  code: z.string().max(TOTP_CODE_MAX_LENGTH),
  deliver: z.boolean().optional(),
});

export type VaultUnlockBody = z.infer<typeof vaultUnlockBodySchema>;
