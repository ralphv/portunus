// Canonical JSON encoding used to bind envelope header fields as AEAD AAD.
// Object keys are sorted recursively so the encoding does not depend on
// field order in the stored file.

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
    );
  return `{${entries.join(",")}}`;
}

export function aadBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}
