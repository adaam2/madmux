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
let activeTab: 'shell' | 'app' = 'shell';
const terminals: Map<string, { term: Terminal; fit: FitAddon }> = new Map();
const appTerminals: Map<string, { term: Terminal; fit: FitAddon }> = new Map();
const claudeActive: Set<string> = new Set();
const selectedWorktrees: Set<string> = new Set();

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
  }
  renderWorktreeDir();

  setupEventListeners();
  setupTerminalDataListener();
  setupMenuListeners();
}

function applyTheme(t: any): void {
  if (!t) return;
  document.documentElement.style.setProperty('--bg-primary', t.background);
  document.documentElement.style.setProperty('--fg-primary', t.foreground);
}

function setupMenuListeners(): void {
  window.api.onMenuSettings(() => toggleSettings());
  window.api.onMenuRepoOpened(async (path) => {
    repoPath = path;
    await loadWorktrees();
    const config = await window.api.getConfig();
    if (!config.worktreeConfigs?.[worktrees[0]?.id]?.postOpenScript && !config.defaultPostOpenScript) {
      showSetupPrompt();
    }
  });
  window.api.onMenuWorktreeDirChanged((dir) => {
    worktreeDir = dir;
    renderWorktreeDir();
  });
}

function setupEventListeners(): void {
  btnAddWorktree.addEventListener('click', showAddModal);
  $('btn-worktree-dir').addEventListener('click', async () => {
    // Handled by native menu now, but keep as quick-access
    const config = await window.api.getConfig();
    worktreeDir = config.worktreeDir || '';
    renderWorktreeDir();
  });

  // Setup button
  $('btn-setup').addEventListener('click', () => showSetupPrompt());

  // Tab switching
  $('btn-tab-shell').addEventListener('click', () => switchTab('shell'));
  $('btn-tab-app').addEventListener('click', () => switchTab('app'));

  // Multi-select
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
  $('setup-run').addEventListener('click', runSetupSession);
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
  window.addEventListener('resize', () => {
    if (activeWorktreeId) {
      const entry = activeTab === 'shell' ? terminals.get(activeWorktreeId) : appTerminals.get(activeWorktreeId);
      if (entry) {
        entry.fit.fit();
        const id = activeTab === 'shell' ? activeWorktreeId : `app-${activeWorktreeId}`;
        window.api.resizeTerminal(id, entry.term.cols, entry.term.rows);
      }
    }
  });

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
    config.defaultPostOpenScript = ($('setting-post-open') as HTMLInputElement).value.trim() || undefined;
    const argsStr = ($('setting-claude-args') as HTMLInputElement).value.trim();
    config.defaultClaudeArgs = argsStr ? argsStr.split(/\s+/) : undefined;
    await window.api.setConfig(config);
    worktreeDir = config.worktreeDir;
    appCommand = config.appCommand || '';
    renderWorktreeDir();
  }, 500);

  ['setting-worktree-dir', 'setting-app-command', 'setting-post-open', 'setting-claude-args'].forEach(id => {
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
  ($('setting-post-open') as HTMLInputElement).value = config.defaultPostOpenScript || '';
  ($('setting-claude-args') as HTMLInputElement).value = (config.defaultClaudeArgs || []).join(' ');
}

function setupTerminalDataListener(): void {
  window.api.onTerminalData((worktreeId: string, data: string) => {
    // Route to correct terminal map
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

function showSetupPrompt(): void {
  $('setup-modal').classList.remove('hidden');
}

async function runSetupSession(): Promise<void> {
  $('setup-modal').classList.add('hidden');
  const mainWt = worktrees.find(w => w.isMain) || worktrees[0];
  if (!mainWt) return;
  await selectWorktree(mainWt.id);
  setTimeout(() => {
    const prompt = [
      'Analyze this repository and help me create a setup script for new worktrees.',
      'Look at the project structure, package manager, build tools, environment files, and dependencies.',
      '', 'Then:',
      '1. Ask me any questions about my development workflow',
      '2. Create a setup script at .madagents/setup.sh',
      '', 'Make the script idempotent. Start by examining the repo.',
    ].join('\\n');
    window.api.writeTerminal(mainWt.id, `claude "${prompt}"\r`);
    claudeActive.add(mainWt.id);
    renderWorktreeList();
  }, 500);
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
  if (deletable.length === 0) { bar.classList.add('hidden'); return; }
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
      ${!wt.isMain ? `<input type="checkbox" class="wt-checkbox" ${isSelected ? 'checked' : ''}>` : '<span class="wt-checkbox-spacer"></span>'}
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

  // Show correct tab
  switchTab(activeTab);
}

function switchTab(tab: 'shell' | 'app'): void {
  activeTab = tab;
  $('btn-tab-shell').classList.toggle('active', tab === 'shell');
  $('btn-tab-app').classList.toggle('active', tab === 'app');

  terminalContainer.classList.toggle('hidden', tab !== 'shell');
  appTerminalContainer.classList.toggle('hidden', tab !== 'app');

  if (!activeWorktreeId) return;
  const wt = worktrees.find(w => w.id === activeWorktreeId);
  if (!wt) return;

  if (tab === 'shell') {
    hideAllChildren(terminalContainer);
    if (!terminals.has(activeWorktreeId)) {
      createTerminalInContainer(activeWorktreeId, wt.path, 'shell');
    } else {
      showTerminal(activeWorktreeId, 'shell');
    }
  } else {
    hideAllChildren(appTerminalContainer);
    if (!appTerminals.has(activeWorktreeId)) {
      createTerminalInContainer(activeWorktreeId, wt.path, 'app');
    } else {
      showTerminal(activeWorktreeId, 'app');
    }
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
    if (entry) { entry.fit.fit(); entry.term.focus(); }
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

  // Close modal immediately
  $('delete-modal').classList.add('hidden');

  if (deleteMode === 'single' && pendingDeleteWorktree) {
    const wt = pendingDeleteWorktree;
    pendingDeleteWorktree = null;
    // Clean up terminals synchronously (local state only), fire off delete
    cleanupTerminals(wt.id);
    if (activeWorktreeId === wt.id) activeWorktreeId = null;
    // Remove from local list immediately
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

    // Clean up terminals and local state immediately
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
}

function showToast(message: string, type: 'success' | 'error' = 'success'): void {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
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
