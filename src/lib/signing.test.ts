import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertSigningRequirements,
  openStoredVault,
  parseStoredVault,
  serializeStoredVault,
  signedMessage,
  signPayload,
  verifyPayload,
  wrapSigned,
} from "./signing";
import { testSigningKey } from "./signing.test-helper";

const ENVELOPE = JSON.stringify({ format: "portunus-vault", version: 1, ct: "abc" });

beforeEach(() => {
  vi.stubEnv("PORTUNUS_DEMO_MODE", "");
  vi.stubEnv("PORTUNUS_SIGNATURES_DISABLED", "");
  vi.stubEnv("PORTUNUS_ALLOW_MISSING_SIGNATURE", "");
  vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", testSigningKey());
});
afterEach(() => vi.unstubAllEnvs());

describe("signPayload / verifyPayload", () => {
  it("round-trips a signature", async () => {
    const sig = await signPayload(ENVELOPE);
    expect(Buffer.from(sig, "base64")).toHaveLength(64);
    expect(await verifyPayload(ENVELOPE, sig)).toBe(true);
  });

  it("rejects a tampered payload", async () => {
    const sig = await signPayload(ENVELOPE);
    expect(await verifyPayload(ENVELOPE.replace("abc", "abd"), sig)).toBe(false);
  });

  it("rejects a signature from a different key", async () => {
    const sig = await signPayload(ENVELOPE);
    vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", testSigningKey());
    expect(await verifyPayload(ENVELOPE, sig)).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["not base64", "!!!"],
    ["wrong length", Buffer.alloc(32).toString("base64")],
  ])("rejects a malformed signature (%s)", async (_name, sig) => {
    expect(await verifyPayload(ENVELOPE, sig)).toBe(false);
  });

  it("skips signing and passes verification when disabled", async () => {
    vi.stubEnv("PORTUNUS_SIGNATURES_DISABLED", "1");
    vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", "");
    expect(await signPayload(ENVELOPE)).toBe("");
    expect(await verifyPayload(ENVELOPE, "garbage")).toBe(true);
  });

  it("skips signing and passes verification in demo mode", async () => {
    vi.stubEnv("PORTUNUS_DEMO_MODE", "1");
    vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", "");
    expect(await signPayload(ENVELOPE)).toBe("");
    expect(await verifyPayload(ENVELOPE, "garbage")).toBe(true);
  });
});

describe("assertSigningRequirements", () => {
  it("passes with a valid key", () => {
    expect(() => assertSigningRequirements()).not.toThrow();
  });

  it("throws naming the variable when the key is missing", () => {
    vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", "");
    expect(() => assertSigningRequirements()).toThrow(/PORTUNUS_SIGNING_PRIVATE_KEY is not set/);
  });

  it("still requires the key with PORTUNUS_ALLOW_MISSING_SIGNATURE=1", () => {
    vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", "");
    vi.stubEnv("PORTUNUS_ALLOW_MISSING_SIGNATURE", "1");
    expect(() => assertSigningRequirements()).toThrow(/PORTUNUS_SIGNING_PRIVATE_KEY/);
  });

  it.each([
    ["garbage", "not-a-key!", /not valid base64/],
    ["non-key base64", Buffer.from("hello").toString("base64"), /not a valid PKCS#8/],
    [
      "PEM",
      "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEI...\n-----END PRIVATE KEY-----",
      /not PEM/,
    ],
    [
      "a non-Ed25519 key",
      generateKeyPairSync("x25519")
        .privateKey.export({ format: "der", type: "pkcs8" })
        .toString("base64"),
      /must be an Ed25519 key/,
    ],
  ])("throws on %s", (_name, value, message) => {
    vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", value);
    expect(() => assertSigningRequirements()).toThrow(message);
  });

  it.each(["PORTUNUS_SIGNATURES_DISABLED", "PORTUNUS_DEMO_MODE"])(
    "needs no key when %s=1",
    (flag) => {
      vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", "");
      vi.stubEnv(flag, "1");
      expect(() => assertSigningRequirements()).not.toThrow();
    },
  );
});

describe("parseStoredVault", () => {
  it("recognizes the signed wrapper", () => {
    expect(parseStoredVault(wrapSigned(ENVELOPE, "c2ln"))).toEqual({
      kind: "signed",
      payload: ENVELOPE,
      signature: "c2ln",
    });
  });

  it.each([ENVELOPE, "not json", "42", "[]"])("treats %s as unsigned", (text) => {
    expect(parseStoredVault(text)).toEqual({ kind: "unsigned", contents: text });
  });

  it.each([
    JSON.stringify({ payload: ENVELOPE }),
    JSON.stringify({ signature: "c2ln" }),
    JSON.stringify({ payload: ENVELOPE, signature: 1 }),
  ])("flags a half-stripped wrapper %s as malformed", (text) => {
    expect(parseStoredVault(text)).toEqual({ kind: "malformed" });
  });
});

describe("totp block in the signed wrapper", () => {
  const TOTP = { secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" };

  it("signs payload + totp block together and round-trips", async () => {
    const stored = await serializeStoredVault(ENVELOPE, TOTP);
    expect(JSON.parse(stored)).toEqual({
      payload: ENVELOPE,
      totp: TOTP,
      signature: expect.any(String),
    });
    expect(await openStoredVault("f", stored)).toEqual({ payload: ENVELOPE, totp: TOTP });
  });

  it("rejects a stripped, swapped, or added totp block", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const withTotp = JSON.parse(await serializeStoredVault(ENVELOPE, TOTP));
    const without = JSON.parse(await serializeStoredVault(ENVELOPE));

    const stripped = { payload: withTotp.payload, signature: withTotp.signature };
    const swapped = { ...withTotp, totp: { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" } };
    const added = { ...without, totp: TOTP };
    for (const tampered of [stripped, swapped, added]) {
      expect(await openStoredVault("f", JSON.stringify(tampered))).toBeNull();
    }
    vi.restoreAllMocks();
  });

  it("keeps the no-totp signed message identical to the bare payload", async () => {
    expect(signedMessage(ENVELOPE)).toBe(ENVELOPE);
    expect(signedMessage(ENVELOPE, TOTP)).not.toBe(ENVELOPE);
    const legacy = wrapSigned(ENVELOPE, await signPayload(ENVELOPE));
    expect(await openStoredVault("f", legacy)).toEqual({ payload: ENVELOPE });
  });

  it("treats a malformed totp block as a malformed wrapper", () => {
    const sig = "x".repeat(88);
    for (const totp of [null, "s", { secret: "" }, { secret: 1 }, { secret: "A", x: 1 }]) {
      expect(parseStoredVault(JSON.stringify({ payload: ENVELOPE, totp, signature: sig }))).toEqual({
        kind: "malformed",
      });
    }
    expect(parseStoredVault(JSON.stringify({ totp: TOTP }))).toEqual({ kind: "malformed" });
  });

  it("keeps the block, unsigned, when signatures are disabled", async () => {
    vi.stubEnv("PORTUNUS_SIGNATURES_DISABLED", "1");
    const stored = await serializeStoredVault(ENVELOPE, TOTP);
    expect(await openStoredVault("f", stored)).toEqual({ payload: ENVELOPE, totp: TOTP });
    expect(await serializeStoredVault(ENVELOPE)).toBe(ENVELOPE);
  });
});
