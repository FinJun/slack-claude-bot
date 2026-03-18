/**
 * SlackSession — one Claude Code session per Slack thread.
 *
 * Lifecycle:
 *   1. Construct with metadata (userId, channelId, threadTs, projectDir)
 *   2. Call start() to launch the SDK query() loop
 *   3. Call pushMessage() to inject user turns
 *   4. Call stop() / interrupt() to end
 *
 * The SDK query() runs as a long-lived async generator. New user messages
 * are fed through a MessageQueue → AsyncIterable<SDKUserMessage>.
 */

import { randomUUID } from 'crypto';
import type { Query } from '@anthropic-ai/claude-code';
import { SessionStatus } from './session-types.js';
import type { SessionInfo } from './session-types.js';
import { MessageQueue, createMessageStream } from './message-stream.js';
import { SessionStateMachine } from './session-lifecycle.js';
import { createStreamingSession } from '../claude/streaming-client.js';
import { handleSDKMessage } from '../claude/message-handler.js';
import { formatForSlack } from '../claude/response-formatter.js';
import { createCanUseTool, defaultSandboxConfig } from '../security/sandbox-config.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { Options } from '@anthropic-ai/claude-code';

export interface SlackSessionOptions {
  userId: string;
  channelId: string;
  threadTs?: string;
  projectDir: string;
  /** Called with formatted Slack text chunks as Claude responds */
  onMessage: (sessionId: string, chunks: string[]) => Promise<void>;
  /** Called when the session ends (any reason) */
  onEnd?: (sessionId: string, reason: 'stop' | 'error' | 'timeout') => void;
  /** Permission mode override */
  permissionMode?: Options['permissionMode'];
  /** Resume a previous SDK session */
  resumeSdkSessionId?: string;
  /** Environment variables to inject into the Claude subprocess (e.g. ANTHROPIC_API_KEY or HOME) */
  env?: Record<string, string>;
}

export class SlackSession {
  readonly id: string;
  private sdkSessionId: string | null = null;

  private readonly queue: MessageQueue;
  private readonly abortController: AbortController;
  private readonly stateMachine: SessionStateMachine;
  private query: Query | null = null;
  private loopPromise: Promise<void> | null = null;

  private createdAt: Date;
  private lastActivityAt: Date;
  private turnCount = 0;
  private totalCostUsd = 0;

  constructor(private readonly opts: SlackSessionOptions) {
    this.id = randomUUID();
    this.queue = new MessageQueue();
    this.abortController = new AbortController();
    this.createdAt = new Date();
    this.lastActivityAt = new Date();

    this.stateMachine = new SessionStateMachine({
      idleTimeoutMs: config.SESSION_IDLE_TIMEOUT_MS,
      onIdle: () => {
        logger.info('Session became idle', { sessionId: this.id });
      },
      onTimeout: () => {
        logger.info('Session idle timeout', { sessionId: this.id });
        this.stateMachine.transition('stop_requested');
        this.opts.onEnd?.(this.id, 'timeout');
        this.stop();
      },
    });
  }

  get status(): SessionStatus {
    return this.stateMachine.getStatus();
  }

  getInfo(): SessionInfo {
    return {
      sessionId: this.id,
      userId: this.opts.userId,
      channelId: this.opts.channelId,
      threadTs: this.opts.threadTs,
      status: this.status,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      turnCount: this.turnCount,
      totalCostUsd: this.totalCostUsd,
      workingDirectory: this.opts.projectDir,
    };
  }

  /**
   * Push a new user message into the running session.
   */
  pushMessage(content: string): void {
    this.lastActivityAt = new Date();
    this.stateMachine.transition('message_received');
    this.queue.pushMessage(content, this.sdkSessionId ?? '');
  }

  /**
   * Start the SDK query() loop. Returns immediately; processing happens async.
   */
  start(): void {
    if (this.loopPromise) return;

    const signal = this.abortController.signal;
    const msgStream = createMessageStream(this.queue, signal);

    const sandboxCfg = defaultSandboxConfig(this.opts.projectDir);
    const canUseTool = createCanUseTool(sandboxCfg);

    this.query = createStreamingSession({
      prompt: msgStream,
      resumeSessionId: this.opts.resumeSdkSessionId,
      permissionMode: this.opts.permissionMode ?? 'default',
      canUseTool,
      cwd: this.opts.projectDir,
      maxTurns: config.MAX_TURNS,
      abortController: this.abortController,
      includePartialMessages: false,
      additionalDirectories: config.ALLOWED_DIRECTORIES,
      env: this.opts.env,
    });

    this.loopPromise = this.runLoop();
  }

  /**
   * Interrupt the current Claude turn (stops in-flight tool use).
   * Does not close the session.
   */
  async interrupt(): Promise<void> {
    if (this.query) {
      try {
        await this.query.interrupt();
      } catch (err) {
        logger.warn('interrupt() failed', { sessionId: this.id, err });
      }
    }
  }

  /**
   * Stop the session gracefully.
   */
  stop(): void {
    this.stateMachine.transition('stop_requested');
    this.queue.close();
    this.abortController.abort();
    this.stateMachine.destroy();
  }

  private async runLoop(): Promise<void> {
    const log = logger.child({ sessionId: this.id });
    log.info('Session loop starting');

    try {
      for await (const message of this.query!) {
        if (this.abortController.signal.aborted) break;

        // Extract SDK session ID from the first system init message
        if (message.type === 'system' && message.subtype === 'init') {
          this.sdkSessionId = message.session_id;
          log.info('SDK session initialised', { sdkSessionId: this.sdkSessionId, model: message.model });
        }

        // Track cost + turns from result messages
        if (message.type === 'result') {
          this.totalCostUsd = message.total_cost_usd;
          this.turnCount = message.num_turns;
          this.lastActivityAt = new Date();

          if (message.subtype === 'success') {
            this.stateMachine.transition('turn_completed');
          } else {
            this.stateMachine.transition('error_occurred');
          }
        }

        // Convert to Slack format and emit
        const formatted = handleSDKMessage(message);
        const chunks = formatForSlack(formatted);
        if (chunks.length > 0) {
          try {
            await this.opts.onMessage(this.id, chunks);
          } catch (err) {
            log.warn('onMessage callback failed', { err });
          }
        }
      }

      log.info('Session loop ended normally');
    } catch (err) {
      if (this.abortController.signal.aborted) {
        log.info('Session loop aborted');
      } else {
        log.error('Session loop error', { err });
        this.stateMachine.transition('error_occurred');
        this.opts.onEnd?.(this.id, 'error');
      }
    } finally {
      this.queue.close();
      this.stateMachine.destroy();
    }
  }
}
