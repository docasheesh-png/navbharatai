import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sandboxCost, sandboxBillableUsd, sandboxBillingNote } from '../src/server/AgentV3/sandboxCost';
import { decideBuildBilledUsd } from '../src/server/routes/agentv3';

/**
 * ADMIN 2026-08-11: "e2b ka kharcha bill me jodo."
 *
 * They are right that it is a real gap: every v5 build runs a cloud VM billed by WALL-CLOCK, and until
 * now NavBharatAI absorbed 100% of it — a build that spent almost nothing on tokens but held a VM for
 * forty minutes was pure loss.
 *
 * BUT IT CANNOT SIMPLY BE SWITCHED ON. `sandboxUsdPerHour` defaults to $0.10, described in its own
 * file as "a ROUND, conservative placeholder". The billing law says the bill a user sees is 100% REAL
 * and that we must NEVER invent a cost — so charging a real person on that default would be exactly
 * the thing the law forbids. Hence the two-key gate below: the admin's decision AND the admin's real
 * rate. Then the seconds are MEASURED (a clock) and the rate is a stated price — a measurement times a
 * price, not a guess.
 */

const rate = (usdPerHour?: string, on = true) => ({
  ...(on ? { AGENTV3_BILL_SANDBOX: 'on' } : {}),
  ...(usdPerHour ? { E2B_USD_PER_HOUR: usdPerHour } : {}),
} as NodeJS.ProcessEnv);

describe('the two-key gate — a placeholder rate must never reach a real bill', () => {
  const cost = sandboxCost(3600, rate('0.10'))!; // one hour

  it('bills nothing when the admin has not switched it on', () => {
    expect(sandboxBillableUsd(cost, rate('0.10', false))).toBe(0);
  });

  it('bills nothing when the REAL RATE is unset — even with the switch on', () => {
    /**
     * This is the condition that matters. Without it, flipping the switch would silently bill the
     * $0.10 placeholder — a number nobody verified, on a real person's balance.
     */
    expect(sandboxBillableUsd(cost, rate(undefined, true))).toBe(0);
    expect(sandboxBillableUsd(cost, rate('0', true))).toBe(0);
    expect(sandboxBillableUsd(cost, rate('not-a-number', true))).toBe(0);
  });

  it('bills only when BOTH the switch and a real rate are present', () => {
    expect(sandboxBillableUsd(cost, rate('0.10'))).toBeCloseTo(0.10, 6);
  });

  it('an unmeasured or absurd sandbox time bills nothing', () => {
    expect(sandboxBillableUsd(null, rate('0.10'))).toBe(0);
    expect(sandboxCost(-5)).toBeNull();
    expect(sandboxCost(90_000)).toBeNull(); // a day+ on one build is a broken clock, not a bill
  });

  it('the DEFAULT environment changes nothing — today\'s bill is untouched', () => {
    expect(sandboxBillableUsd(cost, {} as NodeJS.ProcessEnv)).toBe(0);
  });
});

describe('it reaches the real cost BEFORE the markup, which is the only place it belongs', () => {
  const ledger = { entries: () => [], total: () => ({ inputTokens: 0, outputTokens: 0 }), byProvider: () => ({}) } as any;
  const sink = { inputTokens: 0, outputTokens: 0 };

  it('a sandbox cost increases the bill on a non-Opus tier', () => {
    const without = decideBuildBilledUsd(ledger, sink, 'off', 'u1', 'a@b.c', 0);
    const withSandbox = decideBuildBilledUsd(ledger, sink, 'off', 'u1', 'a@b.c', 0.25);
    expect(withSandbox.effectiveBilledUsd).toBeGreaterThan(without.effectiveBilledUsd);
  });

  it('it is MARKED UP like any other real cost, not added on top afterwards', () => {
    // The formula is literally tieredMarkup(real cost); a wall-clock VM is as real a cost as a token,
    // so it belongs INSIDE the markup, not bolted on after it.
    const r = decideBuildBilledUsd(ledger, sink, 'off', 'u1', 'a@b.c', 1);
    expect(r.effectiveBilledUsd).toBeGreaterThan(1);
  });

  it('a negative or junk sandbox cost can never reduce a bill', () => {
    const base = decideBuildBilledUsd(ledger, sink, 'off', 'u1', 'a@b.c', 0).effectiveBilledUsd;
    expect(decideBuildBilledUsd(ledger, sink, 'off', 'u1', 'a@b.c', -5).effectiveBilledUsd).toBe(base);
    expect(decideBuildBilledUsd(ledger, sink, 'off', 'u1', 'a@b.c', NaN).effectiveBilledUsd).toBe(base);
  });

  it('the OPUS tiers are deliberately untouched', () => {
    /**
     * CLAUDE.md records the Opus path as admin-CONFIRMED at "real Opus × 2". Quietly changing a
     * confirmed price is not a session's call, so the sandbox cost does not enter it.
     */
    const a = decideBuildBilledUsd(ledger, sink, 'max', 'u1', 'a@b.c', 0);
    const b = decideBuildBilledUsd(ledger, sink, 'max', 'u1', 'a@b.c', 5);
    expect(b.effectiveBilledUsd).toBe(a.effectiveBilledUsd);
    expect(b.isOpusTier).toBe(true);
  });

  it('omitting the argument entirely behaves exactly as before', () => {
    expect(decideBuildBilledUsd(ledger, sink, 'off', 'u1', 'a@b.c').effectiveBilledUsd)
      .toBe(decideBuildBilledUsd(ledger, sink, 'off', 'u1', 'a@b.c', 0).effectiveBilledUsd);
  });
});

describe('the admin can tell "we charged for it" from "we absorbed it"', () => {
  const cost = sandboxCost(1800, rate('0.20'))!;

  it('names the reason when it is switched off', () => {
    expect(sandboxBillingNote(cost, rate('0.20', false))).toMatch(/absorbed by NavBharatAI/i);
  });

  it('names the MISSING RATE specifically, and what to do about it', () => {
    // "It is off" and "we do not know the price" are different problems with different fixes.
    const note = sandboxBillingNote(cost, rate(undefined, true));
    expect(note).toMatch(/NOT billed/i);
    expect(note).toMatch(/E2B_USD_PER_HOUR is unset/);
    expect(note).toMatch(/placeholder/i);
  });

  it('states the rate it actually used when it IS billed', () => {
    expect(sandboxBillingNote(cost, rate('0.20'))).toMatch(/at \$0\.2\/hr — included/);
  });

  it('says plainly when there was nothing to measure', () => {
    expect(sandboxBillingNote(null)).toMatch(/not measured/i);
  });
});

describe('WIRING — the cost is read at BILLING time, not after it', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('both billing paths pass it, so the settle and the watchdog can never disagree', () => {
    // Fix 67 established that these two must agree; a cost on one and not the other would revive that.
    // The helper was renamed on 2026-08-22 (`…Usd` → `…Detail`) when it began returning the SECONDS as
    // well, so the user-facing "Live preview: 4 min — ₹8" line and the bill come from one measurement.
    // The invariant is unchanged: both paths, same helper, same build start.
    const hits = route.match(/billableSandboxDetail\(actuator, workspaceId, /g) || [];
    expect(hits.length).toBe(2);
  });

  it('BOTH paths pass the build start, so neither can bill idle preview time', () => {
    /**
     * ADMIN QUESTION 2026-08-12: "AGENTV3_BILL_SANDBOX se in-browser preview ke paise to nahi lagenge?"
     *
     * They were right to ask. `sandboxHeldSeconds` measures from when the sandbox came UP — the clock is
     * set once per workspace and cleared only on pause/reap — so a user who built, read their preview
     * for twenty minutes, then asked for one more change would have had those twenty idle minutes billed
     * onto the SECOND build. A third build would be charged for all of it again: the same seconds, sold
     * twice. Capping at the build's own duration fixes both at once.
     */
    expect(route).toContain('billableSandboxDetail(actuator, workspaceId, billingCtx.buildStartedAt)');
    expect(route).toContain('billableSandboxDetail(actuator, workspaceId, buildStartedAt)');
    // The cap itself, now named before it is priced so the seconds can be reported alongside the ₹.
    expect(route).toContain('const billable = Math.min(seconds, buildSeconds);');
    expect(route).toContain('sandboxBillableUsd(sandboxCost(billable))');
    // And the number the USER is shown is that same one — not a second measurement taken later.
    expect(route).toContain('usdInrRate(), livePreviewCharge)');
    expect(route).toContain('usdInrRate(), watchdogLivePreview)');
  });

  it('an UNKNOWN build start bills nothing rather than guessing', () => {
    const at = route.indexOf('function billableSandboxDetail');
    const fn = route.slice(at, at + 2200);
    // `none` replaced a bare `0` when the helper began returning seconds too (2026-08-22). The
    // property is asserted, not the word: the next test pins that `none` really is zero on both.
    expect(fn).toContain('if (!Number.isFinite(started) || started <= 0) return none;');
  });

  it('it reads the SAME measurement the report uses', () => {
    // Two different sources of "how long did the VM run" would eventually disagree, and the bill
    // would be the one that was wrong.
    expect(route).toContain('sandboxHeldSeconds');
    expect(route).toContain('const held = fn.call(actuator, workspaceId);');
  });

  it('any doubt bills ZERO — a money path must fail toward charging less', () => {
    const at = route.indexOf('function billableSandboxDetail');
    const fn = route.slice(at, at + 2200);
    expect(fn).toContain("if (typeof fn !== 'function' || !workspaceId) return none;");
    expect(fn).toContain('catch {\n    return none;');
    // …and `none` is genuinely nothing — otherwise every guard above would be pointing at a value
    // that could quietly become non-zero.
    expect(fn).toContain('const none = { seconds: 0, usd: 0 };');
    // Seconds are reported only when they were CHARGED, so the user can never see a duration next to
    // a ₹0 they cannot reconcile.
    expect(fn).toContain('return usd > 0 ? { seconds: billable, usd } : none;');
  });

  it('the report says whether it reached the bill', () => {
    expect(route).toContain("code: 'SANDBOX_BILLING'");
    expect(route).toContain('sandboxBillingNote(sandboxCost(held))');
  });
});
