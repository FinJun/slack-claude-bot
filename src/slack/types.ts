/**
 * Re-exports from sessions/ that the Slack layer uses.
 * Keeps the Slack modules from importing directly from sessions/.
 */

export type { SessionInfo } from '../sessions/session-types.js';
export type { CreateSessionParams } from '../sessions/session-manager.js';
export { SessionManager } from '../sessions/session-manager.js';
