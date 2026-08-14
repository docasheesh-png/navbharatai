import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { splitCachedSystem, SYSTEM_BLOCK_SEPARATOR } from '../src/server/AgentV3/systemPromptCache';

/**
 * CACHE-PREFIX WIRING — the half of the optimisation that lives outside the tested function.
 *
 * `splitCachedSystem` is pure and well covered (systemPromptCache.test.ts), including a round-trip that
 * proves the split loses nothing. But "loses nothing" is a property of the PAIR: the route takes the
 * volatile prefix OUT of the cached system block, and must then put it back into the per-turn user
 * message. The split alone is only half a move.
 *
 * IF THE SECOND HALF IS EVER DROPPED, NOTHING FAILS. There is no error, no exception, no failing build —
 * the model simply stops receiving today's date, the user's preferences, the project's ADRs and the
 * grounding blocks, on every single build, and the only symptom is that answers quietly get worse. That
 * is the most expensive kind of bug this codebase can have, and it would be one deleted line away.
 *
 * These assertions are SOURCE-LEVEL, which is a deliberate trade and worth naming: the code lives inside
 * a ~12,000-line route closure that cannot be imported or exercised in a unit test. Extracting the whole
 * build path to test one line would be a far larger change than the line protects. So the pure maths is
 * tested for real below, and the wiring is pinned by reading the source — a weaker check than execution,
 * chosen honestly over no check at all.
 */

const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

describe('the split is only safe because the preamble is put back', () => {
  it('nothing is lost when the two halves are combined — the property being protected', () => {
    /**
     * Stated as an executable fact first, so the source assertions below are guarding something real
     * rather than a shape. Every character of the original prompt must still reach the model.
     */
    const staticBody = 'STATIC ARCHITECT BODY — the big cacheable part.';
    const volatile = "Today is 2026-08-14.\n\nUser prefers dark mode.";
    const finalSystem = `${volatile}${SYSTEM_BLOCK_SEPARATOR}${staticBody}`;

    const { system, preamble } = splitCachedSystem(finalSystem, staticBody);
    const whatTheModelSees = `${preamble}${SYSTEM_BLOCK_SEPARATOR}${system}`;
    expect(whatTheModelSees).toBe(finalSystem);
    // …and the preamble is NOT empty here, so a test that silently dropped it would fail rather than
    // pass vacuously — the failure mode this whole file is about.
    expect(preamble).toContain('2026-08-14');
  });

  it('the route re-applies the preamble to the build prompt', () => {
    // The one line whose deletion is silent. It must both exist and actually reference the variable the
    // split produced — an assertion on the variable name alone would survive `const x = preamble;`.
    expect(route).toMatch(/if \(cachePrefixPreamble\) buildPrompt = /);
    expect(route).toContain('${cachePrefixPreamble}');
  });

  it('the preamble is CONSUMED wherever it is produced', () => {
    /**
     * The structural version of the same rule, so a future refactor that moves the split cannot leave
     * the assignment behind without its use. Three references is the honest expected count: the
     * declaration, the assignment from the split, and the re-application.
     */
    const uses = route.match(/cachePrefixPreamble/g) ?? [];
    expect(uses.length, 'produced but never consumed — the volatile context would vanish').toBeGreaterThanOrEqual(3);
  });

  it('the split is still gated, so turning it off is a real revert', () => {
    // The flag is what makes this safe to enable on live traffic: unset restores the exact prompt shape
    // that has been serving builds for months, with no deploy.
    expect(route).toContain("envFlag('AGENTV3_CACHE_PREFIX')");
  });
});
