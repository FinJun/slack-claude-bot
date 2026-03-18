import { getDatabase, persistDb } from '../database.js';

export type AuditDecision = 'allow' | 'deny' | 'ask';

export interface AuditLogEntry {
  id: number;
  session_id: string;
  tool_name: string;
  input: string | null;
  decision: AuditDecision;
  reason: string | null;
  created_at: string;
}

export interface LogToolUseParams {
  sessionId: string;
  toolName: string;
  input?: unknown;
  decision: AuditDecision;
  reason?: string;
}

// Pending entries for batch insert
const pendingEntries: LogToolUseParams[] = [];
let flushScheduled = false;

function flushPending(): void {
  if (pendingEntries.length === 0) return;

  const db = getDatabase();
  const batch = pendingEntries.splice(0, pendingEntries.length);

  for (const entry of batch) {
    db.run(
      `INSERT INTO tool_audit_log (session_id, tool_name, input, decision, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [
        entry.sessionId,
        entry.toolName,
        entry.input !== undefined ? JSON.stringify(entry.input) : null,
        entry.decision,
        entry.reason ?? null,
      ],
    );
  }

  persistDb(db);
  flushScheduled = false;
}

export function logToolUse(params: LogToolUseParams): void {
  pendingEntries.push(params);

  if (!flushScheduled) {
    flushScheduled = true;
    setImmediate(flushPending);
  }
}

export function getRecentDenials(limit: number = 20): AuditLogEntry[] {
  // Flush any pending before querying
  if (pendingEntries.length > 0) {
    flushPending();
  }

  const db = getDatabase();
  const result = db.exec(
    `SELECT id, session_id, tool_name, input, decision, reason, created_at
     FROM tool_audit_log
     WHERE decision = 'deny'
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit],
  );

  if (!result.length) return [];
  return result[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    session_id: row[1] as string,
    tool_name: row[2] as string,
    input: row[3] as string | null,
    decision: row[4] as AuditDecision,
    reason: row[5] as string | null,
    created_at: row[6] as string,
  }));
}

export function getAuditLogsForSession(sessionId: string, limit: number = 100): AuditLogEntry[] {
  if (pendingEntries.length > 0) {
    flushPending();
  }

  const db = getDatabase();
  const result = db.exec(
    `SELECT id, session_id, tool_name, input, decision, reason, created_at
     FROM tool_audit_log
     WHERE session_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [sessionId, limit],
  );

  if (!result.length) return [];
  return result[0].values.map((row: unknown[]) => ({
    id: row[0] as number,
    session_id: row[1] as string,
    tool_name: row[2] as string,
    input: row[3] as string | null,
    decision: row[4] as AuditDecision,
    reason: row[5] as string | null,
    created_at: row[6] as string,
  }));
}
