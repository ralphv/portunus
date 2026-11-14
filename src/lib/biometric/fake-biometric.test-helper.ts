import { b64encode } from "@/crypto/base64";
import { generatePrfSalt } from "@/crypto/device-unlock-record";

import { BiometricError } from "./biometric-error";
import type { BiometricErrorKind } from "./biometric-error";
import type { BiometricEnrollment, BiometricInterface } from "./biometric-interface";

// In-memory authenticator for tests: each passkey has a random secret, and
// its PRF output is SHA-256(secret ‖ salt) — deterministic per (passkey,
// salt), like the real hmac-secret.
export class FakeBiometric implements BiometricInterface {
  readonly secrets = new Map<string, Uint8Array>();
  readonly forgotten: string[] = [];
  // Set to make the next checks fail like a cancelled/refused prompt.
  failWith: BiometricErrorKind | null = null;
  evaluations = 0;

  async isSupported(): Promise<boolean> {
    return true;
  }

  async hasPlatformAuthenticator(): Promise<boolean> {
    return true;
  }

  async enroll(): Promise<BiometricEnrollment> {
    if (this.failWith) throw new BiometricError(this.failWith);
    const credentialId = b64encode(crypto.getRandomValues(new Uint8Array(16)));
    this.secrets.set(credentialId, crypto.getRandomValues(new Uint8Array(32)));
    const prfSalt = generatePrfSalt();
    return { credentialId, prfSalt, prf: await this.prf(credentialId, prfSalt) };
  }

  async evaluate(credentialId: string, prfSalt: string): Promise<Uint8Array> {
    this.evaluations++;
    if (this.failWith) throw new BiometricError(this.failWith);
    return this.prf(credentialId, prfSalt);
  }

  async forget(credentialId: string): Promise<void> {
    this.forgotten.push(credentialId);
    this.secrets.delete(credentialId);
  }

  private async prf(credentialId: string, prfSalt: string): Promise<Uint8Array> {
    const secret = this.secrets.get(credentialId);
    if (!secret) throw new BiometricError("failed");
    const input = new TextEncoder().encode(b64encode(secret) + prfSalt);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  }
}
