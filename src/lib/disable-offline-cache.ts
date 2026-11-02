
// Server-only: read in src/app/page.tsx and passed to the client as the
// `offlineCache` prop — client bundles never see this env var.
export function isOfflineCacheDisabled(): boolean {
  return process.env.DISABLE_OFFLINE_MODE === "1" || process.env.DISABLE_OFFLINE_MODE === "true";
}