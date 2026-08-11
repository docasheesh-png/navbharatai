import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * EVERY RUNNER'S TOKENS MUST BE ATTRIBUTED TO THE PROVIDER THAT ACTUALLY RAN THEM.
 *
 * ROOT CAUSE (real build report, Shiv Medical Store 2026-08-10 — ₹566.96 charged on a FREE-tier build):
 * the 12 heal/repair runners were each hand-written as
 *
 *   buildTurnRunner({ ...healRunnerRoutingOpts(freeTierBuildActive), noClaude: noClaudeBuild })
 *
 * with no `onTurnComplete`. Their usage reached the build TOTAL but was attributed to no provider, so
 * it fell into the "unattributed remainder" — which realProviderCostUsd deliberately prices at SONNET
 * rates as a conservative upper bound.
 *
 * The effect was exactly backwards. healRunnerRoutingOpts routes a free build's heals to the CHEAP
 * coders (~$0.6/M) and the user was billed for them at $3/M: a 5× overcharge on 507k of that build's
 * 776k tokens. Because heals only fire when a build STRUGGLES, the worse a build went, the more of it
 * was billed at the most expensive rate in the stack.
 *
 * Attribution is also what makes the weak tier's `noClaude: true` PROVABLE — an unattributed token has
 * no provider, so a Claude call hiding in that bucket is invisible to the honesty detector on exactly
 * the tier where Claude is forbidden.
 *
 * This is the same shape as the bug `enforceNoClaude` exists to prevent: a guarantee that depended on
 * every heal-gate author remembering one option. The obligation now lives in ONE factory, and this
 * test fails if anyone reintroduces the raw form.
 */
const src = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

/**
 * The ONE documented exemption. makeFastTextRunner deliberately omits onTurnComplete because the fast
 * lane accounts for its own usage through buildUsage; the comment above it says so.
 *
 * ⚠️ OPEN ITEM — now MEASURED, and messier than it first looked (2026-08-11). The remainder is
 * max(0, buildTotal − attributed), and captureTurnUsage feeds only the ledger, never buildUsage — so
 * attributing a turn cannot double-count the TOTAL. But the fast-lane call sites are not uniform:
 *
 *   • three of them (blueprint / plan / one-shot) call `buildUsage.add(...)` right after the turn, so
 *     their tokens ARE in the total and are NOT in the ledger — they sit in the Sonnet-priced
 *     remainder, exactly the defect this file fixes for heal runners. Those are OVER-charged.
 *   • three of them add nothing at all, so their tokens reach neither accumulator. Those turns are
 *     currently billed to nobody — our own margin leak, never a user overcharge.
 *
 * So simply adding onTurnComplete to makeFastTextRunner would fix the first three AND start charging
 * users for the second three, which is a bill INCREASE, not a correction. The right shape is for the
 * runner to own both halves of the accounting (ledger + total) and for the three manual
 * `buildUsage.add` calls to be removed with it — a change that moves real money in two directions and
 * must not be made blind. Raised with the admin; not shipped on a guess.
 */
const EXEMPT = ['makeFastTextRunner'];

/** Each `buildTurnRunner(...)` call in the file, with balanced-paren extraction. */
function runnerCalls(): Array<{ line: number; body: string; context: string }> {
  const out: Array<{ line: number; body: string; context: string }> = [];
  const re = /buildTurnRunner\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') depth -= 1;
      i += 1;
    }
    out.push({
      line: src.slice(0, m.index).split('\n').length,
      body: src.slice(m.index + m[0].length, i - 1),
      // Enough preceding source to spot a named exemption.
      context: src.slice(Math.max(0, m.index - 400), m.index),
    });
  }
  return out;
}

describe('heal runners are attributed by construction', () => {
  it('the raw hand-written form is GONE and cannot come back', () => {
    // This exact string is what produced the overcharge. Its absence is the fix.
    expect(src).not.toContain('buildTurnRunner({ ...healRunnerRoutingOpts(');
  });

  it('every heal/repair runner is built through the one factory', () => {
    const viaFactory = src.match(/buildTurnRunner\(healRunnerOpts\(\)\)/g) || [];
    expect(viaFactory.length).toBeGreaterThanOrEqual(13);
  });

  it('the factory attributes BOTH the provider and its token usage', () => {
    const at = src.indexOf('const healRunnerOpts = ()');
    expect(at, 'healRunnerOpts factory is missing').toBeGreaterThan(-1);
    const factory = src.slice(at, at + 400);
    expect(factory).toContain('onTurnComplete: captureTurnUsage');
    expect(factory).toContain('onProviderUsed: captureProvider');
    // …and still carries the routing + the absolute no-Claude guard it replaced.
    expect(factory).toContain('healRunnerRoutingOpts(freeTierBuildActive)');
    expect(factory).toContain('noClaude: noClaudeBuild');
  });

  it('NO runner anywhere is unattributed except the one documented exemption', () => {
    // The real guard: a NEW runner added tomorrow, in any shape, fails here rather than silently
    // billing a user at Sonnet rates for a Kimi call.
    const offenders = runnerCalls()
      .filter((c) => !c.body.includes('onTurnComplete') && !c.body.includes('healRunnerOpts()'))
      .filter((c) => !EXEMPT.some((name) => c.context.includes(name)))
      .map((c) => `line ${c.line}`);
    expect(offenders).toEqual([]);
  });

  it('the exemption is still exactly ONE, and still the documented one', () => {
    // If this count grows, someone exempted a runner without recording why.
    const unattributed = runnerCalls().filter(
      (c) => !c.body.includes('onTurnComplete') && !c.body.includes('healRunnerOpts()'),
    );
    expect(unattributed).toHaveLength(1);
    expect(unattributed[0].context).toContain('makeFastTextRunner');
    // The reason must stay written down next to it.
    expect(unattributed[0].context).toContain('double-counting');
  });
});
