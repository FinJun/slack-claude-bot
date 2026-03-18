/**
 * Bash command filter - validates and optionally rewrites bash tool inputs.
 *
 * Applied when the Bash tool is permitted by tool-policy but we still want
 * to block specific dangerous commands or patterns.
 */

export interface BashFilterConfig {
  /** Block commands that match these patterns (regex strings) */
  blockedPatterns?: string[];
  /** Allow only commands matching these patterns (regex strings). If set, acts as allowlist. */
  allowedPatterns?: string[];
  /** Maximum command length in characters */
  maxCommandLength?: number;
  /** Block sudo/su usage */
  blockSudo?: boolean;
  /** Block commands that access sensitive paths */
  blockSensitivePaths?: boolean;
}

export type BashFilterResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

/** Patterns that are always dangerous regardless of config */
const ALWAYS_BLOCKED: RegExp[] = [
  // Fork bomb
  /:\s*\(\s*\)\s*\{.*:\s*\|.*:\s*&.*\}/,
  // rm -rf / or similar catastrophic deletes
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+).*[/\\]\s*$/,
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\/\b/,
  /rm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+\/\b/,
  // Format disk
  /mkfs\./,
  /dd\s+.*of=\/dev\/(s|h|xv|v)d/,
  // Overwrite kernel/boot
  />\s*\/dev\/(s|h|xv)d[a-z]\b/,
];

const SENSITIVE_PATHS: RegExp[] = [
  /\/etc\/shadow/,
  /\/etc\/passwd/,
  /\/etc\/sudoers/,
  /\/root\//,
  /~\/\.ssh\//,
  /\/proc\/sys/,
];

export const DEFAULT_BASH_FILTER_CONFIG: BashFilterConfig = {
  blockSudo: true,
  blockSensitivePaths: true,
  maxCommandLength: 4096,
};

export function createBashFilter(config: BashFilterConfig = DEFAULT_BASH_FILTER_CONFIG) {
  const compiledBlocked = (config.blockedPatterns ?? []).map((p) => new RegExp(p));
  const compiledAllowed = (config.allowedPatterns ?? []).map((p) => new RegExp(p));

  return function filterBash(input: Record<string, unknown>): BashFilterResult {
    const command = input['command'];

    if (typeof command !== 'string') {
      return { behavior: 'deny', message: 'Bash tool input missing required string field "command".' };
    }

    // Length check
    if (config.maxCommandLength !== undefined && command.length > config.maxCommandLength) {
      return {
        behavior: 'deny',
        message: `Command exceeds maximum length of ${config.maxCommandLength} characters.`,
      };
    }

    // Always-blocked patterns (catastrophic commands)
    for (const pattern of ALWAYS_BLOCKED) {
      if (pattern.test(command)) {
        return { behavior: 'deny', message: `Command matches a permanently blocked pattern: ${pattern.source}` };
      }
    }

    // Sudo/su block
    if (config.blockSudo) {
      if (/\bsudo\b/.test(command) || /\bsu\s/.test(command) || /\bsu\s*$/.test(command)) {
        return { behavior: 'deny', message: 'sudo/su usage is not permitted.' };
      }
    }

    // Sensitive paths block
    if (config.blockSensitivePaths) {
      for (const pattern of SENSITIVE_PATHS) {
        if (pattern.test(command)) {
          return { behavior: 'deny', message: `Command accesses a sensitive path: ${pattern.source}` };
        }
      }
    }

    // Custom blocked patterns
    for (const pattern of compiledBlocked) {
      if (pattern.test(command)) {
        return { behavior: 'deny', message: `Command matches blocked pattern: ${pattern.source}` };
      }
    }

    // Allowlist check (if configured, command must match at least one)
    if (compiledAllowed.length > 0) {
      const permitted = compiledAllowed.some((p) => p.test(command));
      if (!permitted) {
        return { behavior: 'deny', message: 'Command does not match any allowed pattern.' };
      }
    }

    return { behavior: 'allow' };
  };
}
