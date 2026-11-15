import { describe, expect, it } from "vitest";
import { isBlankEntry, newPublicEntry } from "./vault-public";
import type { PublicEntry } from "./vault-public";

describe("isBlankEntry", () => {
  it("is true for a fresh entry", () => {
    expect(isBlankEntry(newPublicEntry())).toBe(true);
  });

  it("ignores whitespace-only text", () => {
    expect(isBlankEntry({ ...newPublicEntry(), name: "  ", notes: "\n" })).toBe(true);
  });

  it.each<[string, Partial<PublicEntry>]>([
    ["name", { name: "GitHub" }],
    ["username", { username: "octocat" }],
    ["email", { email: "a@example.com" }],
    ["url", { url: "https://example.com" }],
    ["notes", { notes: "note" }],
    ["labels", { labels: ["work"] }],
    ["password", { hasPassword: true }],
    ["two-factor secret", { hasTotp: true }],
    ["icon", { iconSlug: "github" }],
    ["SSO provider", { ssoProvider: "Google" }],
  ])("is false once the %s is set", (_, patch) => {
    expect(isBlankEntry({ ...newPublicEntry(), ...patch })).toBe(false);
  });
});
