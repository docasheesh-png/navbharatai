import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decideCancelledBuildBill } from '../src/server/AgentV3/cancelledBuildBilling';
import { decideMarkupOnProof } from '../src/server/AgentV3/previewEarnsMarkup';
import type { AbortCause } from '../src/server/AgentV3/buildAbortCause';

const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
/** Comments removed, so a rule about the CODE is never satisfied or broken by prose. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const module_ = readFileSync(resolve(__dirname, '../src/server/AgentV3/cancelledBuildBilling.ts'), 'utf8');

/**
 * A CANCELLATION TAKES OUR MARGIN, NEVER OUR COST (admin-mandated 2026-09-21).
 *
 * Admin: *"haan, floor + naya message bhej do."*
 *
 * 🔴 THE DEFECT WAS A COMPOSITION NOBODY DECIDED, and it was not rare — it was every stopped build.
 * `cancelledBuildBilling` (2026-09-14) halves the bill when a user stops with files saved but no app
 * seen running. `previewEarnsMarkup` (2026-09-18) waives the service margin for the SAME reason —
 * and they read the SAME fact, `buildObs.previewRendered`. So the half was never cutting into a
 * margin: it was cutting into NavBharatAI's own out-of-pocket cost, always.
 *
 * Both rules are individually correct, and each was written without the other existing. This suite
 * pins the decision: the discount may take the profit and may never take the cost.
 */

const facts = (o: Partial<Parameters<typeof decideCancelledBuildBill>[0]> = {}) => ({
  abortCause: 'user-stop' as AbortCause,
  filesWritten: 12,
  appRendered: false,      // the state in which BOTH rules fire — the whole subject of this suite
  decidedBilledUsd: 1.00,
  ...o,
});

describe('🔴 the two rules really do read one fact — which is why this was never an edge case', () => {
  it('the half-off band is reachable ONLY when the margin has already been waived', () => {
    // If a build's app was seen running, `decideCancelledBuildBill` charges in full (0%) and
    // `decideMarkupOnProof` leaves the bill alone. If it was not, BOTH fire. There is no third
    // state, because both take their answer from the same boolean.
    const REAL = 0.25, SANDBOX = 0.05, DECIDED = 1.20;
    for (const seen of [true, false]) {
      const markup = decideMarkupOnProof({
        decidedBilledUsd: DECIDED, realCostUsd: REAL, sandboxUsd: SANDBOX,
        previewProven: seen, expectsArtifacts: true, enabled: true,
      });
      const cancel = decideCancelledBuildBill(facts({ appRendered: seen, decidedBilledUsd: markup.billedUsd }));
      if (seen) {
        expect(markup.markupApplied, 'seen: margin intact').toBe(true);
        expect(cancel.delivery, 'seen: charged in full').toBe('working-app');
      } else {
        expect(markup.markupApplied, 'unseen: margin waived').toBe(false);
        expect(cancel.delivery, 'unseen: the half-off band').toBe('files-saved');
      }
    }
  });

  it('🔒 END TO END: a margin-free bill is no longer halved below what the build cost us', () => {
    // The arithmetic from the header, run through both modules in the route's own order.
    const REAL = 1.00, SANDBOX = 0.20, DECIDED = 4.80;   // real $1.20, tiered markup → $4.80
    const markup = decideMarkupOnProof({
      decidedBilledUsd: DECIDED, realCostUsd: REAL, sandboxUsd: SANDBOX,
      previewProven: false, expectsArtifacts: true, enabled: true,
    });
    expect(markup.billedUsd).toBeCloseTo(1.20, 6);       // the margin is gone
    const bill = decideCancelledBuildBill(facts({
      decidedBilledUsd: markup.billedUsd, realCostUsd: REAL, sandboxUsd: SANDBOX,
    }));
    // Before the floor this was $0.60 — half of our own cost, a $0.60 loss on a build nobody failed.
    expect(bill.billedUsd).toBeCloseTo(1.20, 6);
    expect(bill.costFloorApplied).toBe(true);
    expect(bill.discountPct).toBe(0);
  });
});

describe('the floor itself', () => {
  it('floors at the real cost when half would fall below it', () => {
    const b = decideCancelledBuildBill(facts({ decidedBilledUsd: 1.00, realCostUsd: 0.80 }));
    expect(b.billedUsd).toBeCloseTo(0.80, 6);
    expect(b.costFloorApplied).toBe(true);
    expect(b.discountPct).toBe(20);
  });

  it('counts the VM as part of what the build cost us — both halves, or the floor under-protects', () => {
    const b = decideCancelledBuildBill(facts({ decidedBilledUsd: 1.00, realCostUsd: 0.40, sandboxUsd: 0.35 }));
    expect(b.billedUsd).toBeCloseTo(0.75, 6);
    expect(b.costFloorApplied).toBe(true);
  });

  it('🔒 half still wins when half is ABOVE our cost — the margin is genuinely discounted', () => {
    const b = decideCancelledBuildBill(facts({ decidedBilledUsd: 4.00, realCostUsd: 1.00, sandboxUsd: 0.20 }));
    expect(b.billedUsd).toBeCloseTo(2.00, 6);
    expect(b.costFloorApplied).toBe(false);
    expect(b.discountPct).toBe(50);
  });

  it('🔒 RULE 3 SURVIVES — the floor can never raise a charge above the decided bill', () => {
    for (const realCostUsd of [0.5, 1, 2, 50, 1e6]) {
      const b = decideCancelledBuildBill(facts({ decidedBilledUsd: 1.00, realCostUsd }));
      expect(b.billedUsd, `real ${realCostUsd}`).toBeLessThanOrEqual(1.00);
      expect(b.discountPct, `real ${realCostUsd}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('a nonsense real cost is no floor at all, never an invented one', () => {
    for (const realCostUsd of [NaN, -3, Infinity, 'lots' as never, null as never]) {
      const b = decideCancelledBuildBill(facts({ decidedBilledUsd: 1.00, realCostUsd }));
      expect(b.billedUsd, String(realCostUsd)).toBeCloseTo(0.50, 6);
      expect(b.costFloorApplied, String(realCostUsd)).toBe(false);
    }
  });

  it('🔒 ABSENT means today\'s behaviour, byte for byte — the module never guesses its own floor', () => {
    const b = decideCancelledBuildBill(facts({ decidedBilledUsd: 1.00 }));
    expect(b.billedUsd).toBeCloseTo(0.50, 6);
    expect(b.discountPct).toBe(50);
    expect(b.costFloorApplied).toBe(false);
    // Comments stripped: the header NAMES `realProviderCostUsd` as the one place a cost is computed,
    // which is the opposite of calling it. What must not exist is a second estimate in the code.
    expect(codeOf(module_)).not.toMatch(/realProviderCostUsd|providerRates|estimateTokens/);
  });
});

describe('🔒 the three ₹0 outcomes are UNTOUCHED — a floor under them would charge for nothing', () => {
  const REAL = { realCostUsd: 5.00, sandboxUsd: 2.00 };   // a large real cost, to prove it cannot leak in

  it('nothing written at all stays free', () => {
    const b = decideCancelledBuildBill(facts({ filesWritten: 0, ...REAL }));
    expect(b.billedUsd).toBe(0);
    expect(b.delivery).toBe('nothing');
    expect(b.costFloorApplied).toBe(false);
  });

  it('only the platform template, untouched, stays free (autopsy 2b0a3ed5)', () => {
    const b = decideCancelledBuildBill(facts({ filesWritten: 12, preseededUnchanged: 12, ...REAL }));
    expect(b.billedUsd).toBe(0);
    expect(b.delivery).toBe('nothing');
  });

  it('an unverified EDIT of a working app stays free (autopsy 95598899)', () => {
    const b = decideCancelledBuildBill(facts({ editingExistingApp: true, ...REAL }));
    expect(b.billedUsd).toBe(0);
    expect(b.delivery).toBe('unverified-edit');
  });

  it('a build nobody stopped, and an abort we cannot explain, stay free', () => {
    for (const abortCause of ['watchdog', 'unknown', 'cost-cap'] as AbortCause[]) {
      expect(decideCancelledBuildBill(facts({ abortCause, ...REAL })).billedUsd, abortCause).toBe(0);
      expect(decideCancelledBuildBill(facts({ abortCause, ...REAL })).applies, abortCause).toBe(false);
    }
  });

  it('a WORKING app is charged in full, and the floor has no say in it', () => {
    const b = decideCancelledBuildBill(facts({ appRendered: true, decidedBilledUsd: 1.00, ...REAL }));
    expect(b.billedUsd).toBeCloseTo(1.00, 6);
    expect(b.discountPct).toBe(0);
    expect(b.costFloorApplied).toBe(false);
  });
});

describe('the new message', () => {
  const floored = decideCancelledBuildBill(facts({ decidedBilledUsd: 1.00, realCostUsd: 0.80 }));
  const halved = decideCancelledBuildBill(facts({ decidedBilledUsd: 1.00 }));

  it('🔴 does NOT say "half" when the charge was not halved', () => {
    // The number on the bill and the sentence beside it must agree. This is the whole reason the
    // message had to change with the arithmetic rather than after it.
    expect(floored.userMessage).not.toMatch(/HALF/i);
    expect(floored.userMessage).toMatch(/only what the work done so far actually cost/);
    expect(floored.userMessage).toMatch(/no service charge/);
  });

  it('still says "half" when it really is half', () => {
    expect(halved.userMessage).toMatch(/HALF/);
  });

  it('both still say the files are saved and the work can continue', () => {
    for (const m of [floored.userMessage, halved.userMessage]) {
      expect(m).toContain('You stopped this build');
      expect(m).toMatch(/files are saved/);
      expect(m).toMatch(/carry on/);
    }
  });

  it('🔒 WHITE-LABEL LAW — no vendor or model name, and no internal figure', () => {
    const forbidden = /GLM|Z\.ai|Kimi|Moonshot|Claude|Anthropic|Gemini|Vertex|Grok|xAI|Bedrock|OpenAI|Nemotron|sonnet|opus|haiku|markup|margin/i;
    for (const m of [floored.userMessage, halved.userMessage]) expect(m).not.toMatch(forbidden);
  });

  it('nothing is said when nothing is charged', () => {
    expect(decideCancelledBuildBill(facts({ decidedBilledUsd: 0, realCostUsd: 5 })).userMessage).toBeNull();
  });
});

/**
 * Source-level guards. `tsc` and `vitest` cannot see a fact that was never passed in, nor a notice
 * that fires twice — and both are exactly how this class arrives. Each was proven by reverting the
 * thing it protects.
 */
describe('the wiring', () => {
  it('the route really passes the two real-cost numbers to the cancellation decision', () => {
    const call = route.slice(route.indexOf('? decideCancelledBuildBill({'));
    const body = call.slice(0, call.indexOf('        : null;'));
    expect(body).toMatch(/realCostUsd:\s*decidedRealCostUsd/);
    expect(body).toMatch(/sandboxUsd:\s*decidedSandboxUsd/);
  });

  it('they are the SAME two numbers the margin waiver is given — one cost, not two estimates', () => {
    const waiver = route.slice(route.indexOf('const markupDecision = decideMarkupOnProof({'));
    expect(waiver.slice(0, 600)).toMatch(/realCostUsd:\s*decidedRealCostUsd/);
    expect(waiver.slice(0, 600)).toMatch(/sandboxUsd:\s*decidedSandboxUsd/);
  });

  it('🔒 ONE money statement — the cancellation message clears the waived-margin notice', () => {
    // Without this the floored charge equals the waiver's own figure, so the notice at the end of
    // the settle ALSO fires and the user is told the same thing twice in different words.
    const emit = route.indexOf('if (cancelBill.userMessage) {');
    expect(emit).toBeGreaterThan(-1);
    const block = route.slice(emit, emit + 900);
    expect(block).toMatch(/waivedMarkupNotice = null;/);
    expect(block.indexOf('waivedMarkupNotice = null;'))
      .toBeLessThan(block.indexOf('text: `🧾 ${cancelBill.userMessage}`'));
  });

  it('the floor sits AFTER every ₹0 return, so it can never charge for an undelivered build', () => {
    const floorAt = module_.indexOf('const real = money(f.realCostUsd)');
    expect(floorAt).toBeGreaterThan(-1);
    for (const earlier of ["delivery: 'nothing'", "delivery: 'unverified-edit'", "delivery: 'working-app'"]) {
      expect(module_.indexOf(earlier), earlier).toBeLessThan(floorAt);
    }
  });

  it('the kill switch still restores the whole rule, floor and all', () => {
    expect(route).toContain('AGENTV3_BILL_CANCELLED');
  });

  it('🔴 the rule EVERY AI quotes back to a user no longer says "half"', () => {
    // AppKnowledgeBase is what Free chat, Pro chat and the assistants read to answer *"why was my
    // cancelled build charged?"*. It stated case (2) as a flat HALF — true until this change and
    // false after it, and nothing in tsc or the suite can see a stale sentence. CLAUDE.md's sync
    // rule is that it moves in the SAME commit; this is that rule with teeth.
    const kb = readFileSync(resolve(__dirname, '../src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');
    const rule = kb.slice(kb.indexOf('IF YOU STOP A BUILD YOURSELF'));
    const caseTwo = rule.slice(0, rule.indexOf('(3) you stop before anything'));
    expect(caseTwo).not.toMatch(/you pay HALF/);
    expect(caseTwo).toMatch(/no service charge/i);
    // The two protective halves of the sentence must both survive a later tidy-up.
    expect(caseTwo).toMatch(/less than a finished build/);
    expect(caseTwo).toMatch(/never less than what that work genuinely cost/);
  });
});
