import { describe, expect, it } from "vitest";

import { MEMORY_FOLDER_ID, type MemoryFile, MemoryStoreProvider } from "./memory-store-provider";
import { runStoreContract } from "../store-contract";
import type { StoreInterface } from "../store-interface";

describe("MemoryStoreProvider contract", () => {
  runStoreContract(() => new MemoryStoreProvider(new Map<string, MemoryFile>()));
});

describe("MemoryStoreProvider", () => {
  it("shares state across instances by default (one per request)", async () => {
    const created = await new MemoryStoreProvider().createVault("shared");
    expect(await new MemoryStoreProvider().downloadVault(created.id)).toBe("shared");
  });

  it("uses a synthetic folder and no-op moves", async () => {
    const store: StoreInterface = new MemoryStoreProvider(new Map());
    expect(await store.findOrCreateVaultFolder()).toBe(MEMORY_FOLDER_ID);
    const created = await store.createVault("C");
    await store.moveToFolder(created.id, ["elsewhere"], "other-folder");
    expect((await store.findVaultFile())?.parents).toEqual([MEMORY_FOLDER_ID]);
  });
});
