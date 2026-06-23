import { describe, it, expect } from 'vitest';
import { makeConsensus, synthesizeConsensus, type Perspective } from './Consensus';
import type { OpinionRouter } from './SecondOpinion';

/** A fake router that returns distinct content/provider on each successive call. */
function sequenceRouter(responses: Array<{ content: string; provider: string } | 'throw'>): OpinionRouter {
  let i = 0;
  return {
    async route() {
      const r = responses[i++];
      if (!r || r === 'throw') throw new Error('router failed');
      return { response: r };
    },
  };
}

describe('synthesizeConsensus (pure)', () => {
  it('returns an honest unavailable line when there are no perspectives', () => {
    expect(synthesizeConsensus('Should we use SQL?', [])).toBe(
      'Consensus unavailable: no perspectives could be gathered.',
    );
  });

  it('formats each perspective with its hat and provider plus a panel note', () => {
    const perspectives: Perspective[] = [
      { hat: 'Correctness', text: 'Looks sound.', provider: 'GEMINI' },
      { hat: 'Security', text: 'No issues.', provider: 'GROK' },
    ];
    const out = synthesizeConsensus('Q?', perspectives);
    expect(out).toContain('Consensus panel on: Q?');
    expect(out).toContain('[Correctness · via GEMINI]');
    expect(out).toContain('[Security · via GROK]');
    expect(out).toContain('Panel note: 2 perspective(s) gathered.');
  });

  it('bounds the overall block length', () => {
    const big = 'x'.repeat(5000);
    const perspectives: Perspective[] = [
      { hat: 'Correctness', text: big, provider: 'GEMINI' },
      { hat: 'Security', text: big, provider: 'GROK' },
      { hat: 'UX/Maintainability', text: big, provider: 'VERTEX' },
    ];
    const out = synthesizeConsensus('Q?', perspectives);
    expect(out.length).toBeLessThanOrEqual(2500);
  });
});

describe('makeConsensus', () => {
  it('gathers all three hats and includes their providers', async () => {
    const router = sequenceRouter([
      { content: 'correctness view', provider: 'GEMINI' },
      { content: 'security view', provider: 'GROK' },
      { content: 'ux view', provider: 'VERTEX' },
    ]);
    const out = await makeConsensus(router)('Should we shard the DB?');
    expect(out).toContain('Correctness');
    expect(out).toContain('Security');
    expect(out).toContain('UX/Maintainability');
    expect(out).toContain('GEMINI');
    expect(out).toContain('GROK');
    expect(out).toContain('VERTEX');
    expect(out).toContain('Panel note: 3 perspective(s) gathered.');
  });

  it('skips a single failing perspective but still returns the others (no throw)', async () => {
    const router = sequenceRouter([
      { content: 'correctness view', provider: 'GEMINI' },
      'throw',
      { content: 'ux view', provider: 'VERTEX' },
    ]);
    const out = await makeConsensus(router)('Q?');
    expect(out).toContain('GEMINI');
    expect(out).toContain('VERTEX');
    expect(out).not.toContain('GROK');
    expect(out).toContain('Panel note: 2 perspective(s) gathered.');
  });

  it('returns an unavailable string (no throw) when every perspective fails', async () => {
    const router = sequenceRouter(['throw', 'throw', 'throw']);
    const out = await makeConsensus(router)('Q?');
    expect(out).toContain('Consensus unavailable');
  });
});
