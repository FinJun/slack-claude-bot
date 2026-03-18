import { z } from 'zod';
import * as dotenv from 'dotenv';
import { randomBytes } from 'crypto';

dotenv.config();

const envSchema = z.object({
  // Slack
  SLACK_BOT_TOKEN: z.string().min(1, 'SLACK_BOT_TOKEN is required'),
  SLACK_SIGNING_SECRET: z.string().min(1, 'SLACK_SIGNING_SECRET is required'),
  SLACK_APP_TOKEN: z.string().min(1, 'SLACK_APP_TOKEN is required'),

  // Encryption (AES-256-GCM key as 64-char hex; auto-generated if not set)
  ENCRYPTION_KEY: z
    .string()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : randomBytes(32).toString('hex'))),

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
