import { describe, expect, it } from "vitest";

import { DEVICE_UNLOCK_FORMAT } from "@/constants";

import { b64decode, b64encode } from "./base64";
import {
  checkDeviceUnlockRecord,
  generatePrfSalt,
  parseDeviceUnlockRecord,
  serializeDeviceUnlockRecord,
  unwrapDeviceDataKey,
  vaultHeaderDigest,
  wrapDataKeyForDevice,
} from "./device-unlock";
import type { DeviceUnlockMeta, DeviceUnlockRecord } from "./device-unlock";
import { DeviceUnlockError, DeviceUnlockStaleError } from "./errors";
import { defaultEngine } from "./registry";

const prf = () => crypto.getRandomValues(new Uint8Array(32));
const meta = (): DeviceUnlockMeta => ({
  kid: "0123456789abcdef",
  credentialId: b64encode(crypto.getRandomValues(new Uint8Array(20))),
  prfSalt: generatePrfSalt(),
});

async function enrolled() {
  const { header, dataKey } = await defaultEngine().initNew({
    password: "pw",
    keyfile: crypto.getRandomValues(new Uint8Array(32)),
  });
  const secret = prf();
  const record = await wrapDataKeyForDevice({
    dataKey,
    header,
    prf: secret,
    meta: meta(),
  });
  return { header, dataKey, secret, record };
}

function flip(b64: string): string {
  const bytes = b64decode(b64);
  bytes[bytes.length - 1] ^= 1;
  return b64encode(bytes);
}

describe("device unlock", () => {
  it("round-trips the data key with the right PRF secret", async () => {
    const { header, dataKey, secret, record } = await enrolled();
    const got = await unwrapDeviceDataKey(record, header, secret);
    expect(got).toEqual(dataKey);
  });

  it("never stores the data key or the PRF secret in the record", async () => {
    const { dataKey, secret, record } = await enrolled();
    const text = serializeDeviceUnlockRecord(record);
    expect(text).not.toContain(b64encode(dataKey));
    expect(text).not.toContain(b64encode(secret));
  });

  it("refuses a wrong PRF secret with a generic error", async () => {
    const { header, record } = await enrolled();
    const err = await unwrapDeviceDataKey(record, header, prf()).catch((e) => e);
    expect(err).toBeInstanceOf(DeviceUnlockError);
    expect(err).not.toBeInstanceOf(DeviceUnlockStaleError);
  });

  it("refuses a PRF output of the wrong length", async () => {
    const { header, record } = await enrolled();
    await expect(
      unwrapDeviceDataKey(record, header, new Uint8Array(16)),
    ).rejects.toBeInstanceOf(DeviceUnlockError);
  });

  it("reports a record for another header (new password) as stale", async () => {
    const { secret, record } = await enrolled();
    const other = await defaultEngine().initNew({
      password: "new",
      keyfile: crypto.getRandomValues(new Uint8Array(32)),
    });
    await expect(
      unwrapDeviceDataKey(record, other.header, secret),
    ).rejects.toBeInstanceOf(DeviceUnlockStaleError);
  });

  it("ignores per-save fields in the header digest", async () => {
    const { header } = await enrolled();
    const withSave = { ...header, nonce: "x", ciphertext: "y", website: "z" };
    expect(await vaultHeaderDigest(withSave)).toBe(await vaultHeaderDigest(header));
  });

  it.each<[string, (r: DeviceUnlockRecord) => DeviceUnlockRecord]>([
    ["kid", (r) => ({ ...r, kid: "fedcba9876543210" })],
    ["credentialId", (r) => ({ ...r, credentialId: b64encode(new Uint8Array(20)) })],
    ["prfSalt", (r) => ({ ...r, prfSalt: generatePrfSalt() })],
    ["createdAt", (r) => ({ ...r, createdAt: new Date(0).toISOString() })],
    ["nonce", (r) => ({ ...r, nonce: flip(r.nonce) })],
    ["wrappedDataKey", (r) => ({ ...r, wrappedDataKey: flip(r.wrappedDataKey) })],
  ])("detects tampering with %s", async (_, tamper) => {
    const { header, secret, record } = await enrolled();
    await expect(
      unwrapDeviceDataKey(tamper(record), header, secret),
    ).rejects.toBeInstanceOf(DeviceUnlockError);
  });

  it("parses what it serializes and drops unknown fields", async () => {
    const { record } = await enrolled();
    const text = JSON.stringify({ ...record, extra: "nope" });
    const parsed = parseDeviceUnlockRecord(text);
    expect(parsed).toEqual(record);
    expect(parsed).not.toHaveProperty("extra");
  });

  it.each<[string, unknown]>([
    ["not JSON", "{"],
    ["null", null],
    ["an array", []],
    ["a wrong format", { format: "other" }],
  ])("rejects %s", async (_, value) => {
    const { record } = await enrolled();
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    expect(() => parseDeviceUnlockRecord(raw)).toThrow(DeviceUnlockError);
    expect(record.format).toBe(DEVICE_UNLOCK_FORMAT);
  });

  it.each<[string, (r: DeviceUnlockRecord) => unknown]>([
    ["a short salt", (r) => ({ ...r, prfSalt: b64encode(new Uint8Array(8)) })],
    ["a bad kid", (r) => ({ ...r, kid: "XYZ" })],
    ["a bad digest", (r) => ({ ...r, headerDigest: "00" })],
    ["a short nonce", (r) => ({ ...r, nonce: b64encode(new Uint8Array(8)) })],
    ["an empty ciphertext", (r) => ({ ...r, wrappedDataKey: "" })],
    ["another version", (r) => ({ ...r, version: 2 })],
  ])("rejects a record with %s", async (_, change) => {
    const { record } = await enrolled();
    expect(() => checkDeviceUnlockRecord(change(record))).toThrow(DeviceUnlockError);
  });

  it("refuses to enroll with an invalid keyfile id", async () => {
    const { header, dataKey } = await enrolled();
    await expect(
      wrapDataKeyForDevice({
        dataKey,
        header,
        prf: prf(),
        meta: { ...meta(), kid: "not-a-kid" },
      }),
    ).rejects.toBeInstanceOf(DeviceUnlockError);
  });
});
