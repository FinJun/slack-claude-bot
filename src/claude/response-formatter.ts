/**
 * Converts SlackFormattedResponse into Slack-ready text strings.
 */

import type { SlackFormattedResponse } from './message-handler.js';
import { splitMessage } from '../utils/message-splitter.js';

const TOOL_ICON: Record<string, string> = {
  Bash: '[bash]',
  Read: '[read]',
  Write: '[write]',
  Edit: '[edit]',
  WebFetch: '[web]',
  WebSearch: '[search]',
};

function toolIcon(toolName: string): string {
  return TOOL_ICON[toolName] ?? `[${toolName}]`;
}

/**
 * Formats a SlackFormattedResponse into an array of Slack message strings.
 * Returns empty array for messages that should not be sent (ignored, etc.).
 *
 * Each chunk is at most ~3900 chars to stay under Slack's limit.
 */
export function formatForSlack(response: SlackFormattedResponse): string[] {
  switch (response.kind) {
    case 'text':
      return splitMessage(response.text);

    case 'tool_use':
      // Silent — tool use is internal, don't spam Slack
      return [];

    case 'result':
      // Silent — cost/turn info is logged server-side, not shown in thread
      return [];

    case 'system_init':
      // Silent — model info is already shown in the session start message
      return [];

    case 'error':
      return [`*Error:* ${response.message}`];

    case 'ignored':
      return [];
  }
}
