import type { NextRequest } from "next/server";
import { auth, getAccessToken } from "@/auth";
import {
  createVault,
  downloadVault,
  DriveApiError,
  findOrCreateVaultFolder,
  findVaultFile,
  getFileMeta,
  moveToFolder,
  updateVault,
} from "@/lib/drive";

import { MAX_VAULT_BYTES } from "@/constants";

async function requireToken(
  req: NextRequest,
): Promise<{ token: string } | { error: Response }> {
  const session = await auth();
  if (!session) {
    return {
      error: Response.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  if (session.error) {
    return {
      error: Response.json({ error: session.error }, { status: 401 }),
    };
  }
  const access = await getAccessToken(req);
  if ("error" in access) {
    return {
      error: Response.json({ error: access.error }, { status: 401 }),
    };
  }
  return { token: access.accessToken };
}

function driveError(e: unknown): Response {
  if (e instanceof DriveApiError) {
    console.error(`[vault] Drive API error ${e.status}: ${e.message}`);
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

export async function GET(req: NextRequest) {
  const gate = await requireToken(req);
  if ("error" in gate) return gate.error;

  try {
    const file = await findVaultFile(gate.token);
    if (!file) {
      return Response.json({ error: "vault_not_found" }, { status: 404 });
    }
    // One-time migration: vaults created before the app folder existed sit
    // at Drive root — move them in. Best-effort: a migration failure must
    // not block reading the vault.
    try {
      const folderId = await findOrCreateVaultFolder(gate.token);
      const parents = file.parents ?? [];
      if (!parents.includes(folderId)) {
        await moveToFolder(gate.token, file.id, parents, folderId);
      }
    } catch (e) {
      console.error("[vault] folder migration failed:", e);
    }
    const contents = await downloadVault(gate.token, file.id);
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
// vault data stays opaque ciphertext end to end.
export async function PUT(req: NextRequest) {
  const gate = await requireToken(req);
  if ("error" in gate) return gate.error;

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
      const current = await getFileMeta(gate.token, body.fileId);
      if (current.modifiedTime !== body.baseModifiedTime) {
        return Response.json({ error: "conflict" }, { status: 409 });
      }
    }
    const meta =
      typeof body.fileId === "string"
        ? await updateVault(gate.token, body.fileId, body.contents)
        : await createVault(gate.token, body.contents);
    return Response.json({
      fileId: meta.id,
      modifiedTime: meta.modifiedTime,
    });
  } catch (e) {
    if (e instanceof DriveApiError && e.status === 404) {
      // fileId no longer exists — client should re-list and re-create.
      return Response.json({ error: "file_gone" }, { status: 404 });
    }
    return driveError(e);
  }
}
