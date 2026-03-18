import * as pty from 'node-pty';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { WorktreeConfig } from '../shared/types';

interface PtySession {
  pty: pty.IPty;
  worktreeId: string;
  claudeActive: boolean;
}

export class PtyManager {
  private sessions: Map<string, PtySession> = new Map();
  private onDataCallbacks: Map<string, (data: string) => void> = new Map();
  private onExitCallbacks: Map<string, (code: number) => void> = new Map();

  createSession(
    worktreeId: string,
    worktreePath: string,
    config?: WorktreeConfig
  ): string {
    if (this.sessions.has(worktreeId)) {
      this.destroySession(worktreeId);
    }

    const shell = config?.shell || process.env.SHELL || '/bin/zsh';
    const env = {
      ...process.env,
      ...config?.env,
      MADAGENTS_WORKTREE: worktreePath,
      MADAGENTS_SESSION: worktreeId,
    };

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: worktreePath,
      env: env as Record<string, string>,
    });

    const session: PtySession = {
      pty: ptyProcess,
      worktreeId,
      claudeActive: false,
    };

    ptyProcess.onData((data: string) => {
      const cb = this.onDataCallbacks.get(worktreeId);
      if (cb) cb(data);
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      const cb = this.onExitCallbacks.get(worktreeId);
      if (cb) cb(exitCode);
    });

    this.sessions.set(worktreeId, session);

    // Run post-open script if configured
    if (config?.postOpenScript) {
      const scriptPath = config.postOpenScript.startsWith('/')
        ? config.postOpenScript
        : path.join(worktreePath, config.postOpenScript);
      if (fs.existsSync(scriptPath)) {
        ptyProcess.write(`source "${scriptPath}"\r`);
      } else {
        // Treat as inline command
        ptyProcess.write(`${config.postOpenScript}\r`);
      }
    }

    return worktreeId;
  }

  startClaude(worktreeId: string, args: string[] = []): void {
    const session = this.sessions.get(worktreeId);
    if (!session) return;

    const claudeCmd = ['claude', ...args].join(' ');
    session.pty.write(`${claudeCmd}\r`);
    session.claudeActive = true;
  }

  stopClaude(worktreeId: string): void {
    const session = this.sessions.get(worktreeId);
    if (!session) return;

    // Send Ctrl+C to interrupt
    session.pty.write('\x03');
    session.claudeActive = false;
  }

  write(worktreeId: string, data: string): void {
    const session = this.sessions.get(worktreeId);
    if (session) {
      session.pty.write(data);
    }
  }

  resize(worktreeId: string, cols: number, rows: number): void {
    const session = this.sessions.get(worktreeId);
    if (session) {
      session.pty.resize(cols, rows);
    }
  }

  onData(worktreeId: string, callback: (data: string) => void): void {
    this.onDataCallbacks.set(worktreeId, callback);
  }

  onExit(worktreeId: string, callback: (code: number) => void): void {
    this.onExitCallbacks.set(worktreeId, callback);
  }

  isClaudeActive(worktreeId: string): boolean {
    return this.sessions.get(worktreeId)?.claudeActive || false;
  }

  destroySession(worktreeId: string): void {
    const session = this.sessions.get(worktreeId);
    if (session) {
      session.pty.kill();
      this.sessions.delete(worktreeId);
      this.onDataCallbacks.delete(worktreeId);
      this.onExitCallbacks.delete(worktreeId);
    }
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroySession(id);
    }
  }
}
