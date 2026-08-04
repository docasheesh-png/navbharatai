import { describe, it, expect } from 'vitest';
import {
  classifyFirstPass, firstPassStats, firstPassStatsFromMeta, firstPassHeadline, FIRST_PASS_TARGET,
  type FirstPassInput,
} from './firstPassQuality';

const build = (o: Partial<FirstPassInput> & { ok?: boolean } = {}): FirstPassInput => ({
  ok: true,
  counts: { autoResolved: 0, unresolved: 0 },
  issues: [],
  ...o,
});

describe('classifyFirstPass — a self-heal is a RED FLAG, not a success (50/50 law)', () => {
  it('delivered with ZERO repairs is the only "clean" build', () => {
    expect(classifyFirstPass(build())).toBe('clean');
  });

  it('delivered but the engine had to repair its OWN output ⇒ healed, never clean', () => {
    // This is the whole point of the metric: the user still paid for a bug that should never have
    // been generated. Counting it as success is how a ceiling hides behind a green checkmark.
    expect(classifyFirstPass(build({ counts: { autoResolved: 1, unresolved: 0 } }))).toBe('healed');
  });

  it('delivered but left something unresolved ⇒ healed, not clean', () => {
    expect(classifyFirstPass(build({ counts: { autoResolved: 0, unresolved: 3 } }))).toBe('healed');
  });

  it('a build that did not deliver is failed, however much it healed on the way', () => {
    expect(classifyFirstPass(build({ ok: false, counts: { autoResolved: 9, unresolved: 0 } }))).toBe('failed');
    expect(classifyFirstPass(build({ ok: undefined }))).toBe('failed');
    expect(classifyFirstPass(null)).toBe('failed');
    expect(classifyFirstPass(undefined)).toBe('failed');
  });

  it('a missing counts block is treated as clean only when the build genuinely delivered', () => {
    expect(classifyFirstPass({ ok: true })).toBe('clean');
    expect(classifyFirstPass({ ok: false })).toBe('failed');
  });
});

describe('firstPassStats — the headline is the CLEAN rate, with the flattering rate beside it', () => {
  it('counts the three buckets and both rates', () => {
    const s = firstPassStats([
      build(),
      build(),
      build({ counts: { autoResolved: 2, unresolved: 0 } }),
      build({ ok: false }),
    ]);
    expect(s).toMatchObject({ total: 4, clean: 2, healed: 1, failed: 1 });
    expect(s.cleanRate).toBeCloseTo(0.5);
    // deliveredRate is the number that flatters us — it must never be mistaken for the headline.
    expect(s.deliveredRate).toBeCloseTo(0.75);
  });

  it('reports NO rate when there is no data — "0%" and "no builds yet" are different facts', () => {
    const s = firstPassStats([]);
    expect(s.cleanRate).toBeNull();
    expect(s.deliveredRate).toBeNull();
    expect(firstPassHeadline(s)).toContain('No builds recorded yet');
  });

  it('ignores nulls in the input instead of counting them as failures', () => {
    expect(firstPassStats([build(), null, undefined]).total).toBe(1);
  });
});

describe('firstPassStats — topHealCodes is the ACTIONABLE half (what to prevent upstream)', () => {
  it('ranks the repairs that fire most, worst first', () => {
    const s = firstPassStats([
      build({ counts: { autoResolved: 2 }, issues: [
        { code: 'INTEGRITY_HEALED', autoResolved: true },
        { code: 'PREVIEW_COMPILE_HEALED', autoResolved: true },
      ] }),
      build({ counts: { autoResolved: 1 }, issues: [{ code: 'INTEGRITY_HEALED', autoResolved: true }] }),
    ]);
    expect(s.topHealCodes[0]).toEqual({ code: 'INTEGRITY_HEALED', count: 2 });
    expect(s.topHealCodes[1]).toEqual({ code: 'PREVIEW_COMPILE_HEALED', count: 1 });
  });

  it('EXCLUDES observations — an advisory note about the user\'s own code is not a self-heal', () => {
    // The exact inflation this guards: an import turn recorded 14 advisory notes with autoResolved:true,
    // so a build that healed essentially nothing reported "32 auto-resolved". A tally that inflates
    // itself corrupts the number the autopsy reads.
    const s = firstPassStats([
      build({ issues: [
        { code: 'IMPORT_OBSERVATION', autoResolved: true, observation: true },
        { code: 'INTEGRITY_HEALED', autoResolved: true },
      ] }),
    ]);
    expect(s.topHealCodes).toEqual([{ code: 'INTEGRITY_HEALED', count: 1 }]);
  });

  it('never counts an UNRESOLVED issue as a heal', () => {
    const s = firstPassStats([build({ issues: [{ code: 'TOOL_ERROR', autoResolved: false }] })]);
    expect(s.topHealCodes).toEqual([]);
  });

  it('is deterministic on ties so week-over-week comparison is meaningful', () => {
    const s = firstPassStats([build({ issues: [
      { code: 'ZEBRA_HEALED', autoResolved: true },
      { code: 'ALPHA_HEALED', autoResolved: true },
    ] })]);
    expect(s.topHealCodes.map((h) => h.code)).toEqual(['ALPHA_HEALED', 'ZEBRA_HEALED']);
  });
});

describe('firstPassHeadline — honest wording, never rounds a miss up to the target', () => {
  it('says "below" when under target and names all three buckets', () => {
    const line = firstPassHeadline(firstPassStats([build(), build({ counts: { autoResolved: 1 } })]));
    expect(line).toContain('50.0%');
    expect(line).toContain('below');
    expect(line).toMatch(/1 clean, 1 needed repair, 0 failed/);
  });

  it('says "at or above" exactly at the target boundary, not just past it', () => {
    const clean = Array.from({ length: 85 }, () => build());
    const bad = Array.from({ length: 15 }, () => build({ ok: false }));
    const s = firstPassStats([...clean, ...bad]);
    expect(s.cleanRate).toBeCloseTo(FIRST_PASS_TARGET);
    expect(firstPassHeadline(s)).toContain('at or above');
  });
});

// The admin list projects only meta (cheap). Rows written before healCount existed carry NO quality
// signal — counting them as clean would silently inflate the exact number we judge the engine by.
describe('firstPassStatsFromMeta — a legacy row is skipped, never counted as clean', () => {
  it('skips delivered rows that predate the counts field and reports how many', () => {
    const s = firstPassStatsFromMeta([
      { ok: true, healCount: 0, unresolvedCount: 0 },   // clean
      { ok: true },                                     // legacy — unknowable, must NOT count as clean
      { ok: true, healCount: 3, unresolvedCount: 0 },   // healed
    ]);
    expect(s).toMatchObject({ total: 2, clean: 1, healed: 1, failed: 0, skippedLegacy: 1 });
    expect(s.cleanRate).toBeCloseTo(0.5); // 1 of 2 USABLE rows — the legacy row is not in the denominator
  });

  it('still counts a legacy FAILURE — "it did not deliver" needs no counts', () => {
    const s = firstPassStatsFromMeta([{ ok: false }, { ok: false, healCount: 2, unresolvedCount: 1 }]);
    expect(s).toMatchObject({ total: 2, failed: 2, skippedLegacy: 0 });
    expect(s.cleanRate).toBe(0);
  });

  it('a half-written row (one count present, one missing) is treated as legacy, not as zero', () => {
    const s = firstPassStatsFromMeta([{ ok: true, healCount: 0 }]);
    expect(s).toMatchObject({ total: 0, skippedLegacy: 1 });
    expect(s.cleanRate).toBeNull();
  });

  it('an all-legacy window reports no rate at all rather than a fake 100%', () => {
    const s = firstPassStatsFromMeta([{ ok: true }, { ok: true }]);
    expect(s.cleanRate).toBeNull();
    expect(s.skippedLegacy).toBe(2);
    expect(firstPassHeadline(s)).toContain('No builds recorded yet');
  });
});
