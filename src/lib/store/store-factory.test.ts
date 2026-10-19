import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  auth: vi.fn(),
  getAccessToken: vi.fn(),
}));
vi.mock("@/auth", () => authMock);

import { GoogleDriveStore } from "./google-drive-store";
import { MemoryStore } from "./memory-store";
import { getStore } from "./store-factory";

const req = {} as NextRequest;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("getStore", () => {
  it("returns a GoogleDriveStore for a signed-in user", async () => {
    authMock.auth.mockResolvedValue({ user: { email: "a@b.c" } });
    authMock.getAccessToken.mockResolvedValue({ accessToken: "tok" });
    const res = await getStore(req);
    expect("store" in res && res.store).toBeInstanceOf(GoogleDriveStore);
  });

  it("rejects requests without a session", async () => {
    authMock.auth.mockResolvedValue(null);
    expect(await getStore(req)).toEqual({ error: "unauthorized" });
  });

  it("surfaces session and token errors", async () => {
    authMock.auth.mockResolvedValue({ error: "RefreshAccessTokenError" });
    expect(await getStore(req)).toEqual({ error: "RefreshAccessTokenError" });
    authMock.auth.mockResolvedValue({ user: {} });
    authMock.getAccessToken.mockResolvedValue({ error: "NoAccessToken" });
    expect(await getStore(req)).toEqual({ error: "NoAccessToken" });
  });

  it("returns a MemoryStore in demo mode without checking the session", async () => {
    vi.stubEnv("PORTUNUS_DEMO_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    const res = await getStore(req);
    expect("store" in res && res.store).toBeInstanceOf(MemoryStore);
    expect(authMock.auth).not.toHaveBeenCalled();
  });

  it("ignores demo mode in production", async () => {
    vi.stubEnv("PORTUNUS_DEMO_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    authMock.auth.mockResolvedValue(null);
    expect(await getStore(req)).toEqual({ error: "unauthorized" });
  });
});
