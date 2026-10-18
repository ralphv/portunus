import { describe, expect, it } from "vitest";

import { VaultError } from "@/crypto";
import {
  emptyVaultData,
  entryHref,
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
