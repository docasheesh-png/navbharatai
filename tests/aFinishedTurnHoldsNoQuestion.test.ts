// A FINISHED TURN HOLDS NO QUESTION (failedbr #2494, 2026-11-22, admin-approved).
//
// 🔴 WHAT HAPPENED. The game was done at 1147.6 s. The chat then said "Waiting for your answer above — the build carries
// on the moment you reply", and 30 s later "The deep bug hunt offer went unanswered, so it did not run". The question
// was about OPTIONAL extra work on a finished app, yet the user watched a spinner for it. Shortening the wait (90 s →
// 30 s, autopsy 2f46a4d8) had treated the instance; the class — a user wait AFTER the build's work — survived.
//
// 🧬 THE CLASS, LOCKED HERE: every `waitForUser(` in the build route is a question that changes HOW the app is built
// (rebuild confirmation, database offers, key popup, plan approval) and sits before the post-build review decision.
// A new wait after that point — whatever it asks — fails this census. The bug hunt is now a standing ❗️ row.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const route = read('src/server/routes/agentv3.ts');

/** Where the build's own work is over and only optional extras (the review) remain. */
const END_OF_WORK = 'const reviewerAllowed = reviewerShouldRun({';

describe('no user wait after the build has done its work', () => {
  it('the marker exists exactly once (if it moves, move it here — do not delete the census)', () => {
    expect(route.split(END_OF_WORK).length - 1).toBe(1);
  });

  it('every waitForUser call sits before the end of the work', () => {
    const end = route.indexOf(END_OF_WORK);
    const calls = [...route.matchAll(/\bwaitForUser\(/g)].map((m) => m.index ?? 0);
    expect(calls.length).toBeGreaterThan(0);
    const late = calls.filter((i) => i > end).map((i) => route.slice(i, i + 80));
    expect(late).toEqual([]);
  });

  it('no raw approval wait bypasses the one door either', () => {
    // `awaitApprovalOutcome` is called only inside `waitForUser` itself.
    expect([...route.matchAll(/\bawaitApprovalOutcome\(/g)]).toHaveLength(1);
  });

  it('the bug-hunt flow cannot wait: it takes no wait effect and imports no approval wait', () => {
    const mod = read('src/server/AgentV3/optionalBugHunt.ts');
    const sig = mod.slice(mod.indexOf('export async function offerBugHunt(io: {'), mod.indexOf('}): Promise<BugHuntResult>'));
    expect(sig).not.toMatch(/\bwait\s*:/);
    expect(mod).not.toMatch(/awaitApproval/);
    expect(mod).not.toMatch(/env\.AGENTV3_BUG_HUNT_WAIT_MS|function bugHuntWaitMs/); // the retired wait is not read
  });

  it('the offer is a non-blocking row: the screen does not auto-open over a finished build for it', async () => {
    const { actionsFromEvent } = await import('../src/server/AgentV3/userActions');
    const { bugHuntOfferCopy } = await import('../src/server/AgentV3/optionalBugHunt');
    const [row] = actionsFromEvent({ type: 'bug_hunt_offer', callId: 'c', ...bugHuntOfferCopy() }, 'b', 1);
    expect(row.blocking).toBe(false);
  });
});
