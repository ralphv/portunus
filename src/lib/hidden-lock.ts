// Client-side rules for the hidden-page lock (src/components/hidden-cover.tsx).
// No DOM rendering here, so the decision can be unit-tested.

export type HiddenLockInput = {
  /** PORTUNUS_HIDDEN_LOCK_SECONDS, resolved on the server. */
  graceSeconds: number;
  /** How long the page has been hidden so far. */
  hiddenForMs: number;
  /** Unsaved changes: never lock (it would throw them away). */
  dirty: boolean;
  /** A file picker the app opened is up (on Android it hides the page). */
  filePickerOpen: boolean;
};

export function shouldLockWhileHidden({
  graceSeconds,
  hiddenForMs,
  dirty,
  filePickerOpen,
}: HiddenLockInput): boolean {
  return !dirty && !filePickerOpen && hiddenForMs >= graceSeconds * 1000;
}

// Set while a file picker opened by the app is up. On Android the picker
// is a separate screen, so the page goes hidden for as long as it's open —
// that must not lock the vault mid-pick. Cleared when the input reports a
// choice or a cancel, and whenever the page becomes visible again.
let filePickerOpen = false;

export function noteFilePickerOpen(input: HTMLInputElement): void {
  filePickerOpen = true;
  const done = () => {
    filePickerOpen = false;
    input.removeEventListener("change", done);
    input.removeEventListener("cancel", done);
  };
  input.addEventListener("change", done);
  input.addEventListener("cancel", done);
}

export function isFilePickerOpen(): boolean {
  return filePickerOpen;
}

export function clearFilePickerOpen(): void {
  filePickerOpen = false;
}
