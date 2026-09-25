import { z } from 'zod';
import { config as loadDotEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

// npm workspaces changes cwd to apps/api. Resolve the repository-level file
// from this module so CLI commands and the dev server behave identically.
loadDotEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  SESSION_PEPPER: z.string().min(32),
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);
