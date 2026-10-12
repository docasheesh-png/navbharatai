// AUTOPSY 303e8a6f (2026-10-12) — the heal census found while fixing item F. `isSelfHeal` counts a row as a repair
// whenever it is WARNING + closed and its code is not a known workaround or not-a-repair: a DENY-list, so every new
// code recorded warning + closed was a "heal" by default. The user's own Stop was one; a census of every such record
// site then found eight more that repaired nothing — a skipped template, a refused Claude call, two lanes that
// handed off uncompiled code, a rollback, a plan that overran its budget, a lopsided grounding block, a misread
// ladder setting — and one (a held verdict) that is not a finding at all. Each verdict was checked by a second,
// adversarial reviewer.
//
// The CLASS: a heal count that is a default rather than a decision. Now every code recorded WARNING with
// `autoResolved: true` must be listed in exactly one of REPAIR_CODES, WORKAROUND_CODES or NOT_A_REPAIR_CODES —
// guilty until listed — and HEAL_RULE 3 corrects older stored reports without counting a row twice.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isSelfHeal, isWorkaroundIssue, isLeftOpen, healCountOf, workaroundCountOf, HEAL_RULE, REPAIR_CODES, WORKAROUND_CODES, NOT_A_REPAIR_CODES } from '../src/lib/healIssue';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const ROOT = join(__dirname, '..');
const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) out.push(p);
  }
  return out;
};
const objectAt = (src: string, open: number): string => {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return '';
};

/** Every `.record({ … severity: 'warning' … autoResolved: true … code: 'X' … })` with a literal code. */
function closedWarningCodes(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of [...walk(join(ROOT, 'src/server')), join(ROOT, 'server.ts')]) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\.record\(\s*\{/g)) {
      const obj = objectAt(src, src.indexOf('{', m.index!));
      if (!/severity:\s*'warning'/.test(obj) || !/autoResolved:\s*true\b/.test(obj)) continue;
      const code = /code:\s*'([A-Z0-9_]+)'/.exec(obj)?.[1];
      if (!code) continue;
      const where = `${f.slice(ROOT.length + 1)}:${src.slice(0, m.index).split('\n').length}`;
      out.set(code, [...(out.get(code) ?? []), where]);
    }
  }
  return out;
}

describe('1 · 🔒 census: a warning recorded closed is a decision, never a default', () => {
  const found = closedWarningCodes();

  it('the census is reading record sites', () => {
    expect(found.size).toBeGreaterThan(10);
  });

  it('every such code is listed in exactly one of repair / workaround / not-a-repair', () => {
    const unlisted: string[] = [];
    const twice: string[] = [];
    for (const [code, sites] of found) {
      const n = [REPAIR_CODES, WORKAROUND_CODES, NOT_A_REPAIR_CODES].filter((set) => set.has(code)).length;
      if (n === 0) unlisted.push(`${code} @ ${sites.join(', ')}`);
      if (n > 1) twice.push(code);
    }
    expect(unlisted).toEqual([]);
    expect(twice).toEqual([]);
  });

  it('the three lists never overlap', () => {
    for (const c of REPAIR_CODES) {
      expect(WORKAROUND_CODES.has(c), c).toBe(false);
      expect(NOT_A_REPAIR_CODES.has(c), c).toBe(false);
    }
    for (const c of WORKAROUND_CODES) expect(NOT_A_REPAIR_CODES.has(c), c).toBe(false);
  });
});

describe('2 · the census verdicts', () => {
  const row = (code: string) => ({ code, severity: 'warning' as const, autoResolved: true });

  it.each(['GOLDEN_SCAFFOLD_SKIPPED', 'NO_CLAUDE_BLOCKED', 'ONESHOT_VERIFY_FAILED', 'SIMPLE_BUILD_VERIFY_ERROR', 'GREEN_GUARD_RESTORED'])(
    'went around it — a workaround, never a heal: %s', (code) => {
      expect(isSelfHeal(row(code))).toBe(false);
      expect(isWorkaroundIssue(row(code))).toBe(true);
    });

  it.each(['FILE_BUDGET_EXCEEDED', 'GROUNDING_COST', 'TIER_LADDER'])('reported, never corrected — left open: %s', (code) => {
    expect(isSelfHeal(row(code))).toBe(false);
    expect(isLeftOpen(row(code))).toBe(true);
  });

  it.each(['DATA_LOSS_EVENT', 'REPAIR_OUT_OF_SCOPE', 'ZOMBIE_WRITE_REFUSED', 'DEP_RECONCILE_GUARDED', 'HTML_ENTRY_REPAIRED', 'DANGLING_STYLESHEET_IMPORT_REMOVED'])(
    'a real repair stays a heal: %s', (code) => {
      expect(isSelfHeal(row(code))).toBe(true);
      expect(isLeftOpen(row(code))).toBe(false);
    });

  it('a held verdict is information, so it is no heal at all', () => {
    const route = readFileSync(join(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/severity: 'info', code: 'VERDICT_HELD_BY_RUN'/);
  });

  it('a live report counts them by the current rule', () => {
    const d = new BuildDiagnostics();
    d.record({ phase: 'build', severity: 'warning', code: 'GOLDEN_SCAFFOLD_SKIPPED', message: 'not seeded', autoResolved: true });
    d.record({ phase: 'plan', severity: 'warning', code: 'FILE_BUDGET_EXCEEDED', message: 'over budget', autoResolved: true });
    d.record({ phase: 'build', severity: 'warning', code: 'HTML_ENTRY_REPAIRED', message: 'fixed the entry', autoResolved: true });
    expect(d.report().counts).toMatchObject({ autoResolved: 1, workarounds: 1, healRule: HEAL_RULE });
  });
});

describe('3 · older stored reports are corrected once, by the rule they were written with', () => {
  const issues = [
    { code: 'GOLDEN_SCAFFOLD_SKIPPED', severity: 'warning' as const, autoResolved: true },
    { code: 'FILE_BUDGET_EXCEEDED', severity: 'warning' as const, autoResolved: true },
    { code: 'READINESS_WARNING', severity: 'warning' as const, autoResolved: true },
    { code: 'HTML_ENTRY_REPAIRED', severity: 'warning' as const, autoResolved: true },
  ];

  it('a rule-2 report counted the two reclassified rows as heals (READINESS_WARNING was already excluded)', () => {
    expect(healCountOf({ counts: { autoResolved: 3, healRule: 2 }, issues })).toBe(1);
    expect(workaroundCountOf({ counts: { workarounds: 0, healRule: 2 }, issues })).toBe(1);
  });

  it('a report from before rule 2 counted all three non-repairs — each is subtracted exactly once', () => {
    expect(healCountOf({ counts: { autoResolved: 4 }, issues })).toBe(1);
  });

  it('a current report is taken as written', () => {
    expect(healCountOf({ counts: { autoResolved: 1, healRule: HEAL_RULE }, issues })).toBe(1);
    expect(HEAL_RULE).toBe(3);
  });
});
