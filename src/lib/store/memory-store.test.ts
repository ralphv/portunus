import { describe, expect, it } from "vitest";

import { MEMORY_FOLDER_ID, type MemoryFile, MemoryStore } from "./memory-store";
import { runStoreContract } from "./store-contract";
import type { StoreInterface } from "./store-interface";

describe("MemoryStore contract", () => {
  runStoreContract(() => new MemoryStore(new Map<string, MemoryFile>()));
});

describe("MemoryStore", () => {
  it("shares state across instances by default (one per request)", async () => {
    const created = await new MemoryStore().createVault("shared");
    expect(await new MemoryStore().downloadVault(created.id)).toBe("shared");
  });

  it("uses a synthetic folder and no-op moves", async () => {
    const store: StoreInterface = new MemoryStore(new Map());
    expect(await store.findOrCreateVaultFolder()).toBe(MEMORY_FOLDER_ID);
    const created = await store.createVault("C");
    await store.moveToFolder(created.id, ["elsewhere"], "other-folder");
    expect((await store.findVaultFile())?.parents).toEqual([MEMORY_FOLDER_ID]);
  });
});
