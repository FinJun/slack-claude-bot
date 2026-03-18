/**
 * session-info.ts
 *
 * Formats session information for display in Slack messages.
 * Converts raw session data into human-readable strings and Block Kit payloads.
 */

import type { KnownBlock } from '@slack/types';
import {
  sessionInfoBlocks,
  sessionListBlocks,
  type SessionSummary,
} from './blocks.js';

// ─── Re-export SessionSummary so callers only need this module ───────────────
export type { SessionSummary };

// ─── Plain-text helpers (for fallback text / notifications) ─────────────────

export function sessionStatusLine(session: SessionSummary): string {
  const started = session.startedAt.toLocaleTimeString();
  const cost = session.totalCost != null ? ` | cost: $${session.totalCost.toFixed(4)}` : '';
  return `[${session.status.toUpperCase()}] ${session.id} | ${session.projectDir} | started ${started}${cost}`;
}

export function sessionStartedText(session: SessionSummary): string {
  const desc = session.description ? ` — ${session.description}` : '';
  return (
    `Session started for \`${session.projectDir}\`${desc}\n` +
    `Session ID: \`${session.id}\`\n` +
    `Reply in this thread to chat with Claude.`
  );
}

export function sessionStoppedText(session: SessionSummary, reason?: string): string {
  const msgs = session.messageCount ?? 0;
  const cost = session.totalCost != null ? ` | cost: $${session.totalCost.toFixed(4)}` : '';
  const why = reason ? ` (${reason})` : '';
  return `Session \`${session.id}\` stopped${why}. ${msgs} messages${cost}.`;
}

export function sessionErrorText(session: SessionSummary, error: string): string {
  return `Session \`${session.id}\` encountered an error: ${error}`;
}

// ─── Block Kit helpers ───────────────────────────────────────────────────────

/**
 * Full detail blocks for a single session.
 * Delegates to blocks.ts for layout.
 */
export function formatSessionInfo(session: SessionSummary): KnownBlock[] {
  return sessionInfoBlocks(session);
}

/**
 * Compact list blocks for multiple sessions.
 * Delegates to blocks.ts for layout.
 */
export function formatSessionList(sessions: SessionSummary[]): KnownBlock[] {
  return sessionListBlocks(sessions);
}

/**
 * Thread header text posted when a session is created.
 * Used as the initial message in the Slack thread.
 */
export function threadHeaderText(session: SessionSummary): string {
  const desc = session.description ? `\n*Description:* ${session.description}` : '';
  return (
    `:robot_face: *Claude Code Session Started*\n` +
    `*Project:* \`${session.projectDir}\`${desc}\n` +
    `*Session ID:* \`${session.id}\`\n` +
    `_Reply in this thread to send messages to Claude._`
  );
}

/**
 * Quick status summary for use in ephemeral "ack" responses.
 */
export function quickStatusText(session: SessionSummary): string {
  const cost = session.totalCost != null ? ` | $${session.totalCost.toFixed(4)}` : '';
  const msgs = session.messageCount ?? 0;
  return `${session.id} | ${session.status} | ${msgs} msgs${cost}`;
}
