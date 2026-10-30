import { beforeEach, describe, expect, it } from "vitest";

import { sha1HexUpper } from "./pwned-passwords";
import { totpUri } from "./totp";
import {
  installVaultApiStub,
  makeSecrets,
} from "./vault-api-stub.test-helper";
import type { VaultApiStub } from "./vault-api-stub.test-helper";
import { newPublicEntry } from "./vault-public";
import type { PublicVaultData } from "./vault-public";
import { fetchRemoteVault } from "./vault-remote";
import { createVaultHandler } from "./vault-rpc";
import { VaultWorkerCore } from "./vault-worker-core";

const SECRET = "Sup3rSecret-Probe-9917";

let stub: VaultApiStub;
beforeEach(() => {
  stub = installVaultApiStub();
});

async function freshVault() {
  const secrets = await makeSecrets();
  const core = new VaultWorkerCore();
  const { data } = await core.create(secrets);
  return { core, secrets, data };
}

function withEntry(data: PublicVaultData, name = "site"): PublicVaultData {
  return { ...data, entries: [{ ...newPublicEntry(), name }, ...data.entries] };
}

async function reopen(secrets: Awaited<ReturnType<typeof makeSecrets>>) {
  const core = new VaultWorkerCore();
  const remote = await fetchRemoteVault();
  const { data } = await core.open(remote!, secrets);
  return { core, data };
}

describe("VaultWorkerCore", () => {
  it("never puts secrets in the public view", async () => {
    const { core, secrets, data } = await freshVault();
    const draft = withEntry(data);
    const id = draft.entries[0].id;
    core.setSecret(id, "password", SECRET);
    core.setSecret(id, "totp", totpUri({
      secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      issuer: "",
      account: "a",
    }));
    const saved = await core.save({
      ...draft,
      entries: [{ ...draft.entries[0], hasPassword: true, hasTotp: true }],
    });
    expect(JSON.stringify(saved)).not.toContain(SECRET);
    expect(JSON.stringify(saved)).not.toContain("JBSWY3DP");
    const again = await reopen(secrets);
    expect(again.data.entries[0]).toMatchObject({ hasPassword: true, hasTotp: true });
    expect(JSON.stringify(again.data)).not.toContain(SECRET);
    expect(again.core.reveal(id, { field: "password" })).toBe(SECRET);
  });

  it("records history on save and reveals previous passwords", async () => {
    const { core, secrets, data } = await freshVault();
    let draft = withEntry(data);
    const id = draft.entries[0].id;
    core.setSecret(id, "password", "old-pw");
    draft = (await core.save(draft)).data;
    core.setSecret(id, "password", "new-pw");
    expect(core.passwordPending()).toEqual([id]);
    draft = (await core.save(draft)).data;
    expect(core.passwordPending()).toEqual([]);
    const e = draft.entries[0];
    expect(e.passwordUpdateCount).toBe(1);
    expect(e.passwordHistory).toHaveLength(1);
    expect(e.passwordHistory[0]).not.toHaveProperty("password");
    const { core: c2 } = await reopen(secrets);
    expect(
      c2.reveal(id, {
        field: "history",
        index: 0,
        replacedAt: e.passwordHistory[0].replacedAt,
      }),
    ).toBe("old-pw");
  });

  it("keeps a secret edited while a save is in flight", async () => {
    const { core, secrets, data } = await freshVault();
    const draft = withEntry(data);
    const id = draft.entries[0].id;
    core.setSecret(id, "password", "first");
    stub.beforePut = () => {
      stub.beforePut = null;
      core.setSecret(id, "password", "second");
    };
    await core.save(draft);
    // The upload carried the snapshot; the newer edit stays pending.
    const reopened = await reopen(secrets);
    expect(reopened.core.reveal(id, { field: "password" })).toBe("first");
    expect(core.reveal(id, { field: "password" })).toBe("second");
    expect(core.passwordPending()).toEqual([id]);
  });

  it("drops a breach result when the password changed mid-check", async () => {
    const { core, data } = await freshVault();
    const id = withEntry(data).entries[0].id;
    stub.pwned.set(await sha1HexUpper("hunter2"), 42);
    core.setSecret(id, "password", "hunter2");
    expect(await core.checkPwned(id)).toEqual({ pwned: true, count: 42 });
    const pending = core.checkPwned(id);
    core.setSecret(id, "password", "changed");
    expect(await pending).toBeNull();
  });

  it("groups shared passwords for the audit", async () => {
    const { core } = await freshVault();
    core.setSecret("a", "password", "same");
    core.setSecret("b", "password", "same");
    core.setSecret("c", "password", "other");
    core.setSecret("d", "password", "");
    expect(core.auditGroups(["a", "b", "c", "d"])).toEqual([["a", "b"], ["c"]]);
    const res = await core.checkPwnedGroup(["a", "b"]);
    expect(res?.ids).toEqual(["a", "b"]);
    expect(res?.result.pwned).toBe(false);
  });

  it("generates TOTP codes without exposing the seed", async () => {
    const { core } = await freshVault();
    core.setSecret("t", "totp", "otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    // RFC 6238 SHA-1 test vector at T=59s.
    const view = await core.totp("t", 59_000);
    expect(view).toEqual({ code: "287082", digits: 6, period: 30, counter: 1 });
    expect(await core.totp("missing")).toBeNull();
  });

  it("lets other requests run between strength scores", async () => {
    const { core } = await freshVault();
    const ids = ["a", "b", "c"];
    for (const id of ids) core.setSecret(id, "password", `Pw-${id}-${SECRET}`);
    core.setSecret("r", "password", SECRET);
    await core.strengths(["r"]); // load zxcvbn up front
    const handle = createVaultHandler(core);
    const order: string[] = [];
    const scoring = handle({ id: 1, method: "strengths", args: [ids] }).then(
      () => order.push("strengths"),
    );
    // A Worker message arrives as its own task, like this timer.
    const revealing = new Promise<void>((resolve) =>
      setTimeout(() => {
        void handle({ id: 2, method: "reveal", args: ["r", { field: "password" }] })
          .then(() => {
            order.push("reveal");
            resolve();
          });
      }, 0),
    );
    await Promise.all([scoring, revealing]);
    expect(order).toEqual(["reveal", "strengths"]);
  });

  it("rejects calls on a locked (never opened) core", async () => {
    const core = new VaultWorkerCore();
    await expect(core.verifyPassword("pw")).rejects.toThrow("Vault is locked");
  });
});
