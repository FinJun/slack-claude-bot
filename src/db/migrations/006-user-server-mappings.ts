import type { Migration, Database } from '../database.js';

export const migration006: Migration = {
  version: 6,
  name: '006-user-server-mappings',
  up(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS user_server_mappings (
        slack_user_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        os_username TEXT NOT NULL,
        encrypted_password TEXT,
        password_iv TEXT,
        password_auth_tag TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (slack_user_id, server_name)
      )
    `);
  },
};
