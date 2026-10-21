import type { Request, Response, RequestHandler } from 'express';
import { renewWorkspaceBuild, LEASE_HEARTBEAT_MS, type BuildLeaseStore } from './workspaceBuildLease';
import type { RunningBuild } from './runningBuildRegistry';
import { abortBuild } from './buildAbortCause';
import { hasBuildBodyExitHold } from './stoppingBuild';
import { SandboxRecoveryUnavailableError, isSandboxRecoveryUnavailable } from './SandboxRecoveryError';
import { redactProvidersText } from '../lib/providerRedaction';
// Per-accepted-request coordination. This owns queue/receipt identity, not runtime/source fencing.
import { loadQueue, bindQueuedBuild, settleQueuedBuild, proposeQueuedContinuation, retireQueuedContinuation, cancelQueuedContinuation, QueueClaimConflictError, type QueueBuildBinding } from './BuildQueueStore';
import type { QueueContinuation } from './BuildQueue';
import { reserveBuildRequest, completeBuildRequest, validBuildRequestId, type BuildRequestReceipt, type BuildRequestOutcome, type BuildRequestStore } from '../lib/buildRequestReceipt';

export interface BuildAdmissionRejection { status: number; payload: Record<string, unknown>; }
export function buildRequestInputRejection(input: { requestId?: unknown; sessionId?: string; ownerId?: string | null }): BuildAdmissionRejection | null {
  if (input.requestId === undefined) return null;
  if (!input.sessionId || !/^[A-Za-z0-9_-]{6,64}$/.test(input.sessionId)) return { status: 400, payload: { error: 'A stable sessionId is required with requestId.', code: 'BUILD_REQUEST_INVALID' } };
  if (!input.ownerId || input.ownerId === 'anon') return { status: 401, payload: { error: 'Please sign in again before retrying this request.', code: 'reauth' } };
  if (!validBuildRequestId(input.requestId)) return { status: 400, payload: { error: 'A valid UUID requestId is required.', code: 'BUILD_REQUEST_INVALID' } };
  return null;
}

/** A known setup refusal ends this attempt before the builder can run or retry on an empty VM. */
class BuildSetupRecoveryUnavailableError extends SandboxRecoveryUnavailableError {}

export function rethrowBuildSetupRecoveryUnavailable(error: unknown): void {
  if (isSandboxRecoveryUnavailable(error)) throw new BuildSetupRecoveryUnavailableError();
}

export function buildExceptionDetails(error: unknown): { message: string; phase: 'sandbox' | 'build'; code: string; summary: string } {
  const message = error instanceof Error ? error.message : String(error);
  const recovery = isSandboxRecoveryUnavailable(error);
  return {
    message,
    phase: recovery ? 'sandbox' : 'build',
    code: recovery ? error.code : 'BUILD_EXCEPTION',
    summary: (recovery ? message : `Build stopped — an unexpected error occurred: ${message}`).slice(0, 500),
  };
}

/** Preserve ordinary crash reporting; a definite pre-builder refusal also settles request identity. */
export function publishBuildException(error: unknown, diagnostics: unknown, emit: (event: unknown) => void): void {
  const { message } = buildExceptionDetails(error);
  emit({ type: 'error', message: redactProvidersText(message), ts: Date.now(),
    ...(isSandboxRecoveryUnavailable(error) ? { code: error.code, retryable: true } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  });
  if (error instanceof BuildSetupRecoveryUnavailableError) {
    emit({ type: 'result', ok: false, summary: message, steps: 0, billedUsd: 0, billedInr: 0 });
  }
}

/** Normal module retirement uses the existing body-completion boundary, never a deadline/Stop. */
export function normalQueuedModuleRetirementAllowed(signal: AbortSignal, build: Pick<RunningBuild, 'requiresBodyExit'>, sourcePublicationsJoined = true): boolean {
  return sourcePublicationsJoined && !signal.aborted && build.requiresBodyExit !== true;
}

/** A proven continuation never attaches the predecessor when its local cleanup is still finishing. */
export function queuedContinuationBusyFields(input: any): Record<string, unknown> {
  return input?.queueContinuationProtocol === 1 && typeof input?.queueContinuationNonce === 'string'
    ? { code: 'QUEUE_CONTINUATION_RETIRING', retryable: true, resumable: false, retryAfterMs: 1000 } : {};
}

export function createBuildRequestCoordination(opts: {
  workspaceId: string; ownerId: string | null; attemptId: string; input: any; prompt: () => string;
  store: () => BuildRequestStore | null;
}) {
  let binding: QueueBuildBinding | null = null;
  let receipt: BuildRequestReceipt | undefined;
  let outcome: BuildRequestOutcome = 'unknown';
  let receiptFinished = false;
  let resultCaptured = false;
  let settlement: Promise<void> = Promise.resolve();
  let intermediate = false;
  let handoff: QueueContinuation | undefined;
  let invalidated = false;
  let actualRetirementReached = false;
  let handoffRetired = false;
  let retirement: Promise<boolean> | undefined;
  let publicationSealed = false;
  const cancelHandoff = async (note: string): Promise<boolean> => {
    if (!binding) return false;
    try { return (await cancelQueuedContinuation(opts.workspaceId, binding, note)).result; }
    catch { return false; }
  };
  const pausedResult = (obj: unknown, forward: (event: unknown) => void, confirmed = false, unavailable = !confirmed): void => {
    const text = unavailable
      ? 'Your module finished, but the next queued window could not be confirmed. Refresh the queue and review this step before continuing.'
      : 'This queued step still has work remaining. It is paused for review before another build window starts.';
    forward({ type: 'narration', agent: 'system', text, ts: Date.now() });
    const result: Record<string, unknown> = { ...(obj as Record<string, unknown>), resumable: false, queueContinuation: undefined,
      code: unavailable ? 'QUEUE_CONTINUATION_UNAVAILABLE' : 'QUEUE_CONTINUATION_REVIEW', summary: text };
    delete result.queuePaused;
    if (confirmed) result.queuePaused = true;
    forward(result);
  };
  return {
    async admit(): Promise<BuildAdmissionRejection | null> {
      // Called only after a verified lease. Read/chat classifier and attachment costs stay outside.
      if (opts.input?.requestId !== undefined && !receipt) {
        const reserved = await reserveBuildRequest(opts.store(), { ownerId: opts.ownerId ?? '', workspaceId: opts.workspaceId,
          requestId: opts.input.requestId, attemptId: opts.attemptId, input: opts.input });
        if (!reserved.ok) {
          const unavailable = reserved.code === 'unavailable';
          return { status: unavailable ? 503 : reserved.code === 'invalid' ? 400 : reserved.code === 'forbidden' ? 403 : 409, payload: {
            error: unavailable ? 'Request progress could not be confirmed. Retry using the same request identity.' : 'This request has already been submitted or changed. Refresh its progress before starting another build.',
            code: `BUILD_REQUEST_${reserved.code.toUpperCase().replace(/-/g, '_')}`, retryable: unavailable,
            ...(reserved.receipt ? { requestState: reserved.receipt.state, workspaceId: reserved.receipt.workspaceId } : {}),
          } };
        }
        receipt = reserved.receipt;
      }
      try {
        binding = (await bindQueuedBuild(opts.workspaceId, opts.prompt(), opts.attemptId, {
          itemId: typeof opts.input?.queueItemId === 'string' ? opts.input.queueItemId : undefined,
          claimToken: typeof opts.input?.queueClaimToken === 'string' ? opts.input.queueClaimToken : undefined,
          continuationNonce: typeof opts.input?.queueContinuationNonce === 'string' ? opts.input.queueContinuationNonce : undefined,
          predecessorAttemptId: typeof opts.input?.queuePredecessorAttemptId === 'string' ? opts.input.queuePredecessorAttemptId : undefined,
          requestId: typeof opts.input?.requestId === 'string' ? opts.input.requestId : undefined,
        })).result;
        return null;
      } catch (e) {
        const conflict = e instanceof QueueClaimConflictError;
        return { status: conflict ? 409 : 503, payload: { error: conflict ? e.message : 'Queue coordination is temporarily unavailable. Please retry.', code: conflict ? 'QUEUE_CLAIM_CONFLICT' : 'QUEUE_STORE_UNAVAILABLE', retryable: true } };
      }
    },
    async queuedChatNeedsAdmission(): Promise<boolean> {
      const queue = await loadQueue(opts.workspaceId).catch(() => null);
      return !!opts.input?.queueItemId || !!opts.input?.queueContinuationNonce || queue?.items.some((i) => i.status === 'running' && i.prompt === opts.prompt().trim()) === true;
    },
    publish(obj: unknown, forward: (event: unknown) => void): void {
      if (publicationSealed) return; // The actual normal body closed this predecessor's publication authority.
      const event = obj as { type?: string; ok?: boolean; resumable?: boolean; planRemaining?: number } | null;
      if (binding && intermediate && event?.type === 'error') {
        invalidated = true;
        settlement = settlement.then(async () => { await cancelHandoff('The module window ended with an error before continuation retirement.'); });
      }
      if (event?.type === 'result' && typeof event.ok === 'boolean') outcome = event.ok ? 'complete' : 'failed';
      if (binding && !resultCaptured && event?.type === 'result' && typeof event.ok === 'boolean') {
        resultCaptured = true;
        if (event.resumable === true) {
          intermediate = true;
          const normalModule = event.ok === true && typeof event.planRemaining === 'number'
            && Number.isFinite(event.planRemaining) && event.planRemaining > 0;
          settlement = (async () => {
            if (!normalModule || opts.input?.queueContinuationProtocol !== 1 || invalidated) {
              const confirmed = await cancelHandoff('The queued step needs review before another module window.');
              pausedResult(obj, forward, confirmed);
              return;
            }
            const proposed = await proposeQueuedContinuation(opts.workspaceId, binding!, event.planRemaining!);
            handoff = proposed.result;
            if (invalidated) {
              const confirmed = await cancelHandoff('The module window ended before continuation retirement.');
              pausedResult(obj, forward, confirmed);
              return;
            }
            forward({ ...(obj as Record<string, unknown>), queueContinuation: {
              itemId: binding!.itemId, claimToken: binding!.claimToken, predecessorAttemptId: handoff.predecessorAttemptId,
              nonce: handoff.nonce, state: 'pending', planRemaining: handoff.planRemaining, ordinal: handoff.ordinal,
            } });
          })().catch(async () => {
            invalidated = true;
            const confirmed = await cancelHandoff('The queued continuation could not be confirmed. Review before continuing.');
            pausedResult(obj, forward, confirmed, true);
          });
          return;
        }
        const logicalOk = event.ok && !invalidated;
        let pauseConfirmed = false;
        settlement = settleQueuedBuild(opts.workspaceId, binding, logicalOk).then((result) => { pauseConfirmed = !logicalOk && result.result; }).catch(() => {
          forward({ type: 'narration', agent: 'system', text: 'Your build ended, but queue progress could not be saved. Refresh the queue before continuing.', ts: Date.now() });
        });
        if (event.ok && invalidated) {
          settlement = settlement.then(() => { pausedResult(obj, forward, pauseConfirmed); });
          return;
        }
      } else if (binding && event?.type === 'result' && typeof event.ok === 'boolean' && (intermediate || event.resumable === true)) {
        // A heartbeat/initializer release or an earlier terminal event cannot be escaped by a late result.
        invalidated = true;
        settlement = settlement.then(async () => {
          const confirmed = await cancelHandoff('A late module result cannot authorize another queued window.');
          pausedResult(obj, forward, confirmed);
        });
        return;
      }
      if (resultCaptured) void settlement.then(() => forward(obj));
      else forward(obj);
    },
    /** Deliver a captured terminal event before closing its stream, without retiring its receipt. */
    async flushPublication(): Promise<void> { await settlement; },
    /** Deadline provenance cannot turn an app/window success into logical queued-step completion. */
    invalidateQueuedWindow(): void {
      if (publicationSealed) return;
      invalidated = true;
      if (intermediate) settlement = settlement.then(async () => { await cancelHandoff('The queued window was interrupted before normal retirement.'); });
    },
    /** Called ONLY after actual normal-body cleanup, never by a heartbeat or generic resource release. */
    retireNormalModule(eligible: boolean | (() => boolean), closeDelivery?: () => Promise<boolean>, joinPublications?: () => Promise<boolean>): Promise<boolean> {
      if (retirement) return retirement;
      actualRetirementReached = true;
      retirement = Promise.resolve().then(async () => {
        const allowed = () => typeof eligible === 'function' ? eligible() : eligible;
        await settlement;
        if (!intermediate) return false;
        if (allowed() && !invalidated && handoff && joinPublications && !await joinPublications()) invalidated = true;
        await settlement; // A late error/result during the owned-publication join must settle before sealing.
        if (!allowed() || invalidated || !binding || !handoff) {
          invalidated = true;
          await cancelHandoff('The module did not reach a confirmed normal retirement. Review before continuing.');
          return false;
        }
        publicationSealed = true;
        if (closeDelivery && !await closeDelivery()) {
          invalidated = true;
          await cancelHandoff('The previous delivery cleanup could not be confirmed. Review before continuing.');
          return false;
        }
        if (!allowed()) {
          invalidated = true;
          await cancelHandoff('The module was stopped while its delivery was retiring. Review before continuing.');
          return false;
        }
        try {
          const retired = await retireQueuedContinuation(opts.workspaceId, binding, handoff.nonce);
          handoffRetired = retired.result;
        } catch { /* Unknown acknowledgement never grants local continuation permission. */ }
        if (!handoffRetired) {
          invalidated = true;
          await cancelHandoff('The module retirement could not be confirmed. Review before continuing.');
        }
        return handoffRetired;
      });
      return retirement;
    },
    async release(): Promise<void> {
      if (!actualRetirementReached) invalidated = true;
      if (binding && !resultCaptured) {
        resultCaptured = true;
        settlement = settleQueuedBuild(opts.workspaceId, binding, false, 'Build ended without a confirmed successful result.').then(() => undefined).catch(() => {});
      }
      await settlement;
      await retirement;
      if (intermediate && !handoffRetired) await cancelHandoff('The queued window stopped before its continuation was ready.');
      if (receipt && !receiptFinished) {
        receiptFinished = true;
        await completeBuildRequest(opts.store(), receipt, outcome);
      }
    },
    billingRef(legacyRef: string): string { return receipt?.buildRef ?? legacyRef; },
  };
}

interface PreflightResponse {
  headersSent: boolean; writableEnded: boolean;
  setHeader(name: string, value: string): unknown; flushHeaders(): unknown; write(value: string): unknown;
  status(status: number): { json(payload: unknown): unknown }; end(): unknown;
}
/** Preserve first-byte liveness during read-only preflight and honest streamed admission failures. */
export function createBuildPreflightStream(res: PreflightResponse, publish: (event: unknown, forward: (event: unknown) => void) => void) {
  let opened = false;
  const buffered: unknown[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { if (timer) clearTimeout(timer); timer = undefined; };
  const send = (event: unknown): void => {
    if (!opened) { buffered.push(event); return; }
    publish(event, (value) => { if (!res.writableEnded) res.write(JSON.stringify(value) + '\n'); });
  };
  const open = (): void => {
    cancel();
    if (opened) return;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders(); opened = true;
    for (const event of buffered.splice(0)) send(event);
  };
  return {
    send, open, cancel,
    arm(): void { timer = setTimeout(open, 1000); timer.unref?.(); },
    ping(): void { if (opened && !res.writableEnded) res.write(JSON.stringify({ type: 'ping' }) + '\n'); },
    reject(status: number, payload: Record<string, unknown>): void {
      if (!res.headersSent) { res.setHeader('Retry-After', '2'); res.status(status).json(payload); return; }
      if (!res.writableEnded) {
        res.write(JSON.stringify({ type: 'error', message: payload.error, code: payload.code, requestState: payload.requestState, retryable: payload.retryable === true }) + '\n');
        res.write(JSON.stringify({ type: 'result', ok: false, summary: payload.error, steps: 0, billedUsd: 0, billedInr: 0 }) + '\n');
        res.end();
      }
    },
  };
}

/** A rejected/throwing preflight or initializer must release accepted identities as well as a full build. */
export function withBuildRequestCleanup(handler: (req: Request, res: Response, register: (cleanup: () => Promise<void>) => void) => Promise<unknown>): RequestHandler {
  return async (req, res) => {
    let cleanup: (() => Promise<void>) | undefined;
    try { await handler(req, res, (value) => { cleanup = value; }); }
    finally { await cleanup?.(); }
  };
}

/** Existing lease heartbeat lifecycle, independent of runtime location and source-store behavior. */
export function startBuildLeaseHeartbeat(opts: {
  store: BuildLeaseStore | null; workspaceId: string; token: string; admittedAt: number;
  build: () => RunningBuild | null; current: () => RunningBuild | undefined; active: () => boolean;
  release: () => Promise<void>; lost: () => void;
}): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    void (async () => {
      const build = opts.build();
      if (build) {
        const holder = opts.current();
        if (!hasBuildBodyExitHold(build)) {
          if (build.exited || (holder !== undefined && holder !== build)) { await opts.release(); return; }
          if (!build.ended && holder !== build) { await opts.release(); return; }
        }
      } else if (!opts.active() || Date.now() - opts.admittedAt > 5 * 60_000) {
        await opts.release(); return;
      }
      const heartbeatAt = Date.now();
      const renewal = await renewWorkspaceBuild(opts.store, { workspaceId: opts.workspaceId, token: opts.token, nowMs: heartbeatAt });
      if (renewal === 'unknown' && build && !build.exited) {
        // An unavailable store is not permission to keep building until another worker takes over.
        // Abort cooperatively, but retain the local/body hold and keep trying to renew: an abort
        // signal does not prove an already-dispatched sandbox command has actually stopped.
        build.requiresBodyExit = true;
        abortBuild(build.abort, 'authority-unavailable');
      } else if (renewal === 'stop-requested' && build && !build.ended) abortBuild(build.abort, 'user-stop');
      else if (renewal === 'lost') {
        if (build && !build.ended) abortBuild(build.abort, 'lock-reclaimed');
        opts.lost();
        // Lost authority is not body-exit proof. Its receipt/local hold still retires in real finally.
        if (!hasBuildBodyExitHold(build)) await opts.release();
      }
    })().catch(() => { /* Unreachable ownership stays uncertain; no local success acknowledgement. */ });
  }, LEASE_HEARTBEAT_MS);
  timer.unref?.();
  return timer;
}
