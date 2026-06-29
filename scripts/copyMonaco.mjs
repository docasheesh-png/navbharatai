// Self-host the Monaco editor assets so the IDE editor loads from our OWN origin instead of a
// CDN. The CDN (cdn.jsdelivr.net) is unreachable behind some firewalls / CSP / regions, which
// left the editor stuck on "Loading editor…" forever (see fix #582). Serving Monaco's `min/vs`
// from `/monaco/vs` removes that external dependency entirely.
//
// This copies `node_modules/monaco-editor/min/vs` → `public/monaco/vs`. Vite copies `public/`
// into `dist/` at build, and the production server serves `dist/` statically, so the assets end
// up at `/monaco/vs` on the app's own origin. The folder is gitignored (16 MB, hundreds of files)
// and regenerated at build time from the installed package — never committed.
//
// Dependency-free (Node built-ins only). Idempotent: skips the copy when the destination already
// holds the installed Monaco version. Run via `npm run copy:monaco` (and automatically on
// predev / prebuild).

import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'node_modules', 'monaco-editor', 'package.json');
const src = join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
const destDir = join(root, 'public', 'monaco');
const dest = join(destDir, 'vs');
const marker = join(destDir, '.monaco-version');

if (!existsSync(src) || !existsSync(pkgPath)) {
  console.error(`[copyMonaco] monaco-editor not found at ${src} — run \`npm install\` first.`);
  process.exit(1);
}

const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;

// Idempotent: if we already copied this exact version, do nothing (keeps dev/build fast).
if (existsSync(marker) && existsSync(join(dest, 'loader.js')) && readFileSync(marker, 'utf8').trim() === version) {
  console.log(`[copyMonaco] monaco-editor@${version} already present at public/monaco/vs — skipping.`);
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
writeFileSync(marker, version + '\n');
console.log(`[copyMonaco] copied monaco-editor@${version} min/vs → public/monaco/vs`);
