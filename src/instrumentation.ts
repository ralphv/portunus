import { checkRequirements } from "@/lib/check-requirements";
import { setupOpenTelemetry } from "@/lib/setup-opentelemetry";

// Runs once when the server process boots (dev, start, and standalone).
export function register() {
  // Not a real server boot — page-data collection during `next build`.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;

  checkRequirements();
  setupOpenTelemetry();
}
