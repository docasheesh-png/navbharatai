// Tests for the 💡 bulb's second memory layer: what the LAST BUILD actually measured about THIS app
// (admin 2026-08-20: "us app ki memory ke hisab se suggestion ane chahiye, aise random nahi").

import { describe, it, expect } from 'vitest';
import { buildFindingSuggestions, MAX_FINDING_SUGGESTIONS } from './buildFindingSuggestions';

describe('buildFindingSuggestions — measured facts about this app', () => {
  it('turns an unresolved finding into a suggestion written for the user, not for an engineer', () => {
    const out = buildFindingSuggestions([{ code: 'DESIGN_PAGE_INCONSISTENT', autoResolved: false }]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('found-design-page-inconsistent');
    expect(out[0].title).toBe('Make the inside pages look as good as the first');
    expect(out[0].prompt.length).toBeGreaterThan(30);
    // Specific to this app's measured state — never filed as universal polish.
    expect(out[0].kind).toBe('domain');
  });

  it('IGNORES a finding the build already fixed — suggesting a fix for a fixed thing is noise', () => {
    expect(buildFindingSuggestions([{ code: 'DESIGN_PAGE_INCONSISTENT', autoResolved: true }])).toEqual([]);
  });

  it('IGNORES an observation — that is the user\'s pre-existing code, not something our build caused', () => {
    expect(buildFindingSuggestions([{ code: 'DEPENDENCY_VULNERABILITIES', observation: true }])).toEqual([]);
  });

  it('never suggests acting on OUR OWN missing measurement', () => {
    // These record what the platform could not verify. Asking the user to "fix" that would be dishonest.
    const out = buildFindingSuggestions([
      { code: 'RUNTIME_UNCHECKED' }, { code: 'TEST_SUITE_UNVERIFIED' },
      { code: 'JOURNEY_NOT_DERIVED' }, { code: 'RELEASE_GATE' }, { code: 'TIME_TO_FIRST_CALL' },
      { code: 'CLAIM_UNSUPPORTED' }, { code: 'RUNTIME_VERIFIED' },
    ]);
    expect(out).toEqual([]);
  });

  it('a code with no curated wording produces NOTHING rather than a guessed paraphrase', () => {
    expect(buildFindingSuggestions([{ code: 'SOME_INTERNAL_CODE_2026' }])).toEqual([]);
  });

  it('ranks by what the user would feel, not by report order', () => {
    const out = buildFindingSuggestions([
      { code: 'ACCESSIBILITY' },
      { code: 'RUNTIME_ERRORS_REMAIN' },
      { code: 'DESIGN_PAGE_INCONSISTENT' },
    ]);
    // A broken-at-runtime app outranks a plain page, which outranks an accessibility gap.
    expect(out.map((s) => s.id)).toEqual([
      'found-runtime-errors-remain',
      'found-design-page-inconsistent',
      'found-accessibility',
    ]);
  });

  it('is bounded and deduped, so one noisy report cannot flood the bulb', () => {
    const many = [
      { code: 'RUNTIME_ERRORS_REMAIN' }, { code: 'RUNTIME_ERRORS_REMAIN' },
      { code: 'JOURNEY_FAILED' }, { code: 'PAGE_RENDER_FAILED' },
      { code: 'DESIGN_PAGE_INCONSISTENT' }, { code: 'ACCESSIBILITY' }, { code: 'TEST_SUITE' },
    ];
    const out = buildFindingSuggestions(many);
    expect(out.length).toBeLessThanOrEqual(MAX_FINDING_SUGGESTIONS);
    expect(new Set(out.map((s) => s.id)).size).toBe(out.length);
  });

  it('WHITE-LABEL: no user-facing string names a vendor, model or internal tool', () => {
    const out = buildFindingSuggestions([
      { code: 'RUNTIME_ERRORS_REMAIN' }, { code: 'DEPENDENCY_VULNERABILITIES' }, { code: 'TEST_SUITE' },
    ], 99);
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/GLM|Kimi|Claude|Sonnet|Opus|Gemini|Grok|Anthropic|Moonshot|playwright|vitest|eslint|E2B/i);
  });

  it('is safe on nothing at all', () => {
    expect(buildFindingSuggestions([])).toEqual([]);
    expect(buildFindingSuggestions(null)).toEqual([]);
    expect(buildFindingSuggestions(undefined)).toEqual([]);
    expect(buildFindingSuggestions([{ code: '' }])).toEqual([]);
  });
});
