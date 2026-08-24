import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, dirname, relative, normalize, extname } from 'path';

/**
 * 🔒 THE TRIPWIRE FOR THE 2026-08-24 CLEANUP.
 *
 * #2632 deleted 252 files and 15,781 lines that nothing ran — an entire abandoned build engine and
 * the subsystems only it reached. Six months of that accumulating is how it got there in the first
 * place, so this test exists to make the next one impossible to accumulate silently: it rebuilds the
 * import graph from the app's real entry points and fails when a source file is reachable from none
 * of them.
 *
 * THE THREE FALSE-POSITIVE CLASSES THAT NEARLY CAUSED REAL DAMAGE — all encoded below, because each
 * of them would have deleted working code if the first scan had been trusted:
 *
 *  1. TOOLING SCRIPTS ARE ENTRY POINTS. Walking only from `src/main.tsx` and `server.ts` marked the
 *     whole QualityEvaluationEngine and PreviewRunner dead — 24 files that `scripts/quality-gate.ts`
 *     and `scripts/agentv3-bakeoff.ts` genuinely use.
 *  2. `import 'x';` WITH NO `from` IS STILL AN IMPORT. `routes/agentv3.ts` registers the Vercel,
 *     Netlify and Cloudflare deploy providers exactly that way. A from-only pattern called all three
 *     dead, and deleting them would have broken deploy paths whose tokens are live in production.
 *  3. AMBIENT `.d.ts` FILES ARE LOADED BY tsc WITHOUT AN IMPORT, so no graph can see them.
 *     `src/declarations.d.ts` is 622 lines and deleting it breaks the build outright.
 */

const ROOT = resolve(__dirname, '..');
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

/** Matches `from '...'`, `import('...')`, `require('...')` AND bare `import '...';` — see class 2. */
const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](\.[^'"]*)['"]/g;

function resolveSpec(spec: string, from: string): string | null {
  const base = normalize(join(dirname(from), spec));
  const cands = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => join(base, 'index' + e))];
  for (const c of cands) if (existsSync(join(ROOT, c)) && statSync(join(ROOT, c)).isFile()) return c;
  return null;
}

function walkDir(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walkDir(rel, out);
    else if (EXTS.includes(extname(rel))) out.push(rel);
  }
  return out;
}

function entryPoints(): string[] {
  const entries = ['src/main.tsx', 'server.ts'];
  // Class 1: every tooling script that reaches into src/ keeps its dependencies alive.
  for (const f of readdirSync(join(ROOT, 'scripts'))) {
    const p = `scripts/${f}`;
    if (EXTS.includes(extname(p)) && statSync(join(ROOT, p)).isFile()) entries.push(p);
  }
  return entries;
}

function reachable(): Set<string> {
  const seen = new Set<string>();
  const stack = entryPoints();
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f) || !existsSync(join(ROOT, f))) continue;
    seen.add(f);
    if (!EXTS.includes(extname(f))) continue;
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const r = resolveSpec(m[1], f);
      if (r) stack.push(r);
    }
  }
  return seen;
}

const isTest = (p: string) => p.includes('.test.') || p.includes('.spec.');

/**
 * Unreachable today, and knowingly kept. Each entry states WHY, because an allowlist without reasons
 * becomes a place to hide the next dead engine.
 */
const KNOWN_UNREACHABLE = new Set([
  // Five tests of LIVE template providers import this. Deleting it means editing five tests that
  // cover working code — a worse trade than keeping the file.
  'src/server/AgentV3/FrameworkRegistry.ts',
  // scripts/loadTest.mjs runs this logic INLINE and names this file as its unit-tested source, so
  // its test is the only coverage the running logic has.
  'src/server/lib/loadTestStats.ts',
  // (The unused UI kit that sat here — Badge, Card, Tabs, Tooltip, Drawer, BottomSheet and the
  // barrel — was removed on 2026-08-24 once its two tests were trimmed of the dead cases. The
  // allowlist is meant to shrink; the staleness test below is what keeps it honest.)
]);

describe('dead-code guard — every source file must be reachable from a real entry point', () => {
  const live = reachable();

  it('has entry points that actually resolve (a broken walk would pass this suite vacuously)', () => {
    // Without this, a typo in an entry path would make EVERYTHING unreachable — or, worse, make the
    // walk tiny and the allowlist appear to cover it.
    expect(live.has('src/main.tsx')).toBe(true);
    expect(live.has('server.ts')).toBe(true);
    expect(live.size).toBeGreaterThan(1000);
  });

  it('resolves bare side-effect imports (the deploy providers register that way)', () => {
    for (const p of ['src/server/AgentV3/VercelProvider.ts',
                     'src/server/AgentV3/NetlifyProvider.ts',
                     'src/server/AgentV3/CloudflareProvider.ts']) {
      expect(live.has(p), `${p} must be reachable — routes/agentv3.ts imports it for its side effect`).toBe(true);
    }
  });

  it('counts tooling scripts as entry points (quality-gate keeps a whole subsystem alive)', () => {
    expect(live.has('src/server/QualityEvaluationEngine/QualityEvaluationEngine.ts')).toBe(true);
    expect(live.has('src/server/AgentV3/BakeoffMetrics.ts')).toBe(true);
  });

  it('no NEW unreachable source file has appeared', () => {
    const orphans = walkDir('src')
      .filter((p) => !isTest(p))
      .filter((p) => !p.endsWith('.d.ts'))   // class 3: tsc loads these without an import
      .filter((p) => !live.has(p))
      .filter((p) => !KNOWN_UNREACHABLE.has(p));
    expect(
      orphans,
      `Unreachable from src/main.tsx, server.ts and every tooling script:\n${orphans.join('\n')}\n\n` +
      `Either wire it up, delete it, or add it to KNOWN_UNREACHABLE with the reason it stays.`,
    ).toEqual([]);
  });

  it('the allowlist does not outlive its entries', () => {
    // An allowlist entry for a file that no longer exists is a stale exemption that would silently
    // cover a future file of the same name.
    for (const p of KNOWN_UNREACHABLE) {
      expect(existsSync(join(ROOT, p)), `${p} is allowlisted but does not exist — drop the entry`).toBe(true);
    }
  });
});
