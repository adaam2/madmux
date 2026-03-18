export interface Worktree {
  id: string;
  path: string;
  branch: string;
  isMain: boolean;
  isBare: boolean;
  repoRoot: string;
}

export interface WorktreeSession {
  worktree: Worktree;
  claudeActive: boolean;
  lastActivity: number;
  notification?: string;
}

export interface GhosttyTheme {
  foreground: string;
  background: string;
  cursorColor: string;
  selectionBackground: string;
  selectionForeground: string;
  palette: string[];
  fontFamily: string;
  fontSize: number;
}

export interface WorktreeConfig {
  postOpenScript?: string;
  claudeArgs?: string[];
  env?: Record<string, string>;
  shell?: string;
}

export interface AppConfig {
  repoPath: string;
  worktreeDir: string;
  worktreeConfigs: Record<string, WorktreeConfig>;
  defaultPostOpenScript?: string;
  defaultClaudeArgs?: string[];
  appCommand?: string;
}

export type IpcChannels =
  | 'worktree:list'
  | 'worktree:add'
  | 'worktree:remove'
  | 'worktree:select'
  | 'terminal:data'
  | 'terminal:resize'
  | 'terminal:input'
  | 'claude:start'
  | 'claude:stop'
  | 'config:get'
  | 'config:set'
  | 'config:get-worktree'
  | 'config:set-worktree'
  | 'app:select-repo'
  | 'app:get-theme';
