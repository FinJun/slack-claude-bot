import { describe, it, expect } from 'vitest';
import { createCanUseTool, defaultSandboxConfig } from '../../src/security/sandbox-config.js';
import { PERMISSIVE_POLICY } from '../../src/security/tool-policy.js';

const WORKSPACE = '/home/user/project';
const signal = new AbortController().signal;

describe('createCanUseTool', () => {
  describe('default sandbox', () => {
    const config = defaultSandboxConfig(WORKSPACE);
    const canUseTool = createCanUseTool(config);

    it('allows Read inside workspace', async () => {
      const result = await canUseTool('Read', { file_path: WORKSPACE + '/file.ts' }, { signal });
      expect(result.behavior).toBe('allow');
    });

    it('denies Bash (disabled by default policy)', async () => {
      const result = await canUseTool('Bash', { command: 'ls' }, { signal });
      expect(result.behavior).toBe('deny');
    });

    it('denies Write (disabled by default policy)', async () => {
      const result = await canUseTool('Write', { file_path: WORKSPACE + '/x.ts' }, { signal });
      expect(result.behavior).toBe('deny');
    });

    it('denies Read outside workspace', async () => {
      const result = await canUseTool('Read', { file_path: '/etc/passwd' }, { signal });
      expect(result.behavior).toBe('deny');
    });
  });

  describe('permissive policy with bash filter', () => {
    const canUseTool = createCanUseTool({
      toolPolicy: PERMISSIVE_POLICY,
      bashFilter: { blockSudo: true, blockSensitivePaths: true },
      pathValidator: {
        allowedReadPaths: [WORKSPACE],
        allowedWritePaths: [WORKSPACE],
      },
      cwd: WORKSPACE,
    });

    it('allows safe bash commands', async () => {
      const result = await canUseTool('Bash', { command: 'npm test' }, { signal });
      expect(result.behavior).toBe('allow');
    });

    it('denies sudo in bash', async () => {
      const result = await canUseTool('Bash', { command: 'sudo npm install' }, { signal });
      expect(result.behavior).toBe('deny');
      expect((result as any).message).toMatch(/sudo/);
    });

    it('denies bash accessing /etc/shadow', async () => {
      const result = await canUseTool('Bash', { command: 'cat /etc/shadow' }, { signal });
      expect(result.behavior).toBe('deny');
    });

    it('allows Write inside workspace', async () => {
      const result = await canUseTool('Write', { file_path: WORKSPACE + '/dist/out.js' }, { signal });
      expect(result.behavior).toBe('allow');
    });

    it('denies Write outside workspace', async () => {
      const result = await canUseTool('Write', { file_path: '/tmp/evil.sh' }, { signal });
      expect(result.behavior).toBe('deny');
    });
  });

  describe('cwd auto-inclusion in path validator', () => {
    it('includes cwd in allowed read paths', async () => {
      const canUseTool = createCanUseTool({
        toolPolicy: { allowBash: false, allowWrite: false, allowNetwork: false },
        pathValidator: {
          allowedReadPaths: [],
          allowedWritePaths: [],
        },
        cwd: WORKSPACE,
      });
      const result = await canUseTool('Read', { file_path: WORKSPACE + '/readme.md' }, { signal });
      expect(result.behavior).toBe('allow');
    });
  });
});
