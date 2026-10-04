// Q-398 (autopsy Sur Taal, 2026-10-04; admin accepted the recommendation). APP_SCOPE said a nine-screen
// music player was a "single-purpose app" because one of its features is a Sleep Timer — the small word
// was read anywhere in the request. The REASON is now read from the request's subject; the DECISION is
// deliberately unchanged (measured: 0 of 7,403 test prompts change decision or dispute).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeAppScope, requestSubject, namesASmallApp, scopeDispute } from '../src/server/lib/appScopeAnalyzer';

const SUR_TAAL = readFileSync('tests/fixtures/surTaalPrompt.txt', 'utf8');

describe('the subject of a request', () => {
  it('is the first line, cut where the feature list starts', () => {
    expect(requestSubject('todo app with dark mode, labels and search')).toBe('todo app');
    expect(requestSubject('weather app — 7 day forecast')).toBe('weather app');
    expect(requestSubject('ek calculator banao jisme history ho')).toBe('ek calculator banao');
    expect(requestSubject(SUR_TAAL)).toContain('म्यूजिक प्लेयर ऐप');
  });
  it('a small word in the subject names a small app; after it, a feature', () => {
    expect(namesASmallApp('make a calculator')).toBe(true);
    expect(namesASmallApp('Build a pomodoro timer')).toBe(true);
    expect(namesASmallApp(SUR_TAAL)).toBe(true); // a music player, read from the subject
    expect(namesASmallApp('social network with chat, feed, profiles and a countdown timer')).toBe(false);
    expect(namesASmallApp('hospital management system with invoice and form')).toBe(false);
  });
});

describe('the reason says which', () => {
  it('a feature word is named as a feature, not as what the app is', () => {
    const s = analyzeAppScope('chat app with feed, profiles and a countdown timer');
    expect(s.signals.join(' ')).not.toMatch(/single-purpose app/);
    expect(s.signals.join(' ')).toMatch(/mentions a small feature \("timer"\) but the app itself is "chat app"/);
    expect(s.smallSubject).toBe(false);
  });
  it('the music player is single-purpose because it IS a player, and its 8 sections are 8 features', () => {
    const s = analyzeAppScope(SUR_TAAL);
    expect(s.decision).toBe('direct');
    expect(s.smallSubject).toBe(true);
    expect(s.signals).toContain('~8 distinct features requested');
  });
  it('the decision and the dispute still read any small word (no planner call added)', () => {
    const s = analyzeAppScope('chat app with feed, profiles and a countdown timer');
    expect(s.smallHint).toBe(true);
    expect(s.decision).toBe('direct');
    const famous = analyzeAppScope('a quiz app like Instagram style with timer');
    if (famous.decision === 'analyze') expect(scopeDispute(famous, { complex: false })).not.toBeNull();
  });
});
