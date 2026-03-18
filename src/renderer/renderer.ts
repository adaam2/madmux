import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

declare global {
  interface Window {
    api: {
      getTheme: () => Promise<any>;
      getConfig: () => Promise<any>;
      setConfig: (config: any) => Promise<void>;
      getWorktreeConfig: (id: string) => Promise<any>;
      setWorktreeConfig: (id: string, config: any) => Promise<void>;
      getRepoConfig: (repoPath: string) => Promise<any>;
      setRepoConfig: (repoPath: string, config: any) => Promise<void>;
      repoConfigExists: (repoPath: string) => Promise<boolean>;
      listWorktrees: (repoPath: string) => Promise<any>;
      addWorktree: (repoPath: string, path: string, branch: string, create: boolean) => Promise<any>;
      removeWorktree: (repoPath: string, path: string, opts?: { force?: boolean; deleteBranch?: string }) => Promise<any>;
      removeWorktreeBatch: (repoPath: string, items: Array<{ path: string; branch?: string; force?: boolean }>) => Promise<any>;
      getBranches: (repoPath: string) => Promise<string[]>;
      getDiffStats: (worktreePath: string) => Promise<any>;
      createTerminal: (worktreeId: string, worktreePath: string) => Promise<any>;
      createAppTerminal: (worktreeId: string, worktreePath: string, command: string) => Promise<any>;
      writeTerminal: (worktreeId: string, data: string) => Promise<void>;
      resizeTerminal: (worktreeId: string, cols: number, rows: number) => Promise<void>;
      destroyTerminal: (worktreeId: string) => Promise<void>;
      onTerminalData: (cb: (worktreeId: string, data: string) => void) => () => void;
      onTerminalExit: (cb: (worktreeId: string, code: number) => void) => () => void;
      startClaude: (worktreeId: string, args?: string[]) => Promise<void>;
      stopClaude: (worktreeId: string) => Promise<void>;
      onMenuSettings: (cb: () => void) => () => void;
      onMenuRepoOpened: (cb: (repoPath: string) => void) => () => void;
      onMenuWorktreeDirChanged: (cb: (dir: string) => void) => () => void;
    };
  }
}

interface WorktreeEntry {
  id: string;
  path: string;
  branch: string;
  isMain: boolean;
  isBare: boolean;
  repoRoot: string;
  status?: string;
  diffStats?: { additions: number; deletions: number; changedFiles: number };
}

// State
let repoPath = '';
let worktreeDir = '';
let appCommand = '';
let worktrees: WorktreeEntry[] = [];
let activeWorktreeId: string | null = null;
const terminals: Map<string, { term: Terminal; fit: FitAddon }> = new Map();
const appTerminals: Map<string, { term: Terminal; fit: FitAddon }> = new Map();
const claudeActive: Set<string> = new Set();
const selectedWorktrees: Set<string> = new Set();
let selectMode = false;

// Elements
const $ = (id: string) => document.getElementById(id)!;
const sidebarList = $('worktree-list');
const emptyState = $('empty-state');
const terminalArea = $('terminal-area');
const terminalContainer = $('terminal-container');
const appTerminalContainer = $('app-terminal-container');
const repoInfo = $('repo-info');
const repoName = $('repo-name');
const activeBranch = $('active-branch');
const activePath = $('active-path');
const btnAddWorktree = $('btn-add-worktree') as HTMLButtonElement;
const settingsPanel = $('settings-panel');

let theme: any = null;

async function init(): Promise<void> {
  theme = await window.api.getTheme();
  applyTheme(theme);

  const config = await window.api.getConfig();
  worktreeDir = config.worktreeDir || '';
  appCommand = config.appCommand || '';
  if (config.repoPath) {
    repoPath = config.repoPath;
    await loadWorktrees();
    await checkFirstOpen();
  }
  renderWorktreeDir();

  setupEventListeners();
  setupTerminalDataListener();
  setupMenuListeners();
  setupResizeHandles();
}

function applyTheme(t: any): void {
  if (!t) return;
  document.documentElement.style.setProperty('--bg-primary', t.background);
  document.documentElement.style.setProperty('--fg-primary', t.foreground);
}

async function checkFirstOpen(): Promise<void> {
  if (!repoPath) return;
  const exists = await window.api.repoConfigExists(repoPath);
  if (!exists) showSetupPrompt();
}

function setupMenuListeners(): void {
  window.api.onMenuSettings(() => toggleSettings());
  window.api.onMenuRepoOpened(async (path) => {
    repoPath = path;
    await loadWorktrees();
    await checkFirstOpen();
  });
  window.api.onMenuWorktreeDirChanged((dir) => {
    worktreeDir = dir;
    renderWorktreeDir();
  });
}

function setupEventListeners(): void {
  btnAddWorktree.addEventListener('click', showAddModal);
  $('btn-worktree-dir').addEventListener('click', async () => {
    const config = await window.api.getConfig();
    worktreeDir = config.worktreeDir || '';
    renderWorktreeDir();
  });

  // Setup button
  $('btn-setup').addEventListener('click', () => showSetupPrompt());

  // Select mode toggle
  $('btn-select-mode').addEventListener('click', () => {
    selectMode = !selectMode;
    selectedWorktrees.clear();
    $('btn-select-mode').classList.toggle('active', selectMode);
    renderWorktreeList();
    updateMultiSelectBar();
  });
  $('select-all').addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    const deletable = worktrees.filter(w => !w.isMain);
    selectedWorktrees.clear();
    if (checked) deletable.forEach(w => selectedWorktrees.add(w.id));
    renderWorktreeList();
    updateMultiSelectBar();
  });
  $('btn-delete-selected').addEventListener('click', showBatchDeleteModal);

  // Add modal
  $('add-cancel').addEventListener('click', () => $('add-modal').classList.add('hidden'));
  $('add-confirm').addEventListener('click', confirmAddWorktree);
  $('add-modal').querySelector('.modal-backdrop')!.addEventListener('click', () => $('add-modal').classList.add('hidden'));

  // Setup modal
  $('setup-run').addEventListener('click', saveSetup);
  $('setup-skip').addEventListener('click', () => $('setup-modal').classList.add('hidden'));
  $('setup-modal').querySelector('.modal-backdrop')!.addEventListener('click', () => $('setup-modal').classList.add('hidden'));

  // Delete modal
  $('delete-cancel').addEventListener('click', () => $('delete-modal').classList.add('hidden'));
  $('delete-confirm').addEventListener('click', confirmDelete);
  $('delete-modal').querySelector('.modal-backdrop')!.addEventListener('click', () => $('delete-modal').classList.add('hidden'));

  // Settings
  $('settings-close').addEventListener('click', () => toggleSettings(false));
  setupSettingsListeners();

  // Resize
  window.addEventListener('resize', () => fitAllVisibleTerminals());

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.metaKey && e.key === 'n' && repoPath) { e.preventDefault(); showAddModal(); }
    if (e.metaKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (idx < worktrees.length) selectWorktree(worktrees[idx].id);
    }
  });
}

function setupSettingsListeners(): void {
  const debounce = (fn: () => void, ms: number) => {
    let t: ReturnType<typeof setTimeout>;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  };

  const save = debounce(async () => {
    const config = await window.api.getConfig();
    config.worktreeDir = ($('setting-worktree-dir') as HTMLInputElement).value.trim();
    config.appCommand = ($('setting-app-command') as HTMLInputElement).value.trim();
    config.startScriptPath = ($('setting-start-script') as HTMLInputElement).value.trim() || undefined;
    config.setupScriptPath = ($('setting-setup-script') as HTMLInputElement).value.trim() || undefined;
    const argsStr = ($('setting-claude-args') as HTMLInputElement).value.trim();
    config.defaultClaudeArgs = argsStr ? argsStr.split(/\s+/) : undefined;
    await window.api.setConfig(config);
    worktreeDir = config.worktreeDir;
    appCommand = config.appCommand || '';
    renderWorktreeDir();
  }, 500);

  ['setting-worktree-dir', 'setting-app-command', 'setting-start-script', 'setting-setup-script', 'setting-claude-args'].forEach(id => {
    $(id).addEventListener('input', save);
  });
}

function toggleSettings(show?: boolean): void {
  const visible = show !== undefined ? show : settingsPanel.classList.contains('hidden');
  settingsPanel.classList.toggle('hidden', !visible);
  terminalArea.classList.toggle('hidden', visible);
  emptyState.classList.toggle('hidden', visible || !!activeWorktreeId);

  if (visible) loadSettingsValues();
}

async function loadSettingsValues(): Promise<void> {
  const config = await window.api.getConfig();
  ($('setting-worktree-dir') as HTMLInputElement).value = config.worktreeDir || '';
  ($('setting-app-command') as HTMLInputElement).value = config.appCommand || '';
  ($('setting-start-script') as HTMLInputElement).value = config.startScriptPath || '';
  ($('setting-setup-script') as HTMLInputElement).value = config.setupScriptPath || '';
  ($('setting-claude-args') as HTMLInputElement).value = (config.defaultClaudeArgs || []).join(' ');
}

function setupTerminalDataListener(): void {
  window.api.onTerminalData((worktreeId: string, data: string) => {
    if (worktreeId.startsWith('app-')) {
      const realId = worktreeId.slice(4);
      const entry = appTerminals.get(realId);
      if (entry) entry.term.write(data);
    } else {
      const entry = terminals.get(worktreeId);
      if (entry) entry.term.write(data);
    }
  });

  window.api.onTerminalExit((worktreeId: string, _code: number) => {
    if (!worktreeId.startsWith('app-')) {
      claudeActive.delete(worktreeId);
      renderWorktreeList();
    }
  });
}

// ---- Resize handles ----

function setupResizeHandles(): void {
  setupSidebarResize();
  setupTerminalSplitResize();
}

function setupSidebarResize(): void {
  const handle = $('sidebar-resize');
  const sidebar = $('sidebar');
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    document.body.classList.add('resizing');
    handle.classList.add('active');

    const onMove = (e: MouseEvent) => {
      const newWidth = Math.min(500, Math.max(180, startWidth + (e.clientX - startX)));
      sidebar.style.width = `${newWidth}px`;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing');
      handle.classList.remove('active');
      fitAllVisibleTerminals();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function setupTerminalSplitResize(): void {
  const handle = $('terminal-split-handle');
  const split = $('terminal-split');
  let startX = 0;
  let startLeftWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startLeftWidth = terminalContainer.offsetWidth;
    document.body.classList.add('resizing');
    handle.classList.add('active');

    const onMove = (e: MouseEvent) => {
      const splitWidth = split.offsetWidth - 5; // handle width
      const newLeft = Math.min(splitWidth - 100, Math.max(100, startLeftWidth + (e.clientX - startX)));
      const leftPct = (newLeft / splitWidth) * 100;
      terminalContainer.style.flex = 'none';
      terminalContainer.style.width = `${leftPct}%`;
      appTerminalContainer.style.flex = '1';
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing');
      handle.classList.remove('active');
      fitAllVisibleTerminals();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function fitAllVisibleTerminals(): void {
  if (!activeWorktreeId) return;
  const shellEntry = terminals.get(activeWorktreeId);
  if (shellEntry) {
    shellEntry.fit.fit();
    window.api.resizeTerminal(activeWorktreeId, shellEntry.term.cols, shellEntry.term.rows);
  }
  const appEntry = appTerminals.get(activeWorktreeId);
  if (appEntry) {
    appEntry.fit.fit();
    window.api.resizeTerminal(`app-${activeWorktreeId}`, appEntry.term.cols, appEntry.term.rows);
  }
}

// ---- Setup ----

function showSetupPrompt(): void {
  $('setup-modal').classList.remove('hidden');
}

async function saveSetup(): Promise<void> {
  const config: any = {
    worktreeDir: ($('setup-worktree-dir') as HTMLInputElement).value.trim() || undefined,
    startScriptPath: ($('setup-start-script') as HTMLInputElement).value.trim() || undefined,
    setupScriptPath: ($('setup-setup-script') as HTMLInputElement).value.trim() || undefined,
    appCommand: ($('setup-app-command') as HTMLInputElement).value.trim() || undefined,
  };
  const argsStr = ($('setup-claude-args') as HTMLInputElement).value.trim();
  if (argsStr) config.defaultClaudeArgs = argsStr.split(/\s+/);

  // Save to repo config
  await window.api.setRepoConfig(repoPath, config);

  // Also update app config
  const appConfig = await window.api.getConfig();
  if (config.worktreeDir) { appConfig.worktreeDir = config.worktreeDir; worktreeDir = config.worktreeDir; }
  if (config.appCommand) { appConfig.appCommand = config.appCommand; appCommand = config.appCommand; }
  if (config.startScriptPath) appConfig.startScriptPath = config.startScriptPath;
  if (config.setupScriptPath) appConfig.setupScriptPath = config.setupScriptPath;
  if (config.defaultClaudeArgs) appConfig.defaultClaudeArgs = config.defaultClaudeArgs;
  await window.api.setConfig(appConfig);

  renderWorktreeDir();
  $('setup-modal').classList.add('hidden');
  showToast('Config saved to .madmux/config.yaml', 'success');
}

function renderWorktreeDir(): void {
  const el = $('worktree-dir-path');
  if (el) {
    el.textContent = worktreeDir || 'Not set';
    el.title = worktreeDir || '';
  }
}

async function loadWorktrees(): Promise<void> {
  if (!repoPath) return;
  const result = await window.api.listWorktrees(repoPath);
  if (result.error) { console.error(result.error); return; }
  worktrees = result.filter((w: WorktreeEntry) => !w.isBare);
  repoInfo.classList.remove('hidden');
  repoName.textContent = repoPath.split('/').pop() || repoPath;
  btnAddWorktree.disabled = false;
  selectedWorktrees.clear();
  renderWorktreeList();
  updateMultiSelectBar();
  if (worktrees.length > 0 && !activeWorktreeId) selectWorktree(worktrees[0].id);
}

function updateMultiSelectBar(): void {
  const bar = $('multi-select-bar');
  const deletable = worktrees.filter(w => !w.isMain);
  if (!selectMode || deletable.length === 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('selected-count').textContent = `${selectedWorktrees.size} selected`;
  ($('btn-delete-selected') as HTMLButtonElement).disabled = selectedWorktrees.size === 0;
  ($('select-all') as HTMLInputElement).checked = selectedWorktrees.size === deletable.length && deletable.length > 0;
  ($('select-all') as HTMLInputElement).indeterminate = selectedWorktrees.size > 0 && selectedWorktrees.size < deletable.length;
}

function renderWorktreeList(): void {
  sidebarList.innerHTML = '';
  for (const wt of worktrees) {
    const item = document.createElement('div');
    item.className = 'worktree-item' + (wt.id === activeWorktreeId ? ' active' : '');
    if (claudeActive.has(wt.id)) item.classList.add('has-notification');

    const statusClass = wt.status === 'clean' ? 'clean' : 'dirty';
    const isSelected = selectedWorktrees.has(wt.id);

    item.innerHTML = `
      ${selectMode && !wt.isMain ? `<input type="checkbox" class="wt-checkbox" ${isSelected ? 'checked' : ''}>` : ''}
      <div class="wt-content">
        <div class="wt-branch">
          <svg class="branch-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6.5a2.5 2.5 0 01-2.5 2.5H7.5a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 018 7h2.5a1 1 0 001-1v-1.128A2.251 2.251 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM4.25 2.5a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
          </svg>
          <span>${escapeHtml(wt.branch)}</span>
          ${claudeActive.has(wt.id) ? '<span class="wt-claude-indicator" title="Claude active"></span>' : ''}
        </div>
        <div class="wt-meta">
          <span class="wt-status ${statusClass}">${wt.status || 'unknown'}</span>
          <span>${escapeHtml(wt.path.split('/').pop() || '')}</span>
        </div>
      </div>
      ${!wt.isMain ? '<button class="wt-remove" title="Remove worktree">&times;</button>' : ''}
    `;

    const checkbox = item.querySelector('.wt-checkbox') as HTMLInputElement | null;
    if (checkbox) {
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        if (checkbox.checked) selectedWorktrees.add(wt.id);
        else selectedWorktrees.delete(wt.id);
        updateMultiSelectBar();
      });
    }

    item.querySelector('.wt-content')?.addEventListener('click', () => selectWorktree(wt.id));

    const removeBtn = item.querySelector('.wt-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showDeleteModal(wt);
      });
    }

    sidebarList.appendChild(item);
  }
}

async function selectWorktree(worktreeId: string): Promise<void> {
  const wt = worktrees.find((w) => w.id === worktreeId);
  if (!wt) return;

  activeWorktreeId = worktreeId;
  settingsPanel.classList.add('hidden');
  emptyState.classList.add('hidden');
  terminalArea.classList.remove('hidden');

  activeBranch.textContent = wt.branch;
  activePath.textContent = wt.path;
  updateStatusbar(wt);
  renderWorktreeList();

  // Show both terminals side by side
  showBothTerminals(worktreeId, wt.path);
}

function showBothTerminals(worktreeId: string, worktreePath: string): void {
  // Shell terminal
  hideAllChildren(terminalContainer);
  if (!terminals.has(worktreeId)) {
    createTerminalInContainer(worktreeId, worktreePath, 'shell');
  } else {
    showTerminal(worktreeId, 'shell');
  }

  // App terminal
  hideAllChildren(appTerminalContainer);
  if (!appTerminals.has(worktreeId)) {
    createTerminalInContainer(worktreeId, worktreePath, 'app');
  } else {
    showTerminal(worktreeId, 'app');
  }
}

function hideAllChildren(container: HTMLElement): void {
  for (const child of Array.from(container.children)) {
    (child as HTMLElement).style.display = 'none';
  }
}

function showTerminal(worktreeId: string, type: 'shell' | 'app'): void {
  const prefix = type === 'app' ? 'appterm' : 'term';
  const el = document.getElementById(`${prefix}-${worktreeId}`);
  if (el) {
    el.style.display = 'block';
    const map = type === 'app' ? appTerminals : terminals;
    const entry = map.get(worktreeId);
    if (entry) {
      requestAnimationFrame(() => {
        entry.fit.fit();
        entry.term.focus();
      });
    }
  }
}

async function createTerminalInContainer(worktreeId: string, worktreePath: string, type: 'shell' | 'app'): Promise<void> {
  const container = type === 'app' ? appTerminalContainer : terminalContainer;
  const map = type === 'app' ? appTerminals : terminals;
  const prefix = type === 'app' ? 'appterm' : 'term';

  const termEl = document.createElement('div');
  termEl.id = `${prefix}-${worktreeId}`;
  termEl.style.height = '100%';
  container.appendChild(termEl);

  const termTheme = buildTermTheme();
  const term = new Terminal({
    theme: termTheme,
    fontFamily: theme?.fontFamily || 'JetBrains Mono, Menlo, monospace',
    fontSize: theme?.fontSize || 14,
    cursorBlink: true,
    cursorStyle: 'bar',
    allowProposedApi: true,
    macOptionIsMeta: true,
    scrollback: 10000,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.open(termEl);
  requestAnimationFrame(() => { fitAddon.fit(); term.focus(); });

  const ptyId = type === 'app' ? `app-${worktreeId}` : worktreeId;
  term.onData((data) => window.api.writeTerminal(ptyId, data));
  map.set(worktreeId, { term, fit: fitAddon });

  if (type === 'app') {
    await window.api.createAppTerminal(worktreeId, worktreePath, appCommand);
  } else {
    await window.api.createTerminal(worktreeId, worktreePath);
  }
  window.api.resizeTerminal(ptyId, term.cols, term.rows);
}

function buildTermTheme(): any {
  const t: any = {
    background: theme?.background || '#1a1b26',
    foreground: theme?.foreground || '#c0caf5',
    cursor: theme?.cursorColor || '#c0caf5',
    selectionBackground: theme?.selectionBackground || '#33384d',
    selectionForeground: theme?.selectionForeground || undefined,
  };
  if (theme?.palette && theme.palette.length >= 16) {
    const names = ['black','red','green','yellow','blue','magenta','cyan','white',
      'brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite'];
    names.forEach((n, i) => t[n] = theme.palette[i]);
  }
  return t;
}

function updateStatusbar(wt: WorktreeEntry): void {
  $('status-branch').textContent = wt.branch;
  const ds = wt.diffStats;
  if (ds) {
    $('status-files').textContent = ds.changedFiles > 0 ? `${ds.changedFiles} file${ds.changedFiles !== 1 ? 's' : ''}` : '';
    $('status-additions').textContent = ds.additions > 0 ? `+${ds.additions}` : '';
    $('status-deletions').textContent = ds.deletions > 0 ? `-${ds.deletions}` : '';
  } else {
    $('status-files').textContent = '';
    $('status-additions').textContent = '';
    $('status-deletions').textContent = '';
  }
}

// ---- Delete handling ----

let deleteMode: 'single' | 'batch' = 'single';
let pendingDeleteWorktree: WorktreeEntry | null = null;

function showDeleteModal(wt: WorktreeEntry): void {
  deleteMode = 'single';
  pendingDeleteWorktree = wt;
  $('delete-title').textContent = 'Delete Worktree';
  $('delete-single-info').classList.remove('hidden');
  $('delete-batch-info').classList.add('hidden');
  $('delete-branch-name').textContent = wt.branch;
  $('delete-path-name').textContent = wt.path;
  (document.getElementById('delete-force') as HTMLInputElement).checked = false;
  (document.getElementById('delete-branch') as HTMLInputElement).checked = false;
  $('delete-modal').classList.remove('hidden');
}

function showBatchDeleteModal(): void {
  if (selectedWorktrees.size === 0) return;
  deleteMode = 'batch';
  $('delete-title').textContent = 'Delete Worktrees';
  $('delete-single-info').classList.add('hidden');
  $('delete-batch-info').classList.remove('hidden');
  $('delete-batch-count').textContent = String(selectedWorktrees.size);
  (document.getElementById('delete-force') as HTMLInputElement).checked = false;
  (document.getElementById('delete-branch') as HTMLInputElement).checked = false;
  $('delete-modal').classList.remove('hidden');
}

function confirmDelete(): void {
  const force = (document.getElementById('delete-force') as HTMLInputElement).checked;
  const delBranch = (document.getElementById('delete-branch') as HTMLInputElement).checked;

  $('delete-modal').classList.add('hidden');

  if (deleteMode === 'single' && pendingDeleteWorktree) {
    const wt = pendingDeleteWorktree;
    pendingDeleteWorktree = null;
    cleanupTerminals(wt.id);
    if (activeWorktreeId === wt.id) activeWorktreeId = null;
    worktrees = worktrees.filter(w => w.id !== wt.id);
    renderWorktreeList();

    const opts: any = {};
    if (force) opts.force = true;
    if (delBranch && !wt.isMain) opts.deleteBranch = wt.branch;
    window.api.removeWorktree(repoPath, wt.path, opts).then((result) => {
      if (result.error) showToast(`Failed to delete ${wt.branch}: ${result.error}`, 'error');
      else showToast(`Deleted worktree ${wt.branch}`, 'success');
      loadWorktrees();
    });
  } else if (deleteMode === 'batch') {
    const toDelete = worktrees.filter(w => selectedWorktrees.has(w.id) && !w.isMain);
    const count = toDelete.length;
    const items = toDelete.map(w => ({ path: w.path, branch: delBranch ? w.branch : undefined, force }));

    for (const w of toDelete) {
      cleanupTerminals(w.id);
      if (activeWorktreeId === w.id) activeWorktreeId = null;
    }
    worktrees = worktrees.filter(w => !selectedWorktrees.has(w.id) || w.isMain);
    selectedWorktrees.clear();
    renderWorktreeList();
    updateMultiSelectBar();

    window.api.removeWorktreeBatch(repoPath, items).then((results) => {
      const failures = results.filter((r: any) => !r.success);
      if (failures.length > 0) showToast(`Failed to delete ${failures.length} of ${count} worktrees`, 'error');
      else showToast(`Deleted ${count} worktree${count !== 1 ? 's' : ''}`, 'success');
      loadWorktrees();
    });
  }

  pendingDeleteWorktree = null;
  selectedWorktrees.clear();
  selectMode = false;
  $('btn-select-mode').classList.remove('active');
  updateMultiSelectBar();
}

function showToast(message: string, type: 'success' | 'error' = 'success'): void {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

async function cleanupTerminals(worktreeId: string): Promise<void> {
  if (terminals.has(worktreeId)) {
    await window.api.destroyTerminal(worktreeId);
    terminals.get(worktreeId)!.term.dispose();
    terminals.delete(worktreeId);
    document.getElementById(`term-${worktreeId}`)?.remove();
  }
  if (appTerminals.has(worktreeId)) {
    await window.api.destroyTerminal(`app-${worktreeId}`);
    appTerminals.get(worktreeId)!.term.dispose();
    appTerminals.delete(worktreeId);
    document.getElementById(`appterm-${worktreeId}`)?.remove();
  }
}

// ---- Add worktree ----

function showAddModal(): void {
  (document.getElementById('add-branch') as HTMLInputElement).value = '';
  (document.getElementById('add-path') as HTMLInputElement).value = '';
  (document.getElementById('add-create-branch') as HTMLInputElement).checked = true;
  $('add-modal').classList.remove('hidden');
  (document.getElementById('add-branch') as HTMLInputElement).focus();
}

async function confirmAddWorktree(): Promise<void> {
  const branch = (document.getElementById('add-branch') as HTMLInputElement).value.trim();
  if (!branch) return;
  let wtPath = (document.getElementById('add-path') as HTMLInputElement).value.trim();
  const createBranch = (document.getElementById('add-create-branch') as HTMLInputElement).checked;
  if (!wtPath) {
    const safeBranch = branch.replace(/\//g, '-');
    const repoName = repoPath.split('/').pop() || 'repo';
    wtPath = worktreeDir ? `${worktreeDir}/${repoName}-${safeBranch}` : `${repoPath.split('/').slice(0, -1).join('/')}/${repoName}-${safeBranch}`;
  }
  const result = await window.api.addWorktree(repoPath, wtPath, branch, createBranch);
  if (result.error) { alert(`Failed: ${result.error}`); return; }
  $('add-modal').classList.add('hidden');
  await loadWorktrees();
  selectWorktree(result.id);
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
