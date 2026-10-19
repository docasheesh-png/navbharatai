/**
 * EVERY BILLING POINT BILLS A STOP BY THE SAME RULES — AND EVERY AI QUOTES THOSE RULES WORD FOR WORD.
 *
 * Pre-deploy review 2026-10-19, round 4 (owner-approved fixes for residual risks 1 and 2).
 *
 * 1 — routes/agentv3.ts settles a build at TWO points: the normal settle, and `finalizeOnDeadline` (the
 *     wall-clock/advisory cap). Round 3 put the Stop rules on the first only. The finalizer billed every
 *     `ok` build in full, and a typed "stop" or a Stop from another instance does not end the stream, so
 *     the cap could settle a stopped build first (the debit is idempotent per buildRef: first wins). Both
 *     points now call `settleStopOrFailure`. The finalizer's REAL block is executed below and compared
 *     case by case with the REAL settle block.
 * 2 — AppKnowledgeBase.ts (what every in-app AI reads) described the Stop rules in its own older words.
 *     It now QUOTES FAILED_BUILD_RULE / STOPPED_BUILD_RULE; this file fails if they drift apart again.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import {
  freeCancellationMessage, settleStopOrFailure, stopBillingSwitches, preseededUnchangedCount, stopFellInWindow,
  decideCancelledBuildBill, type CancelledBuildFacts,
} from '../src/server/AgentV3/cancelledBuildBilling';
import { abortBuild, abortCauseOf, abortRequestedAtOf, type AbortCause } from '../src/server/AgentV3/buildAbortCause';
import {
  FAILED_BUILD_RULE, STOPPED_BUILD_RULE, FAILED_BUILD_RULE_PLAIN, STOPPED_BUILD_RULE_PLAIN,
} from '../src/content/marketing';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

const ROUTE = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
const ROUTE_CODE = ROUTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const DECIDED = 2;

// `seen`: WHEN the app was first seen running relative to the Stop request (#3820 rule g) — default 'before', which
// is what "had been seen running" means in the public rule. `stylePass`: the Stop fell inside OUR style pass (#3821, h).
type Case = { name: string; written: number; preseeded?: number; rendered?: boolean; edit?: boolean; billed: number;
  seen?: 'before' | 'after' | 'unknown'; stylePass?: boolean };
const STOP_AT = 1_000_000;
const COST = 0.4; // real cost the harness passes to both points (sandbox 0)
const renderedAt = (c: Partial<Case>): number | null =>
  c.rendered !== true ? null : c.seen === 'after' ? STOP_AT + 1_000 : c.seen === 'unknown' ? null : STOP_AT - 1_000;
const styleWindow = (c: Partial<Case>) => (c.stylePass === true ? { startedAt: STOP_AT - 500, endedAt: null } : { startedAt: null, endedAt: null });
const CASES: Case[] = [
  { name: 'zero files written', written: 0, billed: 0 },
  { name: 'starter-only, not seen running', written: 12, preseeded: 12, billed: 0 },
  { name: 'starter-only, SEEN running', written: 12, preseeded: 12, rendered: true, billed: DECIDED },
  { name: 'existing-app edit, not seen working', written: 4, edit: true, billed: 0 },
  { name: 'saved files, no running app', written: 9, billed: DECIDED / 2 },
  { name: 'running app', written: 9, rendered: true, billed: DECIDED },
  // Merged from main (#3820/#3821): both billing points must agree on these too.
  { name: 'running app, but first seen running only AFTER the Stop (g)', written: 9, rendered: true, seen: 'after', billed: COST },
  { name: 'running app, render time unknown (ledger-only proof) (g)', written: 9, rendered: true, seen: 'unknown', billed: COST },
  { name: 'running app, Stop during OUR style pass (h)', written: 9, rendered: true, stylePass: true, billed: COST },
];

const signal = (cause: AbortCause | null) => { const c = new AbortController(); if (cause) abortBuild(c, cause, STOP_AT); return c; };
const files = (n: number) => { const m = new Map<string, string>(); for (let i = 0; i < n; i++) m.set(`f${i}`, `c${i}`); return m; };

// ── The REAL finalizer block, transpiled and executed ─────────────────────────────────────────────────────
const WD_START = 'const wdSwitches = stopBillingSwitches(process.env);';
const WD_END = '// THE BUILD DISCOUNT — on this path too';
const wdBlock = (() => {
  const a = ROUTE.indexOf(WD_START);
  const b = ROUTE.indexOf(WD_END, a);
  if (a < 0 || b < a) throw new Error('finalizer Stop block not found');
  // The slice ends with the closing brace of the `{ … }` block it opens inside; re-open it to balance.
  return transformSync(`{ ${ROUTE.slice(a, b)}`, { loader: 'ts' }).code;
})();
function finalizer(c: { cause: AbortCause | null; ok?: boolean } & Partial<Case>) {
  const recorded: string[] = [];
  const state = { watchdogBilledUsd: DECIDED, watchdogStopNote: null as string | null };
  const preseeded = files(c.preseeded ?? 0);
  new Function(
    'stopBillingSwitches', 'settleStopOrFailure', 'preseededUnchangedCount', 'freeCancellationMessage', 'abortCauseOf',
    'abort', 'writtenFiles', 'billingCtx', 'wdPreviewProven', 'isEditMode', 'decided', 'ok', 'buildDiagRef', 'state',
    'abortRequestedAtOf', 'stopFellInWindow', 'stylePassWindow',
    `let watchdogBilledUsd = state.watchdogBilledUsd; let watchdogStopNote = state.watchdogStopNote;
     ${wdBlock}
     state.watchdogBilledUsd = watchdogBilledUsd; state.watchdogStopNote = watchdogStopNote;`,
  )(
    stopBillingSwitches, settleStopOrFailure, preseededUnchangedCount, freeCancellationMessage, abortCauseOf,
    signal(c.cause), files(c.written ?? 9), { preseededGolden: preseeded, appFirstRenderedAt: renderedAt(c) }, c.rendered === true, c.edit === true,
    { realCostUsd: COST, sandboxUsd: 0 }, c.ok ?? true, { record: (e: { code: string }) => recorded.push(e.code) }, state,
    abortRequestedAtOf, stopFellInWindow, styleWindow(c),
  );
  return { billed: state.watchdogBilledUsd, note: state.watchdogStopNote, recorded };
}

// ── The REAL normal-settle block, same technique (see aStopIsBilledTheSameWheneverItLands.test.ts) ────────
const S_START = 'const stopSettlement = settleStopOrFailure({';
const S_END = 'if (userId && result.ok && effectiveBilledUsd > 0 && freeOnboardingLimit() > 0) {';
const settleBlock = transformSync(ROUTE.slice(ROUTE.indexOf(S_START), ROUTE.indexOf(S_END, ROUTE.indexOf(S_START))), { loader: 'ts' }).code;
function settle(c: { cause: AbortCause | null; ok: boolean } & Partial<Case>) {
  const state = { effectiveBilledUsd: DECIDED, zeroBillReason: undefined as string | undefined, waivedMarkupNotice: null as string | null };
  new Function(
    'settleStopOrFailure', 'stopBillingSwitches', 'preseededUnchangedCount', 'freeCancellationMessage', 'zeroBillForFailedBuild', 'abortCauseOf',
    'abort', 'writtenFiles', 'preseededGolden', 'appSeenRunningForBill', 'isEditMode', 'decidedRealCostUsd', 'decidedSandboxUsd',
    'result', 'buildDiag', 'events', 'state', 'abortRequestedAtOf', 'stopFellInWindow', 'appFirstRenderedAt', 'stylePassWindow',
    `let effectiveBilledUsd = state.effectiveBilledUsd; let zeroBillReason = state.zeroBillReason; let waivedMarkupNotice = state.waivedMarkupNotice;
     ${settleBlock}
     state.effectiveBilledUsd = effectiveBilledUsd;`,
  )(
    settleStopOrFailure, stopBillingSwitches, preseededUnchangedCount, freeCancellationMessage, (ok: boolean) => ok === false, abortCauseOf,
    signal(c.cause), files(c.written ?? 9), files(c.preseeded ?? 0), c.rendered === true, c.edit === true, COST, 0,
    { ok: c.ok }, { record: () => {} }, { emit: () => {} }, state,
    abortRequestedAtOf, stopFellInWindow, renderedAt(c), styleWindow(c),
  );
  return state.effectiveBilledUsd;
}

describe('1 — the deadline finalizer bills a user Stop by the Stop rules (real block, executed)', () => {
  afterEach(() => { delete process.env.AGENTV3_BILL_LATE_STOP_RULES; delete process.env.AGENTV3_BILL_CANCELLED; });

  for (const c of CASES) {
    it(`${c.name}: finalizer bills ${c.billed} — the same as the normal settle`, () => {
      const wd = finalizer({ ...c, cause: 'user-stop' });
      expect(wd.billed).toBe(c.billed);
      expect(settle({ ...c, cause: 'user-stop', ok: true })).toBe(c.billed);  // late Stop at the settle
      expect(settle({ ...c, cause: 'user-stop', ok: false })).toBe(c.billed); // ordinary Stop at the settle
      if (c.billed === 0) {
        expect(wd.recorded).toContain('LATE_STOP_NOT_CHARGED');
        expect(wd.note).toBe(freeCancellationMessage(decideCancelledBuildBill({
          abortCause: 'user-stop', filesWritten: c.written, preseededUnchanged: c.preseeded ?? 0,
          appRendered: c.rendered === true, editingExistingApp: c.edit === true, decidedBilledUsd: DECIDED,
          appRenderedAt: renderedAt(c), stopRequestedAt: STOP_AT,
        } as CancelledBuildFacts).delivery));
      } else if (c.billed < DECIDED) {
        expect(wd.recorded).toContain('CANCELLED_BUILD_CHARGED');
      }
    });
  }

  it('a cap that fired with NO user Stop is billed exactly as before (advisory-cap, watchdog, unknown, none)', () => {
    for (const cause of ['advisory-cap', 'watchdog', 'unknown', null] as Array<AbortCause | null>) {
      for (const c of CASES) {
        const wd = finalizer({ ...c, cause });
        expect(wd.billed, `${String(cause)} / ${c.name}`).toBe(DECIDED);
        expect(wd.recorded).toEqual([]);
        expect(wd.note).toBeNull();
      }
    }
  });

  it('kill switch AGENTV3_BILL_LATE_STOP_RULES=off restores the old finalizer: every ok build in full', () => {
    process.env.AGENTV3_BILL_LATE_STOP_RULES = 'off';
    for (const c of CASES) expect(finalizer({ ...c, cause: 'user-stop' }).billed, c.name).toBe(DECIDED);
  });

  it('AGENTV3_BILL_CANCELLED=off: no cancel rule anywhere, so the finalizer bills an ok build in full, like the settle', () => {
    process.env.AGENTV3_BILL_CANCELLED = 'off';
    for (const c of CASES) {
      expect(finalizer({ ...c, cause: 'user-stop' }).billed, c.name).toBe(DECIDED);
      expect(settle({ ...c, cause: 'user-stop', ok: true }), c.name).toBe(DECIDED);
    }
  });

  it('the finalizer only bills ok builds at all: the Stop block sits inside `if (ok && billingCtx.providerLedger)`', () => {
    const gate = ROUTE.indexOf('if (ok && billingCtx.providerLedger) {');
    const block = ROUTE.indexOf(WD_START);
    const debit = ROUTE.indexOf("description: 'NavBharatAI Pro build (time-capped)'");
    expect(gate).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(gate);
    expect(debit).toBeGreaterThan(block);
    // …and before the discount, in the same order as the settle (rules first, discount last).
    expect(ROUTE.indexOf(WD_END, block)).toBeGreaterThan(block);
  });

  it('normal settle billing is unchanged: success with no Stop in full, failure free', () => {
    for (const c of CASES) {
      expect(settle({ ...c, cause: null, ok: true }), c.name).toBe(DECIDED);
      expect(settle({ ...c, cause: null, ok: false }), c.name).toBe(0);
      expect(settle({ ...c, cause: 'watchdog', ok: false }), c.name).toBe(0);
    }
  });
});

describe('1 — one decision, no other billing point', () => {
  it('both billing points call settleStopOrFailure, and nothing in the route calls the rules directly', () => {
    expect(ROUTE_CODE.split('settleStopOrFailure({').length - 1).toBe(2);
    expect(ROUTE_CODE).not.toMatch(/decideCancelledBuildBill\(/);
    expect(ROUTE_CODE).not.toMatch(/lateStopIsFree\(/);
    expect(ROUTE_CODE.split('preseededUnchangedCount(').length - 1).toBe(2);
  });

  it('the route debits an app build at exactly these two points', () => {
    const debits = ROUTE_CODE.match(/debitWalletForBuild\(/g) ?? [];
    expect(debits.length).toBe(2);
    const settleAt = ROUTE.indexOf(S_START);
    const finalizerAt = ROUTE.indexOf(WD_START);
    for (const [label, at] of [['settle', settleAt], ['finalizer', finalizerAt]] as const) expect(at, label).toBeGreaterThan(-1);
  });

  it('no other server file debits a wallet for an app build (APK file, voice, remix and hosting are separate charges)', () => {
    // Census of every debitWalletForBuild caller, with its feature. A new caller must be added here
    // deliberately, which is where the question "does it bill a stopped build?" gets asked.
    const callers: Array<[string, RegExp]> = [
      ['src/server/routes/mobileShip.ts', /feature: 'mobile-build'/],
      ['src/server/sonic/sonicWs.ts', /feature: 'voice'/],
      ['src/server/lib/navStoreRemixPurchase.ts', /debitWalletForBuild\(d, buyerUid/],
    ];
    for (const [f, re] of callers) expect(readFileSync(join(__dirname, '..', f), 'utf8'), f).toMatch(re);
  });

  it('the shared decision keeps the original order: charge, then failed-free, then late-stop-free', () => {
    const sw = { billCancelled: true, lateStopRules: true };
    const f = (o: Partial<CancelledBuildFacts>) => ({ abortCause: 'user-stop', filesWritten: 9, appRendered: false, decidedBilledUsd: 2, ...o } as CancelledBuildFacts);
    expect(settleStopOrFailure({ failed: true, facts: f({}), switches: sw }).kind).toBe('cancel-charge');
    expect(settleStopOrFailure({ failed: true, facts: f({ filesWritten: 0 }), switches: sw }).kind).toBe('failed-free');
    expect(settleStopOrFailure({ failed: false, facts: f({ filesWritten: 0 }), switches: sw }).kind).toBe('late-stop-free');
    expect(settleStopOrFailure({ failed: false, facts: f({ filesWritten: 0 }), switches: { ...sw, lateStopRules: false } }).kind).toBe('unchanged');
    expect(settleStopOrFailure({ failed: false, facts: f({ abortCause: 'watchdog' }), switches: sw }).kind).toBe('unchanged');
    expect(settleStopOrFailure({ failed: true, facts: f({ abortCause: 'watchdog' }), switches: sw }).kind).toBe('failed-free');
    expect(settleStopOrFailure({ failed: true, facts: f({ decidedBilledUsd: 0 }), switches: sw }).kind).toBe('unchanged');
  });
});

describe('2 — every in-app AI quotes the public billing rules, word for word', () => {
  const entry = (id: string) => {
    const e = APP_KNOWLEDGE_BASE.find((x) => x.id === id);
    if (!e) throw new Error(`KB entry ${id} missing`);
    return JSON.stringify(e);
  };
  const ALL = JSON.stringify(APP_KNOWLEDGE_BASE);
  const json = (s: string) => JSON.stringify(s).slice(1, -1);

  it('the plain constants ARE the public rules, minus bold markers', () => {
    expect(FAILED_BUILD_RULE_PLAIN).toBe(FAILED_BUILD_RULE.replace(/\*\*/g, ''));
    expect(STOPPED_BUILD_RULE_PLAIN).toBe(STOPPED_BUILD_RULE.replace(/\*\*/g, ''));
    expect(STOPPED_BUILD_RULE_PLAIN).not.toContain('**');
  });

  it('the Stop rule the AIs read is the public Stop rule and the public failed-build rule', () => {
    const rule = ALL.slice(ALL.indexOf('IF YOU STOP A BUILD YOURSELF'));
    expect(rule.length).toBeGreaterThan(0);
    expect(rule).toContain(json(STOPPED_BUILD_RULE_PLAIN));
    expect(rule).toContain(json(FAILED_BUILD_RULE_PLAIN));
    // The source references the constants instead of retyping them, so the two cannot drift.
    const src = readFileSync(join(__dirname, '..', 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');
    expect(src).toContain("import { FAILED_BUILD_RULE_PLAIN, STOPPED_BUILD_RULE_PLAIN } from '../../content/marketing';");
    expect(src).toContain('${STOPPED_BUILD_RULE_PLAIN}');
    expect(src).toContain('${FAILED_BUILD_RULE_PLAIN}');
  });

  it('the wallet history and About entries say the same thing', () => {
    expect(entry('wallet_history')).toContain(json(FAILED_BUILD_RULE_PLAIN));
    expect(entry('wallet_history')).toMatch(/A build you stop yourself is billed by the Stop rule/);
    expect(entry('about_us')).toMatch(/a failed build is free \(a build you stop yourself is billed only for work you keep\)/);
  });

  it('🔒 no stale or contradicting billing claim survives anywhere an AI reads', () => {
    const STALE = [
      /a working app or it is free/i,
      /A build that did not succeed is never charged/,
      /you stop before anything was produced — you pay NOTHING at all, always/,
      /a stopped build cost nothing at all/i,
      /our starter template does not count/,
      /YOU PAY ONLY FOR WHAT WAS DONE/,
    ];
    for (const re of STALE) expect(ALL, String(re)).not.toMatch(re);
    // The APK Builder's own "a failed or stopped build costs nothing" is about the ₹1 APK FILE charge,
    // which mobileShip.ts takes only for a file a successful run produced. It is a different product
    // and stays as it is; pinned so it cannot quietly leak into the app-builder entries.
    expect(entry('apk_builder')).toMatch(/a failed or stopped build costs nothing/);
    for (const e of APP_KNOWLEDGE_BASE.filter((x) => x.id !== 'apk_builder')) {
      expect(JSON.stringify(e), e.id).not.toMatch(/stopped build (costs|charges) nothing/i);
    }
  });
});
