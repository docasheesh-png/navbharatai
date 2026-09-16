import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { releaseGate, type RuntimeEvidence } from '../src/server/AgentV3/releaseGate';

/**
 * UNKNOWN MUST REACH THE PERSON WHO IS ABOUT TO TRUST THE APP.
 *
 * 🔴 The gap this locks (audit 2026-09-16). `releaseGate` computes four states and calls UNKNOWN —
 * *"nothing failed and nothing was PROVEN"* — "the most important state in this file". Yet `gate.state`
 * was consumed in exactly THREE places, all in one block of `routes/agentv3.ts`: the admin diagnostic's
 * severity, its autoResolved flag, and the `red && blockers > 0` verdict flip. **UNKNOWN changed
 * nothing** — not the verdict, not the user's summary, not what got re-checked.
 *
 * That is the 2026-08-12 dukaan lie in its other costume: fixed for RED, never extended to the state
 * that means "we did not look". And the checks that would have told us skip TOGETHER — they are all
 * gated on a preview URL — so they go quiet exactly when an app is most broken.
 *
 * 🔒 The fix deliberately does NOT touch `ok`: flipping an unproven build to failed would make it FREE
 * ("working app or free" keys on `!result.ok`), which autopsy 4efab9d7 is the admin's standing ruling
 * against. Not proven ≠ proven broken.
 */

const evidence = (over: Partial<RuntimeEvidence> = {}): RuntimeEvidence => ({
  buildOk: true,
  preview: 'not-run',
  pages: 'not-run',
  journeys: 'not-run',
  typecheck: 'not-run',
  tests: 'not-run',
  ...over,
});
const clean = { blockers: 0, highSeverity: 0, warnings: 0 };

describe('the state that had no teeth', () => {
  it('a build with NOTHING proven is UNKNOWN, not a pass', () => {
    const g = releaseGate(evidence(), clean);
    expect(g.state).toBe('unknown');
    expect(g.headline).toMatch(/cannot say whether this works/i);
  });

  it('🔒 static cleanliness can never earn a proven state — zero findings is still UNKNOWN', () => {
    expect(releaseGate(evidence(), { blockers: 0, highSeverity: 0, warnings: 0 }).state).toBe('unknown');
  });

  it('one real runtime proof is enough to leave UNKNOWN behind', () => {
    expect(releaseGate(evidence({ preview: 'passed' }), clean).state).not.toBe('unknown');
  });

  it('a genuine failure is RED, never UNKNOWN — the two must stay distinguishable', () => {
    expect(releaseGate(evidence({ preview: 'failed' }), clean).state).toBe('red');
    expect(releaseGate(evidence(), { ...clean, blockers: 2 }).state).toBe('red');
  });

  it('carries the reasons, so the user-facing notice is built from the gate and not re-derived', () => {
    const g = releaseGate(evidence(), clean);
    expect(g.unproven.length).toBeGreaterThan(0);
  });
});

describe('the wiring — UNKNOWN now has a consequence', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('records RELEASE_GATE_UNPROVEN when the gate is UNKNOWN on a successful build', () => {
    expect(route).toContain("gate.state === 'unknown' && result.ok");
    expect(route).toContain('RELEASE_GATE_UNPROVEN');
  });

  it('the finding is NOT auto-resolved — nothing resolved it', () => {
    // Anchored on the CODE occurrence, not the first mention — the doc comment above names it too,
    // and slicing from there never reached the record (caught by this test failing first).
    const at = route.indexOf("code: 'RELEASE_GATE_UNPROVEN'");
    expect(at).toBeGreaterThan(0);
    expect(route.slice(at, at + 400)).toContain('autoResolved: false');
  });

  it('the notice reaches the USER’s summary, not only the admin report', () => {
    const at = route.indexOf("gate.state === 'unknown' && result.ok");
    const block = route.slice(at, at + 1800);
    expect(block).toContain('result.summary');
    expect(block).toMatch(/could not verify this one end to end/i);
  });

  it('🔒 it does NOT touch ok — an unproven build is not a failed build, and must not become free', () => {
    const at = route.indexOf("gate.state === 'unknown' && result.ok");
    const block = route.slice(at, at + 1800);
    // The RED flip sets `ok: false`; this branch must not. Proven by absence within the block.
    expect(block).not.toContain('ok: false');
  });

  it('🔒 the user-facing line names no provider (White-Label Law)', () => {
    const at = route.indexOf("gate.state === 'unknown' && result.ok");
    const block = route.slice(at, at + 1800);
    expect(block).not.toMatch(/\b(GLM|Kimi|Claude|Sonnet|Opus|Gemini|Grok|Moonshot|Z\.ai|Anthropic|OpenAI)\b/);
  });

  it('the RED flip is still exactly as it was — this change adds a branch, it does not alter one', () => {
    expect(route).toContain("if (gate.state === 'red' && gateBlockers > 0 && settled && settled.ok) {");
    expect(route).toContain('OUTCOME_RELEASE_GATE_RED');
  });
});
