/**
 * index.ts — application entry point.
 *
 * Boot sequence:
 *  1. Load and validate config (dotenv)
 *  2. Initialise SQLite database + run migrations
 *  3. Construct SessionManager
 *  4. Build Bolt App
 *  5. Start the app (Socket Mode)
 *  6. Register SIGTERM / SIGINT handlers for graceful shutdown
 */

import 'dotenv/config';
import { config } from './config.js';
import { initDatabase, closeDatabase, migration001, migration002, migration003, migration004 } from './db/index.js';
import { UserStore } from './db/queries/users.js';
import { SessionManager } from './sessions/index.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  logger.info('Starting slack-claude-bot', { version: '0.1.0' });

  // ── 1. Database ──────────────────────────────────────────────────────────
  const db = await initDatabase([migration001, migration002, migration003, migration004]);
  logger.info('Database initialised');

  // ── 2. Session manager ───────────────────────────────────────────────────
  const userStore = new UserStore(db);
  const sessionManager = new SessionManager(userStore);
  logger.info('SessionManager initialised');

  // ── 3. Bolt app ──────────────────────────────────────────────────────────
  const app = createApp(
    {
      botToken: config.SLACK_BOT_TOKEN,
      signingSecret: config.SLACK_SIGNING_SECRET,
      appToken: config.SLACK_APP_TOKEN,
    },
    sessionManager,
    userStore,
  );

  // ── 4. Graceful shutdown ─────────────────────────────────────────────────
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}, shutting down…`);

    // Stop all live sessions (aborts Claude processes, persists state)
    try {
      const sessions = sessionManager.listSessions();
      logger.info(`Stopping ${sessions.length} active session(s)…`);
      for (const s of sessions) {
        try {
          sessionManager.stopSession(s.sessionId);
        } catch (err) {
          logger.warn('Error stopping session during shutdown', { sessionId: s.sessionId, err });
        }
      }
    } catch (err) {
      logger.error('Error listing sessions during shutdown', { err });
    }

    try {
      await app.stop();
      logger.info('Bolt app stopped');
    } catch (err) {
      logger.error('Error stopping Bolt app', { err });
    }

    try {
      closeDatabase();
      logger.info('Database closed');
    } catch (err) {
      logger.error('Error closing database', { err });
    }

    logger.info('Shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { err: err.message, stack: err.stack });
    void shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  // ── 5. Start ─────────────────────────────────────────────────────────────
  await app.start();
  logger.info('Bolt app started (Socket Mode)', {
    maxSessionsPerUser: config.MAX_SESSIONS_PER_USER,
    maxBudgetUsd: config.MAX_BUDGET_USD,
    sandboxEnabled: config.SANDBOX_ENABLED,
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  process.stderr.write(
    JSON.stringify({ level: 'error', message: 'Fatal startup error', error: message, stack }) + '\n',
  );
  process.exit(1);
});
