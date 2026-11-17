import { describe, expect, it } from "vitest";

import { formatLockCountdown } from "./lock-countdown";

describe("formatLockCountdown", () => {
  it("shows m:ss under an hour", () => {
    expect(formatLockCountdown(0)).toBe("0:00");
    expect(formatLockCountdown(59)).toBe("0:59");
    expect(formatLockCountdown(300)).toBe("5:00");
    expect(formatLockCountdown(3599)).toBe("59:59");
  });

  it("shows h:mm:ss from an hour up", () => {
    expect(formatLockCountdown(3600)).toBe("1:00:00");
    expect(formatLockCountdown(7265)).toBe("2:01:05");
    expect(formatLockCountdown(86400)).toBe("24:00:00");
  });
});
