/**
 * Login subcommand handler for /claude login and /claude logout.
 *
 * Spawns `claude auth login` with a per-user CLAUDE_CONFIG_DIR, captures the
 * OAuth URL from stdout, and sends it to the user via DM.
 * DM only — never expose auth URLs in channels.
 */

import { spawn, execSync } from 'child_process';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { resolve } from 'path';
import { UserStore } from '../../db/queries/users.js';
import { getDatabase } from '../../db/database.js';
import { logger } from '../../utils/logger.js';
import type { SessionManager } from '../types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIG_BASE_DIR = resolve(process.cwd(), 'data/claude-configs');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Broad URL pattern — capture any https URL in the output
const URL_PATTERN = /https:\/\/\S+/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserStore(): UserStore {
  return new UserStore(getDatabase());
}

function configDirForUser(slackUserId: string): string {
  return resolve(CONFIG_BASE_DIR, slackUserId);
}

function findClaude(): string {
  try {
    return execSync('which claude', { encoding: 'utf-8' }).trim();
  } catch {
    return 'claude'; // fallback, let spawn handle the error
  }
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
  const claudePath = findClaude();

  logger.info('Starting claude login', { slackUserId, claudePath, configDir });

  // Ensure the config directory exists
  mkdirSync(configDir, { recursive: true });

  return new Promise<string>((resolvePromise) => {
    let urlSent = false;
    let settled = false;
    let output = '';

    const child = spawn(claudePath, ['auth', 'login'], {
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const settle = (msg: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(msg);
    };

    // 5-minute hard timeout
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      logger.warn('Login timed out', { slackUserId, output });
      settle('⏱️ 로그인 시간이 초과되었습니다 (5분). 다시 `/claude login`을 시도해 주세요.');
    }, LOGIN_TIMEOUT_MS);

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      output += text;
      logger.debug('claude auth login output', { slackUserId, text: text.trim() });

      if (!urlSent) {
        const match = URL_PATTERN.exec(output);
        if (match) {
          urlSent = true;
          const url = match[0];
          logger.info('Captured login URL', { slackUserId, url: url.substring(0, 50) + '...' });
          sendDM(
            `🔗 아래 링크를 브라우저에서 열어 Claude 계정으로 로그인하세요:\n${url}`,
          ).then(() => {
            logger.info('Login URL sent via DM', { slackUserId });
          }).catch((err) => {
            logger.error('Failed to send login URL via DM', { slackUserId, err: String(err) });
          });
        }
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (err) => {
      logger.error('claude auth login spawn error', { slackUserId, err: String(err) });
      settle(`❌ claude 명령을 실행할 수 없습니다: ${err.message}\nclaude CLI가 설치되어 있는지 확인하세요.`);
    });

    child.on('close', (code) => {
      logger.info('claude auth login exited', { slackUserId, code, output: output.substring(0, 200) });

      if (code === 0) {
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
        const detail = output ? `\n출력: ${output.substring(0, 200)}` : '';
        settle(`❌ 로그인 실패 (exit code ${code ?? 'unknown'}).${detail}\n다시 시도해 주세요.`);
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
