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
import { extractImageText, noTextDirection } from '../../lib/imageTextFromPrompt';
import { isAgentV3FreeUser } from '../AgentV3/featureFlag';
import {
  IMAGE_PRO_PRICE_INR, IMAGE_PRO_TIMEOUT_MS, imageProConfigured, imageProEndpoint, imageProAuthHeaders,
  imageProMode, imageProCount, imageProQuotedInr, buildImageProRequest, parseImageProResponse,
  pendingResultUrl, jobFailed, IMAGE_PRO_POLL_MS,
  imageProFailureMessage, initImageTooLarge, parseDataUrl, imageProMargin, imageProMarginWarning,
} from '../lib/imageProGen';
import { usdInrRate } from '../lib/UsdInrRate';
import { IMAGE_SIZE_PIXELS } from '../lib/imageGen';
import { getServerDb } from '../lib/serverDb';
import { readWalletBalanceInr, firestoreWalletReader } from '../AgentV3/WalletBalance';
import { walletTooEmptyForTurn } from '../professionals/passGate';
import { isProfessionalFreeUser } from '../professionals/professionalPaid';
import { debitWalletRolledUp } from '../lib/walletDebit';
import { featureRollupRef, featureLabel } from '../lib/walletFeature';

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


// ── PRO (paid) image generation ────────────────────────────────────────────────────────────────
// Admin 2026-09-18: "paid walo ko inhance karna hai … 2₹/image fee rakhni hai."
const proSchema = vobject({
  prompt: vstring({ optional: true, max: 2_000 }),
  size: vstring({ optional: true, max: 40 }),
  // A reference image as a data URL — this is what makes image→image and image+text→image real
  // rather than a label. Generous max because a phone photo base64s large; the route rejects
  // anything over 8 MB by BYTES (initImageTooLarge) rather than by string length.
  initImage: vstring({ optional: true, max: 14_000_000 }),
  strength: vstring({ optional: true, max: 10 }),
  count: vstring({ optional: true, max: 3 }),
});

// Once per process: the margin line is a CONFIGURATION fact, not a per-request one, and repeating it
// on every image would make the inverted-price warning invisible in the noise it created.
let marginWarned = false;

const proLimiter = () => rateLimiter({
  name: 'imagegenpro', authed: 30, anon: 0, anonGlobalPerHour: 0, noun: 'Pro image generations',
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

    // Image generation is FREE for the user while the free provider (Pollinations) SERVES the image
    // (admin 2026-08-01: "free denge user ko") — it costs NavBharatAI ₹0, so there is no paywall on it.
    //
    // 🔴 MONEY AUDIT 2026-09-12 — THE GATE USED TO KEY OFF THE FLAG, NOT OFF WHO ACTUALLY SERVED.
    // It ran only `if (!pollinationsEnabled())`, on the reasoning "free provider on ⇒ the image is
    // free". That holds only while the free provider SUCCEEDS — and the ladder below exists precisely
    // for when it does not: its own log line says "trying paid fallbacks". So a bad minute at
    // Pollinations (down, timeout, rate-limited — and a caller can provoke the last one) delivered a
    // PAID Gemini/Grok image with no allowance checked and nothing metered. Same shape as the free
    // chat chain in this audit: a free-first ladder whose paid rungs were unmetered.
    //
    // 🔒 THE FIX IS TO METER BY WHO SERVES, NOT BY A FLAG. The allowance is resolved LAZILY, the first
    // time the ladder is about to touch a paid provider, and BEFORE that provider is called — checking
    // after spending would be theatre. A free image still passes through without a gate lookup, so the
    // ordinary path is unchanged and costs nothing extra.
    let gate: Awaited<ReturnType<typeof gateToolAction>> | null = null;
    let gateRefused = false;
    const allowPaidRung = async (): Promise<boolean> => {
      if (gateRefused) return false;
      if (!gate) {
        gate = await gateToolAction(account.uid, account.email, 'image');
        if (!gate.allow) {
          gateRefused = true;
          if (!res.headersSent) res.status(gate.status).json(gate.body);
          return false;
        }
      }
      return true;
    };

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
      //
      // 🔑 AND THE ENGINE IS TOLD TO LEAVE ALONE WHAT IT CANNOT DO. A phone number, an address and a
      // price list are the three kinds of text no image engine renders correctly, and the overlay
      // editor now draws them with a real font. Asking for them twice would put a plausible-looking
      // WRONG number in the picture underneath the right one — so the brief asks for clean space
      // instead. A shop NAME is deliberately NOT included: one to five words is what these engines
      // are genuinely good at, and a name in the artwork beats a caption over it.
      const userText = buildImagePrompt(req.body);
      const leaveAlone = noTextDirection(extractImageText(userText));
      const prompt = leaveAlone ? `${withInlineNegative(crafted)} ${leaveAlone}` : withInlineNegative(crafted);
      const timeout = <T,>(p: Promise<T>): Promise<T> => Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('image-generation timeout')), ROUTE_TIMEOUT_MS)),
      ]);
      // Deliver a generated image: only a genuinely-delivered image spends a PAID allowance (and only when
      // the paywall is active, i.e. the free provider is off — see above). A free Pollinations image never
      // counts against a quota. A failed rung never spends anything.
      const deliver = (img: { mimeType: string; base64: string }, paidRung = false) => {
        // Only a PAID rung spends an allowance. A free Pollinations image never counts against a quota,
        // and a failed rung never spends anything — the burn happens on delivery, not on attempt.
        if (paidRung && gate && gate.allow && gate.countsAgainstFree) burnToolAction(gate.uid, 'image');
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
        // First paid rung: the allowance is checked HERE, before a rupee is spent.
        if (!(await allowPaidRung())) return;
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
            if (img) { deliver(img, true); return; }
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
        // Also a PAID rung — reached when Gemini is absent or failed, so it needs the same check.
        if (!(await allowPaidRung())) return;
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
            if (img) { deliver(img, true); return; }
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

  /**
   * POST /api/image/pro/generate — the PAID tier (admin 2026-09-18).
   *
   * Handles all three jobs the admin asked for, with the mode DERIVED from the payload rather than
   * from a fourth control the user has to get right: words alone → text-to-image; a reference alone
   * → image-to-image; both → a directed edit.
   *
   * 🔴 THE MONEY ORDER IS THE POINT, and it is the one thing not to rearrange:
   *   1. refuse an empty wallet BEFORE any provider is called (THE ONE-WALLET LAW — a chat turn has
   *      no later pre-flight gate to catch an overdraft, and neither does this);
   *   2. generate;
   *   3. charge ONLY for images genuinely delivered, and never for a failure or a timeout
   *      ("working result or free", the same law a failed build obeys).
   * Charging first would risk billing a request that then failed; charging for a batch that
   * half-delivered would bill for pictures nobody got.
   */
  app.post('/api/image/pro/generate', proLimiter(), validateBody(proSchema), async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const proReq = {
      prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
      size: typeof body.size === 'string' ? body.size : undefined,
      initImage: typeof body.initImage === 'string' ? body.initImage : undefined,
      strength: body.strength !== undefined ? Number(body.strength) : undefined,
      count: body.count !== undefined ? Number(body.count) : undefined,
    };

    const mode = imageProMode(proReq);
    if (!mode) {
      res.status(400).json({ error: 'Add a prompt, or attach an image to work from.' });
      return;
    }
    if (proReq.initImage && !parseDataUrl(proReq.initImage)) {
      res.status(400).json({ error: 'That attachment is not an image we can read. Please attach a PNG or JPEG.' });
      return;
    }
    if (proReq.initImage && initImageTooLarge(proReq.initImage)) {
      res.status(413).json({ error: 'That image is too large — please attach one under 8 MB.' });
      return;
    }
    if (!imageProConfigured()) {
      // Honest not-available (rule 2). Never a silent fall back to the FREE provider: that would
      // charge the Pro price for a picture the user could have had for nothing, on the tier they chose
      // precisely because they wanted something better.
      res.status(503).json({ error: imageProFailureMessage('unconfigured'), code: 'pro_unconfigured' });
      return;
    }

    const account = await requireAccountForCostlyAi(req, 'Pro image generation');
    if (!account.ok) {
      res.status(account.status).json(account.body);
      return;
    }

    const count = imageProCount(proReq);
    const quotedInr = imageProQuotedInr(proReq);
    const freeListed = isProfessionalFreeUser(account.uid, account.email);

    // STEP 1 — the wallet, before a single provider call.
    if (!freeListed) {
      const balanceInr = await readWalletBalanceInr(
        firestoreWalletReader(getServerDb() as never), account.uid,
      ).catch(() => null);
      // `null` (unreadable) is allowed through on purpose — fail-open, exactly as the build gate and
      // the chat gate do. Refusing a paying user over a Firestore blip costs more than one image.
      if (walletTooEmptyForTurn(balanceInr)) {
        res.status(402).json({
          error: `Your balance is empty. This would cost ₹${quotedInr} (₹${IMAGE_PRO_PRICE_INR} per image) — add credit, or switch the toggle to Free.`,
          code: 'wallet_empty',
          balanceInr: balanceInr ?? 0,
          priceInr: IMAGE_PRO_PRICE_INR,
          quotedInr,
        });
        return;
      }
    }

    // STEP 2 — generate.
    const px = IMAGE_SIZE_PIXELS[proReq.size || ''] || IMAGE_SIZE_PIXELS.square;
    // The same art direction the free tier gets. A paid image is a better MODEL, not a worse brief —
    // dropping the craft layer here would have made Pro sharper and less well composed at once.
    const crafted = craftImagePrompt({
      prompt: String(proReq.prompt || ''),
      size: proReq.size,
    });
    const finalPrompt = proReq.prompt ? withInlineNegative(crafted) : '';

    let delivered: Array<{ image: string; mimeType: string }> = [];
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), IMAGE_PRO_TIMEOUT_MS);
      try {
        const r = await fetch(imageProEndpoint(), {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...imageProAuthHeaders() },
          body: JSON.stringify(buildImageProRequest({ ...proReq, prompt: finalPrompt }, px)),
          signal: ctl.signal,
        });
        if (!r.ok) {
          // The vendor's own status and body stay in the SERVER log and never reach the user.
          console.error(`[IMAGE PRO] host returned HTTP ${r.status}`);
          res.status(502).json({ error: imageProFailureMessage('failed'), code: 'pro_failed' });
          return;
        }
        // 🔴 A 200 IS NOT AN IMAGE. The host this tier was priced around is ASYNC by default: the POST
        // answers with a prediction id, and even in sync mode a task slower than its wait window comes
        // back HTTP **200** with `code: 5004, status: processing`. A caller that stops at `r.ok` would
        // report a failure for a job that was about to succeed — and the user would be told their
        // picture could not be made while it was being made.
        let payload: unknown = await r.json();
        let parsed = parseImageProResponse(payload);
        let next = parsed ? null : pendingResultUrl(payload);
        while (!parsed && next && !ctl.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, IMAGE_PRO_POLL_MS));
          if (ctl.signal.aborted) break;
          // The whole loop is bounded by the SAME AbortController as the first call, so the existing
          // IMAGE_PRO_TIMEOUT_MS is still the one clock — there is no second, longer budget hiding here.
          const poll = await fetch(next, { headers: imageProAuthHeaders(), signal: ctl.signal });
          if (!poll.ok) {
            console.error(`[IMAGE PRO] polling returned HTTP ${poll.status}`);
            break;
          }
          payload = await poll.json();
          if (jobFailed(payload)) {
            console.error('[IMAGE PRO] the host reported the job failed');
            break;
          }
          parsed = parseImageProResponse(payload);
          next = parsed ? null : pendingResultUrl(payload);
        }
        if (!parsed) {
          // Nothing was produced, so nothing is charged — the caller's own guard, unchanged.
          console.error('[IMAGE PRO] host returned no image in a 200 response');
          res.status(502).json({ error: imageProFailureMessage('failed'), code: 'pro_failed' });
          return;
        }
        if ('url' in parsed) {
          // Server-proxied, exactly like the free provider: the bytes are fetched here and re-served
          // as a data URL, so the user's browser never talks to the vendor and the result carries no
          // third-party origin. White-label is a network fact here, not only a wording one.
          const img = await fetch(parsed.url, { signal: ctl.signal });
          const ct = img.headers.get('content-type') || 'image/png';
          if (!img.ok || !ct.startsWith('image/')) {
            console.error(`[IMAGE PRO] fetching the returned image failed (HTTP ${img.status}, ${ct})`);
            res.status(502).json({ error: imageProFailureMessage('failed'), code: 'pro_failed' });
            return;
          }
          const buf = Buffer.from(await img.arrayBuffer());
          if (buf.length === 0) {
            res.status(502).json({ error: imageProFailureMessage('failed'), code: 'pro_failed' });
            return;
          }
          delivered = [{ image: `data:${ct};base64,${buf.toString('base64')}`, mimeType: ct }];
        } else {
          delivered = [{ image: `data:${parsed.mimeType};base64,${parsed.base64}`, mimeType: parsed.mimeType }];
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err: unknown) {
      const aborted = err instanceof Error && /abort/i.test(err.message);
      console.error(`[IMAGE PRO] ${aborted ? 'timed out' : 'threw'}: ${err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)}`);
      res.status(504).json({ error: imageProFailureMessage(aborted ? 'timeout' : 'failed'), code: 'pro_failed' });
      return;
    }

    if (delivered.length === 0) {
      res.status(502).json({ error: imageProFailureMessage('failed'), code: 'pro_failed' });
      return;
    }

    // STEP 3 — charge for what was actually delivered, never for what was asked for.
    // ⚠️ `delivered.length`, not `count`: a host that honours num_images partially must not bill for
    // the pictures it did not return. Today it returns one image per call, so this is one charge —
    // written against the delivered array anyway, so a future batching change cannot quietly overbill.
    const chargedInr = freeListed ? 0 : delivered.length * IMAGE_PRO_PRICE_INR;
    res.json({
      images: delivered.map((d) => d.image),
      image: delivered[0].image,
      mimeType: delivered[0].mimeType,
      mode,
      count: delivered.length,
      chargedInr,
      // The engine is always NavBharatAI to a user — the model that ran is admin-only, in the log.
      engine: 'NavBharatAI Pro',
    });

    if (chargedInr > 0) {
      // ADMIN-ONLY cost visibility. The user was quoted the Pro price and charged it; this is the other half
      // of that honesty — what it actually cost US — so the admin's own picture of this feature is
      // never an assumption. Throttled to once per process because a per-image line would bury it.
      if (!marginWarned) {
        marginWarned = true;
        const warning = imageProMarginWarning(usdInrRate());
        if (warning) {
          // Loud, because this is the E2B_USD_PER_HOUR failure mode: an env value always beats the
          // code, so a warning is the only thing the code can do about a price that has inverted.
          console.error(warning);
        } else {
          const m = imageProMargin(usdInrRate());
          console.log(`[IMAGE PRO] margin OK — ₹${m.priceInr.toFixed(2)} charged vs ₹${m.costInr.toFixed(2)} cost `
            + `(${m.ratio.toFixed(2)}x; break-even at ₹${m.breakEvenUsdInr.toFixed(0)}/$).`);
        }
      }
      // After the answer and never awaited into it: a money-path failure must not cost the user the
      // image they already have. The same rule the professional turn obeys.
      void debitWalletRolledUp(getServerDb() as never, account.uid, {
        billedInr: chargedInr,
        rollupRef: featureRollupRef('image-pro', Date.now()),
        description: featureLabel('image-pro'),
        feature: 'image-pro',
      }).then((r) => {
        if (!r.ok) console.error(`[IMAGE PRO] wallet debit FAILED for ${account.uid}: ${r.error} — image served, not charged.`);
      }).catch(() => { /* logged above; never throws into the request */ });
    }
  });
}
