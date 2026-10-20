import { describe, expect, it, vi } from "vitest";

import { VaultError } from "@/crypto";
import {
  applyPwnedCheck,
  defaultVaultSettings,
  emptyVaultData,
  entryHref,
  filterEntries,
  finalizeEntryForSave,
  formatElapsed,
  newEntry,
  parseVaultData,
  PASSWORD_HISTORY_LIMIT,
  prepareVaultForSave,
  PWNED_LABEL,
  saveVaultDraft,
  serializeVaultData,
  VAULT_DATA_FORMAT,
} from "./vault-doc";
import type { VaultData, VaultEntry } from "./vault-doc";

const te = new TextEncoder();

function docBytes(entries: unknown[], settings?: unknown): Uint8Array {
  return te.encode(
    JSON.stringify({ format: VAULT_DATA_FORMAT, version: 1, entries, settings }),
  );
}

function vaultData(
  entries: VaultEntry[],
  settings: Partial<VaultData["settings"]> = {},
): VaultData {
  return { entries, settings: { ...defaultVaultSettings(), ...settings } };
}

function entry(patch: Partial<VaultEntry> = {}): VaultEntry {
  return { ...newEntry(new Date("2024-01-01T00:00:00.000Z")), ...patch };
}

describe("vault doc", () => {
  it("round-trips serialize → parse", () => {
    const data = emptyVaultData();
    const entry = newEntry();
    entry.name = "example.com";
    entry.password = "s3cret";
    entry.notes = "line1\nline2";
    data.entries.push(entry);

    const parsed = parseVaultData(serializeVaultData(data));
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toEqual(entry);
  });

  it("emits a format marker", () => {
    const text = new TextDecoder().decode(serializeVaultData(emptyVaultData()));
    expect(JSON.parse(text).format).toBe(VAULT_DATA_FORMAT);
  });

  it("rejects non-JSON and wrong-format payloads", () => {
    expect(() => parseVaultData(te.encode("not json {"))).toThrow(VaultError);
    expect(() =>
      parseVaultData(te.encode('{"format":"other","version":1,"entries":[]}')),
    ).toThrow(VaultError);
    expect(() => parseVaultData(te.encode('{"entries":"nope"}'))).toThrow(
      VaultError,
    );
  });

  it("normalizes missing entry fields to empty strings", () => {
    const parsed = parseVaultData(
      te.encode(
        JSON.stringify({
          format: VAULT_DATA_FORMAT,
          version: 1,
          entries: [{ name: "only-name" }],
        }),
      ),
    );
    expect(parsed.entries[0].name).toBe("only-name");
    expect(parsed.entries[0].password).toBe("");
    expect(parsed.entries[0].id).toBeTruthy();
  });
});

describe("entryHref", () => {
  it("keeps http(s) URLs", () => {
    expect(entryHref("https://example.com/login")).toBe("https://example.com/login");
    expect(entryHref("http://example.com")).toBe("http://example.com/");
  });

  it("adds https:// to bare hosts", () => {
    expect(entryHref("  example.com/path ")).toBe("https://example.com/path");
    expect(entryHref("localhost:8080")).toBe("https://localhost:8080/");
  });

  it("rejects empty and non-web URLs", () => {
    expect(entryHref("")).toBe(null);
    expect(entryHref("   ")).toBe(null);
    expect(entryHref("javascript:alert(1)")).toBe(null);
    expect(entryHref("data:text/html,hi")).toBe(null);
    expect(entryHref("ftp://example.com")).toBe(null);
  });
});

describe("vault doc metadata", () => {
  it("initializes metadata on new entries", () => {
    const now = new Date("2025-03-04T05:06:07.000Z");
    const e = newEntry(now);
    expect(e.createdAt).toBe(now.toISOString());
    expect(e.passwordUpdatedAt).toBe(now.toISOString());
    expect(e.passwordUpdateCount).toBe(0);
    expect(e.passwordHistory).toEqual([]);
    expect(e.labels).toEqual([]);
  });

  it("round-trips the new fields", () => {
    const e = entry({
      password: "current",
      labels: ["work", "email"],
      passwordUpdateCount: 3,
      passwordHistory: [
        { password: "older", replacedAt: "2024-06-01T00:00:00.000Z" },
        { password: "oldest", replacedAt: "2024-02-01T00:00:00.000Z" },
      ],
    });
    const parsed = parseVaultData(serializeVaultData(vaultData([e])));
    expect(parsed.entries[0]).toEqual(e);
  });

  it("defaults legacy entries from updatedAt", () => {
    const parsed = parseVaultData(
      docBytes([
        {
          id: "a",
          name: "legacy",
          password: "pw",
          updatedAt: "2023-05-06T07:08:09.000Z",
        },
      ]),
    );
    const e = parsed.entries[0];
    expect(e.createdAt).toBe("2023-05-06T07:08:09.000Z");
    expect(e.passwordUpdatedAt).toBe("2023-05-06T07:08:09.000Z");
    expect(e.passwordUpdateCount).toBe(0);
    expect(e.passwordHistory).toEqual([]);
    expect(e.labels).toEqual([]);
  });

  it("falls back to a valid ISO timestamp without updatedAt", () => {
    const e = parseVaultData(docBytes([{ name: "x", updatedAt: "garbage" }]))
      .entries[0];
    for (const ts of [e.updatedAt, e.createdAt, e.passwordUpdatedAt]) {
      expect(new Date(ts).toISOString()).toBe(ts);
    }
  });

  it("normalizes malformed metadata safely", () => {
    const e = parseVaultData(
      docBytes([
        {
          id: "a",
          updatedAt: "2023-01-01T00:00:00.000Z",
          createdAt: 42,
          passwordUpdatedAt: "not a date",
          passwordUpdateCount: -3,
          labels: ["  work ", "", 7, "Work", "home", null],
          passwordHistory: [
            null,
            "str",
            { password: 5 },
            { password: "" },
            { password: "p1", replacedAt: "bad" },
            ...Array.from({ length: 10 }, (_, i) => ({
              password: `x${i}`,
              replacedAt: "2022-01-01T00:00:00.000Z",
            })),
          ],
        },
        { passwordUpdateCount: "7", labels: "work", passwordHistory: {} },
        { passwordUpdateCount: 2.9 },
        "not an object",
      ]),
    );
    const [a, b, c, d] = e.entries;
    expect(a.createdAt).toBe("2023-01-01T00:00:00.000Z");
    expect(a.passwordUpdatedAt).toBe("2023-01-01T00:00:00.000Z");
    expect(a.passwordUpdateCount).toBe(0);
    expect(a.labels).toEqual(["work", "home"]);
    expect(a.passwordHistory).toHaveLength(PASSWORD_HISTORY_LIMIT);
    expect(a.passwordHistory[0]).toEqual({
      password: "p1",
      replacedAt: "2023-01-01T00:00:00.000Z",
    });
    expect(b.passwordUpdateCount).toBe(0);
    expect(b.labels).toEqual([]);
    expect(b.passwordHistory).toEqual([]);
    expect(c.passwordUpdateCount).toBe(2);
    expect(d.id).toBeTruthy();
    expect(d.password).toBe("");
  });

  it("starts new entries without a pwned check", () => {
    expect(newEntry().pwnedCheck).toBeUndefined();
  });

  it("round-trips pwnedCheck", () => {
    const e = entry({
      pwnedCheck: {
        checkedAt: "2025-06-01T12:00:00.000Z",
        pwned: true,
        count: 12345,
      },
    });
    const parsed = parseVaultData(serializeVaultData(vaultData([e])));
    expect(parsed.entries[0].pwnedCheck).toEqual(e.pwnedCheck);
  });

  it("drops malformed pwnedCheck", () => {
    const cases: unknown[] = [
      "yes",
      { checkedAt: "2025-01-01T00:00:00.000Z", pwned: true }, // no count
      { checkedAt: "bad", pwned: true, count: 1 },
      { checkedAt: "2025-01-01T00:00:00.000Z", pwned: "yes", count: 1 },
      { checkedAt: "2025-01-01T00:00:00.000Z", pwned: true, count: -1 },
      { checkedAt: "2025-01-01T00:00:00.000Z", pwned: true, count: 1.5 },
      { checkedAt: "2025-01-01T00:00:00.000Z", pwned: true, count: "3" },
    ];
    for (const pwnedCheck of cases) {
      const e = parseVaultData(docBytes([{ name: "x", pwnedCheck }]))
        .entries[0];
      expect(e.pwnedCheck).toBeUndefined();
    }
    // A clean result survives alongside the malformed ones.
    const e = parseVaultData(
      docBytes([
        {
          name: "x",
          pwnedCheck: {
            checkedAt: "2025-01-01T00:00:00.000Z",
            pwned: false,
            count: 0,
          },
        },
      ]),
    ).entries[0];
    expect(e.pwnedCheck).toEqual({
      checkedAt: "2025-01-01T00:00:00.000Z",
      pwned: false,
      count: 0,
    });
  });
});

describe("applyPwnedCheck", () => {
  const check = {
    checkedAt: "2025-06-01T12:00:00.000Z",
    pwned: true,
    count: 10,
  };

  it("stores the result and labels pwned entries", () => {
    const e = applyPwnedCheck(entry({ labels: ["work"] }), check);
    expect(e.pwnedCheck).toEqual(check);
    expect(e.labels).toEqual(["work", PWNED_LABEL]);
  });

  it("removes the pwned label on a clean result", () => {
    const e = applyPwnedCheck(
      entry({ labels: [PWNED_LABEL, "work"] }),
      { ...check, pwned: false, count: 0 },
    );
    expect(e.pwnedCheck?.pwned).toBe(false);
    expect(e.labels).toEqual(["work"]);
  });

  it("clears the check and label when passed undefined", () => {
    const e = applyPwnedCheck(
      entry({
        labels: [PWNED_LABEL, "work"],
        pwnedCheck: check,
      }),
      undefined,
    );
    expect(e.pwnedCheck).toBeUndefined();
    expect(e.labels).toEqual(["work"]);
  });

  it("doesn't duplicate the label case-insensitively", () => {
    const e = applyPwnedCheck(entry({ labels: ["Pwned"] }), check);
    expect(e.labels).toEqual(["Pwned"]);
  });

  it("returns the same entry when nothing changes", () => {
    const e = entry();
    expect(applyPwnedCheck(e, undefined)).toBe(e);
  });
});

describe("finalizeEntryForSave", () => {
  const now = new Date("2025-01-01T12:00:00.000Z");

  it("records a password change", () => {
    const base = entry({ password: "old", passwordUpdateCount: 1 });
    const out = finalizeEntryForSave(base, { ...base, password: "new" }, now);
    expect(out.password).toBe("new");
    expect(out.passwordUpdatedAt).toBe(now.toISOString());
    expect(out.passwordUpdateCount).toBe(2);
    expect(out.passwordHistory).toEqual([
      { password: "old", replacedAt: now.toISOString() },
    ]);
    expect(out.createdAt).toBe(base.createdAt);
  });

  it("caps history at 5, newest first", () => {
    let saved = entry({ password: "p0" });
    for (let i = 1; i <= 8; i++) {
      saved = finalizeEntryForSave(saved, { ...saved, password: `p${i}` }, now);
    }
    expect(saved.passwordUpdateCount).toBe(8);
    expect(saved.passwordHistory.map((h) => h.password)).toEqual([
      "p7",
      "p6",
      "p5",
      "p4",
      "p3",
    ]);
  });

  it("does not record an empty previous password", () => {
    const base = entry({ password: "" });
    const out = finalizeEntryForSave(base, { ...base, password: "first" }, now);
    expect(out.passwordHistory).toEqual([]);
    expect(out.passwordUpdateCount).toBe(1);
    expect(out.passwordUpdatedAt).toBe(now.toISOString());
  });

  it("leaves metadata alone for non-password edits", () => {
    const base = entry({ password: "same" });
    const draft = {
      ...base,
      name: "n",
      username: "u",
      email: "e@x",
      url: "x.com",
      notes: "notes",
      labels: ["l"],
      updatedAt: now.toISOString(),
    };
    expect(finalizeEntryForSave(base, draft, now)).toEqual(draft);
  });

  it("ignores a password changed and then changed back", () => {
    const base = entry({ password: "same" });
    const out = finalizeEntryForSave(base, { ...base, password: "same" }, now);
    expect(out.passwordUpdateCount).toBe(0);
    expect(out.passwordHistory).toEqual([]);
  });

  it("is idempotent against the same baseline (save retry)", () => {
    const base = entry({ password: "old" });
    const once = finalizeEntryForSave(base, { ...base, password: "new" }, now);
    const twice = finalizeEntryForSave(base, once, now);
    expect(twice).toEqual(once);
  });

  it("stamps a new entry's first password at save time", () => {
    const draft = entry({ password: "pw" });
    const out = finalizeEntryForSave(undefined, draft, now);
    expect(out).toEqual({ ...draft, passwordUpdatedAt: now.toISOString() });
    expect(out.createdAt).toBe(draft.createdAt);
    expect(out.passwordUpdateCount).toBe(0);
    expect(out.passwordHistory).toEqual([]);
  });

  it("leaves new entries without a password alone", () => {
    const draft = entry({ name: "no pw yet" });
    expect(finalizeEntryForSave(undefined, draft, now)).toEqual(draft);
  });
});

describe("prepareVaultForSave / saveVaultDraft", () => {
  const now = new Date("2025-01-01T12:00:00.000Z");
  const a = entry({ id: "a", password: "a1" });
  const b = entry({ id: "b", password: "b1" });
  const c = entry({ id: "c", password: "c1" });
  const baseline: VaultData = vaultData([a, b, c]);
  const added = entry({ id: "d", password: "d1" });
  // a: password changed, b: deleted, c: unchanged, d: added (and reordered)
  const draft: VaultData = vaultData([added, { ...a, password: "a2" }, c]);

  it("matches entries by id", () => {
    const out = prepareVaultForSave(baseline, draft, now);
    expect(out.entries.map((e) => e.id)).toEqual(["d", "a", "c"]);
    expect(out.entries[0]).toEqual({ ...added, passwordUpdatedAt: now.toISOString() });
    expect(out.entries[1].passwordHistory[0].password).toBe("a1");
    expect(out.entries[1].passwordUpdateCount).toBe(1);
    expect(out.entries[2]).toEqual(c);
  });

  it("commits the finalized doc before persisting", async () => {
    const order: string[] = [];
    let plaintext: Uint8Array | null = null;
    const session = {
      dirty: true,
      update: (p: Uint8Array) => {
        order.push("update");
        plaintext = p;
      },
    };
    const out = await saveVaultDraft(session, baseline, draft, async () => {
      order.push("persist");
    }, now);
    expect(order).toEqual(["update", "persist"]);
    expect(parseVaultData(plaintext!)).toEqual(out);
    expect(out.entries[1].passwordUpdatedAt).toBe(now.toISOString());
  });

  it("propagates persist failures", async () => {
    const session = { dirty: true, update: vi.fn() };
    await expect(
      saveVaultDraft(session, baseline, draft, () => Promise.reject(new Error("409"))),
    ).rejects.toThrow("409");
  });

  it("doesn't touch a clean session", async () => {
    const session = { dirty: false, update: vi.fn() };
    const persist = vi.fn(() => Promise.resolve());
    const out = await saveVaultDraft(session, baseline, baseline, persist);
    expect(session.update).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledOnce();
    expect(out).toBe(baseline);
  });

  it("carries the draft's settings into the saved doc", async () => {
    const session = { dirty: true, update: vi.fn() };
    const out = await saveVaultDraft(
      session,
      baseline,
      vaultData([c], { checkPwnedOnEdit: false, allowPasswordFillSave: true }),
      () => Promise.resolve(),
      now,
    );
    expect(out.settings).toEqual({
      checkPwnedOnEdit: false,
      allowPasswordFillSave: true,
    });
  });
});

describe("vault settings", () => {
  it("defaults for new vaults and docs without settings", () => {
    expect(emptyVaultData().settings).toEqual(defaultVaultSettings());
    expect(parseVaultData(docBytes([])).settings).toEqual(
      defaultVaultSettings(),
    );
  });

  it("round-trips settings", () => {
    const parsed = parseVaultData(
      serializeVaultData(
        vaultData([], { checkPwnedOnEdit: false, allowPasswordFillSave: true }),
      ),
    );
    expect(parsed.settings).toEqual({
      checkPwnedOnEdit: false,
      allowPasswordFillSave: true,
    });
  });

  it("falls back per-key on malformed settings", () => {
    for (const settings of [
      "yes",
      null,
      { checkPwnedOnEdit: "yes" },
      { checkPwnedOnEdit: 1 },
      { allowPasswordFillSave: "no" },
    ]) {
      expect(parseVaultData(docBytes([], settings)).settings).toEqual(
        defaultVaultSettings(),
      );
    }
    expect(
      parseVaultData(
        docBytes([], { checkPwnedOnEdit: false, allowPasswordFillSave: true }),
      ).settings,
    ).toEqual({ checkPwnedOnEdit: false, allowPasswordFillSave: true });
    // Keys normalize independently — a bad one doesn't sink a good one.
    expect(
      parseVaultData(docBytes([], { checkPwnedOnEdit: "bad" })).settings,
    ).toEqual({ checkPwnedOnEdit: true, allowPasswordFillSave: false });
  });
});

describe("formatElapsed", () => {
  const at = (s: string) => new Date(s);
  const from = "2024-01-15T10:00:00.000Z";

  it("handles sub-day spans", () => {
    expect(formatElapsed(from, at(from))).toBe("less than a minute");
    expect(formatElapsed(from, at("2024-01-15T10:00:59.000Z"))).toBe(
      "less than a minute",
    );
    expect(formatElapsed(from, at("2024-01-15T10:01:00.000Z"))).toBe("1 minute");
    expect(formatElapsed(from, at("2024-01-15T10:59:00.000Z"))).toBe("59 minutes");
    expect(formatElapsed(from, at("2024-01-15T11:00:00.000Z"))).toBe("1 hour");
    expect(formatElapsed(from, at("2024-01-16T09:59:00.000Z"))).toBe("23 hours");
  });

  it("handles days", () => {
    expect(formatElapsed(from, at("2024-01-16T10:00:00.000Z"))).toBe("1 day");
    expect(formatElapsed(from, at("2024-01-18T10:00:00.000Z"))).toBe("3 days");
    expect(formatElapsed(from, at("2024-02-15T09:59:00.000Z"))).toBe("30 days");
  });

  it("handles months and days", () => {
    expect(formatElapsed(from, at("2024-02-15T10:00:00.000Z"))).toBe("1 month");
    expect(formatElapsed(from, at("2024-03-19T10:00:00.000Z"))).toBe(
      "2 months and 4 days",
    );
    expect(formatElapsed(from, at("2024-03-16T10:00:00.000Z"))).toBe(
      "2 months and 1 day",
    );
  });

  it("clamps month-end days", () => {
    expect(
      formatElapsed("2024-01-31T00:00:00.000Z", at("2024-02-29T00:00:00.000Z")),
    ).toBe("1 month");
    expect(
      formatElapsed("2024-01-31T00:00:00.000Z", at("2024-03-01T00:00:00.000Z")),
    ).toBe("1 month and 1 day");
  });

  it("handles years and months", () => {
    expect(formatElapsed(from, at("2025-01-15T10:00:00.000Z"))).toBe("1 year");
    expect(formatElapsed(from, at("2025-01-20T10:00:00.000Z"))).toBe(
      "1 year and 5 days",
    );
    expect(formatElapsed(from, at("2025-02-20T10:00:00.000Z"))).toBe(
      "1 year and 1 month",
    );
    expect(formatElapsed(from, at("2025-03-20T10:00:00.000Z"))).toBe(
      "1 year and 2 months",
    );
    expect(formatElapsed(from, at("2027-02-15T10:00:00.000Z"))).toBe(
      "3 years and 1 month",
    );
    expect(
      formatElapsed("2024-02-29T00:00:00.000Z", at("2025-02-28T00:00:00.000Z")),
    ).toBe("1 year");
  });

  it("handles future and invalid inputs", () => {
    expect(formatElapsed(from, at("2024-01-01T00:00:00.000Z"))).toBe(
      "less than a minute",
    );
    expect(formatElapsed("nope", at(from))).toBe("unknown");
    expect(formatElapsed(new Date(from), at(from))).toBe("less than a minute");
  });
});

describe("filterEntries", () => {
  const gh = entry({ name: "GitHub", username: "ralph", labels: ["work", "dev"] });
  const jira = entry({ name: "Jira", url: "jira.example.com", labels: ["Work"] });
  const bank = entry({ name: "Bank", notes: "personal checking", labels: ["finance"] });
  const all = [gh, jira, bank];

  it("returns everything for an empty query and no labels", () => {
    expect(filterEntries(all, "  ")).toBe(all);
  });

  it("requires every search term to match some field", () => {
    expect(filterEntries(all, "work")).toEqual([gh, jira]);
    expect(filterEntries(all, "work dev")).toEqual([gh]);
    expect(filterEntries(all, "github   RALPH")).toEqual([gh]);
    expect(filterEntries(all, "jira dev")).toEqual([]);
    expect(filterEntries(all, "personal")).toEqual([bank]);
  });

  it("requires every selected label, case-insensitively and exactly", () => {
    expect(filterEntries(all, "", ["work"])).toEqual([gh, jira]);
    expect(filterEntries(all, "", ["WORK", "dev"])).toEqual([gh]);
    expect(filterEntries(all, "", ["wor"])).toEqual([]);
  });

  it("combines label filters with search terms", () => {
    expect(filterEntries(all, "jira", ["work"])).toEqual([jira]);
    expect(filterEntries(all, "bank", ["work"])).toEqual([]);
  });
});
