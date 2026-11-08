import { createHash } from 'node:crypto';
import { COMPARISON_CASES, COMPARISON_MAX_USD, DEEPINFRA_COMPARISON_MODELS, isComparisonReport, summarizeComparison,
  type ComparisonRate, type ComparisonReport, type ComparisonStatus } from '../../lib/deepinfraComparison';
import { getServerDb } from './serverDb';
import { freeChainConfig } from '../AI/FreeChain/config';
import { FreeChainStore } from '../AI/FreeChain/store';
import { maximumCostNanoUsd, usdToNanoUsd, type PaidReservation } from '../AI/FreeChain/spendCap';
import { reserveMonthly, settleMonthly } from '../AI/FreeChain/masterPlan';
import { assertAiAvailable } from './aiMaintenance';
import { assertLegacyInferenceAllowed } from '../AI/inferencePolicy';
import { COMPARISON_OUTPUT_TOKENS, createComparisonClient, executeComparisonCase } from './deepinfraComparisonClient';

const CATALOG = 'https://api.deepinfra.com/models/list';
const STATE_PATH = 'free_chat_chain/deepinfra_comparison';
const RUN_LEASE_MS = 10 * 60_000;
export class ComparisonUnavailable extends Error {
  constructor(readonly reason: string, readonly status = 503) { super(reason); }
}
function credential(): string {
  const key = process.env.FREE_CHAIN_DEEPINFRA_API_KEY?.trim() || process.env.DEEPINFRA_TOKEN?.trim() || process.env.DEEPINFRA_API_KEY?.trim() || '';
  return key && key.length <= 4096 && !/[\s,]/.test(key) ? key : '';
}
/** Public catalog requests carry no credentials; no inference is performed here. */
export async function readComparisonRates(fetcher: typeof fetch = fetch): Promise<{ rates: ComparisonRate[]; observedAt: number }> {
  const response = await fetcher(CATALOG, { redirect: 'error', signal: AbortSignal.timeout(5_000), headers: { Accept: 'application/json' } });
  if (!response.ok || !response.body) throw new ComparisonUnavailable('catalog-unavailable');
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length;
      if (length > 4_000_000) throw new ComparisonUnavailable('catalog-too-large'); parts.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); }
  const data: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (!Array.isArray(data)) throw new ComparisonUnavailable('catalog-invalid');
  const rates = DEEPINFRA_COMPARISON_MODELS.map(model => {
    const matches = data.filter(row => row?.model_name === model);
    if (matches.length !== 1) throw new ComparisonUnavailable('model-unavailable');
    const row = matches[0];
    const price = (n: unknown): number => {
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > .01) throw new ComparisonUnavailable('price-unverified');
      // Catalog units are cents/token. Round reservations upward to whole nano-USD / million.
      return Math.ceil(n * 1e13) / 1e9;
    };
    if (row.deprecated || row.replaced_by || row.type !== 'text-generation' || row.pricing?.type !== 'tokens' ||
      !Number.isSafeInteger(row.max_tokens) || row.max_tokens < COMPARISON_OUTPUT_TOKENS || row.max_tokens > 2_097_152 ||
      !['tools', 'json', 'can-disable-reasoning'].every(tag => row.tags?.includes(tag))) throw new ComparisonUnavailable('capabilities-unverified');
    return { model, contextTokens: row.max_tokens as number, inputPerMillion: price(row.pricing.cents_per_input_token), outputPerMillion: price(row.pricing.cents_per_output_token) };
  });
  if (maximumReservation(rates) > COMPARISON_MAX_USD * 1e9) throw new ComparisonUnavailable('run-ceiling-exceeded');
  return { rates, observedAt: Date.now() };
}
function quote(rate: ComparisonRate, input: number, output: number): number {
  return maximumCostNanoUsd(input, output, usdToNanoUsd(rate.inputPerMillion), usdToNanoUsd(rate.outputPerMillion));
}
export function comparisonTariffDigest(rates: ComparisonRate[]): string { return createHash('sha256').update(JSON.stringify(rates)).digest('hex'); }
export function maximumReservation(rates: ComparisonRate[]): number {
  return rates.reduce((sum, r) => sum + quote(r, r.contextTokens, COMPARISON_OUTPUT_TOKENS) * COMPARISON_CASES.length, 0);
}
export async function comparisonStatus(): Promise<ComparisonStatus> {
  let catalog: Awaited<ReturnType<typeof readComparisonRates>> | null = null;
  try { catalog = await readComparisonRates(); } catch { /* Keep configured state distinct from catalog availability. */ }
  const db = getServerDb(); let remaining: number | null = null, uncapped = false, running = false, lastReport: ComparisonReport | null = null;
  if (db) {
    const [budget, stored] = await Promise.all([new FreeChainStore(db).spendSnapshot(), db.doc(STATE_PATH).get()]);
    remaining = budget.available ? budget.remainingNanoUsd : null;
    uncapped = budget.available && budget.budgetMode === 'uncapped';
    const state = stored.data(); running = state?.status === 'running' && state.expiresAt > Date.now();
    lastReport = isComparisonReport(state?.report) ? state.report : null;
  }
  const maximum = catalog ? maximumReservation(catalog.rates) : null;
  return { configured: !!credential(), catalogAvailable: catalog !== null, catalogObservedAt: catalog?.observedAt ?? null,
    rates: catalog?.rates ?? [], maxRunUsd: COMPARISON_MAX_USD, maximumReservationUsd: maximum === null ? null : maximum / 1e9,
    budgetAvailable: maximum !== null && (uncapped || (remaining !== null && remaining >= maximum)),
    remainingBudgetUsd: remaining === null ? null : remaining / 1e9, running, lastReport,
    tariffDigest: catalog ? comparisonTariffDigest(catalog.rates) : null };
}
/** A fixed run, fixed models and fixed synthetic tasks. No client prompt, endpoint, price or key enters dispatch. */
export async function runComparison(runId: string, actor: string, signal: AbortSignal, expectedTariff: string): Promise<ComparisonReport> {
  const db = getServerDb(); if (!db) throw new ComparisonUnavailable('storage-unavailable');
  const stateRef = db.doc(STATE_PATH);
  const previous = await stateRef.get();
  if (previous.data()?.runId === runId && isComparisonReport(previous.data()?.report) && previous.data()!.report.runId === runId) return previous.data()!.report as ComparisonReport;
  const key = credential(); if (!key) throw new ComparisonUnavailable('credential-unavailable');
  signal.throwIfAborted(); await assertAiAvailable(); assertLegacyInferenceAllowed('admin-deepinfra-comparison');
  const catalog = await readComparisonRates();
  if (comparisonTariffDigest(catalog.rates) !== expectedTariff) throw new ComparisonUnavailable('rates-changed-refresh-review', 409);
  const cfg = freeChainConfig();
  if (cfg.errors.some(e => /PAID_DAILY_CAP|MONTHLY_CAP|PAID_PER_USER/.test(e))) throw new ComparisonUnavailable('budget-configuration-invalid');
  const budget = new FreeChainStore(db), snapshot = await budget.spendSnapshot();
  if (!snapshot.available || (snapshot.budgetMode !== 'uncapped' && (snapshot.remainingNanoUsd === null || snapshot.remainingNanoUsd < maximumReservation(catalog.rates)))) throw new ComparisonUnavailable('shared-budget-unavailable');
  const startedAt = Date.now(), ownerHash = createHash('sha256').update(actor).digest('hex');
  const lease = await db.runTransaction(async tx => {
    const state = (await tx.get(stateRef)).data();
    if (state?.runId === runId && isComparisonReport(state.report) && state.report.runId === runId) return state.report;
    if (state?.status === 'running' && state.expiresAt > Date.now()) throw new ComparisonUnavailable('comparison-already-running', 409);
    tx.set(stateRef, { runId, status: 'running', expiresAt: startedAt + RUN_LEASE_MS, report: isComparisonReport(state?.report) ? state.report : null });
    return null;
  });
  if (lease) return lease;
  const report: ComparisonReport = { version: 1, runId, startedAt, endedAt: startedAt, catalogObservedAt: catalog.observedAt,
    rates: catalog.rates, results: [], summaries: [], completed: false, stopReason: null };
  const client = createComparisonClient(key);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
  let reservedTotal = 0;
  // Alternate which model goes first per task; do not give all of one model the first time window.
  outer: for (const [index, task] of COMPARISON_CASES.entries()) {
    const rates = index % 2 ? [...catalog.rates].reverse() : catalog.rates;
    for (const rate of rates) {
      if (bounded.aborted) { report.stopReason = 'cancelled-or-deadline'; break outer; }
      let reservation: PaidReservation | null = null, month: string | null = null, entered = false;
      const amount = quote(rate, rate.contextTokens, COMPARISON_OUTPUT_TOKENS);
      try {
        if (reservedTotal + amount > COMPARISON_MAX_USD * 1e9) { report.stopReason = 'run-ceiling'; break outer; }
        await assertAiAvailable(); assertLegacyInferenceAllowed('admin-deepinfra-comparison');
        reservation = await budget.reservePaid({ requestId: `deepinfra-compare:${runId}:${rate.model}:${task}`, uid: `admin-comparison:${ownerHash}`,
          maxCostNanoUsd: amount, capNanoUsd: cfg.paidCapNanoUsd, perUserLimit: cfg.paidPerUserDaily });
        if (!reservation?.mayDispatch) { report.stopReason = 'budget-or-duplicate-attempt'; break outer; }
        if (cfg.features.monthlyCap) {
          month = await reserveMonthly(db, cfg.features.monthlyCapNanoUsd, amount);
          if (!month) { report.stopReason = 'monthly-budget'; break outer; }
        }
        bounded.throwIfAborted(); entered = true; reservedTotal += amount;
        const observation = await executeComparisonCase(client, rate.model, task, bounded);
        const usagePresent = observation.inputTokens !== null && observation.outputTokens !== null;
        const usageBounded = usagePresent && observation.inputTokens! > 0 && observation.inputTokens! <= rate.contextTokens && observation.outputTokens! <= COMPARISON_OUTPUT_TOKENS;
        const actual = usageBounded ? quote(rate, observation.inputTokens!, observation.outputTokens!) : null;
        const settlementConfirmed = actual !== null ? await budget.settlePaid(reservation, actual) : false;
        if (month) { await settleMonthly(db, month, amount, actual); month = null; }
        report.results.push({ model: rate.model, task, ...observation, costUsd: actual === null ? null : actual / 1e9,
          reservedUsd: amount / 1e9, settlementConfirmed });
        if (usagePresent && !usageBounded) { report.stopReason = 'provider-usage-out-of-bounds'; break outer; }
        if (actual !== null && !settlementConfirmed) { report.stopReason = 'accounting-unconfirmed'; break outer; }
        if (['authentication', 'rate-limit', 'cancelled', 'model-mismatch', 'model-unavailable'].includes(observation.reason)) { report.stopReason = observation.reason; break outer; }
      } catch { report.stopReason = bounded.aborted ? 'cancelled-or-deadline' : 'comparison-unavailable'; break outer; }
      finally {
        if (reservation?.mayDispatch && !entered) await budget.settlePaid(reservation, 0);
        if (month) await settleMonthly(db, month, amount, entered ? null : 0);
      }
    }
  }
  report.endedAt = Date.now(); report.completed = report.results.length === COMPARISON_CASES.length * 2;
  report.summaries = summarizeComparison(report.results);
  // Saving the report is part of success; never claim persistence after an uncertain write.
  await db.runTransaction(async tx => {
    const state = (await tx.get(stateRef)).data();
    if (state?.runId !== runId || state.status !== 'running') throw new ComparisonUnavailable('comparison-lease-lost', 409);
    tx.set(stateRef, { runId, status: 'finished', expiresAt: report.endedAt, report });
  });
  return report;
}
