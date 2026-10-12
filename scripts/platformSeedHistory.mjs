#!/usr/bin/env node
// THE PLATFORM'S SEED HISTORY (db07e0af) — the hash of every version of every file NavBharatAI itself writes into a
// workspace: every framework starter and every starter chip's tested template.
//
// `src/server/AgentV3/platformSeedHistory.ts` is what lets the engine recognise an UNTOUCHED older copy of our own
// starter as ours. Before it, "ours" meant byte-equal to TODAY's template, so every change to a template — the
// design kit above all — silently turned every workspace still holding the previous starter into "the user's
// app": edits instead of builds, our code graded as theirs, "Banao" built instead of asked about.
//
//   node scripts/platformSeedHistory.mjs              record the CURRENT templates — run after changing any of them
//   node scripts/platformSeedHistory.mjs --backfill   also re-read every version on origin/main from git history
//
// Only ever ADDS hashes. Content is normalised the way starterFragment.sameFile compares it (CRLF -> LF, trimmed), and a
// tsconfig is recorded in both its seeded forms (loose, and strict for a workspace in the strict trial — strictTrial.ts).
// Two sources, kept apart because two readers ask different questions: `starter` (the framework starter every sandbox
// is seeded with) and `golden` (a starter chip's tested template).
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const OUT = join(ROOT, 'src/server/AgentV3/platformSeedHistory.ts');
const DIRS = ['src/server/AgentV3/sandbox/AppMakerLab/generator/templates/', 'src/server/AgentV3/goldenScaffolds/'];
const TEMPLATES = `import { TemplateRegistry } from './src/server/AgentV3/sandbox/AppMakerLab/generator/templates/TemplateRegistry';
const reg = new TemplateRegistry(); const out = [];
for (const k of reg.listFrameworks()) { try { out.push(reg.getProvider(k).getFiles([])); } catch (e) { /* skip */ } }
export default out;`;
const FORMS = `import { seededForms } from './src/server/AgentV3/strictTrial';
export default seededForms;`;
const GOLDEN = `import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from './src/server/AgentV3/goldenScaffolds/registry';
export default GOLDEN_SCAFFOLDS.map((g) => { try { return goldenScaffoldFiles(g); } catch (e) { return {}; } });`;

/** sha256 of the content as starterFragment compares it, truncated to 96 bits (a lookup key, not a signature). */
const seedHash = (s) => createHash('sha256').update(String(s).replace(/\r\n/g, '\n').trim(), 'utf8').digest('hex').slice(0, 24);

async function seedFiles(entry, rev) {
  const read = (p) => (rev ? execFileSync('git', ['show', `${rev}:${p}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }) : readFileSync(join(ROOT, p), 'utf8'));
  const tmp = mkdtempSync(join(tmpdir(), 'seed-history-'));
  try {
    const outfile = join(tmp, 'seed.mjs');
    await build({
      stdin: { contents: entry, loader: 'ts', sourcefile: 'entry.ts', resolveDir: ROOT },
      bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent',
      plugins: rev ? [{
        name: 'at-rev',
        setup(b) {
          b.onResolve({ filter: /^\.\.?\// }, (a) => {
            // A file loaded from the commit resolves next to itself; the entry resolves from the repository root.
            const from = a.namespace === 'rev' ? posix.dirname(a.importer) : '.';
            const base = posix.normalize(posix.join(from, a.path));
            for (const ext of ['', '.ts', '.tsx', '/index.ts', '.json']) {
              try { read(base + ext); return { path: base + ext, namespace: 'rev' }; } catch { /* next */ }
            }
            return { errors: [{ text: `cannot resolve ${a.path}` }] };
          });
          b.onLoad({ filter: /.*/, namespace: 'rev' }, (a) => ({ contents: read(a.path), loader: a.path.endsWith('.json') ? 'json' : a.path.endsWith('x') ? 'tsx' : 'ts', resolveDir: ROOT }));
        },
      }] : [],
    });
    const mod = await import(pathToFileURL(outfile).href);
    return mod.default ?? [];
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function readHistory() {
  if (!existsSync(OUT)) return { starter: {}, golden: {} };
  const m = /export const PLATFORM_SEED_HISTORY[^=]*=\s*(\{[\s\S]*\});/.exec(readFileSync(OUT, 'utf8'));
  const got = m ? JSON.parse(m[1]) : {};
  return { starter: got.starter ?? {}, golden: got.golden ?? {} };
}

const history = readHistory();
const count = (h) => Object.values(h).reduce((n, m) => n + Object.values(m).reduce((k, l) => k + l.length, 0), 0);
const before = count(history);
const seededForms = await seedFiles(FORMS, null);
const add = (source, sets) => {
  for (const files of sets) for (const [p, c] of Object.entries(files ?? {})) {
    if (typeof c !== 'string' || !c.trim()) continue;
    const key = p.replace(/\\/g, '/').replace(/^\.?\/+/, '');
    const list = (history[source][key] ??= []);
    for (const form of seededForms(key, c)) {
      const h = seedHash(form);
      if (!list.includes(h)) list.push(h);
    }
  }
};

if (process.argv.includes('--backfill')) {
  const revs = execFileSync('git', ['log', '--format=%H', 'origin/main', '--', ...DIRS], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean).reverse();
  let ok = 0;
  for (const rev of revs) {
    let got = false;
    for (const [source, entry] of [['starter', TEMPLATES], ['golden', GOLDEN]]) {
      try { add(source, await seedFiles(entry, rev)); got = true; } catch (e) { if (process.env.SEED_DEBUG) console.error(rev.slice(0, 9), String(e && e.message || e).split('\n').slice(0, 3).join(' | ')); }
    }
    if (got) ok++;
  }
  console.log(`read ${ok} of ${revs.length} commits`);
}
add('starter', await seedFiles(TEMPLATES, null));
add('golden', await seedFiles(GOLDEN, null));

const sortKeys = (h) => Object.fromEntries(Object.keys(h).sort().map((k) => [k, h[k]]));
const sorted = { starter: sortKeys(history.starter), golden: sortKeys(history.golden) };
const after = count(sorted);
writeFileSync(OUT, `// GENERATED by \`node scripts/platformSeedHistory.mjs\` — do not edit by hand. Run it after changing any starter template.
//
// THE PLATFORM'S SEED HISTORY (db07e0af). source → path → the first 96 bits of the sha256 of every version of that
// file a NavBharatAI framework starter (\`starter\`) or starter-chip template (\`golden\`) has ever written (normalised:
// CRLF → LF, trimmed; a tsconfig in both seeded forms), oldest first. An untouched older copy of our own starter is
// still ours; one changed byte makes it the user's. Only ever grows. Read through \`seedVersions.ts\`.
export const PLATFORM_SEED_HISTORY: Readonly<Record<'starter' | 'golden', Readonly<Record<string, readonly string[]>>>> = ${JSON.stringify(sorted)};
`);
console.log(`${Object.keys(sorted.starter).length} starter paths · ${Object.keys(sorted.golden).length} golden paths · ${after} versions (${after - before} new)`);
