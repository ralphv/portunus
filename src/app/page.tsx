import { Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@/auth";
import { SignInButton, SignOutButton } from "@/components/auth-buttons";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-md rounded-xl border border-bronze/30 bg-navy-800/60 p-10 text-center shadow-2xl shadow-black/40 backdrop-blur">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-bronze/50 text-3xl text-bronze">
          ⚿
        </div>
        <h1 className="text-3xl font-semibold tracking-wide text-bronze">
          Portunus
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Keeper of keys. Your secrets, encrypted in your own Drive.
        </p>
        <Suspense
          fallback={<p className="mt-8 text-sm text-slate-500">…</p>}
        >
          <AuthSection />
        </Suspense>
      </div>
      <p className="mt-6 text-xs text-slate-600">
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
      <div className="mt-8">
        <SignInButton />
        <p className="mt-3 text-xs text-slate-500">
          Grants access to the vault file in your Google Drive.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-4">
      {session.error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          Session error: {session.error}. Sign in again.
        </p>
      )}
      <p className="text-sm text-slate-300">
        Signed in as{" "}
        <span className="font-medium text-slate-100">
          {session.user?.email}
        </span>
      </p>
      <p className="text-sm text-slate-500">
        The vault unlock screen arrives in Phase 2.
      </p>
      <SignOutButton />
    </div>
  );
}
