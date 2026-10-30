// Server-only helpers shared by the /api/vault route handlers.
import { StoreError } from "@/lib/store/store-interface";

export function driveError(e: unknown): Response {
  if (e instanceof StoreError) {
    console.error(`[vault] store error ${e.status}: ${e.message}`);
    // Google rejected the token outright — client should re-authenticate.
    if (e.status === 401 || e.status === 403) {
      return Response.json(
        { error: "drive_auth", upstreamStatus: e.status },
        { status: 401 },
      );
    }
    return Response.json(
      {
        error: "drive_error",
        upstreamStatus: e.status,
        upstream: e.message.slice(0, 500),
      },
      { status: 502 },
    );
  }
  throw e;
}

export const signatureInvalid = () =>
  Response.json({ error: "vault_signature_invalid" }, { status: 422 });
