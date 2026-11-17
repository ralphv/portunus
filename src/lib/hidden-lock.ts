// Client-side rules for the hidden-page lock (src/components/hidden-cover.tsx).
// No rendering here, so the decision and the guards can be unit-tested.

export type HiddenLockInput = {
  /** PORTUNUS_HIDDEN_LOCK_SECONDS, resolved on the server. */
  graceSeconds: number;
  /** How long the page has been hidden so far. */
  hiddenForMs: number;
  /** Unsaved changes: never lock (it would throw them away). */
  dirty: boolean;
  /** System UI the app opened itself (file picker, passkey sheet) was up. */
  externalUiOpen: boolean;
};

export function shouldLockWhileHidden({
  graceSeconds,
  hiddenForMs,
  dirty,
  externalUiOpen,
}: HiddenLockInput): boolean {
  return !dirty && !externalUiOpen && hiddenForMs >= graceSeconds * 1000;
}

// --- App-opened system UI ---
// A file chooser or a passkey/biometric sheet the app opens can hide the
// page (on Android it is a separate screen). Such a hide is the user doing
// what the app asked, not walking away, so it must not lock the vault —
// whatever opened it calls beginExternalUi() first and the returned end()
// once it is over. The hook reads this when the page goes hidden and keeps
// the answer for that whole hidden period.
let externalUiCount = 0;

export function beginExternalUi(): () => void {
  externalUiCount++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    externalUiCount--;
  };
}

export function isExternalUiOpen(): boolean {
  return externalUiCount > 0;
}

export async function withExternalUi<T>(work: () => Promise<T>): Promise<T> {
  const end = beginExternalUi();
  try {
    return await work();
  } finally {
    end();
  }
}

// The file chooser has no promise to await: it is over at the input's
// `change` or `cancel`, or — where `cancel` isn't supported — when the
// window gets focus back. Only one chooser is open at a time; opening
// another ends the previous one's guard and listeners.
let endFilePicker: (() => void) | null = null;

export function noteFilePickerOpen(input: EventTarget): void {
  endFilePickerGuard();
  const end = beginExternalUi();
  const stop = new AbortController();
  const done = () => {
    end();
    stop.abort();
    if (endFilePicker === done) endFilePicker = null;
  };
  endFilePicker = done;
  input.addEventListener("change", done, { signal: stop.signal });
  input.addEventListener("cancel", done, { signal: stop.signal });
  globalThis.window?.addEventListener("focus", done, { signal: stop.signal });
}

// Ends a pending file-chooser guard; also called whenever the page becomes
// visible again, so a chooser that reported nothing can't keep the guard on.
export function endFilePickerGuard(): void {
  endFilePicker?.();
}
