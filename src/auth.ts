import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

import { DRIVE_SCOPE } from "@/constants";
import { DEMO_AUTH_SECRET, DEMO_EMAIL, DEMO_PROVIDER_ID, isDemoMode } from "@/lib/demo-mode";
import { refreshAccessToken } from "@/lib/google-token-refresh";

const GOOGLE_SCOPE = `openid email profile ${DRIVE_SCOPE}`;

// Demo mode: a one-click credentials provider issues a stubbed session — no
// Google OAuth, no tokens. The vault API serves an in-memory store instead.
const demoConfig: NextAuthConfig = {
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? DEMO_AUTH_SECRET,
  providers: [
    Credentials({
      id: DEMO_PROVIDER_ID,
      name: "Demo",
      credentials: {},
      // Vault isolation is handled by the visitor cookie (middleware), not
      // the session id — a static id keeps sign-in/sign-out transparent.
      authorize: () => ({ id: "demo", name: "Demo User", email: DEMO_EMAIL }),
    }),
  ],
  session: { strategy: "jwt" },
};

const googleConfig: NextAuthConfig = {
  // Trust the forwarded Host header — required behind a reverse proxy
  // (Caddy/nginx/Traefik) where requests arrive with the public hostname.
  trustHost: true,
  providers: [
    Google({
      authorization: {
        params: {
          scope: GOOGLE_SCOPE,
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      // First sign-in: persist the OAuth tokens in the JWT
      if (account) {
        return {
          ...token,
          access_token: account.access_token,
          refresh_token: account.refresh_token ?? token.refresh_token,
          expires_at: account.expires_at,
          error: undefined,
        };
      }
      // Token still valid
      if (typeof token.expires_at === "number" && Date.now() < token.expires_at * 1000) {
        return token;
      }
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.error = token.error;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(
  isDemoMode() ? demoConfig : googleConfig,
);

// Server-side access token for API routes. Reads the JWT cookie directly via
// getToken so access_token stays server-only (never enters the client session).
// getToken returns the stored JWT — the jwt callback's refresh does not apply
// mid-request — so we refresh here when the token is expired/near expiry.
// The refresh is shared with the jwt callback (see google-token-refresh.ts).
export async function getAccessToken(
  req: NextRequest,
): Promise<{ accessToken: string } | { error: string }> {
  const secureCookie = process.env.AUTH_URL?.startsWith("https://") ?? false;
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie,
    salt: secureCookie
      ? "__Secure-authjs.session-token"
      : "authjs.session-token",
  });
  if (!token || typeof token.access_token !== "string") {
    return { error: "NoAccessToken" };
  }
  if (
    typeof token.expires_at === "number" &&
    Date.now() < token.expires_at * 1000 - 30_000
  ) {
    return { accessToken: token.access_token };
  }
  const refreshed = await refreshAccessToken(token);
  // A failed refresh still carries the old, expired access_token — check
  // the error first or that dead token would be handed to Drive.
  if (refreshed.error || typeof refreshed.access_token !== "string") {
    return { error: String(refreshed.error ?? "RefreshAccessTokenError") };
  }
  return { accessToken: refreshed.access_token };
}
