/**
 * /claude slash command handler.
 *
 * Subcommands:
 *   /claude start <project-dir> [description...]  — start a new session
 *   /claude list                                   — list active sessions
 *   /claude stop <session-id>                      — stop a session
 *   /claude auth <api-key>                         — register Anthropic API key (DM only)
 *   /claude whoami                                 — show auth status
 *   /claude revoke                                 — delete stored API key
 *   /claude help                                   — usage help
 */

import type { App, RespondFn, RespondArguments } from '@slack/bolt';
import { SessionManager } from '../types.js';
import {
  sessionListBlocks,
  errorBlock,
  type SessionSummary,
} from '../formatters/blocks.js';
import { threadHeaderText } from '../formatters/session-info.js';
import { splitMessage } from '../../utils/message-splitter.js';
import { logger } from '../../utils/logger.js';
import {
  SessionNotFoundError,
  isAppError,
} from '../../utils/errors.js';
import { SessionStatus } from '../../sessions/session-types.js';
import { handleAuth, handleWhoami, handleRevoke, handleRegister } from './auth.js';
import { handleLogin, handleLogout } from './login.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build an ephemeral respond payload with optional blocks. */
function ephemeral(text: string, blocks?: ReturnType<typeof errorBlock> | ReturnType<typeof sessionListBlocks>): RespondArguments {
  const args: RespondArguments = { response_type: 'ephemeral', text };
  if (blocks) (args as Record<string, unknown>).blocks = blocks;
  return args;
}

function parseArgs(text: string): { subcommand: string; args: string[] } {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const subcommand = parts[0]?.toLowerCase() ?? 'help';
  const args = parts.slice(1);
  return { subcommand, args };
}

const HELP_TEXT = [
  '*Claude Code Bot — slash commands*',
  '',
  '`/claude start <project-dir> [description...]`',
  '  Start a new Claude session for the given project directory.',
  '  A new thread will be created. Reply there to chat with Claude.',
  '',
  '`/claude list`',
  '  List your active Claude sessions.',
  '',
  '`/claude stop <session-id>`',
  '  Gracefully stop the given session.',
  '',
  '`/claude login`',
  '  Authenticate your Claude account (DM only).',
  '  Use this if you have a Claude Pro/Max subscription.',
  '',
  '`/claude logout`',
  '  Remove stored Claude auth credentials (DM only).',
  '',
  '`/claude auth <api-key>`',
  '  Register your Anthropic API key (DM only).',
  '',
  '`/claude register <os-username>`',
  '  Link your Slack account to a server OS username (DM only).',
  '  Use this if you have a Claude Pro/Max subscription via `claude login`.',
  '',
  '`/claude whoami`',
  '  Show your current auth status.',
  '',
  '`/claude revoke`',
  '  Delete your stored API key and stop all active sessions.',
  '',
  '`/claude help`',
  '  Show this help message.',
  '',
  '*In-thread @mention commands:*',
  '`@bot /cancel`   — cancel current task',
  '`@bot /cost`     — show cost so far',
  '`@bot /history`  — show conversation history summary',
  '`@bot /policy`   — show current security policy',
  '`@bot /files`    — list files accessed in this session',
].join('\n');

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerClaudeCommand(app: App, sessionManager: SessionManager): void {
  app.command('/claude', async ({ command, ack, respond, client }) => {
    // Ack immediately — Slack requires a response within 3 seconds
    await ack();

    const { subcommand, args } = parseArgs(command.text);
    const userId = command.user_id;
    const channelId = command.channel_id;
    const isDM = command.channel_name === 'directmessage' || (command as Record<string, unknown>).channel_type === 'im';

    try {
      switch (subcommand) {
        case 'start':
          await handleStart({ args, userId, channelId, respond, client, sessionManager });
          break;

        case 'list':
          await handleList({ userId, respond, sessionManager });
          break;

        case 'stop':
          await handleStop({ args, userId, respond, sessionManager });
          break;

        case 'login': {
          if (!isDM) {
            await respond(ephemeral('⚠️ 로그인은 DM에서만 할 수 있습니다.'));
            break;
          }
          await respond(ephemeral('⏳ Claude 로그인을 시작합니다…'));
          // Use respond() directly — user is already in DM, no need for conversations.open
          const sendReply = async (text: string): Promise<void> => {
            await respond({ response_type: 'ephemeral', text, replace_original: false });
          };
          const loginMsg = await handleLogin(userId, isDM, sendReply);
          await sendReply(loginMsg);
          break;
        }

        case 'logout': {
          const logoutMsg = await handleLogout(userId, sessionManager);
          await respond(ephemeral(logoutMsg));
          break;
        }

        case 'auth': {
          const apiKey = args[0] ?? '';
          const msg = await handleAuth(userId, apiKey, isDM);
          await respond(ephemeral(msg));
          break;
        }

        case 'register': {
          const osUsername = args[0] ?? '';
          const msg = await handleRegister(userId, osUsername, isDM);
          await respond(ephemeral(msg));
          break;
        }

        case 'whoami': {
          const msg = await handleWhoami(userId);
          await respond(ephemeral(msg));
          break;
        }

        case 'revoke': {
          const msg = await handleRevoke(userId, sessionManager);
          await respond(ephemeral(msg));
          break;
        }

        case 'help':
        default:
          await respond(ephemeral(HELP_TEXT));
          break;
      }
    } catch (err) {
      logger.error('Error handling /claude command', { subcommand, err });
      const message = isAppError(err) ? err.message : 'An unexpected error occurred.';
      await respond(ephemeral(message, errorBlock(message, err instanceof Error ? err.stack : undefined)));
    }
  });
}

// ─── Subcommand handlers ──────────────────────────────────────────────────────

type SlackClient = Parameters<Parameters<App['command']>[1]>[0]['client'];

interface StartContext {
  args: string[];
  userId: string;
  channelId: string;
  respond: RespondFn;
  client: SlackClient;
  sessionManager: SessionManager;
}

async function handleStart({
  args,
  userId,
  channelId,
  respond,
  client,
  sessionManager,
}: StartContext): Promise<void> {
  const projectDir = args[0];
  if (!projectDir) {
    await respond(ephemeral('Usage: `/claude start <project-dir> [description...]`'));
    return;
  }

  const description = args.slice(1).join(' ') || undefined;

  // Create the thread first so we have a threadTs for the session
  const threadMsg = await client.chat.postMessage({
    channel: channelId,
    text: `:hourglass_flowing_sand: Starting Claude session for \`${projectDir}\`…`,
  });
  const threadTs = threadMsg.ts!;

  try {
    // onMessage: post Claude's responses as threaded messages, split if needed
    const onMessage = async (_sessionId: string, chunks: string[]): Promise<void> => {
      for (const chunk of chunks) {
        const parts = splitMessage(chunk);
        for (const part of parts) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: part,
          });
        }
      }
    };

    const session = sessionManager.createSession({
      userId,
      channelId,
      threadTs,
      projectDir,
      onMessage,
      onEnd: async (sessionId, reason) => {
        logger.info('Session ended', { sessionId, reason });
        try {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: reason === 'error'
              ? `:x: Session ended due to an error.`
              : `:white_check_mark: Session ended (${reason}).`,
          });
        } catch (err) {
          logger.warn('Failed to post session-end message', { sessionId, err });
        }
      },
    });

    // Update the thread header with full session info
    const info = session;
    await client.chat.update({
      channel: channelId,
      ts: threadTs,
      text: threadHeaderText({
        id: info.sessionId,
        projectDir: info.workingDirectory,
        description,
        status: 'active',
        startedAt: info.createdAt,
        threadTs,
        channelId,
        messageCount: 0,
        totalCost: 0,
      }),
    });

    logger.info('Session created via /claude start', {
      sessionId: info.sessionId,
      userId,
      projectDir,
    });
  } catch (err) {
    // Clean up the thread message on failure
    await client.chat.update({
      channel: channelId,
      ts: threadTs,
      text: `:x: Failed to start Claude session for \`${projectDir}\`.`,
      blocks: errorBlock(
        `Failed to start session for \`${projectDir}\``,
        err instanceof Error ? err.message : String(err),
      ),
    });
    throw err;
  }
}

interface ListContext {
  userId: string;
  respond: RespondFn;
  sessionManager: SessionManager;
}

async function handleList({ userId, respond, sessionManager }: ListContext): Promise<void> {
  const sessions = sessionManager.listSessions(userId);

  const summaries: SessionSummary[] = sessions.map((s) => ({
    id: s.sessionId,
    projectDir: s.workingDirectory,
    status: mapStatus(s.status),
    startedAt: s.createdAt,
    threadTs: s.threadTs,
    channelId: s.channelId,
    messageCount: s.turnCount,
    totalCost: s.totalCostUsd,
  }));

  await respond(ephemeral(
    sessions.length === 0 ? 'No active sessions.' : `${sessions.length} session(s)`,
    sessionListBlocks(summaries),
  ));
}

interface StopContext {
  args: string[];
  userId: string;
  respond: RespondFn;
  sessionManager: SessionManager;
}

async function handleStop({ args, userId, respond, sessionManager }: StopContext): Promise<void> {
  const sessionId = args[0];
  if (!sessionId) {
    await respond(ephemeral('Usage: `/claude stop <session-id>`'));
    return;
  }

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw new SessionNotFoundError(sessionId);
  }

  const info = session.getInfo();
  if (info.userId !== userId) {
    await respond(ephemeral(':no_entry: You can only stop your own sessions.'));
    return;
  }

  sessionManager.stopSession(sessionId);
  await respond(ephemeral(`:white_check_mark: Session \`${sessionId}\` is stopping.`));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapStatus(s: SessionStatus): SessionSummary['status'] {
  switch (s) {
    case SessionStatus.ACTIVE: return 'active';
    case SessionStatus.IDLE: return 'active';
    case SessionStatus.TERMINATED: return 'stopped';
    case SessionStatus.ERROR: return 'error';
    default: return 'stopped';
  }
}
