import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Mock config before any imports that depend on it
vi.mock('../../src/config.js', () => ({
  config: {
    LOG_LEVEL: 'error',
    MAX_SESSIONS_PER_USER: 3,
    SESSION_IDLE_TIMEOUT_MS: 1800000,
    MAX_BUDGET_USD: 5.0,
    MAX_TURNS: 50,
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_SIGNING_SECRET: 'test-secret',
    SLACK_APP_TOKEN: 'xapp-test',
    ANTHROPIC_API_KEY: 'sk-test',
    ALLOWED_DIRECTORIES: [],
    SANDBOX_ENABLED: true,
  },
}));

// Mock fs to avoid touching the real filesystem
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync } from 'fs';
import { initDatabase, closeDatabase } from '../../src/db/database.js';
import { migration001 } from '../../src/db/migrations/001-initial.js';
import { migration007 } from '../../src/db/migrations/007-sessions-server.js';
import { SessionStore } from '../../src/db/queries/sessions.js';
import { logToolUse, getRecentDenials } from '../../src/db/queries/audit.js';

const mockedExistsSync = vi.mocked(existsSync);

describe('SQLite session store', () => {
  beforeEach(async () => {
    mockedExistsSync.mockReturnValue(false);
    await initDatabase([migration001, migration007]);
  });

  afterEach(() => {
    closeDatabase();
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  // --- SessionStore ---

  describe('SessionStore.create', () => {
    it('creates a session and returns it', () => {
      const store = new SessionStore();
      const session = store.create({
        id: 'sess-001',
        slack_thread_ts: '1700000000.000100',
        slack_channel_id: 'C123',
        slack_user_id: 'U456',
        project_dir: '/home/user/project',
      });

      expect(session.id).toBe('sess-001');
      expect(session.slack_user_id).toBe('U456');
      expect(session.status).toBe('active');
      expect(session.total_cost_usd).toBe(0);
      expect(session.num_turns).toBe(0);
      expect(session.subprocess_pid).toBeNull();
    });

    it('stores subprocess_pid when provided', () => {
      const store = new SessionStore();
      const session = store.create({
        id: 'sess-002',
        slack_thread_ts: '1700000001.000100',
        slack_channel_id: 'C123',
        slack_user_id: 'U456',
        project_dir: '/tmp',
        subprocess_pid: 12345,
      });
      expect(session.subprocess_pid).toBe(12345);
    });
  });

  describe('SessionStore.getById', () => {
    it('returns null for unknown id', () => {
      const store = new SessionStore();
      expect(store.getById('nonexistent')).toBeNull();
    });

    it('retrieves a created session', () => {
      const store = new SessionStore();
      store.create({
        id: 'sess-003',
        slack_thread_ts: '1700000002.000100',
        slack_channel_id: 'C123',
        slack_user_id: 'U789',
        project_dir: '/tmp',
      });
      const found = store.getById('sess-003');
      expect(found).not.toBeNull();
      expect(found!.slack_user_id).toBe('U789');
    });
  });

  describe('SessionStore.getByThread', () => {
    it('returns null for unknown thread', () => {
      const store = new SessionStore();
      expect(store.getByThread('C999', '9999999.999999')).toBeNull();
    });

    it('finds session by channel + thread_ts', () => {
      const store = new SessionStore();
      store.create({
        id: 'sess-004',
        slack_thread_ts: '1700000003.000100',
        slack_channel_id: 'C200',
        slack_user_id: 'U111',
        project_dir: '/tmp',
      });
      const found = store.getByThread('C200', '1700000003.000100');
      expect(found).not.toBeNull();
      expect(found!.id).toBe('sess-004');
    });
  });

  describe('SessionStore.update', () => {
    it('updates status', () => {
      const store = new SessionStore();
      store.create({
        id: 'sess-005',
        slack_thread_ts: '1700000004.000100',
        slack_channel_id: 'C123',
        slack_user_id: 'U222',
        project_dir: '/tmp',
      });
      const updated = store.update('sess-005', { status: 'completed' });
      expect(updated!.status).toBe('completed');
    });

    it('updates cost and turns', () => {
      const store = new SessionStore();
      store.create({
        id: 'sess-006',
        slack_thread_ts: '1700000005.000100',
        slack_channel_id: 'C123',
        slack_user_id: 'U333',
        project_dir: '/tmp',
      });
      const updated = store.update('sess-006', { total_cost_usd: 1.5, num_turns: 10 });
      expect(updated!.total_cost_usd).toBe(1.5);
      expect(updated!.num_turns).toBe(10);
    });

    it('returns session unchanged when no fields provided', () => {
      const store = new SessionStore();
      store.create({
        id: 'sess-007',
        slack_thread_ts: '1700000006.000100',
        slack_channel_id: 'C123',
        slack_user_id: 'U444',
        project_dir: '/tmp',
      });
      const updated = store.update('sess-007', {});
      expect(updated!.id).toBe('sess-007');
    });
  });

  describe('SessionStore.list', () => {
    it('returns all sessions when no filter', () => {
      const store = new SessionStore();
      store.create({ id: 'a1', slack_thread_ts: 't1', slack_channel_id: 'C1', slack_user_id: 'U1', project_dir: '/tmp' });
      store.create({ id: 'a2', slack_thread_ts: 't2', slack_channel_id: 'C1', slack_user_id: 'U1', project_dir: '/tmp' });
      const all = store.list();
      expect(all.length).toBe(2);
    });

    it('filters by status', () => {
      const store = new SessionStore();
      store.create({ id: 'b1', slack_thread_ts: 't3', slack_channel_id: 'C1', slack_user_id: 'U1', project_dir: '/tmp' });
      store.create({ id: 'b2', slack_thread_ts: 't4', slack_channel_id: 'C1', slack_user_id: 'U1', project_dir: '/tmp' });
      store.update('b2', { status: 'completed' });
      const active = store.list('active');
      expect(active.every((s) => s.status === 'active')).toBe(true);
      expect(active.some((s) => s.id === 'b2')).toBe(false);
    });
  });

  describe('SessionStore.delete', () => {
    it('removes a session', () => {
      const store = new SessionStore();
      store.create({ id: 'del-1', slack_thread_ts: 'tdel', slack_channel_id: 'C1', slack_user_id: 'U1', project_dir: '/tmp' });
      const deleted = store.delete('del-1');
      expect(deleted).toBe(true);
      expect(store.getById('del-1')).toBeNull();
    });
  });

  describe('SessionStore.listByUser', () => {
    it('returns sessions for a specific user', () => {
      const store = new SessionStore();
      store.create({ id: 'u1s1', slack_thread_ts: 'tu1', slack_channel_id: 'C1', slack_user_id: 'USER_A', project_dir: '/tmp' });
      store.create({ id: 'u2s1', slack_thread_ts: 'tu2', slack_channel_id: 'C1', slack_user_id: 'USER_B', project_dir: '/tmp' });
      const userASessions = store.listByUser('USER_A');
      expect(userASessions.length).toBe(1);
      expect(userASessions[0].id).toBe('u1s1');
    });
  });

  describe('SessionStore.getActiveCount', () => {
    it('counts only active sessions for user', () => {
      const store = new SessionStore();
      store.create({ id: 'ac1', slack_thread_ts: 'tac1', slack_channel_id: 'C1', slack_user_id: 'UCOUNT', project_dir: '/tmp' });
      store.create({ id: 'ac2', slack_thread_ts: 'tac2', slack_channel_id: 'C1', slack_user_id: 'UCOUNT', project_dir: '/tmp' });
      store.update('ac2', { status: 'completed' });
      expect(store.getActiveCount('UCOUNT')).toBe(1);
    });

    it('returns 0 when user has no sessions', () => {
      const store = new SessionStore();
      expect(store.getActiveCount('GHOST_USER')).toBe(0);
    });
  });

  describe('SessionStore.updateActivity', () => {
    it('updates last_activity_at without changing status', () => {
      const store = new SessionStore();
      store.create({ id: 'act1', slack_thread_ts: 'tact', slack_channel_id: 'C1', slack_user_id: 'U1', project_dir: '/tmp' });
      store.updateActivity('act1');
      const after = store.getById('act1')!;
      expect(after.status).toBe('active');
      expect(after.last_activity_at).toBeDefined();
    });
  });

  describe('SessionStore.updateCost', () => {
    it('sets cost to provided value', () => {
      const store = new SessionStore();
      store.create({ id: 'cost1', slack_thread_ts: 'tcost', slack_channel_id: 'C1', slack_user_id: 'U1', project_dir: '/tmp' });
      store.updateCost('cost1', 2.75);
      expect(store.getById('cost1')!.total_cost_usd).toBe(2.75);
    });
  });

  // --- Audit log ---

  describe('logToolUse + getRecentDenials', () => {
    it('batches and flushes tool use logs', async () => {
      const store = new SessionStore();
      store.create({ id: 'aud1', slack_thread_ts: 'taud', slack_channel_id: 'C1', slack_user_id: 'U1', project_dir: '/tmp' });

      logToolUse({ sessionId: 'aud1', toolName: 'Bash', input: { command: 'rm -rf /' }, decision: 'deny', reason: 'not allowed' });
      logToolUse({ sessionId: 'aud1', toolName: 'Read', input: { path: '/etc/passwd' }, decision: 'allow' });

      // Wait for setImmediate to flush
      await new Promise<void>((resolve) => setImmediate(resolve));

      const denials = getRecentDenials(10);
      expect(denials.length).toBe(1);
      expect(denials[0].tool_name).toBe('Bash');
      expect(denials[0].decision).toBe('deny');
      expect(denials[0].reason).toBe('not allowed');
    });

    it('returns empty array when no denials', () => {
      const denials = getRecentDenials(10);
      expect(denials).toEqual([]);
    });

    it('respects the limit parameter', async () => {
      const store = new SessionStore();
      store.create({ id: 'aud2', slack_thread_ts: 'taud2', slack_channel_id: 'C1', slack_user_id: 'U1', project_dir: '/tmp' });

      for (let i = 0; i < 5; i++) {
        logToolUse({ sessionId: 'aud2', toolName: `Tool${i}`, decision: 'deny', reason: `reason${i}` });
      }
      await new Promise<void>((resolve) => setImmediate(resolve));

      const limited = getRecentDenials(3);
      expect(limited.length).toBe(3);
    });
  });

  // --- Database migration idempotency ---

  describe('migration idempotency', () => {
    it('running migration on existing schema does not throw', async () => {
      // Close and reinit with same migrations - should be idempotent due to IF NOT EXISTS
      closeDatabase();
      await expect(initDatabase([migration001])).resolves.not.toThrow();
    });
  });
});
