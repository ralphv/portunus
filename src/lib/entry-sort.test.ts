import { describe, expect, it } from "vitest";

import { isSortOrder, SORT_ORDERS, sortEntries } from "./entry-sort";
import type { SortFields } from "./entry-sort";

function entry(id: string, over: Partial<SortFields> = {}): SortFields {
  return {
    id,
    name: id,
    url: "",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    passwordUpdatedAt: "2024-01-01T00:00:00.000Z",
    ...over,
  };
}

const ids = (list: SortFields[]) => list.map((e) => e.id);

describe("sortEntries", () => {
  it("vault order returns the input untouched", () => {
    const list = [entry("b"), entry("a")];
    expect(sortEntries(list, "vault")).toBe(list);
  });

  it("never mutates the input array", () => {
    const list = [entry("b"), entry("a")];
    sortEntries(list, "name-asc");
    expect(ids(list)).toEqual(["b", "a"]);
  });

  it("sorts names case-insensitively and numerically, blanks last", () => {
    const list = [
      entry("1", { name: "item 10" }),
      entry("2", { name: "" }),
      entry("3", { name: "Beta" }),
      entry("4", { name: "item 9" }),
      entry("5", { name: "alpha" }),
    ];
    expect(ids(sortEntries(list, "name-asc"))).toEqual(["5", "3", "4", "1", "2"]);
    expect(ids(sortEntries(list, "name-desc"))).toEqual(["1", "4", "3", "5", "2"]);
  });

  it("sorts by website host, then name; entries without a URL last", () => {
    const list = [
      entry("none", { name: "A" }),
      entry("gh2", { name: "Work", url: "https://www.github.com/x" }),
      entry("amz", { url: "amazon.com" }),
      entry("gh1", { name: "Personal", url: "github.com" }),
    ];
    expect(ids(sortEntries(list, "site"))).toEqual(["amz", "gh1", "gh2", "none"]);
  });

  it("sorts by timestamps", () => {
    const list = [
      entry("mid", {
        createdAt: "2024-02-01T00:00:00.000Z",
        updatedAt: "2024-05-01T00:00:00.000Z",
        passwordUpdatedAt: "2024-02-01T00:00:00.000Z",
      }),
      entry("old", {
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2024-09-01T00:00:00.000Z",
        passwordUpdatedAt: "2024-09-01T00:00:00.000Z",
      }),
      entry("new", {
        createdAt: "2024-06-01T00:00:00.000Z",
        updatedAt: "2024-06-01T00:00:00.000Z",
        passwordUpdatedAt: "2024-06-01T00:00:00.000Z",
      }),
    ];
    expect(ids(sortEntries(list, "updated"))).toEqual(["old", "new", "mid"]);
    expect(ids(sortEntries(list, "created-desc"))).toEqual(["new", "mid", "old"]);
    expect(ids(sortEntries(list, "created-asc"))).toEqual(["old", "mid", "new"]);
    expect(ids(sortEntries(list, "password-age"))).toEqual(["mid", "new", "old"]);
  });

  it("keeps vault order for ties", () => {
    const list = [entry("x", { name: "Same" }), entry("y", { name: "same" })];
    expect(ids(sortEntries(list, "name-asc"))).toEqual(["x", "y"]);
    expect(ids(sortEntries(list, "name-desc"))).toEqual(["x", "y"]);
  });

  it("sorts by the basis values and lists entries missing from it first", () => {
    const saved = [entry("a", { name: "Alpha" }), entry("b", { name: "Beta" })];
    // "a" is being renamed in the draft; "n" was added but not saved yet.
    const draft = [
      entry("n", { name: "Zulu" }),
      entry("b", { name: "Beta" }),
      entry("a", { name: "Zzz" }),
    ];
    const basis = new Map(saved.map((e) => [e.id, e]));
    expect(ids(sortEntries(draft, "name-asc", basis))).toEqual(["n", "a", "b"]);
  });
});

describe("isSortOrder", () => {
  it("accepts every listed order and rejects anything else", () => {
    for (const o of SORT_ORDERS) expect(isSortOrder(o.id)).toBe(true);
    expect(isSortOrder("bogus")).toBe(false);
    expect(isSortOrder(null)).toBe(false);
  });
});
