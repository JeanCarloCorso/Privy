import pg from 'pg';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { PostgresRepository } from './repository.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10, ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : false });
const app = buildApp(config, new PostgresRepository(pool));
const close = async () => { await app.close(); await pool.end(); };
process.on('SIGTERM', close); process.on('SIGINT', close);
await app.listen({ host: config.API_HOST, port: config.API_PORT });
