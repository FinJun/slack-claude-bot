/**
 * LocalTransport — wraps the SDK query() into the ClaudeTransport interface.
 *
 * Extracts the session-creation logic that previously lived inline in
 * SlackSession.start(), so that SlackSession can work with any transport.
 */

import type { Query, SDKMessage, Options } from '@anthropic-ai/claude-code';
import { createStreamingSession } from '../claude/streaming-client.js';
import { MessageQueue, createMessageStream } from '../sessions/message-stream.js';
import type { ClaudeTransport } from './types.js';

export interface LocalTransportOptions {
  cwd: string;
  maxTurns: number;
  env?: Record<string, string>;
  model?: string;
  appendSystemPrompt?: string;
  permissionMode?: Options['permissionMode'];
  canUseTool?: Options['canUseTool'];
  additionalDirectories?: string[];
  resumeSessionId?: string;
  includePartialMessages?: boolean;
}

export class LocalTransport implements ClaudeTransport {
  private readonly queue: MessageQueue;
  private readonly abortController: AbortController;
  private readonly query: Query;

  constructor(opts: LocalTransportOptions) {
    this.abortController = new AbortController();
    this.queue = new MessageQueue();

    const signal = this.abortController.signal;
    const msgStream = createMessageStream(this.queue, signal);

    this.query = createStreamingSession({
      prompt: msgStream,
      resumeSessionId: opts.resumeSessionId,
      permissionMode: opts.permissionMode ?? 'default',
      canUseTool: opts.canUseTool,
      cwd: opts.cwd,
      maxTurns: opts.maxTurns,
      abortController: this.abortController,
      includePartialMessages: opts.includePartialMessages ?? false,
      additionalDirectories: opts.additionalDirectories,
      model: opts.model,
      env: opts.env,
      appendSystemPrompt: opts.appendSystemPrompt,
    });
  }

  get messages(): AsyncIterable<SDKMessage> {
    return this.query;
  }

  sendMessage(content: string, sessionId = ''): void {
    this.queue.pushMessage(content, sessionId);
  }

  async interrupt(): Promise<void> {
    await this.query.interrupt();
  }

  abort(): void {
    this.abortController.abort();
  }

  close(): void {
    this.queue.close();
  }
}
