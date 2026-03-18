/**
 * SlackSession — one Claude Code session per Slack thread.
 *
 * Lifecycle:
 *   1. Construct with metadata (userId, channelId, threadTs, projectDir)
 *   2. Call start() to launch the SDK query() loop
 *   3. Call pushMessage() to inject user turns
 *   4. Call stop() / interrupt() to end
 *
 * The session delegates to a ClaudeTransport for communicating with Claude.
 * By default a LocalTransport is created (wrapping the SDK query()), but
 * callers may inject any ClaudeTransport (e.g. SshTransport) via options.
 */

import { randomUUID } from 'crypto';
import { SessionStatus } from './session-types.js';
import type { SessionInfo } from './session-types.js';
import { SessionStateMachine } from './session-lifecycle.js';
import { handleSDKMessage } from '../claude/message-handler.js';
import { formatForSlack } from '../claude/response-formatter.js';
import { createCanUseTool, defaultSandboxConfig } from '../security/sandbox-config.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { ClaudeTransport } from '../ssh/types.js';
import { LocalTransport } from '../ssh/local-transport.js';
import type { Options } from '@anthropic-ai/claude-code';

export interface SlackSessionOptions {
  userId: string;
  channelId: string;
  threadTs?: string;
  projectDir: string;
  /** Called with formatted Slack text chunks as Claude responds */
  onMessage: (sessionId: string, chunks: string[]) => Promise<void>;
  /** Called when the session ends (any reason). errorMessage is set when reason === 'error'. */
  onEnd?: (sessionId: string, reason: 'stop' | 'error' | 'timeout', errorMessage?: string) => void;
  /** Permission mode override */
  permissionMode?: Options['permissionMode'];
  /** Resume a previous SDK session */
  resumeSdkSessionId?: string;
  /** Environment variables to inject into the Claude subprocess (e.g. ANTHROPIC_API_KEY or HOME) */
  env?: Record<string, string>;
  /** Claude model override (e.g. 'claude-opus-4-6') */
  model?: string;
  /** Optional pre-built transport — if omitted, a LocalTransport is created in start() */
  transport?: ClaudeTransport;
  /** Server name this session is running on (undefined or 'local' for local sessions) */
  serverName?: string;
}

export class SlackSession {
  readonly id: string;
  private sdkSessionId: string | null = null;

  private readonly stateMachine: SessionStateMachine;
  private transport: ClaudeTransport | null = null;
  private loopPromise: Promise<void> | null = null;

  private createdAt: Date;
  private lastActivityAt: Date;
  private turnCount = 0;
  private totalCostUsd = 0;

  constructor(private readonly opts: SlackSessionOptions) {
    this.id = randomUUID();
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
      serverName: this.opts.serverName,
    };
  }

  /**
   * Push a new user message into the running session.
   */
  pushMessage(content: string): void {
    this.lastActivityAt = new Date();
    this.stateMachine.transition('message_received');
    this.transport?.sendMessage(content, this.sdkSessionId ?? '');
  }

  /**
   * Start the SDK query() loop. Returns immediately; processing happens async.
   */
  start(): void {
    if (this.loopPromise) return;

    if (this.opts.transport) {
      this.transport = this.opts.transport;
    } else {
      const sandboxCfg = defaultSandboxConfig(this.opts.projectDir);
      const canUseTool = createCanUseTool(sandboxCfg);

      this.transport = new LocalTransport({
        cwd: this.opts.projectDir,
        maxTurns: config.MAX_TURNS,
        resumeSessionId: this.opts.resumeSdkSessionId,
        permissionMode: this.opts.permissionMode ?? 'default',
        canUseTool,
        additionalDirectories: config.ALLOWED_DIRECTORIES,
        env: this.opts.env,
        model: this.opts.model ?? 'claude-opus-4-6',
        appendSystemPrompt: 'You are a helpful AI assistant running in a Slack workspace. You can answer general questions, have casual conversations, AND help with software engineering tasks. Do not refuse non-coding questions - be helpful for any topic the user asks about.',
        includePartialMessages: false,
      });
    }

    this.loopPromise = this.runLoop();
  }

  /**
   * Interrupt the current Claude turn (stops in-flight tool use).
   * Does not close the session.
   */
  async interrupt(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.interrupt();
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
    if (this.transport) {
      this.transport.close();
      this.transport.abort();
    }
    this.stateMachine.destroy();
  }

  private async runLoop(): Promise<void> {
    const log = logger.child({ sessionId: this.id });
    log.info('Session loop starting');

    try {
      for await (const message of this.transport!.messages) {
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
      if (this.transport) {
        // Check if we were aborted — transport doesn't expose signal directly,
        // so we check the session status instead
        if (this.status === SessionStatus.TERMINATED) {
          log.info('Session loop aborted');
        } else {
          log.error('Session loop error', { err });
          this.stateMachine.transition('error_occurred');
          const errorMessage = err instanceof Error ? err.message : String(err);
          this.opts.onEnd?.(this.id, 'error', errorMessage);
        }
      }
    } finally {
      if (this.transport) {
        this.transport.close();
      }
      this.stateMachine.destroy();
    }
  }
}
