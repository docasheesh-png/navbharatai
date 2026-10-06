// A TWO-PART QUESTION GETS BOTH ANSWERS (Q-601, 2026-10-06; Q-127's sibling).
//
// "delhi ka mausam aur aaj gold rate" got the weather and lost the gold rate. No live source serves gold, and
// `liveSearchContext` returned the live block as soon as ANY source answered, so the web search that would
// have answered the other half never ran. Q-127 fixed the same class between two LIVE sources; this half is
// a live source next to a plain web question. Coverage is decided by the live sources' OWN gates
// (`liveTopicCovered`), never a guessed keyword list, and a census keeps that list in step with the sources.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liveSearchContext, uncoveredLiveClauses } from '../src/server/lib/liveSearchContext';
import { liveTopicCovered } from '../src/server/lib/liveDataSources';

const WEATHER = 'LIVE WEATHER DATA (fetched just now, x):\nPlace: Delhi\nTemperature: 31°C';
const recordingClient = (title: string) => {
  const queries: string[] = [];
  return {
    queries,
    client: {
      search: async (q: string) => { queries.push(q); return [{ title, url: 'https://rates.test/gold', snippet: `${title} today` }]; },
    },
  };
};

describe('liveSearchContext answers every half of the question', () => {
  it('THE BUG: weather from the live source AND the gold rate from a web search, both returned', async () => {
    const { queries, client } = recordingClient('Gold rate in Delhi');
    const out = await liveSearchContext('delhi ka mausam aur aaj gold rate kya hai', {
      liveData: async () => WEATHER, client, readTopResult: false,
    });
    expect(out).toContain('LIVE WEATHER DATA');
    expect(out).toContain('LIVE WEB RESULTS');
    expect(out).toContain('Gold rate in Delhi');
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/gold/i);
    expect(queries[0]).not.toMatch(/mausam/i);           // only the half the live source did not answer
  });

  it('a question every clause of which a live source covers still never searches', async () => {
    for (const msg of ['delhi ka mausam aur AQI kitna hai', 'delhi ka mausam kaisa hai', 'dollar ka rate aur kal barish hogi kya']) {
      let searched = false;
      const out = await liveSearchContext(msg, {
        liveData: async () => WEATHER, client: { search: async () => { searched = true; return []; } }, readTopResult: false,
      });
      expect(out, msg).toBe(WEATHER);
      expect(searched, msg).toBe(false);
    }
  });

  it('when the extra search finds nothing, the live answer still goes back on its own', async () => {
    const out = await liveSearchContext('delhi ka mausam aur aaj gold rate kya hai', {
      liveData: async () => WEATHER, client: { search: async () => [] }, readTopResult: false,
    });
    expect(out).toBe(WEATHER);
  });

  it('with no live answer at all, the whole message is searched exactly as before', async () => {
    const { queries, client } = recordingClient('Gold');
    await liveSearchContext('aaj gold rate kya hai', { liveData: async () => '', client, readTopResult: false });
    expect(queries).toEqual(['aaj gold rate kya hai']);
  });
});

describe('uncoveredLiveClauses — the clauses no live source would take', () => {
  it('splits on the joins people use to ask two things at once, in Hinglish, Hindi and English', () => {
    expect(uncoveredLiveClauses('delhi ka mausam aur aaj gold rate kya hai')).toEqual(['aaj gold rate kya hai']);
    expect(uncoveredLiveClauses('weather in mumbai and latest news today')).toEqual(['latest news today']);
    // Devanagari: the gold half needs today's facts and no live source takes it, so it is searched.
    expect(uncoveredLiveClauses('दिल्ली का मौसम और आज सोने का भाव')).toEqual(['आज सोने का भाव']);
  });

  it('covered or non-factual clauses are never searched', () => {
    expect(uncoveredLiveClauses('delhi ka mausam aur AQI')).toEqual([]);
    expect(uncoveredLiveClauses('mausam batao aur thanks')).toEqual([]);
    expect(uncoveredLiveClauses('')).toEqual([]);
  });
});

describe('liveTopicCovered is the live sources\' own gates — a census keeps it that way', () => {
  it('every source liveDataContext runs has its gate in liveTopicCovered', () => {
    const src = readFileSync(join(__dirname, '../src/server/lib/liveDataSources.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function liveTopicCovered'), src.indexOf('export async function liveDataContext'));
    const ctx = src.slice(src.indexOf('export async function liveDataContext'));
    const blocks = [...ctx.matchAll(/\b(\w+Block)\b/g)].map((m) => m[1]).filter((b, i, a) => a.indexOf(b) === i && b !== 'liveBlock');
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    for (const block of blocks) {
      const fn = src.slice(src.indexOf(`async function ${block}(`));
      const head = fn.slice(0, fn.indexOf('\n', fn.indexOf('\n') + 1) + 200);
      const gate = head.match(/if \(!(\w+)\.test\(message\)\)/)?.[1] ?? head.match(/=\s*(detect\w+)\(message\)/)?.[1];
      expect(gate, `${block} has no recognisable gate`).toBeTruthy();
      expect(body, `${block}'s gate ${gate} is missing from liveTopicCovered`).toContain(gate!);
    }
    expect(ctx).toContain('liveTransitContext');
    expect(body).toContain('detectTransitQuery');
  });

  it('agrees with each source on its own example', () => {
    for (const t of ['delhi ka mausam', 'AQI in delhi', 'dollar ka rate', '208001 kaha ka pin code hai', 'kaun si movie lagi hai', 'train 12301 kaha hai']) {
      expect(liveTopicCovered(t), t).toBe(true);
    }
    expect(liveTopicCovered('aaj gold rate kya hai')).toBe(false);
  });
});
