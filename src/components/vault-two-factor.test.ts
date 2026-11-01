import { describe, expect, it } from "vitest";

import { isValidTotpSecret } from "@/lib/vault-totp";

import { generateVaultTotpSecret } from "./vault-two-factor";

describe("generateVaultTotpSecret", () => {
  it("produces secrets the server gate accepts", () => {
    for (let i = 0; i < 50; i++) {
      const secret = generateVaultTotpSecret();
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(isValidTotpSecret(secret)).toBe(true);
    }
  });
});
