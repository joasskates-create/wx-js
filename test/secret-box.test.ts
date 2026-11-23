import { describe, expect, it } from "vitest";

process.env.DATA_ENCRYPTION_KEY = "test-encryption-key-for-secrets";
const box = await import("../src/security/secret-box.ts");

describe("secret storage", () => {
  it("encrypts and decrypts webhook secrets", () => {
    const encrypted = box.encryptSecret("merchant-webhook-secret");
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(box.decryptSecret(encrypted)).toBe("merchant-webhook-secret");
  });
});
