/** Owner-funded FREE-chat safety budget only. This is NOT a wallet or billing rate card. */
import { checkedAdd, nonnegativeInteger, type DayWindow } from './quota';
export const NANO_USD = 1_000_000_000;
/** Owner-authorized maximum TOTAL per IST day, shared by every paid provider and key. */
export const OWNER_PAID_DAILY_CEILING_NANO_USD = 10 * NANO_USD;
export const DEFAULT_PAID_CAP_NANO_USD = OWNER_PAID_DAILY_CEILING_NANO_USD;
export const DEFAULT_PAID_PER_USER_DAILY_LIMIT = 20;
export const PAID_BUDGET_TIME_ZONE = 'Asia/Kolkata';
export const SPEND_ALERT_THRESHOLDS = [50, 80, 100] as const;
export type SpendAlertThreshold = typeof SPEND_ALERT_THRESHOLDS[number];
export interface PaidReservationInput {
  /** A server-issued id identifying ONE physical call, stable across duplicate admission attempts. */
  requestId: string;
  uid: string;
  maxCostNanoUsd: number;
  /** Publishes a stricter deployment cap durably. Never raises the shared owner-funded budget. */
  capNanoUsd?: number;
  perUserLimit?: number;
}
export interface PaidReservation {
  id: string;
  day: string;
  uidHash: string;
  maxCostNanoUsd: number;
  createdAt: number;
  /** False for duplicate IDs. A duplicate hold is NOT permission for another physical call. */
  mayDispatch: boolean;
}
export interface SpendDay extends DayWindow {
  heldNanoUsd: number;
  spentNanoUsd: number;
  requests: number;
  pending: number;
  /** Conservatively booked attempts still awaiting exact authenticated reconciliation. */
  conservativePending?: number;
  alertedPercent: SpendAlertThreshold[];
}
export interface PaidBudgetPolicy {
  kind: 'paid_budget_policy';
  version: 1;
  revision: number;
  capNanoUsd: number;
  updatedAt: number;
  source: 'deployment' | 'admin' | 'safety';
}
export interface PaidBudgetPolicyUpdateInput {
  capNanoUsd: number;
  /** Zero means no policy exists yet. All existing policies start at revision one. */
  expectedRevision: number;
  /** MUST be supplied by authenticated administrator middleware, never a request-body identity. */
  actorUid: string;
  reason: string;
}
export type PaidBudgetPolicyUpdateResult = { ok: true; policy: PaidBudgetPolicy }
  | { ok: false; reason: 'invalid_input' | 'conflict' | 'policy_corrupt' | 'unavailable'; policy?: PaidBudgetPolicy };
export interface SpendSnapshot extends SpendDay {
  available: boolean;
  committedNanoUsd: number;
  /** Null until a validated deployment or explicit administrator initializes the authority. */
  capNanoUsd: number | null;
  policyRevision: number | null;
  remainingNanoUsd: number | null;
}
/** Decimal parsing rather than dollar floating-point multiplication. Reject unrepresentable money. */
export function usdToNanoUsd(value: string | number): number {
  const text = String(value);
  const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(text);
  if (!match) throw new Error('Invalid USD amount');
  const nano = BigInt(match[1]) * BigInt(NANO_USD) + BigInt((match[2] ?? '').padEnd(9, '0'));
  if (nano > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('USD amount exceeds safe integer');
  return Number(nano);
}
/** Caller supplies verified prices in nano-USD per million tokens; each quote rounds UP. */
export function maximumCostNanoUsd(inputTokens: number, outputTokens: number, inputPerMillionNanoUsd: number, outputPerMillionNanoUsd: number): number {
  if (![inputTokens, outputTokens, inputPerMillionNanoUsd, outputPerMillionNanoUsd].every(nonnegativeInteger)) throw new Error('Invalid price quote');
  const numerator = BigInt(inputTokens) * BigInt(inputPerMillionNanoUsd) + BigInt(outputTokens) * BigInt(outputPerMillionNanoUsd);
  const nano = (numerator + 999_999n) / 1_000_000n;
  if (nano > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Price quote exceeds safe integer');
  return Number(nano);
}
export function validPaidCapNanoUsd(value: unknown): value is number {
  return nonnegativeInteger(value) && value <= OWNER_PAID_DAILY_CEILING_NANO_USD;
}
export function validatePaidInput(input: PaidReservationInput): void {
  if (!input || typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 512
    || typeof input.uid !== 'string' || !input.uid.trim() || input.uid.length > 512
    || !validPaidCapNanoUsd(input.maxCostNanoUsd) || input.maxCostNanoUsd <= 0
    || !validPaidCapNanoUsd(input.capNanoUsd ?? DEFAULT_PAID_CAP_NANO_USD)
    || !nonnegativeInteger(input.perUserLimit ?? DEFAULT_PAID_PER_USER_DAILY_LIMIT)) throw new Error('Invalid paid reservation');
}
export function spendThresholds(day: SpendDay, capNanoUsd: number): SpendAlertThreshold[] {
  if (!nonnegativeInteger(capNanoUsd) || capNanoUsd === 0) return [];
  const committed = BigInt(checkedAdd(day.heldNanoUsd, day.spentNanoUsd));
  return SPEND_ALERT_THRESHOLDS.filter(t => !day.alertedPercent.includes(t) && committed * 100n >= BigInt(capNanoUsd) * BigInt(t));
}
