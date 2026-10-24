/**
 * Pure, server-only accounting policy. This module does not authorize dispatch, verify
 * a signature, fetch tariffs, or debit a wallet. Its evidence MUST come from trusted
 * backend response validation and independently reviewed immutable tariff snapshots,
 * never from user input, a model answer, or marketplace direct_* reference prices.
 *
 * Counts are disjoint: input excludes both caches; output excludes reasoning. A
 * documented reasoning subset of completion_tokens must be partitioned, not added
 * to the completion total. All dimensions, including known zeros, are explicit.
 *
 * Values remain exact decimal strings. Sum call decisions exactly before the wallet's
 * currency boundary; never round a call up above its ceiling. The durable caller MUST
 * atomically claim accountingIdentity with its ledger write. This pure replay check
 * alone cannot provide concurrent exactly-once settlement.
 */
import { createHash } from 'node:crypto';

export const SURPLUS_BUILD_POLICY_ID = 'surplus-build-10x-official-cap-v1' as const;
export const SURPLUS_USAGE_DIMENSIONS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const;
export type SurplusUsageDimension = typeof SURPLUS_USAGE_DIMENSIONS[number];
export type SurplusTokenCounts = Record<SurplusUsageDimension, string>;
export interface SurplusNormalizedUsage {
  semantics: 'disjoint-token-counts-v1';
  mappingReviewId: string;
  tokens: SurplusTokenCounts;
}
export interface SurplusCallBinding {
  buildId: string;
  callId: string;
  accountId: string;
  modelId: string;
  modelVersion: string;
  endpoint: string;
  offerId: string | null;
  providerId: string;
  startedAt: number;
}
export interface SurplusReceiptEvidence extends SurplusCallBinding {
  kind: 'validated-surplus-response';
  /** A local dispatch ID is labelled honestly, never presented as provider-issued. */
  identitySource: 'provider-response-id' | 'server-dispatch-id';
  receiptId: string | null;
  requestId: string | null;
  currency: 'USD';
  /** Documented canonical billed charge; not an independently reconciled invoice. */
  buyerCostMicro: string | number;
  costSource: 'usage.buyer_cost_micro';
  /** Trusted adapter confirms the entire nonstreaming response was received. */
  responseComplete: true;
  receivedAt: number;
  evidenceSha256: string;
  /** Only documented tokens-only receipts can use this version of the ceiling. */
  additionalCharges: 'none' | 'present' | 'unknown';
  usage: SurplusNormalizedUsage | null;
}
export interface SurplusOfficialTariff {
  kind: 'reviewed-official-provider-tariff';
  snapshotId: string;
  sourceUrl: string;
  artifactSha256: string;
  reviewId: string;
  reviewedAt: number;
  /** Review expiry is our review policy, not a claim that the provider guarantees it. */
  reviewExpiresAt: number;
  effectiveFrom: number;
  effectiveUntil: number | null;
  observedAt: number;
  surplusModelId: string;
  surplusModelVersion: string;
  officialModelId: string;
  officialModelVersion: string;
  modelMappingReviewId: string;
  usageMappingReviewId: string;
  currency: 'USD';
  billingBasis: 'tokens-only';
  /** Explicit rates for disjoint dimensions. An unsupported dimension must be zero. */
  usdPerMillionTokens: Record<SurplusUsageDimension, string | 'not-supported'>;
}
export type SurplusOutputDisposition = 'accepted' | 'failed' | 'malformed' | 'discarded' | 'partially_discarded' | 'unknown';
export interface SurplusPriorSettlement {
  accountingIdentity: string;
  evidenceFingerprint: string;
  policyId: typeof SURPLUS_BUILD_POLICY_ID;
  actualCostUsd: string;
  userChargeUsd: string;
}
export interface SurplusReceiptPolicyInput {
  provider: string;
  product: string;
  binding: SurplusCallBinding;
  disposition: SurplusOutputDisposition;
  receipt: SurplusReceiptEvidence | null;
  tariff: SurplusOfficialTariff | null;
  now: number;
  priorSettlements?: readonly SurplusPriorSettlement[];
}
export interface SurplusReceiptDecision {
  policyId: typeof SURPLUS_BUILD_POLICY_ID;
  status: 'chargeable' | 'absorbed' | 'blocked' | 'duplicate' | 'conflict' | 'not_applicable';
  reason: string;
  buildId: string | null;
  callId: string | null;
  accountingIdentity: string | null;
  evidenceFingerprint: string | null;
  receiptId: string | null;
  accountId: string | null;
  requestId: string | null;
  identitySource: 'provider-response-id' | 'server-dispatch-id' | null;
  modelId: string | null;
  modelVersion: string | null;
  providerId: string | null;
  expenseEvidence: 'provider-reported-actual' | 'unknown';
  tariffSnapshotId: string | null;
  usageMappingReviewId: string | null;
  /** Null means unknown/unverified; it MUST NOT be booked as zero supplier expense. */
  actualCostUsd: string | null;
  userChargeUsd: string;
  officialCeilingUsd: string | null;
  absorbedCostUsd: string | null;
  /** Replays/conflicts contribute no new ledger expense, without erasing actualCostUsd. */
  newSupplierExpenseUsd: string | null;
  priorUserChargeUsd?: string;
}

type Decimal = { coefficient: bigint; scale: number };
type JsonRecord = Record<string, unknown>;
const DOLLAR_LIMIT = 10n ** 18n;
const INTEGER_LIMIT = 10n ** 18n;
const MAX_PRIOR_SETTLEMENTS = 4096;
const isRecord = (value: unknown): value is JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function parseDecimal(value: unknown, maxDecimals = 24): Decimal | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,17})(\.\d{1,30})?$/.test(value)) return null;
  if ((value.split('.')[1]?.length ?? 0) > maxDecimals) return null;
  const [integer, fraction = ''] = value.split('.');
  return { coefficient: BigInt(integer + fraction), scale: fraction.length };
}
function parseTokens(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,17})$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed < INTEGER_LIMIT ? parsed : null;
}
function aligned(value: Decimal, scale: number): bigint { return value.coefficient * 10n ** BigInt(scale - value.scale); }
function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return { coefficient: aligned(a, scale) + aligned(b, scale), scale };
}
function compare(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale), left = aligned(a, scale), right = aligned(b, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}
function format(value: Decimal): string {
  if (value.coefficient === 0n) return '0';
  const raw = value.coefficient.toString().padStart(value.scale + 1, '0');
  return value.scale ? `${raw.slice(0, -value.scale)}.${raw.slice(-value.scale)}`.replace(/\.?0+$/, '') : raw;
}
function differenceFloorZero(a: Decimal, b: Decimal): string {
  const scale = Math.max(a.scale, b.scale);
  return format({ coefficient: aligned(a, scale) > aligned(b, scale) ? aligned(a, scale) - aligned(b, scale) : 0n, scale });
}
function bounded(value: Decimal): boolean { return value.coefficient < DOLLAR_LIMIT * 10n ** BigInt(value.scale); }
function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function validTokens(value: unknown): value is SurplusTokenCounts {
  return isRecord(value) && exactKeys(value, SURPLUS_USAGE_DIMENSIONS) && SURPLUS_USAGE_DIMENSIONS.every(key => parseTokens(value[key]) !== null);
}
function validUsage(value: unknown): value is SurplusNormalizedUsage {
  return isRecord(value) && exactKeys(value, ['semantics', 'mappingReviewId', 'tokens']) && value.semantics === 'disjoint-token-counts-v1' && isText(value.mappingReviewId) && validTokens(value.tokens);
}
function validEndpoint(value: unknown): value is string {
  // Bind to the exact official endpoint, never a seller-supplied URL.
  return typeof value === 'string' && /^https:\/\/api\.surplusintelligence\.ai\/(?:min(?:30|90)\/)?v1(?:\/chat\/completions)?$/.test(value);
}
function officialSource(value: unknown): value is string {
  if (!isText(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !/(^|\.)surplusintelligence\.ai$/.test(url.hostname);
  } catch { return false; }
}
const BINDING_TEXT_KEYS = ['buildId', 'callId', 'accountId', 'modelId', 'modelVersion', 'providerId'] as const;
function validBinding(value: unknown): value is SurplusCallBinding {
  return isRecord(value) && BINDING_TEXT_KEYS.every(key => isText(value[key])) && (value.offerId === null || isText(value.offerId)) && validEndpoint(value.endpoint) && isTime(value.startedAt);
}
function bindingsMatch(receipt: SurplusReceiptEvidence, binding: SurplusCallBinding): boolean {
  return [...BINDING_TEXT_KEYS, 'offerId', 'endpoint', 'startedAt'].every(key => receipt[key as keyof SurplusCallBinding] === binding[key as keyof SurplusCallBinding]);
}
/** Accept only exact integer microUSD, including losslessly parsed provider numbers. */
export function surplusBuyerCostToUsd(value: unknown): string | null {
  const token = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  const micro = parseTokens(token);
  return micro === null ? null : format({ coefficient: micro, scale: 6 });
}
function validExpense(value: unknown, now: number): value is SurplusReceiptEvidence {
  return isRecord(value) && ['buildId', 'callId', 'accountId'].every(key => isText(value[key])) &&
    validEndpoint(value.endpoint) && isTime(value.startedAt) && value.kind === 'validated-surplus-response' && value.currency === 'USD' &&
    surplusBuyerCostToUsd(value.buyerCostMicro) !== null && value.costSource === 'usage.buyer_cost_micro' &&
    value.responseComplete === true && isHash(value.evidenceSha256) && isTime(value.receivedAt) &&
    value.startedAt <= value.receivedAt && value.receivedAt <= now;
}
function validReceiptIdentity(receipt: SurplusReceiptEvidence): boolean {
  if (!isText(receipt.receiptId) || !isText(receipt.requestId)) return false;
  if (receipt.identitySource === 'provider-response-id') return true;
  return receipt.identitySource === 'server-dispatch-id' && receipt.receiptId === receipt.callId && receipt.requestId === receipt.callId;
}
function receiptFingerprint(receipt: SurplusReceiptEvidence): string {
  // Fixed field order plus canonical decimals/counts. The artifact digest binds any
  // upstream evidence this projection cannot see (including raw aliases and fees).
  return createHash('sha256').update(JSON.stringify([
    SURPLUS_BUILD_POLICY_ID, ...BINDING_TEXT_KEYS.map(key => receipt[key]), receipt.endpoint,
    receipt.offerId, receipt.startedAt, receipt.identitySource, receipt.receiptId, receipt.requestId, receipt.receivedAt,
    receipt.evidenceSha256, surplusBuyerCostToUsd(receipt.buyerCostMicro),
    receipt.additionalCharges, validUsage(receipt.usage) ? [receipt.usage.semantics, receipt.usage.mappingReviewId,
      ...SURPLUS_USAGE_DIMENSIONS.map(key => receipt.usage!.tokens[key])] : null,
  ])).digest('hex');
}
export interface SurplusTariffApplicabilityContext {
  modelId: string;
  modelVersion: string;
  mappingReviewId: string;
  startedAt: number;
  receivedAt: number;
}
/** Shared pre-dispatch/settlement gate. Admission uses receivedAt === startedAt. */
export function isSurplusOfficialTariffApplicable(
  value: unknown, context: SurplusTariffApplicabilityContext, now: number,
): value is SurplusOfficialTariff {
  if (!isRecord(context) || !isText(context.modelId) || !isText(context.modelVersion) || !isText(context.mappingReviewId) ||
    !isTime(now) || !isTime(context.startedAt) || !isTime(context.receivedAt) ||
    context.startedAt > context.receivedAt || context.receivedAt > now) return false;
  if (!isRecord(value) || value.kind !== 'reviewed-official-provider-tariff' || value.billingBasis !== 'tokens-only' || value.currency !== 'USD') return false;
  if (!['snapshotId', 'reviewId', 'officialModelId', 'officialModelVersion', 'modelMappingReviewId', 'usageMappingReviewId'].every(key => isText(value[key])) || !isHash(value.artifactSha256) || !officialSource(value.sourceUrl)) return false;
  if (value.surplusModelId !== context.modelId || value.surplusModelVersion !== context.modelVersion || value.usageMappingReviewId !== context.mappingReviewId) return false;
  if (!isTime(value.observedAt) || !isTime(value.reviewedAt) || !isTime(value.reviewExpiresAt) || !isTime(value.effectiveFrom)) return false;
  if (value.observedAt > value.reviewedAt || value.reviewedAt > context.startedAt || value.reviewExpiresAt <= now || value.reviewExpiresAt <= context.receivedAt || value.effectiveFrom > context.startedAt) return false;
  if (value.effectiveUntil !== null && (!isTime(value.effectiveUntil) || value.effectiveUntil <= value.effectiveFrom || value.effectiveUntil <= context.receivedAt)) return false;
  if (!isRecord(value.usdPerMillionTokens) || !exactKeys(value.usdPerMillionTokens, SURPLUS_USAGE_DIMENSIONS)) return false;
  return SURPLUS_USAGE_DIMENSIONS.every(key => (value.usdPerMillionTokens as JsonRecord)[key] === 'not-supported' || parseDecimal((value.usdPerMillionTokens as JsonRecord)[key]) !== null);
}

function validTariff(value: unknown, receipt: SurplusReceiptEvidence, now: number): value is SurplusOfficialTariff {
  return isSurplusOfficialTariffApplicable(value, {
    modelId: receipt.modelId, modelVersion: receipt.modelVersion,
    mappingReviewId: receipt.usage?.mappingReviewId ?? '',
    startedAt: receipt.startedAt, receivedAt: receipt.receivedAt,
  }, now);
}

/**
 * Explicit reviewed conversion only. Cache read/write must be known, disjoint subsets
 * of input, and reasoning a known subset of output. No missing field becomes zero.
 * Provider raw aliases must be reconciled by the trusted adapter before this call.
 */
export function normalizeSurplusUsage(input: {
  mappingReviewId: string;
  inputIncludesCache: boolean;
  outputIncludesReasoning: boolean;
  tokens: SurplusTokenCounts;
}): SurplusNormalizedUsage | null {
  if (!isRecord(input) || !isText(input.mappingReviewId) || typeof input.inputIncludesCache !== 'boolean' || typeof input.outputIncludesReasoning !== 'boolean' || !validTokens(input.tokens)) return null;
  const tokens = Object.fromEntries(SURPLUS_USAGE_DIMENSIONS.map(key => [key, parseTokens(input.tokens[key])!])) as Record<SurplusUsageDimension, bigint>;
  if (input.inputIncludesCache) tokens.input -= tokens.cacheRead + tokens.cacheWrite;
  if (input.outputIncludesReasoning) tokens.output -= tokens.reasoning;
  if (tokens.input < 0n || tokens.output < 0n) return null;
  return { semantics: 'disjoint-token-counts-v1', mappingReviewId: input.mappingReviewId,
    tokens: Object.fromEntries(SURPLUS_USAGE_DIMENSIONS.map(key => [key, tokens[key].toString()])) as SurplusTokenCounts };
}

function evaluateReceipt(input: SurplusReceiptPolicyInput): SurplusReceiptDecision {
  const result: SurplusReceiptDecision = {
    policyId: SURPLUS_BUILD_POLICY_ID, status: 'blocked', reason: 'invalid_input',
    buildId: null, callId: null, accountingIdentity: null, evidenceFingerprint: null,
    receiptId: null, accountId: null, requestId: null, identitySource: null, modelId: null, modelVersion: null, providerId: null, expenseEvidence: 'unknown', tariffSnapshotId: null,
    usageMappingReviewId: null, actualCostUsd: null, userChargeUsd: '0',
    officialCeilingUsd: null, absorbedCostUsd: null, newSupplierExpenseUsd: null,
  };
  if (!isRecord(input)) return result;
  if (input.provider !== 'surplus' || input.product !== 'app-builder') return { ...result, status: 'not_applicable', reason: 'outside_surplus_app_builder' };
  if (!isTime(input.now)) return result;
  const receipt = input.receipt;
  if (!validExpense(receipt, input.now)) return { ...result, reason: 'missing_or_unverified_actual_expense' };
  const actual = parseDecimal(surplusBuyerCostToUsd(receipt.buyerCostMicro))!;
  Object.assign(result, {
    buildId: receipt.buildId, callId: receipt.callId, accountId: receipt.accountId,
    receiptId: isText(receipt.receiptId) ? receipt.receiptId : null, requestId: isText(receipt.requestId) ? receipt.requestId : null,
    identitySource: validReceiptIdentity(receipt) ? receipt.identitySource : null,
    modelId: isText(receipt.modelId) ? receipt.modelId : null, modelVersion: isText(receipt.modelVersion) ? receipt.modelVersion : null,
    providerId: isText(receipt.providerId) ? receipt.providerId : null, expenseEvidence: 'provider-reported-actual', actualCostUsd: format(actual),
    newSupplierExpenseUsd: format(actual), absorbedCostUsd: format(actual),
  });
  if (!validReceiptIdentity(receipt)) return { ...result, reason: 'missing_or_invalid_receipt_identity', newSupplierExpenseUsd: null };
  result.accountingIdentity = `surplus:${createHash('sha256').update(JSON.stringify([receipt.accountId, receipt.identitySource, receipt.receiptId])).digest('hex')}`;
  result.evidenceFingerprint = receiptFingerprint(receipt);
  if (input.priorSettlements !== undefined) {
    if (!Array.isArray(input.priorSettlements) || input.priorSettlements.length > MAX_PRIOR_SETTLEMENTS) return { ...result, reason: 'invalid_prior_settlements', newSupplierExpenseUsd: null };
    let prior: SurplusPriorSettlement | undefined;
    for (const candidate of input.priorSettlements) {
      if (!isRecord(candidate) || !isText(candidate.accountingIdentity) || !isHash(candidate.evidenceFingerprint) || candidate.policyId !== SURPLUS_BUILD_POLICY_ID || !parseDecimal(candidate.actualCostUsd) || !parseDecimal(candidate.userChargeUsd, 30)) return { ...result, reason: 'invalid_prior_settlements', newSupplierExpenseUsd: null };
      if (candidate.accountingIdentity !== result.accountingIdentity) continue;
      if (candidate.evidenceFingerprint !== result.evidenceFingerprint || compare(parseDecimal(candidate.actualCostUsd)!, actual) !== 0 || (prior && compare(parseDecimal(candidate.userChargeUsd, 30)!, parseDecimal(prior.userChargeUsd, 30)!) !== 0)) return { ...result, status: 'conflict', reason: 'conflicting_duplicate_receipt', newSupplierExpenseUsd: '0' };
      prior = candidate as unknown as SurplusPriorSettlement;
    }
    if (prior) return { ...result, status: 'duplicate', reason: 'receipt_already_settled', newSupplierExpenseUsd: '0', absorbedCostUsd: differenceFloorZero(actual, parseDecimal(prior.userChargeUsd, 30)!), priorUserChargeUsd: format(parseDecimal(prior.userChargeUsd, 30)!) };
  }
  if (!validBinding(input.binding) || !validBinding(receipt) || !bindingsMatch(receipt, input.binding)) return { ...result, reason: 'receipt_call_binding_mismatch' };
  const absorptionReason = ['failed', 'malformed', 'discarded', 'partially_discarded'].includes(input.disposition)
    ? input.disposition === 'partially_discarded' ? 'partial_discard_requires_whole_call_absorption' : `${input.disposition}_call_absorbed`
    : null;
  // Absorption is independent of pricing evidence. Retain a fully verified same-usage
  // ceiling for supplier-cost safety checks, but never turn it into a customer charge.
  // Missing evidence leaves the ceiling unknown without hiding the absorbed expense.
  const unavailableCeiling = (reason: string): SurplusReceiptDecision => ({ ...result,
    status: absorptionReason ? 'absorbed' : 'blocked', reason: absorptionReason ?? reason });
  if (input.disposition !== 'accepted' && !absorptionReason) return { ...result, reason: 'output_acceptance_not_verified' };
  if (receipt.additionalCharges !== 'none') return unavailableCeiling('non_token_or_unknown_charges_unsupported');
  if (!validUsage(receipt.usage)) return unavailableCeiling('missing_or_ambiguous_usage');
  result.usageMappingReviewId = receipt.usage.mappingReviewId;
  if (!validTariff(input.tariff, receipt, input.now)) return unavailableCeiling('missing_or_invalid_official_tariff');
  const tariff = input.tariff;
  result.tariffSnapshotId = tariff.snapshotId;
  let ceiling: Decimal = { coefficient: 0n, scale: 0 };
  for (const key of SURPLUS_USAGE_DIMENSIONS) {
    const count = parseTokens(receipt.usage.tokens[key])!, rate = tariff.usdPerMillionTokens[key];
    if (rate === 'not-supported') {
      if (count !== 0n) return unavailableCeiling('usage_dimension_unsupported_by_official_tariff');
    } else {
      const parsed = parseDecimal(rate)!;
      ceiling = add(ceiling, { coefficient: parsed.coefficient * count, scale: parsed.scale + 6 });
    }
  }
  if (!bounded(ceiling)) return unavailableCeiling('official_ceiling_exceeds_accounting_bound');
  if (absorptionReason) return { ...result, status: 'absorbed', reason: absorptionReason, officialCeilingUsd: format(ceiling) };
  const markedUp = { coefficient: actual.coefficient * 10n, scale: actual.scale };
  const charge = compare(markedUp, ceiling) <= 0 ? markedUp : ceiling;
  return { ...result, status: 'chargeable', reason: compare(markedUp, ceiling) <= 0 ? 'ten_times_verified_actual_cost' : 'capped_at_verified_official_tariff',
    officialCeilingUsd: format(ceiling), userChargeUsd: format(charge), absorbedCostUsd: differenceFloorZero(actual, charge) };
}

// A caller cannot manufacture a trusted decision by deserializing user-controlled JSON.
// Persist the evidence and re-evaluate on replay; a process-local brand is not durable
// authentication. Do not spread/clone decisions before passing them to accounting.
const issuedDecisions = new WeakSet<object>();
export function evaluateSurplusReceipt(input: SurplusReceiptPolicyInput): Readonly<SurplusReceiptDecision> {
  const result = Object.freeze(evaluateReceipt(input));
  issuedDecisions.add(result);
  return result;
}
export function isSurplusReceiptDecision(value: unknown): value is Readonly<SurplusReceiptDecision> {
  return typeof value === 'object' && value !== null && issuedDecisions.has(value);
}
