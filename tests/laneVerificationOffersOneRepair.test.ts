import { describe, expect, it } from 'vitest';
import { buildFindingSuggestions, OFFERED_THROUGH } from '../src/server/AgentV3/buildFindingSuggestions';

const codes = ['SIMPLE_BUILD_VERIFY_ERROR', 'ONESHOT_VERIFY_FAILED'];
const raw = 'private diagnostic: provider-name /private/project/source.ts token=not-for-display';

describe('unresolved lane verification offers one safe repair action', () => {
  it.each(codes)('offers a repair for %s without interpolating raw evidence', (code) => {
    const suggestions = buildFindingSuggestions([{ code, severity: 'warning', autoResolved: false, message: raw }]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].id).toBe('found-simple-build-verify-error');
    expect(suggestions[0].title).toBe('Fix remaining build errors');
    expect(suggestions[0].prompt).toContain('compiler or stylesheet');
    expect(suggestions[0].prompt).toContain('a compiler pass alone');
    expect(JSON.stringify(suggestions)).not.toContain(raw);
    expect(JSON.stringify(suggestions)).not.toContain('provider-name');
    expect(JSON.stringify(suggestions)).not.toContain('/private/project');
  });
  it('aliases the one-shot finding and deduplicates both unresolved lanes', () => {
    expect(OFFERED_THROUGH.ONESHOT_VERIFY_FAILED).toBe('SIMPLE_BUILD_VERIFY_ERROR');
    expect(buildFindingSuggestions(codes.map(code => ({ code, autoResolved: false })))).toHaveLength(1);
  });
  it.each(codes)('does not offer resolved or pre-existing %s', (code) => {
    expect(buildFindingSuggestions([{ code, autoResolved: true }])).toEqual([]);
    expect(buildFindingSuggestions([{ code, observation: true }])).toEqual([]);
  });
  it('keeps the unresolved alias when the other lane was resolved', () => {
    expect(buildFindingSuggestions([
      { code: codes[0], autoResolved: true },
      { code: codes[1], autoResolved: false },
    ])).toHaveLength(1);
  });
});
