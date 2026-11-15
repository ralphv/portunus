// Server-only helpers shared by the /api/vault route handlers.
import {
  API_ERROR_DRIVE,
  API_ERROR_DRIVE_AUTH,
  API_ERROR_PAYLOAD_TOO_LARGE,
  HTTP_STATUS_PAYLOAD_TOO_LARGE,
  LOG_STORE_ERROR,
} from "@/constants";
import { StoreError } from "@/lib/store/store-interface";

// Google's error text stays in the server log only: it can name file ids,
// quota details or token problems the client has no use for. The client
// gets the error code and Drive's status.
export function driveError(e: unknown): Response {
  if (e instanceof StoreError) {
    console.error(`${LOG_STORE_ERROR} ${e.status}: ${e.message}`);
    // Google rejected the token outright — client should re-authenticate.
    if (e.status === 401 || e.status === 403) {
      return Response.json(
        { error: API_ERROR_DRIVE_AUTH, upstreamStatus: e.status },
        { status: 401 },
      );
    }
    return Response.json(
      { error: API_ERROR_DRIVE, upstreamStatus: e.status },
      { status: 502 },
    );
  }
  throw e;
}

export const signatureInvalid = () =>
  Response.json({ error: "vault_signature_invalid" }, { status: 422 });

export const payloadTooLarge = () =>
  Response.json(
    { error: API_ERROR_PAYLOAD_TOO_LARGE },
    { status: HTTP_STATUS_PAYLOAD_TOO_LARGE },
  );
