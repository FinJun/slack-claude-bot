/**
 * buttons.ts
 *
 * Slack Block Kit button interaction handlers.
 * Handles: session_stop, session_cancel_task, session_kill (force), and generic confirm dialogs.
 *
 * These handlers are wired up in app.ts via app.action(...).
 * They do not import from sessions/ or security/ — side-effects are communicated
 * back via the callback functions injected at registration time.
 */

import type { App, BlockAction, ButtonAction } from '@slack/bolt';
import { errorBlock, progressBlock } from '../formatters/blocks.js';

// ─── Callback contracts ───────────────────────────────────────────────────────

/** Called when the user confirms "Stop Session". */
export type StopSessionCallback = (sessionId: string, userId: string) => Promise<void>;

/** Called when the user confirms "Cancel Current Task" (soft interrupt). */
export type CancelTaskCallback = (sessionId: string, userId: string) => Promise<void>;

/** Called when the user confirms "Kill Session" (force-kill). */
export type KillSessionCallback = (sessionId: string, userId: string) => Promise<void>;

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register all button action handlers on the Bolt App.
 *
 * @example
 * registerButtonHandlers(app, {
 *   onStop: (id, uid) => sessionManager.stop(id),
 *   onCancelTask: (id, uid) => sessionManager.cancelCurrentTask(id),
 *   onKill: (id, uid) => sessionManager.kill(id),
 * });
 */
export function registerButtonHandlers(
  app: App,
  callbacks: {
    onStop: StopSessionCallback;
    onCancelTask: CancelTaskCallback;
    onKill: KillSessionCallback;
  },
): void {
  // ── Stop session (graceful) ────────────────────────────────────────────────
  app.action<BlockAction<ButtonAction>>('session_stop', async ({ ack, body, client, logger }) => {
    await ack();

    const sessionId = body.actions[0]?.value;
    if (!sessionId) {
      logger.warn('session_stop action missing value');
      return;
    }

    const userId = body.user.id;
    const channelId = body.channel?.id;
    const messageTs = body.message?.ts;

    try {
      await callbacks.onStop(sessionId, userId);

      if (channelId && messageTs) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: `:white_check_mark: Session \`${sessionId}\` is stopping…`,
          blocks: progressBlock({ status: 'done', details: `Stop requested for ${sessionId}` }),
        });
      }
    } catch (err) {
      logger.error({ err, sessionId }, 'session_stop handler failed');
      if (channelId) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: `Failed to stop session \`${sessionId}\``,
          blocks: errorBlock(
            `Failed to stop session \`${sessionId}\``,
            err instanceof Error ? err.message : String(err),
          ),
        });
      }
    }
  });

  // ── Cancel current task (soft interrupt, session stays alive) ─────────────
  app.action<BlockAction<ButtonAction>>(
    'session_cancel_task',
    async ({ ack, body, client, logger }) => {
      await ack();

      const sessionId = body.actions[0]?.value;
      if (!sessionId) {
        logger.warn('session_cancel_task action missing value');
        return;
      }

      const userId = body.user.id;
      const channelId = body.channel?.id;

      try {
        await callbacks.onCancelTask(sessionId, userId);

        if (channelId) {
          await client.chat.postEphemeral({
            channel: channelId,
            user: userId,
            text: `:stop_sign: Cancel signal sent to session \`${sessionId}\`.`,
          });
        }
      } catch (err) {
        logger.error({ err, sessionId }, 'session_cancel_task handler failed');
        if (channelId) {
          await client.chat.postEphemeral({
            channel: channelId,
            user: userId,
            text: `Failed to cancel task in session \`${sessionId}\``,
            blocks: errorBlock(
              `Failed to cancel task in \`${sessionId}\``,
              err instanceof Error ? err.message : String(err),
            ),
          });
        }
      }
    },
  );

  // ── Kill session (force) ──────────────────────────────────────────────────
  app.action<BlockAction<ButtonAction>>(
    'session_kill',
    async ({ ack, body, client, logger }) => {
      await ack();

      const sessionId = body.actions[0]?.value;
      if (!sessionId) {
        logger.warn('session_kill action missing value');
        return;
      }

      const userId = body.user.id;
      const channelId = body.channel?.id;

      try {
        await callbacks.onKill(sessionId, userId);

        if (channelId) {
          await client.chat.postEphemeral({
            channel: channelId,
            user: userId,
            text: `:skull: Session \`${sessionId}\` has been forcefully terminated.`,
          });
        }
      } catch (err) {
        logger.error({ err, sessionId }, 'session_kill handler failed');
        if (channelId) {
          await client.chat.postEphemeral({
            channel: channelId,
            user: userId,
            text: `Failed to kill session \`${sessionId}\``,
            blocks: errorBlock(
              `Failed to kill \`${sessionId}\``,
              err instanceof Error ? err.message : String(err),
            ),
          });
        }
      }
    },
  );
}

// ─── Standalone confirm dialog builders ──────────────────────────────────────

/**
 * Returns a button element that opens a confirmation dialog before stopping a session.
 * Useful when constructing action blocks outside of sessionActionsBlock().
 */
export function stopButton(sessionId: string): ButtonAction {
  return {
    type: 'button',
    action_id: 'session_stop',
    text: { type: 'plain_text', text: 'Stop', emoji: false },
    style: 'danger',
    value: sessionId,
    confirm: {
      title: { type: 'plain_text', text: 'Stop session?' },
      text: {
        type: 'mrkdwn',
        text: `Stop session \`${sessionId}\`? Claude will finish the current response, then the session ends.`,
      },
      confirm: { type: 'plain_text', text: 'Stop' },
      deny: { type: 'plain_text', text: 'Keep running' },
      style: 'danger',
    },
  } as unknown as ButtonAction;
}

/**
 * Returns a button element for force-killing a session (immediate termination).
 */
export function killButton(sessionId: string): ButtonAction {
  return {
    type: 'button',
    action_id: 'session_kill',
    text: { type: 'plain_text', text: 'Kill', emoji: false },
    style: 'danger',
    value: sessionId,
    confirm: {
      title: { type: 'plain_text', text: 'Force-kill session?' },
      text: {
        type: 'mrkdwn',
        text: `:warning: Force-kill session \`${sessionId}\`? The process will be terminated immediately with no cleanup.`,
      },
      confirm: { type: 'plain_text', text: 'Kill it' },
      deny: { type: 'plain_text', text: 'Cancel' },
      style: 'danger',
    },
  } as unknown as ButtonAction;
}
