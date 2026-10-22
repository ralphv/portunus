import { scriptIntegrity } from "@/generated/script-integrity";

// Build-time expected script set for the runtime self-check. Served from an
// API route (never cached by the service worker) rather than embedded in the
// page, so the HTML — whose inline-script hashes are part of the manifest —
// doesn't depend on it. Public: it only lists this build's static chunks.
export function GET() {
  return Response.json(scriptIntegrity);
}
