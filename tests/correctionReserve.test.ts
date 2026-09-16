import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  correctionReserveMs,
  generationBudgetMs,
  CORRECTION_RESERVE_FRACTION,
  MIN_CORRECTION_RESERVE_MS,
  MAX_CORRECTION_RESERVE_MS,
  MAX_CORRECTION_RESERVE_SHARE,
  MIN_GENERATION_MS,
} from '../src/server/AgentV3/correctionReserve';
import { BUDGET_STAGE_AT } from '../src/server/AgentV3/buildBudgetSteer';
import { buildTimedOut } from '../src/server/AgentV3/AgentRunner';

/**
 * THE PROTECTED CORRECTION RESERVE.
 *
 * 🔴 The gap (audit 2026-09-16). The generation runner was handed `maxBuildMs: effectiveBuildSeconds
 * * 1000` — the WHOLE budget — and `buildTimedOut` stops it only at 100%. Every post-build check then
 * asks `Date.now() - buildStartedAt < total - X` for its own X (30/45/60/90/120 s) and **reserves
 * nothing**. So a build whose generation ran to the wall reached the correction phase with all
 * twenty-five of those tests false at once, and verify → repair → re-verify was skipped in silence.
 * That is the mechanism behind the UNKNOWN gate #2976 made visible and #2978 gave one last look at.
 *
 * These tests pin the reserve's arithmetic, the fact that it binds GENERATION and not the heals that
 * spend it, and the standing constraints it must not disturb.
 */

const ORIGINAL = process.env.AGENTV3_CORRECTION_RESERVE;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AGENTV3_CORRECTION_RESERVE;
  else process.env.AGENTV3_CORRECTION_RESERVE = ORIGINAL;
});

const DEFAULT_TOTAL = 1_800_000; // maxBuildSeconds() default, 30 min
const DEEP_TOTAL = 3_600_000;    // scaleBuildSeconds(1800, 'deep'), capped at MAX_SCALED_BUILD_SECONDS

const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

describe('1 — the correction budget is reserved at build start', () => {
  it('a default build holds back a real, non-trivial slice', () => {
    const r = correctionReserveMs(DEFAULT_TOTAL);
    expect(r).toBe(180_000); // 10% of 30 min
    expect(r).toBeGreaterThanOrEqual(MIN_CORRECTION_RESERVE_MS);
  });

  it('🔒 the fraction is DERIVED from the steer the engine already declares, not invented', () => {
    // buildBudgetSteer already tells the model that past `final` it must stop all work but saving.
    // Two numbers meaning one policy is how the two drift apart — so this is that one number.
    expect(CORRECTION_RESERVE_FRACTION).toBeCloseTo(1 - BUDGET_STAGE_AT.final, 10);
  });

  it('the reserve is computed from the build-wide budget, at the generation runner itself', () => {
    expect(route).toContain('maxBuildMs: generationBudgetMs(effectiveBuildSeconds * 1000, Date.now() - buildStartedAt)');
  });
});

describe('2 — normal generation cannot consume the reserved correction budget', () => {
  it('the generation cap is the total MINUS the reserve', () => {
    expect(generationBudgetMs(DEFAULT_TOTAL, 0)).toBe(DEFAULT_TOTAL - 180_000);
  });

  it('a runner constructed LATE gets only the window that remains, never a fresh clock', () => {
    // AgentRunner sets buildStartMs inside run(), so a cap is a REMAINING WINDOW. An escalation
    // twenty minutes in must not be handed another half-hour.
    const late = generationBudgetMs(DEFAULT_TOTAL, 1_200_000);
    expect(late).toBe(DEFAULT_TOTAL - 180_000 - 1_200_000);
    expect(late).toBeLessThan(DEFAULT_TOTAL);
  });

  it('🔒 all THREE generation-shaped runners are bound — a single unbound one would spend the reserve', () => {
    const uses = route.split('maxBuildMs: generationBudgetMs(').length - 1;
    expect(uses).toBe(3); // main build, escalation, empty-build retry
  });

  it('🔒 generation reaching its cap still STOPS it — the cap can never round to "no watchdog"', () => {
    // buildTimedOut treats maxBuildMs <= 0 as "no cap configured" and never stops the runner. A
    // reserve computation that reached 0 or went negative would therefore REMOVE the guard from the
    // very build it was meant to bound — the one failure mode worse than having no reserve at all.
    //
    // ⚠️ THE FLOOR APPLIES WHERE A RESERVE IS ACTUALLY TAKEN. Where the band yields no reserve (a cap
    // so short that a quarter of it rounds to nothing) the budget is passed THROUGH unchanged, which
    // is the documented contract and is still a real, positive cap. Both halves are asserted, because
    // the first draft of this test asserted the floor everywhere and failed on the pass-through.
    for (const [total, elapsed] of [[DEFAULT_TOTAL, 10_000_000], [200_000, 199_999], [1, 1]]) {
      const cap = generationBudgetMs(total, elapsed);
      expect(cap).toBeGreaterThan(0);                              // never "no watchdog"
      expect(buildTimedOut(0, cap, cap)).toBe(true);               // a positive cap really does fire
      if (correctionReserveMs(total) > 0) expect(cap).toBeGreaterThanOrEqual(MIN_GENERATION_MS);
      else expect(cap).toBe(total);                                // pass-through, byte-identical
    }
  });
});

describe('3 — verification and repair can use the reserved budget', () => {
  it('the reserve clears the preview-verify gate, which needs MORE than 90s of headroom', () => {
    // The gate is `elapsed < total - 90_000`. A reserve of exactly 90s would leave it false and buy
    // nothing at all — which is why the floor is 120s and not 90s.
    expect(MIN_CORRECTION_RESERVE_MS).toBeGreaterThan(90_000);
    const total = DEFAULT_TOTAL;
    const elapsedIfGenerationUsedItsWholeCap = generationBudgetMs(total, 0);
    expect(elapsedIfGenerationUsedItsWholeCap).toBeLessThan(total - 90_000);
  });

  it('it also clears the 45s page/last-chance gates and the 60s heal floor', () => {
    const total = DEFAULT_TOTAL;
    const atGate = generationBudgetMs(total, 0);
    for (const gate of [30_000, 45_000, 60_000, 90_000, 120_000]) {
      expect(atGate).toBeLessThan(total - gate);
    }
  });

  it('🔒 the HEAL runners keep the full ceiling — they SPEND the reserve, they do not observe it', () => {
    // Every heal/integrity/design/vaccine/feature runner spreads baseRunnerOpts, whose maxBuildMs is
    // the untouched full clock. Binding them would be the bug this change exists to fix, inverted.
    expect(route).toContain('maxBuildMs: effectiveBuildSeconds * 1000,');
  });
});

describe('4 / 5 / 6 — a detected error can enter repair, spend the reserve, and be re-verified', () => {
  it('the verify→repair→re-verify loop is a LOOP, so a repair is followed by another browse', () => {
    const at = route.indexOf('const healMax = autoFixEnabled()');
    expect(at).toBeGreaterThan(0);
    const loop = route.slice(at, at + 1200);
    expect(loop).toMatch(/for \(let attempt = 0; attempt <= healMax/);
    expect(loop).toContain('actuator.browseUrl'); // the re-verify is the next iteration's browse
  });

  it('restarting a dead dev server does not spend a repair attempt', () => {
    const at = route.indexOf('const MAX_SERVER_REVIVALS');
    expect(at).toBeGreaterThan(0);
    expect(route.slice(at - 400, at)).toMatch(/NOT a repair attempt and must not spend the repair budget/);
  });
});

describe('7 / 8 — an exhausted budget produces an HONEST state, never a manufactured success', () => {
  it('a spent repair budget records an unresolved ERROR, not a pass', () => {
    const at = route.indexOf("code: 'OUTCOME_PREVIEW_FAILED'");
    expect(at).toBeGreaterThan(0);
    expect(route.slice(at - 900, at)).toContain('previewVerifiedFailed = true');
  });

  it('🔒 a broken app is never downgraded to UNKNOWN because the budget ran out', () => {
    // previewVerifiedFailed feeds gateEvidence.preview = 'failed', which is RED. The UNKNOWN branch
    // is reached only when nothing was ever proven either way.
    expect(route).toContain("gateEvidence.preview = previewVerifiedRendered ? 'passed' : previewVerifiedFailed ? 'failed' : 'not-run';");
  });

  it('an inconclusive read is still not treated as a failure — unproven stays unproven', () => {
    expect(route).toContain("code: 'PREVIEW_UNVERIFIED'");
  });
});

describe('9 — an unused reserve creates no delay', () => {
  it('the reserve is a CAP, not a wait: nothing sleeps for it', () => {
    // generationBudgetMs only ever lowers a ceiling. A build that finishes early still finishes
    // early — there is no scheduled work that consumes the remainder.
    expect(generationBudgetMs(DEFAULT_TOTAL, 0)).toBeLessThan(DEFAULT_TOTAL);
    expect(correctionReserveMs(DEFAULT_TOTAL)).toBeGreaterThan(0);
    // …and the build's own hard wall is untouched, so nothing was extended either.
    expect(route).toContain('setTimeout(finalizeOnDeadline, deadlineMs)');
  });
});

describe('10 — the repair loop stays bounded', () => {
  it('the existing round limit is used as-is and is NOT raised', () => {
    // autoFixMaxAttempts(): default 1, hard-capped at 3. This change does not touch it.
    const at = route.indexOf('const healMax = autoFixEnabled()');
    expect(route.slice(at, at + 120)).toContain('Math.max(1, autoFixMaxAttempts())');
    expect(route).not.toContain('autoFixMaxAttempts() + ');
  });

  it('the loop also stops on the wall clock and on abort, not only on the round count', () => {
    expect(route).toContain('if (attempt >= healMax || abort.signal.aborted || (effectiveBuildSeconds > 0');
  });
});

describe('the band — one fraction that stays sane at every configured cap', () => {
  it('a DEEP build is capped, not given six minutes of reserve', () => {
    expect(DEEP_TOTAL * CORRECTION_RESERVE_FRACTION).toBeGreaterThan(MAX_CORRECTION_RESERVE_MS);
    expect(correctionReserveMs(DEEP_TOTAL)).toBe(MAX_CORRECTION_RESERVE_MS);
  });

  it('a SHORT cap lets the share veto the floor, rather than losing 40% of the build', () => {
    const short = 300_000; // a deliberately small AGENTV3_MAX_BUILD_SECONDS
    expect(correctionReserveMs(short)).toBe(short * MAX_CORRECTION_RESERVE_SHARE);
    // Honest consequence, stated rather than hidden: this cannot afford a repair round…
    expect(correctionReserveMs(short)).toBeLessThan(MIN_CORRECTION_RESERVE_MS);
    // …and it does not pretend to — generation keeps three quarters of a small budget.
    expect(generationBudgetMs(short, 0)).toBe(short * (1 - MAX_CORRECTION_RESERVE_SHARE));
  });

  it('the reserve never exceeds a quarter of the clock at any cap', () => {
    for (const total of [200_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000]) {
      expect(correctionReserveMs(total)).toBeLessThanOrEqual(total * MAX_CORRECTION_RESERVE_SHARE + 1);
    }
  });
});

describe('11 / 12 / 13 / 14 / 15 / 16 — the standing constraints', () => {
  it('11 🔒 the P0 deadForRun memory (#2975) is untouched', () => {
    expect(route).toContain('const fastLaneDeadRungs = new Map<string, string>();');
    expect(route).toContain('...(opts.deadRungs ? { deadRungs: opts.deadRungs } : {})');
  });

  it('12 🔒 the UNKNOWN behaviour (#2976, #2978) is untouched', () => {
    expect(route).toContain("code: 'RELEASE_GATE_UNPROVEN'");
    expect(route).toContain("code: 'LAST_CHANCE_PROOF'");
    expect(route).toMatch(/could not verify this one end to end/);
  });

  it('13 🔒 no timeout value was changed — the reserve is a budget split, not a timeout', () => {
    const mod = readFileSync('src/server/AgentV3/correctionReserve.ts', 'utf8');
    expect(mod).not.toMatch(/TIMEOUT|timeoutMs|withTimeout|streamIdle|streamHardCap/i);
    // The browse bound the correction phase uses is still the main loop's own 35s value.
    expect(route).toContain("35_000, 'browseUrl'");
  });

  it('14 🔒 no provider racing or hedging is introduced', () => {
    const mod = readFileSync('src/server/AgentV3/correctionReserve.ts', 'utf8');
    expect(mod).not.toMatch(/Promise\.(race|any|all)|hedge|parallel/i);
  });

  it('15 🔒 wallet and token accounting are untouched', () => {
    const mod = readFileSync('src/server/AgentV3/correctionReserve.ts', 'utf8');
    expect(mod).not.toMatch(/wallet|token|debit|billed|usage|markup|Inr|Usd/i);
  });

  it('16 🔒 per-build isolation — the reserve is pure arithmetic with no shared state', () => {
    const mod = readFileSync('src/server/AgentV3/correctionReserve.ts', 'utf8');
    // No module-level mutable state of any kind: two concurrent builds cannot influence each other.
    expect(mod).not.toMatch(/^(let|var) /m);
    expect(mod).not.toMatch(/new (Map|Set|WeakMap)\(/);
    // Same inputs, same answer, whoever asks and whenever.
    expect(correctionReserveMs(DEFAULT_TOTAL)).toBe(correctionReserveMs(DEFAULT_TOTAL));
  });
});

describe('the kill switch and the disabled watchdog', () => {
  it('AGENTV3_CORRECTION_RESERVE=off restores today’s behaviour to the byte', () => {
    process.env.AGENTV3_CORRECTION_RESERVE = 'off';
    expect(correctionReserveMs(DEFAULT_TOTAL)).toBe(0);
    expect(generationBudgetMs(DEFAULT_TOTAL, 0)).toBe(DEFAULT_TOTAL);
    expect(generationBudgetMs(DEFAULT_TOTAL, 500_000)).toBe(DEFAULT_TOTAL); // no elapsed subtraction either
  });

  it('a watchdog set to 0 (disabled) still means disabled — never a reserve of its own', () => {
    expect(correctionReserveMs(0)).toBe(0);
    expect(generationBudgetMs(0, 0)).toBe(0); // passed straight through ⇒ AgentRunner sees "no cap"
    expect(buildTimedOut(0, generationBudgetMs(0, 0), 9e9)).toBe(false);
  });

  it('a nonsense total is treated as disabled, never as a reason to invent a reserve', () => {
    for (const bad of [NaN, -1, Infinity as unknown as number]) {
      expect(correctionReserveMs(bad)).toBe(0);
    }
  });
});

describe('telemetry — the number nobody had', () => {
  it('every build records where its clock went', () => {
    expect(route).toContain("code: 'CORRECTION_BUDGET'");
    const at = route.indexOf("code: 'CORRECTION_BUDGET'");
    const block = route.slice(at, at + 900);
    for (const field of ['total=', 'reserve=', 'generationCap=', 'elapsedAtGate=', 'leftAtGate=', 'gate=']) {
      expect(block).toContain(field);
    }
  });

  it('🔒 it is advisory only — an accounting line may never fail the build it accounts for', () => {
    // Anchored on the severity, which sits BEFORE the code on the same line — slicing forward from
    // the code cut the very field being asserted (caught by this test failing first).
    const at = route.indexOf("severity: 'info', code: 'CORRECTION_BUDGET'");
    expect(at).toBeGreaterThan(0);
    const block = route.slice(at, at + 900);
    expect(block).toContain('autoResolved: true');
    expect(route.slice(at, at + 1400)).toContain('catch { /* an accounting line must never affect the build it is accounting for */ }');
  });
});
