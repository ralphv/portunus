// Fail fast on missing config — without these, auth silently breaks at
// request time while the container still looks "healthy".
const REQUIRED_ENV = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_SECRET",
  "AUTH_URL",
] as const;

export function checkRequirements(): void {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "See .env.example.",
    );
  }
}
