import { getDatabase, persistDb } from '../database.js';

export type SessionStatus = 'active' | 'completed' | 'error' | 'timeout';

export interface Session {
  id: string;
  slack_thread_ts: string;
  slack_channel_id: string;
  slack_user_id: string;
  project_dir: string;
  status: SessionStatus;
  total_cost_usd: number;
  num_turns: number;
  subprocess_pid: number | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  server_name: string;
}

export interface CreateSessionParams {
  id: string;
  slack_thread_ts: string;
  slack_channel_id: string;
  slack_user_id: string;
  project_dir: string;
  subprocess_pid?: number;
  server_name?: string;
}

export interface UpdateSessionParams {
  status?: SessionStatus;
  total_cost_usd?: number;
  num_turns?: number;
  subprocess_pid?: number | null;
}

function rowToSession(row: unknown[]): Session {
  return {
    id: row[0] as string,
    slack_thread_ts: row[1] as string,
    slack_channel_id: row[2] as string,
    slack_user_id: row[3] as string,
    project_dir: row[4] as string,
    status: row[5] as SessionStatus,
    total_cost_usd: row[6] as number,
    num_turns: row[7] as number,
    subprocess_pid: row[8] as number | null,
    created_at: row[9] as string,
    updated_at: row[10] as string,
    last_activity_at: row[11] as string,
    server_name: (row[12] as string | null) ?? 'local',
  };
}

export class SessionStore {
  create(params: CreateSessionParams): Session {
    const db = getDatabase();
    db.run(
      `INSERT INTO sessions
         (id, slack_thread_ts, slack_channel_id, slack_user_id, project_dir, subprocess_pid, server_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        params.id,
        params.slack_thread_ts,
        params.slack_channel_id,
        params.slack_user_id,
        params.project_dir,
        params.subprocess_pid ?? null,
        params.server_name ?? 'local',
      ],
    );

    // Also insert into thread_session_map
    db.run(
      `INSERT OR REPLACE INTO thread_session_map (slack_channel_id, slack_thread_ts, session_id)
       VALUES (?, ?, ?)`,
      [params.slack_channel_id, params.slack_thread_ts, params.id],
    );

    persistDb(db);
    return this.getById(params.id)!;
  }

  getById(id: string): Session | null {
    const db = getDatabase();
    const result = db.exec(
      `SELECT id, slack_thread_ts, slack_channel_id, slack_user_id, project_dir,
              status, total_cost_usd, num_turns, subprocess_pid,
              created_at, updated_at, last_activity_at, server_name
       FROM sessions WHERE id = ?`,
      [id],
    );
    if (!result.length || !result[0].values.length) return null;
    return rowToSession(result[0].values[0]);
  }

  getByThread(channelId: string, threadTs: string): Session | null {
    const db = getDatabase();
    const result = db.exec(
      `SELECT s.id, s.slack_thread_ts, s.slack_channel_id, s.slack_user_id, s.project_dir,
              s.status, s.total_cost_usd, s.num_turns, s.subprocess_pid,
              s.created_at, s.updated_at, s.last_activity_at, s.server_name
       FROM sessions s
       JOIN thread_session_map t ON t.session_id = s.id
       WHERE t.slack_channel_id = ? AND t.slack_thread_ts = ?`,
      [channelId, threadTs],
    );
    if (!result.length || !result[0].values.length) return null;
    return rowToSession(result[0].values[0]);
  }

  update(id: string, params: UpdateSessionParams): Session | null {
    const db = getDatabase();
    const sets: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];

    if (params.status !== undefined) {
      sets.push('status = ?');
      values.push(params.status);
    }
    if (params.total_cost_usd !== undefined) {
      sets.push('total_cost_usd = ?');
      values.push(params.total_cost_usd);
    }
    if (params.num_turns !== undefined) {
      sets.push('num_turns = ?');
      values.push(params.num_turns);
    }
    if (params.subprocess_pid !== undefined) {
      sets.push('subprocess_pid = ?');
      values.push(params.subprocess_pid);
    }

    if (sets.length === 1) return this.getById(id);

    values.push(id);
    db.run(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, values);
    persistDb(db);
    return this.getById(id);
  }

  list(status?: SessionStatus): Session[] {
    const db = getDatabase();
    let sql = `SELECT id, slack_thread_ts, slack_channel_id, slack_user_id, project_dir,
                      status, total_cost_usd, num_turns, subprocess_pid,
                      created_at, updated_at, last_activity_at, server_name
               FROM sessions`;
    const params: unknown[] = [];

    if (status !== undefined) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC';

    const result = db.exec(sql, params);
    if (!result.length) return [];
    return result[0].values.map(rowToSession);
  }

  delete(id: string): boolean {
    const db = getDatabase();
    db.run('DELETE FROM sessions WHERE id = ?', [id]);
    persistDb(db);
    // sql.js doesn't return affected rows directly; check if it's gone
    return this.getById(id) === null;
  }

  listByUser(slackUserId: string): Session[] {
    const db = getDatabase();
    const result = db.exec(
      `SELECT id, slack_thread_ts, slack_channel_id, slack_user_id, project_dir,
              status, total_cost_usd, num_turns, subprocess_pid,
              created_at, updated_at, last_activity_at, server_name
       FROM sessions
       WHERE slack_user_id = ?
       ORDER BY created_at DESC`,
      [slackUserId],
    );
    if (!result.length) return [];
    return result[0].values.map(rowToSession);
  }

  getActiveCount(slackUserId: string): number {
    const db = getDatabase();
    const result = db.exec(
      `SELECT COUNT(*) FROM sessions WHERE slack_user_id = ? AND status = 'active'`,
      [slackUserId],
    );
    if (!result.length || !result[0].values.length) return 0;
    return result[0].values[0][0] as number;
  }

  updateActivity(sessionId: string): void {
    const db = getDatabase();
    db.run(
      `UPDATE sessions SET last_activity_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
      [sessionId],
    );
    persistDb(db);
  }

  updateCost(sessionId: string, costUsd: number): void {
    const db = getDatabase();
    db.run(
      `UPDATE sessions SET total_cost_usd = ?, updated_at = datetime('now') WHERE id = ?`,
      [costUsd, sessionId],
    );
    persistDb(db);
  }
}
