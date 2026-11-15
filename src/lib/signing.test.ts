import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VAULT_WRAPPER_VERSION_BOUND,
  WRAPPER_SIGNATURE_CONTEXT_V2,
  WRAPPER_SIGNATURE_CONTEXT_V3,
} from "@/constants";

import {
  assertSigningRequirements,
  boundSignedMessage,
  legacySignedMessage,
  openStoredVault,
  parseStoredVault,
  serializeStoredVault,
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
      bound: false,
      payload: ENVELOPE,
      signature: "c2ln",
    });
    expect(parseStoredVault(wrapSigned(ENVELOPE, "c2ln", undefined, true))).toEqual({
      kind: "signed",
      bound: true,
      payload: ENVELOPE,
      signature: "c2ln",
    });
  });

  it.each([2, 4, "3", null])("flags an unknown wrapper version %s as malformed", (version) => {
    expect(
      parseStoredVault(JSON.stringify({ version, payload: ENVELOPE, signature: "c2ln" })),
    ).toEqual({ kind: "malformed" });
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
    const stored = await serializeStoredVault("f", ENVELOPE, TOTP);
    expect(JSON.parse(stored)).toEqual({
      version: VAULT_WRAPPER_VERSION_BOUND,
      payload: ENVELOPE,
      totp: TOTP,
      signature: expect.any(String),
    });
    expect(await openStoredVault("f", stored)).toEqual({ payload: ENVELOPE, totp: TOTP });
  });

  it("rejects a stripped, swapped, or added totp block", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const withTotp = JSON.parse(await serializeStoredVault("f", ENVELOPE, TOTP));
    const without = JSON.parse(await serializeStoredVault("f", ENVELOPE));

    const stripped = { payload: withTotp.payload, signature: withTotp.signature };
    const swapped = { ...withTotp, totp: { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" } };
    const added = { ...without, totp: TOTP };
    for (const tampered of [stripped, swapped, added]) {
      expect(await openStoredVault("f", JSON.stringify(tampered))).toBeNull();
    }
    vi.restoreAllMocks();
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
    const stored = await serializeStoredVault("f", ENVELOPE, TOTP);
    expect(await openStoredVault("f", stored)).toEqual({ payload: ENVELOPE, totp: TOTP });
    expect(await serializeStoredVault("f", ENVELOPE)).toBe(ENVELOPE);
  });
});

describe("file-id binding (wrapper version 3)", () => {
  const TOTP = { secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" };
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("signs the v3 tag + canonical { fileId, payload, totp? }", () => {
    expect(boundSignedMessage("f1", ENVELOPE)).toBe(
      WRAPPER_SIGNATURE_CONTEXT_V3 + JSON.stringify({ fileId: "f1", payload: ENVELOPE }),
    );
    expect(boundSignedMessage("f1", ENVELOPE, TOTP)).toBe(
      WRAPPER_SIGNATURE_CONTEXT_V3 +
        JSON.stringify({ fileId: "f1", payload: ENVELOPE, totp: TOTP }),
    );
  });

  it.each([
    ["without", undefined],
    ["with", TOTP],
  ])("writes version 3 and verifies only for its own file id (%s totp)", async (_n, totp) => {
    const stored = await serializeStoredVault("file-a", ENVELOPE, totp);
    expect(JSON.parse(stored).version).toBe(VAULT_WRAPPER_VERSION_BOUND);
    expect(await openStoredVault("file-a", stored)).toEqual(
      totp ? { payload: ENVELOPE, totp } : { payload: ENVELOPE },
    );
    // Copied to another file (or another account's file): refused.
    expect(await openStoredVault("file-b", stored)).toBeNull();
  });

  it.each([
    ["without", undefined],
    ["with", TOTP],
  ])("can't be downgraded by deleting the version field (%s totp)", async (_n, totp) => {
    const legacyShaped = JSON.parse(await serializeStoredVault("file-a", ENVELOPE, totp));
    delete legacyShaped.version;
    expect(await openStoredVault("file-a", JSON.stringify(legacyShaped))).toBeNull();
  });

  it("refuses a v3 message smuggled in as a legacy bare payload", async () => {
    const message = boundSignedMessage("file-a", ENVELOPE);
    const smuggled = wrapSigned(message, await signPayload(message));
    expect(await openStoredVault("file-a", smuggled)).toBeNull();
    expect(legacySignedMessage(message)).toBeNull();
    expect(legacySignedMessage(`${WRAPPER_SIGNATURE_CONTEXT_V2}{}`)).toBeNull();
  });

  it("refuses a legacy signature relabelled as version 3", async () => {
    const legacy = wrapSigned(ENVELOPE, await signPayload(ENVELOPE));
    const relabelled = JSON.stringify({ version: 3, ...JSON.parse(legacy) });
    expect(await openStoredVault("file-a", relabelled)).toBeNull();
  });

  describe("legacy formats still verify (re-signed on the next save)", () => {
    it("bare-payload signature", async () => {
      expect(legacySignedMessage(ENVELOPE)).toBe(ENVELOPE);
      const legacy = wrapSigned(ENVELOPE, await signPayload(ENVELOPE));
      expect(await openStoredVault("any-file", legacy)).toEqual({ payload: ENVELOPE });
    });

    it("v2 payload + totp signature", async () => {
      const message = legacySignedMessage(ENVELOPE, TOTP)!;
      expect(message.startsWith(WRAPPER_SIGNATURE_CONTEXT_V2)).toBe(true);
      const legacy = wrapSigned(ENVELOPE, await signPayload(message), TOTP);
      expect(await openStoredVault("any-file", legacy)).toEqual({ payload: ENVELOPE, totp: TOTP });
      // Stripping or swapping the block still breaks it.
      const stripped = JSON.parse(legacy);
      delete stripped.totp;
      expect(await openStoredVault("any-file", JSON.stringify(stripped))).toBeNull();
    });
  });
});
