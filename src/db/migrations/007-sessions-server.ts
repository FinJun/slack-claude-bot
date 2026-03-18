import type { Migration, Database } from '../database.js';

export const migration007: Migration = {
  version: 7,
  name: '007-sessions-server',
  up(db: Database): void {
    db.exec(`ALTER TABLE sessions ADD COLUMN server_name TEXT DEFAULT 'local'`);
  },
};
