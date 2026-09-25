/**
 * "JO RAH GAYA HAI KARO" — admin, 2026-09-24. The item PR #3298 named and did not do.
 *
 * That PR put the real population under the Builder scorecard and closed with: *"the heal tally is
 * one number with no breakdown — 6.49 per build, worst 86, and nothing says WHICH repairs fire."*
 * The 50/50 law's instruction is *"trace why the bug class exists and prevent it upstream"* — and a
 * rate names no class. This is the ranked list that does.
 *
 * 🔴 THE HARD PART IS NOT THE COUNTING, IT IS THE COMPLETENESS. `trimReportForStorage` caps `issues`
 * at 500 while `counts` keeps the build's REAL numbers, so the build with 86 heals — the biggest
 * contributor to the rate, and the one the list most needs to rank — is the likeliest to have had its
 * timeline trimmed. Presenting the visible codes as the whole list would be `reportTruncation.ts`'s
 * own bug in a new place, and that module already records this repo paying for it three times.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { summarizeHealCodes, MAX_CODES_PER_BUILD } from '../src/server/AgentV3/healBreakdown';
import { healBreakdown, builderScorecard, scorecardHeadline, HEAL_CODES_SHOWN, type BuildMetricInput } from '../src/lib/builderMetrics';
import { toMetricInput } from '../src/server/lib/scorecardPopulation';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
// A heal is an auto-resolved WARNING or ERROR (`isSelfHeal`, src/lib/healIssue.ts). The first version of
// these fixtures carried no severity at all, which is how a predicate that read the flag alone passed
// this suite and shipped TOOL_DONE ×10313 as the most-repaired code — see tests/aToolCallIsNotARepair.
const heal = (code: string) => ({ code, severity: 'warning', autoResolved: true });
const notHeal = (code: string) => ({ code, severity: 'warning', autoResolved: false });

describe('summarizeHealCodes — one build', () => {
  it('counts only the auto-resolved WARNING/ERROR entries, by code — never an info row', () => {
    expect(summarizeHealCodes({
      issues: [
        heal('DESIGN_HEALED'), notHeal('RELEASE_GATE'), heal('DESIGN_HEALED'), heal('RUNTIME_VERIFIED'),
        { code: 'TOOL_DONE', severity: 'info', autoResolved: true },
        { code: 'HEARTBEAT', severity: 'info', autoResolved: true },
      ],
      counts: { autoResolved: 3 },
    })).toEqual({
      codes: { DESIGN_HEALED: 2, RUNTIME_VERIFIED: 1 },
      total: 3,
      unattributed: 0,
    });
  });

  it('🔴 a TRIMMED timeline is declared, never presented as the whole list', () => {
    // 86 heals really happened; the stored timeline shows two. That gap is the whole point.
    const t = summarizeHealCodes({ issues: [heal('A'), heal('B')], counts: { autoResolved: 86 } });
    expect(t).toMatchObject({ codes: { A: 1, B: 1 }, total: 86, unattributed: 84 });
  });

  it('a build with NO recorded total cannot have its list checked — null, never 0', () => {
    const t = summarizeHealCodes({ issues: [heal('A')], counts: {} });
    expect(t?.unattributed).toBeNull();
    expect(t?.total).toBeNull();
  });

  it('🔒 nothing measured at all ⇒ null, so the aggregate EXCLUDES it', () => {
    expect(summarizeHealCodes({})).toBeNull();
    expect(summarizeHealCodes(null)).toBeNull();
    expect(summarizeHealCodes(undefined)).toBeNull();
  });

  it('a count with no timeline is still a measurement — every heal unattributed', () => {
    expect(summarizeHealCodes({ counts: { autoResolved: 5 } }))
      .toEqual({ codes: {}, total: 5, unattributed: 5 });
  });

  it('a heal with no code is named UNCODED rather than dropped', () => {
    expect(summarizeHealCodes({ issues: [{ autoResolved: true }], counts: { autoResolved: 1 } }))
      .toMatchObject({ codes: { UNCODED: 1 }, unattributed: 0 });
  });

  it('never negative: a timeline richer than its count does not lend a shortfall to another build', () => {
    const t = summarizeHealCodes({ issues: [heal('A'), heal('A'), heal('A')], counts: { autoResolved: 1 } });
    expect(t?.unattributed).toBe(0);
  });

  it('🔒 past the per-build code cap it stops NAMING and keeps COUNTING', () => {
    const many = Array.from({ length: MAX_CODES_PER_BUILD + 8 }, (_, i) => heal(`C${i}`));
    const t = summarizeHealCodes({ issues: many, counts: { autoResolved: many.length } });
    expect(Object.keys(t!.codes)).toHaveLength(MAX_CODES_PER_BUILD);
    // `seen` counted all of them, so the cap does not manufacture a phantom shortfall.
    expect(t!.unattributed).toBe(0);
  });

  it('a malformed issue is skipped, never fatal — an observability field cannot break a listing', () => {
    expect(() => summarizeHealCodes({ issues: [null as any, 7 as any, heal('A')], counts: { autoResolved: 1 } }))
      .not.toThrow();
    expect(summarizeHealCodes({ issues: [null as any, heal('A')], counts: { autoResolved: 1 } })?.codes)
      .toEqual({ A: 1 });
  });
});

const build = (codes: Record<string, number>, total: number | null, ok = true): BuildMetricInput => ({
  workspaceId: 'w', reportedAt: 1, ok,
  healCodes: { codes, total, unattributed: total === null ? null : Math.max(0, total - Object.values(codes).reduce((a, b) => a + b, 0)) },
});

describe('healBreakdown — the ranked work list', () => {
  it('ranks by heals and counts how many BUILDS each code touched', () => {
    const b = healBreakdown([
      build({ DESIGN_HEALED: 3, RUNTIME_VERIFIED: 1 }, 4),
      build({ DESIGN_HEALED: 2 }, 2),
      build({ HTML_ENTRY_REPAIRED: 5 }, 5),
    ]);
    expect(b.top[0]).toEqual({ code: 'DESIGN_HEALED', heals: 5, builds: 2 });
    expect(b.top[1]).toEqual({ code: 'HTML_ENTRY_REPAIRED', heals: 5, builds: 1 });  // tie → by name
    expect(b.attributed).toBe(11);
    expect(b.builds).toBe(3);
  });

  it('🔑 86 heals in ONE build and 86 across 43 are different problems, and the row says which', () => {
    const concentrated = healBreakdown([build({ X: 86 }, 86)]);
    const spread = healBreakdown(Array.from({ length: 43 }, () => build({ X: 2 }, 2)));
    expect(concentrated.top[0]).toEqual({ code: 'X', heals: 86, builds: 1 });
    expect(spread.top[0]).toEqual({ code: 'X', heals: 86, builds: 43 });
  });

  it('🔒 a build with NO breakdown is excluded, never scored as having healed nothing', () => {
    const b = healBreakdown([
      build({ A: 1 }, 1),
      { workspaceId: 'w2', reportedAt: 2, ok: true },                 // legacy row
      { workspaceId: 'w3', reportedAt: 3, ok: true, healCodes: null },
    ]);
    expect(b.builds).toBe(1);
  });

  it('an unfinished build is not judgeable and never reaches the list', () => {
    expect(healBreakdown([{ workspaceId: 'w', reportedAt: 1, ok: null, healCodes: { codes: { A: 9 }, total: 9, unattributed: 0 } }]).builds).toBe(0);
  });

  it('🔴 carries the unnameable repairs through — the ranking states its own shortfall', () => {
    const b = healBreakdown([build({ A: 2 }, 86), build({ B: 1 }, 1)]);
    expect(b.attributed).toBe(3);
    expect(b.unattributed).toBe(84);
  });

  it('counts the builds whose completeness cannot be checked', () => {
    expect(healBreakdown([build({ A: 1 }, null), build({ B: 1 }, 1)]).completenessUnknown).toBe(1);
  });

  it('shows a bounded number of codes and still counts the rest', () => {
    const codes = Object.fromEntries(Array.from({ length: HEAL_CODES_SHOWN + 5 }, (_, i) => [`C${i}`, i + 1]));
    const b = healBreakdown([build(codes, Object.values(codes).reduce((a, c) => a + c, 0))]);
    expect(b.top).toHaveLength(HEAL_CODES_SHOWN);
    expect(b.attributed).toBe(Object.values(codes).reduce((a, c) => a + c, 0));
  });

  it('a junk count inside a tally is ignored rather than trusted', () => {
    const b = healBreakdown([{ workspaceId: 'w', reportedAt: 1, ok: true, healCodes: { codes: { A: -3, B: NaN as any, C: 2 }, total: 2, unattributed: 0 } }]);
    expect(b.top).toEqual([{ code: 'C', heals: 2, builds: 1 }]);
  });
});

describe('the headline says what to fix, and how much of it it cannot see', () => {
  it('names the codes with their build counts', () => {
    const h = scorecardHeadline(builderScorecard([build({ DESIGN_HEALED: 3 }, 3)]));
    expect(h).toContain('Most-repaired: DESIGN_HEALED ×3 (1 build)');
  });

  it('🔴 states the incompleteness IN the sentence, not as a droppable footnote', () => {
    const h = scorecardHeadline(builderScorecard([build({ A: 2 }, 86)]));
    expect(h).toContain('84 further repair(s) happened and could not be named');
    expect(h).toContain('this ranking is incomplete by that much');
  });

  it('a COMPLETE ranking claims no shortfall', () => {
    const h = scorecardHeadline(builderScorecard([build({ A: 2 }, 2)]));
    expect(h).toContain('Most-repaired:');
    expect(h).not.toContain('could not be named');
  });

  it('🔒 silent when nothing was measured — "not measured" is not "no heals"', () => {
    const h = scorecardHeadline(builderScorecard([{ workspaceId: 'w', reportedAt: 1, ok: true }]));
    expect(h).not.toContain('Most-repaired');
  });
});

describe('it is wired to both readers of a stored report, at no extra I/O', () => {
  const store = src('src/server/AgentV3/DiagnosticsStore.ts');

  it('the per-workspace HISTORY reader projects it — the scorecard\'s own source of builds', () => {
    const inner = store.slice(store.indexOf('async function listDiagnosticsHistoryInner'), store.indexOf('export function workspaceOwnerUid'));
    expect(inner).toContain('summarizeHealCodes(r)');
  });

  it('the ALL-workspaces reader projects it too', () => {
    const all = store.slice(store.indexOf('export async function listAllDiagnostics'), store.indexOf('export interface BuildFacts'));
    expect(all).toContain('summarizeHealCodes(r)');
  });

  it('both are wrapped, because an observability field may never fail its listing', () => {
    const wraps = store.match(/try \{ return summarizeHealCodes\(r\); \} catch \{ return null; \}/g) ?? [];
    expect(wraps).toHaveLength(2);
  });

  it('🔒 the collector passes it as undefined when absent, never {}', () => {
    expect(toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2, ok: true }).healCodes).toBeUndefined();
    expect(toMetricInput({
      workspaceId: 'w', startedAt: 1, endedAt: 2, ok: true,
      healCodes: { codes: { A: 1 }, total: 1, unattributed: 0 },
    }).healCodes).toEqual({ codes: { A: 1 }, total: 1, unattributed: 0 });
  });
});
