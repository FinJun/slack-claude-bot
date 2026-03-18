import { describe, it, expect } from 'vitest';
import {
  createToolPolicyChecker,
  DEFAULT_POLICY,
  PERMISSIVE_POLICY,
  READONLY_POLICY,
} from '../../src/security/tool-policy.js';

describe('createToolPolicyChecker', () => {
  describe('DEFAULT_POLICY', () => {
    const check = createToolPolicyChecker(DEFAULT_POLICY);

    it('allows read tools', () => {
      expect(check('Read', {}).behavior).toBe('allow');
      expect(check('Grep', {}).behavior).toBe('allow');
      expect(check('Glob', {}).behavior).toBe('allow');
    });

    it('denies Bash tool', () => {
      const result = check('Bash', { command: 'ls' });
      expect(result.behavior).toBe('deny');
      expect((result as any).message).toMatch(/[Bb]ash/);
    });

    it('denies write tools', () => {
      expect(check('Write', {}).behavior).toBe('deny');
      expect(check('Edit', {}).behavior).toBe('deny');
      expect(check('MultiEdit', {}).behavior).toBe('deny');
    });

    it('allows network tools', () => {
      expect(check('WebFetch', {}).behavior).toBe('allow');
      expect(check('WebSearch', {}).behavior).toBe('allow');
    });

    it('allows unknown tools by default', () => {
      expect(check('SomeCustomTool', {}).behavior).toBe('allow');
    });
  });

  describe('PERMISSIVE_POLICY', () => {
    const check = createToolPolicyChecker(PERMISSIVE_POLICY);

    it('allows Bash', () => {
      expect(check('Bash', { command: 'ls' }).behavior).toBe('allow');
    });

    it('allows write tools', () => {
      expect(check('Write', {}).behavior).toBe('allow');
      expect(check('Edit', {}).behavior).toBe('allow');
    });
  });

  describe('READONLY_POLICY', () => {
    const check = createToolPolicyChecker(READONLY_POLICY);

    it('denies Bash', () => {
      expect(check('Bash', {}).behavior).toBe('deny');
    });

    it('denies write tools', () => {
      expect(check('Write', {}).behavior).toBe('deny');
    });

    it('denies network tools', () => {
      expect(check('WebFetch', {}).behavior).toBe('deny');
      expect(check('WebSearch', {}).behavior).toBe('deny');
    });

    it('allows read tools', () => {
      expect(check('Read', {}).behavior).toBe('allow');
    });
  });

  describe('explicit allow/deny lists', () => {
    it('allowedTools takes priority over policy', () => {
      const check = createToolPolicyChecker({
        ...DEFAULT_POLICY,
        allowedTools: ['Bash'],
      });
      expect(check('Bash', { command: 'ls' }).behavior).toBe('allow');
    });

    it('deniedTools blocks normally-allowed tools', () => {
      const check = createToolPolicyChecker({
        ...PERMISSIVE_POLICY,
        deniedTools: ['WebFetch'],
      });
      const result = check('WebFetch', {});
      expect(result.behavior).toBe('deny');
      expect((result as any).message).toMatch(/WebFetch/);
    });
  });
});
