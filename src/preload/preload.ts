import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getTheme: () => ipcRenderer.invoke('app:get-theme'),

  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: any) => ipcRenderer.invoke('config:set', config),
  getWorktreeConfig: (id: string) => ipcRenderer.invoke('config:get-worktree', id),
  setWorktreeConfig: (id: string, config: any) => ipcRenderer.invoke('config:set-worktree', id, config),
  getRepoConfig: (repoPath: string) => ipcRenderer.invoke('config:get-repo', repoPath),
  setRepoConfig: (repoPath: string, config: any) => ipcRenderer.invoke('config:set-repo', repoPath, config),

  // Worktrees
  listWorktrees: (repoPath: string) => ipcRenderer.invoke('worktree:list', repoPath),
  addWorktree: (repoPath: string, path: string, branch: string, create: boolean) =>
    ipcRenderer.invoke('worktree:add', repoPath, path, branch, create),
  removeWorktree: (repoPath: string, path: string, opts?: { force?: boolean; deleteBranch?: string }) =>
    ipcRenderer.invoke('worktree:remove', repoPath, path, opts),
  removeWorktreeBatch: (repoPath: string, items: Array<{ path: string; branch?: string; force?: boolean }>) =>
    ipcRenderer.invoke('worktree:remove-batch', repoPath, items),
  getBranches: (repoPath: string) => ipcRenderer.invoke('worktree:branches', repoPath),
  getDiffStats: (worktreePath: string) => ipcRenderer.invoke('worktree:diff-stats', worktreePath),

  // Terminal
  createTerminal: (worktreeId: string, worktreePath: string) =>
    ipcRenderer.invoke('terminal:create', worktreeId, worktreePath),
  createAppTerminal: (worktreeId: string, worktreePath: string, command: string) =>
    ipcRenderer.invoke('terminal:create-app', worktreeId, worktreePath, command),
  writeTerminal: (worktreeId: string, data: string) =>
    ipcRenderer.invoke('terminal:input', worktreeId, data),
  resizeTerminal: (worktreeId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('terminal:resize', worktreeId, cols, rows),
  destroyTerminal: (worktreeId: string) =>
    ipcRenderer.invoke('terminal:destroy', worktreeId),
  onTerminalData: (callback: (worktreeId: string, data: string) => void) => {
    const listener = (_event: any, worktreeId: string, data: string) => callback(worktreeId, data);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  onTerminalExit: (callback: (worktreeId: string, code: number) => void) => {
    const listener = (_event: any, worktreeId: string, code: number) => callback(worktreeId, code);
    ipcRenderer.on('terminal:exit', listener);
    return () => ipcRenderer.removeListener('terminal:exit', listener);
  },

  // Claude
  startClaude: (worktreeId: string, args?: string[]) =>
    ipcRenderer.invoke('claude:start', worktreeId, args || []),
  stopClaude: (worktreeId: string) =>
    ipcRenderer.invoke('claude:stop', worktreeId),

  // Menu events from native menu
  onMenuSettings: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('menu:settings', listener);
    return () => ipcRenderer.removeListener('menu:settings', listener);
  },
  onMenuRepoOpened: (cb: (repoPath: string) => void) => {
    const listener = (_event: any, repoPath: string) => cb(repoPath);
    ipcRenderer.on('menu:repo-opened', listener);
    return () => ipcRenderer.removeListener('menu:repo-opened', listener);
  },
  onMenuWorktreeDirChanged: (cb: (dir: string) => void) => {
    const listener = (_event: any, dir: string) => cb(dir);
    ipcRenderer.on('menu:worktree-dir-changed', listener);
    return () => ipcRenderer.removeListener('menu:worktree-dir-changed', listener);
  },
});
