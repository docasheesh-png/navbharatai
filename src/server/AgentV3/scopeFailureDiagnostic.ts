import { RESERVATION_REJECTIONS } from '../AI/SurplusRegistry/reservationDiagnostic';
/** Private error identity, never upstream properties/text. Observations do not authorize retries. */
export const SCOPE_FAILURE_REASONS = {
  input: ['invalid_request'],
  classification: ['classifier_failed', 'invalid_scope'],
  deadline: ['scope_timeout'],
  authorization: ['authorization_failed'],
  reservation: ['reservation_failed', ...RESERVATION_REJECTIONS],
  dispatch: ['dispatch_failed'],
  response_validation: ['invalid_completion'],
  receipt: ['receipt_failed'],
} as const;
export type ScopeFailureDiagnostic = { [S in keyof typeof SCOPE_FAILURE_REASONS]: {
  stage: S; reason: (typeof SCOPE_FAILURE_REASONS)[S][number];
} }[keyof typeof SCOPE_FAILURE_REASONS];
const failures = new WeakMap<object, Readonly<ScopeFailureDiagnostic>>();
export function tagScopeFailure<T>(error: T, diagnostic: ScopeFailureDiagnostic): T {
  if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
    failures.set(error, Object.freeze({ ...diagnostic }));
  }
  return error;
}
export function readScopeFailure(error: unknown): Readonly<ScopeFailureDiagnostic> | undefined {
  return error !== null && (typeof error === 'object' || typeof error === 'function') ? failures.get(error) : undefined;
}
