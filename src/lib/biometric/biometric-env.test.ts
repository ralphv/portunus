import { describe, expect, it } from "vitest";

import { biometricConfig } from "./biometric-env";

describe("biometricConfig", () => {
  it("is off by default", () => {
    expect(biometricConfig({})).toEqual({ unlock: false, saveConfirm: false });
  });

  it("turns on with PORTUNUS_BIOMETRIC_UNLOCK=1, save confirmation on by default", () => {
    expect(biometricConfig({ PORTUNUS_BIOMETRIC_UNLOCK: "1" })).toEqual({
      unlock: true,
      saveConfirm: true,
    });
  });

  it("only '1' turns it on", () => {
    expect(biometricConfig({ PORTUNUS_BIOMETRIC_UNLOCK: "true" }).unlock).toBe(false);
  });

  it("PORTUNUS_BIOMETRIC_SAVE_CONFIRM=0 keeps saves on the password", () => {
    expect(
      biometricConfig({
        PORTUNUS_BIOMETRIC_UNLOCK: "1",
        PORTUNUS_BIOMETRIC_SAVE_CONFIRM: "0",
      }),
    ).toEqual({ unlock: true, saveConfirm: false });
  });

  it("save confirmation is off while unlock is off", () => {
    expect(
      biometricConfig({ PORTUNUS_BIOMETRIC_SAVE_CONFIRM: "1" }).saveConfirm,
    ).toBe(false);
  });
});
