import type { Express, Request, Response } from 'express';
import { buildRateLimiter, enforceNotBanned } from '../lib/authMiddleware';
import { validateBody, vobject, vrecord } from '../lib/validate';
import { VirtualFileSystem } from '../project/ProjectModel';
import { reviewCode } from '../pro/ProCodeReview';
import { aiRouter } from '../lib/aiRouter';
import { sendSafeError } from '../lib/httpError';
import type { ModelCall } from '../project/aiEdits';

/**
 * Connect-App Code Review — POST /api/app-review/review
 *
 * The "Connect App" flow in the AI Code Review tool sends the REAL source files of a
 * connected app (a NavBharatAI app the user built, or a GitHub repo fetched via
 * /api/github/fetch) here. This runs the SAME real AI reviewer that the G5 post-build
 * quality gate uses (`reviewCode` → OWASP security + quality + performance + tech-debt +
 * accessibility) and returns structured findings + a real 0-100 score.
 *
 * Gated like its AI siblings (repo-analyst / build): rate-limited + not-banned, and it runs
 * on the cheap FREE routing tier (GLM/Kimi — never NavBharatAI's flagship/Claude) so an
 * on-demand review can't bleed the model budget (the reason the old unauthenticated
 * /api/pro/code-review was retired).
 */

/**
 * Bound the review payload to real, reviewable source files: drop non-string/empty entries
 * and vendored/build artifacts, cap the file count and per-file size. Pure + exported so the
 * bound is unit-tested. reviewCode applies its own 20-file / 3k-char cap on top of this.
 */
export function filesForReview(input: Record<string, unknown> | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object') return out;
  let count = 0;
  for (const [path, content] of Object.entries(input)) {
    if (count >= 60) break;
    if (typeof path !== 'string' || typeof content !== 'string') continue;
    if (!content.trim()) continue;
    if (/node_modules|\.min\.|(^|\/)dist\/|\.lock$|\.map$|\.(png|jpe?g|gif|svg|ico|woff2?|ttf|eot)$/i.test(path)) continue;
    out[path] = content.length > 20_000 ? content.slice(0, 20_000) : content;
    count++;
  }
  return out;
}

const schema = vobject({
  files: vrecord(),
});

// Cheap-tier real AI model call: tier 'navbharat' maps to the FREE router namespace
// (GLM/Kimi — "FREE must never reach Claude"), so this on-demand tool can't bleed the
// flagship model budget.
const reviewModelCall: ModelCall = (system, user) => aiRouter.route(user, [], 'navbharat', undefined, system);

export function registerAppReviewRoutes(app: Express): void {
  app.post('/api/app-review/review', buildRateLimiter(), enforceNotBanned(), validateBody(schema), async (req: Request, res: Response) => {
    const files = filesForReview((req.body as { files?: Record<string, unknown> }).files);
    if (Object.keys(files).length === 0) {
      return res.status(400).json({ error: 'No source files to review. Pick an app that actually contains code.' });
    }
    try {
      const result = await reviewCode(VirtualFileSystem.fromRecord(files), reviewModelCall);
      // Honest-failure detection: reviewCode swallows a busy/unparseable model reply into a
      // neutral fallback (empty findings + "structured output unavailable"). Surface that as a
      // real error instead of a fabricated score, per the "no fake success" rule.
      const looksLikeFallback = result.findings.length === 0 && /structured output unavailable/i.test(result.summary);
      if (looksLikeFallback) {
        return res.status(503).json({ error: "NavBharatAI's engine is busy right now — please run the review again in a minute." });
      }
      return res.json(result);
    } catch (err: unknown) {
      return sendSafeError(res, 503, 'Code review could not complete right now. Please try again.', err, 'app review');
    }
  });
}
