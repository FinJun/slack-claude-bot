/**
 * Tool policy engine - decides allow/deny for Claude tool use requests.
 *
 * The canUseTool callback is passed directly to the SDK's Options.canUseTool.
 * Return type matches SDK PermissionResult.
 */

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; message?: string }
  | { behavior: 'deny'; message: string };

export interface ToolPolicy {
  /** Tools explicitly allowed regardless of other rules */
  allowedTools?: string[];
  /** Tools explicitly denied regardless of other rules */
  deniedTools?: string[];
  /** Whether to allow bash tool (subject to bash filter) */
  allowBash?: boolean;
  /** Whether to allow file write tools */
  allowWrite?: boolean;
  /** Whether to allow network tools */
  allowNetwork?: boolean;
}

const WRITE_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
]);

const NETWORK_TOOLS = new Set([
  'WebFetch',
  'WebSearch',
]);

const BASH_TOOL = 'Bash';

/** Default policy: deny bash and writes, allow reads */
export const DEFAULT_POLICY: ToolPolicy = {
  allowBash: false,
  allowWrite: false,
  allowNetwork: true,
};

/** Permissive policy for trusted sessions */
export const PERMISSIVE_POLICY: ToolPolicy = {
  allowBash: true,
  allowWrite: true,
  allowNetwork: true,
};

/** Read-only policy */
export const READONLY_POLICY: ToolPolicy = {
  allowBash: false,
  allowWrite: false,
  allowNetwork: false,
};

export function createToolPolicyChecker(policy: ToolPolicy) {
  return function checkToolPolicy(
    toolName: string,
    input: Record<string, unknown>,
  ): PermissionDecision {
    // Explicit allow list takes highest priority
    if (policy.allowedTools?.includes(toolName)) {
      return { behavior: 'allow' };
    }

    // Explicit deny list
    if (policy.deniedTools?.includes(toolName)) {
      return { behavior: 'deny', message: `Tool '${toolName}' is explicitly denied by policy.` };
    }

    // Bash requires special handling
    if (toolName === BASH_TOOL) {
      if (!policy.allowBash) {
        return { behavior: 'deny', message: `Bash tool is disabled by policy.` };
      }
      return { behavior: 'allow' };
    }

    // Write tools
    if (WRITE_TOOLS.has(toolName)) {
      if (!policy.allowWrite) {
        return { behavior: 'deny', message: `Write tool '${toolName}' is disabled by policy.` };
      }
      return { behavior: 'allow' };
    }

    // Network tools
    if (NETWORK_TOOLS.has(toolName)) {
      if (!policy.allowNetwork) {
        return { behavior: 'deny', message: `Network tool '${toolName}' is disabled by policy.` };
      }
      return { behavior: 'allow' };
    }

    // All other tools allowed by default
    return { behavior: 'allow' };
  };
}
