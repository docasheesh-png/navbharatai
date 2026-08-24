import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * THE COMPLAINT (admin build reports): TIME_TO_FIRST_CALL between 111s and 231s, and inside it a 43s
 * stretch with NOTHING recorded. The user waits through every second of that.
 *
 * The instrument was working correctly — `longestSilentGap` can only name a stretch BETWEEN two
 * recorded findings, so a step that records nothing is invisible to it twice over: it can never be
 * blamed, and it makes the gap around it look larger than any single cause could explain. Setup
 * reported `Workspace ready in Ns` after ensureWorkspace and then went quiet through the steps that
 * grow with the SIZE of an existing project.
 *
 * These tests pin the two halves of the answer: the steps now report their own time, and the three
 * that never needed to be sequential no longer are.
 */
const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

describe('the setup wait reports where it went', () => {
  it('times the durable restore, split into its three real costs', () => {
    expect(route).toContain('const restoreT0 = Date.now();');
    expect(route).toContain('Project restored in ');
    // The split is the point. One total would say the wait is real without saying which read, scan or
    // write to shorten — which is the position the last report left us in.
    expect(route).toContain('durable read ${loadMs}ms');
    expect(route).toContain('sandbox scan `\n                  + `${scanMs}ms');
  });

  it('times the COMMON case too, where nothing needed restoring', () => {
    // Instrumenting only the repair branch would leave an ordinary healthy build exactly as silent as
    // it is today — which is the whole complaint. The read and the scan were paid for either way.
    expect(route).toContain('nothing needed restoring');
  });

  it('records the personal-context fetch as its own step', () => {
    expect(route).toContain('Personal context loaded in ${contextMs}ms');
  });
});

describe('three independent store reads no longer run one after another', () => {
  it('fetches them concurrently', () => {
    expect(route).toContain('const [prefSettled, adrSettled, brainSettled] = await Promise.allSettled([');
  });

  it('uses allSettled, so one unavailable store cannot drop the other two', () => {
    // Three separate try/catches gave each context its own failure isolation. `Promise.all` would have
    // silently traded that away — one rejection and the user loses their preferences AND their past
    // decisions AND their lessons, on a path whose every comment promises "never blocks a build".
    for (const s of ['prefSettled', 'adrSettled', 'brainSettled']) {
      expect(route).toContain(`${s}.status === 'fulfilled' ? ${s}.value : ''`);
    }
  });

  it('still applies them in the original order — the prompt must be byte-identical', () => {
    // Each prepends to architectSystem, so order is content. It also matters for AGENTV3_CACHE_PREFIX:
    // a reordered prefix is a cache miss on every build, which would make a latency fix a cost regression.
    const pref = route.indexOf('if (prefContext) architectSystem =');
    const adr = route.indexOf('if (adrContext) architectSystem =');
    const brain = route.indexOf('if (brainContext) architectSystem =');
    expect(pref).toBeGreaterThan(-1);
    expect(adr).toBeGreaterThan(pref);
    expect(brain).toBeGreaterThan(adr);
  });
});

describe('the gap finder these feed is what turns a marker into an answer', () => {
  const T0 = 1_700_000_000_000;

  it('without a marker, a long setup reports one undifferentiated void', () => {
    // This is the report the admin actually received: 43s of silence, and the only thing it could name
    // was whatever happened to be recorded before it.
    const gap = BuildDiagnostics.longestSilentGap(
      [{ ts: T0 + 1_000, message: 'Workspace ready in 12s' }],
      T0,
      T0 + 44_000,
    );
    expect(gap?.seconds).toBe(43);
    expect(gap?.after).toBe('Workspace ready in 12s');
  });

  it('a marker in the middle both shrinks the silence and names the expensive half', () => {
    // The mechanism, proven rather than asserted. Same 43 seconds of wall clock; now the longest
    // unexplained stretch is 30s and it is attributed to the step that actually cost it. That is why
    // recording a step is itself the fix for a report that could only say "43s, cause unknown".
    const gap = BuildDiagnostics.longestSilentGap(
      [
        { ts: T0 + 1_000, message: 'Workspace ready in 12s' },
        { ts: T0 + 14_000, message: 'Project restored in 13s' },
      ],
      T0,
      T0 + 44_000,
    );
    expect(gap?.seconds).toBe(30);
    expect(gap?.after).toBe('Project restored in 13s');
  });

  it('and the step\'s own line carries the split, which the gap finder cannot', () => {
    // longestSilentGap names WHEN silence began, never what caused it — its own comment says so. The
    // detail on the SETUP_TIMING finding is the half that says which read, scan or write to shorten.
    expect(route).toContain('durable read ${loadMs}ms');
  });
});
