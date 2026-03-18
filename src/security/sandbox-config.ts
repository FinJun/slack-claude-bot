/**
 * Sandbox configuration - assembles a canUseTool callback from the individual
 * policy engines (tool-policy, bash-filter, path-validator).
 *
 * The returned canUseTool is compatible with the SDK's Options.canUseTool.
 */

import type { PermissionResult } from '@anthropic-ai/claude-code';

import { createToolPolicyChecker, type ToolPolicy, DEFAULT_POLICY } from './tool-policy.js';
import { createBashFilter, type BashFilterConfig, DEFAULT_BASH_FILTER_CONFIG } from './bash-filter.js';
import { createPathValidator, type PathValidatorConfig } from './path-validator.js';

export interface SandboxConfig {
  /** High-level tool allow/deny policy */
  toolPolicy?: ToolPolicy;
  /** Bash-specific command filtering (applied when bash is allowed by toolPolicy) */
  bashFilter?: BashFilterConfig;
  /** File path validation (applied to Read/Write/Edit tools) */
  pathValidator?: PathValidatorConfig;
  /** Working directory — added to allowedReadPaths automatically */
  cwd?: string;
}

/** Build a default SandboxConfig scoped to a working directory */
export function defaultSandboxConfig(cwd: string): SandboxConfig {
  return {
    toolPolicy: DEFAULT_POLICY,
    bashFilter: DEFAULT_BASH_FILTER_CONFIG,
    pathValidator: {
      allowedReadPaths: [cwd],
      allowedWritePaths: [cwd],
    },
    cwd,
  };
}

/**
 * Creates a canUseTool callback suitable for passing to the SDK's Options.canUseTool.
 *
 * Evaluation order:
 *  1. tool-policy (allow/deny at tool level)
 *  2. path-validator (for file tools)
 *  3. bash-filter (for Bash tool)
 */
export function createCanUseTool(config: SandboxConfig): (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal },
) => Promise<PermissionResult> {
  const toolPolicy = config.toolPolicy ?? DEFAULT_POLICY;
  const bashFilterConfig = config.bashFilter ?? DEFAULT_BASH_FILTER_CONFIG;

  // If pathValidator is configured, include cwd in allowed paths
  let pathValidatorConfig: PathValidatorConfig | undefined = config.pathValidator;
  if (config.cwd && pathValidatorConfig) {
    const cwd = config.cwd;
    pathValidatorConfig = {
      ...pathValidatorConfig,
      allowedReadPaths: [...new Set([...pathValidatorConfig.allowedReadPaths, cwd])],
      allowedWritePaths: [...new Set([...pathValidatorConfig.allowedWritePaths, cwd])],
    };
  }

  const checkToolPolicy = createToolPolicyChecker(toolPolicy);
  const filterBash = createBashFilter(bashFilterConfig);
  const validatePath = pathValidatorConfig ? createPathValidator(pathValidatorConfig) : null;

  return async function canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    _options: { signal: AbortSignal },
  ): Promise<PermissionResult> {
    // Step 1: tool-level policy
    const policyResult = checkToolPolicy(toolName, input);
    if (policyResult.behavior === 'deny') {
      return { behavior: 'deny', message: policyResult.message };
    }

    // Step 2: path validation for file tools
    if (validatePath) {
      const pathResult = validatePath(toolName, input);
      if (pathResult.behavior === 'deny') {
        return { behavior: 'deny', message: pathResult.message };
      }
    }

    // Step 3: bash filter for Bash tool
    if (toolName === 'Bash') {
      const bashResult = filterBash(input);
      if (bashResult.behavior === 'deny') {
        return { behavior: 'deny', message: bashResult.message };
      }
      if (bashResult.behavior === 'allow' && bashResult.updatedInput) {
        return { behavior: 'allow', updatedInput: bashResult.updatedInput };
      }
    }

    return { behavior: 'allow', updatedInput: input };
  };
}
