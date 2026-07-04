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

/** True when the prompt names a genuinely complex, multi-module app category. Pure. */
export function isComplexAppPrompt(prompt: string): boolean {
  return COMPLEX_APP_SIGNAL.test(String(prompt || ''));
}
