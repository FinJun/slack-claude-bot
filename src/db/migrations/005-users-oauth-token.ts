import type { Migration, Database } from '../database.js';

export const migration005: Migration = {
  version: 5,
  name: '005-users-oauth-token',
  up(db: Database): void {
    db.run(`ALTER TABLE users ADD COLUMN encrypted_oauth_token TEXT;`);
    db.run(`ALTER TABLE users ADD COLUMN oauth_token_iv TEXT;`);
    db.run(`ALTER TABLE users ADD COLUMN oauth_token_auth_tag TEXT;`);
  },
};
