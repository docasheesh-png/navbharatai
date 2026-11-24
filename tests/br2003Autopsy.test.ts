/**
 * BR2003 autopsy: a very large quiz-app spec (free Weak, first build) failed in about one second with
 * SANDBOX_RECOVERY_UNAVAILABLE ("Your workspace could not be safely reconnected") — the BR1993 shape, in the
 * same E2B-cap window as BR1999/BR2001. Every defect it shows is already closed on main; this file pins the
 * two that this report exercises directly, with its own shape. Fixtures are synthetic.
 */
import { describe, expect, it } from 'vitest';
import { etaAccuracy, ETA_UNTESTED_OUTCOMES } from '../src/server/AgentV3/BuildDiagnostics';
import { analyzeAppScope, requestSubject } from '../src/server/lib/appScopeAnalyzer';

describe('BR1986 closure: a one-second setup failure does not score the ETA', () => {
  it('🔴 the report shape: 11.7–17.3 min promised, 990 ms to a sandbox outcome → untested, not "UNDER the band"', () => {
    expect(ETA_UNTESTED_OUTCOMES.has('OUTCOME_SANDBOX_UNAVAILABLE')).toBe(true);
    const a = etaAccuracy({ estimateMs: 791_396, lowMs: 700_385, highMs: 1_040_806, evidenced: true } as never, 1_000_000, 1_000_990, 'OUTCOME_SANDBOX_UNAVAILABLE');
    expect(a?.untested).toBe(true);
    expect(a?.line).not.toMatch(/UNDER the band/);
    expect(a?.line).toMatch(/does not test completion time/);
  });
  it('neighbour: a real build that finished early is still scored UNDER', () => {
    const a = etaAccuracy({ estimateMs: 791_396, lowMs: 700_385, highMs: 1_040_806, evidenced: true } as never, 1_000_000, 1_060_000, '');
    expect(a?.untested).toBeUndefined();
    expect(a?.line).toMatch(/UNDER/);
  });
});

describe('Q-2770 (BR2003 D6): a sectioned spec with product parts is a project, whatever small word its name holds', () => {
  const SPEC = [
    'Project Name: Quiz Master – 1 Lakh Questions',
    '',
    'Create a professional quiz game application.',
    '1. Question Database',
    '- 100,000+ MCQ questions with bulk CSV/Excel/JSON import',
    '2. Game Interface', '- timer, prize ladder, animations, sound',
    '3. Lifelines', '- 50:50, audience poll, expert advice, question change, double dip',
    '4. Learning Mode', '- practice, mock tests, bookmarks',
    '5. User Features', '- login with mobile/email, profile, leaderboard, streak, badges, offline mode',
    '6. Admin Dashboard', '- add/edit/delete questions, bulk upload, analytics, duplicate detection',
    '7. Technology', '- Node.js backend, PostgreSQL, Firebase auth, cloud storage',
  ].join('\n');
  it('🔴 the report: the header names the app, and the spec goes to the planner (admin decision 2026-11-24)', () => {
    expect(requestSubject(SPEC)).toBe('Quiz Master');
    const r = analyzeAppScope(SPEC);
    expect(r.decision).toBe('analyze');
    expect(r.signals.join(' | ')).toMatch(/a 7-section spec with \d product parts/);
  });
  it('a small app stays small: a quiz with sections but no product parts, and a one-liner', () => {
    const small = ['A quiz app.', '1. Questions', '- ten questions', '2. Score', '- show the score', '3. Timer', '- 30 seconds', '4. Colours', '- dark mode', '5. Sound', '- a beep', '6. Restart', '- play again'].join('\n');
    expect(analyzeAppScope(small).decision).toBe('direct');
    expect(analyzeAppScope('make a quiz app with 10 questions').decision).toBe('direct');
  });
  it('a header without "name" or "title" is not a name header', () => {
    expect(requestSubject('App: a calculator')).toBe('App');
    expect(requestSubject('Game Title - Space Run')).toBe('Space Run');
    expect(requestSubject('**Project Name:** Shop Pro, with cart')).toBe('Shop Pro');
  });
});
