// THE AI GATEWAY ENDPOINT for published apps (ROADMAP §13, 3.1).
//
// A NavBharatAI-built app asks a question here and gets an answer, with no key pasted anywhere and the
// cost landing on the SAME wallet its owner already has (THE ONE-WALLET LAW). The reasoning behind
// every decision — why the token is an identifier rather than a secret, why the CAP is the real
// defence, why a visitor is never told the owner's balance — is written down in `lib/appAiGateway.ts`
// and is not repeated here. This file is the I/O the pure core deliberately refused to own.
//
// 🔴 THE CALLER IS A STRANGER. This is the only endpoint on the platform that spends a real user's
// money for someone with no account, no session and no relationship to us. So the order below is
// deliberate and cheap-first: the flag, then the token's SHAPE, then the registry, then liveness, then
// the counters — every step that could refuse without touching the database happens before one that
// cannot, and no model is called until all of them have passed.

import type { Express, Request, Response } from 'express';
import express from 'express';
import { rateLimiter } from '../lib/authMiddleware';
import {
  GATEWAY_PATH, appAiGatewayEnabled, gatewaySecret, verifyAppAiToken, nonceAccepted,
  readGatewayRequest, appDailyCapInr, visitorDailyCapInr,
  visitorFacingMessage, type GatewayRefusal,
} from '../lib/appAiGateway';
import { appAiRegistryStore } from '../lib/AppAiRegistryStore';
import { deploymentStore, isLiveDeployment } from '../AgentV3/DeploymentStore';
import { dayKey, visitorHash } from '../lib/siteAnalytics';
import { hashSecret } from '../lib/siteAnalyticsStore';
import { answerForApp } from '../lib/appAiAnswer';

/**
 * The system prompt every gateway answer is produced under.
 *
 * 🔒 WHITE-LABEL LAW, APPLIED TO SOMEBODY ELSE'S VISITORS. The app's own users must never learn which
 * vendor answered, so the assistant is told what it is before the app author's own instructions are
 * appended. The author's text comes second on purpose: it shapes the assistant's job, it does not get
 * to rename the engine.
 */
export const BASE_SYSTEM =
  'You are the assistant built into this app, powered by NavBharatAI. ' +
  'Never name, hint at, or speculate about which AI model, company or provider is answering — ' +
  'if asked, say you are the app’s assistant, powered by NavBharatAI. ' +
  'Answer helpfully and concisely.';

export function registerAppAiRoutes(app: Express): void {
  const cors = (res: Response) => {
    // A published app is on its own origin and has no session with us — the token in the body is the
    // whole identity, so there is nothing for a cookie to leak and `*` is the honest answer. Credentials
    // are deliberately NOT allowed: this endpoint must never be reachable as a signed-in user.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  };

  app.options(GATEWAY_PATH, (_req: Request, res: Response) => { cors(res); res.status(204).end(); });

  /**
   * Per-IP, in memory. This bounds the shape of abuse a cap cannot: a thousand cheap requests that
   * each cost almost nothing would stay under the ₹ ceiling while still costing us latency and the
   * owner a slow trickle. `durable: false` matches the analytics beacon — a Firestore read per
   * question would cost more than the question.
   */
  const limiter = rateLimiter({ name: 'app-ai', authed: 240, anon: 240, noun: 'questions', durable: false, anonGlobalPerHour: 20_000 });

  app.post(GATEWAY_PATH, express.json({ limit: '16kb' }), limiter, async (req: Request, res: Response) => {
    cors(res);
    const refuse = (reason: GatewayRefusal, status = 200) => {
      // 200 with `ok: false`, not an HTTP error: the page's helper reads one shape, and a status code
      // is itself information about the owner's account that a visitor is not entitled to.
      res.status(status).json({ ok: false, message: visitorFacingMessage(reason) });
    };

    if (!appAiGatewayEnabled()) { refuse('disabled'); return; }

    const body = req.body as { token?: unknown } | undefined;
    const verdict = verifyAppAiToken(typeof body?.token === 'string' ? body.token : '', gatewaySecret());
    if (!verdict.ok) { refuse('bad-token'); return; }

    const request = readGatewayRequest(req.body);
    if (!request.ok) {
      res.status(200).json({
        ok: false,
        message: request.reason === 'empty'
          ? 'Please type a question first.'
          : 'That message is too long. Please shorten it and try again.',
      });
      return;
    }

    const record = await appAiRegistryStore.get(verdict.appId);
    // A missing row and an unreadable one are the same answer to a stranger — and both are honest,
    // because in neither case can we prove this app is entitled to spend anything.
    if (!record || !nonceAccepted(verdict.nonce, record)) { refuse('bad-token'); return; }

    const deployment = await deploymentStore.get(record.workspaceId);
    // 🔒 THE REVOCATION PATH. Unpublishing, a takedown or an abuse hold switches the assistant off
    // without anything having to reach into the published files — which is the only kind of
    // revocation that works when the token is public and already in somebody's browser.
    if (!isLiveDeployment(deployment)) { refuse('not-live'); return; }

    const ownerId = String(deployment?.userId || record.userId || '').trim();
    const day = dayKey(Date.now());
    const visitor = visitorHash(req.ip || '', String(req.headers['user-agent'] || ''), day, hashSecret());
    const system = request.system ? `${BASE_SYSTEM}\n\n${request.system}` : BASE_SYSTEM;

    // ONE answer path for the published app and the owner's preview (lib/appAiAnswer.ts): the owner's
    // own key if they saved one (server-side, never in the page), else NavBharatAI's engine inside the
    // caps — unless the owner switched it off for this app, which takes effect here with no republish.
    const answer = await answerForApp({
      ownerId, workspaceId: record.workspaceId, system, prompt: request.prompt,
      counter: { appId: verdict.appId, visitor, day, appCapInr: appDailyCapInr(), visitorCapInr: visitorDailyCapInr() },
    });
    if (!answer.ok) {
      // A visitor learns only that the assistant is unavailable — never the owner's balance, their
      // switch, or that they bring their own key (and certainly not which provider).
      refuse(answer.reason === 'visitor-cap' || answer.reason === 'bad-token' || answer.reason === 'not-live' ? answer.reason : 'disabled');
      return;
    }
    res.status(200).json({ ok: true, text: answer.text });
    // Money, AFTER the answer is out (see AppAiAnswer.settle).
    answer.settle();
  });
}
