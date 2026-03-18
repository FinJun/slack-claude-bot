export enum SessionStatus {
  ACTIVE = 'active',
  IDLE = 'idle',
  TERMINATED = 'terminated',
  ERROR = 'error',
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  channelId: string;
  threadTs?: string;
  status: SessionStatus;
  createdAt: Date;
  lastActivityAt: Date;
  turnCount: number;
  totalCostUsd: number;
  workingDirectory: string;
  serverName?: string;
}

export type SessionEventType =
  | 'session_created'
  | 'session_resumed'
  | 'session_terminated'
  | 'session_idle'
  | 'session_error'
  | 'turn_started'
  | 'turn_completed'
  | 'budget_warning'
  | 'budget_exceeded';

export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  userId: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}

export interface CreateSessionOptions {
  userId: string;
  channelId: string;
  threadTs?: string;
  workingDirectory: string;
}
