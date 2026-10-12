#!/usr/bin/env node
// THE GAME KIT'S HISTORY (Q-863) — the hash of every version of every file a game recipe has ever written.
//
// `src/server/lib/gameKitHistory.ts` is what lets the dispatcher tell an UNTOUCHED older kit file (safe to bring
// up to date when newer kit code needs it) from a file somebody edited (never overwritten). It must hold the
// current kit too, so `tests/aKitFileFromAnOlderVersionIsRecognised.test.ts` fails the moment a game generator
// changes without its new output being recorded here.
//
//   node scripts/gameKitHistory.mjs              record the CURRENT kit — run this after changing any game generator
//   node scripts/gameKitHistory.mjs --backfill   also re-read every version on origin/main from git history
//                                                (needs the history back to 2026-08-10: git fetch --shallow-since=2026-08-01 origin main)
//
// Only ever ADDS hashes: a version that shipped once may still sit, untouched, in somebody's project.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const OUT = join(ROOT, 'src/server/lib/gameKitHistory.ts');
// Every module GAME_RECIPES (gameRecipeLayers.ts) draws on. The census test checks this list against it.
const GENERATORS = [
  'GameRuntimeGenerator', 'Game3DGenerator', 'GameControllerGenerator', 'GameSystemsGenerator',
  'GameVfxAudioGenerator', 'MelodyGenerator', 'GameShellGenerator',
].map((n) => `src/server/lib/${n}.ts`);

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Bundle one generator — read from the working tree, or from commit `rev` — and return every file each of its generate* functions writes. */
async function filesOf(entry, rev) {
  const read = (p) => (rev ? execFileSync('git', ['show', `${rev}:${p}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }) : readFileSync(join(ROOT, p), 'utf8'));
  const tmp = mkdtempSync(join(tmpdir(), 'kit-history-'));
  try {
    const outfile = join(tmp, 'gen.mjs');
    await build({
      stdin: { contents: read(entry), loader: 'ts', sourcefile: entry, resolveDir: ROOT },
      bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent',
      plugins: [{
        name: 'at-rev',
        setup(b) {
          b.onResolve({ filter: /^\.\.?\// }, (a) => {
            const from = a.importer && a.importer !== '<stdin>' ? posix.dirname(a.importer) : posix.dirname(entry);
            const base = posix.normalize(posix.join(from, a.path));
            for (const ext of ['', '.ts', '.tsx', '/index.ts']) {
              const p = base + ext;
              try { read(p); return { path: p, namespace: 'rev' }; } catch { /* next */ }
            }
            return { errors: [{ text: `cannot resolve ${a.path} from ${from}` }] };
          });
          b.onLoad({ filter: /.*/, namespace: 'rev' }, (a) => ({ contents: read(a.path), loader: a.path.endsWith('x') ? 'tsx' : 'ts', resolveDir: ROOT }));
        },
      }],
    });
    const mod = await import(pathToFileURL(outfile).href);
    const out = [];
    for (const [name, fn] of Object.entries(mod)) {
      if (!/^generate/.test(name) || typeof fn !== 'function') continue;
      const r = fn();
      if (r && typeof r === 'object' && r.files && typeof r.files === 'object') out.push(...Object.entries(r.files));
    }
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function readHistory() {
  if (!existsSync(OUT)) return {};
  const m = /export const GAME_KIT_HISTORY[^=]*=\s*(\{[\s\S]*?\n\});/.exec(readFileSync(OUT, 'utf8'));
  return m ? JSON.parse(m[1]) : {};
}

const history = readHistory();
const before = Object.values(history).reduce((n, l) => n + l.length, 0);
const add = (path, content) => {
  if (typeof content !== 'string') return;
  const h = sha(content);
  const list = (history[path] ??= []);
  if (!list.includes(h)) list.push(h);
};

if (process.argv.includes('--backfill')) {
  const revs = execFileSync('git', ['log', '--format=%H', 'origin/main', '--', ...GENERATORS], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean).reverse();
  for (const rev of revs) {
    for (const g of GENERATORS) {
      try { execFileSync('git', ['cat-file', '-e', `${rev}:${g}`], { cwd: ROOT, stdio: 'ignore' }); } catch { continue; }
      try { for (const [p, c] of await filesOf(g, rev)) add(p, c); }
      catch (e) { console.error(`skip ${rev.slice(0, 9)} ${g}: ${e.message?.split('\n')[0]}`); }
    }
  }
  console.log(`read ${revs.length} commits`);
}
for (const g of GENERATORS) for (const [p, c] of await filesOf(g, null)) add(p, c);

const sorted = Object.fromEntries(Object.keys(history).sort().map((k) => [k, history[k]]));
const after = Object.values(sorted).reduce((n, l) => n + l.length, 0);
writeFileSync(OUT, `// GENERATED by \`node scripts/gameKitHistory.mjs\` — do not edit by hand. Run it after changing any game generator.
//
// THE GAME KIT'S HISTORY (Q-863). path → the sha256 of every version of that file a game recipe has ever written,
// oldest first. A file whose bytes hash to one of these is untouched NavBharatAI kit code; anything else is
// somebody's edit, and is never overwritten. Only ever grows: a version that shipped once may still sit in a project.
export const GAME_KIT_HISTORY: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(sorted, null, 2)};
`);
console.log(`${Object.keys(sorted).length} paths · ${after} versions (${after - before} new)`);
