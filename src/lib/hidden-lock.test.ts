import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginExternalUi,
  endFilePickerGuard,
  isExternalUiOpen,
  noteFilePickerOpen,
  shouldLockWhileHidden,
  withExternalUi,
} from "./hidden-lock";

const base = { graceSeconds: 30, hiddenForMs: 0, dirty: false, externalUiOpen: false };

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

  it("never locks while app-opened system UI is up", () => {
    expect(shouldLockWhileHidden({ ...base, hiddenForMs: 60_000, externalUiOpen: true })).toBe(false);
  });
});

describe("external UI guard", () => {
  afterEach(() => {
    endFilePickerGuard();
    vi.unstubAllGlobals();
  });

  it("counts nested openings; each end() counts once", () => {
    const a = beginExternalUi();
    const b = beginExternalUi();
    expect(isExternalUiOpen()).toBe(true);
    a();
    a();
    expect(isExternalUiOpen()).toBe(true);
    b();
    expect(isExternalUiOpen()).toBe(false);
  });

  it("withExternalUi holds the guard for the call, even when it throws", async () => {
    let during = false;
    await withExternalUi(async () => {
      during = isExternalUiOpen();
    });
    expect(during).toBe(true);
    expect(isExternalUiOpen()).toBe(false);
    await expect(
      withExternalUi(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(isExternalUiOpen()).toBe(false);
  });

  it.each(["change", "cancel"])("a file chooser ends at the input's %s", (event) => {
    const input = new EventTarget();
    noteFilePickerOpen(input);
    expect(isExternalUiOpen()).toBe(true);
    input.dispatchEvent(new Event(event));
    expect(isExternalUiOpen()).toBe(false);
  });

  it("a file chooser ends when the window gets focus back (no cancel event)", () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    noteFilePickerOpen(new EventTarget());
    win.dispatchEvent(new Event("focus"));
    expect(isExternalUiOpen()).toBe(false);
  });

  it("reopening the chooser replaces the old guard instead of stacking one", () => {
    const input = new EventTarget();
    noteFilePickerOpen(input);
    noteFilePickerOpen(input);
    input.dispatchEvent(new Event("change"));
    expect(isExternalUiOpen()).toBe(false);
  });

  it("endFilePickerGuard ends a chooser that reported nothing", () => {
    noteFilePickerOpen(new EventTarget());
    endFilePickerGuard();
    expect(isExternalUiOpen()).toBe(false);
  });
});
