// 🖼️ THE PRO IMAGE ENGINE — the two rungs that actually produce a paid picture, in ONE place.
//
// 🔴 WHY THIS FILE EXISTS (2026-09-22). The whole of this logic lived INSIDE the `/api/image/pro/generate`
// route handler. When the NavBharatAI API gained `POST /api/v1/images/generations`, that second door
// needed the same two rungs — and copying them would have been the drifted-copy class this repository
// has now paid for five separate times (`safeRelPath` ×4, `tagsOnLine` ×2, the HTML boot guard ×2,
// `PLAYWRIGHT_BROWSERS_PATH` ×2, the console listener ×3). A bug fixed in one door and not the other is
// how a paid feature quietly becomes two features.
//
// 🔒 WHAT MOVED, AND WHAT DELIBERATELY DID NOT. This is a RELOCATION, not a redesign: every line below
// is the route's own code, with the four `res.status(...).json(...)` exits turned into a returned
// verdict. What stayed behind in each route is everything that differs between them — who is asking
// (a Firebase session vs an API key), whether their wallet may be spent, and how the debit is recorded.
// **The engine never charges anybody and never reads a wallet.** It produces pictures or it does not.
//
// ⚠️ It also does NOT run the safety triage, and that is not an omission: the triage belongs to the
// DOOR, because a door is what a person walks through (`imageSafety.ts`, and the pornography ban's own
// rule — *"a new surface that takes a prompt is not covered until it calls the triage itself"*). Two
// callers, two triage calls, both on the raw words the caller sent. A test asserts both.

import {
  IMAGE_PRO_TIMEOUT_MS, IMAGE_PRO_POLL_MS, imageProConfigured, imageProEndpoint, imageProAuthHeaders,
  buildImageProRequest, parseImageProResponse, pendingResultUrl, jobFailed, imageProFailureMessage,
  type ImageProMode, type ImageProRequest,
} from './imageProGen';
import { fetchPollinationsPaidImage } from './pollinationsPaid';

/** One delivered picture, as a data URL plus the type it really is. */
export interface DeliveredImage { image: string; mimeType: string }

/**
 * What the engine is asked for.
 *
 * ⚠️ `width`/`height` are NOT on `ImageProRequest` and are carried here instead: they belong to the
 * CUSTOM size path, which both doors resolve into `px` before calling. Widening the shared request
 * type would put two ways to state a size into one object.
 */
export type ProImageInput = ImageProRequest & { width?: number; height?: number };

export type ProImageResult =
  | { ok: true; images: DeliveredImage[] }
  /** Nothing was produced. `status` and `code` are what the route answers with; nothing is charged. */
  | { ok: false; status: number; code: 'pro_failed'; message: string };

function failed(status: number, kind: 'failed' | 'timeout'): ProImageResult {
  return { ok: false, status, code: 'pro_failed', message: imageProFailureMessage(kind) };
}

/**
 * Produce paid images for one request. Never throws; never charges; never reads a wallet.
 *
 * `finalPrompt` is the CRAFTED prompt (the art-direction layer the caller already applied) — this
 * function does not craft, because the two doors word their briefs the same way and the layer belongs
 * with the words, not with the transport.
 */
export async function generateProImages(
  proReq: ProImageInput,
  mode: ImageProMode,
  finalPrompt: string,
  px: { w: number; h: number },
): Promise<ProImageResult> {
  let delivered: DeliveredImage[] = [];

  // RUNG 1 — Pollinations, keyed, from OUR server (admin: "paid me hamari [ip]"). Words only: the
  // keyed door takes a prompt, and an attached photograph goes to the host below, which reads it.
  // A failure here is an ADMIN line (it names the vendor and the status — White-Label §3) and then
  // the host's turn; the user never sees it, and is never charged for it.
  if (mode === 'text-to-image') {
    const pr = await fetchPollinationsPaidImage(finalPrompt, proReq.size, {
      custom: { width: proReq.width, height: proReq.height },
    });
    if (pr.image) {
      delivered = [{ image: `data:${pr.image.mimeType};base64,${pr.image.base64}`, mimeType: pr.image.mimeType }];
      // The provider's own statement of what this picture cost — the number IMAGE_PRO_COST_USD is
      // waiting to be replaced by. Admin-only, one compact line per delivery.
      console.log(`[IMAGE PRO] pollinations delivered — usage ${JSON.stringify(pr.usage ?? {})}`);
    } else if (!pr.disabled) {
      console.warn(`[IMAGE PRO] pollinations rung failed (${pr.error ?? 'unknown'}) — ${
        imageProConfigured() ? 'trying the Pro host' : 'no Pro host configured'}.`);
    }
  }

  // RUNG 2 — the Pro host (`IMAGE_PRO_KEY`), for an edit or when rung 1 could not deliver.
  if (delivered.length === 0) {
    if (!imageProConfigured()) {
      // Rung 1 failed and there is nothing behind it. Nothing was produced, so nothing is charged.
      return failed(502, 'failed');
    }
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
          return failed(502, 'failed');
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
          return failed(502, 'failed');
        }
        if ('url' in parsed) {
          // Server-proxied, exactly like the free provider: the bytes are fetched here and re-served
          // as a data URL, so the user's browser never talks to the vendor and the result carries no
          // third-party origin. White-label is a network fact here, not only a wording one.
          const img = await fetch(parsed.url, { signal: ctl.signal });
          const ct = img.headers.get('content-type') || 'image/png';
          if (!img.ok || !ct.startsWith('image/')) {
            console.error(`[IMAGE PRO] fetching the returned image failed (HTTP ${img.status}, ${ct})`);
            return failed(502, 'failed');
          }
          const buf = Buffer.from(await img.arrayBuffer());
          if (buf.length === 0) return failed(502, 'failed');
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
      return failed(504, aborted ? 'timeout' : 'failed');
    }
  }

  if (delivered.length === 0) return failed(502, 'failed');
  return { ok: true, images: delivered };
}
