import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config } from '../config.js';

export interface ServerConfig {
  name: string;
  host: string;
  port: number;
}

export class ServerRegistry {
  private servers: Map<string, ServerConfig>;

  constructor(serversConfig: string) {
    this.servers = new Map();

    if (!serversConfig || serversConfig.trim() === '') {
      return;
    }

    for (const entry of serversConfig.split(',')) {
      const parts = entry.trim().split(':');
      if (parts.length < 2) continue;

      const name = parts[0].trim();
      const host = parts[1].trim();
      const port = parts.length >= 3 ? parseInt(parts[2].trim(), 10) : 22;

      if (!name || !host) continue;

      this.servers.set(name, { name, host, port });
    }
  }

  resolve(name: string): ServerConfig | null {
    return this.servers.get(name) ?? null;
  }

  list(): ServerConfig[] {
    return Array.from(this.servers.values());
  }

  isLocal(name: string): boolean {
    const server = this.servers.get(name);
    if (!server) return false;

    const localHostname = os.hostname();
    return (
      server.host === 'localhost' ||
      server.host === '127.0.0.1' ||
      server.name === localHostname ||
      server.host === localHostname
    );
  }

  addServer(name: string, host: string, port: number = 22): void {
    this.servers.set(name, { name, host, port });
    this.persistToEnv();
  }

  removeServer(name: string): boolean {
    const existed = this.servers.has(name);
    if (existed) {
      this.servers.delete(name);
      this.persistToEnv();
    }
    return existed;
  }

  private persistToEnv(): void {
    const envPath = path.join(process.cwd(), '.env');
    const newLine = `SERVERS=${Array.from(this.servers.values()).map(s => `${s.name}:${s.host}:${s.port}`).join(',')}`;

    let lines: string[] = [];
    if (fs.existsSync(envPath)) {
      lines = fs.readFileSync(envPath, 'utf8').split('\n');
    }

    const idx = lines.findIndex(l => l.startsWith('SERVERS='));
    if (idx >= 0) {
      lines[idx] = newLine;
    } else {
      lines.push(newLine);
    }

    fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _registry: ServerRegistry | null = null;

export function getServerRegistry(): ServerRegistry {
  if (!_registry) {
    _registry = new ServerRegistry(config.SERVERS ?? '');
  }
  return _registry;
}
