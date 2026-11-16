import { describe, expect, it } from "vitest";

import {
  accentIndex,
  ACCENT_COUNT,
  avatarColorClass,
  brandIconStyle,
  isChromaticBrand,
  labelColorClass,
} from "./accent-color";

describe("accent colours", () => {
  it("gives a text the same colour every time, ignoring case and edge spaces", () => {
    expect(labelColorClass("work")).toBe(labelColorClass(" Work "));
    expect(avatarColorClass("GitHub")).toBe(avatarColorClass("github"));
  });

  it("stays within the palette's accents", () => {
    for (const t of ["", "a", "work", "dev", "home", "finance", "network", "ünïcödé"]) {
      const i = accentIndex(t);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(ACCENT_COUNT);
    }
  });

  it("gives the usual first labels different colours", () => {
    expect(new Set(["work", "dev", "finance"].map(accentIndex)).size).toBe(3);
  });

  it("spreads common labels over several colours", () => {
    const labels = ["work", "dev", "home", "finance", "network", "personal", "shopping", "social"];
    expect(new Set(labels.map(accentIndex)).size).toBeGreaterThanOrEqual(4);
  });

  it("uses label-N / avatar-N palette roles", () => {
    expect(labelColorClass("work")).toMatch(/^bg-label-[1-6] text-on-label-[1-6]$/);
    expect(avatarColorClass("work")).toMatch(/^bg-avatar-[1-6] text-on-avatar-[1-6]$/);
  });

  it("tints only chromatic brands", () => {
    expect(isChromaticBrand("E50914")).toBe(true); // Netflix red
    expect(isChromaticBrand("1ED760")).toBe(true); // Spotify green
    expect(isChromaticBrand("181717")).toBe(false); // GitHub near-black
    expect(isChromaticBrand("000000")).toBe(false);
    expect(isChromaticBrand("FFFFFF")).toBe(false);
    expect(isChromaticBrand(undefined)).toBe(false);
    expect(isChromaticBrand("nope")).toBe(false);
  });

  it("passes the brand colour as a CSS custom property", () => {
    expect(brandIconStyle("E50914")).toEqual({ "--brand": "#E50914" });
  });
});
