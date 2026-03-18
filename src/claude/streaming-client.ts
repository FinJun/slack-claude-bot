/**
 * SDK query() wrapper with error handling and option assembly.
 */

import { query } from '@anthropic-ai/claude-code';
import type { Options, Query } from '@anthropic-ai/claude-code';
import { logger } from '../utils/logger.js';
import { ClaudeApiError } from '../utils/errors.js';

export interface StreamingSessionOptions {
  /** AsyncIterable or string prompt */
  prompt: Parameters<typeof query>[0]['prompt'];
  /** Session ID to resume (from a previous SDKResultMessage.session_id) */
  resumeSessionId?: string;
  /** Fork the resumed session into a new session ID */
  forkSession?: boolean;
  /** Permission mode; defaults to 'default' */
  permissionMode?: Options['permissionMode'];
  /** canUseTool callback from sandbox-config */
  canUseTool?: Options['canUseTool'];
  /** Working directory for the subprocess */
  cwd?: string;
  /** Max turns before auto-stopping */
  maxTurns?: number;
  /** AbortController for cancellation */
  abortController?: AbortController;
  /** Include partial stream_event messages */
  includePartialMessages?: boolean;
  /** Additional directories Claude can access */
  additionalDirectories?: string[];
  /** Claude model override */
  model?: string;
  /** Environment variables to pass to the Claude subprocess (e.g. per-user ANTHROPIC_API_KEY) */
  env?: Record<string, string>;
  /** Append to the system prompt */
  appendSystemPrompt?: string;
}

/**
 * Creates a streaming SDK session (Query object).
 * Throws ClaudeApiError if the SDK throws synchronously during setup.
 */
export function createStreamingSession(opts: StreamingSessionOptions): Query {
  const options: Options = {
    permissionMode: opts.permissionMode ?? 'default',
    maxTurns: opts.maxTurns,
    cwd: opts.cwd,
    canUseTool: opts.canUseTool,
    abortController: opts.abortController,
    includePartialMessages: opts.includePartialMessages ?? false,
    additionalDirectories: opts.additionalDirectories,
    model: opts.model,
    env: opts.env,
    appendSystemPrompt: opts.appendSystemPrompt,
  };

  if (opts.resumeSessionId) {
    options.resume = opts.resumeSessionId;
    options.forkSession = opts.forkSession ?? false;
  }

  try {
    return query({ prompt: opts.prompt, options });
  } catch (err) {
    logger.error('Failed to create streaming session', { err });
    throw new ClaudeApiError('Failed to start Claude session', err);
  }
}
