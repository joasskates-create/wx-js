import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dbPath = path.resolve("data", `vitest-signature-${process.pid}.db`);
process.env.DB_PATH = dbPath;
process.env.MERCHANT_SIGNATURE_REQUIRED = "true";
process.env.MERCHANT_SIGNATURE_WINDOW_SECONDS = "300";

const store = await import("../src/db.ts");
const signature = await import("../src/security/merchant-signature.ts");

describe("merchant request signature", () => {
  it("accepts a signed request once and rejects nonce replay", () => {
    const merchantId = `signature-partner-${process.pid}`;
    const created = store.createPlatformMerchant({ id: merchantId, code: `signature-code-${process.pid}`, name: "签名测试码商" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = `nonce-${process.pid}`;
    const body = JSON.stringify({ clientRequestNo: "sig-1", amount: 100 });
    const request = {
      method: "POST",
      originalUrl: "/api/v1/orders",
      ip: "127.0.0.1",
      body: JSON.parse(body),
      rawBody: Buffer.from(body),
      headers: {
        "x-merchant-key": created.apiKey,
        "x-merchant-code": created.code,
        "x-merchant-timestamp": timestamp,
        "x-merchant-nonce": nonce,
        "x-merchant-signature": signature.merchantSignature(created.apiKey, "POST", "/api/v1/orders", timestamp, nonce, body)
      }
    } as never;
    expect(signature.verifyMerchantRequest(request).merchant?.id).toBe(merchantId);
    expect(signature.verifyMerchantRequest(request).error).toBe("MERCHANT_SIGNATURE_REPLAY");
  });
});

afterAll(() => {
  store.db.close();
  for (const file of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) if (fs.existsSync(file)) fs.unlinkSync(file);
});
