# madmux

Git worktree manager with integrated Claude sessions and terminal emulation.

Part of MadSuite.

## Features

- Manage git worktrees from a native macOS app
- Claude CLI session per worktree
- Customizable post-open setup scripts per worktree
- App terminal pane per worktree (for dev servers, etc.)
- Reads Ghostty terminal config for theming (fonts, colors, palette)
- Multi-select and batch delete worktrees
- Statusbar with git diff stats (additions/deletions/changed files)
- Config persisted to `.madmux/config.yaml` in repo root
- VS Code-style settings GUI

## Getting Started

```bash
npm install
npm run build
npm start
```

## Usage

1. **Open Repository** — File > Open Repository (Cmd+O)
2. **Create Worktree** — Click the + button or Cmd+N
3. **Setup** — Click the setup button to have Claude generate a setup script
4. **Switch Worktrees** — Click in the sidebar or use Cmd+1-9
5. **App Terminal** — Switch to the App tab to run dev servers
6. **Settings** — App > Settings (Cmd+,) or `.madmux/config.yaml`
