import { z } from 'zod';
import * as dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import { existsSync, appendFileSync } from 'fs';
import { resolve } from 'path';

dotenv.config();

/**
 * Generate a stable ENCRYPTION_KEY and persist it to .env so it survives restarts.
 * Without this, encrypted API keys become unreadable after a bot restart.
 */
function getOrCreateEncryptionKey(): string {
  const existing = process.env.ENCRYPTION_KEY;
  if (existing && existing.length >= 64) return existing;

  const newKey = randomBytes(32).toString('hex');
  const envPath = resolve(process.cwd(), '.env');

  try {
    if (existsSync(envPath)) {
      appendFileSync(envPath, `\nENCRYPTION_KEY=${newKey}\n`);
    } else {
      appendFileSync(envPath, `ENCRYPTION_KEY=${newKey}\n`);
    }
    process.env.ENCRYPTION_KEY = newKey;
    console.log('[config] Generated and saved ENCRYPTION_KEY to .env');
  } catch {
    console.warn('[config] Could not save ENCRYPTION_KEY to .env — using ephemeral key');
  }

  return newKey;
}

const envSchema = z.object({
  // Slack
  SLACK_BOT_TOKEN: z.string().min(1, 'SLACK_BOT_TOKEN is required'),
  SLACK_SIGNING_SECRET: z.string().min(1, 'SLACK_SIGNING_SECRET is required'),
  SLACK_APP_TOKEN: z.string().min(1, 'SLACK_APP_TOKEN is required'),

  // Encryption (AES-256-GCM key as 64-char hex; auto-generated and saved to .env if not set)
  ENCRYPTION_KEY: z
    .string()
    .optional()
    .transform(() => getOrCreateEncryptionKey()),

  // Anthropic (optional — if empty, uses existing `claude login` session)
  ANTHROPIC_API_KEY: z.string().optional().default(''),

  // Session
  MAX_SESSIONS_PER_USER: z.coerce.number().int().positive().default(3),
  SESSION_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(1800000),
  MAX_BUDGET_USD: z.coerce.number().positive().default(5.0),
  MAX_TURNS: z.coerce.number().int().positive().default(50),

  // Security
  ALLOWED_DIRECTORIES: z
    .string()
    .transform((val) => val.split(',').map((d) => d.trim()).filter(Boolean))
    .default(''),
  SANDBOX_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .default('true'),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Server registry
  SERVERS: z.string().optional().default(''),
  SSH_KEY_PATH: z.string().optional().default(''),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }
  return result.data;
}

export const config = loadConfig();
