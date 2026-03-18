/**
 * Session state machine + idle timeout management.
 */

import { SessionStatus } from './session-types.js';
import { logger } from '../utils/logger.js';

export type SessionEvent =
  | 'message_received'
  | 'turn_completed'
  | 'idle_timeout'
  | 'stop_requested'
  | 'error_occurred';

const TRANSITIONS: Record<SessionStatus, Partial<Record<SessionEvent, SessionStatus>>> = {
  [SessionStatus.IDLE]: {
    message_received: SessionStatus.ACTIVE,
    stop_requested: SessionStatus.TERMINATED,
    error_occurred: SessionStatus.ERROR,
  },
  [SessionStatus.ACTIVE]: {
    turn_completed: SessionStatus.IDLE,
    idle_timeout: SessionStatus.IDLE,
    stop_requested: SessionStatus.TERMINATED,
    error_occurred: SessionStatus.ERROR,
  },
  [SessionStatus.TERMINATED]: {},
  [SessionStatus.ERROR]: {
    stop_requested: SessionStatus.TERMINATED,
  },
};

export class SessionStateMachine {
  private status: SessionStatus;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleTimeoutMs: number;
  private readonly onIdle: () => void;
  private readonly onTimeout: () => void;

  constructor(opts: {
    initialStatus?: SessionStatus;
    idleTimeoutMs?: number;
    onIdle?: () => void;
    onTimeout?: () => void;
  } = {}) {
    this.status = opts.initialStatus ?? SessionStatus.IDLE;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 1_800_000; // 30 min default
    this.onIdle = opts.onIdle ?? (() => {});
    this.onTimeout = opts.onTimeout ?? (() => {});
  }

  getStatus(): SessionStatus {
    return this.status;
  }

  transition(event: SessionEvent): SessionStatus {
    const next = TRANSITIONS[this.status]?.[event];
    if (!next) {
      logger.debug('SessionStateMachine: no transition', { from: this.status, event });
      return this.status;
    }

    logger.debug('SessionStateMachine: transition', { from: this.status, event, to: next });
    this.status = next;

    // Manage idle timer
    if (next === SessionStatus.IDLE) {
      this.onIdle();
      this.startIdleTimer();
    } else {
      this.clearIdleTimer();
    }

    return this.status;
  }

  private startIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.status === SessionStatus.IDLE) {
        this.status = SessionStatus.IDLE; // stay IDLE, just fire callback
        this.onTimeout();
      }
    }, this.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  destroy(): void {
    this.clearIdleTimer();
  }
}
