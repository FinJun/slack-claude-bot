/**
 * ClaudeTransport — abstract transport for Claude sessions.
 *
 * LocalTransport wraps the SDK query(). A future SshTransport will wrap
 * an SSH process that proxies to a remote Claude Code CLI.
 */

import type { SDKMessage } from '@anthropic-ai/claude-code';

export interface ClaudeTransport {
  /** Async iterable of SDK messages (system, assistant, result, etc.) */
  readonly messages: AsyncIterable<SDKMessage>;

  /** Send a user message to Claude */
  sendMessage(content: string, sessionId?: string): void;

  /** Interrupt the current Claude turn (soft stop, session stays open) */
  interrupt(): Promise<void>;

  /** Abort the entire session */
  abort(): void;

  /** Close queues and clean up resources */
  close(): void;
}
