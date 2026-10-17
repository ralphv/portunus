import { describe, expect, it } from "vitest";

import { generatePassword } from "./password-gen";

describe("generatePassword", () => {
  it("produces the requested length", () => {
    expect(generatePassword({ length: 32 })).toHaveLength(32);
    expect(generatePassword()).toHaveLength(20);
  });

  it("uses only allowed characters", () => {
    const pw = generatePassword({ length: 200, symbols: false });
    expect(pw).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it("respects a restricted charset", () => {
    const pw = generatePassword({
      length: 100,
      lower: false,
      upper: false,
      symbols: false,
    });
    expect(pw).toMatch(/^[0-9]+$/);
  });

  it("generates distinct passwords", () => {
    const set = new Set(
      Array.from({ length: 50 }, () => generatePassword()),
    );
    expect(set.size).toBe(50);
  });

  it("rejects an empty charset", () => {
    expect(() =>
      generatePassword({ lower: false, upper: false, digits: false, symbols: false }),
    ).toThrow();
  });
});
