import type { NextRequest } from "next/server";
import { getStore } from "@/factory";
import {
  isMissingSignatureAllowed,
  isSigningEnabled,
  parseStoredVault,
  signPayload,
  verifyPayload,
  wrapSigned,
} from "@/lib/signing";
import { StoreError } from "@/lib/store/store-interface";

import { MAX_VAULT_BYTES } from "@/constants";

function driveError(e: unknown): Response {
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

const signatureInvalid = () =>
  Response.json({ error: "vault_signature_invalid" }, { status: 422 });

// Unwraps the Drive file to the envelope string the client expects, or null
// when its signature doesn't check out. Signed wrappers are still unwrapped
// with signatures disabled, so turning the feature off never breaks a vault.
async function openStoredVault(
  fileId: string,
  stored: string,
): Promise<string | null> {
  const file = parseStoredVault(stored);
  if (!isSigningEnabled()) {
    return file.kind === "signed" ? file.payload : stored;
  }
  if (file.kind === "signed") {
    if (await verifyPayload(file.payload, file.signature)) return file.payload;
    console.error(`[vault] rejected vault ${fileId}: signature does not verify`);
    return null;
  }
  if (file.kind === "unsigned" && isMissingSignatureAllowed()) {
    console.warn(
      `[vault] accepted unsigned vault ${fileId} (PORTUNUS_ALLOW_MISSING_SIGNATURE=1); it is signed on its next save`,
    );
    return stored;
  }
  console.error(`[vault] rejected vault ${fileId}: ${file.kind} signature`);
  return null;
}

export async function GET(req: NextRequest) {
  const gate = await getStore(req);
  if ("error" in gate) {
    return Response.json({ error: gate.error }, { status: 401 });
  }
  const { store } = gate;

  try {
    const file = await store.findVaultFile();
    if (!file) {
      return Response.json({ error: "vault_not_found" }, { status: 404 });
    }
    // One-time migration: vaults created before the app folder existed sit
    // at Drive root — move them in. Best-effort: a migration failure must
    // not block reading the vault.
    try {
      const folderId = await store.findOrCreateVaultFolder();
      const parents = file.parents ?? [];
      if (!parents.includes(folderId)) {
        await store.moveToFolder(file.id, parents, folderId);
      }
    } catch (e) {
      console.error("[vault] folder migration failed:", e);
    }
    const contents = await openStoredVault(
      file.id,
      await store.downloadVault(file.id),
    );
    if (contents === null) return signatureInvalid();
    return Response.json({
      fileId: file.id,
      modifiedTime: file.modifiedTime,
      contents,
    });
  } catch (e) {
    return driveError(e);
  }
}

// Body: { fileId?: string | null, contents: string, baseModifiedTime?: string }
// fileId set → update; absent → create. Server never parses `contents` —
// vault data stays opaque ciphertext end to end. It is stored as a signed
// `{ payload, signature }` wrapper unless signatures are disabled.
export async function PUT(req: NextRequest) {
  const gate = await getStore(req);
  if ("error" in gate) {
    return Response.json({ error: gate.error }, { status: 401 });
  }
  const { store } = gate;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (
    typeof body.contents !== "string" ||
    body.contents.length === 0 ||
    body.contents.length > MAX_VAULT_BYTES ||
    (body.fileId !== undefined && body.fileId !== null && typeof body.fileId !== "string") ||
    (body.baseModifiedTime !== undefined &&
      body.baseModifiedTime !== null &&
      typeof body.baseModifiedTime !== "string")
  ) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    // Optimistic concurrency: Drive v3 has no etags/conditional writes, so we
    // compare modifiedTime before overwriting (small race window accepted —
    // single-user vault).
    if (
      typeof body.fileId === "string" &&
      typeof body.baseModifiedTime === "string"
    ) {
      const current = await store.getFileMeta(body.fileId);
      if (current.modifiedTime !== body.baseModifiedTime) {
        return Response.json({ error: "conflict" }, { status: 409 });
      }
    }
    const stored = isSigningEnabled()
      ? wrapSigned(body.contents, await signPayload(body.contents))
      : body.contents;
    const meta =
      typeof body.fileId === "string"
        ? await store.updateVault(body.fileId, stored)
        : await store.createVault(stored);
    return Response.json({
      fileId: meta.id,
      modifiedTime: meta.modifiedTime,
    });
  } catch (e) {
    if (e instanceof StoreError && e.status === 404) {
      // fileId no longer exists — client should re-list and re-create.
      return Response.json({ error: "file_gone" }, { status: 404 });
    }
    return driveError(e);
  }
}
