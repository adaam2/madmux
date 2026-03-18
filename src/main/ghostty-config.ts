import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GhosttyTheme } from '../shared/types';

const DEFAULT_THEME: GhosttyTheme = {
  foreground: '#c5c8c6',
  background: '#1d1f21',
  cursorColor: '#c5c8c6',
  selectionBackground: '#373b41',
  selectionForeground: '#c5c8c6',
  palette: [
    '#1d1f21', '#cc6666', '#b5bd68', '#f0c674',
    '#81a2be', '#b294bb', '#8abeb7', '#c5c8c6',
    '#969896', '#cc6666', '#b5bd68', '#f0c674',
    '#81a2be', '#b294bb', '#8abeb7', '#ffffff',
  ],
  fontFamily: 'JetBrains Mono, Menlo, monospace',
  fontSize: 14,
};

function findGhosttyConfig(): string | null {
  const candidates = [
    path.join(os.homedir(), '.config', 'ghostty', 'config'),
    path.join(os.homedir(), 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function findGhosttyThemeFile(themeName: string): string | null {
  const candidates = [
    path.join(os.homedir(), '.config', 'ghostty', 'themes', themeName),
    path.join(os.homedir(), 'Library', 'Application Support', 'com.mitchellh.ghostty', 'themes', themeName),
    // Bundled themes location
    '/Applications/Ghostty.app/Contents/Resources/ghostty/themes/' + themeName,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function parseConfigFile(filePath: string): Record<string, string> {
  const config: Record<string, string> = {};
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      config[key] = value;
    }
  } catch {
    // ignore read errors
  }
  return config;
}

export function loadGhosttyTheme(): GhosttyTheme {
  const theme = { ...DEFAULT_THEME };
  const configPath = findGhosttyConfig();
  if (!configPath) return theme;

  let config = parseConfigFile(configPath);

  // If a theme is referenced, load and merge it
  if (config['theme']) {
    const themeFile = findGhosttyThemeFile(config['theme']);
    if (themeFile) {
      const themeConfig = parseConfigFile(themeFile);
      config = { ...themeConfig, ...config };
    }
  }

  if (config['foreground']) theme.foreground = config['foreground'];
  if (config['background']) theme.background = config['background'];
  if (config['cursor-color']) theme.cursorColor = config['cursor-color'];
  if (config['selection-background']) theme.selectionBackground = config['selection-background'];
  if (config['selection-foreground']) theme.selectionForeground = config['selection-foreground'];
  if (config['font-family']) theme.fontFamily = config['font-family'] + ', monospace';
  if (config['font-size']) theme.fontSize = parseInt(config['font-size'], 10) || 14;

  // Parse palette colors (ghostty uses palette = N=color format)
  const paletteEntries = Object.entries(config).filter(([k]) => k === 'palette');
  // Ghostty config can have multiple palette lines, but our parser only keeps last.
  // Re-parse to get all palette entries.
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('palette')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const value = trimmed.slice(eqIdx + 1).trim();
      // Format: N=#color or N=color
      const parts = value.split('=');
      if (parts.length === 2) {
        const idx = parseInt(parts[0].trim(), 10);
        const color = parts[1].trim();
        if (idx >= 0 && idx < 16) {
          theme.palette[idx] = color;
        }
      }
    }
  } catch {
    // ignore
  }

  return theme;
}
