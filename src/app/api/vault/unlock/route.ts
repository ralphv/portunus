import type { NextRequest } from "next/server";
import { getStore } from "@/factory";
import { openStoredVault } from "@/lib/signing";
import { driveError, signatureInvalid } from "@/lib/vault-server";
import {
  clearGrantCookie,
  grantCookie,
  totpFailure,
  verifyTotpCode,
} from "@/lib/vault-totp";

// Two-factor step for /api/vault. Body: { code: "123456" }. A valid code for
// the stored vault's totp block sets the grant cookie that GET/PUT
// /api/vault require; a vault without 2FA answers { totpEnabled: false }.
export async function POST(req: NextRequest) {
  const gate = await getStore(req);
  if ("error" in gate) {
    return Response.json({ error: gate.error }, { status: 401 });
  }
  const { store } = gate;

  let code: unknown;
  try {
    ({ code } = (await req.json()) as { code?: unknown });
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (typeof code !== "string" || code.length > 32) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const file = await store.findVaultFile();
    if (!file) {
      return Response.json({ error: "vault_not_found" }, { status: 404 });
    }
    const opened = await openStoredVault(
      file.id,
      await store.downloadVault(file.id),
    );
    if (opened === null) return signatureInvalid();
    if (!opened.totp) return Response.json({ totpEnabled: false });
    const check = await verifyTotpCode(file.id, opened.totp, code);
    if (check !== "ok") return totpFailure(check);
    const res = Response.json({ totpEnabled: true });
    res.headers.append("Set-Cookie", grantCookie(req, file.id, opened.totp));
    return res;
  } catch (e) {
    return driveError(e);
  }
}

// Drops the grant (on lock), so the next unlock asks for a code again.
export async function DELETE(req: NextRequest) {
  const res = new Response(null, { status: 204 });
  res.headers.append("Set-Cookie", clearGrantCookie(req));
  return res;
}
