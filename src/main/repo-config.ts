import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { AppConfig, WorktreeConfig } from '../shared/types';

const CONFIG_DIR_NAME = '.madmux';
const CONFIG_FILE_NAME = 'config.yaml';

export interface RepoConfig {
  worktreeDir?: string;
  defaultPostOpenScript?: string;
  defaultClaudeArgs?: string[];
  appCommand?: string;
  worktrees?: Record<string, WorktreeConfig>;
}

function configPath(repoPath: string): string {
  return path.join(repoPath, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

export function loadRepoConfig(repoPath: string): RepoConfig {
  const p = configPath(repoPath);
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    return (yaml.load(raw) as RepoConfig) || {};
  } catch {
    return {};
  }
}

export function saveRepoConfig(repoPath: string, config: RepoConfig): void {
  const dir = path.join(repoPath, CONFIG_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath(repoPath), yaml.dump(config, { lineWidth: 120 }));
}

export function mergeRepoConfigIntoApp(repoPath: string, appConfig: AppConfig): AppConfig {
  const repo = loadRepoConfig(repoPath);
  return {
    ...appConfig,
    worktreeDir: repo.worktreeDir || appConfig.worktreeDir,
    defaultPostOpenScript: repo.defaultPostOpenScript || appConfig.defaultPostOpenScript,
    defaultClaudeArgs: repo.defaultClaudeArgs || appConfig.defaultClaudeArgs,
    worktreeConfigs: { ...appConfig.worktreeConfigs, ...repo.worktrees },
  };
}

export function syncAppConfigToRepo(repoPath: string, appConfig: AppConfig): void {
  const repo: RepoConfig = {
    worktreeDir: appConfig.worktreeDir,
    defaultPostOpenScript: appConfig.defaultPostOpenScript,
    defaultClaudeArgs: appConfig.defaultClaudeArgs,
    worktrees: appConfig.worktreeConfigs,
  };
  saveRepoConfig(repoPath, repo);
}
