import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OAUTH_TOKEN_URL } from "@/constants";

import {
  REFRESH_EXPIRY_MARGIN_MS,
  refreshAccessToken,
  resetTokenRefreshCache,
} from "./google-token-refresh";

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
let issued = 0;
let fail = false;
let rotate = false;
const tokenEndpoint = vi.fn<typeof fetch>(async () => {
  if (fail) return Response.json({ error: "invalid_grant" }, { status: 400 });
  issued++;
  return Response.json({
    access_token: `access-${issued}`,
    expires_in: 3600,
    ...(rotate ? { refresh_token: `rotated-${issued}` } : {}),
  });
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  resetTokenRefreshCache();
  issued = 0;
  fail = false;
  rotate = false;
  tokenEndpoint.mockClear();
  vi.stubGlobal("fetch", tokenEndpoint);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const expired = { refresh_token: "rt-1", access_token: "stale", sub: "user" };

describe("refreshAccessToken", () => {
  it("posts a refresh_token grant to Google's token endpoint", async () => {
    const out = await refreshAccessToken(expired);
    expect(tokenEndpoint).toHaveBeenCalledTimes(1);
    const [url, init] = tokenEndpoint.mock.calls[0];
    expect(url).toBe(OAUTH_TOKEN_URL);
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-1");
    expect(out).toMatchObject({
      sub: "user",
      access_token: "access-1",
      refresh_token: "rt-1",
      expires_at: T0 / 1000 + 3600,
      error: undefined,
    });
  });

  it("shares one in-flight refresh between concurrent callers", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => refreshAccessToken(expired)),
    );
    expect(tokenEndpoint).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r.access_token))).toEqual(new Set(["access-1"]));
  });

  it("reuses the refreshed token on later requests until it nears expiry", async () => {
    await refreshAccessToken(expired);
    vi.setSystemTime(T0 + 3600_000 - REFRESH_EXPIRY_MARGIN_MS - 1);
    expect((await refreshAccessToken(expired)).access_token).toBe("access-1");
    expect(tokenEndpoint).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + 3600_000 - REFRESH_EXPIRY_MARGIN_MS);
    expect((await refreshAccessToken(expired)).access_token).toBe("access-2");
    expect(tokenEndpoint).toHaveBeenCalledTimes(2);
  });

  it("keeps a rotated refresh token", async () => {
    rotate = true;
    expect((await refreshAccessToken(expired)).refresh_token).toBe("rotated-1");
  });

  it("reports a failure once per attempt and retries on the next request", async () => {
    fail = true;
    const results = await Promise.all([
      refreshAccessToken(expired),
      refreshAccessToken(expired),
    ]);
    expect(tokenEndpoint).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r.error).toBe("RefreshAccessTokenError");

    fail = false;
    expect((await refreshAccessToken(expired)).access_token).toBe("access-1");
    expect(tokenEndpoint).toHaveBeenCalledTimes(2);
  });

  it("treats a network error as a failed refresh", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    expect((await refreshAccessToken(expired)).error).toBe("RefreshAccessTokenError");
  });

  it("treats a response that fails its schema as a failed refresh, logging no token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No expires_in: before the schema this became an expiry of NaN.
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "leaky-token" })));
    expect((await refreshAccessToken(expired)).error).toBe("RefreshAccessTokenError");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>leaky-token</html>")));
    expect((await refreshAccessToken(expired)).error).toBe("RefreshAccessTokenError");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("leaky-token");
    warn.mockRestore();
  });

  it("needs no request without a refresh token", async () => {
    expect((await refreshAccessToken({ access_token: "stale" })).error).toBe(
      "MissingRefreshToken",
    );
    expect(tokenEndpoint).not.toHaveBeenCalled();
  });

  it("keeps separate users' refreshes apart", async () => {
    const a = await refreshAccessToken(expired);
    const b = await refreshAccessToken({ ...expired, refresh_token: "rt-2" });
    expect(a.access_token).not.toBe(b.access_token);
    expect(tokenEndpoint).toHaveBeenCalledTimes(2);
  });
});
