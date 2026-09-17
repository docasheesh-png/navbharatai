// THE NAVBHARATAI API, v1 — the three doors a key opens beyond `/me`.
//
// Every decision behind these routes is written down in `lib/developerApi.ts` (why the shape is
// OpenAI's, why the cap is the real defence, why the response never names a vendor) and is not
// repeated here. This file is the I/O that pure core deliberately refused to own.
//
//   GET  /api/v1/usage             read:usage   — wallet balance + this month's builds and spend
//   GET  /api/v1/builds            read:builds  — the holder's apps, with live links where published
//   POST /api/v1/chat/completions  ai:chat      — NavBharatAI's AI, on the holder's wallet, capped per key
//
// Registered UNVERSIONED (`/api/usage`, …): `apiVersionMiddleware` rewrites the canonical `/api/v1/…`
// path onto these before routing, exactly as it does for `/api/me`.
//
// 🔴 THE CHAT ROUTE SPENDS A REAL WALLET FOR A CALLER WHO IS NOT IN THE APP. So the order below is
// deliberate and cheap-first: scope, request shape, safety triage, the key's own cap, the wallet —
// every refusal that costs nothing happens before a single provider is called, and the charge lands
// AFTER the answer is out, exactly like every other assistant on the platform.

import type { Express, Request, Response } from 'express';
import * as admin from 'firebase-admin';
import { rateLimiter } from '../lib/authMiddleware';
import { apiKeyAuth, requireScope, apiAuthOf } from './apiKeys';
import {
  readChatCompletionRequest, foldMessagesToPrompt, DEVELOPER_API_SYSTEM_PROMPT, keyDecision,
  refusalMessage, refusalStatus, chatCompletionResponse, apiError, takeRateSlot, keyDayKey,
  normalizeDailyCapInr, type RateWindow,
} from '../lib/developerApi';
import { apiKeyUsageStore } from '../lib/ApiKeyUsageStore';
import { userCostStore } from '../lib/UserCostStore';
import { triagePrompt, safetyExcerpt, blockMessage } from '../lib/promptSafety';
import { buildSafetyFlag, recordSafetyFlag } from '../lib/safetyFlagStore';
import { audit } from '../lib/audit';
import { callProfessionalAIWithUsage } from '../lib/professionalRouting';
import { collectAiSpend } from '../lib/aiSpendZone';
import { chargeForAiTurns } from '../lib/aiTurnCharge';
import { chatTurnCost, sumChatTurnCosts } from '../lib/chatSpend';
import { usdInrRate } from '../lib/UsdInrRate';
import { getServerDb } from '../lib/serverDb';
import { readWalletBalanceInr, firestoreWalletReader } from '../AgentV3/WalletBalance';
import { isAgentV3FreeUser } from '../AgentV3/featureFlag';
import { getConversationStore } from './agentv3';
import { deploymentStore, isLiveDeployment, type DeploymentRecord } from '../AgentV3/DeploymentStore';
import { effectiveAppName } from '../AgentV3/appName';

/**
 * The holder's email, for the free-list courtesy — the list holds addresses, and a key carries only a
 * uid. Best-effort and cached: a lookup that fails means "not free-listed", which is the safe side
 * (a paying answer we could have waived costs pennies; a waived answer we should have charged is a
 * leak).
 */
const emailCache = new Map<string, { email: string | null; at: number }>();
const EMAIL_CACHE_MS = 10 * 60 * 1000;
async function emailForUid(uid: string): Promise<string | null> {
  const hit = emailCache.get(uid);
  if (hit && Date.now() - hit.at < EMAIL_CACHE_MS) return hit.email;
  let email: string | null = null;
  try {
    if (!process.env.VITEST) {
      if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
      const u = await admin.auth().getUser(uid);
      email = u.email ?? null;
    }
  } catch { email = null; }
  emailCache.set(uid, { email, at: Date.now() });
  return email;
}

/** Per-key request windows, per instance. Bounded by pruning; the ₹ cap is the durable defence. */
const rateWindows = new Map<string, RateWindow>();
function keyAllowedNow(keyId: string, nowMs: number): boolean {
  if (rateWindows.size > 5000) {
    for (const [k, w] of rateWindows) if (nowMs - w.windowStartMs > 60_000) rateWindows.delete(k);
  }
  const { next, allowed } = takeRateSlot(rateWindows.get(keyId), nowMs);
  rateWindows.set(keyId, next);
  return allowed;
}

export function registerDeveloperApiRoutes(app: Express): void {
  // Per-IP, in memory — a key carries no Firebase token, so the shared limiter keys by address. It
  // bounds the shape of abuse a ₹ cap cannot see (a flood of free-model calls). `durable: false` for
  // the same reason the app gateway chose it: a Firestore write per call would cost more than the call.
  const ipLimiter = rateLimiter({ name: 'devapi', authed: 1200, anon: 1200, noun: 'requests', durable: false, anonGlobalPerHour: 100_000 });

  // ── read:usage ──────────────────────────────────────────────────────────────────────────────
  app.get('/api/usage', ipLimiter, apiKeyAuth, requireScope('read:usage'), async (req: Request, res: Response) => {
    const auth = apiAuthOf(req);
    const [balance, month] = await Promise.all([
      readWalletBalanceInr(firestoreWalletReader(getServerDb() as any), auth.userId).catch(() => null),
      userCostStore.get(auth.userId).catch(() => null),
    ]);
    const now = new Date();
    res.json({
      // `null` means the balance could not be read right now — never a made-up zero.
      walletBalanceInr: balance === null ? null : Math.round(balance * 100) / 100,
      month: {
        month: month?.month ?? now.toISOString().slice(0, 7),
        builds: month?.totalBuilds ?? 0,
        spendUsd: month?.totalCostUsd ?? 0,
      },
    });
  });

  // ── read:builds ─────────────────────────────────────────────────────────────────────────────
  app.get('/api/builds', ipLimiter, apiKeyAuth, requireScope('read:builds'), async (req: Request, res: Response) => {
    const auth = apiAuthOf(req);
    try {
      const list = await getConversationStore().listByUser(auth.userId, 50);
      const deployments = await Promise.race([
        deploymentStore.getMany(list.map((c) => c.workspaceId)),
        new Promise<Map<string, DeploymentRecord>>((resolve) => setTimeout(() => resolve(new Map()), 3_000)),
      ]).catch(() => new Map<string, DeploymentRecord>());
      res.json({
        builds: list.map((c) => {
          const dep = c.workspaceId ? deployments.get(c.workspaceId) : undefined;
          const live = isLiveDeployment(dep);
          return {
            id: c.id,
            name: effectiveAppName(c),
            status: c.status,
            workspaceId: c.workspaceId,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            live,
            ...(live ? { liveUrl: dep!.url } : {}),
          };
        }),
      });
    } catch (err) {
      res.status(500).json(apiError('engine_unavailable', 'Could not list your builds right now. Please try again.'));
      void err;
    }
  });

  // ── ai:chat ─────────────────────────────────────────────────────────────────────────────────
  app.post('/api/chat/completions', ipLimiter, apiKeyAuth, requireScope('ai:chat'), async (req: Request, res: Response) => {
    const auth = apiAuthOf(req);
    const now = Date.now();
    if (!keyAllowedNow(auth.keyId, now)) {
      res.status(429).json(apiError('rate_limited', 'Too many requests on this key. Please slow down to under 60 per minute.'));
      return;
    }

    const request = readChatCompletionRequest(req.body);
    if (!request.ok) {
      const why: Record<typeof request.reason, string> = {
        'no-messages': 'Send `messages: [{ role, content }]` (or a `prompt` string).',
        'bad-message': 'Each message needs a role of user, assistant or system, and string content.',
        'too-many': 'Too many messages in one request. Send at most 40.',
        'too-long': 'This conversation is too long for one request. Send less history.',
        'no-user-turn': 'The last message must be from the user, and it must not be empty.',
      };
      res.status(400).json(apiError('invalid_request', why[request.reason]));
      return;
    }

    // SAFETY TRIAGE — the same three-way check the build and chat routes run, for the same reason: a
    // banned request is refused before a token is spent, whoever is asking and however they ask.
    const lastUser = request.messages[request.messages.length - 1].content;
    try {
      const triage = triagePrompt(lastUser);
      if (triage.verdict !== 'allow') {
        audit(triage.verdict === 'block' ? 'PROMPT_BLOCKED' : 'PROMPT_FLAGGED',
          { uid: auth.userId, rule: triage.ruleId, class: triage.contentClass, tier: 'api' }, 'warn');
        void recordSafetyFlag(buildSafetyFlag({
          uid: auth.userId, triage, surface: 'chat', excerpt: safetyExcerpt(lastUser), at: now,
        })).catch(() => { /* the decision stands either way */ });
        if (triage.verdict === 'block') {
          res.status(422).json(apiError('content_policy', blockMessage(triage.contentClass, lastUser)));
          return;
        }
      }
    } catch (e) {
      console.error('[DEVAPI] safety triage unavailable — allowing the turn:', e);
    }

    // THE CAP, THEN THE WALLET — see `keyDecision`. Both reads in one round trip.
    const day = keyDayKey(now);
    const capInr = normalizeDailyCapInr(auth.dailyCapInr);
    const [spent, balance, email] = await Promise.all([
      apiKeyUsageStore.spentToday(auth.keyId, day),
      readWalletBalanceInr(firestoreWalletReader(getServerDb() as any), auth.userId).catch(() => null),
      emailForUid(auth.userId),
    ]);
    const freeListed = isAgentV3FreeUser(auth.userId, email);
    const decision = keyDecision({ spentTodayInr: spent.spentInr, capInr, walletBalanceInr: balance, freeListed });
    if (!decision.allow) {
      res.status(refusalStatus(decision.reason)).json(apiError(
        decision.reason === 'key-cap' ? 'daily_cap_reached' : 'insufficient_balance',
        refusalMessage(decision.reason, capInr),
        decision.reason === 'key-cap' ? { dailyCapInr: capInr, spentTodayInr: Math.round(spent.spentInr * 100) / 100 } : {},
      ));
      return;
    }
    if (!spent.known) {
      console.warn(`[DEVAPI] key ${auth.keyId}: spend counter unreadable — this call was allowed without a cap check.`);
    }

    const system = request.system ? `${DEVELOPER_API_SYSTEM_PROMPT}\n\n${request.system}` : DEVELOPER_API_SYSTEM_PROMPT;
    const run = await collectAiSpend(() => callProfessionalAIWithUsage(system, foldMessagesToPrompt(request.messages), 'free'));
    if (!run.ok) {
      // Every provider failed. The developer gets branded wording; the reason stays on our side.
      console.error(`[DEVAPI] key ${auth.keyId}: the assistant chain failed:`, run.error);
      res.status(503).json(apiError('engine_unavailable', 'NavBharatAI could not answer right now. Please try again in a moment.'));
      return;
    }

    const last = run.spend[run.spend.length - 1];
    res.status(200).json(chatCompletionResponse(run.result.content, {
      id: `${auth.keyId}-${now.toString(36)}`,
      createdMs: now,
      usage: last ? { inputTokens: last.inputTokens, outputTokens: last.outputTokens } : null,
    }));

    // ── Money, AFTER the answer is out ──────────────────────────────────────────────────────
    const usdInr = usdInrRate();
    const cost = sumChatTurnCosts(run.spend.map((u) => chatTurnCost(u, usdInr)), usdInr);
    // The COUNTER moves on what the turn cost, not on what was debited — so the cap keeps biting on a
    // free-listed account and while the wallet switch is off, exactly like the app gateway's counter.
    void apiKeyUsageStore.record(auth.keyId, day, cost.billedInr);
    void chargeForAiTurns(
      getServerDb() as any,
      // The free list is honoured (admin/test accounts). A Professional Pass is deliberately NOT:
      // it pays for the holder's own assistant use inside the app, and a key's traffic may be an
      // unbounded number of THEIR users — the same reasoning the app gateway records.
      { userId: auth.userId, feature: 'api', isFreeListed: freeListed },
      run.spend,
      usdInr,
      now,
    );
  });
}
