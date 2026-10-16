import { Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@/auth";
import { SignInButton, SignOutButton } from "@/components/auth-buttons";
import { PortunusEmblem } from "@/components/portunus-emblem";
import { VaultApp } from "@/components/vault-app";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-10">
      <div className="mb-8 flex flex-col items-center">
        <PortunusEmblem />
        <h1 className="mt-4 text-3xl font-semibold tracking-wide text-bronze">
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
      <p className="mt-8 text-xs text-slate-600">
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
        <SignInButton />
        <p className="mt-3 text-xs text-slate-500">
          Grants access to the vault file in your Google Drive.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-300">
          Signed in as{" "}
          <span className="font-medium text-slate-100">
            {session.user?.email}
          </span>
        </p>
        <SignOutButton />
      </div>
      {session.error && (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Session error: {session.error}. Sign in again.
        </p>
      )}
      <VaultApp />
    </div>
  );
}
