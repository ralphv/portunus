import type { NextRequest } from "next/server";
import { getStore } from "@/lib/store/get-store";
import {
  openStoredVault,
  serializeStoredVault,
  WRAPPER_SIGNATURE_CONTEXT,
} from "@/lib/signing";
import type { VaultTotpBlock } from "@/lib/signing";
import { StoreError } from "@/lib/store/store-interface";
import { driveError, signatureInvalid } from "@/lib/vault-server";
import {
  checkGrant,
  clearDeliveryCookie,
  clearGrantCookies,
  consumeDeliveryGrant,
  grantCookie,
  isValidTotpSecret,
  readGrantCookie,
  TOTP_DELIVERY_COOKIE,
  totpFailure,
  totpRequired,
  verifyTotpCode,
} from "@/lib/vault-totp";

import { MAX_VAULT_BYTES } from "@/constants";

type Gate = { ok: true; cookies: string[] } | { ok: false; response: Response };

// Delivery (GET) with a totp block present spends the single-use delivery
// grant minted by POST /api/vault/unlock, so each unlock needs a fresh code;
// a session grant alone is not enough.
function deliveryGate(
  req: NextRequest,
  fileId: string,
  totp: VaultTotpBlock | undefined,
): Gate {
  if (!totp) return { ok: true, cookies: [] };
  if (!consumeDeliveryGrant(readGrantCookie(req, TOTP_DELIVERY_COOKIE), fileId, totp)) {
    return { ok: false, response: totpRequired() };
  }
  return {
    ok: true,
    cookies: [clearDeliveryCookie(req), grantCookie(req, fileId, totp)],
  };
}

// Saves (PUT) need the session grant; passing re-issues it (sliding expiry).
function sessionGate(
  req: NextRequest,
  fileId: string,
  totp: VaultTotpBlock | undefined,
): Gate {
  if (!totp) return { ok: true, cookies: [] };
  if (!checkGrant(readGrantCookie(req), fileId, totp)) {
    return { ok: false, response: totpRequired() };
  }
  return { ok: true, cookies: [grantCookie(req, fileId, totp)] };
}

function withCookies(res: Response, cookies: string[]): Response {
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
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
    const opened = await openStoredVault(
      file.id,
      await store.downloadVault(file.id),
    );
    if (opened === null) return signatureInvalid();
    const totp = deliveryGate(req, file.id, opened.totp);
    if (!totp.ok) return totp.response;
    return withCookies(
      Response.json({
        fileId: file.id,
        modifiedTime: file.modifiedTime,
        contents: opened.payload,
        ...(opened.totp ? { totpEnabled: true } : {}),
      }),
      totp.cookies,
    );
  } catch (e) {
    return driveError(e);
  }
}

type TotpChange = { secret: string; code: string } | null | undefined;

function parseTotpChange(v: unknown): TotpChange | false {
  if (v === undefined || v === null) return v;
  if (typeof v !== "object" || Array.isArray(v)) return false;
  const { secret, code } = v as Record<string, unknown>;
  if (typeof secret !== "string" || typeof code !== "string") return false;
  if (!isValidTotpSecret(secret)) return false;
  return { secret, code };
}

// Body: { fileId?: string | null, contents: string, baseModifiedTime?: string,
//         totp?: { secret, code } | null }
// fileId set → update; absent → create (409 vault_exists if one already
// exists). Server never parses `contents` —
// vault data stays opaque ciphertext end to end. It is stored as a signed
// `{ payload, totp?, signature }` wrapper unless signatures are disabled.
// `totp` absent keeps the stored two-factor block, `{ secret, code }`
// enables (or replaces) it once `code` checks out, `null` removes it; while
// a block is stored every update needs a valid grant cookie.
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
  const totpChange = parseTotpChange(body.totp);
  if (
    typeof body.contents !== "string" ||
    body.contents.length === 0 ||
    body.contents.length > MAX_VAULT_BYTES ||
    // Reserved for the signed message of totp wrappers.
    body.contents.startsWith(WRAPPER_SIGNATURE_CONTEXT) ||
    (body.fileId !== undefined && body.fileId !== null && typeof body.fileId !== "string") ||
    (body.baseModifiedTime !== undefined &&
      body.baseModifiedTime !== null &&
      typeof body.baseModifiedTime !== "string") ||
    totpChange === false ||
    // Two-factor is set on an existing vault only.
    (totpChange !== undefined && typeof body.fileId !== "string")
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
    // Create is exclusive: the app reads the newest vault file, so a second
    // one would silently shadow the existing vault — and its 2FA gate.
    if (typeof body.fileId !== "string" && (await store.findVaultFile())) {
      return Response.json({ error: "vault_exists" }, { status: 409 });
    }
    // An update carries the stored totp block forward, so it must read (and
    // verify) the current file: an unverifiable one can't say whether 2FA
    // is on, and is refused rather than overwritten.
    let totp: VaultTotpBlock | undefined;
    let cookies: string[] = [];
    if (typeof body.fileId === "string") {
      const opened = await openStoredVault(
        body.fileId,
        await store.downloadVault(body.fileId),
      );
      if (opened === null) return signatureInvalid();
      const passed = sessionGate(req, body.fileId, opened.totp);
      if (!passed.ok) return passed.response;
      totp = opened.totp;
      cookies = passed.cookies;
    }
    if (totpChange === null) {
      totp = undefined;
      cookies = clearGrantCookies(req);
    } else if (totpChange && typeof body.fileId === "string") {
      const next = { secret: totpChange.secret };
      const check = await verifyTotpCode(body.fileId, next, totpChange.code);
      if (check !== "ok") return totpFailure(check);
      totp = next;
    }
    const stored = await serializeStoredVault(body.contents, totp);
    const meta =
      typeof body.fileId === "string"
        ? await store.updateVault(body.fileId, stored)
        : await store.createVault(stored);
    if (totp && totpChange) cookies = [grantCookie(req, meta.id, totp)];
    return withCookies(
      Response.json({
        fileId: meta.id,
        modifiedTime: meta.modifiedTime,
        ...(totp ? { totpEnabled: true } : {}),
      }),
      cookies,
    );
  } catch (e) {
    if (e instanceof StoreError && e.status === 404) {
      // fileId no longer exists — client should re-list and re-create.
      return Response.json({ error: "file_gone" }, { status: 404 });
    }
    return driveError(e);
  }
}
