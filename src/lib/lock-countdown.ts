// The auto-lock pill's "locks in …" time: m:ss, or h:mm:ss from an hour up
// (PORTUNUS_AUTO_LOCK_SECONDS can be up to a day).
export function formatLockCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const ss = String(s % 60).padStart(2, "0");
  if (s < 3600) return `${Math.floor(s / 60)}:${ss}`;
  const mm = String(Math.floor(s / 60) % 60).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${mm}:${ss}`;
}
