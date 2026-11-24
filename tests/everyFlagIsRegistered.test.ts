/**
 * 🚩 EVERY AGENTV3 FLAG IS IN THE REGISTRY (S6, admin 2026-11-24: "aapke suggestion ke anusar"). 489 AGENTV3_* names are read
 * in server code and 276 of them were in no document, so a kill switch could only be found by reading code — and a stale
 * value in Cloud Run silently wins over a default nobody wrote down (CLAUDE.md: "an env value always beats a code default").
 * Class: a flag can be ADDED without being documented. This census fails the day a new AGENTV3_* name appears in server
 * code without an entry in docs/claude/ENV_REGISTRY.md. The baseline of today's undocumented names may only shrink.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const FLAG = /\bAGENTV3_[A-Z0-9_]+\b/g;

function serverFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) serverFiles(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}
const files = [join(ROOT, 'server.ts'), ...serverFiles(join(ROOT, 'src/server'))].filter((p) => existsSync(p));
const inCode = new Set<string>();
for (const f of files) for (const m of readFileSync(f, 'utf8').match(FLAG) ?? []) inCode.add(m);
const registry = readFileSync(join(ROOT, 'docs/claude/ENV_REGISTRY.md'), 'utf8');
const documented = (n: string) => new RegExp(`\\b${n}\\b`).test(registry);
const baseline = new Set<string>(JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/unregisteredFlagsBaseline.json'), 'utf8')).unregistered);

describe('every AGENTV3 flag read in server code is documented', () => {
  it('🔒 no NEW undocumented flag — document it in docs/claude/ENV_REGISTRY.md (name, default, what it switches)', () => {
    const fresh = [...inCode].filter((n) => !documented(n) && !baseline.has(n)).sort();
    expect(fresh, 'add these to docs/claude/ENV_REGISTRY.md').toEqual([]);
  });
  it('the baseline only shrinks: a name documented since, or no longer in code, must leave it', () => {
    const stale = [...baseline].filter((n) => documented(n) || !inCode.has(n)).sort();
    expect(stale, 'delete these from tests/fixtures/unregisteredFlagsBaseline.json').toEqual([]);
  });
  it('the census reads real code (it finds the flags this file names)', () => {
    expect(inCode.has('AGENTV3_GAME_COMPLETE_GATE')).toBe(true);
    expect(inCode.size).toBeGreaterThan(400);
  });
});
