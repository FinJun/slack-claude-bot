/**
 * Auth subcommand handlers for /claude auth, whoami, revoke.
 *
 * All responses are ephemeral. API key registration is restricted to DMs only.
 */

import { encrypt } from '../../utils/crypto.js';
import { UserStore } from '../../db/queries/users.js';
import { getDatabase } from '../../db/database.js';
import { config } from '../../config.js';
import type { SessionManager } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserStore(): UserStore {
  return new UserStore(getDatabase());
}

function keyHint(apiKey: string): string {
  return `...${apiKey.slice(-4)}`;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Handle `/claude auth <api-key>`.
 * Must be called from a DM (channel_type === 'im').
 */
export async function handleAuth(
  slackUserId: string,
  apiKey: string,
  isDM: boolean,
): Promise<string> {
  if (!isDM) {
    return '⚠️ API 키는 DM에서만 등록할 수 있습니다.';
  }

  if (!apiKey) {
    return '사용법: `/claude auth <api-key>`';
  }

  if (!apiKey.startsWith('sk-ant-')) {
    return '❌ 올바르지 않은 API 키 형식입니다. Anthropic API 키는 `sk-ant-` 로 시작해야 합니다.';
  }

  const encryptedData = encrypt(apiKey, config.ENCRYPTION_KEY);
  const hint = keyHint(apiKey);

  getUserStore().saveApiKey(slackUserId, encryptedData, hint);

  return `✅ API 키가 등록되었습니다 (hint: ${hint})`;
}

/**
 * Handle `/claude whoami`.
 */
export async function handleWhoami(slackUserId: string): Promise<string> {
  const store = getUserStore();

  if (!store.hasApiKey(slackUserId)) {
    return '❌ 미인증. `/claude auth <api-key>` 로 등록하세요 (DM에서)';
  }

  // Fetch hint and registered_at from DB
  const db = getDatabase();
  const result = db.exec(
    `SELECT key_hint, registered_at FROM users WHERE slack_user_id = ?`,
    [slackUserId],
  );

  if (!result.length || !result[0].values.length) {
    return '❌ 미인증. `/claude auth <api-key>` 로 등록하세요 (DM에서)';
  }

  const [hint, registeredAt] = result[0].values[0] as [string, string];
  const date = registeredAt.slice(0, 10); // YYYY-MM-DD

  return `✅ 인증됨 (sk-ant-${hint}) | 등록일: ${date}`;
}

/**
 * Handle `/claude revoke`.
 * Deletes the stored API key and stops all active sessions for the user.
 */
export async function handleRevoke(
  slackUserId: string,
  sessionManager: SessionManager,
): Promise<string> {
  const store = getUserStore();

  if (!store.hasApiKey(slackUserId)) {
    return '❌ 등록된 API 키가 없습니다.';
  }

  // Stop all active sessions for this user
  const activeSessions = sessionManager.listSessions(slackUserId);
  for (const session of activeSessions) {
    try {
      sessionManager.stopSession(session.sessionId);
    } catch {
      // Best-effort: ignore errors stopping individual sessions
    }
  }

  store.deleteApiKey(slackUserId);

  return '🗑️ API 키가 삭제되었습니다.';
}
