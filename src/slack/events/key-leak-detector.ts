/**
 * Key leak detector — monitors all Slack messages for exposed Anthropic API keys.
 *
 * On detection:
 *   1. Attempt to delete the offending message (may fail without admin perms)
 *   2. DM the user with a warning to rotate their key
 *   3. If the user has a key stored in DB, auto-revoke it
 *   4. Log the incident
 *
 * Required bot token scopes: chat:write (already present).
 * Deleting other users' messages also requires the `chat:write` scope with
 * the bot being the message author, or admin-level `chat:write.public`.
 * If deletion fails, a warning is logged and the DM is still sent.
 */

import type { App } from '@slack/bolt';
import { UserStore } from '../../db/queries/users.js';
import { logger } from '../../utils/logger.js';

const API_KEY_REGEX = /sk-ant-[a-zA-Z0-9_-]{20,}/;

export function registerKeyLeakDetector(app: App, userStore: UserStore): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.event('message', async ({ event, client }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = event as any;

    // Ignore bot messages and non-text subtypes
    if (msg.bot_id || msg.subtype === 'bot_message') return;
    if (msg.subtype === 'message_deleted' || msg.subtype === 'message_changed') return;

    const text: string | undefined = msg.text;
    if (!text) return;

    if (!API_KEY_REGEX.test(text)) return;

    const userId: string = msg.user;
    const channelId: string = msg.channel;
    const ts: string = msg.ts;

    logger.warn('API key leak detected', { userId, channelId, ts });

    // 1. Attempt to delete the message
    try {
      await client.chat.delete({ channel: channelId, ts });
      logger.info('Leaked key message deleted', { channelId, ts });
    } catch (err) {
      logger.warn('Failed to delete leaked key message (may need admin perms)', {
        channelId,
        ts,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // 2. DM the user with a warning
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dmResult = await client.conversations.open({ users: userId });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dmChannel = (dmResult as any).channel?.id;
      if (dmChannel) {
        await client.chat.postMessage({
          channel: dmChannel,
          text: '⚠️ API 키가 채널에 노출되었습니다! https://console.anthropic.com 에서 즉시 키를 재발급하세요.',
        });
        logger.info('Key leak warning DM sent', { userId });
      }
    } catch (err) {
      logger.warn('Failed to send key leak warning DM', {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // 3. Auto-revoke stored key if user has one in DB
    try {
      if (userStore.hasApiKey(userId)) {
        userStore.deleteApiKey(userId);
        logger.info('Auto-revoked stored API key for user after leak', { userId });
      }
    } catch (err) {
      logger.warn('Failed to auto-revoke user API key', {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
