import type { Migration, Database } from '../database.js';

export const migration004: Migration = {
  version: 4,
  name: '004-users-config-dir',
  up(db: Database): void {
    db.run(`ALTER TABLE users ADD COLUMN config_dir TEXT;`);
  },
};
