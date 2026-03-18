/**
 * app.ts — Slack Bolt app factory.
 *
 * Creates and configures the Bolt App instance (Socket Mode),
 * registers all slash commands, event handlers, and action handlers.
 */

import { App, LogLevel } from '@slack/bolt';
import type { SessionManager } from './slack/types.js';
import { UserStore } from './db/queries/users.js';
import { registerClaudeCommand } from './slack/commands/claude.js';
import { registerMessageHandler } from './slack/events/message.js';
import { registerAppMentionHandler } from './slack/events/app-mention.js';
import { registerButtonHandlers } from './slack/actions/buttons.js';
import { registerKeyLeakDetector } from './slack/events/key-leak-detector.js';
import { logger } from './utils/logger.js';

export interface AppConfig {
  botToken: string;
  signingSecret: string;
  appToken: string;
}

/**
 * Build and configure a Bolt App.
 * Does NOT start the app — call app.start() separately.
 */
export function createApp(config: AppConfig, sessionManager: SessionManager, userStore: UserStore): App {
  const app = new App({
    token: config.botToken,
    signingSecret: config.signingSecret,
    socketMode: true,
    appToken: config.appToken,
    logger: {
      debug: (msg) => logger.debug(msg),
      info: (msg) => logger.info(msg),
      warn: (msg) => logger.warn(msg),
      error: (msg) => logger.error(msg),
      setLevel: () => {},
      setName: () => {},
      getLevel: () => LogLevel.INFO,
    },
  });

  // ── Global error handler ────────────────────────────────────────────────────
  app.error(async (error) => {
    logger.error('Unhandled Bolt error', { error: error.message, stack: error.stack });
  });

  // ── Key leak detection (registered first — runs on all message events) ──────
  registerKeyLeakDetector(app, userStore);

  // ── Commands ────────────────────────────────────────────────────────────────
  registerClaudeCommand(app, sessionManager);

  // ── Events ──────────────────────────────────────────────────────────────────
  registerMessageHandler(app, sessionManager);
  registerAppMentionHandler(app, sessionManager);

  // ── Actions ─────────────────────────────────────────────────────────────────
  registerButtonHandlers(app, {
    onStop: async (sessionId, userId) => {
      logger.info('Stop action triggered', { sessionId, userId });
      sessionManager.stopSession(sessionId);
    },
    onCancelTask: async (sessionId, userId) => {
      logger.info('Cancel task action triggered', { sessionId, userId });
      const session = sessionManager.getSession(sessionId);
      if (session) await session.interrupt();
    },
    onKill: async (sessionId, userId) => {
      logger.warn('Kill action triggered', { sessionId, userId });
      sessionManager.stopSession(sessionId);
    },
  });

  return app;
}
