import crypto from "node:crypto";
import type { WechatCredentials } from "../security/credentials.js";
import { buildWechatV2Sign, parseWechatV2Xml } from "./wechat-native.js";

export function verifyWechatSignature(rawBody: Buffer, credentials: WechatCredentials): Record<string, string> {
  const payload = parseWechatV2Xml(rawBody.toString("utf8"));
  const actual = String(payload.sign || "").toUpperCase();
  const expected = buildWechatV2Sign(payload, credentials.apiV2Key);
  if (!actual || actual.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw new Error("WECHAT_V2_SIGNATURE_INVALID");
  return payload;
}
