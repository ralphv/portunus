import { describe, expect, it, vi } from "vitest";

import { KDF_MEM_MIB_DEFAULT, KDF_TIME_DEFAULT } from "@/constants";

import { kdfConfig } from "./kdf-env";

const DEFAULTS = { time: KDF_TIME_DEFAULT, mem: KDF_MEM_MIB_DEFAULT * 1024 };

describe("kdfConfig", () => {
  it("uses the defaults when the env vars are unset or blank", () => {
    expect(kdfConfig({})).toEqual(DEFAULTS);
    expect(kdfConfig({ PORTUNUS_KDF_TIME: "  ", PORTUNUS_KDF_MEM_MIB: "" })).toEqual(
      DEFAULTS,
    );
  });

  it("reads valid values and converts memory from MiB to KiB", () => {
    expect(
      kdfConfig({ PORTUNUS_KDF_TIME: "3", PORTUNUS_KDF_MEM_MIB: "96" }),
    ).toEqual({ time: 3, mem: 96 * 1024 });
  });

  it("falls back on out-of-range or non-numeric values, logging only the name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      kdfConfig({ PORTUNUS_KDF_TIME: "0", PORTUNUS_KDF_MEM_MIB: "999" }),
    ).toEqual(DEFAULTS);
    expect(kdfConfig({ PORTUNUS_KDF_MEM_MIB: "notanumber" }).mem).toBe(
      DEFAULTS.mem,
    );

    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("PORTUNUS_KDF_TIME");
    expect(logged).toContain("PORTUNUS_KDF_MEM_MIB");
    // The offending value must never be logged.
    expect(logged).not.toContain("999");
    warn.mockRestore();
  });
});
