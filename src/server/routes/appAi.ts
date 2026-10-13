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
import { addressRateKey } from '../lib/clientAddress';
import { rateLimiter } from '../lib/authMiddleware';
import {
  GATEWAY_PATH, IMAGE_GATEWAY_PATH, IMAGE_READY_GATEWAY_PATH, appAiGatewayEnabled, gatewaySecret, verifyAppAiToken, nonceAccepted,
  readGatewayRequest, appDailyCapInr, visitorDailyCapInr,
  visitorFacingMessage, type GatewayRefusal,
} from '../lib/appAiGateway';
import { appAiRegistryStore } from '../lib/AppAiRegistryStore';
import { deploymentStore, isLiveDeployment } from '../AgentV3/DeploymentStore';
import { dayKey, visitorHash } from '../lib/siteAnalytics';
import { hashSecret } from '../lib/siteAnalyticsStore';
import { answerForApp } from '../lib/appAiAnswer';
import { imageForApp, appImageReadiness, readAppImagePrompt, imageCounterId, APP_IMAGES_PER_DAY, VISITOR_IMAGES_PER_DAY } from '../lib/appAiImage';
import { clampImagePixels } from '../lib/navbharatImageEngine';
import { VISITOR_IMAGE_UNAVAILABLE } from '../lib/appImageKeys';
import { BoundedCache } from '../lib/boundedCache';

/** What a published app's page may be told about its pictures: set up or not, in a visitor's words only. */
export interface PublishedImageReadiness { ready: boolean; message?: string }

/** The published app's image route and its readiness route pass ONE gate, so they can never disagree. */
type ImageGate = { ok: true; appId: string; ownerId: string; workspaceId: string } | { ok: false; message: string };

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
  app.options(IMAGE_GATEWAY_PATH, (_req: Request, res: Response) => { cors(res); res.status(204).end(); });
  app.options(IMAGE_READY_GATEWAY_PATH, (_req: Request, res: Response) => { cors(res); res.status(204).end(); });

  /**
   * Per-IP, in memory. This bounds the shape of abuse a cap cannot: a thousand cheap requests that
   * each cost almost nothing would stay under the ₹ ceiling while still costing us latency and the
   * owner a slow trickle. `durable: false` matches the analytics beacon — a Firestore read per
   * question would cost more than the question.
   */
  const limiter = rateLimiter({ name: 'app-ai', authed: 240, anon: 240, noun: 'questions', durable: false, anonGlobalPerHour: 20_000 });

  app.post(GATEWAY_PATH, limiter, async (req: Request, res: Response) => {
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
    const visitor = visitorHash(addressRateKey(req), String(req.headers['user-agent'] || ''), day, hashSecret());
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

  /**
   * A PICTURE for a published app (admin 2026-10-04). The same cheap-first gate as a question — flag,
   * token, registry, liveness — then ONE picture path shared with the preview (lib/appAiImage.ts): the
   * owner's image key from the vault, or an honest "not set up yet" for a visitor. The picture comes back
   * as a data URL, so the page needs no second request and no stored copy exists anywhere.
   */
  const imageLimiter = rateLimiter({ name: 'app-ai-image', authed: 60, anon: 60, noun: 'pictures', durable: false, anonGlobalPerHour: 5_000 });

  /**
   * THE ONE GATE for a published app's pictures — the picture route AND the readiness route below pass it,
   * so "is this app allowed to make pictures here?" is decided once and a visitor reads the same sentence
   * from both in every state (Q-966). Cheap-first, as above: the flag and the token's signature (no I/O),
   * then the caller's own cheap step (`afterToken` — the picture route's prompt check, the readiness route's
   * cache), then the registry and liveness. `afterToken` sees only a token whose signature verified, so a
   * forged token never reaches a cache or the database.
   */
  const imageGate = async <T>(req: Request, afterToken: (token: string) => T | null): Promise<ImageGate | { ok: 'early'; value: T }> => {
    if (!appAiGatewayEnabled()) return { ok: false, message: VISITOR_IMAGE_UNAVAILABLE };
    const body = req.body as { token?: unknown } | undefined;
    const token = typeof body?.token === 'string' ? body.token : '';
    const verdict = verifyAppAiToken(token, gatewaySecret());
    if (!verdict.ok) return { ok: false, message: visitorFacingMessage('bad-token') };
    const early = afterToken(token);
    if (early !== null) return { ok: 'early', value: early };
    const record = await appAiRegistryStore.get(verdict.appId);
    if (!record || !nonceAccepted(verdict.nonce, record)) return { ok: false, message: visitorFacingMessage('bad-token') };
    const deployment = await deploymentStore.get(record.workspaceId);
    if (!isLiveDeployment(deployment)) return { ok: false, message: visitorFacingMessage('not-live') };
    return { ok: true, appId: verdict.appId, ownerId: String(deployment?.userId || record.userId || '').trim(), workspaceId: record.workspaceId };
  };

  app.post(IMAGE_GATEWAY_PATH, imageLimiter, async (req: Request, res: Response) => {
    cors(res);
    const refuse = (message: string) => { res.status(200).json({ ok: false, message }); };
    const body = req.body as { width?: unknown; height?: unknown } | undefined;
    const request = readAppImagePrompt(req.body);
    const gate = await imageGate(req, () => (request.ok ? null : request.message));
    if (gate.ok === 'early') { refuse(gate.value); return; }
    if (!gate.ok) { refuse(gate.message); return; }
    if (!request.ok) { refuse(request.message); return; }
    const { appId, ownerId, workspaceId } = gate;
    const day = dayKey(Date.now());
    const visitor = visitorHash(addressRateKey(req), String(req.headers['user-agent'] || ''), day, hashSecret());
    const answer = await imageForApp({
      ownerId, workspaceId, prompt: request.prompt, px: clampImagePixels(body?.width, body?.height),
      counter: { appId: imageCounterId(appId), visitor, day, appLimit: APP_IMAGES_PER_DAY, visitorLimit: VISITOR_IMAGES_PER_DAY },
    });
    if (!answer.ok) {
      // The owner's setup is the owner's business: a visitor reads only that the picture maker is not ready.
      if (answer.code === 'needs-key' || answer.code === 'key-problem') console.warn(`[APP_IMAGE] ${appId}: ${answer.owner.split('\n')[0]}`);
      refuse(answer.visitor);
      return;
    }
    res.status(200).json({ ok: true, image: `data:${answer.image.mimeType};base64,${answer.image.base64}` });
  });

  /**
   * CAN THIS PUBLISHED APP MAKE PICTURES YET? (Q-966) — asked by the page on load, BEFORE a visitor presses
   * Generate, so a missing key is said on screen first instead of after a failed press.
   *
   * 🔒 A STRANGER CALLS THIS, and it costs nobody anything: no model, no counter, no wallet, no provider.
   * It reveals only "set up yet?", which pressing Generate already reveals, in a visitor's words — never the
   * owner's key list, a vendor or a key name (White-Label Law). A saved key counts as ready; a saved key the
   * provider then refuses is reported when Generate is pressed.
   *
   * One answer per token is kept for a minute, so a busy page costs at most three database reads a minute per
   * instance. The owner's own preview is never cached (appAiOwner.ts).
   */
  const readyLimiter = rateLimiter({ name: 'app-ai-image-ready', authed: 240, anon: 240, noun: 'checks', durable: false, anonGlobalPerHour: 20_000 });
  const readyCache = new BoundedCache<string, PublishedImageReadiness>({ maxEntries: 5_000, ttlMs: 60_000 });

  app.post(IMAGE_READY_GATEWAY_PATH, readyLimiter, async (req: Request, res: Response) => {
    cors(res);
    res.setHeader('Cache-Control', 'no-store');
    const answer = (a: PublishedImageReadiness) => { res.status(200).json({ ok: true, ...a }); };
    let token = '';
    const gate = await imageGate(req, (t) => { token = t; return readyCache.get(t) ?? null; });
    if (gate.ok === 'early') { answer(gate.value); return; }
    let out: PublishedImageReadiness;
    if (!gate.ok) out = { ready: false, message: gate.message };
    else {
      const ready = await appImageReadiness(gate.ownerId, gate.workspaceId);
      // The VISITOR's sentence only — `ready.owner` names vendors and keys and must never leave the server here.
      out = ready.ready ? { ready: true } : { ready: false, message: ready.visitor };
    }
    if (token) readyCache.set(token, out);
    answer(out);
  });
}
