import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  auth: vi.fn(),
  getAccessToken: vi.fn(),
}));
vi.mock("@/auth", () => authMock);

import { GoogleDriveStoreProvider } from "./google-drive-store-provider";
import { MemoryStoreProvider } from "./memory-store-provider";
import { createStoreFactory, getStore } from "./factory";

const req = {} as NextRequest;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("createStoreFactory", () => {
  it("returns the same instance until newInstance is passed", async () => {
    const a = createStoreFactory();
    expect(createStoreFactory()).toBe(a);
    const b = createStoreFactory("", true);
    expect(b).not.toBe(a);
    expect(createStoreFactory()).toBe(a);
  });

  it("caches per access token", () => {
    const a = createStoreFactory("tok-a");
    const b = createStoreFactory("tok-b");
    expect(b).not.toBe(a);
    expect(createStoreFactory("tok-a")).toBe(a);
    expect(a).toBeInstanceOf(GoogleDriveStoreProvider);
  });
});

describe("getStore", () => {
  it("returns a GoogleDriveStoreProvider for a signed-in user", async () => {
    authMock.auth.mockResolvedValue({ user: { email: "a@b.c" } });
    authMock.getAccessToken.mockResolvedValue({ accessToken: "tok" });
    const res = await getStore(req);
    expect("store" in res && res.store).toBeInstanceOf(GoogleDriveStoreProvider);
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

  it("returns a MemoryStoreProvider in demo mode without checking the session", async () => {
    vi.stubEnv("PORTUNUS_DEMO_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    const res = await getStore(req);
    expect("store" in res && res.store).toBeInstanceOf(MemoryStoreProvider);
    expect(authMock.auth).not.toHaveBeenCalled();
  });

  it("ignores demo mode in production", async () => {
    vi.stubEnv("PORTUNUS_DEMO_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    authMock.auth.mockResolvedValue(null);
    expect(await getStore(req)).toEqual({ error: "unauthorized" });
  });
});
