// THE SHIM THAT MAKES THINGS WORSE — `declare module 'x'` in a file that also imports from 'x'.
//
// 🔒 ROOT CAUSE (admin APK build report 2026-08-24). A user's Next.js build died on:
//
//     ./playwright.config.ts:3:16
//     Type error: Cannot redeclare block-scoped variable 'devices'.
//
//       1 | declare module '@playwright/test' {
//       2 |   export function defineConfig(config: any): any;
//       3 |   export const devices: Record<string, any>;
//       4 | }
//       6 | import { defineConfig, devices } from '@playwright/test';
//
// The original error was `Cannot find module '@playwright/test'` — the package genuinely was not
// installed. Someone answered it by declaring the module's types by hand at the top of the very file
// that imports it. That is a textbook surface patch, and it does not even hold: a file containing an
// import is a MODULE, so `declare module 'x'` inside it is an AUGMENTATION of 'x' — and the names it
// exports land in the same scope as the import's bindings. `devices` is now declared twice. The
// symptom moved and the app stopped building entirely.
//
// 🔑 WHY REMOVING THE BLOCK IS ALWAYS RIGHT, never a judgement call. There are exactly two states:
// the real types are present, in which case the shim was redundant and deleting it changes nothing;
// or they are absent, in which case deleting it restores the HONEST error — "Cannot find module" —
// which names the actual problem (install the package, or keep the file out of this build). Trading a
// misleading error for a true one is a strict improvement even when the file still does not compile.
//
// 🔒 WILDCARD DECLARATIONS ARE UNTOUCHABLE. `declare module '*.css'`, `'*.svg'`, `'*?raw'` are the
// standard, correct way to type non-code imports, and a file that imports './app.css' legitimately
// carries one. Only an EXACT module name that the same file also imports can produce this collision,
// so a pattern containing `*` is never a candidate. Getting this wrong would delete correct code from
// working apps, which is far worse than the bug being fixed.

export interface AmbientShimFinding {
  /** The file carrying the collision. */
  path: string;
  /** The module declared and imported at once, e.g. '@playwright/test'. */
  module: string;
}

/** Module specifiers this file imports from — `import … from 'x'`, bare `import 'x'`, `require('x')`. */
export function importedModules(source: string): Set<string> {
  const src = String(source ?? '');
  const out = new Set<string>();
  const patterns = [
    /\bimport\s[^;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s[^;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.add(m[1]);
  }
  return out;
}

/**
 * Every `declare module '<exact-name>'` in the source, with the byte range of its whole block.
 *
 * The end is found by matching braces rather than by a regex, because the body contains braces of its
 * own (`Record<string, any>` does not, but `interface X { … }` inside one certainly does) and a lazy
 * match to the first `}` would slice a file in half. Returns [] for anything it cannot bracket
 * cleanly — leaving a file alone is always available and always safe.
 */
export function ambientModuleBlocks(source: string): Array<{ module: string; start: number; end: number }> {
  const src = String(source ?? '');
  const out: Array<{ module: string; start: number; end: number }> = [];
  const re = /(^|\n)[ \t]*declare\s+module\s+['"]([^'"]+)['"]\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const module = m[2];
    if (module.includes('*')) continue;                    // a wildcard declaration is legitimate
    const start = m.index + (m[1] ? m[1].length : 0);
    const open = src.indexOf('{', m.index + m[0].length - 1);
    if (open === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end === -1) continue;                              // unbalanced — do not touch this file
    out.push({ module, start, end });
  }
  return out;
}

/**
 * Remove the ambient blocks that collide with this file's own imports. Returns the original string
 * when there is nothing to do, so callers can compare by identity and never write an unchanged file.
 */
export function stripCollidingAmbientShims(source: string): { source: string; removed: string[] } {
  const src = String(source ?? '');
  const imported = importedModules(src);
  const blocks = ambientModuleBlocks(src).filter((b) => imported.has(b.module));
  if (blocks.length === 0) return { source: src, removed: [] };
  // Back to front, so each removal leaves the earlier offsets valid.
  let out = src;
  for (const b of [...blocks].sort((a, z) => z.start - a.start)) {
    out = out.slice(0, b.start) + out.slice(b.end);
  }
  return { source: out.replace(/^\s*\n+/, '').replace(/\n{3,}/g, '\n\n'), removed: blocks.map((b) => b.module) };
}

/** Which files in the project carry the collision. PURE — the caller decides what to do about it. */
export function findAmbientShimCollisions(files: Record<string, string>): AmbientShimFinding[] {
  const out: AmbientShimFinding[] = [];
  for (const [path, content] of Object.entries(files ?? {})) {
    if (typeof content !== 'string') continue;
    if (!/\.(ts|tsx|mts|cts)$/i.test(path)) continue;       // only TypeScript can carry `declare module`
    if (!content.includes('declare module')) continue;      // cheap reject before any real work
    for (const m of stripCollidingAmbientShims(content).removed) out.push({ path, module: m });
  }
  return out;
}

/** The honest line for the build report. Names the file and what was actually wrong with it. */
export function ambientShimNote(findings: readonly AmbientShimFinding[]): string {
  const where = findings.map((f) => f.path).filter((p, i, a) => a.indexOf(p) === i).join(', ');
  return `Removed a hand-written type stub that was stopping your app from compiling (${where}). `
    + 'It declared a package that the same file also imports, which TypeScript rejects outright — '
    + 'the stub was hiding the real issue rather than fixing it.';
}
