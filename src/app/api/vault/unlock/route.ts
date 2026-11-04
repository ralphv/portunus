import type { NextRequest } from "next/server";
import { API_ERROR_BAD_REQUEST } from "@/constants";
import { createSchemaValidatorFactory } from "@/factory";
import { vaultUnlockBodySchema } from "@/lib/schemas/vault-unlock-body.schema";
import { getStore } from "@/lib/store/get-store";
import { openStoredVault } from "@/lib/signing";
import { driveError, signatureInvalid } from "@/lib/vault-server";
import {
  clearGrantCookies,
  deliveryCookie,
  grantCookie,
  totpFailure,
  verifyTotpCode,
} from "@/lib/vault-totp";

const validator = createSchemaValidatorFactory();

// Two-factor step for /api/vault. Body: { code: "123456", deliver?: false }
// (src/lib/schemas/vault-unlock-body.schema.ts).
// A valid code for the stored vault's totp block sets the session grant PUT
// /api/vault requires plus, unless `deliver` is false (a save-time re-prompt),
// the single-use delivery grant GET /api/vault consumes. A vault without 2FA
// answers { totpEnabled: false }.
export async function POST(req: NextRequest) {
  const gate = await getStore(req);
  if ("error" in gate) {
    return Response.json({ error: gate.error }, { status: 401 });
  }
  const { store } = gate;

  const checked = validator.checkJson(vaultUnlockBodySchema, await req.text());
  if (!checked.ok) {
    return Response.json({ error: API_ERROR_BAD_REQUEST }, { status: 400 });
  }
  const { code, deliver } = checked.value;

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
    if (deliver !== false) {
      res.headers.append("Set-Cookie", deliveryCookie(req, file.id, opened.totp));
    }
    return res;
  } catch (e) {
    return driveError(e);
  }
}

// Drops both grants (on lock / sign-out).
export async function DELETE(req: NextRequest) {
  const res = new Response(null, { status: 204 });
  for (const c of clearGrantCookies(req)) res.headers.append("Set-Cookie", c);
  return res;
}
