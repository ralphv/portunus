"use client";

import { useCallback, useEffect, useState } from "react";

import type { Keyfile } from "@/crypto";
import { loadInstalledKeyfile } from "@/crypto";
import {
  fetchRemoteVault,
  VaultRemoteError,
  VaultSession,
} from "@/lib/vault-session";
import { VaultCreate } from "./vault-create";
import { VaultOpen } from "./vault-open";
import { VaultUnlock } from "./vault-unlock";

type Stage = "loading" | "unlock" | "create" | "open";

export function VaultApp() {
  const [stage, setStage] = useState<Stage>("loading");
  const [keyfile, setKeyfile] = useState<Keyfile | null>(null);
  const [keyfileInstalled, setKeyfileInstalled] = useState(false);
  const [session, setSession] = useState<VaultSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [installed, remote] = await Promise.all([
          loadInstalledKeyfile().catch(() => null),
          fetchRemoteVault(),
        ]);
        if (cancelled) return;
        setKeyfile(installed);
        setKeyfileInstalled(installed !== null);
        setStage(remote ? "unlock" : "create");
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof VaultRemoteError && e.status === 401
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

  const handleOpen = useCallback((s: VaultSession, kf: Keyfile) => {
    setSession(s);
    setKeyfile(kf);
    setError(null);
    setStage("open");
  }, []);

  const handleLock = useCallback(() => {
    session?.lock();
    setSession(null);
    setStage("unlock");
  }, [session]);

  if (stage === "loading") {
    return (
      <p className="py-16 text-center text-sm text-slate-500">
        Checking your vault…
      </p>
    );
  }

  return (
    <div className="w-full">
      {error && (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {stage === "unlock" && (
        <VaultUnlock
          keyfile={keyfile}
          keyfileInstalled={keyfileInstalled}
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
        <VaultOpen session={session} onLock={handleLock} />
      )}
    </div>
  );
}
