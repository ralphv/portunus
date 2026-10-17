import { argon2idXChaCha20 } from "./engines/argon2id-xchacha20";
import type { VaultEngineInterface } from "./engines/interface";
import { UnsupportedEngineError, VaultError } from "./errors";

// Registered engines, oldest to newest. Deprecated engines stay in this list
// forever — unlock dispatches here by envelope.engine, and removing one
// bricks vaults written with it.
const engines: VaultEngineInterface[] = [argon2idXChaCha20];

export function getEngine(id: string): VaultEngineInterface {
  const engine = engines.find((e) => e.id === id);
  if (!engine) {
    throw new UnsupportedEngineError(`No engine registered for "${id}"`);
  }
  return engine;
}

// Engine used for new vaults and for re-saving existing ones — the latest
// non-deprecated engine, so saves silently upgrade old envelopes.
export function defaultEngine(): VaultEngineInterface {
  for (let i = engines.length - 1; i >= 0; i--) {
    if (!engines[i].deprecated) return engines[i];
  }
  throw new VaultError("No active vault engine registered");
}
