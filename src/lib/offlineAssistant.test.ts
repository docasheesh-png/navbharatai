import { describe, it, expect } from 'vitest';
import { searchFeatures, answerOffline, howToSteps, scoreFeature, navFor } from './offlineAssistant';
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
});
