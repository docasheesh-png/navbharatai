import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { releaseGate, type RuntimeEvidence } from '../src/server/AgentV3/releaseGate';

/**
 * UNKNOWN EARNS ONE LAST LOOK, NOT A SHRUG (P1, 2026-09-16).
 *
 * 🔴 Why a build reaches the gate unproven, traced rather than assumed: all three runtime proofs
 * (`preview | pages | journeys`) are gated on a preview URL, and each also demands headroom — the
 * preview verify wants `total − 90 s` because it budgets for verify PLUS a heal. `deliveryProof`
 * already covers "no URL was ever published" by starting the server itself. What nothing covered is
 * the other case: **a preview URL exists, the app may well be running, and nobody looked, purely
 * because there was no room for verify-plus-heal.**
 *
 * 🔑 The fix spends what remains on the one proof still affordable: a single real-browser open,
 * verify-ONLY (a heal is out of reach by construction — with 90 s the main loop would have run).
 *
 * ⚠️ Three outcomes, and it must be able to reach all three: pass upgrades the gate, proven-broken
 * sets `preview: 'failed'` (which the gate ALREADY turns RED — no new flipping logic), and anything
 * ambiguous leaves the evidence untouched and the build honestly UNKNOWN.
 */

const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const block = (() => {
  const at = route.indexOf('UNKNOWN EARNS ONE LAST LOOK');
  const end = route.indexOf('LAST_CHANCE_PROOF_SKIPPED', at);
  return route.slice(at, end > at ? end + 1200 : at + 6000);
})();

const evidence = (over: Partial<RuntimeEvidence> = {}): RuntimeEvidence => ({
  buildOk: true, preview: 'not-run', pages: 'not-run', journeys: 'not-run',
  typecheck: 'not-run', tests: 'not-run', ...over,
});
const clean = { blockers: 0, highSeverity: 0, warnings: 0 };

describe('1 — UNKNOWN with budget triggers the verification', () => {
  it('the attempt is gated on the gate actually being UNKNOWN', () => {
    expect(block).toContain("gate.state === 'unknown' && result.ok && lastPreviewUrl");
  });
  it('and on a real browser being available, not merely hoped for', () => {
    expect(block).toContain('actuator.browseUrl');
    expect(block).toContain('!abort.signal.aborted');
  });
});

describe('2 — a PASS converts UNKNOWN into a proven state', () => {
  it('a passed preview is no longer UNKNOWN (the gate does this, unchanged)', () => {
    expect(releaseGate(evidence(), clean).state).toBe('unknown');
    expect(releaseGate(evidence({ preview: 'passed' }), clean).state).not.toBe('unknown');
  });
  it('the code sets the evidence and RE-COMPUTES the gate rather than editing the verdict', () => {
    expect(block).toContain("gateEvidence.preview = 'passed'");
    expect(block).toContain('gate = releaseGate(gateEvidence, gateFindings(), gateQuality)');
  });
});

describe('3 / 4 — a real failure is detected and is not swallowed', () => {
  it('a proven-broken render is recorded as a FAILED preview', () => {
    expect(block).toContain("gateEvidence.preview = 'failed'");
  });
  it('and the gate already turns that RED — no new ok-flipping logic is added here', () => {
    expect(releaseGate(evidence({ preview: 'failed' }), clean).state).toBe('red');
    // The only ok-flip in the file remains the pre-existing RED+blockers one.
    expect(block).not.toContain('ok: false');
  });
  it('uses the SAME two bars as the main verify loop, not a looser pair', () => {
    expect(block).toContain('verdict.rendered && consoleErrs.length === 0');
    expect(block).toContain('!verdict.rendered && !verdict.inconclusive && !verdict.serverDown');
  });
});

describe('5 / 6 — bounded, and it cannot loop', () => {
  it('is a single straight-line attempt — no loop construct in the block', () => {
    expect(block).not.toMatch(/\bfor\s*\(|\bwhile\s*\(/);
  });
  it('the one browser open is bounded by an explicit timeout', () => {
    expect(block).toContain("35_000, 'last-chance-proof'");
  });
});

describe('7 — insufficient budget does not start it', () => {
  it('requires room for the whole attempt before starting', () => {
    expect(block).toContain('effectiveBuildSeconds * 1000 - LAST_CHANCE_PROOF_MS');
  });
  it('the floor is smaller than the main loop’s, because this one cannot heal', () => {
    const decl = route.match(/const LAST_CHANCE_PROOF_MS = ([\d_]+);/);
    expect(decl).toBeTruthy();
    expect(Number(decl![1].replace(/_/g, ''))).toBeLessThan(90_000);
  });
  it('🔒 it never EXTENDS the build budget — it only subtracts from it', () => {
    expect(block).not.toMatch(/effectiveBuildSeconds\s*\*\s*1000\s*\+/);
  });
});

describe('8 — a genuine infrastructure limit stays UNKNOWN', () => {
  it('an ambiguous look changes no evidence at all', () => {
    // Only `proven || broken` recomputes; everything else leaves the gate exactly as it was.
    expect(block).toContain('if (proven || broken) gate = releaseGate(');
  });
  it('a failure to open records UNAVAILABLE and explicitly blames infrastructure, not the app', () => {
    expect(block).toContain('LAST_CHANCE_PROOF_UNAVAILABLE');
    expect(block).toMatch(/infrastructure limit here, never evidence about the app itself/);
  });
  it('when it cannot even be attempted, the report says WHY', () => {
    expect(route).toContain('LAST_CHANCE_PROOF_SKIPPED');
    expect(route).toContain('No preview URL was ever available');
  });
});

describe('9 / 10 — existing verdicts are untouched', () => {
  it('RED on a real failure is unchanged', () => {
    expect(releaseGate(evidence({ pages: 'failed' }), clean).state).toBe('red');
    expect(releaseGate(evidence(), { ...clean, blockers: 1 }).state).toBe('red');
  });
  it('an already-proven build is unchanged — the attempt cannot fire on it', () => {
    expect(releaseGate(evidence({ preview: 'passed', journeys: 'passed' }), clean).state).not.toBe('unknown');
  });
  it('the pre-existing RED correction still stands exactly as it was', () => {
    expect(route).toContain("if (gate.state === 'red' && gateBlockers > 0 && settled && settled.ok) {");
    expect(route).toContain('OUTCOME_RELEASE_GATE_RED');
  });
  it('the P0 UNKNOWN honesty notice still stands', () => {
    expect(route).toContain("gate.state === 'unknown' && result.ok");
    expect(route).toContain('RELEASE_GATE_UNPROVEN');
  });
});

describe('11 / 12 / 13 — the standing constraints', () => {
  it('🔒 the P0 deadForRun implementation is untouched', () => {
    expect(route).toContain('const fastLaneDeadRungs = new Map<string, string>();');
    expect(route).toContain('deadRungs: fastLaneDeadRungs');
  });
  it('🔒 no provider racing is introduced — one call, awaited', () => {
    expect(block).not.toMatch(/Promise\.(race|any|all)\s*\(/);
  });
  it('🔒 no billing or token accounting in this path', () => {
    expect(block).not.toMatch(/billedUsd|walletTokens|captureTurnUsage|providerLedger|debit/i);
  });
  it('🔒 it makes no model call — deterministic verification only', () => {
    expect(block).not.toMatch(/runTurn|buildTurnRunner|makeFastTextRunner|fastGenerate/);
  });
  it('🔒 it reuses the existing browser stack rather than adding a second one', () => {
    expect(block).toContain('analyzePreviewHtml');
    expect(block).toContain('filterActionableErrors');
    expect(block).not.toMatch(/require\(|import\(|new Browser|chromium\./);
  });
});

describe('metrics — the baseline we did not have', () => {
  it('records duration and the reason, so UNKNOWN becomes countable', () => {
    expect(block).toContain('LAST_CHANCE_PROOF');
    expect(block).toMatch(/Date\.now\(\) - proofStartedAt/);
    expect(block).toContain('rendered=');
    expect(block).toContain('consoleErrors=');
  });
});
