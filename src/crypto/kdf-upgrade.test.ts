import { describe, expect, it } from "vitest";

import { kdfNeedsUpgrade, readStoredKdfCost } from "./kdf-upgrade";
import type { VaultHeader } from "./types";

const ENGINE = "argon2id-xchacha20";

function header(kdf: unknown, engine = ENGINE): VaultHeader {
  return { format: "portunus-vault", version: 1, engine, kdf } as VaultHeader;
}

describe("readStoredKdfCost", () => {
  it("reads a numeric time + mem", () => {
    expect(readStoredKdfCost(header({ time: 2, mem: 19456 }))).toEqual({
      time: 2,
      mem: 19456,
    });
  });

  it("returns null when the cost is missing or non-numeric", () => {
    expect(readStoredKdfCost(header(undefined))).toBeNull();
    expect(readStoredKdfCost(header(null))).toBeNull();
    expect(readStoredKdfCost(header({ mem: 19456 }))).toBeNull();
    expect(readStoredKdfCost(header({ time: "2", mem: 19456 }))).toBeNull();
    expect(readStoredKdfCost(header({ time: Infinity, mem: 19456 }))).toBeNull();
  });
});

describe("kdfNeedsUpgrade", () => {
  const target = { time: 2, mem: 64 * 1024 };

  it("upgrades when memory is below target", () => {
    expect(kdfNeedsUpgrade(header({ time: 2, mem: 19 * 1024 }), target, ENGINE)).toBe(
      true,
    );
  });

  it("upgrades when time is below target", () => {
    expect(
      kdfNeedsUpgrade(
        header({ time: 1, mem: 64 * 1024 }),
        { time: 3, mem: 64 * 1024 },
        ENGINE,
      ),
    ).toBe(true);
  });

  it("does not upgrade when the stored cost already meets the target", () => {
    expect(kdfNeedsUpgrade(header({ time: 2, mem: 64 * 1024 }), target, ENGINE)).toBe(
      false,
    );
  });

  it("is monotonic: never fires to weaken a stronger vault", () => {
    expect(
      kdfNeedsUpgrade(header({ time: 4, mem: 128 * 1024 }), target, ENGINE),
    ).toBe(false);
  });

  it("ignores a vault written by a different engine (engine upgrade covers it)", () => {
    expect(
      kdfNeedsUpgrade(header({ time: 1, mem: 1 }, "legacy-engine"), target, ENGINE),
    ).toBe(false);
  });

  it("does not upgrade when the stored cost is unreadable", () => {
    expect(kdfNeedsUpgrade(header(undefined), target, ENGINE)).toBe(false);
  });
});
