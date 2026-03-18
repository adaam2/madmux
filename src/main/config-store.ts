import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AppConfig, WorktreeConfig } from '../shared/types';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'madagents');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): AppConfig {
  ensureDir();
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {
      repoPath: '',
      worktreeDir: path.join(os.homedir(), '.worktrees'),
      worktreeConfigs: {},
    };
  }
}

export function saveConfig(config: AppConfig): void {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getWorktreeConfig(worktreeId: string): WorktreeConfig {
  const config = loadConfig();
  return config.worktreeConfigs[worktreeId] || {};
}

export function setWorktreeConfig(worktreeId: string, wtConfig: WorktreeConfig): void {
  const config = loadConfig();
  config.worktreeConfigs[worktreeId] = wtConfig;
  saveConfig(config);
}
