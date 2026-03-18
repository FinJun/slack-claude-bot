/**
 * Thread message event handler.
 *
 * Routes incoming Slack thread messages to the appropriate Claude session
 * by looking up the thread_ts → session mapping.
 *
 * Rules:
 *  - Only process messages in threads (thread_ts present)
 *  - Ignore bot messages (bot_id present or subtype === 'bot_message')
 *  - Ignore messages with no text
 *  - Look up session by (channel, thread_ts); ignore unmapped threads
 *  - Call sessionManager.sendMessage() on the matched session
 */

import type { App } from '@slack/bolt';
import { SessionManager } from '../types.js';
import { logger } from '../../utils/logger.js';
import { globalRateLimiter } from '../rate-limiter.js';
import { RateLimitError } from '../../utils/errors.js';

export function registerMessageHandler(app: App, sessionManager: SessionManager): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.event('message', async ({ event, client }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = event as any;

    // Ignore bot messages (our own replies and other bots)
    if (msg.bot_id || msg.subtype === 'bot_message') return;
    if (msg.subtype === 'message_deleted' || msg.subtype === 'message_changed') return;

    // Only handle thread messages
    const threadTs: string | undefined = msg.thread_ts;
    if (!threadTs) return;

    const channelId: string = msg.channel;
    const text: string | undefined = msg.text;

    if (!text?.trim()) return;

    // Look up the session for this thread
    const session = sessionManager.getSessionByThread(channelId, threadTs);
    if (!session) return; // Unmapped thread — not our concern

    const info = session.getInfo();

    if (info.status === 'terminated' || info.status === 'error') {
      logger.debug('Message received on terminated session, ignoring', {
        sessionId: info.sessionId,
        threadTs,
      });
      return;
    }

    // Rate limit check
    try {
      globalRateLimiter.consume();
    } catch (err) {
      if (err instanceof RateLimitError) {
        const retryMs = (err.details as { retryAfterMs?: number })?.retryAfterMs ?? 60_000;
        logger.warn('Rate limit hit on message handler', { sessionId: info.sessionId });
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `:warning: Rate limit reached. Please try again in ${Math.ceil(retryMs / 1000)}s.`,
        });
        return;
      }
      throw err;
    }

    logger.debug('Routing message to session', {
      sessionId: info.sessionId,
      textLength: text.length,
    });

    try {
      sessionManager.sendMessage(info.sessionId, text);
    } catch (err) {
      logger.error('Failed to send message to session', {
        sessionId: info.sessionId,
        err,
      });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `:x: Failed to send message to Claude: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}
