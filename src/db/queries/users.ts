import type { Database } from '../database.js';
import { persistDb } from '../database.js';
import type { EncryptedData } from '../../utils/crypto.js';
import { decrypt } from '../../utils/crypto.js';
import { config } from '../../config.js';

export interface UserApiKeyRow {
  encrypted_api_key: string;
  key_iv: string;
  key_auth_tag: string;
}

export interface UserOAuthTokenRow {
  encrypted_oauth_token: string;
  oauth_token_iv: string;
  oauth_token_auth_tag: string;
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

  saveOsUsername(slackUserId: string, osUsername: string): void {
    this.db.run(
      `INSERT INTO users (slack_user_id, os_username, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(slack_user_id) DO UPDATE SET
         os_username = excluded.os_username,
         updated_at = datetime('now')`,
      [slackUserId, osUsername],
    );
    persistDb(this.db);
  }

  getOsUsername(slackUserId: string): string | null {
    const result = this.db.exec(
      `SELECT os_username FROM users WHERE slack_user_id = ?`,
      [slackUserId],
    );
    if (!result.length || !result[0].values.length) return null;
    const val = result[0].values[0][0];
    return typeof val === 'string' ? val : null;
  }

  hasOsUsername(slackUserId: string): boolean {
    const result = this.db.exec(
      `SELECT 1 FROM users WHERE slack_user_id = ? AND os_username IS NOT NULL`,
      [slackUserId],
    );
    return result.length > 0 && result[0].values.length > 0;
  }

  saveConfigDir(slackUserId: string, configDir: string): void {
    this.db.run(
      `INSERT INTO users (slack_user_id, config_dir, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(slack_user_id) DO UPDATE SET
         config_dir = excluded.config_dir,
         updated_at = datetime('now')`,
      [slackUserId, configDir],
    );
    persistDb(this.db);
  }

  getConfigDir(slackUserId: string): string | null {
    const result = this.db.exec(
      `SELECT config_dir FROM users WHERE slack_user_id = ?`,
      [slackUserId],
    );
    if (!result.length || !result[0].values.length) return null;
    const val = result[0].values[0][0];
    return typeof val === 'string' ? val : null;
  }

  hasConfigDir(slackUserId: string): boolean {
    const result = this.db.exec(
      `SELECT 1 FROM users WHERE slack_user_id = ? AND config_dir IS NOT NULL`,
      [slackUserId],
    );
    return result.length > 0 && result[0].values.length > 0;
  }

  deleteConfigDir(slackUserId: string): void {
    this.db.run(
      `UPDATE users SET config_dir = NULL, updated_at = datetime('now') WHERE slack_user_id = ?`,
      [slackUserId],
    );
    persistDb(this.db);
  }

  saveOAuthToken(slackUserId: string, encryptedData: EncryptedData): void {
    this.db.run(
      `INSERT INTO users (slack_user_id, encrypted_oauth_token, oauth_token_iv, oauth_token_auth_tag, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(slack_user_id) DO UPDATE SET
         encrypted_oauth_token = excluded.encrypted_oauth_token,
         oauth_token_iv = excluded.oauth_token_iv,
         oauth_token_auth_tag = excluded.oauth_token_auth_tag,
         updated_at = datetime('now')`,
      [slackUserId, encryptedData.encrypted, encryptedData.iv, encryptedData.authTag],
    );
    persistDb(this.db);
  }

  getOAuthToken(slackUserId: string): UserOAuthTokenRow | null {
    const result = this.db.exec(
      `SELECT encrypted_oauth_token, oauth_token_iv, oauth_token_auth_tag FROM users WHERE slack_user_id = ?`,
      [slackUserId],
    );
    if (!result.length || !result[0].values.length) return null;
    const row = result[0].values[0];
    if (!row[0]) return null;
    return {
      encrypted_oauth_token: row[0] as string,
      oauth_token_iv: row[1] as string,
      oauth_token_auth_tag: row[2] as string,
    };
  }

  hasOAuthToken(slackUserId: string): boolean {
    const result = this.db.exec(
      `SELECT 1 FROM users WHERE slack_user_id = ? AND encrypted_oauth_token IS NOT NULL`,
      [slackUserId],
    );
    return result.length > 0 && result[0].values.length > 0;
  }

  deleteOAuthToken(slackUserId: string): void {
    this.db.run(
      `UPDATE users SET encrypted_oauth_token = NULL, oauth_token_iv = NULL, oauth_token_auth_tag = NULL, updated_at = datetime('now') WHERE slack_user_id = ?`,
      [slackUserId],
    );
    persistDb(this.db);
  }

  saveServerMapping(slackUserId: string, serverName: string, osUsername: string, encryptedData: EncryptedData): void {
    this.db.run(
      `INSERT INTO user_server_mappings (slack_user_id, server_name, os_username, encrypted_password, password_iv, password_auth_tag)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(slack_user_id, server_name) DO UPDATE SET
         os_username = excluded.os_username,
         encrypted_password = excluded.encrypted_password,
         password_iv = excluded.password_iv,
         password_auth_tag = excluded.password_auth_tag`,
      [slackUserId, serverName, osUsername, encryptedData.encrypted, encryptedData.iv, encryptedData.authTag],
    );
    persistDb(this.db);
  }

  getServerMapping(slackUserId: string, serverName: string): { osUsername: string; password: string } | null {
    const result = this.db.exec(
      `SELECT os_username, encrypted_password, password_iv, password_auth_tag FROM user_server_mappings WHERE slack_user_id = ? AND server_name = ?`,
      [slackUserId, serverName],
    );
    if (!result.length || !result[0].values.length) return null;
    const row = result[0].values[0];
    if (!row[1]) return null;
    const password = decrypt(
      { encrypted: row[1] as string, iv: row[2] as string, authTag: row[3] as string },
      config.ENCRYPTION_KEY,
    );
    return { osUsername: row[0] as string, password };
  }

  listServerMappings(slackUserId: string): Array<{ serverName: string; osUsername: string }> {
    const result = this.db.exec(
      `SELECT server_name, os_username FROM user_server_mappings WHERE slack_user_id = ? ORDER BY server_name`,
      [slackUserId],
    );
    if (!result.length || !result[0].values.length) return [];
    return result[0].values.map((row: unknown[]) => ({
      serverName: row[0] as string,
      osUsername: row[1] as string,
    }));
  }

  deleteServerMapping(slackUserId: string, serverName: string): boolean {
    this.db.run(
      `DELETE FROM user_server_mappings WHERE slack_user_id = ? AND server_name = ?`,
      [slackUserId, serverName],
    );
    persistDb(this.db);
    const result = this.db.exec(
      `SELECT 1 FROM user_server_mappings WHERE slack_user_id = ? AND server_name = ?`,
      [slackUserId, serverName],
    );
    return !(result.length > 0 && result[0].values.length > 0);
  }
}
