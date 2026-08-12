import { describe, it, expect } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * ADMIN REPORT 2026-08-12 — the dukaan stock app. A diagnostic that pointed at the wrong subsystem.
 *
 * The report printed:
 *
 *     [warning] TIME_TO_FIRST_CALL: 107s passed before the build made its first model call —
 *               sandbox setup, project restore, dependency install and secrets loading all
 *               happen before this point
 *
 * The same report disproves it twice over:
 *
 *   - the narration: "Setting up your workspace…" 0s · keys loaded 18s · "Planning the file list…" 20s
 *   - the call log:  the first model call's own `latencyMs` was **86,616**
 *
 * 107 − 86.6 = **20 seconds of setup**, exactly where the narration put it. The other 87 seconds were
 * the planning CALL running — because this hook fires from `recordLlmCall`, which runs when a call
 * RETURNS, so the number always contained the first call's own duration and then blamed setup for it.
 *
 * That is not a rounding error. It is a diagnostic aiming the reader at the wrong subsystem: anyone
 * acting on it optimises sandbox startup and finds nothing, while an 87-second model call goes
 * unexamined. Fixing the code without fixing what the report SAYS about it would leave the next
 * autopsy to make the same wrong turn.
 */

const at = (d: BuildDiagnostics) => d.report().issues.find((p) => p.code === 'TIME_TO_FIRST_CALL');

/** A diagnostics instance whose clock has already advanced `ms` when the first call is recorded. */
function afterMs(ms: number, latencyMs?: number) {
  let now = 1_000_000;
  const d = new BuildDiagnostics({ now: () => now } as any);
  now += ms;
  d.recordLlmCall({ model: 'x', finishReason: 'end_turn', toolCalls: 0, inputTokens: 1, outputTokens: 1, latencyMs, ok: true } as any);
  return d;
}

describe('the dukaan report\'s exact numbers', () => {
  it('107s elapsed with an 86.6s call reports 20s of setup, not 107', () => {
    const p = at(afterMs(107_000, 86_616))!;
    expect(p.message).toMatch(/^20s of preparation/);
    expect(p.message).not.toMatch(/107s/);
  });

  it('and names the call\'s own 87s separately, as model time', () => {
    const p = at(afterMs(107_000, 86_616))!;
    expect(p.message).toMatch(/first call itself then took 87s/);
    expect(p.message).toMatch(/that is model time, not setup/);
  });

  it('20s of setup is no longer a WARNING — the warning was the model call\'s, not setup\'s', () => {
    /**
     * The severity is the part that actually misdirects. A warning saying "setup took 107s" sends the
     * reader into sandbox startup; a 20s setup is unremarkable and the real problem was elsewhere.
     */
    const p = at(afterMs(107_000, 86_616))!;
    expect(p.severity).toBe('info');
    expect(p.autoResolved).toBe(true);
  });

  it('a genuinely slow SETUP is still flagged loudly', () => {
    // The fix must not silence the case this diagnostic exists for: slow preparation, fast call.
    const p = at(afterMs(190_000, 5_000))!;
    expect(p.message).toMatch(/^185s of preparation/);
    expect(p.severity).toBe('warning');
    expect(p.autoResolved).toBe(false);
  });
});

describe('it never invents the split it cannot measure', () => {
  it('with NO latency reported, it says the number is an upper bound', () => {
    /**
     * Some providers report no latency. Subtracting a guess would produce a number that LOOKS like a
     * measurement — the same class of dishonesty the billing rules forbid. So it states the limit of
     * what it knows instead of repeating the old confident, wrong attribution.
     */
    const p = at(afterMs(107_000, undefined))!;
    expect(p.message).toMatch(/107s passed/);
    expect(p.message).toMatch(/upper bound on setup/);
    expect(p.message).toMatch(/was not measured/);
    expect(p.message).not.toMatch(/sandbox setup, project restore, dependency install and secrets loading all happen in it/);
  });

  it('junk latency is treated as unmeasured, never subtracted', () => {
    for (const bad of [NaN, -1, Infinity]) {
      expect(at(afterMs(107_000, bad))!.message).toMatch(/upper bound on setup/);
    }
  });

  it('a latency longer than the whole build cannot produce a negative setup', () => {
    // A provider clock disagreeing with ours must degrade to "0s of preparation", never to nonsense.
    const p = at(afterMs(30_000, 999_000))!;
    expect(p.message).toMatch(/^0s of preparation/);
    expect(p.severity).toBe('info');
  });
});

describe('everything else about this diagnostic is unchanged', () => {
  it('it is recorded exactly once, on the FIRST call only', () => {
    let now = 1_000_000;
    const d = new BuildDiagnostics({ now: () => now } as any);
    now += 107_000;
    for (let i = 0; i < 3; i++) {
      d.recordLlmCall({ model: 'x', finishReason: 'end_turn', toolCalls: 0, inputTokens: 1, outputTokens: 1, latencyMs: 1_000, ok: true } as any);
    }
    expect(d.report().issues.filter((p) => p.code === 'TIME_TO_FIRST_CALL').length).toBe(1);
  });

  it('a build with no model call at all records nothing', () => {
    expect(at(new BuildDiagnostics())).toBeUndefined();
  });

  it('the 60s threshold is applied to PREPARATION, on both sides of the line', () => {
    expect(at(afterMs(59_000, 0))!.severity).toBe('info');
    expect(at(afterMs(60_000, 0))!.severity).toBe('warning');
  });
});
