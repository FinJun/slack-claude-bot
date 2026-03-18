import type { KnownBlock, SectionBlock, HeaderBlock, DividerBlock, ContextBlock, ActionsBlock } from '@slack/types';

// ─── Shared types used across this module ───────────────────────────────────

export interface SessionSummary {
  id: string;
  projectDir: string;
  description?: string;
  status: 'starting' | 'active' | 'stopping' | 'stopped' | 'error';
  startedAt: Date;
  threadTs?: string;
  channelId?: string;
  messageCount?: number;
  totalCost?: number;
}

export interface ProgressStatus {
  status: 'thinking' | 'tool_use' | 'streaming' | 'done' | 'error';
  details?: string;
  elapsed?: number; // ms
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mrkdwn(text: string): SectionBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function header(text: string): HeaderBlock {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } };
}

const divider: DividerBlock = { type: 'divider' };

function context(text: string): ContextBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

function statusEmoji(status: SessionSummary['status']): string {
  switch (status) {
    case 'starting':  return ':hourglass_flowing_sand:';
    case 'active':    return ':green_circle:';
    case 'stopping':  return ':yellow_circle:';
    case 'stopped':   return ':white_circle:';
    case 'error':     return ':red_circle:';
  }
}

function formatDuration(startedAt: Date): string {
  const ms = Date.now() - startedAt.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatCost(usd?: number): string {
  if (usd == null) return 'n/a';
  return `$${usd.toFixed(4)}`;
}

// ─── Public builders ─────────────────────────────────────────────────────────

/**
 * Detailed info blocks for a single session (used in thread headers / /claude list detail).
 */
export function sessionInfoBlocks(session: SessionSummary): KnownBlock[] {
  const emoji = statusEmoji(session.status);
  const duration = formatDuration(session.startedAt);
  const cost = formatCost(session.totalCost);

  const blocks: KnownBlock[] = [
    header(`${emoji} Claude Session`),
    mrkdwn(
      `*Project:* \`${session.projectDir}\`\n` +
      (session.description ? `*Description:* ${session.description}\n` : '') +
      `*Session ID:* \`${session.id}\``,
    ),
    divider,
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Status*\n${emoji} ${session.status}` },
        { type: 'mrkdwn', text: `*Running for*\n${duration}` },
        { type: 'mrkdwn', text: `*Messages*\n${session.messageCount ?? 0}` },
        { type: 'mrkdwn', text: `*Cost*\n${cost}` },
      ],
    } as SectionBlock,
    context(`Started <!date^${Math.floor(session.startedAt.getTime() / 1000)}^{date_short_pretty} at {time}|${session.startedAt.toISOString()}>`),
  ];

  return blocks;
}

/**
 * Compact list of sessions for /claude list output.
 */
export function sessionListBlocks(sessions: SessionSummary[]): KnownBlock[] {
  if (sessions.length === 0) {
    return [mrkdwn('_No active Claude sessions._')];
  }

  const blocks: KnownBlock[] = [header(`Claude Sessions (${sessions.length})`)];

  for (const s of sessions) {
    const emoji = statusEmoji(s.status);
    const duration = formatDuration(s.startedAt);
    const cost = formatCost(s.totalCost);

    blocks.push(divider);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `${emoji} *\`${s.id}\`*  ${s.status}\n` +
          `*Project:* \`${s.projectDir}\`` +
          (s.description ? `  —  ${s.description}` : ''),
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Stop', emoji: false },
        style: 'danger',
        value: s.id,
        action_id: 'session_stop',
        confirm: {
          title: { type: 'plain_text', text: 'Stop session?' },
          text: { type: 'mrkdwn', text: `Stop session \`${s.id}\` for \`${s.projectDir}\`?` },
          confirm: { type: 'plain_text', text: 'Stop' },
          deny: { type: 'plain_text', text: 'Cancel' },
          style: 'danger',
        },
      },
    } as SectionBlock);
    blocks.push(
      context(`Msgs: ${s.messageCount ?? 0}  •  Cost: ${cost}  •  Running: ${duration}`),
    );
  }

  return blocks;
}

/**
 * Error block for surfacing errors in Slack.
 */
export function errorBlock(message: string, detail?: string): KnownBlock[] {
  const text = detail
    ? `:x: *Error:* ${message}\n\`\`\`${detail}\`\`\``
    : `:x: *Error:* ${message}`;
  return [mrkdwn(text)];
}

/**
 * Progress indicator block — shown while Claude is working.
 */
export function progressBlock(progress: ProgressStatus): KnownBlock[] {
  let icon: string;
  let label: string;

  switch (progress.status) {
    case 'thinking':
      icon = ':thought_balloon:';
      label = 'Thinking…';
      break;
    case 'tool_use':
      icon = ':wrench:';
      label = progress.details ? `Using tool: \`${progress.details}\`` : 'Using a tool…';
      break;
    case 'streaming':
      icon = ':pencil:';
      label = 'Writing response…';
      break;
    case 'done':
      icon = ':white_check_mark:';
      label = 'Done';
      break;
    case 'error':
      icon = ':x:';
      label = progress.details ? `Error: ${progress.details}` : 'An error occurred';
      break;
  }

  const elapsed = progress.elapsed != null ? `  _(${(progress.elapsed / 1000).toFixed(1)}s)_` : '';
  return [context(`${icon} ${label}${elapsed}`)];
}

/**
 * Action buttons block for a running session (stop / cancel).
 */
export function sessionActionsBlock(sessionId: string): KnownBlock[] {
  const actions: ActionsBlock = {
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Stop Session', emoji: false },
        style: 'danger',
        value: sessionId,
        action_id: 'session_stop',
        confirm: {
          title: { type: 'plain_text', text: 'Stop session?' },
          text: {
            type: 'mrkdwn',
            text: `Are you sure you want to stop session \`${sessionId}\`? The Claude process will be terminated.`,
          },
          confirm: { type: 'plain_text', text: 'Stop' },
          deny: { type: 'plain_text', text: 'Cancel' },
          style: 'danger',
        },
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Cancel Current Task', emoji: false },
        value: sessionId,
        action_id: 'session_cancel_task',
      },
    ],
  };
  return [actions];
}
