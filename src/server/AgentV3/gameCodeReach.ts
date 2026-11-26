/**
 * 🎮 WHICH OF A GAME'S FILES ACTUALLY RUN (external Game Maker audit, 2026-11-25, adapted).
 *
 * The scope check counted a named feature as built when the source CONTAINED the kit call that does it — anywhere:
 * in a file nothing imports, in a helper nothing calls. A file that is never loaded is not the game. This walks the
 * project's own imports from its entry (index.html's module script, else src/main.*, src/index.*) and returns the
 * files the running game can reach. Relative paths, the `@/` alias for src/ and root-absolute `/src/...` paths are
 * followed; packages are not (they are not the game). Dynamic `import('./x')` counts — the kit loads rules.ts so.
 *
 * Static and conservative: reaching a file does not prove each function in it is called (only playing proves that
 * — see `playedFeatureEvidence` in gamePlaytest.ts). null when no entry is found: then reachability is not known,
 * and the caller must say so rather than guess. PURE.
 */

import { withoutComments } from '../lib/codeOnly';

const CODE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

function norm(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}

function resolve(spec: string, fromFile: string, files: Record<string, string>): string | null {
  let base: string;
  if (spec.startsWith('.')) base = norm(`${fromFile.split('/').slice(0, -1).join('/')}/${spec}`);
  else if (spec.startsWith('@/')) base = norm(`src/${spec.slice(2)}`);
  else if (spec.startsWith('/')) base = norm(spec);
  else return null; // a package: not the game's own code
  const stem = base.replace(/\.(m?js|jsx)$/, '');
  const tries = [base, ...CODE_EXT.map((e) => base + e), ...CODE_EXT.map((e) => stem + e), ...CODE_EXT.map((e) => `${base}/index${e}`)];
  for (const t of tries) if (typeof files[t] === 'string') return t;
  return null;
}

const IMPORT_RES: readonly RegExp[] = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** The entry files: index.html's module scripts, else the usual src/main.* / src/index.* names. PURE. */
export function gameEntryFiles(files: Record<string, string>): string[] {
  const out: string[] = [];
  const html = typeof files['index.html'] === 'string' ? files['index.html'] : '';
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const p = resolve(m[1].startsWith('.') || m[1].startsWith('/') ? m[1] : `./${m[1]}`, 'index.html', files);
    if (p && !out.includes(p)) out.push(p);
  }
  if (out.length) return out;
  for (const stem of ['src/main', 'src/index', 'main', 'index']) {
    for (const e of CODE_EXT) if (typeof files[stem + e] === 'string') { out.push(stem + e); break; }
    if (out.length) break;
  }
  return out;
}

/** Every file the running game can reach from its entry; null when no entry was found. PURE; never throws. */
export function reachableGameFiles(files: Record<string, string>): Set<string> | null {
  try {
    const entries = gameEntryFiles(files || {});
    if (!entries.length) return null;
    const seen = new Set<string>();
    const stack = [...entries];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const raw = files[f];
      if (typeof raw !== 'string' || /\.html?$/.test(f)) continue;
      const src = withoutComments(raw); // a commented-out import loads nothing
      for (const re of IMPORT_RES) {
        for (const m of src.matchAll(re)) {
          const t = resolve(m[1], f, files);
          if (t && !seen.has(t)) stack.push(t);
        }
      }
    }
    return seen;
  } catch { return null; }
}
