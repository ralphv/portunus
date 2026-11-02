import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createSchemaValidatorFactory } from "@/factory";

describe("createSchemaValidatorFactory", () => {
  it("returns a working validator", () => {
    const validator = createSchemaValidatorFactory();
    expect(validator.check(z.string(), "x")).toEqual({ ok: true, value: "x" });
    expect(validator.check(z.string(), 1).ok).toBe(false);
  });

  it("gives each caller a fresh instance (the provider is stateless)", () => {
    expect(createSchemaValidatorFactory()).not.toBe(createSchemaValidatorFactory());
  });
});
