import type { Migration, Database } from '../database.js';

export const migration002: Migration = {
  version: 2,
  name: '002-users',
  up(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        slack_user_id TEXT PRIMARY KEY,
        encrypted_api_key TEXT,
        key_iv TEXT,
        key_auth_tag TEXT,
        key_hint TEXT,
        registered_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  },
};
