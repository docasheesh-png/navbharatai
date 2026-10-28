/** Private identity prevents infrastructure errors or arbitrary error properties impersonating predicates. */
export const RESERVATION_REJECTIONS = ['invalid_control_revision', 'invalid_review_revision', 'pilot_authority_unavailable',
  'invalid_estimate', 'controls_changed', 'duplicate_attempt', 'invalid_pilot_state', 'pending_attempt',
  'pilot_blocked', 'pilot_quarantined', 'call_limit_reached', 'estimated_budget_exhausted'] as const;
export type ReservationRejection = typeof RESERVATION_REJECTIONS[number];
const rejections = new WeakMap<object, ReservationRejection>();
export function reservationRejection(reason: ReservationRejection, message: string): Error {
  const error = new Error(message); rejections.set(error, reason); return error;
}
export function readReservationRejection(error: unknown): ReservationRejection | undefined {
  return error !== null && typeof error === 'object' ? rejections.get(error) : undefined;
}
