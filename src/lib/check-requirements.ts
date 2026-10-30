import { createStoreFactory } from "@/factory";
import { assertSigningRequirements } from "@/lib/signing";

// Runs at server boot (instrumentation.ts). The active store asserts its own
// requirements — Google Drive needs the AUTH_* env vars, the in-memory demo
// store needs nothing. Vault signatures need PORTUNUS_SIGNING_PRIVATE_KEY
// unless disabled or in demo mode.
export function checkRequirements(): void {
  createStoreFactory().assertRequirements();
  assertSigningRequirements();
}
