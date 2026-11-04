import {
  InvalidKeyfileError,
  MalformedEnvelopeError,
  UnsupportedEngineError,
  VaultDecryptError,
  VaultError,
  VaultUnlockError,
} from "@/crypto/errors";

import { PwnedCheckError } from "./pwned-passwords";
import { VaultRemoteError } from "./vault-remote";
import type { VaultWorkerCore } from "./vault-worker-core";

// postMessage protocol between the main thread (VaultClient) and the vault
// Worker. Only the methods listed here can be called.

export const VAULT_WORKER_METHODS = [
  "open",
  "create",
  "setSecret",
  "generatePassword",
  "reveal",
  "passwordPending",
  "strengths",
  "checkPwned",
  "auditGroups",
  "checkPwnedGroup",
  "totp",
  "verifyPassword",
  "save",
  "saveTotp",
  "changePassword",
  "exportKeyfile",
  "reconnect",
] as const satisfies readonly (keyof VaultWorkerCore)[];

export type VaultWorkerMethod = (typeof VAULT_WORKER_METHODS)[number];
export type VaultWorkerApi = Pick<VaultWorkerCore, VaultWorkerMethod>;

export type VaultRequest = {
  id: number;
  method: VaultWorkerMethod;
  args: unknown[];
};

export type SerializedError = {
  name: string;
  message: string;
  status?: number;
  kind?: string;
};

export type VaultResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: SerializedError };

// Errors are tagged by `instanceof`, not by `.name`: production builds
// minify class names, so `.name` can't identify them. Subclasses first.
const VAULT_ERRORS = {
  VaultUnlockError,
  VaultDecryptError,
  MalformedEnvelopeError,
  UnsupportedEngineError,
  InvalidKeyfileError,
  VaultError,
} as const;

export function serializeError(e: unknown): SerializedError {
  if (e instanceof VaultRemoteError) {
    return { name: "VaultRemoteError", message: e.message, status: e.status };
  }
  if (e instanceof PwnedCheckError) {
    return { name: "PwnedCheckError", message: e.message, status: e.status, kind: e.kind };
  }
  for (const [name, Cls] of Object.entries(VAULT_ERRORS)) {
    if (e instanceof Cls) return { name, message: e.message };
  }
  if (e instanceof Error) return { name: e.name, message: e.message };
  return { name: "Error", message: String(e) };
}

// Structured clone drops Error subclasses; rebuild them so callers can keep
// using `instanceof VaultUnlockError` etc.
export function deserializeError(e: SerializedError): Error {
  if (e.name === "VaultRemoteError") {
    return new VaultRemoteError(e.status ?? 0, e.message);
  }
  if (e.name === "PwnedCheckError") {
    return new PwnedCheckError(
      (e.kind ?? "network") as PwnedCheckError["kind"],
      e.message,
      e.status,
    );
  }
  if (Object.hasOwn(VAULT_ERRORS, e.name)) {
    return new VAULT_ERRORS[e.name as keyof typeof VAULT_ERRORS](e.message);
  }
  const err = new Error(e.message);
  err.name = e.name;
  return err;
}

export function createVaultHandler(core: VaultWorkerCore) {
  return async (req: VaultRequest): Promise<VaultResponse> => {
    try {
      if (!(VAULT_WORKER_METHODS as readonly string[]).includes(req.method)) {
        throw new VaultError(`Unknown vault method "${String(req.method)}"`);
      }
      const fn = core[req.method] as (...args: unknown[]) => unknown;
      return { id: req.id, ok: true, result: await fn.apply(core, req.args) };
    } catch (e) {
      return { id: req.id, ok: false, error: serializeError(e) };
    }
  };
}
