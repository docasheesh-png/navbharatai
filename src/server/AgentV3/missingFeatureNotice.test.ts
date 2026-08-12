import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { missingFeatureNotice, confirmedMissingFeatures, CONFIRMED_MISSING_PREFIX } from './missingFeatureNotice';

// The dukaan build succeeded, the readiness scan CONFIRMED no search had been built, and the user read
// the model's summary of everything it HAD made. Not blocking was right; not mentioning was not.

const confirmed = (feature: string) => `${CONFIRMED_MISSING_PREFIX} ${feature}`;

describe('reading the confirmed absences out of the readiness warnings', () => {
  it('picks up a confirmed absence', () => {
    expect(confirmedMissingFeatures([confirmed('search')])).toEqual(['search']);
  });

  it('IGNORES an unconfirmed "not found" — it is a name-only guess', () => {
    // This wording has produced real false positives (Registration.tsx, an admin/ folder). Telling a
    // user their app lacks something it actually has is worse than saying nothing.
    expect(confirmedMissingFeatures(['Requested feature not found: search'])).toEqual([]);
  });

  it('ignores every other warning', () => {
    const warnings = ['3 hardcoded localhost URL(s)', 'No tests at all', confirmed('shopping cart')];
    expect(confirmedMissingFeatures(warnings)).toEqual(['shopping cart']);
  });

  it('survives a missing or empty warnings list', () => {
    expect(confirmedMissingFeatures(undefined)).toEqual([]);
    expect(confirmedMissingFeatures([])).toEqual([]);
    expect(confirmedMissingFeatures([confirmed('   ')])).toEqual([]);
  });
});

describe('what the user is told', () => {
  it('names the feature, and says the rest works', () => {
    const text = missingFeatureNotice([confirmed('search')]);
    expect(text).toContain('search');
    expect(text).toContain('Everything else is built and working');
  });

  it('gives them the one sentence that fixes it', () => {
    // A user who is told something is missing and not told what to do learns only that the product is
    // unreliable. The cheapest real fix for a missing feature is asking for it.
    expect(missingFeatureNotice([confirmed('search')])).toContain('add it');
    expect(missingFeatureNotice([confirmed('search'), confirmed('shopping cart')])).toContain('add them');
  });

  it('reads as a sentence with several features, not a dump', () => {
    const text = missingFeatureNotice([confirmed('search'), confirmed('shopping cart'), confirmed('checkout')]);
    expect(text).toContain('search, shopping cart and checkout');
  });

  it('is EMPTY for a complete build, so a good build reads exactly as it does today', () => {
    expect(missingFeatureNotice([])).toBe('');
    expect(missingFeatureNotice(undefined)).toBe('');
    expect(missingFeatureNotice(['No tests at all'])).toBe('');
  });

  it('does not apologise or hedge', () => {
    // "Something may be missing" teaches the user nothing and costs trust; a named fact does not.
    const text = missingFeatureNotice([confirmed('search')]).toLowerCase();
    expect(text).not.toContain('sorry');
    expect(text).not.toContain('may be');
    expect(text).not.toContain('might');
  });
});

describe('it reaches the user at BOTH build exits', () => {
  const runner = readFileSync(join(process.cwd(), 'src/server/AgentV3/AgentRunner.ts'), 'utf8');

  it('is appended at the normal finish AND at the step-cap exit', () => {
    // Two entirely separate `done` emits. A long build is exactly the kind most likely to drop a
    // feature, so fixing only the first would have hidden the worst cases.
    expect((runner.match(/missingFeatureNotice\(buildHealth\?\.warnings\)/g) || []).length).toBe(2);
  });

  it('only ever appends to a SUCCESSFUL build', () => {
    // A failed build already says what is wrong; adding "and also this is missing" is noise on top of
    // a message the user is already acting on.
    const appends = runner.match(/if \(ok\) summary = `\$\{summary\}\$\{missingFeatureNotice/g) || [];
    expect(appends).toHaveLength(2);
  });
});
