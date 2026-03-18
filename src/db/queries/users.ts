import type { Database } from '../database.js';
import { persistDb } from '../database.js';
import type { EncryptedData } from '../../utils/crypto.js';

export interface UserApiKeyRow {
  encrypted_api_key: string;
  key_iv: string;
  key_auth_tag: string;
}

export class UserStore {
  constructor(private db: Database) {}

  saveApiKey(slackUserId: string, encryptedData: EncryptedData, hint: string): void {
    this.db.run(
      `INSERT INTO users (slack_user_id, encrypted_api_key, key_iv, key_auth_tag, key_hint, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(slack_user_id) DO UPDATE SET
         encrypted_api_key = excluded.encrypted_api_key,
         key_iv = excluded.key_iv,
         key_auth_tag = excluded.key_auth_tag,
         key_hint = excluded.key_hint,
         updated_at = datetime('now')`,
      [slackUserId, encryptedData.encrypted, encryptedData.iv, encryptedData.authTag, hint],
    );
    persistDb(this.db);
  }

  getApiKey(slackUserId: string): UserApiKeyRow | null {
    const result = this.db.exec(
      `SELECT encrypted_api_key, key_iv, key_auth_tag FROM users WHERE slack_user_id = ?`,
      [slackUserId],
    );
    if (!result.length || !result[0].values.length) return null;
    const row = result[0].values[0];
    return {
      encrypted_api_key: row[0] as string,
      key_iv: row[1] as string,
      key_auth_tag: row[2] as string,
    };
  }

  deleteApiKey(slackUserId: string): boolean {
    this.db.run(`DELETE FROM users WHERE slack_user_id = ?`, [slackUserId]);
    persistDb(this.db);
    return this.getApiKey(slackUserId) === null;
  }

  hasApiKey(slackUserId: string): boolean {
    const result = this.db.exec(
      `SELECT 1 FROM users WHERE slack_user_id = ? AND encrypted_api_key IS NOT NULL`,
      [slackUserId],
    );
    return result.length > 0 && result[0].values.length > 0;
  }
}
