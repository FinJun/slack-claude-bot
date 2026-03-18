import { config } from '../config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[config.LOG_LEVEL];
}

function log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...fields,
  };

  const output = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
}

export const logger = {
  debug(message: string, fields?: Record<string, unknown>): void {
    log('debug', message, fields);
  },
  info(message: string, fields?: Record<string, unknown>): void {
    log('info', message, fields);
  },
  warn(message: string, fields?: Record<string, unknown>): void {
    log('warn', message, fields);
  },
  error(message: string, fields?: Record<string, unknown>): void {
    log('error', message, fields);
  },
  child(defaultFields: Record<string, unknown>) {
    return {
      debug(message: string, fields?: Record<string, unknown>): void {
        log('debug', message, { ...defaultFields, ...fields });
      },
      info(message: string, fields?: Record<string, unknown>): void {
        log('info', message, { ...defaultFields, ...fields });
      },
      warn(message: string, fields?: Record<string, unknown>): void {
        log('warn', message, { ...defaultFields, ...fields });
      },
      error(message: string, fields?: Record<string, unknown>): void {
        log('error', message, { ...defaultFields, ...fields });
      },
    };
  },
};
