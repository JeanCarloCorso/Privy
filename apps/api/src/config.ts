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
  API_HOST: z.string().default('127.0.0.1'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  DATABASE_SSL: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  STUN_URL: z.string().default('stun:stun.cloudflare.com:3478'),
  TURN_URL: z.string().optional(),
  TURN_SECRET: z.string().min(32).optional(),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== 'production') return;
  if (!value.WEB_ORIGIN.startsWith('https://')) context.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'production origin must use HTTPS' });
  if (value.SESSION_PEPPER.includes('replace-with') || new Set(value.SESSION_PEPPER).size < 12) context.addIssue({ code: 'custom', path: ['SESSION_PEPPER'], message: 'production pepper is not sufficiently random' });
  if (!value.DATABASE_SSL) context.addIssue({ code: 'custom', path: ['DATABASE_SSL'], message: 'production database TLS must be enabled' });
  if (!value.TURN_URL || !value.TURN_SECRET) context.addIssue({ code: 'custom', path: ['TURN_URL'], message: 'production calls require TURN with ephemeral credentials' });
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);
