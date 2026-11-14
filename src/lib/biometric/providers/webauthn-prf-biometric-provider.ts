import {
  BIOMETRIC_DETAIL_NO_CREDENTIAL,
  BIOMETRIC_DETAIL_NO_PRF_AT_CREATE,
  BIOMETRIC_DETAIL_NO_PRF_AT_GET,
  BIOMETRIC_STEP_CREATE,
  BIOMETRIC_STEP_GET,
  DEVICE_UNLOCK_PRF_BYTES,
  WEBAUTHN_ABORT,
  WEBAUTHN_ALGORITHMS,
  WEBAUTHN_CHALLENGE_BYTES,
  WEBAUTHN_NOT_ALLOWED,
  WEBAUTHN_PRF_CAPABILITY,
  WEBAUTHN_PUBLIC_KEY,
  WEBAUTHN_RP_NAME,
  WEBAUTHN_TIMEOUT_MS,
  WEBAUTHN_USER_DISPLAY_NAME,
  WEBAUTHN_USER_ID_BYTES,
  WEBAUTHN_USER_NAME_PREFIX,
} from "@/constants";
import { b64decode, b64encode } from "@/crypto/base64";
import { generatePrfSalt } from "@/crypto/device-unlock-record";

import { BiometricError } from "../biometric-error";
import type { BiometricEnrollment, BiometricInterface } from "../biometric-interface";

// WebAuthn passkey + PRF extension. Runs on the main thread (WebAuthn isn't
// available in Workers). Nothing is verified server-side: the security
// comes from the PRF secret, which the authenticator releases only after
// user verification, so the challenge is just random bytes.
//
// No authenticatorAttachment restriction: a phone's built-in authenticator
// and a FIDO2 security key with hmac-secret both work. The rpId defaults to
// the page's host, so a moved deployment needs re-enrolling.

type Bytes = Uint8Array<ArrayBuffer>;

const random = (n: number): Bytes => crypto.getRandomValues(new Uint8Array(n));

// Optional, newer WebAuthn statics — not in every browser or in lib.dom.
type PublicKeyCredentialStatics = {
  getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
  isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
  signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void>;
};

function statics(): PublicKeyCredentialStatics | null {
  return typeof PublicKeyCredential === "undefined"
    ? null
    : (PublicKeyCredential as unknown as PublicKeyCredentialStatics);
}

function toBiometricError(e: unknown, step: string): BiometricError {
  if (e instanceof BiometricError) return e;
  const name = e instanceof Error ? e.name : typeof e;
  const message = e instanceof Error ? e.message : "";
  return new BiometricError(
    name === WEBAUTHN_NOT_ALLOWED || name === WEBAUTHN_ABORT ? "cancelled" : "failed",
    `${step}: ${name}${message ? ` — ${message}` : ""}`,
  );
}

function prfFirst(cred: Credential | null): Uint8Array | null {
  const ext = (cred as PublicKeyCredential | null)?.getClientExtensionResults().prf;
  const first = ext?.results?.first;
  if (!first) return null;
  const bytes = new Uint8Array(
    first instanceof ArrayBuffer ? first : (first as ArrayBufferView).buffer.slice(
      (first as ArrayBufferView).byteOffset,
      (first as ArrayBufferView).byteOffset + (first as ArrayBufferView).byteLength,
    ),
  );
  return bytes.length === DEVICE_UNLOCK_PRF_BYTES ? bytes : null;
}

export class WebAuthnPrfBiometricProvider implements BiometricInterface {
  async isSupported(): Promise<boolean> {
    const pkc = statics();
    if (!pkc || !globalThis.isSecureContext || !navigator.credentials) return false;
    try {
      const caps = await pkc.getClientCapabilities?.();
      // Browsers without getClientCapabilities may still support PRF;
      // enroll() finds out and fails cleanly if not.
      return caps ? caps[WEBAUTHN_PRF_CAPABILITY] === true : true;
    } catch {
      return false;
    }
  }

  async hasPlatformAuthenticator(): Promise<boolean> {
    if (!(await this.isSupported())) return false;
    try {
      return (await statics()?.isUserVerifyingPlatformAuthenticatorAvailable?.()) ?? false;
    } catch {
      return false;
    }
  }

  async enroll(kid: string): Promise<BiometricEnrollment> {
    const prfSalt = generatePrfSalt();
    let cred: Credential | null;
    try {
      cred = await navigator.credentials.create({
        publicKey: {
          rp: { name: WEBAUTHN_RP_NAME },
          user: {
            id: random(WEBAUTHN_USER_ID_BYTES),
            name: WEBAUTHN_USER_NAME_PREFIX + kid,
            displayName: WEBAUTHN_USER_DISPLAY_NAME,
          },
          challenge: random(WEBAUTHN_CHALLENGE_BYTES),
          pubKeyCredParams: WEBAUTHN_ALGORITHMS.map((alg) => ({
            type: WEBAUTHN_PUBLIC_KEY,
            alg,
          })),
          authenticatorSelection: {
            userVerification: "required",
            residentKey: "preferred",
          },
          timeout: WEBAUTHN_TIMEOUT_MS,
          extensions: { prf: { eval: { first: b64decode(prfSalt) as Bytes } } },
        },
      });
    } catch (e) {
      throw toBiometricError(e, BIOMETRIC_STEP_CREATE);
    }
    if (!cred) {
      throw new BiometricError("failed", `${BIOMETRIC_STEP_CREATE}: ${BIOMETRIC_DETAIL_NO_CREDENTIAL}`);
    }
    const credentialId = b64encode(new Uint8Array((cred as PublicKeyCredential).rawId));
    const ext = (cred as PublicKeyCredential).getClientExtensionResults().prf;
    if (!ext?.enabled && !ext?.results) {
      // The authenticator has no PRF: the passkey is useless to us.
      await this.forget(credentialId);
      throw new BiometricError(
        "unsupported",
        `${BIOMETRIC_STEP_CREATE}: ${BIOMETRIC_DETAIL_NO_PRF_AT_CREATE}`,
      );
    }
    // Some platforms (e.g. security keys on Windows) return the PRF output
    // only on get(): ask once more. No output there either means the
    // browser/OS can't pass PRF through for this authenticator.
    const prf = prfFirst(cred) ?? (await this.getPrf(credentialId, prfSalt));
    if (!prf) {
      await this.forget(credentialId);
      throw new BiometricError(
        "unsupported",
        `${BIOMETRIC_STEP_GET}: ${BIOMETRIC_DETAIL_NO_PRF_AT_GET}`,
      );
    }
    return { credentialId, prfSalt, prf };
  }

  async evaluate(credentialId: string, prfSalt: string): Promise<Uint8Array> {
    const prf = await this.getPrf(credentialId, prfSalt);
    if (!prf) {
      throw new BiometricError("failed", `${BIOMETRIC_STEP_GET}: ${BIOMETRIC_DETAIL_NO_PRF_AT_GET}`);
    }
    return prf;
  }

  // The PRF output for an enrolled passkey, or null when the check passed
  // but the browser returned none.
  private async getPrf(credentialId: string, prfSalt: string): Promise<Uint8Array | null> {
    let cred: Credential | null;
    try {
      cred = await navigator.credentials.get({
        publicKey: {
          challenge: random(WEBAUTHN_CHALLENGE_BYTES),
          allowCredentials: [
            { type: WEBAUTHN_PUBLIC_KEY, id: b64decode(credentialId) as Bytes },
          ],
          userVerification: "required",
          timeout: WEBAUTHN_TIMEOUT_MS,
          extensions: { prf: { eval: { first: b64decode(prfSalt) as Bytes } } },
        },
      });
    } catch (e) {
      throw toBiometricError(e, BIOMETRIC_STEP_GET);
    }
    return prfFirst(cred);
  }

  async forget(credentialId: string): Promise<void> {
    try {
      await statics()?.signalUnknownCredential?.({
        rpId: location.hostname,
        credentialId,
      });
    } catch {
      // Best effort — the passkey just stays, unusable without the record.
    }
  }
}
