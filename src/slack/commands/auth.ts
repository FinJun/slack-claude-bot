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
import { getServerRegistry } from '../../servers/server-registry.js';
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
    return '⚠️ API key registration is only allowed in DMs.';
  }

  if (!apiKey) {
    return 'Usage: `/claude auth <api-key>`';
  }

  if (!apiKey.startsWith('sk-ant-')) {
    return '❌ Invalid API key format. Anthropic API keys must start with `sk-ant-`.';
  }

  const encryptedData = encrypt(apiKey, config.ENCRYPTION_KEY);
  const hint = keyHint(apiKey);

  getUserStore().saveApiKey(slackUserId, encryptedData, hint);

  return `✅ API key registered (hint: ${hint})`;
}

/**
 * Handle `/claude whoami`.
 */
export async function handleWhoami(slackUserId: string): Promise<string> {
  const store = getUserStore();

  const hasApiKey = store.hasApiKey(slackUserId);
  const hasOAuthToken = store.hasOAuthToken(slackUserId);
  const osUsername = store.getOsUsername(slackUserId);
  const configDir = store.getConfigDir(slackUserId);

  if (!hasApiKey && !hasOAuthToken && !osUsername && !configDir) {
    return '❌ Not authenticated. Use `/claude token <token>`, `/claude register <os-username>`, or `/claude auth <api-key>`';
  }

  const lines: string[] = [];

  if (hasOAuthToken) {
    lines.push(`✅ Claude OAuth token registered (\`/claude token\`) — uses Claude subscription`);
  }

  if (hasApiKey) {
    const db = getDatabase();
    const result = db.exec(
      `SELECT key_hint, registered_at FROM users WHERE slack_user_id = ?`,
      [slackUserId],
    );
    if (result.length && result[0].values.length) {
      const [hint, registeredAt] = result[0].values[0] as [string, string];
      const date = registeredAt.slice(0, 10);
      lines.push(`✅ Authenticated with API key (sk-ant-${hint}) | registered: ${date}`);
    }
  }

  if (configDir) {
    lines.push(`✅ Claude account login (legacy) — uses Claude subscription`);
  }

  if (osUsername) {
    lines.push(`✅ Linked to OS account (\`${osUsername}\`) — uses Claude subscription`);
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
    return '⚠️ OS account registration is only allowed in DMs.';
  }

  if (!osUsername) {
    return 'Usage: `/claude register <os-username>`';
  }

  // Validate: only alphanumeric + underscore, no path traversal
  if (!/^[a-zA-Z0-9_]+$/.test(osUsername)) {
    return '❌ OS username may only contain letters, digits, and underscores (_).';
  }

  const homeDir = `/home/${osUsername}`;
  const claudeDir = `${homeDir}/.claude`;

  // Check home directory exists
  if (!existsSync(homeDir)) {
    return `❌ Home directory does not exist: \`${homeDir}\``;
  }

  // Check .claude directory exists (user has run claude login)
  if (!existsSync(claudeDir)) {
    return `❌ \`${claudeDir}\` directory not found. Please run \`claude login\` on the server first.`;
  }

  // Check .claude directory is readable by the bot process
  try {
    accessSync(claudeDir, constants.R_OK);
  } catch {
    return `❌ No read access to \`${claudeDir}\`.`;
  }

  getUserStore().saveOsUsername(slackUserId, osUsername);

  return `✅ Registered with OS account \`${osUsername}\`. Claude login session will be used.`;
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
    return '❌ No API key registered.';
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

  return '🗑️ API key deleted.';
}

/**
 * Handle `/claude register <server> <username> <password>`.
 * Must be called from a DM (security — password in message).
 */
export async function handleServerRegister(
  slackUserId: string,
  serverName: string,
  username: string,
  password: string,
  isDM: boolean,
): Promise<string> {
  if (!isDM) {
    return '⚠️ Server registration is only allowed in DMs.';
  }

  const registry = getServerRegistry();
  if (!registry.resolve(serverName)) {
    const available = registry.list().map((s) => `\`${s.name}\``).join(', ');
    return available
      ? `❌ Unknown server \`${serverName}\`. Available servers: ${available}`
      : `❌ Unknown server \`${serverName}\`. No servers are configured.`;
  }

  const encryptedData = encrypt(password, config.ENCRYPTION_KEY);
  getUserStore().saveServerMapping(slackUserId, serverName, username, encryptedData);

  return `✅ Registered for server \`${serverName}\` as \`${username}\`.`;
}

/**
 * Handle `/claude servers`.
 * Lists all configured servers and the user's registration status for each.
 */
export async function handleServerList(slackUserId: string): Promise<string> {
  const registry = getServerRegistry();
  const servers = registry.list();

  if (servers.length === 0) {
    return 'No servers are configured.';
  }

  const mappings = getUserStore().listServerMappings(slackUserId);
  const registeredMap = new Map(mappings.map((m) => [m.serverName, m.osUsername]));

  const lines = ['*Available servers:*'];
  for (const server of servers) {
    const isLocal = registry.isLocal(server.name);
    const location = isLocal ? 'local' : `${server.host}:${server.port}`;
    const osUsername = registeredMap.get(server.name);
    const status = osUsername
      ? `✅ registered as ${osUsername}`
      : '❌ not registered';
    lines.push(`• \`${server.name}\` (${location}) — ${status}`);
  }

  return lines.join('\n');
}

/**
 * Handle `/claude addserver <name> <host> [port]`.
 * Adds a new server to the registry and persists to .env.
 */
export async function handleAddServer(
  serverName: string,
  host: string,
  port: string,
): Promise<string> {
  if (!serverName || !host) {
    return 'Usage: `/claude addserver <name> <host> [port]`';
  }

  const registry = getServerRegistry();
  if (registry.resolve(serverName)) {
    return `❌ Server \`${serverName}\` already exists.`;
  }

  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    return `❌ Invalid port: \`${port}\`. Must be a number between 1 and 65535.`;
  }

  registry.addServer(serverName, host, portNum);
  return `✅ Server \`${serverName}\` added (${host}:${portNum}).`;
}

/**
 * Handle `/claude removeserver <name>`.
 * Removes a server from the registry and persists to .env.
 */
export async function handleRemoveServer(serverName: string): Promise<string> {
  if (!serverName) {
    return 'Usage: `/claude removeserver <name>`';
  }

  const localHostname = (await import('os')).hostname();
  const protected_ = new Set(['super', 'local', localHostname]);
  if (protected_.has(serverName)) {
    return `❌ Cannot remove protected server \`${serverName}\`.`;
  }

  const registry = getServerRegistry();
  const removed = registry.removeServer(serverName);
  if (!removed) {
    const available = registry.list().map((s) => `\`${s.name}\``).join(', ');
    return available
      ? `❌ Unknown server \`${serverName}\`. Available servers: ${available}`
      : `❌ Unknown server \`${serverName}\`. No servers are configured.`;
  }

  return `✅ Server \`${serverName}\` removed.`;
}

/**
 * Handle `/claude unregister <server>`.
 * Removes the user's server mapping.
 */
export async function handleServerUnregister(
  slackUserId: string,
  serverName: string,
): Promise<string> {
  if (!serverName) {
    return 'Usage: `/claude unregister <server>`';
  }

  const deleted = getUserStore().deleteServerMapping(slackUserId, serverName);
  if (!deleted) {
    return `❌ Could not unregister from server \`${serverName}\`.`;
  }

  return `✅ Unregistered from server \`${serverName}\`.`;
}
