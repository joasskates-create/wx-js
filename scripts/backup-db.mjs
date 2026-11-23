import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const source = path.resolve(process.env.DB_PATH ?? "./data/payments.db");
if (!fs.existsSync(source)) throw new Error(`DB_NOT_FOUND: ${source}`);
const directory = path.resolve(process.argv[2] ?? "./backups");
fs.mkdirSync(directory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY ?? "";
const target = path.join(directory, `payments-${stamp}.db${encryptionKey ? ".enc" : ""}`);
const db = new Database(source);
db.pragma("wal_checkpoint(TRUNCATE)");
db.close();
if (!encryptionKey) {
  fs.copyFileSync(source, target);
} else {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(encryptionKey, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(fs.readFileSync(source)), cipher.final()]);
  const header = Buffer.from("WCPAYBACKUP1", "ascii");
  fs.writeFileSync(target, Buffer.concat([header, salt, iv, cipher.getAuthTag(), encrypted]));
}
console.log(target);
