import type { Migration, Database } from '../database.js';

export const migration003: Migration = {
  version: 3,
  name: '003-users-os-username',
  up(db: Database): void {
    db.run(`ALTER TABLE users ADD COLUMN os_username TEXT;`);
  },
};
