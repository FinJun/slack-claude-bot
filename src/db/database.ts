import { createRequire } from 'module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// sql.js types (no @types/sql.js available)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlJsStatic = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;

export type Migration = {
  version: number;
  name: string;
  up: (db: Database) => void;
};

let sqlJs: SqlJsStatic | null = null;
let dbInstance: Database | null = null;
let dbFilePath: string | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (sqlJs) return sqlJs;
  const initSqlJs = require('sql.js');
  const wasmPath = resolve(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm');
  sqlJs = await initSqlJs({ locateFile: () => wasmPath });
  return sqlJs;
}

function getDbPath(): string {
  return process.env.DB_PATH ?? resolve(process.cwd(), 'data/sessions.db');
}

export function persistDb(db: Database): void {
  if (!dbFilePath) return;
  const data: Uint8Array = db.export();
  writeFileSync(dbFilePath, Buffer.from(data));
}

export async function initDatabase(migrations: Migration[] = []): Promise<Database> {
  if (dbInstance) return dbInstance;

  const SQL = await getSqlJs();
  dbFilePath = getDbPath();

  const dir = dirname(dbFilePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let db: Database;
  if (existsSync(dbFilePath)) {
    const fileBuffer = readFileSync(dbFilePath);
    db = new SQL.Database(fileBuffer);
    logger.debug('Loaded existing SQLite database', { path: dbFilePath });
  } else {
    db = new SQL.Database();
    logger.info('Created new SQLite database', { path: dbFilePath });
  }

  // WAL mode equivalent for sql.js - enable journal mode
  db.run('PRAGMA journal_mode=WAL;');
  db.run('PRAGMA busy_timeout=5000;');
  db.run('PRAGMA foreign_keys=ON;');

  // Run migrations
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  );`);

  const applied = new Set<number>();
  const rows = db.exec('SELECT version FROM schema_migrations;');
  if (rows.length > 0 && rows[0].values) {
    for (const row of rows[0].values) {
      applied.add(row[0] as number);
    }
  }

  const pending = migrations.filter((m) => !applied.has(m.version));
  pending.sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    logger.info('Running migration', { version: migration.version, name: migration.name });
    migration.up(db);
    db.run('INSERT INTO schema_migrations (version, name) VALUES (?, ?);', [
      migration.version,
      migration.name,
    ]);
  }

  if (pending.length > 0) {
    persistDb(db);
  }

  dbInstance = db;
  return db;
}

export function getDatabase(): Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    persistDb(dbInstance);
    dbInstance.close();
    dbInstance = null;
    logger.debug('Database closed');
  }
}
