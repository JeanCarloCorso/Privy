import pg from 'pg';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { PostgresRepository } from './repository.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });
const app = buildApp(config, new PostgresRepository(pool));
const close = async () => { await app.close(); await pool.end(); };
process.on('SIGTERM', close); process.on('SIGINT', close);
await app.listen({ host: '127.0.0.1', port: config.API_PORT });
