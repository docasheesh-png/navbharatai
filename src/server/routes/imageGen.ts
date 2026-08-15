import type { Express, Request, Response } from 'express';
import { rateLimiter } from '../lib/authMiddleware';
import { gateToolAction, burnToolAction } from '../tools/toolGate';
import { requireAccountForCostlyAi } from '../lib/costlyAiAccess';
import { validateBody, vobject, vstring } from '../lib/validate';
import {
  buildImagePrompt, parseImagePartsResponse, imageGenModels, imageGenConfigured, isValidImageGenRequest,
  isImageRefusal, extractResponseText, IMAGE_REFUSAL_MESSAGE,
  geminiImageConfigured, grokImageKey, grokImageModel, parseGrokImageResponse,
  pollinationsEnabled, fetchPollinationsImage,
} from '../lib/imageGen';
import { craftImagePrompt, withInlineNegative } from '../lib/imagePromptCraft';
import { isAgentV3FreeUser } from '../AgentV3/featureFlag';

/**
 * AI Image Gen — the REAL /api/image/generate route (admin autopsy 2026-07-20).
 *
 * POST /api/image/generate
 *   body: { prompt, style?, size? }
 *   → { image: "data:<mime>;base64,<...>", mimeType }
 *
 * The AI Tools → AI Image Gen tile shipped with NO server side — the client hot-linked a
 * third-party free image site. This route generates images on NavBharatAI's own configured
 * image model (the same key chain the vision path uses). HONESTY: when no key is configured,
 * or every model fails, the response is an explicit white-label error — never a placeholder
 * image, never a silent external fallback.
 */
const ROUTE_TIMEOUT_MS = 60_000;

const schema = vobject({
  prompt: vstring({ max: 2_000 }),
  style: vstring({ optional: true, max: 40 }),
  size: vstring({ optional: true, max: 40 }),
  // The image TYPE as a real field. The client historically mashed it into the prompt string
  // ("App Icon — coffee shop"), which left the server unable to tell the selected type from the
  // user's own words — and therefore unable to apply the per-purpose art direction.
  type: vstring({ optional: true, max: 60 }),
});

// Image generation is costlier than text — its own tighter bucket, separate from the workspace one.
// `anon: 0` because the route now requires an account (see costlyAiAccess.ts): every image carries a
// real per-image provider charge, and an anonymous caller has no wallet to draw it from. The global
// anonymous ceiling is belt-and-braces in case the sign-in check is ever relaxed.
const imageGenLimiter = () => rateLimiter({
  name: 'imagegen', authed: 40, anon: 0, anonGlobalPerHour: 0, noun: 'image generations',
});

export function registerImageGenRoutes(app: Express): void {
  app.post('/api/image/generate', imageGenLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    if (!isValidImageGenRequest(req.body)) {
      res.status(400).json({ error: 'A non-empty "prompt" is required.' });
      return;
    }
    if (!imageGenConfigured()) {
      // Honest not-available state (rule 2): the capability needs the image key in the environment.
      res.status(503).json({ error: 'Image generation is not configured on this server yet — please try again later.' });
      return;
    }

    // Real money per image → a real account to bill it to. This runs REGARDLESS of any feature flag:
    // the allowance gate below is flag-gated and therefore inert by default, so without this an
    // anonymous caller could generate images on NavBharatAI's account with nothing to charge.
    const account = await requireAccountForCostlyAi(req, 'image generation');
    if (!account.ok) {
      res.status(account.status).json(account.body);
      return;
    }

    // Image generation is FREE for the user while the free provider (Pollinations) is on (admin 2026-08-01:
    // "free denge user ko"): it costs NavBharatAI ₹0, so there is NO paywall/quota — sign-in above plus the
    // hourly rate limiter are the only guards. The Professional-Pass allowance gate re-applies ONLY when the
    // free provider is turned OFF, because then images fall through to the PAID providers (Gemini/Grok) and
    // the real per-image cost must be metered again.
    let gate: Awaited<ReturnType<typeof gateToolAction>> | null = null;
    if (!pollinationsEnabled()) {
      gate = await gateToolAction(account.uid, account.email, 'image');
      if (!gate.allow) {
        res.status(gate.status).json(gate.body);
        return;
      }
    }

    try {
      // ART DIRECTION (2026-08-14). The prompt was the ceiling, not the model: what a user typed went
      // to the image engine almost unchanged, leaving composition, framing, margins and background to
      // the model's guess. craftImagePrompt applies the rules a designer would — per PURPOSE, since an
      // icon (must read at 48px), a banner (needs empty space for a headline) and an avatar (must
      // survive a circular crop) are three different briefs. Same model, same call, same price.
      // buildImagePrompt is still used as the base so the India-map directive and every existing
      // behaviour is preserved; the craft layer adds direction on top of it.
      const crafted = craftImagePrompt({
        prompt: buildImagePrompt(req.body),
        style: typeof req.body?.style === 'string' ? req.body.style : undefined,
        size: typeof req.body?.size === 'string' ? req.body.size : undefined,
        type: typeof req.body?.type === 'string' ? req.body.type : undefined,
      });
      // Providers here take a single string, so the negatives ride inline — phrased as "Avoid:", never
      // a bare list, which some models read as a request FOR those things.
      const prompt = withInlineNegative(crafted);
      const timeout = <T,>(p: Promise<T>): Promise<T> => Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('image-generation timeout')), ROUTE_TIMEOUT_MS)),
      ]);
      // Deliver a generated image: only a genuinely-delivered image spends a PAID allowance (and only when
      // the paywall is active, i.e. the free provider is off — see above). A free Pollinations image never
      // counts against a quota. A failed rung never spends anything.
      const deliver = (img: { mimeType: string; base64: string }) => {
        if (gate && gate.allow && gate.countsAgainstFree) burnToolAction(gate.uid, 'image');
        // `notes` carries the honest caveats (a style chip that was overruled, or the warning that
        // image engines cannot spell). Surfacing them is the point: a user who knows their shop name
        // may come out garbled can shorten it, where a silent bad spelling just wastes their time.
        res.json({
          image: `data:${img.mimeType};base64,${img.base64}`,
          mimeType: img.mimeType,
          ...(crafted.notes.length > 0 ? { notes: crafted.notes } : {}),
        });
      };
      // Track WHY every rung failed so the final error is HONEST (rule 5): a content refusal (the model
      // declined a real brand / public figure / copyrighted character — e.g. "spiderman") must tell the
      // user to change the prompt, NOT "try again in a minute" (a transient message they'd retry forever).
      let sawRefusal = false;
      // The exact per-rung failure (model id + reason) — surfaced to an ADMIN/free-list caller ONLY, so we
      // can diagnose a live outage (bad model id / billing / quota / region) WITHOUT Cloud Run log access.
      // Provider/model names to an admin are allowed (White-Label §3); a normal user never sees this.
      const diag: string[] = [];

      // FREE provider — Pollinations, tried FIRST (admin choice 2026-08-01: "free wala chalu karo"). Costs
      // ₹0 (no key, no per-image charge), so it removes the paid-provider margin problem entirely. Unlike
      // the old raw client hot-link, the route PROXIES it — the bytes are fetched here and re-served as a
      // data URL, so the user never talks to a third party and the result is branded NavBharatAI.
      if (pollinationsEnabled()) {
        const pr = await fetchPollinationsImage(prompt, req.body.size, { timeoutMs: ROUTE_TIMEOUT_MS });
        if (pr.image) { deliver(pr.image); return; }
        if (pr.error) {
          diag.push(`pollinations: ${pr.error}`);
          console.warn(`[IMAGE_GEN] pollinations failed: ${pr.error} — trying paid fallbacks.`);
        }
      }

      // PRIMARY (paid) provider — Gemini image models (skipped entirely when no Gemini key is present).
      if (geminiImageConfigured()) {
        const { GoogleGenAI } = await import('@google/genai');
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        const ai = new GoogleGenAI({ apiKey });
        for (const model of imageGenModels()) {
          try {
            const result: any = await timeout(ai.models.generateContent({
              model,
              contents: prompt,
              config: { responseModalities: ['IMAGE', 'TEXT'] },
            }));
            const img = parseImagePartsResponse(result);
            if (img) { deliver(img); return; }
            if (isImageRefusal(result)) {
              sawRefusal = true;
              console.warn(`[IMAGE_GEN] ${model} declined the prompt (content refusal): ${extractResponseText(result) || 'no reason given'}`);
            } else {
              diag.push(`${model}: no image part (${extractResponseText(result)?.slice(0, 120) || 'empty response'})`);
              console.warn(`[IMAGE_GEN] ${model} returned no image part — trying the next rung.`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            diag.push(`${model}: ${msg.slice(0, 160)}`);
            console.warn(`[IMAGE_GEN] ${model} failed: ${msg}`);
          }
        }
      }

      // FALLBACK provider — xAI/Grok text-to-image (OpenAI-compatible /v1/images/generations). This is what
      // keeps the feature ALIVE when the Gemini project is denied image access (the live 403). Uses the
      // already-configured GROK_API_KEY/XAI_API_KEY; invisible to the user (still "NavBharatAI").
      const gKey = grokImageKey();
      if (gKey) {
        const gModel = grokImageModel();
        try {
          const r = await timeout(fetch('https://api.x.ai/v1/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gKey}` },
            body: JSON.stringify({ model: gModel, prompt, n: 1, response_format: 'b64_json' }),
          }));
          const data: any = await r.json().catch(() => null);
          if (r.ok) {
            const img = parseGrokImageResponse(data);
            if (img) { deliver(img); return; }
            diag.push(`${gModel}: no image in response`);
          } else {
            diag.push(`${gModel}: ${r.status} ${JSON.stringify(data?.error || data || '').slice(0, 140)}`);
            console.warn(`[IMAGE_GEN] ${gModel} failed: HTTP ${r.status}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          diag.push(`${gModel}: ${msg.slice(0, 160)}`);
          console.warn(`[IMAGE_GEN] ${gModel} failed: ${msg}`);
        }
      }

      if (sawRefusal) {
        // A real refusal is NOT transient — 422 (unprocessable), with the actionable white-label message.
        res.status(422).json({ error: IMAGE_REFUSAL_MESSAGE });
        return;
      }
      // Every provider failed (a genuine outage / access error) — honest transient error (ids stay in logs).
      // For an admin/free-list caller, attach the real per-rung diagnostic so the true cause is visible.
      const isAdminCaller = isAgentV3FreeUser(account.uid, account.email);
      const baseMsg = 'NavBharatAI could not generate the image right now — please try again in a minute.';
      res.status(502).json({
        error: isAdminCaller && diag.length ? `${baseMsg}\n\n[admin diagnostic] ${diag.join(' | ')}` : baseMsg,
      });
    } catch {
      res.status(503).json({ error: 'NavBharatAI\'s image engine is briefly busy — please try again.' });
    }
  });
}
