import { z } from "zod";

// Google's OAuth token endpoint, answering a refresh_token grant
// (src/lib/google-token-refresh.ts). Google's API: unknown fields (scope,
// token_type, id_token) are allowed. `refresh_token` appears only when
// Google rotates it.
export const googleTokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
});

export type GoogleTokenResponse = z.infer<typeof googleTokenResponseSchema>;
