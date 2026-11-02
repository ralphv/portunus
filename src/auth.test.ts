// Smoke test for getAccessToken against a real Auth.js session cookie (JWE
// encoded with next-auth/jwt), so the cookie name, salt and refresh path are
// exercised as in production.
import { encode } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetTokenRefreshCache } from "@/lib/google-token-refresh";

import { getAccessToken } from "./auth";

const SECRET = "test-auth-secret-at-least-32-characters-long";
const COOKIE = "authjs.session-token";
const now = () => Math.floor(Date.now() / 1000);

let fail = false;
const tokenEndpoint = vi.fn(async () =>
  fail
    ? Response.json({ error: "invalid_grant" }, { status: 400 })
    : Response.json({ access_token: "fresh-access", expires_in: 3600 }),
);

async function requestWith(token: Record<string, unknown> | null): Promise<NextRequest> {
  const headers: Record<string, string> = {};
  if (token) {
    const jwt = await encode({ token, secret: SECRET, salt: COOKIE });
    headers.cookie = `${COOKIE}=${jwt}`;
  }
  return new Request("http://localhost/api/vault", { headers }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("AUTH_URL", "http://localhost:3000");
  vi.stubEnv("PORTUNUS_DEMO_MODE", "");
  resetTokenRefreshCache();
  fail = false;
  tokenEndpoint.mockClear();
  vi.stubGlobal("fetch", tokenEndpoint);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getAccessToken", () => {
  it("returns the cookie's token while it is valid, without refreshing", async () => {
    const req = await requestWith({
      access_token: "cookie-access",
      refresh_token: "rt",
      expires_at: now() + 3600,
    });
    expect(await getAccessToken(req)).toEqual({ accessToken: "cookie-access" });
    expect(tokenEndpoint).not.toHaveBeenCalled();
  });

  it("refreshes an expired token once across concurrent requests", async () => {
    const token = { access_token: "stale", refresh_token: "rt", expires_at: now() - 10 };
    const reqs = await Promise.all([1, 2, 3].map(() => requestWith(token)));
    const results = await Promise.all(reqs.map(getAccessToken));
    for (const r of results) expect(r).toEqual({ accessToken: "fresh-access" });
    expect(tokenEndpoint).toHaveBeenCalledTimes(1);
    // A later request still carrying the stale cookie reuses the refresh.
    expect(await getAccessToken(await requestWith(token))).toEqual({
      accessToken: "fresh-access",
    });
    expect(tokenEndpoint).toHaveBeenCalledTimes(1);
  });

  it("reports a failed refresh instead of returning the expired token", async () => {
    fail = true;
    const req = await requestWith({
      access_token: "stale",
      refresh_token: "rt",
      expires_at: now() - 10,
    });
    expect(await getAccessToken(req)).toEqual({ error: "RefreshAccessTokenError" });
  });

  it("rejects a request without a session cookie", async () => {
    expect(await getAccessToken(await requestWith(null))).toEqual({
      error: "NoAccessToken",
    });
  });
});
