import { beforeEach, describe, expect, it } from "vitest";

import { VaultUnlockError } from "@/crypto/errors";

import {
  installVaultApiStub,
  makeSecrets,
} from "./vault-api-stub.test-helper";
import { VaultClient } from "./vault-client";
import type { VaultWorkerLike } from "./vault-client";
import { createVaultHandler } from "./vault-rpc";
import type { VaultRequest, VaultResponse } from "./vault-rpc";
import { VaultWorkerCore } from "./vault-worker-core";

// Runs the real Worker message handler in-process, with structured cloning
// in both directions like postMessage.
function inProcessWorker(): VaultWorkerLike & { terminated: boolean } {
  const handle = createVaultHandler(new VaultWorkerCore());
  const w = {
    terminated: false,
    onmessage: null as ((e: MessageEvent<VaultResponse>) => void) | null,
    onerror: null,
    postMessage(req: VaultRequest) {
      void handle(structuredClone(req)).then((res) => {
        if (!w.terminated) {
          w.onmessage?.({ data: structuredClone(res) } as MessageEvent<VaultResponse>);
        }
      });
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

beforeEach(() => {
  installVaultApiStub();
});

describe("VaultClient", () => {
  it("creates, saves and unlocks through the Worker protocol", async () => {
    const secrets = await makeSecrets("master");
    const { client, data } = await VaultClient.create(secrets, inProcessWorker);
    expect(data.entries).toEqual([]);
    expect(localStorage.getItem("portunus.vault.cache")).not.toBeNull();
    client.lock();
    const opened = await VaultClient.unlock(secrets, inProcessWorker);
    expect(opened?.data.entries).toEqual([]);
    expect(opened?.client.offline).toBe(false);
  });

  it("rehydrates error classes across the boundary", async () => {
    const secrets = await makeSecrets("master");
    (await VaultClient.create(secrets, inProcessWorker)).client.lock();
    const err = await VaultClient.unlock(
      { ...secrets, password: "wrong" },
      inProcessWorker,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VaultUnlockError);
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
    const { client } = await VaultClient.create(secrets, inProcessWorker);
    client.lock();
    await expect(client.call("passwordPending")).rejects.toThrow("Vault is locked");
  });
});
