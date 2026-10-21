import type { QueueContinuationTicket } from '../../lib/queueContinuation';
import type { QueueResponseItem } from '../../lib/queueResponse';
import type { QueueSessionScope, QueueSessionSnapshot } from './queueSessionScope';

export const QUEUE_CONTINUATION_WAIT_MS = 120_000;
export const QUEUE_CONTINUATION_POLL_MS = 1_000;
export const QUEUE_CONTINUATION_ADMISSION_WAIT_MS = 15_000;

function abortableDelay(ms: number, abort: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (abort.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); abort.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    abort.addEventListener('abort', finish, { once: true });
  });
}

class QueueContinuationDeadlineError extends Error {
  constructor() { super('The previous work is still finishing. Review this queued step before continuing.'); }
}

/** Read-only/auth waits may finish late. Their completion can never outlive Stop or grant more time. */
async function withinContinuationDeadline<T>(stage: () => Promise<T>, deadline: number, now: () => number, signal: AbortSignal): Promise<{ stale: true } | { value: T }> {
  if (signal.aborted) return { stale: true };
  const remaining = deadline - now();
  if (remaining <= 0) throw new QueueContinuationDeadlineError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted: (() => void) | undefined;
  try {
    return await new Promise<{ stale: true } | { value: T }>((resolve, reject) => {
      aborted = () => resolve({ stale: true });
      signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(() => reject(new QueueContinuationDeadlineError()), remaining);
      void Promise.resolve().then(async () => {
        if (signal.aborted) return;
        const value = await stage();
        if (signal.aborted) { resolve({ stale: true }); return; }
        if (now() >= deadline) throw new QueueContinuationDeadlineError();
        resolve({ value });
      }).catch(reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (aborted) signal.removeEventListener('abort', aborted);
  }
}

export function queuedContinuationStartOptions(ticket: QueueContinuationTicket, snapshot: QueueSessionSnapshot) {
  return { queueItemId: ticket.itemId, queueClaimToken: ticket.claimToken, queueContinuationProtocol: 1 as const,
    queueContinuationNonce: ticket.nonce, queuePredecessorAttemptId: ticket.predecessorAttemptId, sessionId: snapshot.sessionId };
}

/** A committed READY handoff may precede its worker's local cleanup ACK. Retry only that refusal. */
export async function fetchQueuedContinuationAdmission(input: {
  send: (signal: AbortSignal) => Promise<Response>;
  signal: AbortSignal;
  current: () => boolean;
}): Promise<Response> {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  input.signal.addEventListener('abort', cancel, { once: true });
  if (input.signal.aborted) cancel();
  const deadline = Date.now() + QUEUE_CONTINUATION_ADMISSION_WAIT_MS;
  const ensureCurrent = () => { if (abort.signal.aborted || !input.current()) throw new DOMException('Queued continuation cancelled', 'AbortError'); };
  try {
    for (let attempt = 0; ; attempt++) {
      ensureCurrent();
      const sent = await withinContinuationDeadline(() => input.send(abort.signal), deadline, Date.now, abort.signal);
      ensureCurrent();
      if ('stale' in sent) throw new DOMException('Queued continuation cancelled', 'AbortError');
      const response = sent.value;
      if (response.status !== 409) return response;
      let payload: unknown;
      try {
        const parsed = await withinContinuationDeadline(() => response.clone().json(), deadline, Date.now, abort.signal);
        ensureCurrent();
        if ('stale' in parsed) throw new DOMException('Queued continuation cancelled', 'AbortError');
        payload = parsed.value;
      } catch (error) {
        if (error instanceof QueueContinuationDeadlineError || abort.signal.aborted || !input.current()) throw error;
        return response;
      }
      const refusal = payload as { code?: unknown; retryable?: unknown; resumable?: unknown } | null;
      if (refusal?.code !== 'QUEUE_CONTINUATION_RETIRING' || refusal.retryable !== true || refusal.resumable !== false || attempt >= 14) return response;
      const waited = await withinContinuationDeadline(() => abortableDelay(QUEUE_CONTINUATION_POLL_MS, abort.signal), deadline, Date.now, abort.signal);
      ensureCurrent();
      if ('stale' in waited) throw new DOMException('Queued continuation cancelled', 'AbortError');
    }
  } catch (error) {
    abort.abort();
    throw error;
  } finally {
    input.signal.removeEventListener('abort', cancel);
  }
}

/** Poll only the captured, live logical claim. Reopen deliberately cannot invent this handle. */
export async function awaitQueuedContinuation(input: {
  ticket: QueueContinuationTicket;
  claim: { id: string; claimToken?: string; scope: QueueSessionSnapshot };
  scope: QueueSessionScope;
  signal: AbortSignal;
  load: (workspaceId: string) => Promise<{ items: QueueResponseItem[]; paused: boolean }>;
  beforeBuild?: () => Promise<void>;
  run: (ticket: QueueContinuationTicket, snapshot: QueueSessionSnapshot) => void;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<'started' | 'stale'> {
  const { ticket, claim, scope, signal } = input;
  const current = () => !signal.aborted && scope.isCurrent(claim.scope);
  if (!current()) return 'stale';
  if (ticket.itemId !== claim.id || ticket.claimToken !== claim.claimToken || !claim.scope.workspaceId) {
    throw new Error('This queued continuation could not be matched. Review the step before continuing.');
  }
  const now = input.now ?? Date.now;
  const deadline = now() + QUEUE_CONTINUATION_WAIT_MS;
  const wait = input.wait ?? abortableDelay;
  for (;;) {
    if (!current()) return 'stale';
    const read = await withinContinuationDeadline(() => input.load(claim.scope.workspaceId!), deadline, now, signal);
    if ('stale' in read) return 'stale';
    const queue = read.value;
    if (!current()) return 'stale';
    const item = queue.items.find((row) => row.id === ticket.itemId);
    const handoff = item?.continuation;
    if (queue.paused || item?.status !== 'running' || item.claimToken !== ticket.claimToken
      || handoff?.nonce !== ticket.nonce || handoff.predecessorAttemptId !== ticket.predecessorAttemptId
      || handoff.planRemaining !== ticket.planRemaining || handoff.ordinal !== ticket.ordinal) {
      throw new Error('This queued step changed or was stopped. Refresh and review it before continuing.');
    }
    if (handoff.phase === 'ready') {
      try {
        const flush = await withinContinuationDeadline(async () => { await input.beforeBuild?.(); }, deadline, now, signal);
        if ('stale' in flush) return 'stale';
      } catch (error) {
        // A completed rejected flush remains best-effort; an unfinished flush cannot overlap a new build.
        if (error instanceof QueueContinuationDeadlineError) throw error;
      }
      if (!current()) return 'stale';
      if (now() >= deadline) throw new QueueContinuationDeadlineError();
      input.run(ticket, claim.scope);
      return 'started';
    }
    if (now() >= deadline) throw new QueueContinuationDeadlineError();
    const waited = await withinContinuationDeadline(() => wait(QUEUE_CONTINUATION_POLL_MS, signal), deadline, now, signal);
    if ('stale' in waited) return 'stale';
  }
}
