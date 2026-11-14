import { afterEach, describe, expect, it, vi } from "vitest";

import { createBiometricFactory } from "@/factory";

import { NopBiometricProvider } from "./providers/nop-biometric-provider";
import { WebAuthnPrfBiometricProvider } from "./providers/webauthn-prf-biometric-provider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createBiometricFactory", () => {
  it("uses WebAuthn when the flag is on and the browser has it", () => {
    vi.stubGlobal("PublicKeyCredential", {});
    expect(createBiometricFactory(true)).toBeInstanceOf(WebAuthnPrfBiometricProvider);
  });

  it("uses the NOP provider when the flag is off", async () => {
    vi.stubGlobal("PublicKeyCredential", {});
    const p = createBiometricFactory(false);
    expect(p).toBeInstanceOf(NopBiometricProvider);
    expect(await p.isSupported()).toBe(false);
    await expect(p.evaluate("a", "b")).rejects.toMatchObject({ kind: "unsupported" });
  });

  it("uses the NOP provider without WebAuthn", () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    expect(createBiometricFactory(true)).toBeInstanceOf(NopBiometricProvider);
  });
});
