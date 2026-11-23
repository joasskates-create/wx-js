import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const source = process.argv[2] ? path.resolve(process.argv[2]) : "";
const target = path.resolve(process.argv[3] ?? process.env.DB_PATH ?? "./data/payments.db");
if (!source || !fs.existsSync(source)) throw new Error("BACKUP_NOT_FOUND");
if (process.argv[4] !== "--force") throw new Error("RESTORE_REQUIRES_--force");
fs.mkdirSync(path.dirname(target), { recursive: true });
const backup = fs.readFileSync(source);
const magic = Buffer.from("WCPAYBACKUP1", "ascii");
if (backup.subarray(0, magic.length).equals(magic)) {
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY ?? "";
  if (!encryptionKey) throw new Error("BACKUP_ENCRYPTION_KEY_REQUIRED");
  const offset = magic.length;
  const salt = backup.subarray(offset, offset + 16);
  const iv = backup.subarray(offset + 16, offset + 28);
  const authTag = backup.subarray(offset + 28, offset + 44);
  const encrypted = backup.subarray(offset + 44);
  const key = crypto.scryptSync(encryptionKey, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  fs.writeFileSync(target, Buffer.concat([decipher.update(encrypted), decipher.final()]));
} else {
  fs.copyFileSync(source, target);
}
console.log(target);
