import { describe, it, expect } from 'vitest';
import { needsLiveSearch, liveSearchContext, shapeSearchQuery } from './liveSearchContext';
import type { SearchResult } from '../AgentV3/WebSearch';

const stubClient = (results: SearchResult[], delayMs = 0) => ({
  search: async (): Promise<SearchResult[]> => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return results;
  },
});

describe('needsLiveSearch — the recency gate (only fetch when the answer needs current facts)', () => {
  it('TRUE for clearly time-sensitive questions (English + Hindi)', () => {
    expect(needsLiveSearch('who is the current India cricket captain')).toBe(true);
    expect(needsLiveSearch('latest iPhone price')).toBe(true);
    expect(needsLiveSearch('today match score')).toBe(true);
    expect(needsLiveSearch('India ka squad 2026')).toBe(true);
    expect(needsLiveSearch('aaj ka gold rate kitna hai')).toBe(true);
    expect(needsLiveSearch('taaza news')).toBe(true);
  });

  it('FALSE for evergreen / non-factual / greeting messages (no needless search)', () => {
    expect(needsLiveSearch('hi')).toBe(false);
    expect(needsLiveSearch('namaste')).toBe(false);
    expect(needsLiveSearch('thank you')).toBe(false);
    expect(needsLiveSearch('write me a poem about the moon')).toBe(false);
    expect(needsLiveSearch('explain how photosynthesis works')).toBe(false);
    expect(needsLiveSearch('make me a todo app')).toBe(false);
  });
});

describe('liveSearchContext — builds a grounding block only when useful', () => {
  it('returns a LIVE WEB RESULTS block with the fetched results for a time-sensitive query', async () => {
    const out = await liveSearchContext('latest India cricket squad', {
      client: stubClient([{ title: 'Squad', url: 'https://x.test', snippet: 'The 2026 squad is ...' }]),
      now: new Date('2026-07-12T00:00:00Z'),
      fetchPage: async () => ({ ok: false, text: '' }),
    });
    expect(out).toContain('LIVE WEB RESULTS');
    expect(out).toContain('2026-07-12');
    expect(out).toContain('https://x.test');
    expect(out).toMatch(/PRIMARY source/i);
  });

  it('returns "" when the message does not need live data (no search fired)', async () => {
    let called = false;
    const out = await liveSearchContext('write a haiku', {
      client: { search: async () => { called = true; return []; } },
    });
    expect(out).toBe('');
    expect(called).toBe(false);
  });

  it('returns "" when the search yields nothing', async () => {
    const out = await liveSearchContext('latest news', { client: stubClient([]) });
    expect(out).toBe('');
  });

  it('returns "" (never hangs) when the search exceeds the timeout', async () => {
    const out = await liveSearchContext('latest news', {
      client: stubClient([{ title: 't', url: 'u', snippet: 's' }], 200),
      timeoutMs: 20,
    });
    expect(out).toBe('');
  });
});

/**
 * DAILY-LIFE GROUNDING (admin 2026-08-25: "train kab hai, bus kaha milegi, flight kitna late hai —
 * isme bachi sari daily use ki cheeze add karo"). These pin the widened gate — and, just as hard, pin
 * what must NOT trigger: builder-chat sentences that merely contain a transit-looking word, because
 * every false trigger costs a real user seconds of search latency on an answer that needed none.
 */
describe('needsLiveSearch — daily-life and Hinglish coverage', () => {
  it('TRUE for transit questions, English and Hinglish', () => {
    expect(needsLiveSearch('train kab hai delhi se kanpur')).toBe(true);
    expect(needsLiveSearch('bus kaha milegi airport ke liye')).toBe(true);
    expect(needsLiveSearch('flight kitna late hai AI 101')).toBe(true);
    expect(needsLiveSearch('12301 train ka running status batao')).toBe(true);
    expect(needsLiveSearch('pnr 8524167930 check karo')).toBe(true);
    expect(needsLiveSearch('next metro kab hai')).toBe(true);
    expect(needsLiveSearch('which train goes to Lucknow tonight')).toBe(true);
  });

  it('TRUE for local daily needs — fuel, gold, mausam, results, power cuts, nearest-X', () => {
    expect(needsLiveSearch('petrol ka rate kya hai')).toBe(true);
    expect(needsLiveSearch('sone ka bhav kitna hai')).toBe(true);
    expect(needsLiveSearch('kal barish hogi kya')).toBe(true);
    expect(needsLiveSearch('board result kab aayega')).toBe(true);
    expect(needsLiveSearch('bijli kab aayegi')).toBe(true);
    expect(needsLiveSearch('nearest hospital batao')).toBe(true);
    expect(needsLiveSearch('atm kaha milega mere paas')).toBe(true);
    expect(needsLiveSearch('mandi bhav aaj ka')).toBe(true);
  });

  it('TRUE for romanized recency ONLY beside a fact question', () => {
    expect(needsLiveSearch('aaj kya khabar hai')).toBe(true);
    expect(needsLiveSearch('abhi dollar ka rate kitna hai')).toBe(true);
  });

  it('FALSE for builder chat that merely contains the words', () => {
    expect(needsLiveSearch('train a model on this dataset')).toBe(false);
    expect(needsLiveSearch('abhi ye error fix karo')).toBe(false);
    expect(needsLiveSearch('bus ho gaya, ab deploy karo')).toBe(false);
    expect(needsLiveSearch('mere app me flight booking ka feature banao')).toBe(false);
  });
});

describe('shapeSearchQuery — Hinglish sentences become queries search engines answer', () => {
  const NOW = new Date('2026-08-25T00:00:00Z');
  it('a train number becomes a running-status query', () => {
    expect(shapeSearchQuery('train 12301 kaha pahunchi', NOW)).toBe('train 12301 live running status today');
  });
  it('a PNR becomes a PNR-status query', () => {
    expect(shapeSearchQuery('pnr 8524167930 dekho', NOW)).toBe('PNR 8524167930 status');
  });
  it('a flight number becomes a dated status query', () => {
    expect(shapeSearchQuery('flight AI 101 kitni late hai', NOW)).toBe('AI101 flight status 2026-08-25');
  });
  it('anything it does not understand passes through VERBATIM', () => {
    expect(shapeSearchQuery('petrol ka rate kya hai', NOW)).toBe('petrol ka rate kya hai');
  });
});

describe('liveSearchContext — live transit data outranks search', () => {
  it('returns the live block ALONE and never runs the search when the feed answers', async () => {
    let searched = false;
    const out = await liveSearchContext('train 12301 kaha hai', {
      client: { search: async () => { searched = true; return []; } },
      liveData: async () => 'LIVE TRANSIT DATA (fetched just now, x):\n{"pos":"Kanpur"}',
    });
    expect(out).toContain('LIVE TRANSIT DATA');
    expect(searched).toBe(false);
  });

  it('falls through to the ordinary search when the feed has nothing', async () => {
    const out = await liveSearchContext('train 12301 kaha hai', {
      client: stubClient([{ title: 't', url: 'https://x.test', snippet: 'status' }]),
      liveData: async () => '',
      fetchPage: async () => ({ ok: false, text: '' }),
    });
    expect(out).toContain('LIVE WEB RESULTS');
  });
});

describe('liveSearchContext — reads the top result page, and degrades without it', () => {
  const RESULTS = [{ title: 'Status', url: 'https://status.test/x', snippet: 'two lines' }];

  it('folds the page text in under TOP RESULT PAGE', async () => {
    const out = await liveSearchContext('flight AI 101 kitni late hai', {
      client: stubClient(RESULTS),
      liveData: async () => '',
      fetchPage: async (url) => ({ ok: true, text: `Flight AI101 is delayed by 40 minutes (${url})` }),
    });
    expect(out).toContain('TOP RESULT PAGE (https://status.test/x)');
    expect(out).toContain('delayed by 40 minutes');
  });

  it('a failed or slow page read still returns the snippets — never nothing', async () => {
    const out = await liveSearchContext('flight AI 101 kitni late hai', {
      client: stubClient(RESULTS),
      liveData: async () => '',
      fetchPage: async () => { throw new Error('down'); },
    });
    expect(out).toContain('LIVE WEB RESULTS');
    expect(out).not.toContain('TOP RESULT PAGE');
  });

  it('readTopResult:false skips the page read entirely', async () => {
    let fetched = false;
    const out = await liveSearchContext('flight AI 101 kitni late hai', {
      client: stubClient(RESULTS),
      liveData: async () => '',
      readTopResult: false,
      fetchPage: async () => { fetched = true; return { ok: true, text: 'x' }; },
    });
    expect(out).toContain('LIVE WEB RESULTS');
    expect(fetched).toBe(false);
  });
});
