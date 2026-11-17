import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HIDDEN_LOCK_SECONDS_DEFAULT,
  HIDDEN_LOCK_SECONDS_ENV,
  HIDDEN_LOCK_SECONDS_MAX,
  LOG_HIDDEN_LOCK_SECONDS_INVALID,
} from "@/constants";

import { hiddenLockSeconds } from "./hidden-lock-env";

const read = (value: string | undefined) => hiddenLockSeconds({ [HIDDEN_LOCK_SECONDS_ENV]: value });

describe("hiddenLockSeconds", () => {
  afterEach(() => vi.restoreAllMocks());

  it("defaults to 30 seconds when unset or blank", () => {
    expect(HIDDEN_LOCK_SECONDS_DEFAULT).toBe(30);
    expect(hiddenLockSeconds({})).toBe(30);
    expect(read("")).toBe(30);
    expect(read("   ")).toBe(30);
  });

  it("reads a whole number of seconds, including 0 and the maximum", () => {
    expect(read("0")).toBe(0);
    expect(read("5")).toBe(5);
    expect(read(" 120 ")).toBe(120);
    expect(read(String(HIDDEN_LOCK_SECONDS_MAX))).toBe(HIDDEN_LOCK_SECONDS_MAX);
  });

  it("falls back to the default, with a warning, for anything else", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of ["-1", "1.5", "30s", "abc", "1e3", String(HIDDEN_LOCK_SECONDS_MAX + 1)]) {
      expect(read(bad)).toBe(HIDDEN_LOCK_SECONDS_DEFAULT);
    }
    expect(warn).toHaveBeenCalledTimes(6);
    // The log names the variable, never the value.
    expect(warn).toHaveBeenCalledWith(LOG_HIDDEN_LOCK_SECONDS_INVALID);
  });
});
