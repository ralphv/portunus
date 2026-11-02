// Server-only: refreshes the Google OAuth access token held in the Auth.js JWT.
//
// Both the jwt callback (run by every no-arg `auth()` call) and
// getAccessToken refresh an expired token, and neither can write the new
// one back to the session cookie (`auth()` drops its Set-Cookie in route
// handlers and server components). Uncached, every request after expiry
// hit Google's token endpoint twice. Results are therefore kept per
// refresh token until they near expiry, and concurrent callers share one
// in-flight request. Failures are not kept — the next request retries.

import { LRUCache } from "lru-cache";

import { OAUTH_TOKEN_URL } from "@/constants";

export type RefreshableToken = {
  refresh_token?: string;
  [key: string]: unknown;
};

type Refreshed = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
};

// A cached token this close to expiry counts as expired — the same early
// margin getAccessToken applies to the cookie's token.
export const REFRESH_EXPIRY_MARGIN_MS = 30_000;

const refreshes = new LRUCache<string, Promise<Refreshed | null>>({ max: 1_000 });

export function resetTokenRefreshCache(): void {
  refreshes.clear();
}

async function requestRefresh(refreshToken: string): Promise<Refreshed | null> {
  try {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH_GOOGLE_ID!,
        client_secret: process.env.AUTH_GOOGLE_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const refreshed = await response.json();
    if (!response.ok || typeof refreshed.access_token !== "string") return null;
    return {
      access_token: refreshed.access_token,
      // Google may rotate the refresh token; keep the old one otherwise.
      refresh_token: refreshed.refresh_token ?? refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + (refreshed.expires_in as number),
    };
  } catch {
    return null;
  }
}

const isFresh = (r: Refreshed) =>
  Date.now() < r.expires_at * 1000 - REFRESH_EXPIRY_MARGIN_MS;

export async function refreshAccessToken<T extends RefreshableToken>(token: T) {
  const refreshToken = token.refresh_token;
  if (!refreshToken) {
    return { ...token, error: "MissingRefreshToken" };
  }
  const merge = (r: Refreshed) => ({ ...token, ...r, error: undefined });

  for (;;) {
    const cached = refreshes.get(refreshToken);
    if (!cached) break;
    const result = await cached;
    // A refresh that just failed is shared with everyone who waited on it.
    if (!result) return { ...token, error: "RefreshAccessTokenError" };
    if (isFresh(result)) return merge(result);
    // Expired: drop it — unless a concurrent caller already replaced it.
    if (refreshes.get(refreshToken) === cached) {
      refreshes.delete(refreshToken);
      break;
    }
  }

  const pending = requestRefresh(refreshToken);
  refreshes.set(refreshToken, pending);
  const result = await pending;
  if (!result) {
    if (refreshes.get(refreshToken) === pending) refreshes.delete(refreshToken);
    return { ...token, error: "RefreshAccessTokenError" };
  }
  return merge(result);
}
