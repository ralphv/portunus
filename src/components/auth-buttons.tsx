"use client";

import { signIn, signOut } from "next-auth/react";

import { DEMO_PROVIDER_ID } from "@/lib/demo-mode";

export function SignInButton({ demo = false }: { demo?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => signIn(demo ? DEMO_PROVIDER_ID : "google")}
      className="w-full rounded-lg bg-bronze px-4 py-2.5 font-medium text-navy-900 transition hover:bg-bronze-light"
    >
      Sign in with Google
    </button>
  );
}

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut()}
      className="w-full rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-400 hover:text-slate-100"
    >
      Sign out
    </button>
  );
}
