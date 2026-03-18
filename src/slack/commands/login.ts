/**
 * Login subcommand handler for /claude token and /claude logout.
 *
 * Users obtain a token by running `claude setup-token` on their own machine,
 * then register it via `/claude token <token>` in a DM.
 * DM only — never expose tokens in channels.
 */

import { encrypt } from '../../utils/crypto.js';
import { UserStore } from '../../db/queries/users.js';
import { getDatabase } from '../../db/database.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import type { SessionManager } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserStore(): UserStore {
  return new UserStore(getDatabase());
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Handle `/claude token <token>`.
 * Validates and stores the OAuth token encrypted in the database.
 * Must be called from a DM.
 */
export async function handleToken(
  slackUserId: string,
  token: string,
  isDM: boolean,
): Promise<string> {
  if (!isDM) {
    return '⚠️ Token registration is only allowed in DMs.';
  }

  if (!token) {
    return 'Usage: `/claude token <token>`';
  }

  if (!token.startsWith('sk-ant-')) {
    return '❌ Invalid token format. Claude OAuth tokens must start with `sk-ant-`.';
  }

  const encryptedData = encrypt(token, config.ENCRYPTION_KEY);
  getUserStore().saveOAuthToken(slackUserId, encryptedData);

  logger.info('OAuth token registered', { slackUserId });
  return '✅ Claude OAuth token registered. You can now start a session with `/claude start`.';
}

/**
 * Handle `/claude logout`.
 * Clears the stored OAuth token (and legacy config_dir) and stops active sessions.
 */
export async function handleLogout(
  slackUserId: string,
  sessionManager: SessionManager,
): Promise<string> {
  const store = getUserStore();
  const hasToken = store.hasOAuthToken(slackUserId);
  const hasConfigDir = !!store.getConfigDir(slackUserId);

  if (!hasToken && !hasConfigDir) {
    return '❌ No stored Claude credentials found.';
  }

  const activeSessions = sessionManager.listSessions(slackUserId);
  for (const session of activeSessions) {
    try {
      sessionManager.stopSession(session.sessionId);
    } catch {
      // best-effort
    }
  }

  if (hasToken) {
    store.deleteOAuthToken(slackUserId);
  }
  if (hasConfigDir) {
    store.deleteConfigDir(slackUserId);
  }

  return '🗑️ Logged out of Claude. Credentials have been deleted.';
}
