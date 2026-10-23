import { persistFreeChainSample } from './eventSample';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { parseEnvFlag } from '../../lib/envFlag';
import { verifyFirebaseToken } from '../../lib/authMiddleware';
import { CHAT_MAX_MESSAGE_CHARS } from '../../lib/chatInputLimits';
import { getServerDb, type Firestore } from '../../lib/serverDb';
import { strictFreeRequired } from '../inferencePolicy';
import { freeChainConfig } from './config';
import { readControlsForSelection } from './control';
import { logFreeChain } from './telemetry';
import { rolloutBucket, selectedForFreeChain } from './rollout';
import { freeChainAdmissionQueue } from './admissionQueue';

export interface EntryAdmissionGrant { readonly uid: string; readonly waitedMs: number; readonly signal: AbortSignal }
const heldByRequest = new WeakMap<Request, EntryAdmissionGrant>();
const activeGrants = new WeakSet<object>();
/** Only the wrapper can issue a live grant. A body field or structurally identical object cannot. */
export function isEntryAdmission(grant: unknown, uid: string): grant is EntryAdmissionGrant {
  return !!grant && typeof grant === 'object' && activeGrants.has(grant) && (grant as EntryAdmissionGrant).uid === uid;
}
export function entryAdmissionFor(req: Request): EntryAdmissionGrant | undefined {
  const grant = heldByRequest.get(req);
  return grant && isEntryAdmission(grant, grant.uid) ? grant : undefined;
}
const BUSY = 'The AI service is temporarily busy. Please try again in 1-2 minutes. 🙏';
function busy(req: Request, res: Response): void {
  if (res.destroyed || res.writableEnded) return;
  if (req.body?.stream === true) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
    }
    res.write(`data: ${JSON.stringify({ c: BUSY })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } else res.json({ reply: BUSY });
}
/**
 * Protect expensive ordinary FREE-chat prompt assembly, not just the final provider call.
 * OFF, strict-free, attachment, anonymous and unselected paths retain the original handler.
 * This is local load admission only. Runtime still verifies policy and distributed quota at dispatch.
 */
export async function withFreeChainEntryAdmission<T>(req: Request, res: Response, handler: () => Promise<T>): Promise<T | void> {
  if (parseEnvFlag(process.env.FREE_CHAIN_ENABLED) !== true || strictFreeRequired()) return handler();
  const body = req.body;
  // Leave validation errors and every attachment/vision path to their existing handler. Do not
  // perform history cleaning or prompt assembly before the bounded local admission gate.
  if (!body || typeof body.message !== 'string' || !body.message || body.message.length > CHAT_MAX_MESSAGE_CHARS
    || (Array.isArray(body.fileAttachments) && body.fileAttachments.length > 0)) return handler();
  if (res.destroyed || res.writableEnded) return;
  const controller = new AbortController();
  const closed = () => { if (!res.writableFinished) controller.abort(); };
  res.once('close', closed);
  try {
    const uid = await verifyFirebaseToken(req).catch(() => null);
    if (controller.signal.aborted) return;
    if (!uid) return handler();
    let usageDb: Firestore | null = null;
    const decline = (reason: 'capacity' | 'queue-full' | 'timeout' | 'aborted' | 'user-limit', waitedMs = 0) => {
      const freeChain = { requestId: randomUUID(), rung: null, provider: 'NONE', model: 'none', attempts: [], fallbacks: 0,
        cacheHit: false, costUsdEstimate: null, ttftMs: null, latencyMs: waitedMs, rolloutBucket: rolloutBucket(uid),
        admissionReason: reason, queueWaitMs: waitedMs };
      logFreeChain(freeChain);
      if (usageDb) void persistFreeChainSample(usageDb, freeChain, false);
      // Preserve the unsampled per-turn ledger even when rejection precedes chatHandler.
      // No provider was dispatched: absent tokens/cost are deliberate, not invented zeros.
      try {
        void usageDb?.collection('ai_usage_logs').add({
          userId: uid, tier: 'navbharat', streamed: body.stream === true,
          providerName: 'NONE', modelName: 'none', usageMeasured: false, ok: false, failureReason: reason, latencyMs: waitedMs,
          freeChain, createdAt: new Date().toISOString(),
        }).catch(() => {});
      } catch { /* Observability must not turn an honest busy response into an exception. */ }
      if (reason !== 'aborted') busy(req, res);
    };
    usageDb = getServerDb();
    const cfg = freeChainConfig();
    if (!cfg.enabled || cfg.errors.length) { decline('capacity'); return; }
    const db = usageDb;
    if (!db) { decline('capacity'); return; }
    const control = await readControlsForSelection(db, cfg).catch(() => null);
    if (controller.signal.aborted) return;
    if (!control) { decline('capacity'); return; }
    if (!selectedForFreeChain(cfg, control, uid)) return handler();
    const admission = await freeChainAdmissionQueue.acquire({ uid, signal: controller.signal, ...cfg.queue });
    if (!admission.admitted) { decline(admission.reason, admission.waitedMs); return; }
    try {
      // An admitted turn must not slip into a paid legacy path after waiting through a policy change.
      if (controller.signal.aborted) return;
      const current = freeChainConfig();
      if (!current.enabled || current.errors.length || strictFreeRequired()) { decline('capacity', admission.waitedMs); return; }
      const grant: EntryAdmissionGrant = Object.freeze({ uid, waitedMs: admission.waitedMs, signal: controller.signal });
      heldByRequest.set(req, grant); activeGrants.add(grant);
      try { return await handler(); }
      finally { activeGrants.delete(grant); heldByRequest.delete(req); }
    } finally { admission.release(); }
  } finally { res.removeListener('close', closed); }
}
