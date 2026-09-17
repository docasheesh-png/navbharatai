import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  futilityMinutes,
  initialFutilityState,
  tickFutility,
  futilityDetail,
  DEFAULT_FUTILITY_MINUTES,
  MIN_FUTILITY_MINUTES,
  MAX_FUTILITY_MINUTES,
  type ProgressSnapshot,
} from '../src/server/AgentV3/futilityBreaker';
import { abortSummary, type AbortCause } from '../src/server/AgentV3/buildAbortCause';

/**
 * 🔴 A BUILD THAT IS GOING NOWHERE MUST STOP — the third bound, beside cost and throughput.
 *
 * Build `d6d664e6` (autopsy shipped as #3039, which recorded this as an OPEN item): a one-word
 * prompt, the full **29 minutes** to the wall clock, **no app**, and minutes 4→29 containing nothing
 * but heartbeats and failed provider calls. Zero files, zero completed commands, zero plan steps, for
 * twenty-five consecutive minutes.
 *
 * #3039's own words: *"Cost is bounded, throughput is bounded, pointlessness is bounded by nothing."*
 *
 * 🔑 PROGRESS IS WHAT THE BUILD PRODUCED, NOT WHAT IT ATTEMPTED. A failed provider call records an
 * issue, emits narration and burns a minute — counting any of that as activity is exactly what let
 * this build look busy for twenty-five minutes.
 */

const snap = (over: Partial<ProgressSnapshot> = {}): ProgressSnapshot =>
  ({ filesWritten: 0, commandsRun: 0, stepsDone: 0, ...over });

/** Run `n` quiet minutes through the breaker and return the last verdict. */
function quietMinutes(n: number, limit: number, at: ProgressSnapshot = snap()) {
  let state = initialFutilityState();
  let last = tickFutility(state, at, limit);
  state = last.state;
  for (let i = 1; i < n; i++) { last = tickFutility(state, at, limit); state = last.state; }
  return last;
}

describe('the reported build — 25 quiet minutes against a 10-minute window', () => {
  it('stops at the window, not at the 29-minute wall clock', () => {
    // Nine quiet minutes is not enough…
    expect(quietMinutes(9, 10).stop).toBe(false);
    // …the tenth is.
    const v = quietMinutes(10, 10);
    expect(v.stop).toBe(true);
    expect(v.quietMinutes).toBe(10);
  });

  it('the admin line names all three counters, because "nothing happened" must be checkable', () => {
    const detail = futilityDetail(quietMinutes(10, 10), 10);
    expect(detail).toContain('10 consecutive minute(s)');
    expect(detail).toContain('0 file(s), 0 command(s), 0 step(s)');
    // The distinction the 29-minute timeline never made.
    expect(detail).toContain('A provider call, a narration line and a heartbeat are deliberately NOT counted');
    expect(detail).toContain('AGENTV3_FUTILITY_MINUTES');
  });
});

describe('ANY of the three signals moving is progress — the counter resets', () => {
  for (const field of ['filesWritten', 'commandsRun', 'stepsDone'] as const) {
    it(`a change in ${field} resets the quiet count`, () => {
      let state = initialFutilityState();
      for (let i = 0; i < 9; i++) state = tickFutility(state, snap(), 10).state;
      expect(state.quietTicks).toBe(9);
      const moved = tickFutility(state, snap({ [field]: 1 }), 10);
      expect(moved.stop).toBe(false);
      expect(moved.quietMinutes).toBe(0);
      // …and the count starts again FROM there, so one file does not buy immunity.
      // ⚠️ ELEVEN, not ten, and the off-by-one is the behaviour rather than a quirk: the first tick
      // against a non-zero snapshot IS progress (it moved from the initial zero), so the quiet run
      // begins on the second. My first draft asserted ten and failed — the code was right.
      expect(quietMinutes(10, 10, snap({ [field]: 1 })).stop).toBe(false);
      expect(quietMinutes(11, 10, snap({ [field]: 1 })).stop).toBe(true);
    });
  }

  it('a build that keeps producing is never stopped, however long it runs', () => {
    let state = initialFutilityState();
    let files = 0;
    for (let minute = 0; minute < 60; minute++) {
      files += 1; // one file a minute — slow, but getting somewhere
      const v = tickFutility(state, snap({ filesWritten: files }), 10);
      expect(v.stop).toBe(false);
      state = v.state;
    }
  });

  it('progress once, then silence, still stops — and that is deliberate', () => {
    // 20 files then a 10-minute repair loop that converges on nothing. The watchdog would stop this
    // at minute 30 anyway; stopping at 15 with the 20 files saved is strictly better for the user.
    let state = tickFutility(initialFutilityState(), snap({ filesWritten: 20 }), 10).state;
    let v = tickFutility(state, snap({ filesWritten: 20 }), 10);
    for (let i = 1; i < 10; i++) { v = tickFutility(v.state, snap({ filesWritten: 20 }), 10); }
    expect(v.stop).toBe(true);
  });
});

describe('it fails OPEN — an unreadable signal must never end a build', () => {
  it('a NaN counter is read as zero, not as movement', () => {
    const v = tickFutility(initialFutilityState(), snap({ filesWritten: NaN as never }), 10);
    expect(v.state.last.filesWritten).toBe(0);
    expect(v.quietMinutes).toBe(1);
  });

  it('a counter that went BACKWARDS is treated as progress', () => {
    // Impossible (every counter is monotonic), and an impossible reading must fail toward letting the
    // build live — the same call `checkCostCeiling` makes on a non-finite cost.
    let state = initialFutilityState();
    for (let i = 0; i < 9; i++) state = tickFutility(state, snap({ filesWritten: 5 }), 10).state;
    const v = tickFutility(state, snap({ filesWritten: 2 }), 10);
    expect(v.stop).toBe(false);
    expect(v.quietMinutes).toBe(0);
  });

  it('a limit of 0 never stops anything, and still tracks — so enabling it mid-build starts clean', () => {
    const v = quietMinutes(50, 0);
    expect(v.stop).toBe(false);
    expect(v.quietMinutes).toBe(50);
  });

  it('junk input never throws', () => {
    expect(() => tickFutility(undefined as never, undefined as never, undefined as never)).not.toThrow();
    expect(() => tickFutility({} as never, snap(), 10)).not.toThrow();
  });
});

describe('futilityMinutes — the switch, the floor and the ceiling', () => {
  it('defaults to 10 minutes: twice the longest bounded single operation', () => {
    expect(futilityMinutes({} as NodeJS.ProcessEnv)).toBe(DEFAULT_FUTILITY_MINUTES);
    expect(DEFAULT_FUTILITY_MINUTES).toBe(10);
  });

  it('an explicit 0 — and only that, or "off" — disables it', () => {
    expect(futilityMinutes({ AGENTV3_FUTILITY_MINUTES: '0' } as never)).toBe(0);
    expect(futilityMinutes({ AGENTV3_FUTILITY_MINUTES: ' off ' } as never)).toBe(0);
  });

  it('an unreadable value falls back to the DEFAULT, never to "off"', () => {
    // A value that is PRESENT and unparseable can never have been intended as "no breaker".
    for (const raw of ['', 'abc', '-5', 'NaN', '  ']) {
      expect(futilityMinutes({ AGENTV3_FUTILITY_MINUTES: raw } as never)).toBe(DEFAULT_FUTILITY_MINUTES);
    }
  });

  it('🔒 it can never be set below the longest bounded single operation', () => {
    // The floor is the one thing protecting a legitimately long step. COMMAND_TIMEOUT_MS is 5 min and
    // AGENTV3_STREAM_HARD_CAP_MS bounds one streamed call at 300 s, so 6 is strictly above both.
    expect(MIN_FUTILITY_MINUTES).toBe(6);
    expect(futilityMinutes({ AGENTV3_FUTILITY_MINUTES: '1' } as never)).toBe(MIN_FUTILITY_MINUTES);
    expect(futilityMinutes({ AGENTV3_FUTILITY_MINUTES: '5' } as never)).toBe(MIN_FUTILITY_MINUTES);
    expect(futilityMinutes({ AGENTV3_FUTILITY_MINUTES: '6' } as never)).toBe(6);
  });

  it('is capped at the wall clock — past that the watchdog owns it', () => {
    expect(futilityMinutes({ AGENTV3_FUTILITY_MINUTES: '999' } as never)).toBe(MAX_FUTILITY_MINUTES);
  });

  it('a real value in range is honoured', () => {
    expect(futilityMinutes({ AGENTV3_FUTILITY_MINUTES: '15' } as never)).toBe(15);
  });
});

describe('what the USER is told', () => {
  it('names neither their fault nor "too long" — it says it was not getting anywhere', () => {
    const msg = abortSummary('futile', { builtSomething: false });
    expect(msg).toContain('not getting anywhere');
    expect(msg).toContain('Nothing was lost');
    // Actionable: "try again" alone sends them back to the same prompt for another 29 minutes.
    expect(msg).toContain('a bit more detail');
    // ⚠️ "too long" is the WATCHDOG's sentence. This build may have stopped at minute 12 of 30.
    expect(msg).not.toContain('too long');
    expect(msg).not.toContain('you ');
  });

  it('when files SURVIVED it says so and how to continue', () => {
    const msg = abortSummary('futile', { builtSomething: true });
    // ⚠️ THIS ASSERTION IS THE DISCRIMINATING ONE, and my first draft did not have it. Without the
    // 'futile' case the switch falls through to `default`, whose text ALSO contains "files so far are
    // saved" and "continue from here" — so the test passed with the case reverted and guarded nothing.
    // Only this branch says the build stopped making progress.
    expect(msg).toContain('stopped making progress');
    expect(msg).toContain('files so far are saved');
    expect(msg).toContain('continue from here');
    // The empty-handed advice would be wrong here — they have an app to carry on with.
    expect(msg).not.toContain('a bit more detail');
  });

  it('🔒 no provider, no model, no cost — the White-Label Law covers a stop notice too', () => {
    for (const saved of [true, false]) {
      const msg = abortSummary('futile', { builtSomething: saved });
      for (const vendor of ['GLM', 'Z.ai', 'Kimi', 'Moonshot', 'Claude', 'Anthropic', 'Gemini', 'Vertex', 'Grok', 'OpenAI', '$']) {
        expect(msg).not.toContain(vendor);
      }
    }
  });

  it('every other cause is untouched', () => {
    const before: Record<string, string> = {
      'user-stop': 'Stopped, as you asked. Nothing had been written yet, so nothing was lost.',
      'advisory-cap': 'Your app is built. I stopped the final polish checks early because they were taking too long — the app itself is unaffected.',
    };
    for (const [cause, text] of Object.entries(before)) {
      expect(abortSummary(cause as AbortCause, { builtSomething: false })).toBe(text);
    }
  });
});

/** ⚠️ REVERSION GUARD — reads CODE with comments stripped, so prose can neither satisfy nor defeat it. */
describe('the breaker is driven from the TIMER, not from the provider-turn hook', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the tick lives in the heartbeat timer, beside the heartbeat it rides on', () => {
    const beat = route.indexOf('buildDiagRef?.heartbeat()');
    const tick = route.indexOf('tickFutility(');
    expect(beat).toBeGreaterThan(-1);
    expect(tick).toBeGreaterThan(beat);
    // 🔴 THE LOAD-BEARING CHOICE. `captureTurnUsage` fires on a SUCCESSFUL provider call, and the
    // reported build's quiet 25 minutes were FAILED ones — a breaker hung off the turn hook would
    // never have run in the very case it exists for.
    const turnHook = route.indexOf('const captureTurnUsage');
    expect(tick).toBeLessThan(turnHook);
  });

  it('it counts COMPLETED commands, at the hook that fires on completion', () => {
    expect(route).toContain('commandsRun += 1;');
    expect(route).toContain('commandsRun,');
  });

  it('it fires once, records an unresolved finding, and aborts with its own cause', () => {
    expect(route).toContain('if (!futilityFired)');
    expect(route).toContain("code: 'FUTILITY_BREAKER'");
    expect(route).toContain('autoResolved: false');
    expect(route).toContain("abortBuild({ abort: (r?: unknown) => abort.abort(r) }, 'futile')");
  });
});
