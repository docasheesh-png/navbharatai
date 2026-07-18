import { describe, it, expect } from 'vitest';
import {
  searchFeatures, answerOffline, howToSteps, scoreFeature, navFor,
  editDistance, relatedFeaturesOf, SUGGESTED_QUERIES,
} from './offlineAssistant';
import { APP_KNOWLEDGE_BASE } from '../server/AppContext/AppKnowledgeBase';

describe('offlineAssistant — grounded 100% in the app knowledge base', () => {
  it('the knowledge base is non-empty and bundled client-side', () => {
    expect(APP_KNOWLEDGE_BASE.length).toBeGreaterThan(50);
  });

  it('finds a feature by an obvious keyword, best match first', () => {
    const r = searchFeatures('where is the wallet and billing');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].feature.keywords.join(' ')).toMatch(/wallet|billing/i);
  });

  it('answers a Hinglish "kaha hai" question from real KB data', () => {
    const a = answerOffline('support kaha hai');
    expect(a.kind).toBe('matches');
    expect(a.matches.some((f) => /support/i.test(f.name) || f.keywords.includes('support'))).toBe(true);
  });

  it('a broad "what can this app do" gives an overview tour', () => {
    const a = answerOffline('what can this app do');
    expect(a.kind).toBe('overview');
    expect(a.matches.length).toBeGreaterThan(3);
  });

  it('an empty query gives the overview (not a crash)', () => {
    expect(answerOffline('').kind).toBe('overview');
  });

  it('an unmatchable query returns an honest "none" — never a fabricated answer', () => {
    const a = answerOffline('qqzzxx wwvvbb pplkjhh');
    expect(a.kind).toBe('none');
    expect(a.matches).toEqual([]);
  });

  it('every returned match is a REAL KB entry (zero hallucination)', () => {
    const ids = new Set(APP_KNOWLEDGE_BASE.map((f) => f.id));
    for (const f of answerOffline('database').matches) expect(ids.has(f.id)).toBe(true);
  });

  it('scoreFeature weights an exact name hit above a stray description word', () => {
    const f = APP_KNOWLEDGE_BASE.find((x) => x.name && x.keywords.length) as any;
    expect(scoreFeature(f, f.name.toLowerCase())).toBeGreaterThanOrEqual(4);
  });

  it('navFor gives a working target for a core feature, and a feature\'s own nav wins', () => {
    const builder = APP_KNOWLEDGE_BASE.find((f) => f.id === 'agentv3_builder')!;
    expect(navFor(builder)).toEqual({ view: 'nbi_pro_chat' });
    expect(navFor({ ...builder, nav: { view: 'home' } })).toEqual({ view: 'home' });
    // An entry with no nav and no curated fallback → null (UI shows the textual path instead).
    expect(navFor({ id: 'nope_xyz', name: 'x', path: 'p', description: '', howToUse: '', relatedFeatures: [], keywords: [] } as any)).toBeNull();
  });

  it('howToSteps splits numbered and sentence guidance into steps', () => {
    expect(howToSteps('1. Open settings 2. Tap database 3. Save').length).toBe(3);
    expect(howToSteps('Open the menu. Tap Files. Done.').length).toBe(3);
    expect(howToSteps('')).toEqual([]);
  });

  // ─── Enhancement 2026-07-18: typo tolerance, related hops, starter suggestions ───

  it('editDistance is a real bounded Levenshtein (exact within budget, sentinel past it)', () => {
    expect(editDistance('database', 'database')).toBe(0);
    expect(editDistance('databse', 'database', 2)).toBe(1); // one deletion
    expect(editDistance('walet', 'wallet', 2)).toBe(1);
    expect(editDistance('cat', 'dog', 2)).toBe(3); // far apart → returns max+1 sentinel
  });

  it('recovers a misspelled query the exact matcher would have missed (offline has no fallback)', () => {
    for (const typo of ['databse', 'walet', 'deploi']) {
      const a = answerOffline(typo);
      expect(a.kind, `"${typo}" should still find something`).toBe('matches');
      expect(a.matches.length).toBeGreaterThan(0);
    }
    // "databse" surfaces the database feature.
    expect(answerOffline('databse').matches.some((f) => /database/i.test(f.name) || f.keywords.includes('database'))).toBe(true);
  });

  it('a typo-tolerant (fuzzy) hit never outranks a real exact hit', () => {
    // Deterministic: an exact single-keyword hit scores 2; a one-typo fuzzy hit scores 1.5 (< 2), so a
    // real match can never be buried under a near-miss.
    const f: any = {
      id: 'x', name: 'X', path: '', description: '', howToUse: '', relatedFeatures: [], keywords: ['deploy'],
    };
    expect(scoreFeature(f, 'deploy')).toBe(2);   // exact single keyword
    expect(scoreFeature(f, 'deploi')).toBe(1.5); // fuzzy fallback only
    expect(scoreFeature(f, 'deploy')).toBeGreaterThan(scoreFeature(f, 'deploi'));
  });

  it('still returns an honest "none" for true gibberish — fuzzy does not over-match', () => {
    const a = answerOffline('qqzzxx wwvvbb pplkjhh');
    expect(a.kind).toBe('none');
    expect(a.matches).toEqual([]);
  });

  it('description scoring is word-boundary, not substring ("star" is NOT a word in "restart")', () => {
    const f: any = {
      id: 't', name: 'ZZZ', path: '', description: 'restart the workspace', howToUse: '',
      relatedFeatures: [], keywords: [],
    };
    // "restart" contains the substring "star" — a substring matcher would falsely score this.
    expect(scoreFeature(f, 'star')).toBe(0);
    expect(scoreFeature(f, 'workspace')).toBe(1); // real word-boundary hit
  });

  it('relatedFeaturesOf resolves only REAL related KB entries (drops dangling ids, never self)', () => {
    const feat = APP_KNOWLEDGE_BASE.find((f) => (f.relatedFeatures || []).length > 0)!;
    const related = relatedFeaturesOf(feat);
    const ids = new Set(APP_KNOWLEDGE_BASE.map((f) => f.id));
    for (const r of related) {
      expect(ids.has(r.id)).toBe(true);
      expect(r.id).not.toBe(feat.id);
    }
    // A dangling id is dropped rather than fabricated.
    const withDangling: any = { ...feat, relatedFeatures: ['___not_a_real_id___'] };
    expect(relatedFeaturesOf(withDangling)).toEqual([]);
  });

  it('on a score tie, the feature covering MORE of the query wins (relevance breadth)', () => {
    // "where is the wallet and billing" must surface Billing (matches wallet+billing), not a feature
    // that only caught the generic word "where".
    const r = searchFeatures('where is the wallet and billing');
    expect(r[0].feature.id).toBe('billing');
  });

  it('every starter suggestion resolves to a real, non-empty result', () => {
    expect(SUGGESTED_QUERIES.length).toBeGreaterThan(3);
    for (const s of SUGGESTED_QUERIES) {
      const a = answerOffline(s.query);
      expect(a.kind, `suggestion "${s.label}" (${s.query}) must resolve`).not.toBe('none');
      expect(a.matches.length).toBeGreaterThan(0);
    }
  });
});
