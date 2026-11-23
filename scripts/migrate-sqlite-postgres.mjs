import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import pg from 'pg';

const source = path.resolve(process.env.DB_PATH ?? './data/payments.db');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL_REQUIRED');
if (!fs.existsSync(source)) throw new Error(`DB_NOT_FOUND:${source}`);
const sqlite = new Database(source, { readonly: true });
const pool = new pg.Pool({ connectionString: url, max: 4 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const tables = sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
  for (const table of tables) {
    const name = String(table.name);
    let ddl = String(table.sql).replace(/CREATE TABLE( IF NOT EXISTS)?/i, 'CREATE TABLE IF NOT EXISTS');
    ddl = ddl.replace(/INTEGER PRIMARY KEY/gi, 'TEXT PRIMARY KEY').replace(/AUTOINCREMENT/gi, '').replace(/INSERT OR IGNORE/gi, 'INSERT');
    await client.query(ddl);
    const columns = sqlite.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all().map((item) => String(item.name));
    if (!columns.length) continue;
    const rows = sqlite.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).all();
    const quoted = columns.map((column) => `"${column.replace(/"/g, '""')}"`).join(', ');
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const insert = `INSERT INTO "${name.replace(/"/g, '""')}" (${quoted}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
    for (const row of rows) await client.query(insert, columns.map((column) => row[column]));
    console.log(`${name}: ${rows.length}`);
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
  sqlite.close();
}
