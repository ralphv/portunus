import { beforeEach, describe, expect, it } from "vitest";

import { VaultUnlockError } from "@/crypto/errors";

import {
  CACHE_OFF,
  CACHE_ON,
  installVaultApiStub,
  makeSecrets,
} from "./vault-api-stub.test-helper";
import { VaultClient } from "./vault-client";
import { createVaultHandler, deserializeError, serializeError } from "./vault-rpc";
import { VaultWorkerCore } from "./vault-worker-core";
import { inProcessWorker } from "./vault-worker.test-helper";

beforeEach(() => {
  installVaultApiStub();
});

describe("VaultClient", () => {
  it("creates, saves and unlocks through the Worker protocol", async () => {
    const secrets = await makeSecrets("master");
    const { client, data } = await VaultClient.create(secrets, CACHE_ON, inProcessWorker);
    expect(data.entries).toEqual([]);
    expect(localStorage.getItem("portunus.vault.cache")).not.toBeNull();
    client.lock();
    const opened = await VaultClient.unlock(secrets, CACHE_ON, inProcessWorker);
    expect(opened?.data.entries).toEqual([]);
    expect(opened?.client.offline).toBe(false);
  });

  it("keeps no offline copy across create, save and unlock when the cache is off", async () => {
    const secrets = await makeSecrets("master");
    const { client, data } = await VaultClient.create(secrets, CACHE_OFF, inProcessWorker);
    expect(client.cachePolicy).toEqual(CACHE_OFF);
    await client.save(data);
    client.lock();
    const opened = await VaultClient.unlock(secrets, CACHE_OFF, inProcessWorker);
    await opened!.client.save(opened!.data);
    expect(localStorage.getItem("portunus.vault.cache")).toBeNull();
  });

  it("rehydrates error classes across the boundary", async () => {
    const secrets = await makeSecrets("master");
    (await VaultClient.create(secrets, CACHE_ON, inProcessWorker)).client.lock();
    const err = await VaultClient.unlock(
      { ...secrets, password: "wrong" }, CACHE_ON,
      inProcessWorker,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VaultUnlockError);
  });

  it("identifies errors by class even when names are minified", () => {
    const e = new VaultUnlockError("Wrong password or keyfile");
    e.name = "l"; // what a production build leaves in `.name`
    const back = deserializeError(structuredClone(serializeError(e)));
    expect(back).toBeInstanceOf(VaultUnlockError);
    expect(back.message).toBe("Wrong password or keyfile");
  });

  it("rejects unknown methods", async () => {
    const handle = createVaultHandler(new VaultWorkerCore());
    const res = await handle({
      id: 1,
      method: "constructor" as never,
      args: [],
    });
    expect(res.ok).toBe(false);
  });

  it("lock terminates the Worker and rejects later calls", async () => {
    const secrets = await makeSecrets("master");
    const { client } = await VaultClient.create(secrets, CACHE_ON, inProcessWorker);
    client.lock();
    await expect(client.call("passwordPending")).rejects.toThrow("Vault is locked");
  });
});
