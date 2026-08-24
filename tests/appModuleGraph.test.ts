import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * 🔒 NOTHING MAY IMPORT FROM `src/App.tsx`.
 *
 * WHY THIS RULE EXISTS (weight audit 2026-08-23, fixed 2026-08-24). `App.tsx` is the ROOT of the
 * client: it statically imports ~84 modules — AdminDashboard, GitPanel, Settings, Billing, Doctor AI,
 * the lot. It also happened to export a few conveniences (`auth`, `db`, `authedHeaders`, `safeLS`,
 * `sanitizeFirestoreData`, the GitHub-owner helpers), and 23 modules imported them from there.
 *
 * That made a CYCLE: any feature → `authedFetch` → `authHeaders` → `App.tsx` → all 84 modules. For a
 * bundler that reads as "these cannot be separated", which is why the app shipped as ONE 639 KB
 * gzipped chunk while 55 of its 92 "lazy" chunks were under 5 KB, and why an earlier attempt to split
 * it by hand made first paint ~170 KB WORSE (recorded in vite.config.ts) — splitting a cycle
 * duplicates the shared graph instead of dividing it.
 *
 * None of those symbols were ever CREATED in App.tsx: `auth`/`db` were re-exported from
 * `lib/firebase`, `sanitizeFirestoreData` from `lib/firestoreUtils`, and the rest were plain helpers
 * that only needed `localStorage` or `auth`. They now live in real modules.
 *
 * The rule is absolute rather than a lint on the old symbol names, because the failure mode is a NEW
 * convenience being added to App.tsx and re-imported "just this once" — which silently restores the
 * cycle and the monolith, with nothing failing to show it.
 */

const ROOT = resolve(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) sourceFiles(rel, out);
    else if (/\.(ts|tsx)$/.test(rel)) out.push(rel);
  }
  return out;
}

/**
 * A REAL import of the app root — `import … from '../App'`, `export … from './App'`, or a dynamic
 * `import('../../App')`. Anchored at the start of the line on purpose: this file and `lib/firebase.ts`
 * both QUOTE the old bad import inside comments explaining why it was removed, and a looser pattern
 * flagged that prose as a violation. The rule is about the module graph, not about the word.
 */
const ROOT_APP_IMPORT = /^\s*(?:import|export)\s[^;]*from\s+'(?:\.\.\/)*\.?\/?App'|import\s*\(\s*'(?:\.\.\/)*\.?\/?App'\s*\)/;

describe('module graph — the app root is a leaf, never a dependency', () => {
  it('no module imports from src/App.tsx', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      // App.tsx itself is exempt; server code never resolves to the client root (its `./App` strings
      // are scaffold TEMPLATES for generated apps, not imports of ours).
      if (file === 'src/App.tsx' || file.startsWith('src/server/')) continue;
      const src = readFileSync(join(ROOT, file), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (ROOT_APP_IMPORT.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(
      offenders,
      `These import from the app ROOT, which re-creates the bundle-splitting cycle:\n${offenders.join('\n')}\n\n` +
      `Put the symbol in a real module instead (lib/firebase, lib/authHeaders, lib/localStorageSafe, …).`,
    ).toEqual([]);
  });

  it('App.tsx exports only its component', () => {
    // The cycle came back the moment App.tsx offered something worth importing. A default-only export
    // surface is what keeps the rule above easy to obey.
    const src = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
    const exports = src.split('\n').filter((l) => /^export\b/.test(l)).map((l) => l.trim());
    expect(exports).toEqual(['export default function App() {']);
  });

  it('the moved helpers live in real modules and still work the same way', () => {
    // Not a formality: these are the exact symbols the 23 importers were repointed to, so a rename or
    // an accidental deletion during a later cleanup fails here rather than at someone's first paint.
    expect(readFileSync(join(ROOT, 'src/lib/authHeaders.ts'), 'utf8'))
      .toContain('export async function authedHeaders');
    expect(readFileSync(join(ROOT, 'src/lib/localStorageSafe.ts'), 'utf8'))
      .toMatch(/export const LS_EVICTABLE[\s\S]*export function safeLS/);
    const gh = readFileSync(join(ROOT, 'src/lib/githubTokenStore.ts'), 'utf8');
    for (const fn of ['rememberGithubOwner', 'clearGithubConnection', 'readGithubOwner']) {
      expect(gh).toContain(`export function ${fn}`);
    }
    // The storage key stays PRIVATE to that module — one place knows it, so no call site can drift
    // onto a near-miss spelling.
    expect(gh).not.toMatch(/export\s+const\s+GH_OWNER_KEY/);
  });

  it('authHeaders takes `auth` from lib/firebase — the line that caused all of this', () => {
    const src = readFileSync(join(ROOT, 'src/lib/authHeaders.ts'), 'utf8');
    expect(src).toContain("import { auth } from './firebase'");
  });
});
