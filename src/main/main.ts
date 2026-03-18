import { app, BrowserWindow, ipcMain, dialog, Menu, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { PtyManager } from './pty-manager';
import { loadGhosttyTheme } from './ghostty-config';
import { loadConfig, saveConfig, getWorktreeConfig, setWorktreeConfig } from './config-store';
import { listWorktrees, addWorktree, removeWorktreeAsync, deleteBranchAsync, getWorktreeStatus, getDiffStats, getAvailableBranches } from './worktree';
import { loadRepoConfig, saveRepoConfig, syncAppConfigToRepo } from './repo-config';

let mainWindow: BrowserWindow | null = null;
const ptyManager = new PtyManager();

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'Cmd+,',
          click: () => mainWindow?.webContents.send('menu:settings'),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Repository...',
          accelerator: 'Cmd+O',
          click: async () => {
            const result = await dialog.showOpenDialog({
              properties: ['openDirectory'],
              message: 'Select a git repository',
            });
            if (result.canceled || !result.filePaths[0]) return;
            const repoPath = result.filePaths[0];
            const config = loadConfig();
            config.repoPath = repoPath;
            saveConfig(config);
            mainWindow?.webContents.send('menu:repo-opened', repoPath);
          },
        },
        {
          label: 'Set Worktree Directory...',
          click: async () => {
            const result = await dialog.showOpenDialog({
              properties: ['openDirectory', 'createDirectory'],
              message: 'Select worktree directory',
            });
            if (result.canceled || !result.filePaths[0]) return;
            const dir = result.filePaths[0];
            const config = loadConfig();
            config.worktreeDir = dir;
            saveConfig(config);
            mainWindow?.webContents.send('menu:worktree-dir-changed', dir);
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1a1b26',
    icon: iconPath,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.platform === 'darwin' && app.dock) {
    const { nativeImage } = require('electron');
    const dockIcon = nativeImage.createFromPath(iconPath);
    app.dock.setIcon(dockIcon);
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    ptyManager.destroyAll();
  });
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  ptyManager.destroyAll();
  app.quit();
});

// ---- IPC Handlers ----

ipcMain.handle('app:get-theme', () => loadGhosttyTheme());

ipcMain.handle('config:get', () => loadConfig());

ipcMain.handle('config:set', (_event, config) => {
  saveConfig(config);
  // Also sync to repo .madmux/config.yaml
  if (config.repoPath) {
    syncAppConfigToRepo(config.repoPath, config);
  }
});

ipcMain.handle('config:get-worktree', (_event, worktreeId: string) => getWorktreeConfig(worktreeId));

ipcMain.handle('config:set-worktree', (_event, worktreeId: string, config) => {
  setWorktreeConfig(worktreeId, config);
});

ipcMain.handle('config:get-repo', (_event, repoPath: string) => loadRepoConfig(repoPath));

ipcMain.handle('config:set-repo', (_event, repoPath: string, config) => {
  saveRepoConfig(repoPath, config);
});

ipcMain.handle('worktree:list', (_event, repoPath: string) => {
  try {
    const worktrees = listWorktrees(repoPath);
    return worktrees.map((w) => ({
      ...w,
      status: getWorktreeStatus(w.path),
      diffStats: getDiffStats(w.path),
    }));
  } catch (e: any) {
    return { error: e.message };
  }
});

ipcMain.handle('worktree:add', (_event, repoPath: string, wtPath: string, branch: string, createBranch: boolean) => {
  try {
    const parentDir = path.dirname(wtPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    return addWorktree(repoPath, wtPath, branch, createBranch);
  } catch (e: any) {
    return { error: e.message };
  }
});

ipcMain.handle('worktree:remove', async (_event, repoPath: string, wtPath: string, opts?: { force?: boolean; deleteBranch?: string }) => {
  try {
    await removeWorktreeAsync(repoPath, wtPath, opts?.force);
    if (opts?.deleteBranch) {
      try { await deleteBranchAsync(repoPath, opts.deleteBranch, opts?.force); } catch { /* ok */ }
    }
    return { success: true };
  } catch (e: any) {
    return { error: e.message };
  }
});

ipcMain.handle('worktree:remove-batch', async (_event, repoPath: string, items: Array<{ path: string; branch?: string; force?: boolean }>) => {
  const results: Array<{ path: string; success: boolean; error?: string }> = [];
  for (const item of items) {
    try {
      await removeWorktreeAsync(repoPath, item.path, item.force);
      if (item.branch) {
        try { await deleteBranchAsync(repoPath, item.branch, item.force); } catch { /* ok */ }
      }
      results.push({ path: item.path, success: true });
    } catch (e: any) {
      results.push({ path: item.path, success: false, error: e.message });
    }
  }
  return results;
});

ipcMain.handle('worktree:branches', (_event, repoPath: string) => {
  try { return getAvailableBranches(repoPath); } catch { return []; }
});

ipcMain.handle('worktree:diff-stats', (_event, worktreePath: string) => getDiffStats(worktreePath));

ipcMain.handle('terminal:create', (_event, worktreeId: string, worktreePath: string) => {
  const config = getWorktreeConfig(worktreeId);
  const appConfig = loadConfig();
  const mergedConfig = {
    ...config,
    postOpenScript: config.postOpenScript || appConfig.defaultPostOpenScript,
    claudeArgs: config.claudeArgs || appConfig.defaultClaudeArgs,
  };

  ptyManager.createSession(worktreeId, worktreePath, mergedConfig);

  ptyManager.onData(worktreeId, (data) => {
    mainWindow?.webContents.send('terminal:data', worktreeId, data);
  });
  ptyManager.onExit(worktreeId, (code) => {
    mainWindow?.webContents.send('terminal:exit', worktreeId, code);
  });

  return { success: true };
});

// App terminal (for running dev server etc per worktree)
ipcMain.handle('terminal:create-app', (_event, worktreeId: string, worktreePath: string, command: string) => {
  const appTermId = `app-${worktreeId}`;
  ptyManager.createSession(appTermId, worktreePath);

  ptyManager.onData(appTermId, (data) => {
    mainWindow?.webContents.send('terminal:data', appTermId, data);
  });
  ptyManager.onExit(appTermId, (code) => {
    mainWindow?.webContents.send('terminal:exit', appTermId, code);
  });

  // Run the app command
  if (command) {
    setTimeout(() => ptyManager.write(appTermId, `${command}\r`), 300);
  }

  return { success: true };
});

ipcMain.handle('terminal:input', (_event, worktreeId: string, data: string) => {
  ptyManager.write(worktreeId, data);
});

ipcMain.handle('terminal:resize', (_event, worktreeId: string, cols: number, rows: number) => {
  ptyManager.resize(worktreeId, cols, rows);
});

ipcMain.handle('terminal:destroy', (_event, worktreeId: string) => {
  ptyManager.destroySession(worktreeId);
});

ipcMain.handle('claude:start', (_event, worktreeId: string, args: string[]) => {
  ptyManager.startClaude(worktreeId, args);
});

ipcMain.handle('claude:stop', (_event, worktreeId: string) => {
  ptyManager.stopClaude(worktreeId);
});
