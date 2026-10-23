
export function isOfflineCacheDisabled(): boolean {
  return process.env.DISABLE_OFFLINE_MODE === "1" || process.env.DISABLE_OFFLINE_MODE === "true";
}