import { describe, expect, it } from "vitest";

import { VaultError } from "@/crypto";
import {
  emptyVaultData,
  newEntry,
  parseVaultData,
  serializeVaultData,
  VAULT_DATA_FORMAT,
} from "./vault-doc";

const te = new TextEncoder();

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
