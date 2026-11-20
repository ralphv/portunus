import type { VaultHeader } from "./types";

// Opportunistic Argon2id cost migration.
//
// The KDF cost (time + memory) is stored per-vault in the envelope and bound
// into the AEAD AAD, so every vault carries its own cost and always unlocks
// with it — raising the configured target never breaks an existing vault.
// The target only governs newly written wraps. This module decides, on each
// password-confirmed save, whether a vault's stored cost is below the target
// and should be re-wrapped to reach it (see VaultSession.save).
//
// The policy is deliberately MONOTONIC: an upgrade fires only when the target
// is stronger in some dimension, so lowering the configured cost (or an
// attacker tampering it downward) can never weaken an existing vault.

// Argon2id cost a newly written wrap should use. `mem` is in KiB, matching
// the envelope's stored `kdf.mem`.
export type KdfTarget = {
  time: number;
  mem: number;
};

// The Argon2id cost recorded in a vault header, or null when the header has
// no readable numeric cost — a foreign/malformed `kdf` block, which is left
// to the normal unlock path to reject rather than forcing a re-wrap here.
export function readStoredKdfCost(header: VaultHeader): KdfTarget | null {
  const kdf = (header as { kdf?: unknown }).kdf;
  if (kdf === null || typeof kdf !== "object") return null;
  const { time, mem } = kdf as { time?: unknown; mem?: unknown };
  if (typeof time !== "number" || typeof mem !== "number") return null;
  if (!Number.isFinite(time) || !Number.isFinite(mem)) return null;
  return { time, mem };
}

// Whether a vault written with `header` should be re-wrapped to reach
// `target`. Only compares within one engine (`engineId`): a vault written by
// a different engine is handled by the engine-upgrade path, which already
// re-wraps at the target cost, so this returns false for it.
export function kdfNeedsUpgrade(
  header: VaultHeader,
  target: KdfTarget,
  engineId: string,
): boolean {
  if (header.engine !== engineId) return false;
  const current = readStoredKdfCost(header);
  if (!current) return false;
  return target.time > current.time || target.mem > current.mem;
}
