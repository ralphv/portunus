import { createStoreFactory } from "@/factory";

// Runs at server boot (instrumentation.ts). The active store asserts its own
// requirements — Google Drive needs the AUTH_* env vars, the in-memory demo
// store needs nothing.
export function checkRequirements(): void {
  createStoreFactory().assertRequirements();
}
