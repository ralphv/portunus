import type { z } from "zod";

import {
  SCHEMA_ISSUE_INVALID_JSON,
  SCHEMA_ISSUE_RULE,
  SCHEMA_ROOT_PATH,
} from "@/constants";

import type {
  SchemaCheckResult,
  SchemaIssue,
  SchemaValidatorInterface,
} from "../schema-validator-interface";

// Zod does the checking; this only reduces its issues to path + code. Zod's
// own messages and `input` are dropped on purpose — they can quote the
// payload, and payloads hold secrets.
export class ZodSchemaValidatorProvider implements SchemaValidatorInterface {
  check<S extends z.ZodType>(schema: S, payload: unknown): SchemaCheckResult<z.output<S>> {
    const result = schema.safeParse(payload);
    if (result.success) return { ok: true, value: result.data };
    return { ok: false, issues: result.error.issues.map(toIssue) };
  }

  checkJson<S extends z.ZodType>(schema: S, text: string): SchemaCheckResult<z.output<S>> {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, issues: [{ path: SCHEMA_ROOT_PATH, code: SCHEMA_ISSUE_INVALID_JSON }] };
    }
    return this.check(schema, payload);
  }
}

function toIssue(issue: z.core.$ZodIssue): SchemaIssue {
  return {
    path: issue.path.length ? issue.path.map(String).join(".") : SCHEMA_ROOT_PATH,
    // .refine() failures come back as "custom"; name them for what they are.
    code: issue.code === "custom" ? SCHEMA_ISSUE_RULE : issue.code,
  };
}
