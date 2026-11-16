"use client";

import { signIn, signOut } from "next-auth/react";

import { DEMO_PROVIDER_ID } from "@/lib/demo-mode";
import { clearTotpGrant } from "@/lib/vault-remote";

// Drops the vault's two-factor grant first, so the next sign-in (even to the
// same account) must enter a fresh code.
export async function signOutAndClearGrant(): Promise<void> {
  await clearTotpGrant();
  await signOut();
}

export function SignInButton({ demo = false }: { demo?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => signIn(demo ? DEMO_PROVIDER_ID : "google")}
      className="w-full rounded-full bg-primary px-4 py-2.5 font-medium text-on-primary transition hover:bg-primary/90"
    >
      Sign in with Google
    </button>
  );
}

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOutAndClearGrant()}
      className="rounded-full border border-outline px-5 py-2 text-sm font-medium text-primary transition hover:bg-primary/8"
    >
      Sign out
    </button>
  );
}
