/**
 * SshTransport — wraps an SSH process that proxies to a remote Claude Code CLI.
 *
 * Spawns an SSH connection to the remote host, writes the OAuth token as the
 * first stdin line, then communicates via stream-json on stdin/stdout.
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import { createInterface, type Interface } from 'readline';
import { logger } from '../utils/logger.js';
import type { ClaudeTransport } from './types.js';

export interface SshTransportOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  oauthToken: string;
  cwd: string;
  maxTurns: number;
  model?: string;
  appendSystemPrompt?: string;
  /** If set, use key-based auth instead of password */
  sshKeyPath?: string;
}

export class SshTransport implements ClaudeTransport {
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;
  private aborted = false;
  private readonly _messages: AsyncIterable<any>;

  /**
   * Returns true if sshpass is available on PATH.
   * Call this before constructing SshTransport with password auth.
   */
  static checkSshpassAvailable(): boolean {
    try {
      execSync('which sshpass', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  constructor(private readonly opts: SshTransportOptions) {
    this._messages = this.createMessageStream();
  }

  get messages(): AsyncIterable<any> {
    return this._messages;
  }

  private async *createMessageStream(): AsyncIterable<any> {
    this.proc = this.spawnSshProcess();

    // Write OAuth token as the first stdin line so the remote shell can read it
    this.proc.stdin!.write(this.opts.oauthToken + '\n');

    // Collect stderr for error detection
    let stderr = '';
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      logger.debug('SSH stderr', { data: chunk.toString().trim() });
    });

    // Parse stdout line by line as JSON
    this.rl = createInterface({ input: this.proc.stdout! });

    for await (const line of this.rl) {
      if (this.aborted) break;
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed);
        yield msg;
      } catch {
        logger.debug('SSH non-JSON output', { line: trimmed });
      }
    }

    // Wait for process to exit
    const exitCode = await new Promise<number | null>((resolve) => {
      if (this.proc!.exitCode !== null) {
        resolve(this.proc!.exitCode);
      } else {
        this.proc!.on('exit', (code) => resolve(code));
      }
    });

    if (exitCode !== 0 && !this.aborted) {
      const error = this.classifyError(stderr, exitCode);
      throw error;
    }
  }

  private spawnSshProcess(): ChildProcess {
    // Build the remote command that:
    // 1. Reads the OAuth token from stdin
    // 2. Exports it as CLAUDE_CODE_OAUTH_TOKEN
    // 3. Executes claude with stream-json I/O
    const cmdParts = [
      'read -r TOKEN;',
      'export CLAUDE_CODE_OAUTH_TOKEN="$TOKEN";',
      'exec claude',
      '--output-format stream-json',
      '--input-format stream-json',
      `--max-turns ${this.opts.maxTurns}`,
      `--cwd ${this.opts.cwd}`,
    ];

    if (this.opts.model) {
      cmdParts.push(`--model ${this.opts.model}`);
    }

    if (this.opts.appendSystemPrompt) {
      cmdParts.push(`--append-system-prompt ${JSON.stringify(this.opts.appendSystemPrompt)}`);
    }

    const remoteCmd = `bash -c '${cmdParts.join(' ')}'`;

    const sshArgs = [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-p', String(this.opts.port),
      `${this.opts.username}@${this.opts.host}`,
      remoteCmd,
    ];

    let proc: ChildProcess;
    if (this.opts.sshKeyPath) {
      proc = spawn('ssh', ['-i', this.opts.sshKeyPath, ...sshArgs], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      // Use sshpass for password auth
      proc = spawn('sshpass', ['-p', this.opts.password, 'ssh', ...sshArgs], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    return proc;
  }

  sendMessage(content: string, _sessionId?: string): void {
    if (this.proc?.stdin && !this.proc.stdin.destroyed) {
      const msg = JSON.stringify({ type: 'user', content });
      this.proc.stdin.write(msg + '\n');
    }
  }

  async interrupt(): Promise<void> {
    // Send SIGINT to the SSH process — this propagates to remote claude
    this.proc?.kill('SIGINT');
  }

  abort(): void {
    this.aborted = true;
    this.proc?.kill('SIGTERM');
  }

  close(): void {
    this.proc?.stdin?.end();
  }

  private classifyError(stderr: string, exitCode: number | null): Error {
    if (stderr.includes('Connection refused')) {
      return new Error(`Server ${this.opts.host} is unreachable. Is it powered on?`);
    }
    if (exitCode === 255 && (stderr.includes('Connection timed out') || stderr.includes('Operation timed out'))) {
      return new Error(`Connection to ${this.opts.host} timed out.`);
    }
    // Permission denied in SSH context means auth failure (before login), not directory access
    if (stderr.includes('Authentication failed') || (stderr.includes('Permission denied') && stderr.includes('publickey'))) {
      return new Error(
        `Authentication failed for ${this.opts.host}. Check your credentials with \`/claude register\`.`,
      );
    }
    if (stderr.includes('command not found') || stderr.includes('claude: not found') || stderr.includes('No such file or directory: claude')) {
      return new Error(
        `Claude CLI is not installed on ${this.opts.host}. Run: npm install -g @anthropic-ai/claude-code`,
      );
    }
    if (stderr.includes('No such file or directory')) {
      // Extract the path from the error if possible
      const match = /No such file or directory.*?['"]?([^\s'"]+)['"]?/.exec(stderr);
      const path = match?.[1] ?? this.opts.cwd;
      return new Error(`Directory ${path} does not exist on ${this.opts.host}.`);
    }
    if (stderr.includes('Permission denied') || stderr.includes('permission denied')) {
      return new Error(
        `Permission denied on ${this.opts.host}. Check your user has access to the directory.`,
      );
    }
    // Connection lost mid-session: SSH exits 255 with no stderr or "broken pipe" / "closed" messages
    if (
      exitCode === 255 ||
      stderr.includes('Broken pipe') ||
      stderr.includes('Connection closed') ||
      stderr.includes('packet_write_wait') ||
      stderr.includes('ssh_exchange_identification')
    ) {
      return new Error(`Connection to ${this.opts.host} was lost.`);
    }
    return new Error(`SSH session failed (exit ${exitCode}): ${stderr.substring(0, 200)}`);
  }
}
