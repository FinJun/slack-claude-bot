/**
 * Orphan subprocess cleanup — periodically checks for stale sessions
 * in the DB that have no live in-memory counterpart and marks them
 * as timed out.
 */

import { SessionStore } from '../db/queries/sessions.js';
import { logger } from '../utils/logger.js';

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class OrphanCleanup {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly store: SessionStore;
  /** IDs of sessions that are live in memory */
  private getLiveSessions: () => Set<string>;

  constructor(getLiveSessions: () => Set<string>) {
    this.store = new SessionStore();
    this.getLiveSessions = getLiveSessions;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runCleanup(), CLEANUP_INTERVAL_MS);
    // Unref so the timer doesn't prevent Node from exiting
    this.timer.unref?.();
    logger.info('OrphanCleanup started', { intervalMs: CLEANUP_INTERVAL_MS });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  runCleanup(): void {
    try {
      const liveSessions = this.getLiveSessions();
      const activeSessions = this.store.list('active');

      let cleaned = 0;
      for (const session of activeSessions) {
        if (!liveSessions.has(session.id)) {
          // Session is marked active in DB but not in memory — mark as timeout
          this.store.update(session.id, { status: 'timeout' });
          cleaned++;
          logger.info('Orphan session cleaned up', { sessionId: session.id });
        }
      }

      if (cleaned > 0) {
        logger.info('OrphanCleanup completed', { cleaned });
      }
    } catch (err) {
      logger.error('OrphanCleanup error', { err });
    }
  }
}
