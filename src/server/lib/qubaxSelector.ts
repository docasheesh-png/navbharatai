import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

/** Server-owned evidence only. Firestore's default-deny rules exclude client writes.
 * This module does not fetch provider prices, manufacture reviews or authorize dispatch.
 * A trusted operator feed must independently verify BOTH sources at least every five
 * minutes. Re-reading this document never renews the source observation timestamps.
 */
export const QUBAX_CATALOG_PATH = 'qubax_catalog/active';
export const QUBAX_EVIDENCE_TTL_MS = 5 * 60_000;
export const QUBAX_QUALITY_POLICY = Object.freeze({
  id: 'qubax-chat-quality-v1', minTextScoreBps: 8_000, minHindiScoreBps: 8_000,
  minSuccessRateBps: 9_900, maxP95LatencyMs: 10_000, minSampleCount: 100,
});

export interface QubaxWorkload {
  inputTokens: number;
  outputTokens: number;
  language?: 'hi' | 'en' | 'other';
  capability?: 'text';
}
interface Evidence {
  observedAtMs: number;
  expiresAtMs: number;
  evidenceRef: string;
}
/** Equality is required for every field. Currency conversion, model aliases,
 * unknown revisions, tokenizers, service tiers and SKUs cannot prove savings. */
export interface QubaxPriceScope {
  model: string;
  revision: string;
  sku: string;
  tokenizer: string;
  contextBand: string;
  serviceTier: string;
  currency: 'USD';
  billingBasis: 'per-million-tokens';
  modality: 'text';
}
export interface QubaxPriceEvidence extends Evidence {
  source: 'qubax' | 'official';
  scope: QubaxPriceScope;
  inputNanoUsdPerMillionTokens: number;
  outputNanoUsdPerMillionTokens: number;
  /** null explicitly means that cache rate is unavailable, not unknown. */
  cacheReadNanoUsdPerMillionTokens: number | null;
  cacheWriteNanoUsdPerMillionTokens: number | null;
  requestFeeNanoUsd: number;
  additionalFeesNanoUsd: number;
  minimumChargeNanoUsd: number;
  allFeesIncluded: true;
  reviewRef: string;
}
export interface QubaxCatalogCandidate {
  modelId: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  qubax: QubaxPriceEvidence;
  official: QubaxPriceEvidence;
  supplierContract: Evidence & {
    reviewRef: string;
    hardCeilingEnforced: true;
    includesInternalRetriesFailoversAndFees: true;
    exactModelAndRevisionEnforced: true;
    perHttpRequestCeilingNanoUsd: number;
  };
  quality: {
    policyId: string;
    benchmarkRef: string;
    reviewRef: string;
    reviewedAtMs: number;
    expiresAtMs: number;
    textScoreBps: number;
    hindiScoreBps: number;
    successRateBps: number;
    p95LatencyMs: number;
    sampleCount: number;
    approved: true;
  };
}
export interface QubaxCatalog extends Evidence {
  kind: 'qubax-reviewed-chat-catalog-v1';
  /** All candidates must be evaluated by this same reviewed suite. */
  benchmarkRef: string;
  independentReviewRef: string;
  candidates: QubaxCatalogCandidate[];
}
export interface QubaxSelection {
  readonly modelId: string;
  readonly modelRevision: string;
  readonly sku: string;
  readonly maximumNanoUsd: number;
  readonly qubaxCostNanoUsd: number;
  readonly officialCostNanoUsd: number;
  readonly discountBps: number;
  readonly evidenceBinding: string;
  readonly expiresAtMs: number;
  readonly reviewRef: string;
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const reference = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 2_048;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const positive = (value: unknown): value is number => integer(value) && value > 0;
const known = (value: unknown): value is string => reference(value) && !/^(unknown|latest|auto|default|unspecified|n\/a|\*)$/i.test(value.trim());
const score = (value: unknown): value is number => integer(value) && value <= 10_000;
const fresh = (value: RecordValue, now: number) => reference(value.evidenceRef)
  && integer(value.observedAtMs) && value.observedAtMs <= now
  && positive(value.expiresAtMs) && value.expiresAtMs > now
  && value.expiresAtMs <= value.observedAtMs + QUBAX_EVIDENCE_TTL_MS;
const scopeKeys = ['model', 'revision', 'sku', 'tokenizer', 'contextBand', 'serviceTier', 'currency', 'billingBasis', 'modality'] as const;
const amounts = ['inputNanoUsdPerMillionTokens', 'outputNanoUsdPerMillionTokens', 'requestFeeNanoUsd', 'additionalFeesNanoUsd', 'minimumChargeNanoUsd'] as const;

function price(value: unknown, source: QubaxPriceEvidence['source'], now: number): value is QubaxPriceEvidence {
  return record(value) && value.source === source && fresh(value, now) && reference(value.reviewRef)
    && value.allFeesIncluded === true && record(value.scope)
    && scopeKeys.every(key => known((value.scope as RecordValue)[key]))
    && value.scope.currency === 'USD' && value.scope.billingBasis === 'per-million-tokens'
    && value.scope.modality === 'text' && amounts.every(key => integer(value[key]))
    && (value.cacheReadNanoUsdPerMillionTokens === null || integer(value.cacheReadNanoUsdPerMillionTokens))
    && (value.cacheWriteNanoUsdPerMillionTokens === null || integer(value.cacheWriteNanoUsdPerMillionTokens));
}

function candidate(value: unknown, catalog: QubaxCatalog, workload: QubaxWorkload, now: number): value is QubaxCatalogCandidate {
  if (!record(value) || !reference(value.modelId) || value.modelId.length > 256
    || !positive(value.maxInputTokens) || !positive(value.maxOutputTokens)
    || value.maxInputTokens < workload.inputTokens || value.maxOutputTokens < workload.outputTokens
    || !price(value.qubax, 'qubax', now) || !price(value.official, 'official', now)
    || !scopeKeys.every(key => (value.qubax as QubaxPriceEvidence).scope[key] === (value.official as QubaxPriceEvidence).scope[key])) return false;
  const contract = value.supplierContract, q = value.quality;
  return record(contract) && fresh(contract, now) && reference(contract.reviewRef)
    && contract.hardCeilingEnforced === true && contract.includesInternalRetriesFailoversAndFees === true
    && contract.exactModelAndRevisionEnforced === true && positive(contract.perHttpRequestCeilingNanoUsd)
    && record(q) && q.approved === true && q.policyId === QUBAX_QUALITY_POLICY.id
    && q.benchmarkRef === catalog.benchmarkRef && reference(q.reviewRef)
    && integer(q.reviewedAtMs) && q.reviewedAtMs <= now && positive(q.expiresAtMs) && q.expiresAtMs > now
    && score(q.textScoreBps) && q.textScoreBps >= QUBAX_QUALITY_POLICY.minTextScoreBps
    && score(q.hindiScoreBps) && q.hindiScoreBps >= QUBAX_QUALITY_POLICY.minHindiScoreBps
    && score(q.successRateBps) && q.successRateBps >= QUBAX_QUALITY_POLICY.minSuccessRateBps
    && positive(q.p95LatencyMs) && q.p95LatencyMs <= QUBAX_QUALITY_POLICY.maxP95LatencyMs
    && positive(q.sampleCount) && q.sampleCount >= QUBAX_QUALITY_POLICY.minSampleCount;
}

const MILLION = 1_000_000n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
function inputRate(p: QubaxPriceEvidence, upper: boolean): bigint {
  // Charge possible cache writes to Qubax; give the official baseline its cheapest
  // possible input cache rate. Unknown cache availability is rejected above.
  return upper ? BigInt(p.inputNanoUsdPerMillionTokens) + BigInt(p.cacheWriteNanoUsdPerMillionTokens ?? 0)
    : BigInt(Math.min(p.inputNanoUsdPerMillionTokens, p.cacheReadNanoUsdPerMillionTokens ?? p.inputNanoUsdPerMillionTokens));
}
function cost(p: QubaxPriceEvidence, workload: QubaxWorkload, upper: boolean): bigint {
  const tokens = BigInt(workload.inputTokens) * inputRate(p, upper)
    + BigInt(workload.outputTokens) * BigInt(p.outputNanoUsdPerMillionTokens);
  // Rounding can only make our upper bound larger or official lower bound smaller.
  const total = (tokens + (upper ? MILLION - 1n : 0n)) / MILLION
    + BigInt(p.requestFeeNanoUsd) + BigInt(p.additionalFeesNanoUsd);
  return total > BigInt(p.minimumChargeNanoUsd) ? total : BigInt(p.minimumChargeNanoUsd);
}
function discountedComponents(q: QubaxPriceEvidence, o: QubaxPriceEvidence): boolean {
  // A full max-output estimate alone can hide poor discounts on short responses.
  return inputRate(q, true) * 10n <= inputRate(o, false)
    && BigInt(q.outputNanoUsdPerMillionTokens) * 10n <= BigInt(o.outputNanoUsdPerMillionTokens)
    && (BigInt(q.requestFeeNanoUsd) + BigInt(q.additionalFeesNanoUsd)) * 10n <= BigInt(o.requestFeeNanoUsd) + BigInt(o.additionalFeesNanoUsd)
    && BigInt(q.minimumChargeNanoUsd) * 10n <= BigInt(o.minimumChargeNanoUsd);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Eligibility is not permission to spend or send data. The transport must still
 * bind exact payload, credential, endpoint and this evidence to a reviewed approval,
 * reserve the existing shared budget and revalidate before each HTTP attempt. */
export function selectQubaxCandidate(catalog: unknown, workload: QubaxWorkload, now = Date.now()): QubaxSelection | null {
  if (!integer(now) || !workload || !positive(workload.inputTokens) || !positive(workload.outputTokens)
    || (workload.capability !== undefined && workload.capability !== 'text')
    || (workload.language !== undefined && !['hi', 'en'].includes(workload.language))
    || !record(catalog) || catalog.kind !== 'qubax-reviewed-chat-catalog-v1' || !fresh(catalog, now)
    || !reference(catalog.independentReviewRef) || !reference(catalog.benchmarkRef)
    || !Array.isArray(catalog.candidates) || catalog.candidates.length > 1_000) return null;
  const reviewed = catalog as unknown as QubaxCatalog;
  // One dispatch alias cannot stand for multiple revisions or conflicting prices.
  const counts = new Map<string, number>();
  for (const entry of reviewed.candidates) if (record(entry) && reference(entry.modelId)) counts.set(entry.modelId, (counts.get(entry.modelId) ?? 0) + 1);
  const eligible: { selection: QubaxSelection; quality: QubaxCatalogCandidate['quality'] }[] = [];
  for (const entry of reviewed.candidates) {
    if (!candidate(entry, reviewed, workload, now) || counts.get(entry.modelId) !== 1 || !discountedComponents(entry.qubax, entry.official)) continue;
    const q = cost(entry.qubax, workload, true), official = cost(entry.official, workload, false);
    const ceiling = BigInt(entry.supplierContract.perHttpRequestCeilingNanoUsd);
    if (q > ceiling || official <= 0n || official > MAX_SAFE || ceiling * 10n > official) continue;
    const expiresAtMs = Math.min(reviewed.expiresAtMs, entry.qubax.expiresAtMs, entry.official.expiresAtMs,
      entry.supplierContract.expiresAtMs, entry.quality.expiresAtMs);
    const evidenceBinding = createHash('sha256').update('qubax-selection-v1\0').update(canonical({
      catalog: { kind: reviewed.kind, observedAtMs: reviewed.observedAtMs, expiresAtMs: reviewed.expiresAtMs,
        evidenceRef: reviewed.evidenceRef, independentReviewRef: reviewed.independentReviewRef, benchmarkRef: reviewed.benchmarkRef },
      entry, workload: { inputTokens: workload.inputTokens, outputTokens: workload.outputTokens,
        language: workload.language ?? 'hi', capability: 'text' },
    })).digest('hex');
    eligible.push({ quality: entry.quality, selection: Object.freeze({ modelId: entry.modelId,
      modelRevision: entry.qubax.scope.revision, sku: entry.qubax.scope.sku,
      maximumNanoUsd: Number(ceiling), qubaxCostNanoUsd: Number(ceiling), officialCostNanoUsd: Number(official),
      discountBps: Number((official - ceiling) * 10_000n / official), expiresAtMs,
      evidenceBinding, reviewRef: reviewed.independentReviewRef }) });
  }
  // Reviewed task-specific Hindi/text quality, then observed reliability/latency,
  // then cost. No static cross-provider model leaderboard or price-first downgrade.
  const qualityScore = (q: QubaxCatalogCandidate['quality']) => workload.language === 'en' ? q.textScoreBps : Math.min(q.textScoreBps, q.hindiScoreBps);
  eligible.sort((a, b) => qualityScore(b.quality) - qualityScore(a.quality)
    || b.quality.successRateBps - a.quality.successRateBps || a.quality.p95LatencyMs - b.quality.p95LatencyMs
    || a.selection.maximumNanoUsd - b.selection.maximumNanoUsd || a.selection.modelId.localeCompare(b.selection.modelId));
  return eligible[0]?.selection ?? null;
}

/** Injectable, read-only lazy refresh. Single-flight reads prevent a thundering herd;
 * failures and stale evidence are fail-closed, never stale-while-revalidate. */
export function createQubaxSelector(readCatalog: () => Promise<unknown>, clock: () => number = Date.now) {
  let cached: { value: unknown; readAtMs: number } | undefined;
  let pending: Promise<unknown> | undefined;
  return async (workload: QubaxWorkload, forceRefresh = false, atMs?: number): Promise<QubaxSelection | null> => {
    const requestedWorkload = { ...workload };
    const currentTime = () => atMs ?? clock();
    const now = currentTime();
    if (!integer(now)) return null;
    if (forceRefresh) {
      // A dispatch revalidation must not reuse a read started before that request.
      if (pending) await pending;
      cached = undefined;
    }
    if (!cached || now < cached.readAtMs || now - cached.readAtMs >= QUBAX_EVIDENCE_TTL_MS) {
      if (!pending) {
        const readAtMs = now;
        pending = Promise.resolve().then(readCatalog).then(value => {
          // Snapshot server evidence so caller-side mutation cannot extend its life.
          const snapshot: unknown = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
          cached = { value: snapshot, readAtMs };
          return snapshot;
        }).catch(() => { cached = undefined; return undefined; }).finally(() => { pending = undefined; });
      }
      await pending;
    }
    return selectQubaxCandidate(cached?.value, requestedWorkload, currentTime());
  };
}

const selectors = new WeakMap<Firestore, ReturnType<typeof createQubaxSelector>>();
export async function getQubaxSelection(db: Firestore, workload: QubaxWorkload, now?: number, forceRefresh = false): Promise<QubaxSelection | null> {
  let selector = selectors.get(db);
  if (!selector) {
    selector = createQubaxSelector(async () => (await db.doc(QUBAX_CATALOG_PATH).get()).data());
    selectors.set(db, selector);
  }
  return selector(workload, forceRefresh, now);
}
