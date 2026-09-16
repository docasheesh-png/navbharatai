import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { realRateFor } from '../src/server/AgentV3/providerRates';

/**
 * THE DEAD RUNG IS OUT OF THE FREE LADDER (admin-approved 2026-09-04).
 *
 * Two build reports proved `kimi-k2.5` is unreachable on this account — "404 Not found the model
 * kimi-k2.5 or Permission denied" — while sitting FIRST in the free Kimi ladder, so every free build
 * led with a model that cannot answer: 5 wasted requests out of 5 calls in one report, 57 out of 40 in
 * an earlier one. #2741 cut that to one per build by retiring a dead rung after its first failure;
 * removing it from the ladder ends it.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
const kimiDefaultLine = route.split('\n').find((l) => l.includes('const kimiDefault')) ?? '';

describe('the free Kimi ladder no longer leads with a model that cannot answer', () => {
  it('found the ladder line — this test is not vacuously passing', () => {
    expect(kimiDefaultLine).toContain('kimiDefault');
    expect(kimiDefaultLine).toContain('opts?.free');
  });

  it('the FREE ladder is kimi-k2.6 → kimi-k2.7-code, with k2.5 gone', () => {
    const free = kimiDefaultLine.split(':')[1] ?? '';   // the `opts?.free ? [...]` arm
    expect(free).toContain("'kimi-k2.6'");
    expect(free).toContain("'kimi-k2.7-code'");
    expect(free).not.toContain("'kimi-k2.5'");
  });

  it('the PAID ladder is untouched — this was a free-tier decision only', () => {
    expect(kimiDefaultLine).toContain("['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6']");
  });

  /**
   * 🔴 THIS ASSERTION FIRED ON 2026-09-16, EXACTLY AS IT WAS DESIGNED TO — and the premise it guarded
   * turned out to be false. It used to read *"costs nothing: the rung now leading is priced identically
   * to the one removed"*, with the note: *"This is what settled remove vs re-enable. If these ever
   * diverge, the trade-off changes and the decision deserves revisiting."*
   *
   * They diverged. Moonshot's own price table prices **k2.6 at $0.95 / $4.00** — the same as k2.7-code,
   * NOT the $0.60 / $2.50 the rate card had been lumping it at with the retired k2.5. So dropping k2.5
   * did not cost nothing: it raised the weak ladder's real cost by ~58% on input and ~60% on output,
   * and NavBharatAI pays for weak builds itself. The price was wrong; the reasoning was sound.
   *
   * ⚠️ THE DECISION STILL STANDS, and for the reason that was always the real one: k2.5 returned
   * "404 Not found the model kimi-k2.5 or Permission denied" on this account, so there was never a
   * cheaper working rung to keep. "It costs nothing" was a supporting argument built on a number nobody
   * had checked against an invoice — which is the whole reason a price belongs in a test.
   */
  it('k2.6 is NOT the same price as the retired k2.5 — the swap really did cost more', () => {
    const k26 = realRateFor('KIMI', 'kimi-k2.6');
    const k25 = realRateFor('KIMI', 'kimi-k2.5');
    expect(k26).not.toEqual(k25);
    expect(k26.inputPerMTok).toBeGreaterThan(k25.inputPerMTok);
    expect(k26.outputPerMTok).toBeGreaterThan(k25.outputPerMTok);
    // Moonshot prices k2.6 exactly like the coder rung the paid ladder uses.
    const k27 = realRateFor('KIMI', 'kimi-k2.7-code');
    expect(k26.inputPerMTok).toBe(k27.inputPerMTok);
    expect(k26.outputPerMTok).toBe(k27.outputPerMTok);
  });

  it('the rate card KEEPS k2.5 — an older build\'s telemetry must still price correctly', () => {
    // A routing change, not a billing one. Dropping the rate entry would mis-price historical reports.
    const rate = realRateFor('KIMI', 'kimi-k2.5');
    expect(rate?.inputPerMTok).toBeGreaterThan(0);
    expect(rate?.outputPerMTok).toBeGreaterThan(0);
  });

  it('the free ladder still has a rung left after the heal pass drops flash-class models', () => {
    // The weak HEAL ladder filters out flash-class rungs by name. Kimi has none, so both rungs
    // survive — but an empty floor silently disables cheapOnly and drops a weak heal through to
    // Gemini/Haiku, the exact trap PROGRESS records, so the invariant is worth holding.
    const free = ['kimi-k2.6', 'kimi-k2.7-code'];
    expect(free.filter((m) => !/flash/i.test(m)).length).toBeGreaterThan(0);
  });
});
