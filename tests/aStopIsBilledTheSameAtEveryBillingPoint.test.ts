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
import { decideMarkupOnProof, markupWaiverSettledLine } from '../src/server/AgentV3/previewEarnsMarkup';
import { buildBillingLabel } from '../src/server/AgentV3/buildBillingLabel';

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


/**
 * The watchdog's waiver is a SETTLED diagnostic, just like the normal settle's line. The old
 * caller recorded its at-cost decision BEFORE Stop rules could make the final bill zero.
 * Execute the real enrichment block and debit guard, not another implementation of billing.
 * Every I/O port below is synthetic; the route/provider graph is never imported or called.
 */
const ENRICH_START = 'if (ok && billingCtx.providerLedger) {';
const ENRICH_END = '// A VERSION THE USER CAN GO BACK TO';
const DEBIT_START = 'if (ok && buildResultRef) {';
const DEBIT_END = 'const billedInr = Math.round(watchdogBilledUsd * usdInrRate() * 100) / 100;';
function sourceSpan(source: string, start: string, end: string): string {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  if (a < 0 || b <= a || source.indexOf(start, a + start.length) !== -1) throw new Error(`ambiguous or missing source span: ${start}`);
  return source.slice(a, b);
}
const enrichment = sourceSpan(ROUTE, ENRICH_START, ENRICH_END);
const debitGuard = sourceSpan(ROUTE, DEBIT_START, DEBIT_END) + '}';
// buildDiscount.ts also owns a Firestore store. Extract its PURE exported prefix rather than
// importing any database/provider graph. The production functions (including normalization) run.
const discountSource = readFileSync(join(__dirname, '..', 'src/server/lib/buildDiscount.ts'), 'utf8');
const discountPure = sourceSpan(discountSource, 'export const BUILD_DISCOUNT_MAX_PCT =', '/** How long one instance trusts its copy');
const discountModule = { exports: {} as { applyBuildDiscount: typeof import('../src/server/lib/buildDiscount').applyBuildDiscount } };
new Function('module', 'exports', transformSync(discountPure, { loader: 'ts', format: 'cjs' }).code)(discountModule, discountModule.exports);
const applyBuildDiscount = discountModule.exports.applyBuildDiscount;

type WaiverCase = Partial<Case> & {
  cause?: AbortCause | null; ok?: boolean; cost?: number; sandbox?: number; decided?: number;
  pct?: number; expectsArtifacts?: boolean; markupEnabled?: boolean; ledgerRendered?: boolean;
  observer?: boolean; throwOnWaiver?: boolean; user?: boolean; billingActive?: boolean; startedAt?: number | null;
};
type Recorded = { code: string; message: string };
function compileEnrichment(source: string) {
  const body = `return async function (ports) {
    const { decideMarkupOnProof, markupNeedsPreview, markupWaiverSettledLine, stopBillingSwitches,
      settleStopOrFailure, preseededUnchangedCount, freeCancellationMessage, abortCauseOf, abortRequestedAtOf,
      stopFellInWindow, applyBuildDiscount, buildBillingLabel, renderProvenInLedger, billableSandboxDetail,
      decideBuildBilledUsd, buildDiscountStore, recordBuildTelemetryOnce, buildDiagRef, billingCtx,
      buildObs, buildUsage, writtenFiles, abort, stylePassWindow, isEditMode, ok, awaitsShellNow,
      powerLevelReqEffective, userId, email, actuator, workspaceId, barrenPhases, usdInrRate,
      isAgentV3FreeUser, freeTierBuildActive, billingAppliesTo, onlyOpus, noClaudeBuild, absorbedWorkDetail,
      Date, buildResultRef, userCostStore, debitWalletForBuild, getDb, coordination } = ports;
    let watchdogBilledUsd = 0;
    let watchdogLivePreview = { seconds: 0, usd: 0, measuredSeconds: 0 };
    let watchdogDiscount = null;
    let watchdogStopNote = null;
    ${source}
    ${debitGuard}
    return { billed: watchdogBilledUsd, livePreview: watchdogLivePreview, discount: watchdogDiscount, note: watchdogStopNote };
  }`;
  return new Function(transformSync(body, { loader: 'ts' }).code)() as (
    ports: Record<string, unknown>,
  ) => Promise<{ billed: number; livePreview: { seconds: number; usd: number; measuredSeconds: number }; discount: unknown; note: string | null }>;
}
const runEnrichment = compileEnrichment(enrichment);
async function watchdogWithWaiver(c: WaiverCase, run = runEnrichment) {
  const records: Recorded[] = [];
  const order: string[] = [];
  const snapshots: Record<string, unknown>[] = [];
  const telemetry: unknown[] = [];
  const debits: unknown[] = [];
  const costRecords: unknown[] = [];
  const measured: unknown[] = [];
  const pricing: unknown[] = [];
  const providerTokens: unknown[] = [];
  const cacheTokens: unknown[] = [];
  const usage = { inputTokens: 100, outputTokens: 20 };
  const entries = [{ synthetic: true }];
  const calls = { synthetic: 1 };
  const ledger = { entries: () => entries, callsByProvider: () => calls };
  const startedAt = c.startedAt === null ? undefined : c.startedAt ?? STOP_AT - 10_000;
  const decided = { effectiveBilledUsd: c.decided ?? DECIDED, realCostUsd: c.cost ?? COST,
    sandboxUsd: c.sandbox ?? 0, reconciledProviderUsage: usage, absorbedUnbilledUsd: 0 };
  const result = await run({
    decideMarkupOnProof, markupNeedsPreview: () => c.markupEnabled !== false, markupWaiverSettledLine,
    stopBillingSwitches, settleStopOrFailure, preseededUnchangedCount, freeCancellationMessage, abortCauseOf,
    abortRequestedAtOf, stopFellInWindow, applyBuildDiscount, buildBillingLabel,
    renderProvenInLedger: () => c.ledgerRendered === true,
    billableSandboxDetail: (...args: unknown[]) => { measured.push(args); return { seconds: 20, usd: c.sandbox ?? 0, measuredSeconds: 25 }; },
    decideBuildBilledUsd: (...args: unknown[]) => { pricing.push(args); return decided; },
    buildDiscountStore: { readWithin: async () => { order.push('discount-read'); return { pct: c.pct ?? 0 }; } },
    recordBuildTelemetryOnce: (value: unknown) => { order.push('telemetry'); telemetry.push(value); },
    buildDiagRef: c.observer === false ? undefined : {
      evidenceLedger: () => [],
      record: (entry: Recorded) => {
        order.push(entry.code);
        if (c.throwOnWaiver && entry.code === 'MARKUP_WAIVED_NO_PREVIEW') throw new Error('synthetic recorder failure');
        records.push(entry);
      },
      setProviderTokens: (value: unknown) => providerTokens.push(value),
      setCacheReadInputTokens: (value: unknown) => cacheTokens.push(value),
      setBilling: (value: Record<string, unknown>) => { order.push('billing'); snapshots.push(value); },
    },
    billingCtx: { providerLedger: ledger, buildStartedAt: startedAt, preseededGolden: files(c.preseeded ?? 0),
      expectsArtifacts: c.expectsArtifacts !== false, appFirstRenderedAt: renderedAt(c), cacheReadInputTokens: 12 },
    buildObs: { previewRendered: c.rendered === true }, buildUsage: { total: () => usage },
    writtenFiles: files(c.written ?? 9), abort: signal(c.cause === undefined ? 'user-stop' : c.cause),
    stylePassWindow: styleWindow(c), isEditMode: c.edit === true, ok: c.ok !== false,
    awaitsShellNow: () => null, powerLevelReqEffective: 'normal', userId: c.user === false ? undefined : 'synthetic-user',
    email: 'synthetic@example.invalid', actuator: 'synthetic-actuator', workspaceId: 'synthetic-workspace',
    barrenPhases: [], usdInrRate: () => 100, isAgentV3FreeUser: () => false, freeTierBuildActive: false,
    billingAppliesTo: () => c.billingActive !== false, onlyOpus: false, noClaudeBuild: false,
    absorbedWorkDetail: () => 'synthetic', Date: { now: () => STOP_AT }, buildResultRef: { ok: c.ok !== false },
    userCostStore: { record: async (...args: unknown[]) => { costRecords.push(args); } },
    debitWalletForBuild: async (...args: unknown[]) => { order.push('debit'); debits.push(args); return { ok: true, tokensDebited: 1, tokenBalance: 2 }; },
    getDb: () => 'synthetic-db', coordination: { billingRef: (value: string) => value },
  });
  return { ...result, records, order, snapshots, telemetry, debits, costRecords, measured, pricing, providerTokens, cacheTokens };
}
function expectSettledZero(result: Awaited<ReturnType<typeof watchdogWithWaiver>>) {
  expect(result.billed).toBe(0);
  expect(result.snapshots[0].billedUsd).toBe(0);
  const waiver = result.records.filter((entry) => entry.code === 'MARKUP_WAIVED_NO_PREVIEW');
  expect(waiver).toHaveLength(1);
  expect(waiver[0].message).toContain('Superseded: the final bill is ₹0.');
  expect(result.order.indexOf('MARKUP_WAIVED_NO_PREVIEW')).toBeGreaterThan(result.order.indexOf('billing'));
  expect(result.debits).toEqual([]);
}

describe('3 — the watchdog waiver describes the final settled bill, not an intermediate amount', () => {
  afterEach(() => { delete process.env.AGENTV3_BILL_LATE_STOP_RULES; delete process.env.AGENTV3_BILL_CANCELLED; });

  it.each([
    { name: 'no files', written: 0 },
    { name: 'only the unchanged starter', written: 12, preseeded: 12 },
    { name: 'unverified edit', written: 4, edit: true },
  ])('$name: a positive at-cost waiver is superseded by the actual zero bill', async (c) => {
    const result = await watchdogWithWaiver(c);
    expectSettledZero(result);
    expect(result.records.find((entry) => entry.code === 'MARKUP_WAIVED_NO_PREVIEW')?.message).toContain('$0.4000 instead of $2.0000');
    expect(result.order).toContain('LATE_STOP_NOT_CHARGED');
    expect(result.order).not.toContain('discount-read');
  });

  it('saved files retain their positive real-cost floor and the original waiver wording', async () => {
    const result = await watchdogWithWaiver({ written: 9, pct: 50, sandbox: 0.1 });
    expect(result.billed).toBe(0.5);
    expect(result.discount).toBeNull();
    expect(result.records.find((entry) => entry.code === 'MARKUP_WAIVED_NO_PREVIEW')?.message)
      .toBe(decideMarkupOnProof({ decidedBilledUsd: 2, realCostUsd: 0.4, sandboxUsd: 0.1, previewProven: false, expectsArtifacts: true }).reason);
    expect(result.order.indexOf('MARKUP_WAIVED_NO_PREVIEW')).toBeGreaterThan(result.order.indexOf('billing'));
    expect(result.debits).toEqual([['synthetic-db', 'synthetic-user', {
      billedInr: 50, buildRef: `synthetic-workspace_${STOP_AT - 10_000}`, feature: 'build', description: 'NavBharatAI Pro build (time-capped)',
    }]]);
  });

  it.each(['watchdog', 'advisory-cap', 'unknown', null] as const)('%s is not rewritten as user Stop', async (cause) => {
    const result = await watchdogWithWaiver({ cause, written: 0 });
    expect(result.billed).toBe(COST);
    expect(result.records.map((entry) => entry.code)).toEqual(['MARKUP_WAIVED_NO_PREVIEW']);
    expect(result.records[0].message).not.toContain('Superseded');
  });

  it.each(['AGENTV3_BILL_LATE_STOP_RULES', 'AGENTV3_BILL_CANCELLED'])('%s=off preserves its existing positive bill', async (key) => {
    process.env[key] = 'off';
    const result = await watchdogWithWaiver({ written: 0 });
    expect(result.billed).toBe(COST);
    expect(result.records[0].message).not.toContain('Superseded');
  });

  it.each([
    { name: 'real render flag', rendered: true },
    { name: 'real ledger render', ledgerRendered: true, rendered: false },
    { name: 'markup rule disabled', markupEnabled: false },
    { name: 'non-artifact turn', expectsArtifacts: false },
  ])('$name: no invented waiver and the normal discount still applies', async (c) => {
    const result = await watchdogWithWaiver({ ...c, cause: null, pct: 25 });
    expect(result.billed).toBe(1.5);
    expect(result.records.some((entry) => entry.code === 'MARKUP_WAIVED_NO_PREVIEW')).toBe(false);
    expect(result.debits).toHaveLength(1);
  });

  it('zero real cost remains zero without inventing a Stop reason', async () => {
    const result = await watchdogWithWaiver({ cause: null, cost: 0 });
    expectSettledZero(result);
    expect(result.records[0].message).toContain('$0.0000 instead of $2.0000');
    expect(result.records[0].message).not.toMatch(/stopped|cancelled/);
  });

  it('the diagnostic does not re-measure or change the existing pricing, telemetry, or billing snapshot', async () => {
    const result = await watchdogWithWaiver({ cause: null, sandbox: 0.1 });
    expect(result.measured).toEqual([['synthetic-actuator', 'synthetic-workspace', STOP_AT - 10_000]]);
    expect(result.pricing).toHaveLength(1);
    expect(result.pricing[0]).toEqual([expect.any(Object), { inputTokens: 100, outputTokens: 20 }, 'normal',
      'synthetic-user', 'synthetic@example.invalid', 0.1, []]);
    expect(result.telemetry).toEqual([{ ok: true, previewAllowed: false, isEdit: false, ms: 10_000,
      providerUsage: { inputTokens: 100, outputTokens: 20 }, providerEntries: [{ synthetic: true }],
      providerCalls: { synthetic: 1 }, sandboxSeconds: 25 }]);
    expect(result.providerTokens).toEqual([{ inputTokens: 100, outputTokens: 20 }]);
    expect(result.cacheTokens).toEqual([12]);
    expect(result.snapshots).toEqual([{
      userTier: 'paid', charged: true, billedButNotDebited: false, billedUsd: 0.5, billedInr: 50,
      realCostUsd: 0.4, sandboxCostUsd: 0.1, powerMode: false, powerLevel: 'normal', noClaude: false,
    }]);
  });

  it.each([0, 9])('an absent diagnostic observer does not affect the bill (files=%s)', async (written) => {
    const result = await watchdogWithWaiver({ written, observer: false });
    expect(result.billed).toBe(written === 0 ? 0 : COST);
    expect(result.records).toEqual([]);
    expect(result.snapshots).toEqual([]);
    expect(result.debits).toHaveLength(written === 0 ? 0 : 1);
  });

  it.each([0, 9])('a waiver recorder exception occurs AFTER settlement and cannot bypass it (files=%s)', async (written) => {
    const result = await watchdogWithWaiver({ written, throwOnWaiver: true });
    expect(result.billed).toBe(written === 0 ? 0 : COST);
    expect(result.snapshots[0].billedUsd).toBe(result.billed);
    expect(result.order.indexOf('MARKUP_WAIVED_NO_PREVIEW')).toBeGreaterThan(result.order.indexOf('billing'));
    expect(result.debits).toHaveLength(written === 0 ? 0 : 1);
  });

  it.each([
    { name: 'failed build', ok: false, expected: 0 },
    { name: 'no user identity', user: false, expected: COST },
    { name: 'billing disabled', billingActive: false, expected: COST },
    { name: 'missing idempotency timestamp', startedAt: null, expected: COST },
  ])('$name: the real debit guard is preserved', async ({ expected, ...c }) => {
    const result = await watchdogWithWaiver({ ...c, cause: null });
    expect(result.billed).toBe(expected);
    expect(result.debits).toEqual([]);
  });

  it('both waiver producers use settled values; a newly raw sibling fails this census', () => {
    expect(ROUTE_CODE.match(/code: 'MARKUP_WAIVED_NO_PREVIEW'/g)).toHaveLength(2);
    expect(ROUTE_CODE.match(/message: markupWaiverSettledLine\(/g)).toHaveLength(2);
    expect(enrichment).toContain('markupWaiverSettledLine(wdMarkup.reason, watchdogBilledUsd)');
    expect(ROUTE).toContain('markupWaiverSettledLine(markupDecision.reason, effectiveBilledUsd, zeroBillReason)');
  });

  it('reverting either the final-value wording or placement fails the same zero-bill regression', async () => {
    const start = enrichment.indexOf('if (!wdMarkup.markupApplied) {');
    const end = enrichment.indexOf('\n          // Same explanation', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const statement = enrichment.slice(start, end);
    const without = enrichment.slice(0, start) + enrichment.slice(end);
    const beforeStop = without.replace('watchdogBilledUsd = wdMarkup.billedUsd;', `watchdogBilledUsd = wdMarkup.billedUsd;\n${statement}`);
    const rawReason = enrichment.replace('markupWaiverSettledLine(wdMarkup.reason, watchdogBilledUsd)', 'wdMarkup.reason');
    const original = beforeStop.replace('markupWaiverSettledLine(wdMarkup.reason, watchdogBilledUsd)', 'wdMarkup.reason');
    for (const mutant of [beforeStop, rawReason, original]) {
      expect(mutant).not.toBe(enrichment);
      const result = await watchdogWithWaiver({ written: 0 }, compileEnrichment(mutant));
      expect(() => expectSettledZero(result)).toThrow();
    }
  });
});
