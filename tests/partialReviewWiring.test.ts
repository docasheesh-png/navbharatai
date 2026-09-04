import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

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
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

describe('the reviewer is listened to while it works, so a timeout cannot bin its findings', () => {
  it('the route subscribes to the stream and collects the reviewer\'s own narration', () => {
    expect(route).toContain('const reviewerSaid: string[] = [];');
    expect(route).toMatch(/e\.type === 'narration' && e\.agent === 'reviewer'/);
  });

  it('the agent_done summary is collected too — the best case is the complete text', () => {
    expect(route).toMatch(/e\.type === 'agent_done' && e\.agent === 'reviewer'/);
  });

  it('it subscribes with replay OFF — an earlier turn\'s review must not leak into this one', () => {
    // subscribe() replays its whole buffer by default. With replay on, a second build in the same
    // session would salvage the PREVIOUS turn's findings and report them against new code.
    const i = route.indexOf('const stopListening = events.subscribe(');
    expect(i).toBeGreaterThan(0);
    expect(route.slice(i, i + 500)).toMatch(/\}, false\);/);
  });

  it('the listener is always detached — a leaked one would keep growing across turns', () => {
    const i = route.indexOf('const stopListening = events.subscribe(');
    const after = route.slice(i);
    expect(after).toMatch(/\} finally \{[\s\S]{0,400}stopListening\(\);/);
  });

  it('salvage is attempted BEFORE the "review could not run" concession', () => {
    const salvage = route.indexOf('salvageReview(reviewerSaid.join(');
    const concede = route.indexOf('the post-build review could not run this time');
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
