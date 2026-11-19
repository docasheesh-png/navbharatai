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

describe('Q-2770 pin: how today\'s sizer reads a "Project Name:" headed spec (no behaviour change here)', () => {
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
  it('pins today\'s facts, so a change to the sizer is deliberate', () => {
    // The subject reader stops at the label's colon: the "app itself" is named "Project Name".
    expect(requestSubject(SPEC)).toBe('Project Name');
    // The report's own line, reproduced: a seven-section spec with an admin dashboard, auth, a backend and
    // 100,000 questions is "kept as one build" because the word "Quiz" vetoes the mega signals. Q-2770 decides
    // whether that is right; this pin makes any change to it deliberate.
    const r = analyzeAppScope(SPEC);
    expect(r.decision).toBe('direct');
    expect(r.signals).toEqual(['mentions a small feature ("Quiz") but the app itself is "Project Name" — kept as one build (today\'s behaviour)']);
  });
});
