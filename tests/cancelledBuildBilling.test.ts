import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decideCancelledBuildBill } from '../src/server/AgentV3/cancelledBuildBilling';
import type { AbortCause } from '../src/server/AgentV3/buildAbortCause';

const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

/**
 * ADMIN, 2026-09-14: "kabhi kabhi app 90% tab ban jati hai, aur user … build cancel kar deta hai. to
 * bhi woh build fail me jati hai, aise case me bhi charge 0 aata hai. USER KI GALTI HAI, ISME HAMARI
 * NAHI!" — and then: "isko aise fix karo ki DONO ka nuksan na ho, na mera na user ka."
 */
const facts = (o: Partial<Parameters<typeof decideCancelledBuildBill>[0]> = {}) => ({
  abortCause: 'user-stop' as AbortCause,
  filesWritten: 12,
  appRendered: true,
  decidedBilledUsd: 1.00,
  ...o,
});

describe('the three deliveries — the admin\'s own 0%–50% discount band', () => {
  it('stopped with a WORKING app: 0% discount, charged in full for the work done', () => {
    const b = decideCancelledBuildBill(facts());
    expect(b.applies).toBe(true);
    expect(b.delivery).toBe('working-app');
    expect(b.discountPct).toBe(0);
    expect(b.billedUsd).toBe(1.00);
  });

  it('stopped with files saved but never seen running: 50% off', () => {
    const b = decideCancelledBuildBill(facts({ appRendered: false }));
    expect(b.delivery).toBe('files-saved');
    expect(b.discountPct).toBe(50);
    expect(b.billedUsd).toBe(0.50);
  });

  it('🔴 stopped with NOTHING built: FREE — not the admin\'s proposed 50%', () => {
    // He proposed charging 50% here. Under real-cost billing that would bill many times what the
    // work cost, for something the user cannot use — the most refund-generating thing a builder can
    // do, and a cost this repo's billing law forbids inventing.
    const b = decideCancelledBuildBill(facts({ filesWritten: 0, appRendered: false }));
    expect(b.delivery).toBe('nothing');
    expect(b.billedUsd).toBe(0);
    expect(b.discountPct).toBe(100);
    expect(b.userMessage).toBeNull();
  });

  it('zero files is free even when the app somehow rendered', () => {
    expect(decideCancelledBuildBill(facts({ filesWritten: 0 })).billedUsd).toBe(0);
  });
});

describe('🔒 RULE 1 + 2 — only an EXPLICIT stop, and an unknown is never the user', () => {
  const notTheUser: AbortCause[] = ['watchdog', 'advisory-cap', 'deploy-drain', 'lock-reclaimed', 'reaper', 'cost-cap', 'unknown'];

  it('every other abort cause leaves the existing free rule in charge', () => {
    for (const abortCause of notTheUser) {
      const b = decideCancelledBuildBill(facts({ abortCause }));
      expect(b.applies, abortCause).toBe(false);
      expect(b.billedUsd, abortCause).toBe(0);
    }
  });

  it('🔴 "unknown" specifically — an abort we cannot explain is never charged to the user', () => {
    // buildAbortCause.ts exists because a watchdog stop was once reported as "Build stopped by the
    // user" ("maine nahi roki, khud ruki hai bhai"). Charging for that mistake is the expensive
    // version of it.
    expect(decideCancelledBuildBill(facts({ abortCause: 'unknown' })).applies).toBe(false);
  });

  it('a build that was never aborted at all is untouched', () => {
    expect(decideCancelledBuildBill(facts({ abortCause: 'unknown', appRendered: true })).billedUsd).toBe(0);
  });
});

describe('🔒 RULE 3 — it can only ever REDUCE, never invent a charge', () => {
  it('cancelling never costs more than finishing', () => {
    for (const decidedBilledUsd of [0.01, 0.4, 1, 7.5, 100]) {
      for (const appRendered of [true, false]) {
        const b = decideCancelledBuildBill(facts({ decidedBilledUsd, appRendered }));
        expect(b.billedUsd).toBeLessThanOrEqual(decidedBilledUsd);
        expect(b.billedUsd).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('a build that was already free stays free — there is nothing to take a discount from', () => {
    expect(decideCancelledBuildBill(facts({ decidedBilledUsd: 0 })).billedUsd).toBe(0);
    expect(decideCancelledBuildBill(facts({ decidedBilledUsd: 0 })).userMessage).toBeNull();
    expect(decideCancelledBuildBill(facts({ decidedBilledUsd: 0, appRendered: false })).userMessage).toBeNull();
  });

  it('a nonsense cost cannot become a bill', () => {
    for (const decidedBilledUsd of [NaN, -5, Infinity, undefined as never, 'lots' as never]) {
      expect(decideCancelledBuildBill(facts({ decidedBilledUsd })).billedUsd).toBe(0);
    }
  });

  it('nonsense file counts resolve to "nothing delivered", which is the free side', () => {
    for (const filesWritten of [NaN, -3, undefined as never, 'many' as never]) {
      expect(decideCancelledBuildBill(facts({ filesWritten })).billedUsd).toBe(0);
    }
  });

  it('appRendered must be exactly true — a truthy value is not evidence', () => {
    expect(decideCancelledBuildBill(facts({ appRendered: 1 as never })).discountPct).toBe(50);
    expect(decideCancelledBuildBill(facts({ appRendered: 'yes' as never })).discountPct).toBe(50);
    expect(decideCancelledBuildBill(facts({ appRendered: undefined as never })).discountPct).toBe(50);
  });

  it('null and undefined facts are free', () => {
    expect(decideCancelledBuildBill(null).billedUsd).toBe(0);
    expect(decideCancelledBuildBill(undefined).applies).toBe(false);
  });
});

describe('the user is told, in NavBharatAI\'s own words', () => {
  it('says what they were charged for and that it is not a full build', () => {
    const full = decideCancelledBuildBill(facts())!.userMessage!;
    expect(full).toContain('You stopped this build');
    expect(full).toMatch(/not for a full build/);
    const half = decideCancelledBuildBill(facts({ appRendered: false }))!.userMessage!;
    expect(half).toMatch(/HALF/);
    expect(half).toMatch(/files are saved/);
  });

  it('🔒 WHITE-LABEL LAW — no vendor or model name anywhere in what the user reads', () => {
    const forbidden = /GLM|Z\.ai|Kimi|Moonshot|Claude|Anthropic|Gemini|Vertex|Grok|xAI|Bedrock|OpenAI|sonnet|opus|haiku/i;
    for (const f of [facts(), facts({ appRendered: false }), facts({ filesWritten: 0 })]) {
      const m = decideCancelledBuildBill(f).userMessage;
      if (m) expect(m).not.toMatch(forbidden);
    }
  });
});

describe('the wiring — this moves real money, so every link is asserted', () => {
  it('reads the cause from the signal, never from a guess', () => {
    expect(route).toContain('abortCause: abortCauseOf(abort.signal)');
  });

  it('is fed the real decided bill, so it can only reduce it', () => {
    expect(route).toContain('decidedBilledUsd: effectiveBilledUsd');
  });

  it('🔒 runs BEFORE the blanket zero — after it, there would be nothing left to charge', () => {
    const decide = route.indexOf('decideCancelledBuildBill({');
    const blanket = route.indexOf('zeroBillForFailedBuild(result.ok)');
    expect(decide).toBeGreaterThan(-1);
    expect(blanket).toBeGreaterThan(-1);
    expect(decide).toBeLessThan(blanket);
  });

  it('has a kill switch, because a money change must revert without a deploy', () => {
    expect(route).toContain('AGENTV3_BILL_CANCELLED');
    expect(route).toMatch(/AGENTV3_BILL_CANCELLED[\s\S]{0,120}!==\s*'off'/);
  });

  it('records the reasoning for the admin, not just a number', () => {
    expect(route).toContain('CANCELLED_BUILD_CHARGED');
  });
});
