/**
 * /claude slash command handler.
 *
 * Subcommands:
 *   /claude start <project-dir> [description...]       — start a new session
 *   /claude list                                        — list active sessions
 *   /claude stop <session-id>                           — stop a session
 *   /claude auth <api-key>                              — register Anthropic API key (DM only)
 *   /claude whoami                                      — show auth status
 *   /claude revoke                                      — delete stored API key
 *   /claude register <server> <username> <password>     — register server credentials (DM only)
 *   /claude servers                                     — list configured servers
 *   /claude unregister <server>                         — remove server credentials
 *   /claude help                                        — usage help
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
import {
  handleAuth,
  handleWhoami,
  handleRevoke,
  handleServerRegister,
  handleServerList,
  handleServerUnregister,
  handleAddServer,
  handleRemoveServer,
} from './auth.js';
import { handleToken, handleLogout } from './login.js';
import { getServerRegistry } from '../../servers/server-registry.js';
import { UserStore } from '../../db/queries/users.js';
import { getDatabase } from '../../db/database.js';

function getUserStore(): UserStore {
  return new UserStore(getDatabase());
}

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
  '`/claude token <token>`',
  '  Register your Claude OAuth token (DM only).',
  '  Run `claude setup-token` on your own machine to obtain a token.',
  '',
  '`/claude logout`',
  '  Delete your stored Claude credentials (DM only).',
  '',
  '`/claude auth <api-key>`',
  '  Register your Anthropic API key (DM only).',
  '',
  '`/claude register <server> <username> <password>`',
  '  Register your credentials for a configured server (DM only).',
  '',
  '`/claude servers`',
  '  List all configured servers and your registration status.',
  '',
  '`/claude unregister <server>`',
  '  Remove your stored credentials for a server.',
  '',
  '`/claude addserver <name> <host> [port]`',
  '  Add a new server to the bot configuration (persisted to .env).',
  '',
  '`/claude removeserver <name>`',
  '  Remove a server from the bot configuration (persisted to .env).',
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
          await respond(ephemeral(
            'Run `claude setup-token` on your own machine or terminal to obtain a token, then register it with `/claude token <token>`.',
          ));
          break;
        }

        case 'token': {
          if (!isDM) {
            await respond(ephemeral('⚠️ Token registration is only allowed in DMs.'));
            break;
          }
          const token = args.join('').trim();
          if (!token) {
            await respond(ephemeral('Usage: `/claude token <token>`'));
            break;
          }
          const tokenMsg = await handleToken(userId, token, isDM);
          await respond(ephemeral(tokenMsg));
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
          if (args.length < 3) {
            await respond(ephemeral('Usage: `/claude register <server> <username> <password>`'));
            break;
          }
          const [serverName, username, ...passwordParts] = args;
          const password = passwordParts.join(' ');
          const msg = await handleServerRegister(userId, serverName, username, password, isDM);
          await respond(ephemeral(msg));
          break;
        }

        case 'servers': {
          const msg = await handleServerList(userId);
          await respond(ephemeral(msg));
          break;
        }

        case 'unregister': {
          const serverName = args[0] ?? '';
          const msg = await handleServerUnregister(userId, serverName);
          await respond(ephemeral(msg));
          break;
        }

        case 'addserver': {
          if (args.length < 2) {
            await respond(ephemeral('Usage: `/claude addserver <name> <host> [port]`'));
            break;
          }
          const [name, host] = args;
          const port = args[2] || '22';
          const msg = await handleAddServer(name, host, port);
          await respond(ephemeral(msg));
          break;
        }

        case 'removeserver': {
          if (!args[0]) {
            await respond(ephemeral('Usage: `/claude removeserver <name>`'));
            break;
          }
          const msg = await handleRemoveServer(args[0]);
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
  if (!args[0]) {
    await respond(ephemeral('Usage: `/claude start <project-dir> [description...]`'));
    return;
  }

  // Parse server:path or server path syntax
  let serverName: string | undefined;
  let projectDir: string;

  if (args[0].includes(':') && !args[0].startsWith('/')) {
    // Syntax: felab2:/home/user/project
    const colonIdx = args[0].indexOf(':');
    serverName = args[0].substring(0, colonIdx);
    projectDir = args[0].substring(colonIdx + 1);
  } else {
    // Check if first arg is a known server name
    const registry = getServerRegistry();
    const maybeServer = registry.resolve(args[0]);
    if (maybeServer && args.length >= 2) {
      // Syntax: felab2 /home/user/project
      serverName = args[0];
      projectDir = args[1];
    } else {
      // Syntax: /home/user/project (local, backward compatible)
      projectDir = args[0];
    }
  }

  if (serverName) {
    const registry = getServerRegistry();
    const server = registry.resolve(serverName);
    if (!server) {
      const available = registry.list().map(s => s.name).join(', ');
      await respond(ephemeral(`Unknown server \`${serverName}\`. Available: ${available}`));
      return;
    }

    if (!registry.isLocal(serverName)) {
      // Check user has registered credentials for this server
      const mapping = getUserStore().getServerMapping(userId, serverName);
      if (!mapping) {
        await respond(ephemeral(`You have not registered for server \`${serverName}\`. Use \`/claude register ${serverName} <username> <password>\` first.`));
        return;
      }
    }
  }

  const registry = getServerRegistry();
  const serverLabel = serverName && !registry.isLocal(serverName) ? ` [${serverName}]` : '';

  // Description starts after the server+path arguments that were consumed
  // "server path desc..." → args[0]=server, args[1]=path, args[2..]=desc
  // "server:path desc..." → args[0]=server:path, args[1..]=desc
  // "/path desc..."       → args[0]=path, args[1..]=desc
  const descriptionStartIdx = (serverName && args.length >= 2 && !args[0].includes(':')) ? 2 : 1;
  const description = args.slice(descriptionStartIdx).join(' ') || undefined;

  // Auto-join the channel so the bot can receive thread messages
  try {
    await client.conversations.join({ channel: channelId });
  } catch {
    // Already a member or DM — ignore
  }

  // Create the thread first so we have a threadTs for the session
  const threadMsg = await client.chat.postMessage({
    channel: channelId,
    text: `:hourglass_flowing_sand: Starting Claude session for \`${projectDir}\`${serverLabel}…`,
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
      onEnd: async (sessionId, reason, errorMessage) => {
        logger.info('Session ended', { sessionId, reason, errorMessage });
        try {
          let text: string;
          if (reason === 'error') {
            text = errorMessage
              ? `:x: Session error: ${errorMessage}`
              : `:x: Session ended due to an error.`;
          } else {
            text = `:white_check_mark: Session ended (${reason}).`;
          }
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text,
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
        serverName: info.serverName,
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
    serverName: s.serverName,
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
