import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { plannerDomainBrief, PLANNER_MAX_QUESTIONS } from '../src/server/AgentV3/RoleChats';
import { knowledgeFromList } from '../src/server/lib/domainKnowledge';

/**
 * PLAN MODE SHOWS THE PLAN AND ASKS THE FEW QUESTIONS THAT MATTER (admin, 2026-09-17).
 *
 * Two asks on one day turned out to be one change: *"agar cheez clear nahi hai … user se direct
 * puchna chahiye"* and *"Lovable/Bolt user ko plan dikhate hain … 'plan' wale option me yeh sikha
 * sakte hai?"* The domain knowledge existed since 2026-07-19 and had never reached the planner.
 */
// The brief now takes the RESOLVED knowledge (list first, model only where the list is silent —
// `domainKnowledge.ts`, 2026-09-18). These helpers hand it the LISTED answer, which is exactly what
// the route resolves for these prompts, so every assertion below means what it meant before.
const brief = (p: string, empty = true) =>
  plannerDomainBrief('planner', p, { projectIsEmpty: empty, knowledge: knowledgeFromList(p) });

describe('the planner finally gets the domain knowledge', () => {
  it('a hospital app is told what a hospital app needs', () => {
    const b = brief('hospital management app banao');
    expect(b).toContain('healthcare');
    expect(b).toContain('role-based access');
    expect(b).toContain('audit log');
  });

  it('a restaurant is told what a restaurant needs — not what a shop needs', () => {
    const b = brief('restaurant ke liye app with menu and table orders');
    expect(b).toContain('restaurant');
  });

  it('the plan comes FIRST, and is never held back waiting for answers', () => {
    const b = brief('hospital app banao');
    expect(b).toMatch(/Open with the PLAN itself/);
    expect(b).toMatch(/never be held back waiting for answers/);
  });

  it('the user can always say "you decide" — the escape is mandatory, not optional', () => {
    expect(brief('hospital app banao')).toMatch(/tell you to decide/);
  });

  it('asks at most three questions — a plan that interrogates is not a plan', () => {
    const b = brief('hospital app banao');
    const asked = b.split('\n').filter((l) => l.startsWith('- Does it need'));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.length).toBeLessThanOrEqual(PLANNER_MAX_QUESTIONS);
  });

  it('India-first defaults ride along when the user\'s OWN words name the market', () => {
    const b = brief('ek shop ka billing app banao GST ke sath');
    expect(b).toContain('₹');
    expect(b).toMatch(/UPI/);
    expect(b).toMatch(/GST-compliant invoice/);
  });
});

describe('where it must stay silent — a plan that nags is worse than one that assumes', () => {
  it('an ordinary app with no domain gets nothing at all', () => {
    // ⚠️ "todo" is NOT such an app — `productivity` is a real domain in the analyser, so a todo list
    // legitimately gets a brief. Asserted here with prompts that genuinely match no domain, because a
    // test built on a wrong assumption about the analyser would pin the wrong behaviour.
    expect(brief('a calculator')).toBe('');
    expect(brief('ek stopwatch banao')).toBe('');
  });

  it('a LIVE project gets nothing — "does it need login?" is noise to someone who has login', () => {
    expect(brief('hospital app banao', false)).toBe('');
  });

  it('the ADVISOR is untouched — it reviews code, it does not scope new apps', () => {
    expect(plannerDomainBrief('advisor', 'hospital app banao', { projectIsEmpty: true, knowledge: knowledgeFromList('hospital app banao') })).toBe('');
  });

  it('costs no model call — the analyser is deterministic, so the same prompt gives the same brief', () => {
    expect(brief('hospital app banao')).toBe(brief('hospital app banao'));
  });
});

describe('the wiring, and the decision it must not quietly reverse', () => {
  const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

  it('the brief reaches the planner\'s system prompt', () => {
    expect(route).toContain('const domainBrief = plannerDomainBrief(chatRole, prompt,');
    expect(route).toContain('+ domainBrief;');
  });

  it('it is gated on the project being EMPTY, read from the real files', () => {
    expect(route).toContain('const projectIsEmpty = Object.keys(roleFiles).length === 0;');
  });

  // 🔒 THE BUILD LANE STILL NEVER ASKS. The 2026-07-20 decision (requirement awareness is
  // friction-free; a build order gets an app, not an interview) is NOT reopened by this change —
  // only Plan mode asks, because a user who switched to Plan asked to think first.
  it('the builder\'s own guidance still says to skip silently rather than ask', () => {
    const analyzer = readFileSync(resolve(__dirname, '../src/server/lib/RequirementGapAnalyzer.ts'), 'utf8');
    expect(analyzer).toContain('skip it silently rather than asking');
  });
});
