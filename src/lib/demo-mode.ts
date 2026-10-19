// Demo mode: in-memory vault storage + stubbed sign-in, so the full UI can be
// run and recorded without Google OAuth or a Drive account. Never honored in
// production builds.
export function isDemoMode(): boolean {
  return (
    process.env.PORTUNUS_DEMO_MODE === "1" &&
    process.env.NODE_ENV !== "production"
  );
}

export const DEMO_EMAIL = "demo@portunus.local";
export const DEMO_PROVIDER_ID = "demo";
