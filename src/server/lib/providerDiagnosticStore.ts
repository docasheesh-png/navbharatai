import { readDiagnosticEvidence, diagnosticBillingLimits, diagnosticEvidenceBinding, DiagnosticEvidenceMissing } from './providerDiagnosticEvidence';
import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { DIAGNOSTIC_LIMITS, type DiagnosticProvider } from '../../shared/providerDiagnostics';
import { civilDayWindow, checkedAdd, nonnegativeInteger } from '../AI/FreeChain/quota';
import { PAID_BUDGET_TIME_ZONE, maximumCostNanoUsd } from '../AI/FreeChain/spendCap';
import { readData, readPaidPolicy, readSpendDay, writeSpendDay } from '../AI/FreeChain/paidLedger';

const ROOT = 'free_chat_chain/provider_diagnostics';
export const DIAGNOSTIC_REVIEW_PATH = `${ROOT}/policy/review`;
const TOTAL = `${ROOT}/ledger/total`;
export interface DiagnosticPairAuthority {
  /** Automatic pricing for manual tests under shared platform budgets; preserves legacy ledgers. */
  review(provider: DiagnosticProvider, model: string, outputTokens?: number): Promise<DiagnosticBudgetReview>;
}
const PAIR_ROOT = 'free_chat_chain/provider_diagnostic_pair_20261028';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const modelId = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
type Db = Pick<Firestore, 'doc' | 'runTransaction'>;
/** Server-reviewed evidence only. No HTTP issuer or default budget is supplied by this module. */
export interface DiagnosticBudgetReview {
  version: 1;
  /** Written atomically with the first ledger; losing that ledger must never reset spend. */
  diagnosticsInitialized?: true;
  expiresAt: number;
  /** All earlier API AND sandbox charges plus conservative unresolved liabilities. Never customer charges. */
  priorCommittedPaise: number;
  priorEvidenceRef: string;
  totalBudgetPaise: number;
  allInPaisePerUsdCeiling: number;
  monthlyCapNanoUsd: number;
  providers: Record<DiagnosticProvider, {
    model: string; contextTokens: number; inputPerMillionNanoUsd: number; outputPerMillionNanoUsd: number;
    rateEvidenceRef: string;
  }>;
}
export interface DiagnosticRunRecord {
  dispatchBefore?: number;
  version: 1; runId: string; provider: DiagnosticProvider; model: string; startedAt: number;
  day: string; month: string; reservedNanoUsd: number; reservedPaise: number; conversionCeiling: number;
  state: 'reserved' | 'unknown_liability' | 'settled';
  actualCostNanoUsd: number | null;
}
interface Total { version: 1; priorCommittedPaise: number; diagnosticCommittedPaise: number; activeRunId: string | null }
export class DiagnosticAdmissionError extends Error {
  constructor(readonly reason: 'invalid_request' | 'budget_evidence_unavailable' | 'budget_exhausted' | 'run_in_progress' | 'accounting_failed') {
    super(reason);
  }
}
function demand(value: unknown, reason: ConstructorParameters<typeof DiagnosticAdmissionError>[0]): asserts value {
  if (!value) throw new DiagnosticAdmissionError(reason);
}
function paise(nano: number, conversion: number): number {
  const result = (BigInt(nano) * BigInt(conversion) + 999_999_999n) / 1_000_000_000n;
  demand(result <= BigInt(Number.MAX_SAFE_INTEGER), 'accounting_failed');
  return Number(result);
}
function checkedTotal(raw: unknown): Total {
  const t = raw as Total;
  demand(t && t.version === 1 && nonnegativeInteger(t.priorCommittedPaise) && nonnegativeInteger(t.diagnosticCommittedPaise)
    && (t.activeRunId === null || typeof t.activeRunId === 'string' && UUID.test(t.activeRunId)), 'accounting_failed');
  return t;
}
function checkedRun(raw: unknown): DiagnosticRunRecord {
  const r = raw as DiagnosticRunRecord;
  demand(r && r.version === 1 && typeof r.runId === 'string' && UUID.test(r.runId)
    && (r.provider === 'surplus' || r.provider === 'cheaperinference') && typeof r.model === 'string' && modelId.test(r.model)
    && nonnegativeInteger(r.startedAt) && /^\d{4}-\d{2}-\d{2}$/.test(r.day) && /^\d{4}-\d{2}$/.test(r.month)
    && nonnegativeInteger(r.reservedNanoUsd) && r.reservedNanoUsd > 0 && nonnegativeInteger(r.reservedPaise)
    && nonnegativeInteger(r.conversionCeiling) && r.conversionCeiling > 0
    && ['reserved', 'unknown_liability', 'settled'].includes(r.state)
    && (r.actualCostNanoUsd === null || nonnegativeInteger(r.actualCostNanoUsd)), 'accounting_failed');
  // Explicit projection: extra stored fields never become response/log fields.
  return { ...(nonnegativeInteger(r.dispatchBefore) ? { dispatchBefore: r.dispatchBefore } : {}), version: 1, runId: r.runId, provider: r.provider, model: r.model, startedAt: r.startedAt,
    day: r.day, month: r.month, reservedNanoUsd: r.reservedNanoUsd, reservedPaise: r.reservedPaise,
    conversionCeiling: r.conversionCeiling, state: r.state, actualCostNanoUsd: r.actualCostNanoUsd };
}
/** One transaction reserves shared daily/monthly authority AND the aggregate benchmark allowance.
 * No TTL releases a hold. No prompt, output, credential, raw error or key hash enters this store.
 * Server composition only: every HTTP caller must first pass requireDiagnosticAdmin.
 */
export class ProviderDiagnosticStore {
  constructor(private readonly db: Db, private readonly now = Date.now, private readonly limits = diagnosticBillingLimits, private readonly binding = diagnosticEvidenceBinding, private readonly pair?: DiagnosticPairAuthority) {}
  private get root() { return this.pair ? PAIR_ROOT : ROOT; }
  private get totalPath() { return this.pair ? `${PAIR_ROOT}/ledger/total` : TOTAL; }
  private get reviewPath() { return this.pair ? `${PAIR_ROOT}/policy/review` : DIAGNOSTIC_REVIEW_PATH; }
  async status(provider: DiagnosticProvider, model: string, outputTokens: number = DIAGNOSTIC_LIMITS.defaultOutputTokens) {
    try {
      await this.admit(randomUUID(), provider, model, true, outputTokens);
      return { dispatchReady: true, reason: null, missingFields: [] as string[] };
    } catch (error) {
      return { dispatchReady: false, reason: error instanceof DiagnosticAdmissionError ? error.reason : error instanceof DiagnosticEvidenceMissing ? 'budget_evidence_unavailable' : 'accounting_unavailable', missingFields: error instanceof DiagnosticEvidenceMissing ? error.fields : [] };
    }
  }
  private runRef(key: string) {
    demand(UUID.test(key), 'invalid_request');
    return this.db.doc(`${this.root}/runs/${key.toLowerCase()}`);
  }
  async read(key: string): Promise<DiagnosticRunRecord | null> {
    const snap = await this.runRef(key).get();
    if (snap.exists) return checkedRun(snap.data());
    if (this.pair) {
      const legacy = await this.db.doc(`${ROOT}/runs/${key.toLowerCase()}`).get();
      if (legacy.exists) return checkedRun(legacy.data());
    }
    return null;
  }
  async reserve(key: string, provider: DiagnosticProvider, model: string, outputTokens: number = DIAGNOSTIC_LIMITS.defaultOutputTokens): Promise<{ mayDispatch: boolean; run: DiagnosticRunRecord }> {
    return this.admit(key, provider, model, false, outputTokens);
  }
  private async admit(key: string, provider: DiagnosticProvider, model: string, dryRun: boolean, outputTokens: number): Promise<{ mayDispatch: boolean; run: DiagnosticRunRecord }> {
    demand(Number.isSafeInteger(outputTokens) && outputTokens > 0, 'invalid_request');
    demand((provider === 'surplus' || provider === 'cheaperinference') && modelId.test(model), 'invalid_request');
    const runRef = this.runRef(key), runId = randomUUID();
    if (this.pair) {
      const existing = await runRef.get();
      if (existing.exists) {
        const run = checkedRun(existing.data());
        demand(run.provider === provider && run.model === model, 'invalid_request');
        return { mayDispatch: false, run };
      }
    }
    // Network preflight occurs outside the retryable transaction. Admission rechecks expiry.
    const prepared = this.pair ? await this.pair.review(provider, model, outputTokens) : null;
    return this.db.runTransaction(async tx => {
      const now = this.now();
      const window = civilDayWindow(now, PAID_BUDGET_TIME_ZONE), month = window.key.slice(0, 7);
      const prior = await tx.get(runRef);
      if (prior.exists) {
        const run = checkedRun(prior.data());
        demand(run.provider === provider && run.model === model, 'invalid_request');
        return { mayDispatch: false, run };
      }
      const storedReview = (await tx.get(this.db.doc(this.reviewPath))).data();
      const review = prepared ? { ...prepared, diagnosticsInitialized: storedReview?.diagnosticsInitialized }
        : await readDiagnosticEvidence(storedReview, provider, model, now, async path => (await tx.get(this.db.doc(path))).data(), this.binding(provider));
      if (prepared) {
        const legacy = await tx.get(this.db.doc(`${ROOT}/runs/${key.toLowerCase()}`));
        if (legacy.exists) {
          const run = checkedRun(legacy.data());
          demand(run.provider === provider && run.model === model, 'invalid_request');
          return { mayDispatch: false, run };
        }
        demand(prepared.expiresAt > now, 'budget_evidence_unavailable');
        // Historical one-call slots are retained, but no longer govern new admissions.
        // Preserve the earlier diagnostic stop as well as its monetary holds.
        const oldTotal = (await tx.get(this.db.doc(TOTAL))).data();
        demand(!oldTotal || oldTotal.activeRunId === null, 'run_in_progress');
      }
      const limits = this.limits();
      const policy = readPaidPolicy(readData(await tx.get(this.db.doc('free_chat_chain/paid_budget_policy'))));
      if (!policy) throw new DiagnosticEvidenceMissing(['billing.paidBudgetPolicy']);
      const day = readSpendDay(readData(await tx.get(this.db.doc(`free_chat_chain/paid_day_${window.key}`))), window);
      const monthRef = this.db.doc(`free_chat_chain/state/paid_month/${month}`);
      const monthSnap = await tx.get(monthRef);
      const monthly = monthSnap.exists ? monthSnap.data()! : { heldNanoUsd: 0, spentNanoUsd: 0 };
      demand(nonnegativeInteger(monthly.heldNanoUsd) && nonnegativeInteger(monthly.spentNanoUsd), 'accounting_failed');
      const totalRef = this.db.doc(this.totalPath), totalSnap = await tx.get(totalRef);
      demand(totalSnap.exists === (review.diagnosticsInitialized === true), 'accounting_failed');
      const total = totalSnap.exists ? checkedTotal(totalSnap.data()) : { version: 1 as const, priorCommittedPaise: review.priorCommittedPaise, diagnosticCommittedPaise: 0, activeRunId: null };
      demand(total.activeRunId === null, 'run_in_progress');
      const rate = review.providers[provider];
      // Full reviewed context, not an assumed chars/token ratio. Includes hidden output within the cap.
      const amount = maximumCostNanoUsd(rate.contextTokens, outputTokens, rate.inputPerMillionNanoUsd, rate.outputPerMillionNanoUsd);
      const reservedPaise = paise(amount, review.allInPaisePerUsdCeiling);
      const priorCommittedPaise = Math.max(total.priorCommittedPaise, review.priorCommittedPaise);
      demand(amount > 0 && (this.pair || reservedPaise <= 100
        && checkedAdd(checkedAdd(priorCommittedPaise, total.diagnosticCommittedPaise), reservedPaise) <= review.totalBudgetPaise)
        && checkedAdd(checkedAdd(day.heldNanoUsd, day.spentNanoUsd), amount) <= Math.min(policy.capNanoUsd, limits.daily)
        && checkedAdd(checkedAdd(monthly.heldNanoUsd, monthly.spentNanoUsd), amount) <= Math.min(review.monthlyCapNanoUsd, limits.monthly), 'budget_exhausted');
      const run: DiagnosticRunRecord = { dispatchBefore: review.expiresAt, version: 1, runId, provider, model, startedAt: now, day: window.key, month,
        reservedNanoUsd: amount, reservedPaise, conversionCeiling: review.allInPaisePerUsdCeiling, state: 'reserved', actualCostNanoUsd: null };
      if (dryRun) return { mayDispatch: false, run };
      writeSpendDay(tx, this.db, { ...day, heldNanoUsd: checkedAdd(day.heldNanoUsd, amount), requests: checkedAdd(day.requests, 1), pending: checkedAdd(day.pending, 1) }, policy.capNanoUsd, now, () => []);
      tx.set(monthRef, { ...monthly, heldNanoUsd: checkedAdd(monthly.heldNanoUsd, amount), updatedAt: now });
      tx.set(totalRef, { ...total, priorCommittedPaise, diagnosticCommittedPaise: checkedAdd(total.diagnosticCommittedPaise, reservedPaise), activeRunId: runId });
      if (!totalSnap.exists) tx.set(this.db.doc(this.reviewPath), { ...review, diagnosticsInitialized: true });
      tx.create(runRef, run);
      return { mayDispatch: true, run };
    });
  }
  /** Only an evidenced supplier receipt may provide actual cost. Null retains every hold and lock. */
  async finish(key: string, runId: string, actualNanoUsd: number | null): Promise<DiagnosticRunRecord> {
    demand(actualNanoUsd === null || nonnegativeInteger(actualNanoUsd), 'accounting_failed');
    const ref = this.runRef(key), now = this.now();
    return this.db.runTransaction(async tx => {
      const run = checkedRun((await tx.get(ref)).data());
      demand(run.runId === runId, 'accounting_failed');
      if (run.state !== 'reserved') {
        demand(run.actualCostNanoUsd === actualNanoUsd, 'accounting_failed');
        return run;
      }
      if (actualNanoUsd === null) {
        const held = { ...run, state: 'unknown_liability' as const };
        tx.set(ref, held); return held;
      }
      const totalRef = this.db.doc(this.totalPath), total = checkedTotal((await tx.get(totalRef)).data());
      const window = civilDayWindow(run.startedAt, PAID_BUDGET_TIME_ZONE);
      const daySnap = await tx.get(this.db.doc(`free_chat_chain/paid_day_${run.day}`));
      const policy = readPaidPolicy(readData(await tx.get(this.db.doc('free_chat_chain/paid_budget_policy'))));
      const monthRef = this.db.doc(`free_chat_chain/state/paid_month/${run.month}`), monthly = (await tx.get(monthRef)).data();
      demand(daySnap.exists && policy && monthly && nonnegativeInteger(monthly.heldNanoUsd) && nonnegativeInteger(monthly.spentNanoUsd), 'accounting_failed');
      const day = readSpendDay(readData(daySnap), window);
      demand(total.activeRunId === runId && total.diagnosticCommittedPaise >= run.reservedPaise
        && day.pending > 0 && day.heldNanoUsd >= run.reservedNanoUsd && monthly.heldNanoUsd >= run.reservedNanoUsd, 'accounting_failed');
      const actualPaise = paise(actualNanoUsd, run.conversionCeiling);
      writeSpendDay(tx, this.db, { ...day, heldNanoUsd: day.heldNanoUsd - run.reservedNanoUsd,
        spentNanoUsd: checkedAdd(day.spentNanoUsd, actualNanoUsd), pending: day.pending - 1 }, policy.capNanoUsd, now, () => []);
      tx.set(monthRef, { ...monthly, heldNanoUsd: monthly.heldNanoUsd - run.reservedNanoUsd, spentNanoUsd: checkedAdd(monthly.spentNanoUsd, actualNanoUsd), updatedAt: now });
      tx.set(totalRef, { ...total, diagnosticCommittedPaise: checkedAdd(total.diagnosticCommittedPaise - run.reservedPaise, actualPaise),
        // An overrun invalidates the reviewed bound; retain the stop until explicit reconciliation.
        activeRunId: actualNanoUsd > run.reservedNanoUsd ? runId : null });
      const settled = { ...run, state: 'settled' as const, actualCostNanoUsd: actualNanoUsd };
      tx.set(ref, settled); return settled;
    });
  }
}
