import { describe, expect, it } from "vitest";

import { shouldLockWhileHidden } from "./hidden-lock";

const base = { graceSeconds: 30, hiddenForMs: 0, dirty: false, filePickerOpen: false };

describe("shouldLockWhileHidden", () => {
  it("locks only once the grace period has passed", () => {
    expect(shouldLockWhileHidden({ ...base, hiddenForMs: 29_999 })).toBe(false);
    expect(shouldLockWhileHidden({ ...base, hiddenForMs: 30_000 })).toBe(true);
    expect(shouldLockWhileHidden({ ...base, hiddenForMs: 5 * 60_000 })).toBe(true);
  });

  it("locks at once with a grace period of 0", () => {
    expect(shouldLockWhileHidden({ ...base, graceSeconds: 0 })).toBe(true);
  });

  it("never locks with unsaved changes", () => {
    expect(shouldLockWhileHidden({ ...base, hiddenForMs: 60_000, dirty: true })).toBe(false);
    expect(shouldLockWhileHidden({ ...base, graceSeconds: 0, dirty: true })).toBe(false);
  });

  it("never locks while a file picker is open", () => {
    expect(shouldLockWhileHidden({ ...base, hiddenForMs: 60_000, filePickerOpen: true })).toBe(false);
  });
});
