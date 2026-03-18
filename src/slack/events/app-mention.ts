/**
 * @bot mention handler for in-thread commands.
 *
 * Commands (must be used inside a Claude session thread):
 *   @bot /cancel   — interrupt the current running task
 *   @bot /cost     — show cost incurred so far
 *   @bot /stop     — stop the session gracefully
 *   @bot /help     — list available commands
 */

import type { App } from '@slack/bolt';
import { SessionManager } from '../types.js';
import { errorBlock } from '../formatters/blocks.js';
import { logger } from '../../utils/logger.js';

// ─── Command regex ────────────────────────────────────────────────────────────

// Strips the bot mention then captures the first word as the command
const COMMAND_RE = /^<@[A-Z0-9]+>\s*\/(\w+)(.*)?$/s;

function parseCommand(text: string): { command: string; rest: string } | null {
  const match = COMMAND_RE.exec(text.trim());
  if (!match) return null;
  return { command: match[1]!.toLowerCase(), rest: (match[2] ?? '').trim() };
}

const IN_THREAD_HELP = [
  '*In-thread @bot commands:*',
  '`@bot /cancel`   — send an interrupt signal to the current task',
  '`@bot /cost`     — show accumulated cost for this session',
  '`@bot /stop`     — stop this session gracefully',
  '`@bot /help`     — show this help',
].join('\n');

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerAppMentionHandler(app: App, sessionManager: SessionManager): void {
  app.event('app_mention', async ({ event, client }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ev = event as any;
    const channelId: string = ev.channel;
    const threadTs: string | undefined = ev.thread_ts;
    const text: string = ev.text ?? '';

    const parsed = parseCommand(text);
    if (!parsed) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: IN_THREAD_HELP,
      });
      return;
    }

    const { command } = parsed;

    // All commands require a session thread
    if (!threadTs) {
      await client.chat.postMessage({
        channel: channelId,
        text: `:information_source: In-thread commands must be used inside a Claude session thread.`,
      });
      return;
    }

    const session = sessionManager.getSessionByThread(channelId, threadTs);
    if (!session) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `:grey_question: No active Claude session found for this thread.`,
      });
      return;
    }

    const info = session.getInfo();
    logger.debug('app_mention command', { command, sessionId: info.sessionId });

    try {
      switch (command) {
        case 'cancel':
          await session.interrupt();
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `:stop_sign: Interrupt signal sent. Claude will stop after the current operation.`,
          });
          break;

        case 'cost': {
          const cost = info.totalCostUsd ?? 0;
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `:moneybag: Session \`${info.sessionId}\` cost so far: *$${cost.toFixed(4)}*  (${info.turnCount} turns)`,
          });
          break;
        }

        case 'stop':
          sessionManager.stopSession(info.sessionId);
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `:white_check_mark: Session \`${info.sessionId}\` is stopping.`,
          });
          break;

        case 'help':
        default:
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: IN_THREAD_HELP,
          });
          break;
      }
    } catch (err) {
      logger.error('Error handling app_mention command', { command, err });
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: message,
        blocks: errorBlock(message),
      });
    }
  });
}
