import { describe, it, expect } from 'vitest';
import path from 'path';
import { createPathValidator } from '../../src/security/path-validator.js';

const WORKSPACE = '/home/user/project';
const OTHER = '/tmp/other';

const validator = createPathValidator({
  allowedReadPaths: [WORKSPACE],
  allowedWritePaths: [WORKSPACE + '/output'],
});

describe('createPathValidator', () => {
  describe('Read tool', () => {
    it('allows reading inside workspace', () => {
      const result = validator('Read', { file_path: WORKSPACE + '/src/main.ts' });
      expect(result.behavior).toBe('allow');
    });

    it('denies reading outside workspace', () => {
      const result = validator('Read', { file_path: '/etc/passwd' });
      expect(result.behavior).toBe('deny');
      expect((result as any).message).toMatch(/outside/);
    });

    it('denies path traversal attempts', () => {
      const result = validator('Read', { file_path: WORKSPACE + '/../../../etc/shadow' });
      expect(result.behavior).toBe('deny');
    });

    it('allows reading the workspace root itself', () => {
      const result = validator('Read', { file_path: WORKSPACE });
      expect(result.behavior).toBe('allow');
    });
  });

  describe('Write tool', () => {
    it('allows writing inside allowed write path', () => {
      const result = validator('Write', { file_path: WORKSPACE + '/output/file.txt' });
      expect(result.behavior).toBe('allow');
    });

    it('denies writing outside allowed write path', () => {
      const result = validator('Write', { file_path: WORKSPACE + '/src/main.ts' });
      expect(result.behavior).toBe('deny');
    });

    it('denies writing to /tmp', () => {
      const result = validator('Write', { file_path: '/tmp/evil.sh' });
      expect(result.behavior).toBe('deny');
    });
  });

  describe('Edit tool', () => {
    it('denies editing outside write path', () => {
      const result = validator('Edit', { file_path: '/etc/crontab' });
      expect(result.behavior).toBe('deny');
    });
  });

  describe('non-file tools', () => {
    it('allows non-file tools unconditionally', () => {
      const result = validator('Bash', { command: 'ls' });
      expect(result.behavior).toBe('allow');
    });

    it('allows WebFetch', () => {
      const result = validator('WebFetch', { url: 'https://example.com' });
      expect(result.behavior).toBe('allow');
    });
  });

  describe('blocked path patterns', () => {
    it('denies paths matching blocked pattern', () => {
      const v = createPathValidator({
        allowedReadPaths: [WORKSPACE],
        allowedWritePaths: [WORKSPACE],
        blockedPathPatterns: ['\\.env$'],
      });
      const result = v('Read', { file_path: WORKSPACE + '/.env' });
      expect(result.behavior).toBe('deny');
      expect((result as any).message).toMatch(/blocked pattern/);
    });
  });

  describe('missing path field', () => {
    it('allows when path field is missing (not a path-based tool)', () => {
      // Read with no file_path — skip validation
      const result = validator('Read', {});
      expect(result.behavior).toBe('allow');
    });
  });
});
