import * as os from 'os';
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
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _registry: ServerRegistry | null = null;

export function getServerRegistry(): ServerRegistry {
  if (!_registry) {
    _registry = new ServerRegistry(config.SERVERS ?? '');
  }
  return _registry;
}
