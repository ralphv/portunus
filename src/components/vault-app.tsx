"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Keyfile } from "@/crypto/keyfile";
import { loadInstalledKeyfile } from "@/crypto/keyfile";
// Not from @/factory: that barrel also re-exports the server-side store and
// schema-validator factories, which would pull Zod (it probes Function(),
// refused by the strict CSP) and the Drive client into the browser bundle.
import { createBiometricFactory } from "@/lib/biometric/factory";
import type { BiometricConfig } from "@/lib/biometric/biometric-env";
import { purgeDeviceUnlocks } from "@/lib/biometric/device-unlock-store";
import type { UnlockedVault } from "@/lib/vault-client";
import {
  fetchRemoteVault,
  isTotpRequired,
  isVaultSignatureInvalid,
  VAULT_SIGNATURE_INVALID_MESSAGE,
  VaultRemoteError,
} from "@/lib/vault-remote";
import { SignOutButton } from "./auth-buttons";
import { VaultCreate } from "./vault-create";
import { VaultOpen } from "./vault-open";
import { VaultUnlock } from "./vault-unlock";

type Stage = "loading" | "unlock" | "create" | "open";

export function VaultApp({
  email,
  sessionError,
  hibpOnEdit,
  offlineCache,
  biometric,
}: {
  email: string | null;
  sessionError: string | null;
  hibpOnEdit: boolean;
  // DISABLE_OFFLINE_MODE, resolved on the server (see vault-remote.ts).
  offlineCache: boolean;
  // PORTUNUS_BIOMETRIC_UNLOCK / PORTUNUS_BIOMETRIC_SAVE_CONFIRM, resolved on
  // the server (src/lib/biometric/biometric-env.ts).
  biometric: BiometricConfig;
}) {
  const cachePolicy = useMemo(() => ({ offlineCache }), [offlineCache]);
  const biometricProvider = useMemo(
    () => createBiometricFactory(biometric.unlock),
    [biometric.unlock],
  );
  // Turned off by the operator: records left from when it was on go too.
  useEffect(() => {
    if (!biometric.unlock) purgeDeviceUnlocks();
  }, [biometric.unlock]);
  const [stage, setStage] = useState<Stage>("loading");
  const [keyfile, setKeyfile] = useState<Keyfile | null>(null);
  const [keyfileInstalled, setKeyfileInstalled] = useState(false);
  const [session, setSession] = useState<UnlockedVault | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totpRequired, setTotpRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const installedP = loadInstalledKeyfile().catch(() => null);
      const applyKeyfile = async () => {
        const installed = await installedP;
        if (cancelled) return false;
        setKeyfile(installed);
        setKeyfileInstalled(installed !== null);
        return true;
      };
      try {
        const remote = await fetchRemoteVault(cachePolicy);
        if (!(await applyKeyfile())) return;
        setStage(remote ? "unlock" : "create");
      } catch (e) {
        if (!(await applyKeyfile())) return;
        if (isTotpRequired(e)) {
          setTotpRequired(true);
          setStage("unlock");
          return;
        }
        setError(
          isVaultSignatureInvalid(e)
            ? VAULT_SIGNATURE_INVALID_MESSAGE
            : e instanceof VaultRemoteError && e.status === 401
              ? "Session expired — sign out and sign in again."
              : "Could not reach Google Drive. Check your connection and reload.",
        );
        setStage("unlock");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cachePolicy]);

  const handleOpen = useCallback((s: UnlockedVault, kf: Keyfile) => {
    setSession(s);
    setKeyfile(kf);
    // The create/unlock flow may have just installed the keyfile; refresh the
    // flag from localStorage so the menu knows "Remove key" is available.
    loadInstalledKeyfile()
      .then((installed) => setKeyfileInstalled(installed !== null))
      .catch(() => {});
    setError(null);
    // The initial-fetch 2FA hint is stale once open: 2FA may be disabled
    // before the next lock, and the unlock screen re-learns it from the server.
    setTotpRequired(false);
    setStage("open");
  }, []);

  const handleLock = useCallback(() => {
    session?.client.lock();
    // Every unlock of a two-factor vault needs a fresh code; ask up front.
    setTotpRequired(session?.client.totpEnabled ?? false);
    setSession(null);
    setStage("unlock");
  }, [session]);

  return (
    <div className="w-full">
      {/* When unlocked, the account line and sign out live in VaultOpen's menu. */}
      {stage !== "open" && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-300">
            Signed in as{" "}
            <span className="font-medium text-slate-100">{email}</span>
          </p>
          <SignOutButton />
        </div>
      )}
      {sessionError && (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Session error: {sessionError}. Sign in again.
        </p>
      )}
      {stage === "loading" && (
        <p className="py-16 text-center text-sm text-slate-500">
          Checking your vault…
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {stage === "unlock" && (
        <VaultUnlock
          keyfile={keyfile}
          keyfileInstalled={keyfileInstalled}
          totpRequired={totpRequired}
          cachePolicy={cachePolicy}
          biometric={biometricProvider}
          onKeyfile={(kf, installed) => {
            setKeyfile(kf);
            setKeyfileInstalled(installed);
          }}
          onOpen={handleOpen}
          onNoVault={() => setStage("create")}
        />
      )}
      {stage === "create" && <VaultCreate cachePolicy={cachePolicy} onOpen={handleOpen} />}
      {stage === "open" && session && (
        <VaultOpen
          session={session.client}
          initialData={session.data}
          email={email}
          offline={session.client.offline}
          hibpOnEdit={hibpOnEdit}
          keyfileKid={keyfile?.kid ?? null}
          keyfileInstalled={keyfileInstalled}
          biometric={biometricProvider}
          biometricSaveConfirm={biometric.saveConfirm}
          onRemoveKeyfile={() => {
            setKeyfile(null);
            setKeyfileInstalled(false);
          }}
          onLock={handleLock}
        />
      )}
    </div>
  );
}
