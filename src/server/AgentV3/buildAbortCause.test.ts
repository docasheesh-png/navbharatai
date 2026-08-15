import { describe, it, expect } from 'vitest';
import { abortBuild, abortCauseOf, abortSummary, isUserInitiated, type AbortCause } from './buildAbortCause';

/**
 * ADMIN REPORT 2026-08-15, verbatim: **"maine nahi roki, khud ruki hai bhai."**
 *
 * A 35.8-minute build against a 30-minute cap ended with "Build stopped by the user." The user had
 * touched nothing — the wall-clock watchdog stopped it, and six different callers of `abort()` all
 * produced that one sentence.
 *
 * These tests exist because both halves of the bug fail SILENTLY. A wrong attribution throws nothing,
 * and the suppressed recovery line ("your files are saved, send another message") is an ABSENCE — the
 * user cannot report a sentence they never saw.
 */

const ALL: AbortCause[] = ['user-stop', 'watchdog', 'advisory-cap', 'deploy-drain', 'lock-reclaimed', 'reaper', 'unknown'];

describe('the cause survives the abort', () => {
  it('round-trips through a real AbortController', () => {
    for (const cause of ALL) {
      const c = new AbortController();
      abortBuild(c, cause);
      expect(c.signal.aborted).toBe(true);
      expect(abortCauseOf(c.signal)).toBe(cause);
    }
  });

  it('a bare abort() reads as UNKNOWN, never as the user', () => {
    /**
     * THE CORE INVARIANT. Any abort path that forgets to record a cause must degrade to "we do not
     * know" — never to a specific accusation. Defaulting to 'user-stop' is the entire original bug,
     * so it must be impossible to reach by omission.
     */
    const c = new AbortController();
    c.abort();
    expect(abortCauseOf(c.signal)).toBe('unknown');
    expect(isUserInitiated(abortCauseOf(c.signal))).toBe(false);
  });

  it('a foreign abort reason is not mistaken for one of ours', () => {
    const c = new AbortController();
    c.abort(new Error('some library aborted this'));
    expect(abortCauseOf(c.signal)).toBe('unknown');
  });

  it('a missing or un-aborted signal answers unknown rather than throwing', () => {
    expect(abortCauseOf(undefined)).toBe('unknown');
    expect(abortCauseOf(null)).toBe('unknown');
    expect(abortCauseOf(new AbortController().signal)).toBe('unknown');
  });

  it('an environment whose abort() rejects an argument still aborts', () => {
    // Losing the cause is honest degradation; failing to abort would hang the build.
    let aborted = false;
    abortBuild({ abort: (r?: unknown) => { if (r !== undefined) throw new TypeError('no args'); aborted = true; } }, 'watchdog');
    expect(aborted).toBe(true);
  });
});

describe('what the user is told', () => {
  it('ONLY a real Stop says the user stopped it', () => {
    for (const cause of ALL) {
      const said = abortSummary(cause, { minutes: 30, builtSomething: true });
      if (cause === 'user-stop') expect(said).toMatch(/stopped by the user/i);
      else expect(said, cause).not.toMatch(/by the user/i);
    }
  });

  it('the watchdog tells the user their work SURVIVED and how to continue', () => {
    /**
     * The expensive half. This sentence already existed in the watchdog branch and was unreachable
     * because the abort branch answered first — so a user who had just lost 36 minutes was also not
     * told the work was saved and resumable.
     */
    const said = abortSummary('watchdog', { minutes: 30, builtSomething: true });
    expect(said).toMatch(/30 min/);
    expect(said).toMatch(/saved/i);
    expect(said).toMatch(/continue/i);
  });

  it('it does NOT promise saved work when nothing was written', () => {
    // The same dishonesty pointing the other way — reassurance has to be earned by real files.
    const said = abortSummary('watchdog', { minutes: 30, builtSomething: false });
    expect(said).not.toMatch(/saved/i);
    expect(said).toMatch(/Nothing was lost/i);
  });

  it('the advisory cap does not describe a BUILT app as stopped', () => {
    // The app is finished here; only the post-build extras ran long. Calling that a stopped build
    // reports a success as a failure.
    const said = abortSummary('advisory-cap', { builtSomething: true });
    expect(said).toMatch(/built/i);
    expect(said).not.toMatch(/^I stopped/);
  });

  it('a deploy drain says the build resumes by itself', () => {
    // It genuinely does — telling the user to start over would waste a build that is about to continue.
    expect(abortSummary('deploy-drain')).toMatch(/resumes automatically/i);
  });

  it('an unknown cause admits it instead of inventing one', () => {
    const said = abortSummary('unknown', { builtSomething: true });
    expect(said).toMatch(/stopped before it finished/i);
    expect(said).not.toMatch(/by the user|too long|deploy/i);
  });

  it('every cause produces a real sentence', () => {
    for (const cause of ALL) {
      const said = abortSummary(cause, { minutes: 30, builtSomething: true });
      expect(said.length, cause).toBeGreaterThan(20);
      expect(said.trim(), cause).toBe(said.trim().replace(/\s+$/, ''));
    }
  });
});

describe('the report must not file a platform stop under the user', () => {
  it('only user-stop counts as user-initiated', () => {
    // One level up, the same misattribution would quietly distort every quality metric built on these
    // reports — "users abandon builds" when in fact the platform timed them out.
    for (const cause of ALL) expect(isUserInitiated(cause), cause).toBe(cause === 'user-stop');
  });
});
