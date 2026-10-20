// Have I Been Pwned "Pwned Passwords" range API, with k-anonymity.
// Only the first 5 hex chars of the SHA-1 hash leave the client; the
// returned suffixes are matched locally. `Add-Padding: true` asks the API
// to pad the response so real vs. decoy lookups can't be told apart by
// traffic analysis.

const RANGE_URL = "https://api.pwnedpasswords.com/range/";
const PREFIX_LEN = 5;

export type PwnedCheckErrorKind = "network" | "http" | "aborted";

// Lets callers tell "couldn't check" (offline, rate-limited, blocked by
// CSP/network policy) from "checked and not pwned".
export class PwnedCheckError extends Error {
  readonly kind: PwnedCheckErrorKind;
  readonly status?: number;

  constructor(kind: PwnedCheckErrorKind, message: string, status?: number) {
    super(message);
    this.name = "PwnedCheckError";
    this.kind = kind;
    this.status = status;
  }
}

export type PwnedCheckResult = {
  pwned: boolean;
  // How many times the password was seen in breaches (0 when not found).
  count: number;
};

const te = new TextEncoder();

export async function sha1HexUpper(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", te.encode(text));
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
}

// Parses the range response body (`SUFFIX:count` per line; padded responses
// include decoy lines with count 0 — matching one means "not pwned").
function findSuffixCount(body: string, suffix: string): number {
  for (const line of body.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    if (line.slice(0, colon).trim() === suffix) {
      const count = Number.parseInt(line.slice(colon + 1).trim(), 10);
      return Number.isNaN(count) ? 0 : count;
    }
  }
  return 0;
}

export async function checkPasswordPwned(
  password: string,
  options: { signal?: AbortSignal } = {},
): Promise<PwnedCheckResult> {
  const hash = await sha1HexUpper(password);
  const prefix = hash.slice(0, PREFIX_LEN);
  const suffix = hash.slice(PREFIX_LEN);

  let res: Response;
  try {
    res = await fetch(`${RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true" },
      // Never send cookies/Origin-identifying headers to the third party.
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: options.signal ?? null,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new PwnedCheckError("aborted", "Check cancelled");
    }
    throw new PwnedCheckError(
      "network",
      "Couldn't reach the Pwned Passwords API",
    );
  }
  if (!res.ok) {
    throw new PwnedCheckError(
      "http",
      `Pwned Passwords API returned ${res.status}`,
      res.status,
    );
  }

  const count = findSuffixCount(await res.text(), suffix);
  return { pwned: count > 0, count };
}
