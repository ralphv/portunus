import { Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@/auth";
import { isDemoMode } from "@/lib/demo-mode";
import { SignInButton } from "@/components/auth-buttons";
import { PortunusEmblem } from "@/components/portunus-emblem";
import { VaultApp } from "@/components/vault-app";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-6 sm:py-10">
      <div className="mb-6 flex flex-col items-center sm:mb-8">
        <PortunusEmblem />
        <h1 className="mt-3 text-3xl font-semibold tracking-wide text-bronze sm:mt-4">
          Portunus
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Keeper of keys. Your secrets, encrypted in your own Drive.
        </p>
      </div>
      <Suspense
        fallback={<p className="mt-8 text-sm text-slate-500">…</p>}
      >
        <AuthSection />
      </Suspense>
      <p className="mt-6 text-xs text-slate-600 sm:mt-8">
        Zero-knowledge · your password never leaves this device
      </p>
    </main>
  );
}

async function AuthSection() {
  await connection();
  const session = await auth();

  if (!session) {
    return (
      <div className="w-full max-w-md rounded-xl border border-bronze/30 bg-navy-800/60 p-10 text-center shadow-2xl shadow-black/40 backdrop-blur">
        <SignInButton demo={isDemoMode()} />
        <p className="mt-3 text-xs text-slate-500">
          Grants access to the vault file in your Google Drive.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl">
      <VaultApp
        email={session.user?.email ?? null}
        sessionError={session.error ?? null}
        hibpOnEdit={process.env.PORTUNUS_HIBP_ON_EDIT !== "0"}
      />
    </div>
  );
}
