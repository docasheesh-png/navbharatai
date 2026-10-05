// THE OWNER'S SIDE of an app's built-in assistant (admin 2026-10-04): try it in the PREVIEW, see which
// engine answers, switch NavBharatAI's AI off, and see what it cost today.
//
// 🔒 NOTHING HERE PUTS A CREDENTIAL IN THE APP'S PAGE. The preview runs on another origin; it asks its
// PARENT (the NavBharatAI page the owner is signed in to) and the parent calls this route with the owner's
// own login. Open the preview link anywhere else and there is no parent to answer — the assistant simply
// is not available there. Every route here is a STRICT owner check: the verified uid must own the
// workspace (no claimed-uid fallback, no anonymous capability — an anonymous workspace has no wallet).
//
// 💸 THE PREVIEW HAS ITS OWN SMALL CEILING: `APP_AI_PREVIEW_CAP_INR` (default ₹2 a day per app), separate
// from the published app's ₹20, so testing can never eat the budget the live app's visitors need.

import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken, rateLimiter } from '../lib/authMiddleware';
import { ownedByVerifiedUid } from '../lib/workspaceIdentity';
import { appAiGatewayEnabled, readGatewayRequest, ownerFacingMessage } from '../lib/appAiGateway';
import { answerForApp, type AppAiRefusal } from '../lib/appAiAnswer';
import { getAppAiSettings, setAppAiDisabled } from '../lib/AppAiSettingsStore';
import { ownKeyFor, forgetOwnKey } from '../lib/appAiOwnKey';
import { appAiUsageStore } from '../lib/AppAiUsageStore';
import { dayKey } from '../lib/siteAnalytics';
import { loadWorkspaceFilesByPath } from '../AgentV3/WorkspaceFileStore';
import { siteIdForWorkspace } from '../lib/firebaseCustomDomain';
import { BASE_SYSTEM } from './appAi';
import { imageForApp, readAppImagePrompt, imageCounterId, PREVIEW_IMAGES_PER_DAY } from '../lib/appAiImage';
import { clampImagePixels } from '../lib/navbharatImageEngine';

export const PREVIEW_ASK_PATH = '/api/app-ai/preview-ask';
export const PREVIEW_IMAGE_PATH = '/api/app-ai/preview-image';
export const SETTINGS_PATH = '/api/app-ai/settings';

/** The preview's daily ceiling per app, in ₹. Unreadable ⇒ the default, never "no limit". */
export function previewDailyCapInr(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.APP_AI_PREVIEW_CAP_INR ?? '').trim();
  if (!raw) return 2;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

export function previewCounterId(workspaceId: string): string {
  return `preview_${workspaceId}`;
}

/** What the OWNER is told when their preview assistant does not answer. Plain, true, theirs. */
export function previewRefusalMessage(reason: AppAiRefusal, provider?: string): string {
  const who = provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
  switch (reason) {
    case 'switched-off': return 'NavBharatAI AI is switched off for this app. Turn it on in Keys & Secrets, or add your own key there.';
    case 'own-key-refused': return `Your ${who} key was refused (wrong key, or no credit left). Check it in Keys & Secrets.`;
    case 'own-key-failed': return `Your ${who} key did not answer just now. Please try again.`;
    case 'app-cap': return 'Today’s preview AI limit for this app is used up. It resets tomorrow — or add your own key in Keys & Secrets.';
    default: return ownerFacingMessage(reason as Parameters<typeof ownerFacingMessage>[0]);
  }
}

/** Does this app use the NavBharatAI assistant helper? Read from the one file the recipe writes. */
export async function appUsesAssistant(workspaceId: string): Promise<boolean> {
  const files = await loadWorkspaceFilesByPath(workspaceId, ['src/lib/ai.ts']).catch(() => ({} as Record<string, string>));
  return /NavAI/.test(files['src/lib/ai.ts'] ?? '');
}

async function ownerOf(req: Request, workspaceId: unknown): Promise<string | null> {
  const uid = await verifyFirebaseToken(req);
  return uid && ownedByVerifiedUid(uid, workspaceId) ? uid : null;
}

export function registerAppAiOwnerRoutes(app: Express): void {
  const limiter = rateLimiter({ name: 'app-ai-owner', authed: 120, anon: 0, noun: 'questions', durable: false });

  app.post('/api/app-ai/preview-ask', limiter, async (req: Request, res: Response) => {
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const ownerId = await ownerOf(req, workspaceId);
    if (!ownerId) { res.status(403).json({ ok: false, message: 'Sign in as this app’s owner to use its assistant in the preview.' }); return; }
    if (!appAiGatewayEnabled()) { res.json({ ok: false, message: ownerFacingMessage('disabled') }); return; }
    const request = readGatewayRequest(req.body);
    if (!request.ok) {
      res.json({ ok: false, message: request.reason === 'empty' ? 'Please type a question first.' : 'That message is too long. Please shorten it and try again.' });
      return;
    }
    const system = request.system ? `${BASE_SYSTEM}\n\n${request.system}` : BASE_SYSTEM;
    const answer = await answerForApp({
      ownerId, workspaceId, system, prompt: request.prompt,
      // Owner-only: one counter for the whole app's preview, no per-visitor cap (there is one visitor).
      counter: { appId: previewCounterId(workspaceId), visitor: '', day: dayKey(Date.now()), appCapInr: previewDailyCapInr(), visitorCapInr: 0 },
    });
    if (!answer.ok) { res.json({ ok: false, message: previewRefusalMessage(answer.reason, answer.provider) }); return; }
    res.json({ ok: true, text: answer.text });
    answer.settle(); // money after the answer, as everywhere
  });

  /**
   * A PICTURE for the app in the owner's PREVIEW (admin 2026-10-04). The owner's own login, the owner's
   * image key, and — unlike the published route — the owner's full message: which keys work, where each
   * is made, and where to paste it, because the owner is exactly the person who can act on it.
   */
  const imageLimiter = rateLimiter({ name: 'app-ai-owner-image', authed: 60, anon: 0, noun: 'pictures', durable: false });
  app.post(PREVIEW_IMAGE_PATH, imageLimiter, async (req: Request, res: Response) => {
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const ownerId = await ownerOf(req, workspaceId);
    if (!ownerId) { res.status(403).json({ ok: false, message: 'Sign in as this app’s owner to make pictures in the preview.' }); return; }
    const request = readAppImagePrompt(req.body);
    if (!request.ok) { res.json({ ok: false, message: request.message }); return; }
    const answer = await imageForApp({
      ownerId, workspaceId, prompt: request.prompt, px: clampImagePixels(req.body?.width, req.body?.height),
      counter: { appId: imageCounterId(previewCounterId(workspaceId)), visitor: '', day: dayKey(Date.now()), appLimit: PREVIEW_IMAGES_PER_DAY, visitorLimit: PREVIEW_IMAGES_PER_DAY },
    });
    if (!answer.ok) { res.json({ ok: false, code: answer.code, message: answer.owner }); return; }
    res.json({ ok: true, image: `data:${answer.image.mimeType};base64,${answer.image.base64}` });
  });

  app.get('/api/app-ai/settings', limiter, async (req: Request, res: Response) => {
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    const ownerId = await ownerOf(req, workspaceId);
    if (!ownerId) { res.status(403).json({ error: 'Forbidden' }); return; }
    const day = dayKey(Date.now());
    const [usesAi, settings, own, preview, published] = await Promise.all([
      appUsesAssistant(workspaceId),
      getAppAiSettings(workspaceId),
      ownKeyFor(ownerId, workspaceId),
      appAiUsageStore.appSpentOn(previewCounterId(workspaceId), day),
      appAiUsageStore.appSpentOn(siteIdForWorkspace(workspaceId), day),
    ]);
    res.json({
      available: appAiGatewayEnabled(),
      usesAi,
      enabled: !settings.disabled,
      // Only the provider's NAME — never the key, never a fragment of it.
      ownKey: own?.provider ?? null,
      previewCapInr: previewDailyCapInr(),
      previewSpentTodayInr: Math.round(preview.spentInr * 100) / 100,
      publishedSpentTodayInr: Math.round(published.spentInr * 100) / 100,
    });
  });

  app.post('/api/app-ai/settings', limiter, async (req: Request, res: Response) => {
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const ownerId = await ownerOf(req, workspaceId);
    if (!ownerId) { res.status(403).json({ error: 'Forbidden' }); return; }
    if (typeof req.body?.enabled !== 'boolean') { res.status(400).json({ error: 'enabled must be true or false' }); return; }
    const saved = await setAppAiDisabled(workspaceId, !req.body.enabled);
    // A key the owner just saved or deleted should count on the next question, not a minute later.
    forgetOwnKey(ownerId);
    if (!saved) { res.status(503).json({ error: 'Could not save that setting. Please try again.' }); return; }
    res.json({ ok: true, enabled: req.body.enabled });
  });
}
