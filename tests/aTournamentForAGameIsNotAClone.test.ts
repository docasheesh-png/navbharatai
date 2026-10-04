// Q-516 (autopsy 39e982bd, 2026-10-04) — "PrimeClash Esports", a tournament app FOR Free Fire players.
//
// Two detectors told the admin's report something false about it:
//   • APP_SCOPE recorded the reason *"clone of Free Fire"*. The planner was still right (228 features
//     escalate on their own), but a false reason sends the next autopsy to the wrong place.
//   • REQUIREMENT_GAPS called it ECOMMERCE (wallet, offers, deposits) and asked *"Does it need inventory
//     tracking?"* of an esports app.
//
// The class: a product named as the AUDIENCE or the EVENT ("Free Fire players", "Free Fire tournaments")
// is being served, not cloned; and an event app had no domain of its own. Measured over every prompt-like
// string in the test suite (52,779): no scope decision changed, and only the four 39e982bd lines changed
// domain (general → tournament).
//
// ⚠️ The report's full prompt is not stored in the repo; the lines quoted in
// tests/theAppWasOffScreenForEightMinutes.test.ts are used verbatim, and the shapes below them are
// RECONSTRUCTIONS of what such a request says (labelled as such).
import { describe, it, expect } from 'vitest';
import { analyzeAppScope, namesAsProduct } from '../src/server/lib/appScopeAnalyzer';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';

const REPORT_LINES = [
  'BUILD PRIMECLASH ESPORTS — COMPLETE ANDROID APPLICATION',
  'Build a complete, functional Android esports tournament application named PrimeClash Esports.',
];
// Reconstructions of the request's shape (not the report's text).
const RECONSTRUCTED = [
  'Build a tournament app for Free Fire players with wallet, entry fees, offers and deposits',
  'Free Fire tournament app banao — room ID, prize pool, leaderboard',
  'PrimeClash Esports: Free Fire tournaments, squad registration, room IDs, wallet deposits and offers, shop for diamonds',
];
const FREE_FIRE = /\bfree\s?fire\b/i;

describe('a product named as the audience or the event is not a clone', () => {
  it.each(RECONSTRUCTED)('not a clone: %s', (p) => {
    const s = analyzeAppScope(p);
    expect(s.famousApp).toBeNull();
    expect(s.signals.join(' ')).not.toMatch(/clone/);
  });

  it.each([
    'Free Fire players', 'Free Fire tournaments', 'Free Fire ka tournament', 'Free Fire room ID', 'Free Fire diamonds top-up',
    'an app for Free Fire', 'Free Fire esports',
  ])('"%s" serves the game', (p) => expect(namesAsProduct(p, FREE_FIRE)).toBe(false));

  it.each([
    'Make a game like Free Fire', 'Free Fire jaisa game banao', 'a Free Fire clone', 'Free Fire banao',
    'like Free Fire players fighting on an island', 'Free Fire players wala game jaisa banao',
  ])('🔒 a likeness still names the product to clone: %s', (p) => {
    expect(namesAsProduct(p, FREE_FIRE)).toBe(true);
    expect(analyzeAppScope(p).famousApp).toBe('Free Fire');
  });
});

describe('a tournament app has its own domain', () => {
  it.each([...REPORT_LINES, ...RECONSTRUCTED])('tournament, never ecommerce: %s', (p) => {
    const g = analyzeRequirementGaps(p);
    expect(g.domain).toBe('tournament');
    expect(g.clarifyingQuestions.join(' ')).not.toMatch(/inventory/i);
  });

  it('asks what a tournament app needs', () => {
    const g = analyzeRequirementGaps('Build a tournament app for Free Fire players with wallet, entry fees, offers and deposits');
    expect(g.mentioned).toContain('entry fees, prize pool and payouts');
    expect(g.likelyMissing).toEqual(expect.arrayContaining(['brackets, rounds and match schedule', 'match rooms (room ID and password shared at start)']));
  });

  it.each([
    ['make a chess tournament manager with knockout rounds', 'tournament'],
    ['Make a game like Free Fire', 'game'],
    ['an online store for selling cricket bats', 'ecommerce'],
    ['a modal with a dark scrim overlay', 'general'],
  ])('the neighbours keep their domain: %s → %s', (p, d) => expect(analyzeRequirementGaps(p).domain).toBe(d));
});
