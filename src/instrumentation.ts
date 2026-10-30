import { setupOpenTelemetry } from "@/lib/setup-opentelemetry";

// Runs once when the server process boots (dev, start, and standalone).
export async function register() {
  // Not a real server boot — page-data collection during `next build`.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Statically checked so the edge bundle drops the import: the requirements
  // check pulls in node:crypto (vault signing), which edge can't load.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkRequirements } = await import("@/lib/check-requirements");
    checkRequirements();
    setupOpenTelemetry();
  }
}
