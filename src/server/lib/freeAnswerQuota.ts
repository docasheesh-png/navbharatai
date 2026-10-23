import { runWithFreeAnswerContext } from './freeAnswerQuotaContext';
/** User answer credits are independent from provider usage, money holds and routing. */
import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken, rateLimiter } from './authMiddleware';
import { addressRateKey } from './clientAddress';
import { GUEST_ID_HEADER, readGuestId } from './guestDailyQuota';
import { FreeAnswerQuotaStore, type FreeAnswerQuotaSubject } from './freeAnswerQuotaStore';
import { getServerDb } from './serverDb';
import { unifiedWalletConfig, dailyAllowance, detectLang, insufficientBalanceMessage, lowBalanceNotice, rateLimitedMessage } from './unifiedWallet/policy';
import { UnifiedWalletGate, holdChatMessage, finishChatMessage } from './unifiedWallet/store';

const leases = new WeakMap<Request, { controller: AbortController; leaseUntil: number; answered: boolean; failed: boolean; disconnected: boolean }>();
const codes: Record<string, string> = { 'daily-limit': 'DAILY_LIMIT', busy: 'BUSY', duplicate: 'DUPLICATE', 'attempt-limit': 'ATTEMPT_LIMIT' };
const messages: Record<string, string> = {
  'daily-limit': 'Your shared Free answers are used up for today. They reset at 12:00 AM IST.',
  busy: 'An answer is already being generated for you. Please wait for it to finish.',
  duplicate: 'This request has already been accepted. Check your conversation before sending a new message.',
  'attempt-limit': 'Too many Free answer attempts today. Please try again after 12:00 AM IST.',
  unavailable: 'Free answer limits could not be verified. Please try again shortly.',
};
function reject(res: Response, reason: string): void {
  if (res.headersSent || res.destroyed || res.writableEnded) return;
  res.status(reason === 'unavailable' ? 503 : 429).json({ code: `FREE_ANSWER_${codes[reason] ?? 'UNAVAILABLE'}`, error: messages[reason] ?? messages.unavailable, reply: messages[reason] ?? messages.unavailable });
}
async function subjectFor(req: Request, options: {uid?: string | null}): Promise<FreeAnswerQuotaSubject> {
  const uid = Object.prototype.hasOwnProperty.call(options, 'uid') ? options.uid : await verifyFirebaseToken(req);
  const cfg = unifiedWalletConfig();
  if (uid) {
    // Flag OFF: exactly main's 20. Flag ON: the owner's signed-in allowance (25, config).
    if (!cfg.enabled) return {key: `user:${uid}`, limit:20};
    return {key: `user:${uid}`, limit: dailyAllowance(cfg, {signedIn:true})};
  }
  const ip = addressRateKey(req);
  const device = readGuestId(req.headers[GUEST_ID_HEADER]);
  return {key: device ? `guest-device:${device}` : `guest-address:${ip}`, ...(cfg.enabled ? {limit: cfg.guestDailyMessages, guest: true} : {limit: 5}), ipKey:ip};
}
export function freeAnswerSignal(req: Request): AbortSignal | undefined { return leases.get(req)?.controller.signal; }
export function assertFreeAnswerActive(req: Request): void {
  const lease = leases.get(req);
  if (!lease) return;
  if (lease.controller.signal.aborted || Date.now() >= lease.leaseUntil) { lease.controller.abort(); throw new Error('Free answer reservation is no longer active'); }
}
/** Call only for actual successful output, never synthetic busy/error notices. */
export function markFreeAnswer(req: Request): void { assertFreeAnswerActive(req); const lease=leases.get(req); if (lease) lease.answered=true; }
/** A proven no-output provider failure can refund even after a disconnect. */
export function markFreeAnswerProviderFailure(req: Request): void { const lease=leases.get(req); if (lease && !lease.answered) lease.failed=true; }

export async function withFreeAnswerQuota<T>(req: Request, res: Response, run: () => Promise<T>, options: {uid?: string | null} = {}): Promise<T | void> {
  // Internal nested wrappers reuse the exact live request, never a client-supplied proof.
  if (leases.has(req)) { assertFreeAnswerActive(req); return run(); }
  const store = new FreeAnswerQuotaStore();
  const controller = new AbortController();
  let disconnected=false;
  const close=()=>{if (!res.writableFinished) {disconnected=true; controller.abort(); const lease=leases.get(req); if(lease) lease.disconnected=true;}};
  res.once('close',close);
  try {
    const subject=await subjectFor(req,options);
    if (disconnected || res.destroyed || res.writableEnded) return;
    const header=req.headers['x-nb-answer-request'];
    // Invalid or absent ids never provide a replay grant. Legacy clients get a fresh server id.
    const requestId=typeof header==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(header) ? header : randomUUID();
    const cfg=unifiedWalletConfig();
    const lang=detectLang((req.body as any)?.message ?? (req.body as any)?.prompt);
    if (cfg.enabled) {
      // Per-minute abuse gate + once-only request id, BEFORE any allowance or money is touched.
      const gate=await new UnifiedWalletGate().admit(subject.key,requestId,subject.guest?cfg.perMinuteGuest:cfg.perMinuteSignedIn,Date.now());
      if (!gate.ok) {
        if (gate.reason==='rate-limited') { if (!res.headersSent) res.status(429).json({code:'FREE_ANSWER_RATE_LIMIT',error:rateLimitedMessage(lang),reply:rateLimitedMessage(lang)}); return; }
        reject(res,'duplicate'); return;
      }
    }
    const reserved=await store.reserve(subject,requestId,Date.now());
    if (!reserved.allowed) {
      // UNIFIED WALLET: a signed-in user past today's free messages pays 0.1 credit from the ONE wallet
      // that also pays for Pro builds. Guests have no wallet — they get main's refusal.
      if (cfg.enabled && reserved.reason==='daily-limit' && subject.key.startsWith('user:')) {
        return await runWalletPaidTurn(req,res,run,subject.key.slice(5),requestId,lang,controller,()=>disconnected);
      }
      reject(res,reserved.reason); return;
    }
    const lease={controller,leaseUntil:reserved.reservation.leaseExpiresAt,answered:false,failed:false,disconnected};
    leases.set(req,lease);
    let renewing=false;
    let finished=false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const armExpiry=()=>{clearTimeout(expiryTimer); expiryTimer=setTimeout(()=>controller.abort(),Math.max(0,lease.leaseUntil-Date.now()));};
    armExpiry();
    const renewTimer=setInterval(()=>{
      if(renewing || controller.signal.aborted) return;
      renewing=true;
      const renewStartedAt=Date.now();
      void store.renew(reserved.reservation,renewStartedAt).then(ok=>{
        if (finished) return;
        const expiresAt=Math.min(renewStartedAt+30_000,reserved.reservation.deadlineAt);
        if(!ok || Date.now()>=expiresAt) controller.abort(); else {lease.leaseUntil=expiresAt; armExpiry();}
      }).catch(()=>controller.abort()).finally(()=>{renewing=false;});
    },10_000);
    const deadlineTimer=setTimeout(()=>controller.abort(),Math.max(0,reserved.reservation.deadlineAt-Date.now()));
    try { assertFreeAnswerActive(req); return await runWithFreeAnswerContext({ signal:controller.signal, assertActive:()=>{if (finished || controller.signal.aborted || Date.now()>=lease.leaseUntil) {controller.abort(); throw new Error('Free answer reservation expired');}} },run); }
    finally {
      finished=true;
      clearInterval(renewTimer); clearTimeout(deadlineTimer); clearTimeout(expiryTimer);
      // No timeout refund: uncertainty is still consumed; expired owners cannot affect successors.
      const outcome=lease.answered ? 'answered' : lease.failed || (!lease.disconnected && !controller.signal.aborted) ? 'provider-failed' : 'uncertain';
      try {await store.settle(reserved.reservation,outcome,Date.now());} catch {console.warn('[FREE ANSWERS] settlement unavailable; reservation retained');}
      leases.delete(req);
    }
  } catch(error) {
    reject(res,'unavailable');
    // The route owns its error detail. This boundary never switches to a paid handler.
    if(res.headersSent && !res.writableEnded && !res.destroyed) res.end();
  } finally {res.removeListener('close',close);}
}

/** One Free chat turn paid from the unified wallet: hold → run → settle, or release on a proven no-output failure. */
async function runWalletPaidTurn<T>(req: Request, res: Response, run: () => Promise<T>, uid: string, requestId: string, lang: ReturnType<typeof detectLang>, controller: AbortController, isDisconnected: () => boolean): Promise<T | void> {
  const cfg=unifiedWalletConfig();
  const db=getServerDb();
  const held=await holdChatMessage(db,uid,requestId,cfg);
  if (!held.ok) {
    if (held.insufficient) { if (!res.headersSent) res.status(402).json({code:'WALLET_INSUFFICIENT',error:insufficientBalanceMessage(lang,cfg),reply:insufficientBalanceMessage(lang,cfg),minRechargeInr:cfg.minRechargeInr}); return; }
    reject(res,'unavailable'); return;
  }
  const notice=lowBalanceNotice(lang,held.charge.balanceTokens,cfg);
  if (notice && !res.headersSent) res.setHeader('X-NB-Wallet-Notice',encodeURIComponent(notice));
  const lease={controller,leaseUntil:Date.now()+90_000,answered:false,failed:false,disconnected:isDisconnected()};
  leases.set(req,lease);
  const timer=setTimeout(()=>controller.abort(),90_000);
  let finished=false;
  try {
    return await runWithFreeAnswerContext({signal:controller.signal,assertActive:()=>{if(finished||controller.signal.aborted){controller.abort();throw new Error('Paid Free answer expired');}}},run);
  } finally {
    finished=true; clearTimeout(timer);
    const outcome=lease.answered ? 'answered' : lease.failed || (!lease.disconnected && !controller.signal.aborted) ? 'provider-failed' : 'uncertain';
    try { await finishChatMessage(db,uid,held.charge,outcome); } catch { console.warn('[UNIFIED WALLET] settle/release unavailable; hold retained'); }
    leases.delete(req);
  }
}

export function registerFreeAnswerQuotaRoutes(app: Express): void {
  app.get('/api/free-answers/status',rateLimiter({name:'free-answer-status',authed:1200,anon:600,noun:'status checks',durable:false}),async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try { const subject=await subjectFor(req,{}); const status=await new FreeAnswerQuotaStore().status(subject,Date.now()); res.json(status); }
    catch {reject(res,'unavailable');}
  });
}
