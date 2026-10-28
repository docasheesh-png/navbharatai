/** Exact integer micro-USD strings avoid rounding large configured limits. No identity fields. */
export const PILOT_REASONS = ['supplier_cost_unknown', 'receipt_accounting_unavailable', 'reservation_comparison_unavailable',
  'actual_cost_exceeded_reserved_estimate', 'official_tariff_comparison_unavailable', 'realized_discount_below_90_percent', 'other'] as const;
export interface SurplusPilotStatus {
  status: 'unknown' | 'no_record' | 'recorded' | 'invalid_state';
  canDispatch: false;
  pending: boolean | null; blocked: boolean | null; quarantined: boolean | null;
  reason: typeof PILOT_REASONS[number] | null;
  recordedExpenseMicroUsd: string | null; calls: number | null; reservedEstimateMicroUsd: string | null;
  maxCalls: number | null; maxEstimatedMicroUsd: string | null;
}
const keys = ['status', 'canDispatch', 'pending', 'blocked', 'quarantined', 'reason', 'recordedExpenseMicroUsd', 'calls', 'reservedEstimateMicroUsd', 'maxCalls', 'maxEstimatedMicroUsd'];
const money = (v: unknown): boolean => typeof v === 'string' && /^(0|[1-9]\d{0,30})$/.test(v);
const count = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function isSurplusPilotStatus(value: unknown): value is SurplusPilotStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || !Object.keys(v).every(k => keys.includes(k))
    || typeof v.status !== 'string' || !['unknown', 'no_record', 'recorded', 'invalid_state'].includes(v.status) || v.canDispatch !== false
    || !(v.maxCalls === null || count(v.maxCalls) && (v.maxCalls as number) > 0)
    || !(v.maxEstimatedMicroUsd === null || money(v.maxEstimatedMicroUsd))) return false;
  if ((v.maxCalls === null) !== (v.maxEstimatedMicroUsd === null) || v.status !== 'unknown' && v.maxCalls === null) return false;
  if (v.status !== 'recorded') return ['pending', 'blocked', 'quarantined', 'reason', 'recordedExpenseMicroUsd', 'calls', 'reservedEstimateMicroUsd'].every(k => v[k] === null);
  return ['pending', 'blocked', 'quarantined'].every(k => typeof v[k] === 'boolean')
    && (v.reason === null || v.quarantined === true && PILOT_REASONS.includes(v.reason as typeof PILOT_REASONS[number]))
    && money(v.recordedExpenseMicroUsd) && money(v.reservedEstimateMicroUsd) && count(v.calls) && (v.calls as number) >= 1
    && v.maxCalls !== null && v.maxEstimatedMicroUsd !== null;
}
