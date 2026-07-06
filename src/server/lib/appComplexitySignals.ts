// Shared complex-app category signal — the SINGLE source of truth for "this prompt describes a
// genuinely large, multi-module app" (SaaS, CRM, e-commerce, social network, full-stack, …).
//
// WHY THIS EXISTS (root-cause of a real drift bug): two independent detectors used to keep their own
// keyword lists and disagreed on the same prompt —
//   • RequestAnalyser.RE.complexApp (request TIER) classified "build a SaaS CRM" as `complex_app`, but
//   • BuildTimeEstimator.complexityFromPrompt (pipeline DEPTH + ETA) scored it magnitude 2 → the `fast`
//     lane, so a genuinely complex full-stack build was denied the deep pipeline (blueprint + 1.5×
//     wall-clock) and showed a wildly optimistic ETA.
// Both now read THIS regex, so they can never drift apart and route the same prompt two different ways.
// Pure, dependency-free, unit-tested. It is a SUPERSET of the historical RE.complexApp alternatives
// (every prior match is preserved) plus a few unambiguous app-category signals (crm, erp, marketplace,
// food delivery, ride-hailing) that both detectors previously missed.
export const COMPLEX_APP_SIGNAL =
  /\b(full[- ]?stack|full app|complete app|saas|crm|erp|dashboard|admin panel|authentication|auth|login system|signup|payment|stripe|razorpay|checkout|e-?commerce|marketplace|database|backend|rest api|graphql|multi[- ]?page|multi[- ]?file|crud|real[- ]?time|websocket|chat app|social|booking|inventory|food[- ]?delivery|ride[- ]?hailing)\b/i;

/**
 * Page-scoped deliverables — the request is for ONE static/marketing page, however it's themed.
 * "SaaS landing page" is a landing page ABOUT a SaaS, not a SaaS platform.
 */
export const PAGE_DELIVERABLE_SIGNAL =
  /\b(landing page|portfolio (page|site|website)|single page|one[- ]pager?\b|one[- ]page (site|website|app)|simple website|coming[- ]soon page|splash page)\b/i;

/**
 * Pure DOMAIN/THEME words: they name what an app is ABOUT, not what must be BUILT. Only used to
 * discount a theme word on a page-scoped deliverable; scope words (auth, database, backend, payment,
 * checkout, real-time, …) are never discounted. /g is safe here — used only in String.replace.
 */
const CATEGORY_THEME_WORDS = /\b(saas|crm|erp|e-?commerce|marketplace|social|food[- ]?delivery|ride[- ]?hailing)\b/gi;

/**
 * True when the prompt names a genuinely complex, multi-module app to BUILD. Pure.
 *
 * ROOT CAUSE this guards (build report 2026-07-06): "Make a modern SaaS landing page…" matched the
 * category word `saas` and was classified complex_app/deep — a ONE-page marketing site was sent to
 * the multi-agent blueprint pipeline (148 steps, 29 min, died at the wall clock) instead of the
 * ~2-min fast lane. The category word describes the page's THEME, not its SCOPE. So: when the
 * deliverable is page-scoped, strip pure theme words and only stay "complex" if a real build-scope
 * signal remains ("SaaS landing page with login system and stripe checkout" stays complex).
 */
export function isComplexAppPrompt(prompt: string): boolean {
  const p = String(prompt || '');
  if (!COMPLEX_APP_SIGNAL.test(p)) return false;
  if (PAGE_DELIVERABLE_SIGNAL.test(p)) {
    return COMPLEX_APP_SIGNAL.test(p.replace(CATEGORY_THEME_WORDS, ' '));
  }
  return true;
}
