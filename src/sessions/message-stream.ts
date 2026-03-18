/**
 * AsyncIterable message stream for SDK streaming input mode.
 *
 * Provides a push-based queue that feeds SDKUserMessages into the SDK's
 * query() function via an AsyncIterable<SDKUserMessage>.
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-code';

interface QueueEntry {
  resolve: (value: SDKUserMessage | null) => void;
}

/**
 * Push-based queue that bridges incoming Slack messages to the SDK's
 * AsyncIterable<SDKUserMessage> input.
 */
export class MessageQueue {
  private readonly pending: SDKUserMessage[] = [];
  private waiter: QueueEntry | null = null;
  private closed = false;

  /**
   * Push a user message into the queue.
   * If the generator is waiting, resolves it immediately.
   */
  pushMessage(content: string, sessionId = ''): void {
    if (this.closed) return;

    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: sessionId,
    };

    if (this.waiter) {
      const { resolve } = this.waiter;
      this.waiter = null;
      resolve(msg);
    } else {
      this.pending.push(msg);
    }
  }

  /**
   * Wait for the next message. Returns null when the queue is closed.
   */
  waitForNext(): Promise<SDKUserMessage | null> {
    if (this.pending.length > 0) {
      return Promise.resolve(this.pending.shift()!);
    }
    if (this.closed) {
      return Promise.resolve(null);
    }
    return new Promise<SDKUserMessage | null>((resolve) => {
      this.waiter = { resolve };
    });
  }

  /**
   * Close the queue. Any pending waitForNext() call resolves with null,
   * and the AsyncIterable generator will return.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.waiter) {
      const { resolve } = this.waiter;
      this.waiter = null;
      resolve(null);
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/**
 * Creates an AsyncIterable<SDKUserMessage> backed by a MessageQueue.
 *
 * The generator yields messages as they arrive and exits cleanly when
 * either the queue is closed or the AbortSignal fires.
 */
export async function* createMessageStream(
  queue: MessageQueue,
  signal: AbortSignal,
): AsyncIterable<SDKUserMessage> {
  // Close the queue when aborted so waitForNext() unblocks
  const onAbort = () => queue.close();
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    while (!signal.aborted) {
      const msg = await queue.waitForNext();
      if (msg === null) break;
      yield msg;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    queue.close();
  }
}
