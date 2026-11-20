// Opportunistic Argon2id cost upgrade on save: a vault written at a lower
// cost unlocks, and the next password-confirmed save re-wraps it at the
// configured target — through VaultSession and the Worker core, as in the app.
import { beforeEach, describe, expect, it } from "vitest";

import { defaultEngine, serializeEnvelope, VaultUnlockError } from "@/crypto";
import type { KdfTarget, VaultSecrets } from "@/crypto";

import {
  CACHE_ON,
  installVaultApiStub,
  makeSecrets,
} from "./vault-api-stub.test-helper";
import type { VaultApiStub } from "./vault-api-stub.test-helper";
import { emptyVaultData, serializeVaultData } from "./vault-doc";
import { fetchRemoteVault } from "./vault-remote";
import { VaultSession } from "./vault-session";
import { VaultWorkerCore } from "./vault-worker-core";

// A valid serialized vault document, so the Worker core's parse step accepts it.
const V1 = serializeVaultData(emptyVaultData());

// Seed cost (deliberately below the target) and the raised target.
const LOW: KdfTarget = { time: 2, mem: 19 * 1024 };
const HIGH: KdfTarget = { time: 2, mem: 64 * 1024 };

let stub: VaultApiStub;
let secrets: VaultSecrets;

const storedMem = () =>
  (JSON.parse(stub.store!.contents).kdf as { mem: number }).mem;

beforeEach(async () => {
  stub = installVaultApiStub();
  secrets = await makeSecrets("pw");
  const engine = defaultEngine();
  const init = await engine.initNew(secrets, LOW);
  const envelope = await engine.encrypt(init.header, init.dataKey, V1);
  stub.store = {
    fileId: "file-1",
    modifiedTime: "t0",
    contents: serializeEnvelope(envelope),
  };
});

async function open(target?: KdfTarget): Promise<VaultSession> {
  return VaultSession.fromRemote((await fetchRemoteVault(CACHE_ON))!, secrets, target);
}

describe("VaultSession KDF cost upgrade", () => {
  it("flags a vault whose stored cost is below the target", async () => {
    expect((await open(HIGH)).needsKdfUpgrade).toBe(true);
  });

  it("does not flag when no target is configured", async () => {
    expect((await open()).needsKdfUpgrade).toBe(false);
  });

  it("is monotonic: never flags a vault at or above the target", async () => {
    expect((await open(LOW)).needsKdfUpgrade).toBe(false);
    expect((await open({ time: 1, mem: 8 * 1024 })).needsKdfUpgrade).toBe(false);
  });

  it("re-wraps at the target cost on a password-confirmed save", async () => {
    const session = await open(HIGH);
    session.update(V1);
    await session.save(secrets.password);

    expect(storedMem()).toBe(HIGH.mem);
    expect(session.needsKdfUpgrade).toBe(false);
    // Same credentials open the re-wrapped vault.
    const reopened = await VaultSession.unlock(secrets, CACHE_ON, HIGH);
    expect(reopened!.data).toEqual(V1);
  });

  it("saves normally without upgrading when the save carries no password", async () => {
    const session = await open(HIGH);
    session.update(V1);
    await session.save(); // best-effort: must neither throw nor force a prompt

    expect(storedMem()).toBe(LOW.mem);
    expect(session.needsKdfUpgrade).toBe(true);
    expect(stub.putBodies).toHaveLength(1);
  });

  it("does not re-wrap under a wrong password and writes nothing", async () => {
    const session = await open(HIGH);
    session.update(V1);
    await expect(session.save("typo")).rejects.toThrow(VaultUnlockError);

    expect(stub.putBodies).toHaveLength(0);
    expect(session.needsKdfUpgrade).toBe(true);
    expect(session.dirty).toBe(true);
  });
});

describe("KDF upgrade through the app save path", () => {
  it("VaultWorkerCore.open + save upgrades with the dialog password", async () => {
    const core = new VaultWorkerCore();
    const { data } = await core.open(
      (await fetchRemoteVault(CACHE_ON))!,
      secrets,
      HIGH,
    );
    await core.save(data, secrets.password);
    expect(storedMem()).toBe(HIGH.mem);

    // The vault is current now: later saves need no password and re-wrap nothing.
    await core.save(data);
    expect(storedMem()).toBe(HIGH.mem);
    expect(stub.putBodies).toHaveLength(2);
  });
});
