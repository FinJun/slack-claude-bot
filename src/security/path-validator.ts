/**
 * Path validator - ensures file tool operations stay within allowed directories.
 *
 * Applied to Read, Write, Edit, and similar tools that accept file paths.
 */

import path from 'path';

export interface PathValidatorConfig {
  /** Directories Claude is allowed to read from */
  allowedReadPaths: string[];
  /** Directories Claude is allowed to write to */
  allowedWritePaths: string[];
  /** Path patterns that are always denied (regex strings) */
  blockedPathPatterns?: string[];
}

export type PathValidationResult =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message: string };

/** Tools that perform read operations and the input field containing the path */
const READ_TOOLS: Record<string, string[]> = {
  Read: ['file_path'],
  Glob: ['path'],
  Grep: ['path'],
  LS: ['path'],
  NotebookRead: ['notebook_path'],
};

/** Tools that perform write operations */
const WRITE_TOOLS: Record<string, string[]> = {
  Write: ['file_path'],
  Edit: ['file_path'],
  MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'],
};

function normalizePath(p: string): string {
  return path.resolve(p);
}

function isWithinDirectory(filePath: string, dir: string): boolean {
  const normalized = normalizePath(filePath);
  const normalizedDir = normalizePath(dir);
  // Must be exactly the dir or a child of it
  return normalized === normalizedDir || normalized.startsWith(normalizedDir + path.sep);
}

function isPathAllowed(filePath: string, allowedDirs: string[]): boolean {
  return allowedDirs.some((dir) => isWithinDirectory(filePath, dir));
}

export function createPathValidator(config: PathValidatorConfig) {
  const compiledBlocked = (config.blockedPathPatterns ?? []).map((p) => new RegExp(p));

  return function validatePath(
    toolName: string,
    input: Record<string, unknown>,
  ): PathValidationResult {
    const readFields = READ_TOOLS[toolName];
    const writeFields = WRITE_TOOLS[toolName];

    if (!readFields && !writeFields) {
      // Not a file tool — not our concern
      return { behavior: 'allow' };
    }

    const fields = writeFields ?? readFields;
    const isWrite = !!writeFields;

    for (const field of fields) {
      const rawPath = input[field];
      if (typeof rawPath !== 'string') continue;

      // Blocked patterns check
      for (const pattern of compiledBlocked) {
        if (pattern.test(rawPath)) {
          return { behavior: 'deny', message: `Path matches blocked pattern: ${pattern.source}` };
        }
      }

      const allowedDirs = isWrite ? config.allowedWritePaths : config.allowedReadPaths;

      if (!isPathAllowed(rawPath, allowedDirs)) {
        const opType = isWrite ? 'write' : 'read';
        return {
          behavior: 'deny',
          message: `Path '${rawPath}' is outside the allowed ${opType} directories.`,
        };
      }
    }

    return { behavior: 'allow' };
  };
}
