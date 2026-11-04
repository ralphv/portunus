import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  SCHEMA_ISSUE_INVALID_JSON,
  SCHEMA_ISSUE_RULE,
  SCHEMA_ROOT_PATH,
} from "@/constants";

import { ZodSchemaValidatorProvider } from "./zod-schema-validator-provider";

const validator = new ZodSchemaValidatorProvider();

const schema = z.strictObject({
  name: z.string(),
  totp: z.strictObject({ secret: z.string().refine((s) => s.startsWith("JB")) }).optional(),
  tags: z.array(z.string()).optional(),
});

const SECRET = "SUPER-SECRET-VALUE-1234";

describe("ZodSchemaValidatorProvider.check", () => {
  it("returns the parsed, typed value", () => {
    const result = validator.check(schema, { name: "a", tags: ["x"] });
    expect(result).toEqual({ ok: true, value: { name: "a", tags: ["x"] } });
  });

  it("reports each failure as a dotted path and an issue code", () => {
    const result = validator.check(schema, { name: 1, tags: ["x", 2] });
    expect(result).toEqual({
      ok: false,
      issues: [
        { path: "name", code: "invalid_type" },
        { path: "tags.1", code: "invalid_type" },
      ],
    });
  });

  it("names unknown fields on a strict object", () => {
    const result = validator.check(schema, { name: "a", extra: true });
    expect(result).toEqual({ ok: false, issues: [{ path: SCHEMA_ROOT_PATH, code: "unrecognized_keys" }] });
  });

  it("reports a .refine() failure as a rule issue", () => {
    const result = validator.check(schema, { name: "a", totp: { secret: "nope" } });
    expect(result).toEqual({ ok: false, issues: [{ path: "totp.secret", code: SCHEMA_ISSUE_RULE }] });
  });

  it("uses the root path for a payload of the wrong kind", () => {
    const result = validator.check(schema, null);
    expect(result).toEqual({ ok: false, issues: [{ path: SCHEMA_ROOT_PATH, code: "invalid_type" }] });
  });

  it("never puts payload values in its issues", () => {
    const bad = [
      { name: SECRET, extra: SECRET },
      { name: "a", totp: { secret: SECRET } },
      { name: 1, tags: [SECRET, 2] },
      SECRET,
    ];
    for (const payload of bad) {
      const result = validator.check(schema, payload);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
  });
});

describe("ZodSchemaValidatorProvider.checkJson", () => {
  it("parses and checks JSON text", () => {
    expect(validator.checkJson(schema, '{"name":"a"}')).toEqual({ ok: true, value: { name: "a" } });
  });

  it("fails text that isn't JSON without echoing it", () => {
    const result = validator.checkJson(schema, `{not json ${SECRET}`);
    expect(result).toEqual({ ok: false, issues: [{ path: SCHEMA_ROOT_PATH, code: SCHEMA_ISSUE_INVALID_JSON }] });
  });

  it("checks parsed JSON like check()", () => {
    expect(validator.checkJson(schema, '{"name":2}')).toEqual({
      ok: false,
      issues: [{ path: "name", code: "invalid_type" }],
    });
  });
});
