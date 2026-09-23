// THE NAVBHARATAI API, v1 — the three doors a key opens beyond `/me`.
//
// Every decision behind these routes is written down in `lib/developerApi.ts` (why the shape is
// OpenAI's, why the cap is the real defence, why the response never names a vendor) and is not
// repeated here. This file is the I/O that pure core deliberately refused to own.
//
//   GET  /api/v1/usage                     read:usage        — wallet balance + this month's builds and spend
//   GET  /api/v1/builds                    read:builds       — the holder's apps, with live links where published
//   POST /api/v1/chat/completions          ai:chat           — NavBharatAI's AI, on the holder's wallet, capped per key
//   POST /api/v1/professionals/:id/chat    ai:professionals  — ask one of the ~80 expert AIs by id
//   GET  /api/v1/models                    (any valid key)   — so `client.models.list()` works
//   GET  /api/v1/key                       (any valid key)   — what THIS key may do, and what it spent today
//
// 🔑 TWO ROUTES HAVE NO SCOPE OF THEIR OWN, deliberately. `/models` and `/key` disclose nothing but
// what the caller already holds — the names it may address, and the key's own limits. Scope-gating a
// key's description of ITSELF would mean a developer debugging a 403 has to leave their terminal to
// find out why, which is the one moment this API can save them.
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
  normalizeDailyCapInr, professionalIdFromModel, professionalModelName, PUBLIC_MODEL_NAME,
  wantsStream, wantsStreamUsage, chatCompletionStream,
  type RateWindow, type ChatMessage,
} from '../lib/developerApi';
import { hasScope, effectiveScopes, FULL_ACCESS_SCOPE } from '../lib/ApiKeyManager';
import { getProfessional, listProfessionals } from '../professionals/registry';
import { runProfessionalChatWithUsage } from '../professionals/engine';
import { routeParam } from '../lib/expressCompat';
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

/**
 * 🔒 THE SPEND GATE — every door that can cost money passes through exactly this, in this order.
 *
 * One gate for every door that spends the wallet — chat and the expert doors — so "rate slot, triage,
 * cap, wallet" cannot drift between them, and a banned prompt is refused before a token is spent,
 * whoever is asking and however they ask, on doors nobody has written yet too.
 *
 * Order is cheap-first on purpose: every refusal that costs nothing happens before a provider is
 * called. Returns `null` having ALREADY responded when the caller may not proceed.
 *
 * ⚠️ A chat answer's price is unknown until it exists, so the cap is checked as "have you already
 * reached it?".
 */
async function spendGate(
  res: Response,
  auth: { userId: string; keyId: string; dailyCapInr?: number },
  now: number,
  words: string,
): Promise<{ capInr: number; freeListed: boolean } | null> {
  if (!keyAllowedNow(auth.keyId, now)) {
    res.status(429).json(apiError('rate_limited', 'Too many requests on this key. Please slow down to under 60 per minute.'));
    return null;
  }

  // SAFETY TRIAGE — the same three-way check the build and chat routes run, for the same reason: a
  // banned request is refused before a token is spent, whoever is asking and however they ask.
  try {
    const triage = triagePrompt(words);
    if (triage.verdict !== 'allow') {
      audit(triage.verdict === 'block' ? 'PROMPT_BLOCKED' : 'PROMPT_FLAGGED',
        { uid: auth.userId, rule: triage.ruleId, class: triage.contentClass, tier: 'api' }, 'warn');
      void recordSafetyFlag(buildSafetyFlag({
        uid: auth.userId, triage, surface: 'chat', excerpt: safetyExcerpt(words), at: now,
      })).catch(() => { /* the decision stands either way */ });
      if (triage.verdict === 'block') {
        res.status(422).json(apiError('content_policy', blockMessage(triage.contentClass, words)));
        return null;
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
  const decision = keyDecision({
    spentTodayInr: spent.spentInr,
    capInr,
    walletBalanceInr: balance,
    freeListed,
  });
  if (!decision.allow) {
    res.status(refusalStatus(decision.reason)).json(apiError(
      decision.reason === 'key-cap' ? 'daily_cap_reached' : 'insufficient_balance',
      refusalMessage(decision.reason, capInr),
      decision.reason === 'key-cap'
        ? { dailyCapInr: capInr, spentTodayInr: Math.round(spent.spentInr * 100) / 100 }
        : {},
    ));
    return null;
  }
  if (!spent.known) {
    console.warn(`[DEVAPI] key ${auth.keyId}: spend counter unreadable — this call was allowed without a cap check.`);
  }
  return { capInr, freeListed };
}

/**
 * Settle one AI turn for a key. Shared by `/chat/completions` and the expert doors, so the money half
 * cannot differ between them: the counter moves on what the turn COST, the wallet is charged AFTER
 * the answer is out, and a free-listed account is honoured while a Professional Pass deliberately is
 * not (it pays for the holder's own use in the app, not for an unbounded number of THEIR users).
 */
function settleKeyTurn(
  auth: { userId: string; keyId: string },
  now: number,
  freeListed: boolean,
  spend: Parameters<typeof chargeForAiTurns>[2],
): void {
  const usdInr = usdInrRate();
  const cost = sumChatTurnCosts(spend.map((u) => chatTurnCost(u, usdInr)), usdInr);
  void apiKeyUsageStore.record(auth.keyId, keyDayKey(now), cost.billedInr);
  void chargeForAiTurns(
    getServerDb() as any,
    { userId: auth.userId, feature: 'api', isFreeListed: freeListed },
    spend,
    usdInr,
    now,
  );
}

/** How the caller asked to receive the answer. Read once per request, from the raw body. */
interface StreamChoice { on: boolean; includeUsage: boolean }

function streamChoiceOf(body: unknown): StreamChoice {
  return { on: wantsStream(body), includeUsage: wantsStreamUsage(body) };
}

/**
 * Write one finished answer, in whichever format the caller asked for. Shared by BOTH chat doors, so
 * the plain assistant and the experts cannot drift in how they answer a streaming client.
 *
 * ⚠️ Every refusal (400/402/403/422/429/503) is sent BEFORE this, as ordinary JSON with its status —
 * which is what a standard SDK expects: it reads the status first and only then decides whether a
 * body is an event stream. This function is reached only with an answer in hand.
 */
function sendCompletion(
  res: Response,
  content: string,
  opts: {
    id: string;
    createdMs: number;
    model: string;
    usage: { inputTokens?: number; outputTokens?: number } | null;
    stream: StreamChoice;
  },
): void {
  if (opts.stream.on) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    for (const event of chatCompletionStream(content, {
      id: opts.id, createdMs: opts.createdMs, model: opts.model,
      includeUsage: opts.stream.includeUsage, usage: opts.usage,
    })) res.write(event);
    res.end();
    return;
  }
  res.status(200).json({
    ...chatCompletionResponse(content, { id: opts.id, createdMs: opts.createdMs, usage: opts.usage }),
    model: opts.model,
  });
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

    const request = readChatCompletionRequest(req.body);
    if (!request.ok) {
      res.status(400).json(apiError('invalid_request', chatRequestHelp(request.reason)));
      return;
    }

    // 🧑‍🏫 `model: "navbharatai/teacher_ai"` addresses an EXPERT through the standard endpoint, because
    // that is how every chat-completions client already selects a model — a developer holding an SDK
    // reaches all of them without writing a second HTTP call. It is the SAME handler as the plain door
    // below, so the two entry points cannot drift.
    //
    // 🔒 It needs the expert scope AS WELL as `ai:chat`. A key granted only "NavBharatAI's AI" chose
    // the general assistant; quietly letting a model name reach a different persona would make the
    // scope a label again. The 403 names the scope, so the fix is one tick on the key.
    const expertId = professionalIdFromModel((req.body as { model?: unknown } | undefined)?.model);
    if (expertId) {
      if (!hasScope(auth.scopes, 'ai:professionals')) {
        res.status(403).json(apiError('missing_scope',
          'This key is missing the required scope: ai:professionals. Edit the key on the Developer Tools page to grant it.',
          { scope: 'ai:professionals' }));
        return;
      }
      await answerAsExpert(res, auth, now, expertId, request.system, request.messages, streamChoiceOf(req.body));
      return;
    }

    const lastUser = request.messages[request.messages.length - 1].content;
    const gate = await spendGate(res, auth, now, lastUser);
    if (!gate) return;

    const system = request.system ? `${DEVELOPER_API_SYSTEM_PROMPT}\n\n${request.system}` : DEVELOPER_API_SYSTEM_PROMPT;
    const run = await collectAiSpend(() => callProfessionalAIWithUsage(system, foldMessagesToPrompt(request.messages), 'free'));
    if (!run.ok) {
      // Every provider failed. The developer gets branded wording; the reason stays on our side.
      console.error(`[DEVAPI] key ${auth.keyId}: the assistant chain failed:`, run.error);
      res.status(503).json(apiError('engine_unavailable', 'NavBharatAI could not answer right now. Please try again in a moment.'));
      return;
    }

    const last = run.spend[run.spend.length - 1];
    sendCompletion(res, run.result.content, {
      id: `${auth.keyId}-${now.toString(36)}`,
      createdMs: now,
      model: PUBLIC_MODEL_NAME,
      usage: last ? { inputTokens: last.inputTokens, outputTokens: last.outputTokens } : null,
      stream: streamChoiceOf(req.body),
    });

    // ── Money, AFTER the answer is out ──────────────────────────────────────────────────────
    settleKeyTurn(auth, now, gate.freeListed, run.spend);
  });

  // ── ai:professionals ────────────────────────────────────────────────────────────────────────
  //
  // 🔴 THERE IS DELIBERATELY NO `GET /api/professionals` HERE, and that is a correction rather than an
  // omission. One was written, and `routeCollision.test.ts` caught it: `routes/professionals.ts` has
  // claimed that exact path since long before this API existed, publicly and unauthenticated — so a
  // second registration would never have been reached at all (the first one wins), and a developer
  // calling `/api/v1/professionals` would have been silently served the other module's answer. The
  // duplicate-route class, caught by the guard written for it.
  //
  // The discovery need is real and is met twice over: that public list already answers
  // `GET /api/v1/professionals`, and `GET /api/v1/models` below returns the ADDRESSABLE names
  // (`navbharatai/<id>`), which is where a chat-completions client looks for them anyway.
  app.post('/api/professionals/:id/chat', ipLimiter, apiKeyAuth, requireScope('ai:professionals'), async (req: Request, res: Response) => {
    const auth = apiAuthOf(req);
    const now = Date.now();
    const request = readChatCompletionRequest(req.body);
    if (!request.ok) {
      res.status(400).json(apiError('invalid_request', chatRequestHelp(request.reason)));
      return;
    }
    await answerAsExpert(res, auth, now, routeParam(req.params.id), request.system, request.messages, streamChoiceOf(req.body));
  });

  // ── any valid key: what can I address? ──────────────────────────────────────────────────────
  //
  // OpenAI-shaped so `client.models.list()` works untouched. The experts are listed only when the key
  // may actually address them — a list of names that 403 on use is worse than no list.
  app.get('/api/models', ipLimiter, apiKeyAuth, (req: Request, res: Response) => {
    const auth = apiAuthOf(req);
    const ids = [PUBLIC_MODEL_NAME];
    if (hasScope(auth.scopes, 'ai:professionals')) ids.push(...listProfessionals().map((p) => professionalModelName(p.id)));
    res.json({
      object: 'list',
      data: ids.map((id) => ({ id, object: 'model', owned_by: PUBLIC_MODEL_NAME })),
    });
  });

  // ── any valid key: what am I, and what have I spent? ────────────────────────────────────────
  //
  // 🔑 The endpoint a developer reaches for when something returns 403 or 429 — it answers both
  // questions from the terminal they are already in, rather than sending them back to the app.
  // `scopes` is the EXPANDED list, so a full-access key shows what it can really do rather than
  // the single word `all`.
  app.get('/api/key', ipLimiter, apiKeyAuth, async (req: Request, res: Response) => {
    const auth = apiAuthOf(req);
    const now = Date.now();
    const day = keyDayKey(now);
    const spent = await apiKeyUsageStore.spentToday(auth.keyId, day).catch(() => null);
    res.json({
      keyId: auth.keyId,
      granted: auth.scopes,
      scopes: effectiveScopes(auth.scopes),
      fullAccess: auth.scopes.includes(FULL_ACCESS_SCOPE),
      dailyCapInr: normalizeDailyCapInr(auth.dailyCapInr),
      // `null` = the counter could not be read right now, never a confident zero. A developer
      // reasoning about a 429 must be able to tell "nothing spent" from "we do not know".
      todaySpentInr: spent && spent.known ? Math.round(spent.spentInr * 100) / 100 : null,
      todayCalls: spent && spent.known ? spent.calls : null,
      day,
    });
  });
}

/** The one place a malformed chat body is explained, so both chat doors say the same thing. */
function chatRequestHelp(reason: 'no-messages' | 'bad-message' | 'too-many' | 'too-long' | 'no-user-turn'): string {
  const why = {
    'no-messages': 'Send `messages: [{ role, content }]` (or a `prompt` string).',
    'bad-message': 'Each message needs a role of user, assistant or system, and string content.',
    'too-many': 'Too many messages in one request. Send at most 40.',
    'too-long': 'This conversation is too long for one request. Send less history.',
    'no-user-turn': 'The last message must be from the user, and it must not be empty.',
  } as const;
  return why[reason];
}

/**
 * Ask one expert, and settle it. The single handler behind BOTH expert entry points.
 *
 * 🔒 The expert's own persona, knowledge and memory are the platform's — `runProfessionalChatWithUsage`
 * is the same function the app's own screen calls, so an API caller gets the real Teacher AI rather
 * than a thin imitation of it. The developer's `system` message rides ON TOP and shapes the job; it
 * does not get to rename the engine (White-Label Law, same as the plain chat door).
 */
async function answerAsExpert(
  res: Response,
  auth: { userId: string; keyId: string; dailyCapInr?: number },
  now: number,
  id: string,
  developerSystem: string,
  messages: readonly ChatMessage[],
  stream: StreamChoice,
): Promise<void> {
  const config = getProfessional(id);
  if (!config) {
    res.status(404).json(apiError('not_found',
      `No NavBharatAI expert with the id "${id}". Call GET /api/v1/professionals for the list.`, { id }));
    return;
  }

  const last = messages[messages.length - 1].content;
  const gate = await spendGate(res, auth, now, last);
  if (!gate) return;

  // `readChatCompletionRequest` folds every `system` message into `developerSystem`, so nothing in
  // `messages` is one — the filter is what proves that to the compiler rather than a cast asserting it.
  const history = messages
    .slice(0, -1)
    .filter((m): m is { role: 'user' | 'assistant'; content: string } => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));
  const question = developerSystem
    ? `${last}\n\n[The program asking on the user's behalf adds: ${developerSystem}]`
    : last;

  const run = await collectAiSpend(() => runProfessionalChatWithUsage(config, question, history, auth.userId, 'free'));
  if (!run.ok) {
    console.error(`[DEVAPI] key ${auth.keyId}: expert ${id} failed:`, run.error);
    res.status(503).json(apiError('engine_unavailable', 'NavBharatAI could not answer right now. Please try again in a moment.'));
    return;
  }

  const usage = run.spend[run.spend.length - 1];
  sendCompletion(res, run.result.reply, {
    id: `${auth.keyId}-${now.toString(36)}`,
    createdMs: now,
    // Which expert answered, under our own brand. Never the vendor beneath it.
    model: professionalModelName(config.id),
    usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : null,
    stream,
  });

  settleKeyTurn(auth, now, gate.freeListed, run.spend);
}
