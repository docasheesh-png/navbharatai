import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { SurplusReceiptDecision, SurplusNormalizedUsage } from './receiptPolicy';
import { readSurplusModelControls, SURPLUS_DOCUMENT } from './store';
export interface SurplusPilotAuthority {
  id: string; expiresAt: number; maxCalls: number; maxEstimatedMicroUsd: string;
  providerSpendLimitReviewedUntil: number; noAutoTopup: true;
}
export interface SurplusReceiptAudit {
  buildId: string; callId: string; accountId: string; model: string; providerId: string;
  endpoint: string; policyVersion: string; priceGeneration: string;
  reportedAt: number; usage: SurplusNormalizedUsage | null;
  invoiceReconciliation: 'not-reconciled'; decision: SurplusReceiptDecision;
}
export interface SurplusPersistenceResult { canContinue: boolean }
export type SurplusUnattemptedReason = 'minimum_discount_not_met' | 'no_sellers_for_model';
/** Only the trusted server adapter may construct this from an explicit official wire error. */
export interface SurplusUnattemptedAudit {
  buildId: string; callId: string; accountId: string; model: string; providerId: string;
  endpoint: string; policyVersion: string; priceGeneration: string;
  reportedAt: number; reason: SurplusUnattemptedReason; traceRequestId: string; evidenceSha256: string;
}
/** Owner key+flag live pilot (2026-10-25). Its pilot doc is ONE global document for every build.
 * DNA (05011–05013): the reviewed-pilot rules made that doc a global single-flight lock — one
 * `pendingCallId` and a permanent `blocked`/quarantine with "no automatic clear". The first uncertain
 * call (Stop/deadline mid-dispatch, unknown cost, an 8-token empty scope reply) left it jammed, so every
 * later reservation threw "Surplus pilot pending, blocked or exhausted" BEFORE any HTTP request →
 * scope ask provider=unknown, 0 tokens → mid_build_engine_unavailable → Kimi, on every build, forever.
 * For the live pilot the global doc is a counter only; per-call receipt docs keep replay protection,
 * per-call pending/unknown state and their quarantine reason for audit. Reviewed pilots are unchanged. */
export const SURPLUS_LIVE_PILOT_ID = 'owner-live-key-flag-v1';
const isLivePilot = (id: unknown) => id === SURPLUS_LIVE_PILOT_ID;
const RESERVATION_IDENTITY = ['buildId', 'callId', 'accountId', 'model', 'providerId', 'endpoint', 'policyVersion', 'priceGeneration'] as const;
type StoredState = Record<string, unknown>;
const validText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512
  && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
function assertReservationIdentity(existing: StoredState, value: SurplusReceiptAudit | SurplusUnattemptedAudit): void {
  if (!validText(existing.pilotKey)) throw new Error('Surplus receipt has no durable dispatch reservation');
  if (RESERVATION_IDENTITY.some(key => !validText(value[key]) || existing[key] !== value[key])) throw new Error('Surplus receipt reservation identity mismatch');
}
function assertPilotAccountingState(pilot: StoredState): void {
  if (typeof pilot.actualMicroUsd !== 'string' || !/^(0|[1-9]\d*)$/.test(pilot.actualMicroUsd)
      || typeof pilot.calls !== 'number' || !Number.isSafeInteger(pilot.calls) || pilot.calls < 1 || !validText(pilot.authorityId)
      || typeof pilot.expiresAt !== 'number' || !Number.isFinite(pilot.expiresAt) || pilot.expiresAt < 0
      || (pilot.pendingCallId !== null && !validText(pilot.pendingCallId))
      || typeof pilot.reservedEstimatedMicroUsd !== 'string' || !/^(0|[1-9]\d*)$/.test(pilot.reservedEstimatedMicroUsd)
      || (pilot.blocked !== undefined && typeof pilot.blocked !== 'boolean')
      || (pilot.quarantineReason != null && !validText(pilot.quarantineReason))
      || (pilot.quarantinedAt != null && (typeof pilot.quarantinedAt !== 'number' || !Number.isSafeInteger(pilot.quarantinedAt) || pilot.quarantinedAt < 0))) throw new Error('Surplus pilot accounting state invalid');
}
/** This is a circuit-breaker result, not fresh dispatch authority: reservation still checks all limits. */
function continuation(pilot: StoredState, receipt: StoredState): SurplusPersistenceResult {
  if (isLivePilot(pilot.authorityId)) return { canContinue: receipt.quarantineReason == null && (receipt.state === 'reported' || receipt.state === 'not_attempted') };
  return { canContinue: pilot.blocked !== true && pilot.quarantineReason == null && pilot.quarantinedAt == null && receipt.quarantineReason == null
    && pilot.pendingCallId === null && pilot.reservedEstimatedMicroUsd === '0'
    && (receipt.state === 'reported' || receipt.state === 'not_attempted') };
}
const digest = (parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
function roundedMicro(value: string): bigint {
  if (!/^\d{1,18}(?:\.\d{1,6})?$/.test(value)) throw new Error('Invalid Surplus estimated reservation');
  const [whole, fraction = ''] = value.split('.'); return BigInt(whole) + (/[^0]/.test(fraction) ? 1n : 0n);
}
/** Operational circuit breaker only: never changes the already-issued billing decision. */
function receiptQuarantineReason(decision: SurplusReceiptDecision, actualMicro: bigint, reservedMicro: unknown): string | null {
  if (decision.actualCostUsd === null) return 'supplier_cost_unknown';
  if (!['chargeable', 'absorbed'].includes(decision.status)) return 'receipt_accounting_unavailable';
  if (typeof reservedMicro !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(reservedMicro)) return 'reservation_comparison_unavailable';
  if (actualMicro > BigInt(reservedMicro)) return 'actual_cost_exceeded_reserved_estimate';
  const official = decision.officialCeilingUsd;
  if (typeof official !== 'string' || !/^(0|[1-9]\d{0,30})(?:\.\d{1,24})?$/.test(official)) return 'official_tariff_comparison_unavailable';
  const [whole, fraction = ''] = official.split('.');
  const officialScaled = BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, '0'));
  // Integer microUSD × 10 versus exact reviewed same-usage official USD. Equality is exactly90%.
  if (actualMicro * 10n * 10n ** 18n > officialScaled) return 'realized_discount_below_90_percent';
  return null;
}
/** A durable bounded PILOT reservation, not a claim the provider guarantees this estimated amount. */
export async function reserveSurplusAttempt(db: Pick<Firestore, 'doc' | 'runTransaction'>, input: {
  buildId: string; callId: string; accountId: string; credentialSha256: string;
  model: string; providerId: string; endpoint: string; policyVersion: string; priceGeneration: string;
  estimatedMicroUsd: string; reviewRevision: number; controlRevision?: number; pilot: SurplusPilotAuthority; now: number;
}): Promise<void> {
  const { pilot, now } = input;
  const controlRevision = input.controlRevision === undefined ? 0 : input.controlRevision;
  if (!Number.isSafeInteger(controlRevision) || controlRevision < 0) throw new Error('Invalid Surplus model control revision');
  if (!Number.isSafeInteger(input.reviewRevision) || input.reviewRevision < 1) throw new Error('Missing Surplus review revision');
  if (!pilot || !/^[A-Za-z0-9._:-]{1,120}$/.test(pilot.id) || !Number.isSafeInteger(pilot.maxCalls) || pilot.maxCalls < 1
      || !Number.isFinite(pilot.expiresAt) || pilot.expiresAt <= now || !Number.isFinite(pilot.providerSpendLimitReviewedUntil)
      || pilot.providerSpendLimitReviewedUntil <= now || pilot.noAutoTopup !== true || !/^\d{1,18}$/.test(pilot.maxEstimatedMicroUsd)
      || BigInt(pilot.maxEstimatedMicroUsd) <= 0n || !/^[a-f0-9]{64}$/.test(input.credentialSha256)) throw new Error('Surplus pilot authority unavailable');
  const estimate = roundedMicro(input.estimatedMicroUsd), limit = BigInt(pilot.maxEstimatedMicroUsd);
  const pilotKey = digest([input.accountId, input.credentialSha256, pilot.id]);
  const pilotRef = db.doc(`surplus_pilot_admissions/${pilotKey}`);
  const receiptRef = db.doc(`surplus_build_receipts/${digest([input.accountId, input.callId])}`);
  await db.runTransaction(async tx => {
    const [pilotDoc, receiptDoc, metadataDoc] = await Promise.all([tx.get(pilotRef), tx.get(receiptRef), tx.get(db.doc(SURPLUS_DOCUMENT))]);
    const controls = readSurplusModelControls(metadataDoc.data()?.controls);
    if (!controls || controls.revision !== controlRevision || controls.disabledModels.includes(input.model)) throw new Error('Surplus model controls revoked or changed');
    // Live admission (2026-10-25): pilot authority is carried on the in-process adapter permit.
    // No Firestore surplus-builder-reviews seed is required or re-checked here.
    if (receiptDoc.exists) throw new Error('Surplus attempt already reserved; reconcile before retrying');
    const state = pilotDoc.data() ?? {};
    if (pilotDoc.exists) {
      assertPilotAccountingState(state);
      if (state.authorityId !== pilot.id) throw new Error('Surplus pilot accounting state invalid');
    }
    const live = isLivePilot(pilot.id);
    if ((!live && (state.pendingCallId || state.blocked || state.quarantineReason != null || state.quarantinedAt != null)) || (state.calls ?? 0) >= pilot.maxCalls) throw new Error('Surplus pilot pending, blocked or exhausted');
    const actual = BigInt(state.actualMicroUsd ?? '0');
    if (actual + estimate > limit) throw new Error('Surplus pilot estimated budget exhausted');
    tx.set(pilotRef, live
      // Counter only: concurrent builds and an earlier uncertain call never lock the next reservation.
      ? { ...state, calls: (state.calls ?? 0) + 1, actualMicroUsd: actual.toString(), pendingCallId: null,
        reservedEstimatedMicroUsd: '0', blocked: false, quarantineReason: null, quarantinedAt: null,
        ...(state.quarantineReason != null ? { lastQuarantineReason: state.quarantineReason } : {}),
        expiresAt: pilot.expiresAt, authorityId: pilot.id }
      : { ...state, calls: (state.calls ?? 0) + 1, actualMicroUsd: actual.toString(), pendingCallId: input.callId,
        reservedEstimatedMicroUsd: estimate.toString(), expiresAt: pilot.expiresAt, authorityId: pilot.id });
    tx.set(receiptRef, { state: 'pending', buildId: input.buildId, callId: input.callId, accountId: input.accountId,
      model: input.model, providerId: input.providerId, endpoint: input.endpoint, policyVersion: input.policyVersion,
      priceGeneration: input.priceGeneration, pilotKey, estimatedMicroUsd: estimate.toString(), reservedAt: now,
      invoiceReconciliation: 'not-reconciled' });
  });
}
/** Audit-only; serialized decisions never become wallet or inference authority. */
export async function persistSurplusReceipt(db: Pick<Firestore, 'doc' | 'runTransaction'>, audit: SurplusReceiptAudit): Promise<SurplusPersistenceResult> {
  const ref = db.doc(`surplus_build_receipts/${digest([audit.accountId, audit.callId])}`);
  const value = JSON.parse(JSON.stringify(audit)) as SurplusReceiptAudit;
  return db.runTransaction(async tx => {
    const existing = (await tx.get(ref)).data();
    if (!existing) throw new Error('Surplus receipt has no durable dispatch reservation');
    assertReservationIdentity(existing, value);
    if (existing.state === 'not_attempted') throw new Error('Surplus receipt audit conflict');
    const pilotRef = db.doc(`surplus_pilot_admissions/${existing.pilotKey}`);
    const pilot = (await tx.get(pilotRef)).data() ?? {};
    assertPilotAccountingState(pilot);
    if (existing.decision) {
      if (JSON.stringify(existing.decision) === JSON.stringify(value.decision)) return continuation(pilot, existing);
      // Stop may arrive after receipt mapping: the only allowed correction is absorbing that same call.
      if (existing.decision.evidenceFingerprint !== value.decision.evidenceFingerprint || value.decision.userChargeUsd !== '0'
          || value.decision.status !== 'absorbed' || existing.decision.actualCostUsd !== value.decision.actualCostUsd) throw new Error('Surplus receipt audit conflict');
      const micro = actualMicro(value.decision.actualCostUsd);
      const reason = receiptQuarantineReason(value.decision, micro, existing.estimatedMicroUsd);
      const receipt = { ...existing, ...value, quarantineReason: existing.quarantineReason ?? reason };
      if (isLivePilot(pilot.authorityId)) { tx.set(ref, receipt); return continuation(pilot, receipt); }
      const nextPilot = { ...pilot, blocked: pilot.blocked === true || receipt.quarantineReason != null,
        quarantineReason: pilot.quarantineReason ?? receipt.quarantineReason,
        quarantinedAt: pilot.quarantinedAt ?? (receipt.quarantineReason ? audit.reportedAt : null) };
      tx.set(ref, receipt); tx.set(pilotRef, nextPilot);
      return continuation(nextPilot, receipt);
    }
    if (existing.state !== 'pending') throw new Error('Surplus receipt audit conflict');
    const live = isLivePilot(pilot.authorityId);
    if (!live && pilot.pendingCallId !== audit.callId) throw new Error('Surplus pilot reservation mismatch');
    const known = value.decision.actualCostUsd !== null;
    const micro = actualMicro(value.decision.actualCostUsd);
    const quarantineReason = receiptQuarantineReason(value.decision, micro, existing.estimatedMicroUsd);
    const receipt = { ...existing, ...value, state: known ? 'reported' : 'unknown', quarantineReason: existing.quarantineReason ?? quarantineReason };
    if (live) {
      // Per-call audit keeps its quarantine reason; the shared counter only accumulates known spend.
      const livePilot = { ...pilot, actualMicroUsd: (BigInt(pilot.actualMicroUsd ?? '0') + micro).toString() };
      tx.set(ref, receipt); tx.set(pilotRef, livePilot);
      return continuation(livePilot, receipt);
    }
    const nextPilot = { ...pilot, actualMicroUsd: (BigInt(pilot.actualMicroUsd ?? '0') + micro).toString(),
      pendingCallId: known ? null : audit.callId, reservedEstimatedMicroUsd: known ? '0' : pilot.reservedEstimatedMicroUsd,
      // No automatic clear/reset: only a separately reviewed recovery/new pilot authority can proceed.
      blocked: pilot.blocked === true || receipt.quarantineReason != null,
      quarantineReason: pilot.quarantineReason ?? receipt.quarantineReason,
      quarantinedAt: pilot.quarantinedAt ?? (receipt.quarantineReason ? audit.reportedAt : null) };
    tx.set(ref, receipt); tx.set(pilotRef, nextPilot);
    return continuation(nextPilot, receipt);
  });
}

function actualMicro(actualCostUsd: string | null): bigint {
  if (actualCostUsd === null) return 0n;
  if (typeof actualCostUsd !== 'string' || !/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(actualCostUsd)) throw new Error('Surplus canonical charge is not integer microUSD');
  const [whole, fraction = ''] = actualCostUsd.split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}
/**
 * Resolve only an explicitly documented pre-route rejection validated by the server adapter.
 * An absent receipt, generic zero, timeout or receipt-lookup 404 is NEVER this evidence.
 * This is not a provider receipt or a zero-cost ledger entry. The reserved attempt remains
 * consumed, and an existing quarantine is never cleared even when this request was not run.
 */
export async function resolveSurplusUnattempted(
  db: Pick<Firestore, 'doc' | 'runTransaction'>, input: SurplusUnattemptedAudit,
): Promise<SurplusPersistenceResult> {
  if (!['minimum_discount_not_met', 'no_sellers_for_model'].includes(input.reason)
      || !validText(input.traceRequestId) || typeof input.evidenceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.evidenceSha256)
      || !Number.isSafeInteger(input.reportedAt) || input.reportedAt < 0) throw new Error('Surplus unattempted evidence invalid');
  // Project only the internal audit contract; never persist arbitrary request properties.
  const value: SurplusUnattemptedAudit = {
    buildId: input.buildId, callId: input.callId, accountId: input.accountId, model: input.model,
    providerId: input.providerId, endpoint: input.endpoint, policyVersion: input.policyVersion,
    priceGeneration: input.priceGeneration, reportedAt: input.reportedAt, reason: input.reason,
    traceRequestId: input.traceRequestId, evidenceSha256: input.evidenceSha256,
  };
  const ref = db.doc(`surplus_build_receipts/${digest([value.accountId, value.callId])}`);
  return db.runTransaction(async tx => {
    const existing = (await tx.get(ref)).data();
    if (!existing) throw new Error('Surplus unattempted request has no durable dispatch reservation');
    assertReservationIdentity(existing, value);
    if (Object.hasOwn(existing, 'decision')) throw new Error('Surplus unattempted evidence conflicts with receipt');
    const pilotRef = db.doc(`surplus_pilot_admissions/${existing.pilotKey}`);
    const pilot = (await tx.get(pilotRef)).data() ?? {};
    assertPilotAccountingState(pilot);
    if (existing.state === 'not_attempted') {
      if (['reason', 'traceRequestId', 'evidenceSha256'].some(key => existing[key] !== value[key as keyof SurplusUnattemptedAudit])) throw new Error('Surplus unattempted evidence conflict');
      return continuation(pilot, existing);
    }
    if (existing.state !== 'pending') throw new Error('Surplus unattempted evidence conflicts with receipt');
    const live = isLivePilot(pilot.authorityId);
    if (!live && pilot.pendingCallId !== value.callId) throw new Error('Surplus pilot reservation mismatch');
    if (!Number.isSafeInteger(existing.reservedAt) || value.reportedAt < existing.reservedAt) throw new Error('Surplus unattempted evidence predates reservation');
    const receipt = { ...existing, ...value, state: 'not_attempted' };
    const nextPilot = live ? pilot : { ...pilot, pendingCallId: null, reservedEstimatedMicroUsd: '0' };
    tx.set(ref, receipt); if (!live) tx.set(pilotRef, nextPilot);
    return continuation(nextPilot, receipt);
  });
}
