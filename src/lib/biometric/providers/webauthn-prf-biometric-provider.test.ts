import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { b64decode, b64encode } from "@/crypto/base64";

import { BiometricError } from "../biometric-error";
import { WebAuthnPrfBiometricProvider } from "./webauthn-prf-biometric-provider";

const RAW_ID = new Uint8Array([1, 2, 3, 4]);
const PRF = new Uint8Array(32).fill(7);

type Prf = { enabled?: boolean; results?: { first: BufferSource } };

function credential(prf: Prf | undefined) {
  return {
    rawId: RAW_ID.buffer,
    getClientExtensionResults: () => (prf ? { prf } : {}),
  };
}

let create: ReturnType<typeof vi.fn>;
let get: ReturnType<typeof vi.fn>;
let pkc: {
  getClientCapabilities?: () => Promise<Record<string, boolean>>;
  isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean>;
  signalUnknownCredential: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  create = vi.fn();
  get = vi.fn();
  pkc = {
    getClientCapabilities: async () => ({ "extension:prf": true }),
    isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    signalUnknownCredential: vi.fn(async () => {}),
  };
  vi.stubGlobal("PublicKeyCredential", pkc);
  vi.stubGlobal("navigator", { credentials: { create, get } });
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("location", { hostname: "vault.example.com" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const provider = () => new WebAuthnPrfBiometricProvider();

describe("WebAuthnPrfBiometricProvider", () => {
  it("is supported when the browser reports PRF", async () => {
    expect(await provider().isSupported()).toBe(true);
    expect(await provider().hasPlatformAuthenticator()).toBe(true);
  });

  it("is not supported without PRF, a secure context or WebAuthn", async () => {
    pkc.getClientCapabilities = async () => ({ "extension:prf": false });
    expect(await provider().isSupported()).toBe(false);
    expect(await provider().hasPlatformAuthenticator()).toBe(false);
    vi.stubGlobal("isSecureContext", false);
    pkc.getClientCapabilities = async () => ({ "extension:prf": true });
    expect(await provider().isSupported()).toBe(false);
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("PublicKeyCredential", undefined);
    expect(await provider().isSupported()).toBe(false);
  });

  it("assumes support when the browser can't report capabilities", async () => {
    delete pkc.getClientCapabilities;
    expect(await provider().isSupported()).toBe(true);
  });

  it("enrolls with the PRF output returned at creation", async () => {
    create.mockResolvedValue(credential({ enabled: true, results: { first: PRF } }));
    const got = await provider().enroll("0123456789abcdef");
    expect(got.credentialId).toBe(b64encode(RAW_ID));
    expect(got.prf).toEqual(PRF);
    expect(b64decode(got.prfSalt)).toHaveLength(32);
    expect(get).not.toHaveBeenCalled();
    const opts = create.mock.calls[0][0].publicKey;
    expect(opts.authenticatorSelection.userVerification).toBe("required");
    expect(opts.authenticatorSelection.authenticatorAttachment).toBeUndefined();
    expect(opts.user.name).toContain("0123456789abcdef");
    expect(new Uint8Array(opts.extensions.prf.eval.first)).toEqual(b64decode(got.prfSalt));
  });

  it("asks again when the PRF output only comes from get()", async () => {
    create.mockResolvedValue(credential({ enabled: true }));
    get.mockResolvedValue(credential({ results: { first: PRF.buffer } }));
    const got = await provider().enroll("0123456789abcdef");
    expect(got.prf).toEqual(PRF);
    const opts = get.mock.calls[0][0].publicKey;
    expect(opts.userVerification).toBe("required");
    expect(new Uint8Array(opts.allowCredentials[0].id)).toEqual(RAW_ID);
  });

  it("refuses and forgets a passkey without PRF", async () => {
    create.mockResolvedValue(credential({ enabled: false }));
    const err = await provider().enroll("0123456789abcdef").catch((e) => e);
    expect(err).toBeInstanceOf(BiometricError);
    expect(err.kind).toBe("unsupported");
    expect(pkc.signalUnknownCredential).toHaveBeenCalledWith({
      rpId: "vault.example.com",
      credentialId: b64encode(RAW_ID),
    });
  });

  it("refuses and forgets a passkey whose PRF output never arrives", async () => {
    create.mockResolvedValue(credential({ enabled: true }));
    get.mockResolvedValue(credential({ enabled: true }));
    const err = await provider().enroll("0123456789abcdef").catch((e) => e);
    expect(err).toBeInstanceOf(BiometricError);
    expect(err.kind).toBe("unsupported");
    expect(err.detail).toContain("get");
    expect(pkc.signalUnknownCredential).toHaveBeenCalled();
  });

  it("says which step failed and the browser's error name", async () => {
    create.mockRejectedValue(Object.assign(new Error("PIN required"), { name: "NotAllowedError" }));
    const err = await provider().enroll("0123456789abcdef").catch((e) => e);
    expect(err.kind).toBe("cancelled");
    expect(err.detail).toBe("create: NotAllowedError — PIN required");
  });

  it("maps a cancelled or refused check to 'cancelled'", async () => {
    get.mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    const err = await provider().evaluate(b64encode(RAW_ID), b64encode(PRF)).catch((e) => e);
    expect(err).toBeInstanceOf(BiometricError);
    expect(err.kind).toBe("cancelled");
  });

  it("fails on any other error or a missing PRF output", async () => {
    get.mockRejectedValueOnce(new TypeError("bad"));
    await expect(
      provider().evaluate(b64encode(RAW_ID), b64encode(PRF)),
    ).rejects.toMatchObject({ kind: "failed" });
    get.mockResolvedValueOnce(credential(undefined));
    await expect(
      provider().evaluate(b64encode(RAW_ID), b64encode(PRF)),
    ).rejects.toMatchObject({ kind: "failed" });
    get.mockResolvedValueOnce(credential({ results: { first: new Uint8Array(16) } }));
    await expect(
      provider().evaluate(b64encode(RAW_ID), b64encode(PRF)),
    ).rejects.toMatchObject({ kind: "failed" });
  });

  it("ignores browsers that can't forget a passkey", async () => {
    vi.stubGlobal("PublicKeyCredential", {});
    await expect(provider().forget(b64encode(RAW_ID))).resolves.toBeUndefined();
  });
});
