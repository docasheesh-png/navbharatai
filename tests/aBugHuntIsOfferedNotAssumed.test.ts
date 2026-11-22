/**
 * ❓ THE DEEP BUG HUNT IS OFFERED, NOT ASSUMED (admin 2026-10-13).
 *
 * Admin, verbatim: *"helper, verifier jo app banne ke bad last me check karta hai, ko optional kar do"* —
 * a ❓ question in the chat, "Yes" running the helper that already exists, "No" meaning the build is
 * complete as it stands.
 *
 * 🔴 WHAT WAS ACTUALLY WRONG. The post-build reviewer is a multi-call model pass the user ALREADY PAID
 * FOR, on every build, silently. The route's own comment records the size: *"40 calls, 523,374 input
 * tokens = 34.4% of the build, responseChars: 0 on every one, and then no verdict at all — all of it
 * billed at ×4"*. This change does not add a charge; it shows an existing one to the person paying it.
 *
 * These tests lock the three properties that are easy to lose later:
 *   1. the question is never asked for a pass that was not going to run (a charge for nothing);
 *   2. only an explicit YES spends the money — and since failedbr #2494 nothing WAITS for it: the offer is a
 *      standing ❗️ row, and the yes is the user starting a bug-hunt turn from it (`preApproved`);
 *   3. a hunt that did not run is REPORTED as not run, never as passed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  offerBugHunt, bugHuntOfferDecision, bugHuntOfferCopy, bugHuntAskEnabled, bugHuntOfferedLine,
  type BugHuntOfferEvent,
} from '../src/server/AgentV3/optionalBugHunt';

const read = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');

/** A harness that records every effect, so a test can assert what the user actually saw. */
function harness(over: Partial<Parameters<typeof offerBugHunt>[0]> = {}) {
  const asked: BugHuntOfferEvent[] = [];
  const said: string[] = [];
  const recorded: string[] = [];
  const io = {
    eligible: true,
    hasUser: true,
    newCallId: () => 'call-1',
    offer: (g: BugHuntOfferEvent) => { asked.push(g); },
    say: (t: string) => { said.push(t); },
    record: (m: string) => { recorded.push(m); },
    env: {} as NodeJS.ProcessEnv,
    ...over,
  };
  return { io, asked, said, recorded };
}

describe('the question is never asked for a pass that was not going to run', () => {
  it('an ineligible turn is not asked, and the review stays off exactly as before', async () => {
    const h = harness({ eligible: false });
    const out = await offerBugHunt(h.io);
    expect(h.asked).toEqual([]);
    expect(out.answer).toBeNull();
    // `runReview` mirrors eligibility, so an un-offered turn behaves byte-for-byte as it did before.
    expect(out.runReview).toBe(false);
  });

  it('an anonymous caller is not asked — there is no wallet the answer could spend from', async () => {
    const h = harness({ hasUser: false });
    const out = await offerBugHunt(h.io);
    expect(h.asked).toEqual([]);
    expect(out.runReview).toBe(true); // eligible, just never asked: today's behaviour
    expect(bugHuntOfferDecision({ hasUser: false, askEnabled: true, reviewEligible: true, alreadyAsked: false }))
      .toEqual({ ask: false, why: 'no-user' });
  });

  it('ineligibility outranks every other reason, so the "why" names the real one', () => {
    expect(bugHuntOfferDecision({ hasUser: false, askEnabled: false, reviewEligible: false, alreadyAsked: true }))
      .toEqual({ ask: false, why: 'review-not-eligible' });
  });
});

describe('only an explicit YES spends the money, and nothing waits for it (failedbr #2494)', () => {
  it('an offered hunt does not run this turn, and the turn is not held for an answer', async () => {
    const h = harness();
    const out = await offerBugHunt(h.io);
    expect(h.asked).toHaveLength(1);
    expect(out).toEqual({ runReview: false, answer: null, offered: true });
    // The io has no `wait` at all: there is nothing the flow could block on.
    expect(Object.keys(h.io)).not.toContain('wait');
  });

  it('the yes is the user starting a bug-hunt turn: then it runs, and nothing is offered again', async () => {
    const h = harness({ preApproved: true });
    const out = await offerBugHunt(h.io);
    expect(out).toEqual({ runReview: true, answer: 'approved' });
    expect(h.asked).toEqual([]);
    expect(h.said).toEqual([]);
  });
});

describe('a hunt that did not run is reported as NOT RUN, never as passed', () => {
  it('the user is told it did not run, where the choice is, and is not told the app is clean', async () => {
    const h = harness();
    await offerBugHunt(h.io);
    expect(h.said).toEqual([bugHuntOfferedLine()]);
    const line = h.said[0].toLowerCase();
    expect(line).toContain('did not run');
    expect(line).toContain('find and fix bugs');
    expect(line).not.toMatch(/waiting|reply/); // the turn is over — nothing is waiting for an answer
    for (const lie of ['passed', 'no bugs', 'no issues', 'bug-free', 'all clear', 'looks good']) {
      expect(line).not.toContain(lie);
    }
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]).toContain('did not run');
    expect(h.recorded[0]).toContain('without holding the build open');
  });

  it('the offered line names the same button the ❗️ row shows', () => {
    expect(bugHuntOfferedLine()).toContain(`"${bugHuntOfferCopy().approveLabel}"`);
  });
});

describe('the offer itself', () => {
  const copy = bugHuntOfferCopy();

  it('names no amount — a token-metered cost has no honest number before it runs', () => {
    const text = `${copy.title} ${copy.why} ${copy.approveLabel} ${copy.denyLabel}`;
    expect(text).not.toMatch(/[₹$]/);
    expect(text).not.toMatch(/\d/); // not one digit: a figure here would be a fabricated quote
    // What the user IS owed up front: that it costs, and from where.
    expect(copy.why.toLowerCase()).toContain('credits');
    expect(copy.why.toLowerCase()).toContain('wallet');
  });

  it('says free and gift credits count, because they do', () => {
    expect(copy.why.toLowerCase()).toMatch(/free and gift credits/);
  });

  it('does not frighten the user about an app that is already working', () => {
    expect(copy.why.toLowerCase()).toContain('already built');
  });

  it('is English — the platform speaking, not the AI (the 2026-09-14 Devanagari-price correction)', () => {
    const text = `${copy.title} ${copy.why} ${copy.approveLabel} ${copy.denyLabel}`;
    expect(text).not.toMatch(/[ऀ-ॿ]/);
  });

  it('its buttons do not offer to BUILD, because nothing is built', () => {
    expect(copy.approveLabel.toLowerCase()).not.toContain('build');
    expect(copy.denyLabel.toLowerCase()).not.toContain('build');
    expect(copy.title).toMatch(/\?$/); // it is a question, so it ends like one
  });
});

describe('the kill switch turns the ASK off, never the review', () => {
  it('off restores today\'s behaviour: the review runs, unasked', async () => {
    const h = harness({ env: { AGENTV3_BUG_HUNT_ASK: 'off' } as NodeJS.ProcessEnv });
    const out = await offerBugHunt(h.io);
    expect(h.asked).toEqual([]);
    expect(out.runReview).toBe(true);
    expect(bugHuntAskEnabled({ AGENTV3_BUG_HUNT_ASK: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(bugHuntAskEnabled({} as NodeJS.ProcessEnv)).toBe(true); // default ON
  });
});

describe('a broken offer can never cancel the app\'s deepest check (fail-open, on purpose)', () => {
  it('a throw while asking leaves the review running, as if the feature did not exist', async () => {
    const h = harness({ offer: () => { throw new Error('event stream gone'); } });
    const out = await offerBugHunt(h.io);
    expect(out.runReview).toBe(true);
    expect(out.answer).toBeNull();
  });
});

describe('source guards — the wiring itself, which no unit test can see', () => {
  const route = read('src/server/routes/agentv3.ts');

  it('the offer goes through the event stream as a standing row, and nothing waits on it (failedbr #2494)', () => {
    expect(route).toContain("offer: (o) => events.emit({ type: 'bug_hunt_offer'");
    expect(route).not.toContain('bugHuntWaitMs');
    expect(route).not.toContain('awaitApprovalOutcome(huntCallId');
  });

  it('the review is gated on the answer at the ONE place that already decided it', () => {
    expect(route).toContain('&& bugHunt.runReview) {');
    expect((route.match(/await offerBugHunt\(/g) ?? []).length).toBe(1);
  });

  it('the handler stays at ONE call, because this file is on the TS2563 ceiling (Q-979)', () => {
    // The first version of this feature inlined its lets, ifs and trys here and the file stopped
    // type-checking. The cost of a branch in this handler is the whole file.
    const from = route.indexOf('const bugHunt = await offerBugHunt({');
    expect(from).toBeGreaterThan(0);
    // The call expression ONLY — up to and including the `});` that closes it.
    const call = route.slice(from, route.indexOf('\n      });', from) + 10);
    expect(call).not.toMatch(/\bif\s*\(/);     // no branch
    expect(call).not.toMatch(/\blet\b/);        // no mutable state
    expect(call).not.toMatch(/\bawait\b.*\bawait\b/s); // one await, not a sequence
    expect(call.match(/\btry\s*\{/g) ?? []).toHaveLength(2); // the two one-line best-effort wrappers
    expect(call).not.toContain('waitForUser'); // the offer never holds the end of a build
  });

  it('the offer is turn-local, so the next edit asks again (admin decision 2026-10-13)', () => {
    const mod = read('src/server/AgentV3/optionalBugHunt.ts');
    expect(mod).toContain('alreadyAsked: false');
    // Nothing is persisted: no store, nothing to forget, nothing to reset.
    expect(mod).not.toMatch(/Store|firestore|getDb|collection\(/);
  });
});

describe('the structured gate stays backwards compatible', () => {
  it('a gate that names nothing renders exactly as it does today', () => {
    const view = read('src/components/agentv3/userActionView.ts');
    expect(view).toContain('title: g.title?.trim() || g.action');
    const tray = read('src/components/agentv3/UserActionTray.tsx');
    expect(tray).toContain('{action.approveLabel ?? <>Approve &amp; build</>}');
    expect(tray).toContain("{action.denyLabel ?? 'Reject'}");
  });

  it('the standing offer is a non-blocking ❗️ row with the real labels', async () => {
    const { actionsFromEvent } = await import('../src/server/AgentV3/userActions');
    const copy = bugHuntOfferCopy();
    const [row] = actionsFromEvent({ type: 'bug_hunt_offer', callId: 'c-9', ...copy }, 'b', 1);
    expect(row).toMatchObject({ kind: 'approve', title: copy.title, why: copy.why, approveLabel: copy.approveLabel, denyLabel: copy.denyLabel, blocking: false, status: 'open' });
  });
});
