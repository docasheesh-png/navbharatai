import { describe, it, expect } from 'vitest';
import {
  COMMON_DEV_PORTS, buildPortSweepCommand, parsePortSweep, portCandidates,
  shouldSweep, sweepFoundSummary, isUsablePort, SWEEP_HIT, SWEEP_MISS,
} from './portSweep';

/**
 * ADMIN 2026-08-15: "preview port ko smart switch banao — ek port par hard fix nahi rakho, ek jagah
 * nahi chale to dusre par try karo."
 *
 * THE BUILD BEHIND IT. The model launched the dev server itself with `timeout 20 npm run dev 2>&1 ||
 * true` — piped, so the port-pinning helpers correctly skipped it — the app came up on 3000, the
 * framework had been read as `vite-react` so the platform watched 5173, and a perfectly healthy server
 * was reported dead. The model then spent its last ten minutes trying to MOVE the working server onto
 * the port the platform wanted.
 *
 * The sweep only decides where the user's preview points, so the tests care most about the two ways it
 * could do harm: costing time on a build that was fine, and pointing the preview at a port that is not
 * really serving.
 */

describe('it costs nothing when the app is where we expected', () => {
  it('does not run at all while the expected port is up', () => {
    // The entire happy path. A healthy build must be byte-for-byte what it was before this existed.
    expect(shouldSweep(true)).toBe(false);
    expect(shouldSweep(false)).toBe(true);
  });

  it('probes the expected port FIRST, even though it just failed', () => {
    /**
     * A server slow to bind may answer by the time the sweep runs, and re-confirming the port we
     * already believe in is the cheapest correct answer there is. It also means the common case exits
     * the loop immediately instead of walking the whole list.
     */
    expect(portCandidates(4321)[0]).toBe(4321);
  });

  it('never probes the same port twice', () => {
    // Every duplicate is 2 more seconds on a sandbox that is, by definition, already misbehaving.
    const c = portCandidates(3000, [5173, 3000]);
    expect(new Set(c).size).toBe(c.length);
  });

  it('covers the ports this platform actually sees, in a bounded list', () => {
    // 3000 (Node/Express/Next and the platform default) and 5173 (Vite) lead; 5000 is both the
    // Replit-style fullstack default and the port the mitrify import used.
    expect(COMMON_DEV_PORTS.slice(0, 3)).toEqual([3000, 5173, 5000]);
    // Bounded on purpose — the worst case is ~2s per candidate.
    expect(COMMON_DEV_PORTS.length).toBeLessThanOrEqual(12);
  });
});

describe('the command it runs', () => {
  it('is ONE command for every candidate, not one per port', () => {
    /**
     * THE CONSTRAINT THAT SHAPED THIS. The report that prompted the work measured a bare `ls -la` at
     * 116 SECONDS on a degraded sandbox. A round trip per port could outlast the build.
     */
    const cmd = buildPortSweepCommand([3000, 5173, 5000]);
    expect(cmd.startsWith('for p in 3000 5173 5000;')).toBe(true);
    expect((cmd.match(/curl/g) || []).length).toBe(1);
  });

  it('stops at the first responder instead of probing the rest', () => {
    expect(buildPortSweepCommand([3000, 5173])).toContain('exit 0');
  });

  it('bounds every probe, so a black-holing port cannot hang the sweep', () => {
    expect(buildPortSweepCommand([3000])).toContain('--max-time 2');
  });

  it('accepts any HTTP status, because a dev server answering 404 is still running', () => {
    // Demanding 200 would reject every app whose root path is not a page — reporting a healthy server
    // as dead, which is the bug being fixed, reintroduced from the other side.
    expect(buildPortSweepCommand([3000])).toContain('-o /dev/null');
    expect(buildPortSweepCommand([3000])).not.toMatch(/http_code|-w\s/);
  });

  it('an empty candidate list says MISS rather than running nothing', () => {
    // An empty string would be a shell no-op whose blank output parses as a miss by accident. Saying
    // it explicitly means the two cases can never be confused.
    expect(buildPortSweepCommand([])).toBe(`echo ${SWEEP_MISS}`);
    expect(buildPortSweepCommand([0, -1, 99999] as number[])).toBe(`echo ${SWEEP_MISS}`);
  });
});

describe('reading the answer — strict, because it re-points the user\'s preview', () => {
  it('finds the port in a noisy log', () => {
    expect(parsePortSweep(`npm warn deprecated\n${SWEEP_HIT}3000\n`)).toBe(3000);
  });

  it('a miss is null, not a guess', () => {
    expect(parsePortSweep(SWEEP_MISS)).toBeNull();
    expect(parsePortSweep('')).toBeNull();
    expect(parsePortSweep(null)).toBeNull();
    expect(parsePortSweep(undefined)).toBeNull();
  });

  it('does NOT scrape a port out of unrelated output', () => {
    /**
     * The failure this strictness prevents: a number lifted from log noise would send the user to a URL
     * that shows nothing — precisely the blank-preview experience the sweep exists to end. Only our own
     * marker counts. (The sibling lesson is already in detectDevPort, where a stack trace's
     * `ECONNREFUSED …:5432` once became "the dev server's port".)
     */
    expect(parsePortSweep('Error: connect ECONNREFUSED 127.0.0.1:5432')).toBeNull();
    expect(parsePortSweep('listening on port 3000')).toBeNull();
    expect(parsePortSweep('NB_PORT_LIVE 3000')).toBeNull();
  });

  it('rejects an impossible port number', () => {
    expect(parsePortSweep(`${SWEEP_HIT}99999`)).toBeNull();
    expect(parsePortSweep(`${SWEEP_HIT}0`)).toBeNull();
    expect(isUsablePort(65536)).toBe(false);
    expect(isUsablePort(65535)).toBe(true);
  });
});

describe('what the user is told', () => {
  it('names both ports, because "we looked in the wrong place" is not "your app is broken"', () => {
    const s = sweepFoundSummary(5173, 3000);
    expect(s).toContain('3000');
    expect(s).toContain('5173');
    expect(s).not.toMatch(/error|failed|broken/i);
  });

  it('does not invent a mismatch when there was none', () => {
    expect(sweepFoundSummary(3000, 3000)).not.toContain('not the');
    expect(sweepFoundSummary(null, 3000)).toContain('3000');
  });
});
