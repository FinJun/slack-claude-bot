/**
 * SDK message parsing — converts raw SDKMessage types into structured
 * SlackFormattedResponse objects for downstream formatting.
 */

import type { SDKMessage } from '@anthropic-ai/claude-code';

export type SlackFormattedResponse =
  | { kind: 'text'; text: string; sessionId: string }
  | { kind: 'tool_use'; toolName: string; sessionId: string; summary: string }
  | { kind: 'result'; subtype: string; costUsd: number; turns: number; sessionId: string }
  | { kind: 'system_init'; model: string; sessionId: string; tools: string[] }
  | { kind: 'error'; message: string; sessionId: string }
  | { kind: 'ignored' };

/**
 * Parses a single SDKMessage into a SlackFormattedResponse.
 */
export function handleSDKMessage(message: SDKMessage): SlackFormattedResponse {
  switch (message.type) {
    case 'system': {
      if (message.subtype === 'init') {
        return {
          kind: 'system_init',
          model: message.model,
          sessionId: message.session_id,
          tools: message.tools,
        };
      }
      // compact_boundary or unknown system subtypes
      return { kind: 'ignored' };
    }

    case 'assistant': {
      const parts: string[] = [];
      const toolUses: string[] = [];

      for (const block of message.message.content) {
        if (block.type === 'text') {
          parts.push(block.text);
        } else if (block.type === 'tool_use') {
          toolUses.push(block.name);
        }
      }

      // If there are tool uses, report the first one as a tool_use response
      // Text content takes priority
      if (parts.length > 0) {
        return {
          kind: 'text',
          text: parts.join(''),
          sessionId: message.session_id,
        };
      }
      if (toolUses.length > 0) {
        return {
          kind: 'tool_use',
          toolName: toolUses[0],
          sessionId: message.session_id,
          summary: toolUses.length === 1
            ? toolUses[0]
            : `${toolUses[0]} (+${toolUses.length - 1} more)`,
        };
      }
      return { kind: 'ignored' };
    }

    case 'result': {
      if (message.subtype === 'success') {
        return {
          kind: 'result',
          subtype: 'success',
          costUsd: message.total_cost_usd,
          turns: message.num_turns,
          sessionId: message.session_id,
        };
      }
      // error_max_turns or error_during_execution
      return {
        kind: 'error',
        message: message.subtype === 'error_max_turns'
          ? 'Maximum turns reached'
          : 'Error during execution',
        sessionId: message.session_id,
      };
    }

    case 'user':
      // Echoed user messages — not forwarded to Slack
      return { kind: 'ignored' };

    case 'stream_event':
      // Partial stream events — ignored unless includePartialMessages is set
      return { kind: 'ignored' };

    default:
      return { kind: 'ignored' };
  }
}
