"use client";

import { useCallback, useEffect, useState } from "react";

import type { Keyfile } from "@/crypto/keyfile";
import { loadInstalledKeyfile } from "@/crypto/keyfile";
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
}: {
  email: string | null;
  sessionError: string | null;
  hibpOnEdit: boolean;
}) {
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
        const remote = await fetchRemoteVault();
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
  }, []);

  const handleOpen = useCallback((s: UnlockedVault, kf: Keyfile) => {
    setSession(s);
    setKeyfile(kf);
    // The create/unlock flow may have just installed the keyfile; refresh the
    // flag from localStorage so the menu knows "Remove key" is available.
    loadInstalledKeyfile()
      .then((installed) => setKeyfileInstalled(installed !== null))
      .catch(() => {});
    setError(null);
    setStage("open");
  }, []);

  const handleLock = useCallback(() => {
    session?.client.lock();
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
          onKeyfile={(kf, installed) => {
            setKeyfile(kf);
            setKeyfileInstalled(installed);
          }}
          onOpen={handleOpen}
          onNoVault={() => setStage("create")}
        />
      )}
      {stage === "create" && <VaultCreate onOpen={handleOpen} />}
      {stage === "open" && session && (
        <VaultOpen
          session={session.client}
          initialData={session.data}
          email={email}
          offline={session.client.offline}
          hibpOnEdit={hibpOnEdit}
          keyfileKid={keyfile?.kid ?? null}
          keyfileInstalled={keyfileInstalled}
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
