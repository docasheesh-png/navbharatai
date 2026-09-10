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

  it('costs nothing: the rung now leading is priced identically to the one removed', () => {
    // This is what settled "remove vs re-enable". If these ever diverge, the trade-off changes and
    // the decision deserves revisiting — so it is asserted rather than left in a comment.
    expect(realRateFor('KIMI', 'kimi-k2.6')).toEqual(realRateFor('KIMI', 'kimi-k2.5'));
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
