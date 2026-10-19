/**
 * A STOP IS BILLED BY ONE SET OF RULES, WHENEVER IT LANDS — AND THE PUBLIC WORDS SAY EXACTLY THOSE RULES.
 *
 * Pre-deploy review 2026-10-18, round 3 (owner-approved B1 + B2).
 *
 * B1 — the public sentence said "You pay nothing if none of your own app had been written yet (our starter
 *      template does not count)". The engine bills a Stop IN FULL once anything was written and an app was
 *      seen running — even when that app is still only our untouched starter (`working-app` sits above
 *      `seed-only` in `decideCancelledBuildBill`, by design). The words promised ₹0 where the engine charges.
 *      The matrix below pins every outcome of `decideCancelledBuildBill` to the sentence that describes it.
 *
 * B2 — the three ₹0 Stop outcomes became ₹0 only through `zeroBillForFailedBuild(result.ok)`. A Stop that
 *      landed AFTER the runner had already returned `ok: true` (during the final checks) kept the full bill.
 *      The settle block is executed below — the REAL route source, transpiled — across the whole case matrix,
 *      early and late, with the kill switches on and off.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import {
  decideCancelledBuildBill, freeCancellationMessage, lateStopIsFree,
  settleStopOrFailure, stopBillingSwitches, preseededUnchangedCount, stopFellInWindow,
  type CancelledBuildFacts, type CancelledDelivery,
} from '../src/server/AgentV3/cancelledBuildBilling';
import { abortBuild, abortCauseOf, abortRequestedAtOf, type AbortCause } from '../src/server/AgentV3/buildAbortCause';
import { STOPPED_BUILD_RULE, FAILED_BUILD_RULE, AI_APP_BUILDER_PAGE } from '../src/content/marketing';
import { aboutContent } from '../src/content/about';
import { REFUND_POLICY } from '../src/content/legal/refundPolicy';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const plain = (s: string) => s.replace(/\*\*/g, '').replace(/\\`/g, '`');
const ROUTE = read('src/server/routes/agentv3.ts');
const ROUTE_CODE = ROUTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── The case matrix: one row per thing the user can be holding when they stop ────────────────────────────
type Row = {
  name: string;
  facts: Partial<CancelledBuildFacts>;
  delivery: CancelledDelivery;
  /** Expected bill for decided = 2, real cost 0.4 (so the half is not floored). */
  billed: number;
  /** The public sentence that must describe this row. */
  sentence: RegExp;
};
const DECIDED = 2;
// "Had been seen running" in the public rule = seen running BEFORE the Stop was asked for (#3820, rule g).
const SEEN_BEFORE_STOP = { appRenderedAt: 1, stopRequestedAt: 2 };
const ROWS: Row[] = [
  { name: 'zero files written', facts: { filesWritten: 0 }, delivery: 'nothing', billed: 0,
    sentence: /You pay nothing if nothing at all had been written yet/ },
  { name: 'zero files written, something rendered', facts: { filesWritten: 0, appRendered: true }, delivery: 'nothing', billed: 0,
    sentence: /You pay nothing if nothing at all had been written yet/ },
  { name: 'starter-only, not seen running', facts: { filesWritten: 12, preseededUnchanged: 12 }, delivery: 'seed-only', billed: 0,
    sentence: /if only our untouched starter template was in place and no app had yet been seen running/ },
  { name: 'starter-only, SEEN running', facts: { filesWritten: 12, preseededUnchanged: 12, appRendered: true, ...SEEN_BEFORE_STOP }, delivery: 'working-app', billed: DECIDED,
    sentence: /Once files had been written and an app had been seen running in the preview, even if it was still only our starter template, you pay for the work done up to that point/ },
  { name: 'existing-app edit, not seen working', facts: { filesWritten: 4, editingExistingApp: true }, delivery: 'unverified-edit', billed: 0,
    sentence: /if you stopped a change to an existing app before it was seen working/ },
  { name: 'existing-app edit, seen running', facts: { filesWritten: 4, editingExistingApp: true, appRendered: true, ...SEEN_BEFORE_STOP }, delivery: 'working-app', billed: DECIDED,
    sentence: /Once files had been written and an app had been seen running in the preview/ },
  { name: 'new app, own files saved, not seen running', facts: { filesWritten: 9 }, delivery: 'files-saved', billed: DECIDED / 2,
    sentence: /If you were building a new app, files of your own were saved, and no app had yet been seen running, you pay half of the work done so far, or what that work actually cost to run if that is more, and never more than the work done/ },
  { name: 'running app', facts: { filesWritten: 9, appRendered: true, ...SEEN_BEFORE_STOP }, delivery: 'working-app', billed: DECIDED,
    sentence: /you pay for the work done up to that point, not for a full build/ },
];
const facts = (r: Row): CancelledBuildFacts => ({
  abortCause: 'user-stop', filesWritten: 0, appRendered: false, decidedBilledUsd: DECIDED, realCostUsd: 0.4, ...r.facts,
} as CancelledBuildFacts);

describe('B1 — the public Stop rule says exactly what decideCancelledBuildBill does', () => {
  const SURFACES: Array<[string, string]> = [
    ['STOPPED_BUILD_RULE (/pricing, /ai-app-builder)', plain(STOPPED_BUILD_RULE)],
    ['Refund Policy', plain(REFUND_POLICY)],
  ];

  for (const r of ROWS) {
    it(`${r.name}: engine bills ${r.billed} (${r.delivery}), and the words say so`, () => {
      const bill = decideCancelledBuildBill(facts(r));
      expect(bill.applies).toBe(true);
      expect(bill.delivery).toBe(r.delivery);
      expect(bill.billedUsd).toBe(r.billed);
      for (const [where, t] of SURFACES) expect(t, where).toMatch(r.sentence);
    });
  }

  it('the matrix covers every delivery the rule can return', () => {
    const covered = new Set(ROWS.map((r) => r.delivery));
    for (const d of ['working-app', 'files-saved', 'nothing', 'seed-only', 'unverified-edit'] as CancelledDelivery[]) {
      expect(covered.has(d), d).toBe(true);
    }
  });

  it('🔒 the false promise is gone everywhere: a starter seen running is NOT free', () => {
    const FALSE = /nothing if none of your own app had been written yet \(our starter template does not count\)/;
    for (const [where, t] of SURFACES) expect(t, where).not.toMatch(FALSE);
    const about = JSON.stringify(aboutContent(null));
    expect(about).not.toMatch(FALSE);
    // The short versions (About, FAQ) may only state a SUFFICIENT condition for ₹0 — prove it is one.
    expect(about).toMatch(/nothing if none of your own app had been written yet and no app had been seen running/);
    const faq = AI_APP_BUILDER_PAGE.faq.map((f) => f.a).join(' ');
    expect(faq).toMatch(/nothing if none of your own app had been written yet and no app had been seen running/);
    expect(faq).toMatch(/If our starter template was already running in the preview, that counts as an app you keep/);
    for (const filesWritten of [0, 1, 5, 12]) for (const preseededUnchanged of [0, filesWritten]) {
      for (const editingExistingApp of [false, true]) {
        // "none of your own app written" = no file beyond our untouched template; "no app seen running" = !appRendered.
        const bill = decideCancelledBuildBill({ abortCause: 'user-stop', filesWritten, preseededUnchanged, editingExistingApp,
          appRendered: false, decidedBilledUsd: DECIDED });
        if (filesWritten - preseededUnchanged === 0) expect(bill.billedUsd, `${filesWritten}/${preseededUnchanged}/${editingExistingApp}`).toBe(0);
      }
    }
  });

  it('Unsend and a typed "stop" are named as Stops — and the code agrees they are', () => {
    for (const [where, t] of SURFACES) expect(t, where).toMatch(/Unsending your message or typing "stop" counts the same as pressing Stop/);
    expect(JSON.stringify(aboutContent(null))).toMatch(/Stop, unsending your message or typing \\"stop\\"/);
    // Code fact: /unsend stops through the same function as /stop, and the typed stop raises the same cause.
    const unsend = ROUTE.slice(ROUTE.indexOf("app.post('/api/agentv3/unsend'"));
    expect(unsend.slice(0, 4000)).toContain('stopRegisteredBuild(key, rb)');
    expect(ROUTE).toMatch(/function stopRegisteredBuild\([^)]*\): void \{\s*abortBuild\(rb\.abort, 'user-stop'\)/);
    const typed = ROUTE.slice(ROUTE.indexOf('dispatcher.setStopBuild('));
    // #3820 added the request time (rb.lastSteerAt) as a third argument; the cause is still 'user-stop'.
    expect(typed.slice(0, 4000)).toContain("abortBuild({ abort: (r?: unknown) => abort.abort(r) }, 'user-stop', rb.lastSteerAt)");
  });

  it('a failed build is defined against "you stopping it", not just the button', () => {
    expect(plain(FAILED_BUILD_RULE)).toMatch(/for any reason other than you stopping it/);
    expect(plain(REFUND_POLICY)).toMatch(/for any reason other than you stopping it/);
  });

  it('the late-stop guarantee is stated, because B2 makes it true', () => {
    for (const [where, t] of SURFACES) expect(t, where).toMatch(/This holds even if your Stop arrives after the build has finished and only its final checks are still running/);
  });
});

describe('B2 — lateStopIsFree (unit)', () => {
  it('only a user-stop bill that decided ₹0, and only with the rule on', () => {
    for (const r of ROWS) {
      const bill = decideCancelledBuildBill(facts(r));
      expect(lateStopIsFree(bill, true), r.name).toBe(r.billed === 0);
      expect(lateStopIsFree(bill, false), r.name).toBe(false);
    }
  });
  it('never fires for a non-user abort, a missing bill, or the cancel rule switched off', () => {
    for (const cause of ['watchdog', 'advisory-cap', 'unknown', 'deploy-drain', 'cost-cap'] as AbortCause[]) {
      expect(lateStopIsFree(decideCancelledBuildBill({ abortCause: cause, filesWritten: 0, appRendered: false, decidedBilledUsd: 2 }), true)).toBe(false);
    }
    expect(lateStopIsFree(null, true)).toBe(false);
    expect(lateStopIsFree(undefined, true)).toBe(false);
  });
});

// ── Integration-style: run the REAL settle block from agentv3.ts ────────────────────────────────────────────
const START = 'const stopSettlement = settleStopOrFailure({';
const END = 'if (userId && result.ok && effectiveBilledUsd > 0 && freeOnboardingLimit() > 0) {';
const block = (() => {
  const a = ROUTE.indexOf(START);
  const b = ROUTE.indexOf(END, a);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return ROUTE.slice(a, b);
})();
const compiled = transformSync(block, { loader: "ts" }).code;

type Scenario = {
  ok: boolean;
  cause: AbortCause | null;
  written?: number;
  preseeded?: number;
  rendered?: boolean;
  edit?: boolean;
  billed?: number;
};
function settle(s: Scenario) {
  const ctrl = new AbortController();
  if (s.cause) abortBuild(ctrl, s.cause);
  const writtenFiles = new Map<string, string>();
  const preseededGolden = new Map<string, string>();
  for (let i = 0; i < (s.written ?? 0); i++) writtenFiles.set(`f${i}`, `c${i}`);
  for (let i = 0; i < (s.preseeded ?? 0); i++) preseededGolden.set(`f${i}`, `c${i}`);
  const emitted: string[] = [];
  const recorded: string[] = [];
  const state = { effectiveBilledUsd: s.billed ?? DECIDED, zeroBillReason: undefined as string | undefined, waivedMarkupNotice: 'x' as string | null };
  // The block assigns three outer `let`s; they are threaded through a small wrapper so the source runs unchanged.
  const fn = new Function(
    'settleStopOrFailure', 'stopBillingSwitches', 'preseededUnchangedCount', 'freeCancellationMessage', 'zeroBillForFailedBuild', 'abortCauseOf',
    'abort', 'writtenFiles', 'preseededGolden', 'appSeenRunningForBill', 'isEditMode', 'decidedRealCostUsd', 'decidedSandboxUsd',
    'result', 'buildDiag', 'events', 'state', 'abortRequestedAtOf', 'stopFellInWindow', 'appFirstRenderedAt', 'stylePassWindow',
    `let effectiveBilledUsd = state.effectiveBilledUsd; let zeroBillReason = state.zeroBillReason; let waivedMarkupNotice = state.waivedMarkupNotice;
     ${compiled}
     state.effectiveBilledUsd = effectiveBilledUsd; state.zeroBillReason = zeroBillReason; state.waivedMarkupNotice = waivedMarkupNotice;`,
  );
  fn(
    settleStopOrFailure, stopBillingSwitches, preseededUnchangedCount, freeCancellationMessage, (ok: boolean) => ok === false, abortCauseOf,
    ctrl, writtenFiles, preseededGolden, s.rendered === true, s.edit === true, 0.4, 0,
    { ok: s.ok }, { record: (e: { code: string }) => recorded.push(e.code) }, { emit: (e: { text: string }) => emitted.push(e.text) }, state,
    // A rendered row was seen running before the Stop (epoch 1 < the abort's own request time, now); no style pass.
    abortRequestedAtOf, stopFellInWindow, s.rendered === true ? 1 : null, { startedAt: null, endedAt: null },
  );
  return { billed: state.effectiveBilledUsd, reason: state.zeroBillReason, emitted, recorded };
}
const asScenario = (r: Row, ok: boolean): Scenario => ({
  ok, cause: 'user-stop',
  written: r.facts.filesWritten ?? 0, preseeded: r.facts.preseededUnchanged ?? 0,
  rendered: r.facts.appRendered === true, edit: r.facts.editingExistingApp === true,
});

describe('B2 — the real settle block, early Stop vs late Stop', () => {
  afterEach(() => { delete process.env.AGENTV3_BILL_LATE_STOP_RULES; delete process.env.AGENTV3_BILL_CANCELLED; });

  it('the zeroBillForFailedBuild the harness uses is the real rule', () => {
    expect(ROUTE).toMatch(/export function zeroBillForFailedBuild\(resultOk: boolean\): boolean \{\s*return resultOk === false;\s*\}/);
  });

  for (const r of ROWS) {
    it(`late Stop (runner already ok:true) — ${r.name}: billed ${r.billed}, same as an early Stop`, () => {
      const late = settle(asScenario(r, true));
      const early = settle(asScenario(r, false));
      expect(late.billed).toBe(r.billed);
      expect(early.billed).toBe(r.billed);
      if (r.billed === 0) {
        expect(late.recorded).toContain('LATE_STOP_NOT_CHARGED');
        expect(late.emitted).toContain(freeCancellationMessage(r.delivery));
        expect(late.reason).toMatch(/stop arrived after the build had succeeded/);
      } else {
        expect(late.recorded).not.toContain('LATE_STOP_NOT_CHARGED');
      }
    });
  }

  it('kill switch AGENTV3_BILL_LATE_STOP_RULES=off restores the old late-stop bill (full charge on the ₹0 rows)', () => {
    process.env.AGENTV3_BILL_LATE_STOP_RULES = 'off';
    for (const r of ROWS) {
      const late = settle(asScenario(r, true));
      expect(late.billed, r.name).toBe(r.billed === 0 ? DECIDED : r.billed);
      expect(late.recorded).not.toContain('LATE_STOP_NOT_CHARGED');
      // The early Stop is untouched by this switch.
      expect(settle(asScenario(r, false)).billed, r.name).toBe(r.billed);
    }
  });

  it('AGENTV3_BILL_CANCELLED=off still means what it meant: a stop is not billed by the cancel rule at all', () => {
    process.env.AGENTV3_BILL_CANCELLED = 'off';
    for (const r of ROWS) {
      expect(settle(asScenario(r, false)).billed, r.name).toBe(0);      // failed-build rule, as before
      expect(settle(asScenario(r, true)).billed, r.name).toBe(DECIDED); // as before: nothing to route through
    }
  });

  it('normal billing is unchanged: a success with no Stop is billed in full', () => {
    for (const rendered of [false, true]) {
      const s = settle({ ok: true, cause: null, written: 9, rendered });
      expect(s.billed).toBe(DECIDED);
      expect(s.recorded).toEqual([]);
      expect(s.emitted).toEqual([]);
    }
  });

  it('normal billing is unchanged: a failure is free, whatever ended it (no Stop, watchdog, unknown)', () => {
    for (const cause of [null, 'watchdog', 'unknown', 'deploy-drain', 'cost-cap'] as Array<AbortCause | null>) {
      const s = settle({ ok: false, cause, written: 9, rendered: true });
      expect(s.billed, String(cause)).toBe(0);
      expect(s.recorded).not.toContain('LATE_STOP_NOT_CHARGED');
    }
  });

  it('a successful build ended by a deadline (advisory-cap) is NOT touched by the late-stop rule', () => {
    expect(settle({ ok: true, cause: 'advisory-cap', written: 0 }).billed).toBe(DECIDED);
    expect(settle({ ok: true, cause: 'watchdog', written: 12, preseeded: 12 }).billed).toBe(DECIDED);
  });

  it('a zero bill stays zero (the rule only ever reduces)', () => {
    for (const r of ROWS) expect(settle({ ...asScenario(r, true), billed: 0 }).billed).toBe(0);
  });
});

describe('B2 — one decision point, every Stop door reaches it', () => {
  it('the bill is decided once, and the late-stop branch sits in that same chain, before the debit', () => {
    // Round 4: the rules live in ONE function; the route never calls them directly.
    expect(ROUTE_CODE.split('decideCancelledBuildBill(').length - 1).toBe(0);
    expect(ROUTE_CODE.split('lateStopIsFree(').length - 1).toBe(0);
    expect(ROUTE_CODE.split('settleStopOrFailure({').length - 1).toBe(2); // the settle + finalizeOnDeadline
    const failed = ROUTE.indexOf("} else if (stopSettlement.kind === 'failed-free') {");
    const late = ROUTE.indexOf("} else if (stopSettlement.kind === 'late-stop-free') {");
    const onboarding = ROUTE.indexOf(END);
    const debit = ROUTE.indexOf('const debitRes = await debitWalletForBuild(getDb() as any, userId, {', onboarding);
    expect(failed).toBeGreaterThan(-1);
    expect(late).toBeGreaterThan(failed);
    expect(onboarding).toBeGreaterThan(late);
    expect(debit).toBeGreaterThan(onboarding);
    expect(ROUTE).toContain('switches: stopBillingSwitches(process.env),');
    expect(stopBillingSwitches({ AGENTV3_BILL_LATE_STOP_RULES: ' OFF ' }).lateStopRules).toBe(false);
    expect(stopBillingSwitches({}).lateStopRules).toBe(true);
  });

  it('every Stop door raises the same cause the rule reads: button, Unsend, typed "stop", lease stop', () => {
    // #3820: the typed stop now also passes WHEN it was asked for (rb.lastSteerAt) — the cause is unchanged.
    const doors = ROUTE_CODE.match(/abortBuild\([^;]*'user-stop'(?:, rb\.lastSteerAt)?\)/g) ?? [];
    // stopRegisteredBuild (button + Unsend), the lease renewal, and the typed stop.
    expect(doors.length).toBe(3);
    expect(ROUTE).toContain("abortBuild(buildLeaseRb.abort, 'user-stop')");
  });

  it('a disconnect is not a Stop: closing the stream only clears the heartbeat', () => {
    const closes = ROUTE_CODE.match(/res\.on\('close',[^\n]*/g) ?? [];
    expect(closes.length).toBeGreaterThan(0);
    for (const c of closes) expect(c).not.toMatch(/abort/);
  });
});
