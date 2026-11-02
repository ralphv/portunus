// Engine upgrade on save: a vault written by an older (deprecated) engine
// unlocks, and the next save re-wraps it under the default engine — through
// VaultSession, the Worker core and VaultClient's RPC, as in the app.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultEngine, serializeEnvelope, VaultError, VaultUnlockError } from "@/crypto";
import type { VaultSecrets } from "@/crypto";
import { legacyEngine } from "@/crypto/engines/legacy-engine.test-helper";

vi.mock("@/crypto/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/crypto/registry")>();
  const { legacyEngine: legacy } = await import(
    "@/crypto/engines/legacy-engine.test-helper"
  );
  return {
    ...real,
    getEngine: (id: string) => (id === legacy.id ? legacy : real.getEngine(id)),
  };
});

import {
  CACHE_ON,
  installVaultApiStub,
  makeSecrets,
} from "./vault-api-stub.test-helper";
import type { VaultApiStub } from "./vault-api-stub.test-helper";
import { VaultClient } from "./vault-client";
import type { VaultWorkerLike } from "./vault-client";
import { emptyVaultData, parseVaultData, serializeVaultData } from "./vault-doc";
import { fetchRemoteVault } from "./vault-remote";
import { createVaultHandler } from "./vault-rpc";
import type { VaultRequest, VaultResponse } from "./vault-rpc";
import { VaultSession } from "./vault-session";
import { VaultWorkerCore } from "./vault-worker-core";

const te = new TextEncoder();
const V1 = te.encode('{"entries":[{"name":"old"}]}');
const V2 = te.encode('{"entries":[{"name":"new"}]}');

let stub: VaultApiStub;
let secrets: VaultSecrets;

const storedEngine = () => JSON.parse(stub.store!.contents).engine as string;

beforeEach(async () => {
  stub = installVaultApiStub();
  secrets = await makeSecrets("legacy-pw");
  const init = await legacyEngine.initNew(secrets);
  const envelope = await legacyEngine.encrypt(init.header, init.dataKey, V1);
  stub.store = {
    fileId: "file-1",
    modifiedTime: "t0",
    contents: serializeEnvelope(envelope),
  };
});

async function openLegacy(): Promise<VaultSession> {
  return VaultSession.fromRemote((await fetchRemoteVault(CACHE_ON))!, secrets);
}

describe("VaultSession engine upgrade", () => {
  it("unlocks a vault written by an older engine and flags it", async () => {
    const session = await openLegacy();
    expect(session.data).toEqual(V1);
    expect(session.needsEngineUpgrade).toBe(true);
  });

  it("re-wraps under the default engine when saved with the password", async () => {
    const session = await openLegacy();
    const oldKey = session["dataKey"];
    session.update(V2);
    await session.save(secrets.password);

    expect(storedEngine()).toBe(defaultEngine().id);
    expect(session.needsEngineUpgrade).toBe(false);
    expect(oldKey.every((b) => b === 0)).toBe(true);
    // Same password + keyfile open the upgraded vault.
    const reopened = await VaultSession.unlock(secrets, CACHE_ON);
    expect(reopened!.data).toEqual(V2);
    await expect(reopened!.verifyPassword(secrets.password)).resolves.toBeUndefined();
  });

  it("refuses to re-wrap under a wrong password and writes nothing", async () => {
    const session = await openLegacy();
    session.update(V2);
    await expect(session.save("typo")).rejects.toThrow(VaultUnlockError);
    expect(stub.putBodies).toHaveLength(0);
    expect(session.needsEngineUpgrade).toBe(true);
    expect(session.dirty).toBe(true);
  });

  it("asks for the password instead of saving without it", async () => {
    const session = await openLegacy();
    session.update(V2);
    await expect(session.save()).rejects.toThrow(VaultError);
    await expect(session.save()).rejects.toThrow(/password required/);
    expect(stub.putBodies).toHaveLength(0);
  });

  it("keeps the old engine and key when the upgrade upload fails", async () => {
    const session = await openLegacy();
    const oldKey = session["dataKey"].slice();
    stub.store!.modifiedTime = "elsewhere"; // concurrent write → 409
    session.update(V2);
    await expect(session.save(secrets.password)).rejects.toMatchObject({ status: 409 });
    expect(session.needsEngineUpgrade).toBe(true);
    expect(session["dataKey"]).toEqual(oldKey);
    expect(session.dirty).toBe(true);
  });
});

describe("engine upgrade through the app's save path", () => {
  it("VaultWorkerCore.save upgrades with the dialog's password", async () => {
    const init = await legacyEngine.initNew(secrets);
    stub.store!.contents = serializeEnvelope(
      await legacyEngine.encrypt(init.header, init.dataKey, serializeVaultData(emptyVaultData())),
    );
    const core = new VaultWorkerCore();
    const { data } = await core.open((await fetchRemoteVault(CACHE_ON))!, secrets);
    await core.save(data, secrets.password);
    expect(storedEngine()).toBe(defaultEngine().id);
    // Later saves need no password: the vault is current now.
    await core.save(data);
    expect(stub.putBodies).toHaveLength(2);
  });

  it("VaultClient.save carries the password across the Worker RPC", async () => {
    const init = await legacyEngine.initNew(secrets);
    stub.store!.contents = serializeEnvelope(
      await legacyEngine.encrypt(init.header, init.dataKey, serializeVaultData(emptyVaultData())),
    );
    const handle = createVaultHandler(new VaultWorkerCore());
    const worker: VaultWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(req: VaultRequest) {
        void handle(structuredClone(req)).then((res) =>
          this.onmessage?.({ data: structuredClone(res) } as MessageEvent<VaultResponse>),
        );
      },
      terminate() {},
    };
    const opened = await VaultClient.unlock(secrets, CACHE_ON, () => worker);
    await opened!.client.save(opened!.data, secrets.password);
    expect(storedEngine()).toBe(defaultEngine().id);
    const reopened = await VaultSession.unlock(secrets, CACHE_ON);
    expect(parseVaultData(reopened!.data)).toEqual(emptyVaultData());
  });
});
