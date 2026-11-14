import { beforeEach, describe, expect, it } from "vitest";

import {
  DeviceUnlockError,
  DeviceUnlockStaleError,
  VaultUnlockError,
} from "@/crypto/errors";
import { keyfileFromKey } from "@/crypto/keyfile";
import type { Keyfile } from "@/crypto/keyfile";
import { VaultClient } from "@/lib/vault-client";
import {
  CACHE_ON,
  installVaultApiStub,
  makeSecrets,
} from "@/lib/vault-api-stub.test-helper";
import { fetchRemoteVault } from "@/lib/vault-remote";
import { inProcessWorker } from "@/lib/vault-worker.test-helper";

import { BiometricError } from "./biometric-error";
import {
  confirmWithThisDevice,
  enrollThisDevice,
  removeThisDevice,
  unlockWithThisDevice,
} from "./device-unlock-flow";
import { readDeviceUnlock } from "./device-unlock-store";
import { FakeBiometric } from "./fake-biometric.test-helper";

const PASSWORD = "master";

beforeEach(() => {
  installVaultApiStub();
});

async function setup() {
  const secrets = await makeSecrets(PASSWORD);
  const keyfile: Keyfile = await keyfileFromKey(secrets.keyfile);
  const { client, data } = await VaultClient.create(secrets, CACHE_ON, inProcessWorker);
  const biometric = new FakeBiometric();
  return { secrets, keyfile, client, data, biometric };
}

const remote = async () => (await fetchRemoteVault(CACHE_ON))!;

describe("fingerprint unlock flow", () => {
  it("enrolls, stores the record and unlocks with it", async () => {
    const { keyfile, client, biometric } = await setup();
    const record = await enrollThisDevice(client, biometric, PASSWORD, keyfile.kid);
    expect(readDeviceUnlock(keyfile.kid)).toEqual(record);
    client.lock();
    const opened = await unlockWithThisDevice(
      remote,
      record,
      keyfile,
      biometric,
      CACHE_ON,
      inProcessWorker,
    );
    expect(opened?.data.entries).toEqual([]);
  });

  it("checks the password before creating a passkey", async () => {
    const { keyfile, client, biometric } = await setup();
    await expect(
      enrollThisDevice(client, biometric, "wrong", keyfile.kid),
    ).rejects.toBeInstanceOf(VaultUnlockError);
    expect(biometric.secrets.size).toBe(0);
    expect(readDeviceUnlock(keyfile.kid)).toBeNull();
  });

  it("stores nothing when the fingerprint check is cancelled", async () => {
    const { keyfile, client, biometric } = await setup();
    biometric.failWith = "cancelled";
    await expect(
      enrollThisDevice(client, biometric, PASSWORD, keyfile.kid),
    ).rejects.toBeInstanceOf(BiometricError);
    expect(readDeviceUnlock(keyfile.kid)).toBeNull();
  });

  it("replaces a previous enrollment and forgets its passkey", async () => {
    const { keyfile, client, biometric } = await setup();
    const first = await enrollThisDevice(client, biometric, PASSWORD, keyfile.kid);
    const second = await enrollThisDevice(client, biometric, PASSWORD, keyfile.kid);
    expect(readDeviceUnlock(keyfile.kid)).toEqual(second);
    expect(biometric.forgotten).toEqual([first.credentialId]);
  });

  it("confirms with the fingerprint and refuses another passkey's secret", async () => {
    const { keyfile, client, biometric } = await setup();
    const record = await enrollThisDevice(client, biometric, PASSWORD, keyfile.kid);
    await expect(confirmWithThisDevice(client, record, biometric)).resolves.toBeUndefined();
    // Same record, but the authenticator now answers for a different key.
    biometric.secrets.set(record.credentialId, crypto.getRandomValues(new Uint8Array(32)));
    await expect(
      confirmWithThisDevice(client, record, biometric),
    ).rejects.toBeInstanceOf(DeviceUnlockError);
    expect(readDeviceUnlock(keyfile.kid)).not.toBeNull();
  });

  it("drops a stale record and its passkey after a password change", async () => {
    const { keyfile, client, data, biometric } = await setup();
    const record = await enrollThisDevice(client, biometric, PASSWORD, keyfile.kid);
    await client.changePassword("new-master", data);
    client.lock();
    await expect(
      unlockWithThisDevice(remote, record, keyfile, biometric, CACHE_ON, inProcessWorker),
    ).rejects.toBeInstanceOf(DeviceUnlockStaleError);
    expect(readDeviceUnlock(keyfile.kid)).toBeNull();
    expect(biometric.forgotten).toEqual([record.credentialId]);
  });

  it("runs the biometric check before fetching the vault", async () => {
    const { keyfile, client, biometric } = await setup();
    const record = await enrollThisDevice(client, biometric, PASSWORD, keyfile.kid);
    biometric.failWith = "cancelled";
    let fetched = false;
    const getRemote = async () => {
      fetched = true;
      return remote();
    };
    await expect(
      unlockWithThisDevice(getRemote, record, keyfile, biometric, CACHE_ON, inProcessWorker),
    ).rejects.toBeInstanceOf(BiometricError);
    expect(fetched).toBe(false);
    biometric.failWith = null;
    await expect(
      unlockWithThisDevice(async () => null, record, keyfile, biometric, CACHE_ON, inProcessWorker),
    ).resolves.toBeNull();
  });

  it("removes the record and forgets the passkey", async () => {
    const { keyfile, client, biometric } = await setup();
    const record = await enrollThisDevice(client, biometric, PASSWORD, keyfile.kid);
    await removeThisDevice(keyfile.kid, biometric);
    expect(readDeviceUnlock(keyfile.kid)).toBeNull();
    expect(biometric.forgotten).toEqual([record.credentialId]);
  });
});
