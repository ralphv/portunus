import type { z } from "zod";

// Checks external input against a Zod schema (src/lib/schemas/*.schema.ts).
// Server-side only for now (see AGENTS.md).
//
// An issue names where and why a payload failed — never the offending
// value: payloads hold tokens, ciphertext and TOTP secrets that must not
// reach logs or responses.

export type SchemaIssue = {
  /** Dotted path into the payload, e.g. "totp.secret"; SCHEMA_ROOT_PATH for the whole. */
  path: string;
  /** Zod's issue code ("invalid_type", "unrecognized_keys", …) or SCHEMA_ISSUE_*. */
  code: string;
};

export type SchemaCheckResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: SchemaIssue[] };

export interface SchemaValidatorInterface {
  /** Checks an already-parsed value. */
  check<S extends z.ZodType>(schema: S, payload: unknown): SchemaCheckResult<z.output<S>>;
  /** Parses JSON text, then checks it; text that isn't JSON fails with SCHEMA_ISSUE_INVALID_JSON. */
  checkJson<S extends z.ZodType>(schema: S, text: string): SchemaCheckResult<z.output<S>>;
}
