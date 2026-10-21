/** Additive queue protocol. A result proposes a handoff; a fresh queue read confirms readiness. */
export interface QueueContinuationState {
  version: 1;
  nonce: string;
  predecessorAttemptId: string;
  phase: 'pending' | 'ready';
  planRemaining: number;
  ordinal: number;
}

export interface QueueContinuationTicket {
  itemId: string;
  claimToken: string;
  predecessorAttemptId: string;
  nonce: string;
  state: 'pending';
  planRemaining: number;
  ordinal: number;
}

const boundedId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
export const MAX_QUEUED_CONTINUATIONS = 100;
export const QUEUED_PLAN_MODULE_MAX = 60;
export const validQueueContinuationNonce = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const validQueueContinuationProgress = (value: { planRemaining?: unknown; ordinal?: unknown }): boolean =>
  Number.isInteger(value.planRemaining) && Number(value.planRemaining) > 0 && Number(value.planRemaining) <= QUEUED_PLAN_MODULE_MAX
  && Number.isInteger(value.ordinal) && Number(value.ordinal) > 0 && Number(value.ordinal) <= MAX_QUEUED_CONTINUATIONS;

export function validQueueContinuation(value: unknown): value is QueueContinuationState {
  const row = value as QueueContinuationState;
  return !!row && typeof row === 'object' && !Array.isArray(row) && row.version === 1 && ['pending', 'ready'].includes(row.phase)
    && validQueueContinuationNonce(row.nonce) && validQueueContinuationNonce(row.predecessorAttemptId) && validQueueContinuationProgress(row);
}

export function readQueueContinuationTicket(value: unknown): QueueContinuationTicket | undefined {
  const ticket = value as QueueContinuationTicket;
  return ticket && typeof ticket === 'object' && !Array.isArray(ticket) && boundedId(ticket.itemId) && boundedId(ticket.claimToken) && ticket.state === 'pending'
    && validQueueContinuationNonce(ticket.nonce) && validQueueContinuationNonce(ticket.predecessorAttemptId) && validQueueContinuationProgress(ticket) ? ticket : undefined;
}
