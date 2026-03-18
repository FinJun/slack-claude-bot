import type { Migration, Database } from '../database.js';

export const migration001: Migration = {
  version: 1,
  name: '001-initial',
  up(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        slack_thread_ts TEXT NOT NULL,
        slack_channel_id TEXT NOT NULL,
        slack_user_id TEXT NOT NULL,
        project_dir TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        total_cost_usd REAL DEFAULT 0,
        num_turns INTEGER DEFAULT 0,
        subprocess_pid INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        last_activity_at TEXT DEFAULT (datetime('now'))
      );
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_sessions_thread
        ON sessions (slack_channel_id, slack_thread_ts);
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_status
        ON sessions (slack_user_id, status);
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS thread_session_map (
        slack_channel_id TEXT NOT NULL,
        slack_thread_ts TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (slack_channel_id, slack_thread_ts)
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tool_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        input TEXT,
        decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny', 'ask')),
        reason TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_audit_session
        ON tool_audit_log (session_id, created_at DESC);
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_audit_denied
        ON tool_audit_log (decision, created_at DESC)
        WHERE decision = 'deny';
    `);
  },
};
