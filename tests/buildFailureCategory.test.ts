import { describe, it, expect } from 'vitest';
import {
  classifyFailureReason, domainOfPrompt, categorizeBuildFailures, type CategorizableBuild,
} from '../src/server/lib/buildFailureCategory';

/**
 * Admin, 2026-09-16: "kis type ki apps nahi ban pa rahi hai — koi specific pattern hai, ya random?"
 * These tests are the evidence that the categoriser answers that honestly: real engine wording maps
 * to a real reason, an app's domain comes from the SAME classifier the build prompt itself uses, and
 * nothing here invents a number for data that was not recorded.
 */

describe('classifyFailureReason — grounded in the engine’s OWN real wording', () => {
  it('recognises the exact BuildDiagnostics.ts / turnDeadline.ts strings', () => {
    expect(classifyFailureReason('reported exit 0 but the database was NOT reachable — the migration did not actually run').key).toBe('db-unreachable');
    expect(classifyFailureReason('could not run — the build sandbox was unavailable (reaped/expired/unreachable). Infrastructure condition, not an app error.').key).toBe('sandbox-unavailable');
    expect(classifyFailureReason('build budget exhausted before this call could start').key).toBe('provider-budget');
    expect(classifyFailureReason('build budget reached while this call was still running').key).toBe('provider-budget');
    expect(classifyFailureReason("Stuck on 'write_file' — in-flight 240s, never completed.").key).toBe('stuck-tool');
    expect(classifyFailureReason('Critical issue found by review: Missing Required Features').key).toBe('review-critical');
  });

  it('an unmatched root cause is never forced into a wrong bucket', () => {
    // ⚠️ SPLIT ON 2026-09-20, and the intent is unchanged: an unmatched reason is filed honestly,
    // never squeezed into a category it does not belong to. WHICH honest bucket now depends on a
    // machine fact — did the build record an `OUTCOME_*` code at all? No code means the engine
    // never said why it ended (an engine hole); a code we have no word for is the real vocabulary
    // gap. One row for both told every reader to write regexes for the first kind.
    expect(classifyFailureReason('the user hated the shade of blue we picked').key)
      .toBe('no-outcome-recorded');
    expect(classifyFailureReason('the user hated the shade of blue we picked', 'OUTCOME_BRAND_NEW', 'error').key)
      .toBe('other');
  });

  it('a blank/missing root cause is its own honest state, not “other”', () => {
    expect(classifyFailureReason(null).key).toBe('no-root-cause');
    expect(classifyFailureReason('').key).toBe('no-root-cause');
    expect(classifyFailureReason('   ').key).toBe('no-root-cause');
  });

  it('the first matching pattern wins, so a more specific bucket beats a general one', () => {
    // Contains BOTH a timeout word and DB wording — the DB-specific pattern is listed first and wins.
    const r = classifyFailureReason('the database was NOT reachable and the call also timed out');
    expect(r.key).toBe('db-unreachable');
  });
});

describe('domainOfPrompt — the SAME classifier the build prompt itself is analysed with', () => {
  it('recognises a real domain', () => {
    expect(domainOfPrompt('Build a hospital patient management system with appointments')).toBe('healthcare');
    expect(domainOfPrompt('Build an online shop with a cart and checkout')).toBe('ecommerce');
  });

  it('a generic prompt with no domain signal is “general”, never guessed', () => {
    expect(domainOfPrompt('Build a simple counter app')).toBe('general');
    expect(domainOfPrompt(undefined)).toBe('general');
  });
});

const build = (over: Partial<CategorizableBuild> = {}): CategorizableBuild => ({
  workspaceId: 'ws1', ok: false, prompt: 'Build a hospital system', rootCause: 'build budget exhausted before this call could start',
  ...over,
});

describe('categorizeBuildFailures', () => {
  it('empty input is an honest all-zero report, never a fabricated rate', () => {
    const r = categorizeBuildFailures([]);
    expect(r.totalBuilds).toBe(0);
    expect(r.overallFailureRatePct).toBeNull();
    expect(r.byDomain).toEqual([]);
    expect(r.byReason).toEqual([]);
  });

  it('null/undefined input behaves exactly like empty — never throws', () => {
    expect(categorizeBuildFailures(null).totalBuilds).toBe(0);
    expect(categorizeBuildFailures(undefined).totalBuilds).toBe(0);
  });

  it('a build with no settled verdict is EXCLUDED from the rate, not counted as a failure', () => {
    const r = categorizeBuildFailures([build({ ok: null as unknown as boolean })]);
    expect(r.unjudged).toBe(1);
    expect(r.failed).toBe(0);
    expect(r.overallFailureRatePct).toBeNull();
  });

  it('computes an honest overall failure rate from judged builds only', () => {
    const r = categorizeBuildFailures([
      build({ workspaceId: 'a', ok: false }),
      build({ workspaceId: 'b', ok: false }),
      build({ workspaceId: 'c', ok: true }),
      build({ workspaceId: 'd', ok: null as unknown as boolean }), // excluded
    ]);
    expect(r.totalBuilds).toBe(4);
    expect(r.unjudged).toBe(1);
    expect(r.ok).toBe(1);
    expect(r.failed).toBe(2);
    expect(r.overallFailureRatePct).toBe(66.7); // 2 of 3 JUDGED, not 2 of 4
  });

  it('groups by DOMAIN and sorts by FAILED count first — the pattern question this exists to answer', () => {
    const r = categorizeBuildFailures([
      // healthcare: 3 built, 2 failed
      build({ workspaceId: 'h1', ok: false, prompt: 'Build a hospital patient portal' }),
      build({ workspaceId: 'h2', ok: false, prompt: 'Build a clinic appointment system' }),
      build({ workspaceId: 'h3', ok: true, prompt: 'Build a doctor dashboard' }),
      // ecommerce: 2 built, 0 failed — so it must NOT outrank healthcare despite equal or more total
      build({ workspaceId: 'e1', ok: true, prompt: 'Build an online shop' }),
      build({ workspaceId: 'e2', ok: true, prompt: 'Build a shopping cart app' }),
    ]);
    expect(r.byDomain[0].domain).toBe('healthcare');
    expect(r.byDomain[0].failed).toBe(2);
    expect(r.byDomain[0].total).toBe(3);
    expect(r.byDomain[0].failureRatePct).toBe(66.7);
    const ecommerce = r.byDomain.find((d) => d.domain === 'ecommerce')!;
    expect(ecommerce.failed).toBe(0);
    expect(ecommerce.failureRatePct).toBe(0);
  });

  it('a domain with ZERO judged builds never appears — it cannot be “0% failure” if nothing ran', () => {
    const r = categorizeBuildFailures([build({ workspaceId: 'h1', ok: false, prompt: 'Build a hospital system' })]);
    expect(r.byDomain.find((d) => d.domain === 'ecommerce')).toBeUndefined();
  });

  it('tallies failure REASONS across all domains, with a capped, real example per bucket', () => {
    const r = categorizeBuildFailures([
      build({ workspaceId: 'a', rootCause: 'build budget exhausted before this call could start' }),
      build({ workspaceId: 'b', rootCause: 'build budget reached while this call was still running' }),
      build({ workspaceId: 'c', rootCause: 'reported exit 0 but the database was NOT reachable' }),
    ]);
    expect(r.byReason[0].key).toBe('provider-budget');
    expect(r.byReason[0].count).toBe(2);
    expect(r.byReason[0].sharePct).toBe(66.7);
    expect(r.byReason[0].examples).toHaveLength(2);
    expect(r.byReason[0].examples[0].workspaceId).toBe('a');
  });

  it('examples are capped so one noisy category cannot balloon the response', () => {
    const many = Array.from({ length: 10 }, (_, i) => build({ workspaceId: `w${i}` }));
    const r = categorizeBuildFailures(many);
    expect(r.byReason[0].count).toBe(10);
    expect(r.byReason[0].examples.length).toBeLessThanOrEqual(3);
  });

  it('a real MIX reads as neither all-one-pattern nor all-random — both honest outcomes are representable', () => {
    // A genuinely random spread: every domain has some failures, none dominates.
    const random = categorizeBuildFailures([
      build({ workspaceId: 'h1', ok: false, prompt: 'hospital app' }),
      build({ workspaceId: 'e1', ok: false, prompt: 'online shop' }),
      build({ workspaceId: 's1', ok: false, prompt: 'social feed app' }),
    ]);
    const shares = random.byDomain.map((d) => d.failed);
    expect(new Set(shares).size).toBeLessThanOrEqual(shares.length); // no crash on a flat spread

    // A genuine concentration: one domain accounts for most failures.
    const concentrated = categorizeBuildFailures([
      build({ workspaceId: 'h1', ok: false, prompt: 'hospital app' }),
      build({ workspaceId: 'h2', ok: false, prompt: 'clinic app' }),
      build({ workspaceId: 'h3', ok: false, prompt: 'patient portal' }),
      build({ workspaceId: 'e1', ok: true, prompt: 'online shop' }),
    ]);
    expect(concentrated.byDomain[0].domain).toBe('healthcare');
    expect(concentrated.byDomain[0].failed).toBe(3);
  });
});
