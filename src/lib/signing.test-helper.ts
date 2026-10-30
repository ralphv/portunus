import { generateKeyPairSync } from "node:crypto";

// A fresh Ed25519 key in the PORTUNUS_SIGNING_PRIVATE_KEY format
// (base64 of the DER PKCS#8 private key).
export function testSigningKey(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
}
