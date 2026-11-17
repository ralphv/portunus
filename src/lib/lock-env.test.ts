import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTO_LOCK_SECONDS_ENV,
  HIDDEN_LOCK_SECONDS_ENV,
  LOCK_SECONDS_MAX,
  LOG_LOCK_SECONDS_INVALID,
} from "@/constants";

import { lockConfig } from "./lock-env";

const autoLock = (value: string | undefined) =>
  lockConfig({ [AUTO_LOCK_SECONDS_ENV]: value }).autoLockSeconds;
const hiddenLock = (value: string | undefined) =>
  lockConfig({ [HIDDEN_LOCK_SECONDS_ENV]: value }).hiddenLockSeconds;

const INVALID = ["-1", "1.5", "30s", "abc", "1e3", String(LOCK_SECONDS_MAX + 1)];

describe("lockConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("defaults to 5 minutes idle and 30 seconds hidden", () => {
    expect(lockConfig({})).toEqual({ autoLockSeconds: 300, hiddenLockSeconds: 30 });
    expect(autoLock("")).toBe(300);
    expect(hiddenLock("   ")).toBe(30);
  });

  it("reads each variable on its own", () => {
    expect(lockConfig({ [AUTO_LOCK_SECONDS_ENV]: "600", [HIDDEN_LOCK_SECONDS_ENV]: "10" })).toEqual({
      autoLockSeconds: 600,
      hiddenLockSeconds: 10,
    });
    expect(autoLock(" 120 ")).toBe(120);
    expect(autoLock("1")).toBe(1);
    expect(autoLock(String(LOCK_SECONDS_MAX))).toBe(LOCK_SECONDS_MAX);
    expect(hiddenLock("5")).toBe(5);
    expect(hiddenLock(String(LOCK_SECONDS_MAX))).toBe(LOCK_SECONDS_MAX);
  });

  it("allows 0 for the hidden-page lock (at once) but not for auto-lock", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(hiddenLock("0")).toBe(0);
    expect(autoLock("0")).toBe(300);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("falls back to the default, warning with the name but never the value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of INVALID) {
      expect(autoLock(bad)).toBe(300);
      expect(hiddenLock(bad)).toBe(30);
    }
    expect(warn).toHaveBeenCalledTimes(INVALID.length * 2);
    expect(warn).toHaveBeenCalledWith(LOG_LOCK_SECONDS_INVALID, AUTO_LOCK_SECONDS_ENV);
    expect(warn).toHaveBeenCalledWith(LOG_LOCK_SECONDS_INVALID, HIDDEN_LOCK_SECONDS_ENV);
    for (const call of warn.mock.calls) {
      for (const bad of INVALID) expect(call.join(" ")).not.toContain(bad);
    }
  });

  it("reads the server's own env once, so a bad value is logged once", async () => {
    vi.resetModules();
    vi.stubEnv(AUTO_LOCK_SECONDS_ENV, "5m");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { lockConfig: fresh } = await import("./lock-env");
    expect(fresh().autoLockSeconds).toBe(300);
    expect(fresh().autoLockSeconds).toBe(300);
    expect(warn).toHaveBeenCalledOnce();
  });
});
