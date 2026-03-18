import { execSync, execFile } from 'child_process';
import * as path from 'path';
import { Worktree } from '../shared/types';

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
}

function runAsync(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, encoding: 'utf-8', timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve((stdout || '').trim());
    });
  });
}

export function getRepoRoot(somePath: string): string {
  return run('git rev-parse --show-toplevel', somePath);
}

export function listWorktrees(repoPath: string): Worktree[] {
  const output = run('git worktree list --porcelain', repoPath);
  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current.path = line.slice('worktree '.length);
      current.id = path.basename(current.path);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace('refs/heads/', '');
    } else if (line === 'bare') {
      current.isBare = true;
    } else if (line === '') {
      if (current.path) {
        worktrees.push({
          id: current.id || path.basename(current.path),
          path: current.path,
          branch: current.branch || '(detached)',
          isMain: worktrees.length === 0,
          isBare: current.isBare || false,
          repoRoot: repoPath,
        });
      }
      current = {};
    }
  }

  if (current.path) {
    worktrees.push({
      id: current.id || path.basename(current.path),
      path: current.path,
      branch: current.branch || '(detached)',
      isMain: worktrees.length === 0,
      isBare: current.isBare || false,
      repoRoot: repoPath,
    });
  }

  return worktrees.reverse();
}

export function addWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  createBranch: boolean
): Worktree {
  if (createBranch) {
    run(`git worktree add -b ${branch} "${worktreePath}"`, repoPath);
  } else {
    run(`git worktree add "${worktreePath}" ${branch}`, repoPath);
  }
  const worktrees = listWorktrees(repoPath);
  const added = worktrees.find((w) => w.path === worktreePath);
  if (!added) throw new Error(`Failed to find worktree at ${worktreePath}`);
  return added;
}

export async function removeWorktreeAsync(repoPath: string, worktreePath: string, force: boolean = false): Promise<void> {
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(worktreePath);
  await runAsync('git', args, repoPath);
}

export async function deleteBranchAsync(repoPath: string, branch: string, force: boolean = false): Promise<void> {
  const flag = force ? '-D' : '-d';
  await runAsync('git', ['branch', flag, branch], repoPath);
}

export function getWorktreeStatus(worktreePath: string): string {
  try {
    const status = run('git status --porcelain', worktreePath);
    if (!status) return 'clean';
    const lines = status.split('\n').filter(Boolean);
    return `${lines.length} changed`;
  } catch {
    return 'unknown';
  }
}

export interface DiffStats {
  additions: number;
  deletions: number;
  changedFiles: number;
}

export function getDiffStats(worktreePath: string): DiffStats {
  try {
    const stat = run('git diff --numstat', worktreePath);
    let additions = 0;
    let deletions = 0;
    let changedFiles = 0;
    for (const line of (stat || '').split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        const add = parseInt(parts[0], 10);
        const del = parseInt(parts[1], 10);
        if (!isNaN(add)) additions += add;
        if (!isNaN(del)) deletions += del;
        changedFiles++;
      }
    }
    const staged = run('git diff --cached --numstat', worktreePath);
    for (const line of (staged || '').split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        const add = parseInt(parts[0], 10);
        const del = parseInt(parts[1], 10);
        if (!isNaN(add)) additions += add;
        if (!isNaN(del)) deletions += del;
        changedFiles++;
      }
    }
    return { additions, deletions, changedFiles };
  } catch {
    return { additions: 0, deletions: 0, changedFiles: 0 };
  }
}

export function getAvailableBranches(repoPath: string): string[] {
  const output = run('git branch -a --format="%(refname:short)"', repoPath);
  return output.split('\n').filter(Boolean);
}
