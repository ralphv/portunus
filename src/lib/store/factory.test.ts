import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleDriveStoreProvider } from "./providers/google-drive-store-provider";
import { createStoreFactory } from "@/factory";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createStoreFactory", () => {
  it("returns a fresh GoogleDriveStoreProvider per call", async () => {
    const a = createStoreFactory("tok-a");
    const b = createStoreFactory("tok-a");
    expect(a).toBeInstanceOf(GoogleDriveStoreProvider);
    expect(b).toBeInstanceOf(GoogleDriveStoreProvider);
    expect(b).not.toBe(a);
  });

  it("gives demo visitors isolated vaults cached by their visitor id", async () => {
    vi.stubEnv("PORTUNUS_DEMO_MODE", "1");
    const mine = createStoreFactory("visitor-1");
    const theirs = createStoreFactory("visitor-2");
    expect(theirs).not.toBe(mine);
    const created = await mine.createVault("private");
    expect(await createStoreFactory("visitor-1").downloadVault(created.id)).toBe(
      "private",
    );
    await expect(theirs.findVaultFile()).resolves.toBeNull();
  });
});
