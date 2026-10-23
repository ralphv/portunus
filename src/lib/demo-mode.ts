// Demo mode: in-memory vault storage + stubbed sign-in, so the full UI can be
// run and recorded without Google OAuth or a Drive account. Also enabled in
// production builds — `PORTUNUS_DEMO_MODE=1 docker run …` is the try-it-out path.
export function isDemoMode(): boolean {
  return process.env.PORTUNUS_DEMO_MODE === "1" || process.env.PORTUNUS_DEMO_MODE === "true";
}

export const DEMO_EMAIL = "demo@portunus.local";
export const DEMO_PROVIDER_ID = "demo";
// Ties a demo vault to one browser across sign-out/sign-in.
export const DEMO_VISITOR_COOKIE = "portunus.demo-visitor";

export const DEMO_AUTH_SECRET = "portunus-demo-mode-insecure-secret";
