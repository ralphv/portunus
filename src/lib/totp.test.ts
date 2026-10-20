import { describe, expect, it } from "vitest";

import {
  base32Decode,
  base32Encode,
  generateTotp,
  normalizeTotpSecret,
  parseTotp,
  TOTP_URGENT_SECONDS,
  totpSecondsRemaining,
  totpUri,
} from "./totp";

const te = new TextEncoder();

// RFC 6238 seed values are these ASCII strings; the app stores the
// base32-encoded form like every authenticator.
const SEED8 = "12345678901234567890";
const SEED8_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const SEED32 = "12345678901234567890123456789012";
const SEED64 =
  "1234567890123456789012345678901234567890123456789012345678901234";

function params(partial: Partial<Parameters<typeof generateTotp>[0]> = {}) {
  return {
    secret: SEED8_B32,
    algorithm: "SHA1" as const,
    digits: 8,
    period: 30,
    issuer: "",
    account: "",
    ...partial,
  };
}

describe("base32", () => {
  it("decodes the RFC 6238 seed", () => {
    expect(base32Decode(SEED8_B32)).toEqual(te.encode(SEED8));
  });

  it("decodes lowercase and padded input", () => {
    expect(base32Decode("mfrggzdfmy======")).toEqual(te.encode("abcdef"));
  });

  it("rejects bad characters and misplaced padding", () => {
    expect(base32Decode("GEZDGNBV!")).toBeNull();
    expect(base32Decode("GE=Z")).toBeNull();
    expect(base32Decode("")).toBeNull();
    expect(base32Decode("====")).toBeNull();
  });

  it("ignores spaces and dashes", () => {
    expect(base32Decode("gezd gnbv-gy3tqo jq")).toEqual(
      base32Decode("GEZDGNBVGY3TQOJQ"),
    );
  });

  it("round-trips through encode", () => {
    const bytes = te.encode("round trip!");
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });
});

describe("generateTotp — RFC 6238 vectors (8 digits, 30s)", () => {
  const cases: [number, string][] = [
    [59_000, "94287082"],
    [1_111_111_109_000, "07081804"],
    [1_111_111_111_000, "14050471"],
    [1_234_567_890_000, "89005924"],
    [2_000_000_000_000, "69279037"],
    [20_000_000_000_000, "65353130"],
  ];

  it.each(cases)("SHA1 at %d ms → %s", async (t, expected) => {
    expect(await generateTotp(params(), t)).toBe(expected);
  });

  it.each([
    [59_000, "46119246"],
    [1_111_111_109_000, "68084774"],
    [1_111_111_111_000, "67062674"],
    [1_234_567_890_000, "91819424"],
    [2_000_000_000_000, "90698825"],
    [20_000_000_000_000, "77737706"],
  ])("SHA256 at %d ms → %s", async (t, expected) => {
    expect(
      await generateTotp(
        params({ secret: base32Encode(te.encode(SEED32)), algorithm: "SHA256" }),
        t,
      ),
    ).toBe(expected);
  });

  it.each([
    [59_000, "90693936"],
    [1_111_111_109_000, "25091201"],
    [1_111_111_111_000, "99943326"],
    [1_234_567_890_000, "93441116"],
    [2_000_000_000_000, "38618901"],
    [20_000_000_000_000, "47863826"],
  ])("SHA512 at %d ms → %s", async (t, expected) => {
    expect(
      await generateTotp(
        params({ secret: base32Encode(te.encode(SEED64)), algorithm: "SHA512" }),
        t,
      ),
    ).toBe(expected);
  });

  it("zero-pads short results", async () => {
    // No assertion on the value — just the shape.
    const code = await generateTotp(params({ digits: 6 }), 59_000);
    expect(code).toMatch(/^\d{6}$/);
  });
});

describe("parseTotp", () => {
  it("parses a bare base32 secret", () => {
    expect(parseTotp(SEED8_B32)).toEqual({
      secret: SEED8_B32,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      issuer: "",
      account: "",
    });
  });

  it("parses a full otpauth URI", () => {
    const p = parseTotp(
      "otpauth://totp/ACME:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME&algorithm=SHA256&digits=8&period=60",
    );
    expect(p).toEqual({
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA256",
      digits: 8,
      period: 60,
      issuer: "ACME",
      account: "alice@example.com",
    });
  });

  it("takes the issuer from the label when the param is absent", () => {
    const p = parseTotp(`otpauth://totp/GitHub:bob?secret=${SEED8_B32}`);
    expect(p?.issuer).toBe("GitHub");
    expect(p?.account).toBe("bob");
  });

  it("accepts a lowercase/spaced bare secret", () => {
    expect(parseTotp("jbsw y3dp-ehpk3pxp")?.secret).toBe("JBSWY3DPEHPK3PXP");
  });

  it("rejects invalid input", () => {
    expect(parseTotp("")).toBeNull();
    expect(parseTotp("not a secret!")).toBeNull();
    // 5 bytes < the 80-bit minimum.
    expect(parseTotp("AAAAAAAA")).toBeNull();
    expect(parseTotp("otpauth://totp/x?algorithm=MD5&secret=" + SEED8_B32)).toBeNull();
    expect(parseTotp("otpauth://totp/x?digits=4&secret=" + SEED8_B32)).toBeNull();
    expect(parseTotp("otpauth://totp/x?secret=")).toBeNull();
    expect(parseTotp("otpauth://totp/x")).toBeNull();
  });
});

describe("totpUri / normalizeTotpSecret", () => {
  it("canonicalizes a bare secret into an otpauth URI", () => {
    expect(normalizeTotpSecret("jbswy3dpehpk3pxp")).toBe(
      "otpauth://totp/account?secret=JBSWY3DPEHPK3PXP",
    );
  });

  it("keeps non-default params and issuer", () => {
    const uri = normalizeTotpSecret(
      "otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP&issuer=ACME&digits=8&period=60&algorithm=SHA256",
    );
    expect(uri).toBe(
      "otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP&issuer=ACME&algorithm=SHA256&digits=8&period=60",
    );
  });

  it("round-trips", () => {
    const p = parseTotp(
      "otpauth://totp/Issuer:name?secret=JBSWY3DPEHPK3PXP&digits=8",
    );
    expect(parseTotp(totpUri(p!))).toEqual(p);
  });

  it("rejects junk", () => {
    expect(normalizeTotpSecret("hello")).toBeNull();
  });
});

describe("totpSecondsRemaining", () => {
  it("counts down within the period", () => {
    expect(totpSecondsRemaining(30, 61_000)).toBe(29);
    expect(totpSecondsRemaining(30, 90_000)).toBe(30);
  });
});

describe("TOTP_URGENT_SECONDS", () => {
  it("is a sane last-few-seconds threshold", () => {
    expect(TOTP_URGENT_SECONDS).toBe(5);
  });
});
