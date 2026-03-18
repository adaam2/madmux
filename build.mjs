import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

// Bundle the renderer (needs xterm bundled in)
await esbuild.build({
  entryPoints: ['src/renderer/renderer.ts'],
  bundle: true,
  outfile: 'dist/renderer/renderer.js',
  platform: 'browser',
  target: 'chrome120',
  format: 'iife',
  sourcemap: true,
  loader: { '.ts': 'ts' },
});

// Copy static files to dist
const staticFiles = [
  ['src/renderer/index.html', 'dist/renderer/index.html'],
  ['src/renderer/styles.css', 'dist/renderer/styles.css'],
];

for (const [src, dest] of staticFiles) {
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, dest);
}

// Copy xterm CSS
const xtermCss = 'node_modules/@xterm/xterm/css/xterm.css';
const destCss = 'dist/renderer/xterm.css';
fs.copyFileSync(xtermCss, destCss);

console.log('Build complete.');
