import { beforeEach, describe, expect, it } from "vitest";

import {
  DeviceUnlockError,
  DeviceUnlockStaleError,
  generatePrfSalt,
  b64encode,
  keyfileFromKey,
  VaultUnlockError,
} from "@/crypto";
import type { DeviceUnlockMeta, VaultSecrets } from "@/crypto";

import {
  CACHE_ON,
  installVaultApiStub,
  makeSecrets,
} from "./vault-api-stub.test-helper";
import { newPublicEntry } from "./vault-public";
import { fetchRemoteVault } from "./vault-remote";
import { createVaultHandler, deserializeError } from "./vault-rpc";
import { VaultWorkerCore } from "./vault-worker-core";

beforeEach(() => {
  installVaultApiStub();
});

const newPrf = () => crypto.getRandomValues(new Uint8Array(32));

async function metaFor(secrets: VaultSecrets): Promise<DeviceUnlockMeta> {
  const { kid } = await keyfileFromKey(secrets.keyfile);
  return {
    kid,
    credentialId: b64encode(crypto.getRandomValues(new Uint8Array(20))),
    prfSalt: generatePrfSalt(),
  };
}

// A vault with one entry, enrolled for fingerprint unlock. `prf` stays
// with the test — the core wipes the copy it is handed.
async function enrolledVault() {
  const secrets = await makeSecrets();
  const core = new VaultWorkerCore();
  const { data } = await core.create(secrets);
  const saved = await core.save({
    ...data,
    entries: [{ ...newPublicEntry(), name: "site" }],
  });
  const prf = newPrf();
  const record = await core.enrollDevice(
    secrets.password,
    prf.slice(),
    await metaFor(secrets),
  );
  return { core, secrets, prf, record, data: saved.data };
}

async function remote() {
  return (await fetchRemoteVault(CACHE_ON))!;
}

describe("VaultWorkerCore fingerprint unlock", () => {
  it("opens the vault with the device record instead of the password", async () => {
    const { secrets, prf, record } = await enrolledVault();
    const core = new VaultWorkerCore();
    const { data } = await core.openWithDevice(
      await remote(),
      record,
      prf.slice(),
      secrets.keyfile,
    );
    expect(data.entries.map((e) => e.name)).toEqual(["site"]);
    // The opened session is fully usable: password checks still work.
    await expect(core.verifyPassword(secrets.password)).resolves.toBeUndefined();
  });

  it("wipes the PRF secret it is handed", async () => {
    const { secrets, prf, record } = await enrolledVault();
    const handed = prf.slice();
    await new VaultWorkerCore().openWithDevice(
      await remote(),
      record,
      handed,
      secrets.keyfile,
    );
    expect(handed.every((b) => b === 0)).toBe(true);
  });

  it("requires the master password to enroll", async () => {
    const secrets = await makeSecrets();
    const core = new VaultWorkerCore();
    await core.create(secrets);
    await expect(
      core.enrollDevice("wrong", newPrf(), await metaFor(secrets)),
    ).rejects.toBeInstanceOf(VaultUnlockError);
  });

  it("refuses to enroll for another keyfile", async () => {
    const secrets = await makeSecrets();
    const core = new VaultWorkerCore();
    await core.create(secrets);
    const other = await makeSecrets();
    await expect(
      core.enrollDevice(secrets.password, newPrf(), await metaFor(other)),
    ).rejects.toBeInstanceOf(DeviceUnlockError);
  });

  it("refuses a wrong fingerprint secret", async () => {
    const { secrets, record } = await enrolledVault();
    const err = await new VaultWorkerCore()
      .openWithDevice(await remote(), record, newPrf(), secrets.keyfile)
      .catch((e) => e);
    expect(err).toBeInstanceOf(DeviceUnlockError);
    expect(err).not.toBeInstanceOf(DeviceUnlockStaleError);
  });

  it("refuses a record used with another keyfile", async () => {
    const { prf, record } = await enrolledVault();
    const other = await makeSecrets();
    await expect(
      new VaultWorkerCore().openWithDevice(
        await remote(),
        record,
        prf.slice(),
        other.keyfile,
      ),
    ).rejects.toBeInstanceOf(DeviceUnlockError);
  });

  it("keeps working across normal saves", async () => {
    const { core, secrets, prf, record, data } = await enrolledVault();
    await core.save({ ...data, entries: [{ ...data.entries[0], name: "renamed" }] });
    const reopened = await new VaultWorkerCore().openWithDevice(
      await remote(),
      record,
      prf.slice(),
      secrets.keyfile,
    );
    expect(reopened.data.entries[0].name).toBe("renamed");
  });

  it("goes stale after a master password change", async () => {
    const { core, secrets, prf, record, data } = await enrolledVault();
    await core.changePassword("new-pw", data);
    await expect(
      new VaultWorkerCore().openWithDevice(
        await remote(),
        record,
        prf.slice(),
        secrets.keyfile,
      ),
    ).rejects.toBeInstanceOf(DeviceUnlockStaleError);
    await expect(core.verifyDevice(record, prf.slice())).rejects.toBeInstanceOf(
      DeviceUnlockStaleError,
    );
  });

  it("re-enrolls after a password change with the new password", async () => {
    const { core, secrets, data } = await enrolledVault();
    await core.changePassword("new-pw", data);
    const prf = newPrf();
    const record = await core.enrollDevice("new-pw", prf.slice(), await metaFor(secrets));
    const reopened = await new VaultWorkerCore().openWithDevice(
      await remote(),
      record,
      prf.slice(),
      secrets.keyfile,
    );
    expect(reopened.data.entries).toHaveLength(1);
  });

  it("confirms a save with the fingerprint", async () => {
    const { core, prf, record } = await enrolledVault();
    await expect(core.verifyDevice(record, prf.slice())).resolves.toBeUndefined();
    await expect(core.verifyDevice(record, newPrf())).rejects.toBeInstanceOf(
      DeviceUnlockError,
    );
  });

  it("rejects a malformed record from the main thread", async () => {
    const { core, secrets, prf } = await enrolledVault();
    await expect(
      new VaultWorkerCore().openWithDevice(
        await remote(),
        { format: "nope" } as never,
        prf.slice(),
        secrets.keyfile,
      ),
    ).rejects.toBeInstanceOf(DeviceUnlockError);
    await expect(
      core.verifyDevice(null as never, prf.slice()),
    ).rejects.toBeInstanceOf(DeviceUnlockError);
  });

  it("serializes device errors across the Worker boundary", async () => {
    const { secrets, record } = await enrolledVault();
    const handle = createVaultHandler(new VaultWorkerCore());
    const res = await handle({
      id: 1,
      method: "openWithDevice",
      args: [await remote(), record, newPrf(), secrets.keyfile],
    });
    expect(res).toMatchObject({ ok: false, error: { name: "DeviceUnlockError" } });
  });

  it("keeps a stale record distinguishable across the Worker boundary", async () => {
    const { core, secrets, prf, record, data } = await enrolledVault();
    await core.changePassword("new-pw", data);
    const res = await createVaultHandler(new VaultWorkerCore())({
      id: 1,
      method: "openWithDevice",
      args: [await remote(), record, prf.slice(), secrets.keyfile],
    });
    expect(res).toMatchObject({
      ok: false,
      error: { name: "DeviceUnlockStaleError" },
    });
    if (!res.ok) {
      expect(deserializeError(res.error)).toBeInstanceOf(DeviceUnlockStaleError);
    }
  });
});
