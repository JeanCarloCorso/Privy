import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../config.js';

const config = loadConfig();
const sql = await readFile(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
try {
  await pool.query(sql);
  console.info('Database migrated');
} catch (error) {
  const cause = error as NodeJS.ErrnoException;
  console.error(`Database migration failed${cause.code ? ` (${cause.code})` : ''}. Confirm DATABASE_URL and that PostgreSQL is reachable.`);
  throw error;
} finally {
  await pool.end();
}
