// Shared behavioral contract every StoreInterface implementation must meet.
// Imported by each implementation's *.test.ts.

import { beforeEach, describe, expect, it } from "vitest";

import type { StoreInterface } from "./store-interface";

export function runStoreContract(makeStore: () => StoreInterface) {
  let store: StoreInterface;
  beforeEach(() => {
    store = makeStore();
  });
  const create = async (contents: string) =>
    store.createVault(await store.reserveVaultFileId(), contents);

  describe("StoreInterface contract", () => {
    it("starts with no vault", async () => {
      expect(await store.findVaultFile()).toBeNull();
    });

    it("creates a vault that can be found and downloaded", async () => {
      const created = await create("CIPHERTEXT-1");
      expect(created.id).toBeTruthy();
      expect(created.modifiedTime).toBeTruthy();
      const found = await store.findVaultFile();
      expect(found).toMatchObject({
        id: created.id,
        modifiedTime: created.modifiedTime,
      });
      expect(await store.downloadVault(created.id)).toBe("CIPHERTEXT-1");
    });

    it("creates the vault under the reserved id", async () => {
      const id = await store.reserveVaultFileId();
      expect(id).toBeTruthy();
      expect(await store.reserveVaultFileId()).not.toBe(id);
      const created = await store.createVault(id, "C");
      expect(created.id).toBe(id);
      expect(await store.downloadVault(id)).toBe("C");
    });

    it("refuses to create twice under the same id", async () => {
      const id = await store.reserveVaultFileId();
      await store.createVault(id, "first");
      await expect(store.createVault(id, "second")).rejects.toMatchObject({
        name: "StoreError",
      });
      expect(await store.downloadVault(id)).toBe("first");
    });

    it("places new vaults in the vault folder", async () => {
      const created = await create("C");
      const folderId = await store.findOrCreateVaultFolder();
      expect(await store.findOrCreateVaultFolder()).toBe(folderId);
      const found = await store.findVaultFile();
      expect(found?.id).toBe(created.id);
      expect(found?.parents ?? []).toContain(folderId);
    });

    it("updates contents and bumps modifiedTime on every write", async () => {
      const created = await create("v1");
      const u1 = await store.updateVault(created.id, "v2");
      const u2 = await store.updateVault(created.id, "v3");
      expect(u1.id).toBe(created.id);
      expect(u1.modifiedTime).not.toBe(created.modifiedTime);
      expect(u2.modifiedTime).not.toBe(u1.modifiedTime);
      expect(await store.downloadVault(created.id)).toBe("v3");
    });

    it("reports current modifiedTime for the conflict check", async () => {
      const created = await create("v1");
      expect(await store.getFileMeta(created.id)).toMatchObject({
        id: created.id,
        modifiedTime: created.modifiedTime,
      });
      // Another writer saves — a client holding the old base must see a mismatch.
      const other = await store.updateVault(created.id, "v2");
      const current = await store.getFileMeta(created.id);
      expect(current.modifiedTime).toBe(other.modifiedTime);
      expect(current.modifiedTime).not.toBe(created.modifiedTime);
    });

    it("returns the newest vault when several exist", async () => {
      await create("old");
      const newer = await create("new");
      expect((await store.findVaultFile())?.id).toBe(newer.id);
    });

    it("moveToFolder keeps the vault readable", async () => {
      const created = await create("C");
      const folderId = await store.findOrCreateVaultFolder();
      await store.moveToFolder(created.id, [], folderId);
      expect(await store.downloadVault(created.id)).toBe("C");
    });

    it.each([
      ["getFileMeta", (s: StoreInterface) => s.getFileMeta("missing")],
      ["downloadVault", (s: StoreInterface) => s.downloadVault("missing")],
      ["updateVault", (s: StoreInterface) => s.updateVault("missing", "x")],
    ])("%s on an unknown id throws StoreError 404", async (_name, op) => {
      await expect(op(store)).rejects.toMatchObject({
        name: "StoreError",
        status: 404,
      });
    });
  });
}
