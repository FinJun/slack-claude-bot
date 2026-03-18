/**
 * Login subcommand handler for /claude login and /claude logout.
 *
 * Spawns `claude auth login` with a per-user CLAUDE_CONFIG_DIR, captures the
 * OAuth URL from stdout, and sends it to the user via DM.
 * DM only — never expose auth URLs in channels.
 */

import { spawn } from 'child_process';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { resolve } from 'path';
import { UserStore } from '../../db/queries/users.js';
import { getDatabase } from '../../db/database.js';
import { logger } from '../../utils/logger.js';
import type { SessionManager } from '../types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIG_BASE_DIR = resolve(process.cwd(), 'data/claude-configs');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Pattern to extract the OAuth URL from claude auth login output
const URL_PATTERN = /https:\/\/claude\.ai\/oauth\/authorize\S+/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserStore(): UserStore {
  return new UserStore(getDatabase());
}

function configDirForUser(slackUserId: string): string {
  return resolve(CONFIG_BASE_DIR, slackUserId);
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Handle `/claude login`.
 * Must be called from a DM (isDM === true).
 *
 * Spawns `claude auth login` with CLAUDE_CONFIG_DIR set to a per-user path,
 * extracts the OAuth URL, sends it to the user, then waits for completion.
 */
export async function handleLogin(
  slackUserId: string,
  isDM: boolean,
  sendDM: (text: string) => Promise<void>,
): Promise<string> {
  if (!isDM) {
    return '⚠️ 로그인은 DM에서만 할 수 있습니다.';
  }

  const configDir = configDirForUser(slackUserId);

  // Ensure the config directory exists
  mkdirSync(configDir, { recursive: true });

  return new Promise<string>((resolve) => {
    let urlSent = false;
    let settled = false;
    let output = '';

    const child = spawn('claude', ['auth', 'login'], {
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const settle = (msg: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(msg);
    };

    // 5-minute hard timeout
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle('⏱️ 로그인 시간이 초과되었습니다 (5분). 다시 `/claude login`을 시도해 주세요.');
    }, LOGIN_TIMEOUT_MS);

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      output += text;

      if (!urlSent) {
        const match = URL_PATTERN.exec(output);
        if (match) {
          urlSent = true;
          const url = match[0];
          logger.info('Captured claude auth login URL', { slackUserId });
          // Send URL to user asynchronously — do not block
          sendDM(
            `🔗 아래 링크를 브라우저에서 열어 Claude 계정으로 로그인하세요:\n${url}`,
          ).catch((err) => {
            logger.warn('Failed to send login URL via DM', { slackUserId, err });
          });
        }
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (err) => {
      logger.error('claude auth login process error', { slackUserId, err });
      settle(`❌ 로그인 프로세스 오류: ${err.message}`);
    });

    child.on('close', (code) => {
      if (code === 0) {
        // Save config dir to DB
        try {
          getUserStore().saveConfigDir(slackUserId, configDir);
          logger.info('Saved config_dir for user', { slackUserId, configDir });
        } catch (err) {
          logger.warn('Failed to save config_dir to DB', { slackUserId, err });
        }
        settle('✅ Claude 로그인 완료! 이제 `/claude start`로 세션을 시작할 수 있습니다.');
      } else {
        // Clean up on failure
        try {
          if (existsSync(configDir)) {
            rmSync(configDir, { recursive: true, force: true });
          }
        } catch {
          // best-effort cleanup
        }
        settle(`❌ 로그인 실패 (exit code ${code ?? 'unknown'}). 다시 시도해 주세요.`);
      }
    });
  });
}

/**
 * Handle `/claude logout`.
 * Deletes the stored config dir and stops all active sessions for the user.
 */
export async function handleLogout(
  slackUserId: string,
  sessionManager: SessionManager,
): Promise<string> {
  const store = getUserStore();

  const configDir = store.getConfigDir(slackUserId);

  if (!configDir) {
    return '❌ 로그인된 Claude 계정이 없습니다.';
  }

  // Stop all active sessions for this user
  const activeSessions = sessionManager.listSessions(slackUserId);
  for (const session of activeSessions) {
    try {
      sessionManager.stopSession(session.sessionId);
    } catch {
      // best-effort
    }
  }

  // Remove config dir from filesystem
  try {
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true, force: true });
    }
  } catch (err) {
    logger.warn('Failed to remove config dir during logout', { slackUserId, configDir, err });
  }

  // Remove from DB
  store.deleteConfigDir(slackUserId);

  return '🗑️ Claude 로그아웃 완료. 인증 정보가 삭제되었습니다.';
}
