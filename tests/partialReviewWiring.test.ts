import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { BuildStoppedError } from '../src/server/AgentV3/stopSignal';
import { passAbort } from '../src/server/AgentV3/buildAbortCause';
import { workingLine } from '../src/server/AgentV3/workingHeartbeat';
import { collectReviewerWords, salvageReview } from '../src/server/AgentV3/partialReview';

/**
 * THE HALF THAT LIVES OUTSIDE THE TESTED FUNCTION.
 *
 * `salvageReview` is pure and covered, but it can only rescue findings someone actually captured. The
 * capture is a subscription inside the ~16,000-line build route, and IF IT IS EVER DROPPED, NOTHING
 * FAILS: no error, no failing build — the reviewer's findings simply go back to being discarded on
 * every timeout, and the only symptom is the silence the 2026-09-01 report described.
 *
 * Source-level, and honestly so: the block sits in a route closure that cannot be imported or
 * exercised in a unit test, and extracting the whole post-build path to test one subscription would be
 * a far larger change than it protects. Same trade, and the same reasoning, as cachePrefixWiring.
 *
 * ⚠️ 2026-10-13 (autopsy 9c612cdb, Q-999): the route no longer filters events itself. It hands EVERY event
 * to `collectReviewerWords` (partialReview.ts), which decides what is the reviewer's own words — because the
 * old in-route filter heard only `narration` and `agent_done`, and a one-call review cut off by its budget
 * says nothing on either. So the first two pins below moved from source text to BEHAVIOUR (stronger: they
 * now run the collector), and the one-call case that was silently lost is pinned end to end.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

describe('the reviewer is listened to while it works, so a timeout cannot bin its findings', () => {
  it('the route subscribes to the stream and hands every event to the reviewer-words collector', () => {
    expect(route).toContain("const reviewerSaid = collectReviewerWords('reviewer');");
    // No filter at the call site: a filter here is exactly how a whole channel was lost before.
    expect(route).toMatch(/events\.subscribe\(\(e\) => reviewerSaid\.take\(e\), false\);/);
  });

  it('the collector keeps the reviewer\'s own narration (and nobody else\'s)', () => {
    const words = collectReviewerWords('reviewer');
    words.take({ type: 'narration', agent: 'reviewer', text: '[WARNING] The list never clears after delete', ts: 1 });
    words.take({ type: 'narration', agent: 'architect', text: '[CRITICAL] not the reviewer', ts: 2 });
    expect(words.text()).toBe('[WARNING] The list never clears after delete');
  });

  it('the agent_done summary is collected too — the best case is the complete text', () => {
    const words = collectReviewerWords('reviewer');
    words.take({ type: 'agent_done', agent: 'reviewer', ok: true, summary: '[WARNING] Search ignores case', ts: 1 });
    expect(words.text()).toContain('[WARNING] Search ignores case');
  });

  it('it subscribes with replay OFF — an earlier turn\'s review must not leak into this one', () => {
    // subscribe() replays its whole buffer by default. With replay on, a second build in the same
    // session would salvage the PREVIOUS turn's findings and report them against new code.
    const i = route.indexOf('const stopListening = events.subscribe(');
    expect(i).toBeGreaterThan(0);
    expect(route.slice(i, i + 500)).toMatch(/reviewerSaid\.take\(e\), false\);/);
  });

  it('the listener is always detached — a leaked one would keep growing across turns', () => {
    const i = route.indexOf('const stopListening = events.subscribe(');
    const after = route.slice(i);
    expect(after).toMatch(/\} finally \{[\s\S]{0,400}stopListening\(\);/);
  });

  it('salvage is attempted BEFORE the "review could not run" concession', () => {
    const salvage = route.indexOf('salvageReview(reviewerSaid.text())');
    const concede = route.indexOf('reviewNotReadyUserLine(');
    expect(salvage).toBeGreaterThan(0);
    expect(concede).toBeGreaterThan(0);
    expect(salvage).toBeLessThan(concede);
  });

  it('a salvaged review is recorded as REVIEW_PARTIAL, not as a completed review', () => {
    expect(route).toContain("code: 'REVIEW_PARTIAL'");
    // …and it must NOT be promoted into `review`, which downstream treats as a finished verdict and
    // feeds to the C9 auto-fix.
    // Window sized to clear the finding's (deliberately long) explanatory message; the assertion is
    // that `review` stays null, not that it happens within N characters.
    const i = route.indexOf("code: 'REVIEW_PARTIAL'");
    expect(route.slice(i, i + 900)).toContain('review = null;');
  });
});

// ── Autopsy 9c612cdb (Q-999) · a ONE-CALL review that its budget cuts off can still be salvaged ──────────
//
// The real build's lean review was one call with no tools (REVIEW_LEAN: "one call, no tools, handed all 10
// changed file(s) in full, 45s budget") and was conceded as REVIEW_SUGGESTIONS_NOT_READY at 453.1 s. A single
// turn narrates only when it RETURNS; until then its answer exists only as `stream_delta` text. The finding line
// below is a real-looking one for that app (a video list whose remove button did not persist).
const FINDING = '[WARNING] [BROKEN] The remove button never calls removeVideo, so a deleted video comes back after refresh';

/** Run a reviewer exactly as the route spawns a one-call review: role 'reviewer', no tools, its own signal. */
async function oneCallReviewCutOffByItsBudget(streamed: string[]): Promise<string> {
  const events = new AgentEventStream();
  const words = collectReviewerWords('reviewer');
  const stopListening = events.subscribe((e) => words.take(e), false);
  const reviewAbort = passAbort(undefined);
  const runner = new AgentRunner({
    client: {
      // The engine streams the start of its answer, then is still writing when our budget ends.
      runTurn: (p: { onText?: (d: string) => void; signal?: AbortSignal }) => new Promise((_res, rej) => {
        for (const d of streamed) p.onText?.(d);
        p.signal?.addEventListener('abort', () => rej(new BuildStoppedError({ provider: 'KIMI', model: 'kimi-k2.7-code' })));
      }),
    } as never,
    dispatcher: { dispatch: async () => ({}) } as never,
    state: new WorkspaceState(events),
    events,
    model: 'm',
    system: 'You are the reviewer.',
    tools: [],
    agentRole: 'reviewer',
    signal: reviewAbort.signal,
  });
  const done = runner.run('review');
  // The working clock fires while the call is in flight — it is not the reviewer's words.
  events.emit({ type: 'narration', agent: 'reviewer', text: workingLine(12_000), ts: Date.now(), id: 'working' });
  await new Promise((r) => setTimeout(r, 20));
  reviewAbort.abort('review-budget');
  await done;
  stopListening();
  reviewAbort.dispose();
  return words.text();
}

describe('Q-999 · the salvage net reaches a one-call review', () => {
  it('🔴 a finding that only ever streamed is recovered — REVIEW_PARTIAL, not REVIEW_SUGGESTIONS_NOT_READY', async () => {
    const said = await oneCallReviewCutOffByItsBudget(['## Review\n', '[WARNING] [BROKEN] The remove button never calls ', 'removeVideo, so a deleted video comes back after refresh\n', '[SUGG']);
    const salvaged = salvageReview(said);
    // In the route, `salvageReview(reviewerSaid.text()) !== null` is exactly the REVIEW_PARTIAL branch, taken
    // before the REVIEW_SUGGESTIONS_NOT_READY concession (pinned above and below).
    expect(salvaged).not.toBeNull();
    expect(salvaged!.issues).toHaveLength(1);
    expect(salvaged!.issues[0].severity).toBe('warning');
    expect(salvaged!.issues[0].message).toContain('removeVideo');
    // Its honesty rules are unchanged: an unfinished review never fails a build.
    expect(salvaged!.passed).toBe(true);
    expect(salvaged!.partial).toBe(true);
  });

  it('the working clock is never part of what the reviewer said', async () => {
    const said = await oneCallReviewCutOffByItsBudget([FINDING]);
    expect(said).not.toContain('Still working');
    expect(said).not.toContain('⏳');
  });

  it('a streamed turn that later narrates its final text is held ONCE, not twice', () => {
    const words = collectReviewerWords('reviewer');
    words.take({ type: 'stream_delta', agent: 'reviewer', id: 't1-1', kind: 'text', delta: '[WARNING] [BROKEN] The remove ', ts: 1 });
    words.take({ type: 'stream_delta', agent: 'reviewer', id: 't1-1', kind: 'text', delta: 'button never calls removeVideo', ts: 2 });
    words.take({ type: 'narration', agent: 'reviewer', id: 't1-1', text: FINDING, ts: 3 });
    words.take({ type: 'agent_done', agent: 'reviewer', ok: true, summary: FINDING, ts: 4 });
    expect(words.lines()).toEqual([FINDING]);
    expect(salvageReview(words.text())!.issues).toHaveLength(1);
  });

  it('two turns stay in order and are never interleaved', () => {
    const words = collectReviewerWords('reviewer');
    words.take({ type: 'stream_delta', agent: 'reviewer', id: 'a', kind: 'text', delta: '[WARNING] first ', ts: 1 });
    words.take({ type: 'stream_delta', agent: 'reviewer', id: 'b', kind: 'text', delta: '[WARNING] second', ts: 2 });
    words.take({ type: 'stream_delta', agent: 'reviewer', id: 'a', kind: 'text', delta: 'finding', ts: 3 });
    expect(words.lines()).toEqual(['[WARNING] first finding', '[WARNING] second']);
  });

  it('reasoning deltas and other agents\' text are not the reviewer\'s answer', () => {
    const words = collectReviewerWords('reviewer');
    words.take({ type: 'stream_delta', agent: 'reviewer', id: 'a', kind: 'thinking', delta: '[CRITICAL] maybe the build is broken?', ts: 1 });
    words.take({ type: 'stream_delta', agent: 'architect', id: 'a', kind: 'text', delta: '[CRITICAL] not the reviewer', ts: 2 });
    expect(words.text()).toBe('');
  });

  it('the sibling: the post-fix recheck runs in tools mode, so it cannot fall into the one-call gap without a test failing', () => {
    // Evidence, not assumption: the two `reviewBuild(` calls in the route. The first hands the code inline and can
    // run as ONE call — it has the collector. The recheck passes neither `inlineFiles` nor `toolsOverride: []`, so it
    // is the multi-step reviewer; it has no salvage of its own, and a salvaged verdict could not keep its criticals
    // unresolved anyway (an unfinished review never fails a build). If the recheck is ever made one-call, this fails
    // and the salvage has to come with it.
    const calls = [...route.matchAll(/reviewBuild\(\{/g)].map((m) => m.index!);
    expect(calls).toHaveLength(2);
    const [first, recheck] = calls;
    const firstBlock = route.slice(route.lastIndexOf('const reviewerSaid = collectReviewerWords(', first), first + 600);
    expect(firstBlock).toContain('inlineFiles');
    const recheckSpawn = route.slice(recheck, route.indexOf("'post-fix-review'", recheck));
    expect(recheckSpawn).not.toContain('inlineFiles');
    expect(recheckSpawn).not.toContain('toolsOverride');
  });
});
