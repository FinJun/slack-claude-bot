/**
 * SessionManager — central registry of all live SlackSessions.
 *
 * Provides create / lookup / send / stop operations.
 * Persists session metadata to SQLite via SessionStore.
 */

import { randomUUID } from 'crypto';
import { SlackSession } from './slack-session.js';
import type { SlackSessionOptions } from './slack-session.js';
import type { SessionInfo } from './session-types.js';
import { SessionStore } from '../db/queries/sessions.js';
import { UserStore } from '../db/queries/users.js';
import { decrypt } from '../utils/crypto.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  SessionNotFoundError,
  SessionLimitExceededError,
} from '../utils/errors.js';

export interface CreateSessionParams {
  userId: string;
  channelId: string;
  threadTs: string;
  projectDir: string;
  onMessage: SlackSessionOptions['onMessage'];
  onEnd?: SlackSessionOptions['onEnd'];
}

export class SessionManager {
  /** Live in-memory sessions keyed by session UUID */
  private readonly sessions = new Map<string, SlackSession>();
  /** Index: "channelId:threadTs" → sessionId */
  private readonly threadIndex = new Map<string, string>();

  private readonly store: SessionStore;
  private readonly userStore: UserStore;

  constructor(userStore: UserStore) {
    this.store = new SessionStore();
    this.userStore = userStore;
  }

  /**
   * Create a new session for a Slack thread.
   * Throws SessionLimitExceededError if the user already has too many active sessions.
   */
  createSession(params: CreateSessionParams): SessionInfo {
    const activeCount = this.store.getActiveCount(params.userId);
    if (activeCount >= config.MAX_SESSIONS_PER_USER) {
      throw new SessionLimitExceededError(params.userId, config.MAX_SESSIONS_PER_USER);
    }

    // Resolve per-user API key: decrypt from DB, fall back to server key, or use claude login
    let apiKey: string | undefined;
    try {
      const row = this.userStore.getApiKey(params.userId);
      if (row) {
        apiKey = decrypt(
          { encrypted: row.encrypted_api_key, iv: row.key_iv, authTag: row.key_auth_tag },
          config.ENCRYPTION_KEY,
        );
      }
    } catch (err) {
      logger.warn('Failed to decrypt user API key, falling back to server key', {
        userId: params.userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    // Fall back to server-level key (empty string means use claude login session)
    if (!apiKey && config.ANTHROPIC_API_KEY) {
      apiKey = config.ANTHROPIC_API_KEY;
    }

    // Resolve per-user OAuth token
    let oauthToken: string | undefined;
    try {
      const oauthRow = this.userStore.getOAuthToken(params.userId);
      if (oauthRow) {
        oauthToken = decrypt(
          {
            encrypted: oauthRow.encrypted_oauth_token,
            iv: oauthRow.oauth_token_iv,
            authTag: oauthRow.oauth_token_auth_tag,
          },
          config.ENCRYPTION_KEY,
        );
      }
    } catch (err) {
      logger.warn('Failed to decrypt user OAuth token', {
        userId: params.userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Resolve per-user environment for Claude auth
    // Priority: per-user OAuth token > per-user API key > config_dir > os_username
    let sessionEnv: Record<string, string> | undefined;
    if (oauthToken) {
      sessionEnv = { ...process.env as Record<string, string>, CLAUDE_CODE_OAUTH_TOKEN: oauthToken };
      logger.info('Using per-user CLAUDE_CODE_OAUTH_TOKEN for Claude auth', {
        userId: params.userId,
      });
    } else if (apiKey) {
      sessionEnv = { ...process.env as Record<string, string>, ANTHROPIC_API_KEY: apiKey };
    } else {
      const configDir = this.userStore.getConfigDir(params.userId);
      if (configDir) {
        sessionEnv = { ...process.env as Record<string, string>, CLAUDE_CONFIG_DIR: configDir };
        logger.info('Using per-user CLAUDE_CONFIG_DIR for Claude auth', {
          userId: params.userId,
          configDir,
        });
      } else {
        const osUsername = this.userStore.getOsUsername(params.userId);
        if (osUsername) {
          sessionEnv = { ...process.env as Record<string, string>, HOME: `/home/${osUsername}` };
          logger.info('Using OS user HOME for Claude auth', {
            userId: params.userId,
            osUsername,
          });
        }
      }
    }

    const session = new SlackSession({
      userId: params.userId,
      channelId: params.channelId,
      threadTs: params.threadTs,
      projectDir: params.projectDir,
      onMessage: params.onMessage,
      env: sessionEnv,
      onEnd: (sessionId, reason) => {
        params.onEnd?.(sessionId, reason);
        this.handleSessionEnd(sessionId, reason);
      },
    });

    // Persist to DB
    this.store.create({
      id: session.id,
      slack_thread_ts: params.threadTs,
      slack_channel_id: params.channelId,
      slack_user_id: params.userId,
      project_dir: params.projectDir,
    });

    this.sessions.set(session.id, session);
    this.threadIndex.set(this.threadKey(params.channelId, params.threadTs), session.id);

    session.start();

    logger.info('Session created', {
      sessionId: session.id,
      userId: params.userId,
      channelId: params.channelId,
      threadTs: params.threadTs,
    });

    return session.getInfo();
  }

  /**
   * Look up a live session by Slack thread coordinates.
   */
  getSessionByThread(channelId: string, threadTs: string): SlackSession | undefined {
    const sessionId = this.threadIndex.get(this.threadKey(channelId, threadTs));
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  /**
   * Look up a live session by session ID.
   */
  getSession(sessionId: string): SlackSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Push a user message to a session identified by ID.
   * Throws SessionNotFoundError if the session is not live.
   */
  sendMessage(sessionId: string, content: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    session.pushMessage(content);
    this.store.updateActivity(sessionId);
  }

  /**
   * Stop a session by ID.
   */
  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    session.stop();
    this.store.update(sessionId, { status: 'completed' });
    this.removeFromIndex(session);
    this.sessions.delete(sessionId);
    logger.info('Session stopped', { sessionId });
  }

  /**
   * List SessionInfo for all live sessions, optionally filtered by userId.
   */
  listSessions(userId?: string): SessionInfo[] {
    const infos: SessionInfo[] = [];
    for (const session of this.sessions.values()) {
      const info = session.getInfo();
      if (!userId || info.userId === userId) {
        infos.push(info);
      }
    }
    return infos;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private handleSessionEnd(sessionId: string, reason: 'stop' | 'error' | 'timeout'): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const dbStatus = reason === 'error' ? 'error' : 'completed';
    try {
      this.store.update(sessionId, { status: dbStatus });
    } catch (err) {
      logger.warn('Failed to update session status in DB', { sessionId, err });
    }

    this.removeFromIndex(session);
    this.sessions.delete(sessionId);
    logger.info('Session removed from manager', { sessionId, reason });
  }

  private removeFromIndex(session: SlackSession): void {
    const info = session.getInfo();
    if (info.threadTs) {
      this.threadIndex.delete(this.threadKey(info.channelId, info.threadTs));
    }
  }

  private threadKey(channelId: string, threadTs: string): string {
    return `${channelId}:${threadTs}`;
  }
}
