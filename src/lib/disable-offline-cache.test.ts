import { afterEach, describe, expect, it, vi } from "vitest";

import { isOfflineCacheDisabled } from "./disable-offline-cache";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isOfflineCacheDisabled", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["0", false],
    ["", false],
  ])("DISABLE_OFFLINE_MODE=%j → %s", (value, expected) => {
    vi.stubEnv("DISABLE_OFFLINE_MODE", value);
    expect(isOfflineCacheDisabled()).toBe(expected);
  });
});
