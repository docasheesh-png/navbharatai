// THE WHITE-LABEL LAW, ON THE CLIENT — one place that decides what a user is allowed to read about
// the engine, so a NavBharatAI label is applied BY CONSTRUCTION rather than remembered per call site.
//
// 🔴 THE BLUNDER THAT FORCED THIS (admin, 2026-09-14, from his own phone):
//   "navbharatai -> settings -> live metrics. live metric me PROVIDER KA NAAM SHOW HO RAHA HAI!
//    maine kaha tha — kahi bhi kisi bhi prkar se real background provider ai ka naam show nahi hona
//    chahiye (white labeling karni hai)."
//
// He is right, and the sweep that followed found the leak he saw was NOT the worst one:
//
//   1. Settings -> Live Metrics printed the raw provider key ("KIMI") as a row heading. Admin-gated
//      (the tab needs `isAdmin` and the route needs an admin token), so no ordinary user ever saw it
//      — but it lived inside the USER-facing settings component, one boolean away from being real.
//   2. 🔴 **The POWER SELECTOR, which every user opens and which is gated on NOTHING**, printed the
//      vendor's own tier words straight into its description line: "Normal — balanced (Sonnet)",
//      "Sonnet · 100%", "Opus · medium effort", "Opus · ultracode (max effort)".
//
// The second one is the real breach, and its shape is worth recording: the FIRST tier was already
// white-labelled correctly ("Free engine — fast & lightweight") and the other four were not. Somebody
// applied the rule to one branch of a five-branch ternary. That is precisely what a choke point
// prevents and what a per-call-site habit cannot.
//
// ⚠️ WHAT THIS MODULE IS **NOT** FOR. A user naming a third-party AI they are adding to THEIR OWN app
// — the API marketplace, the BYO-key recipes, the IDE's own provider picker — is not a leak and must
// never be scrubbed. Those are the user's integrations, bought and paid for by them. The law covers
// which engine NAVBHARATAI ran, never which engine the user chose.
//
// PURE — no React, no I/O, so every rule is unit-testable.

/** What NavBharatAI's engine is called, everywhere a user can read it. */
export const PUBLIC_ENGINE_NAME = 'NavBharatAI';

/**
 * The user-facing description of a build power tier.
 *
 * The wording is not invented here: it is the vocabulary `AppKnowledgeBase.ts` has described the power
 * selector with since it was written — "fast economy engine", "the standard engine, adaptive", "a
 * stronger engine, pinned for the whole build", "most capable engine at higher reasoning effort",
 * "maximum effort (ultracode)". The UI was the surface that disagreed with our own documentation, so
 * the fix is to make the UI say what the documentation already promised.
 *
 * 🔒 It keeps every fact a user actually needs — relative strength, whether the tier is pinned, and
 * how much reasoning effort it spends. None of that requires a vendor's name.
 */
export function publicTierLabel(powerLevel: string | null | undefined): string {
  switch (powerLevel) {
    case 'weak':
      return 'Free engine — fast & lightweight';
    case 'off':
      return 'Normal — balanced, adapts to the job';
    case 'mini':
      return 'Stronger engine · pinned 100% of the build';
    case 'medium':
      return 'Most capable engine · higher reasoning effort';
    case 'max':
      return 'Most capable engine · maximum effort (ultracode)';
    default:
      // An unknown tier must never fall through to a vendor string. Naming nothing is always safe.
      return 'NavBharatAI engine';
  }
}

/**
 * Every token that identifies a third-party AI vendor, model family or Claude tier word.
 *
 * Exported so the regression test scans for exactly what this module promises to keep out, rather
 * than for a second list that could drift from it. Mirrors `server/lib/providerRedaction.ts`, which
 * does the same job for server text — the two are deliberately the same vocabulary.
 */
export const PROVIDER_IDENTITY_RE =
  /\b(?:anthropic|claude|openai|chatgpt|gpt-?\d[\w.-]*|gemini|vertex|xai|grok|moonshot|kimi|z\.?ai|chatglm|glm|deepseek|cohere|mistral|perplexity|bedrock|sonnet|opus|haiku)\b/i;

/** Does this string name a vendor, model family or tier word a user must never be shown? */
export function namesAProvider(text: unknown): boolean {
  return PROVIDER_IDENTITY_RE.test(String(text ?? ''));
}
