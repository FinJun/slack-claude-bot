/**
 * Auth subcommand handlers for /claude auth, whoami, revoke, register.
 *
 * All responses are ephemeral. API key and OS user registration is restricted to DMs only.
 */

import { existsSync, accessSync, constants } from 'fs';
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

  const hasApiKey = store.hasApiKey(slackUserId);
  const osUsername = store.getOsUsername(slackUserId);
  const configDir = store.getConfigDir(slackUserId);

  if (!hasApiKey && !osUsername && !configDir) {
    return '❌ 미인증. `/claude login`, `/claude register <os-username>` 또는 `/claude auth <api-key>`';
  }

  const lines: string[] = [];

  if (hasApiKey) {
    const db = getDatabase();
    const result = db.exec(
      `SELECT key_hint, registered_at FROM users WHERE slack_user_id = ?`,
      [slackUserId],
    );
    if (result.length && result[0].values.length) {
      const [hint, registeredAt] = result[0].values[0] as [string, string];
      const date = registeredAt.slice(0, 10);
      lines.push(`✅ API key 인증 (sk-ant-${hint}) | 등록일: ${date}`);
    }
  }

  if (configDir) {
    lines.push(`✅ Claude 계정 로그인 완료 (\`/claude login\`) — Claude 구독 사용`);
  }

  if (osUsername) {
    lines.push(`✅ OS 계정 연동 (\`${osUsername}\`) — Claude 구독 사용`);
  }

  return lines.join('\n');
}

/**
 * Handle `/claude register <os-username>`.
 * Must be called from a DM (channel_type === 'im').
 */
export async function handleRegister(
  slackUserId: string,
  osUsername: string,
  isDM: boolean,
): Promise<string> {
  if (!isDM) {
    return '⚠️ OS 계정 등록은 DM에서만 할 수 있습니다.';
  }

  if (!osUsername) {
    return '사용법: `/claude register <os-username>`';
  }

  // Validate: only alphanumeric + underscore, no path traversal
  if (!/^[a-zA-Z0-9_]+$/.test(osUsername)) {
    return '❌ OS 사용자명은 영문자, 숫자, 밑줄(_)만 사용할 수 있습니다.';
  }

  const homeDir = `/home/${osUsername}`;
  const claudeDir = `${homeDir}/.claude`;

  // Check home directory exists
  if (!existsSync(homeDir)) {
    return `❌ 홈 디렉터리가 존재하지 않습니다: \`${homeDir}\``;
  }

  // Check .claude directory exists (user has run claude login)
  if (!existsSync(claudeDir)) {
    return `❌ \`${claudeDir}\` 디렉터리가 없습니다. 서버에서 \`claude login\`을 먼저 실행하세요.`;
  }

  // Check .claude directory is readable by the bot process
  try {
    accessSync(claudeDir, constants.R_OK);
  } catch {
    return `❌ \`${claudeDir}\` 디렉터리에 접근 권한이 없습니다.`;
  }

  getUserStore().saveOsUsername(slackUserId, osUsername);

  return `✅ OS 계정 \`${osUsername}\`으로 등록되었습니다. Claude 로그인 세션이 사용됩니다.`;
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
