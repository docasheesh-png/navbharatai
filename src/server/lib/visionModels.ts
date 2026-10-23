// Single source of truth for VISION-capable model ids (env-overridable).
//
// ROOT CAUSE this module fixes (2026-07-02): every vision call site hardcoded
// 2024-era model ids — `claude-3-5-sonnet-20241022`, `grok-2-vision-1212`,
// `gemini-2.0-flash(-001)`, `gemini-1.5-*` — which the providers have since
// RETIRED. Every image/PDF read therefore 404'd at the provider, every chain
// fell through all providers, and ALL AI surfaces (Free chat, Pro chat, SDA,
// Pro v5.0) answered "unable to read files" even though plain text worked
// (text paths lead with current model ids). Centralising the ids here — with
// env overrides so the admin can bump models WITHOUT a code change — prevents
// the same silent rot from recurring in five different files.
//
// Every helper returns CURRENT model ids (verified against the live text
// paths already working in production: grok-3/grok-4, gemini-2.5-*, the
// Claude 4.x family used by AgentV3).

/** Which wallet pays for this vision call. 'free' = NavBharatAI's own money on a Free user. */
export type VisionTier = 'free' | 'paid';

/**
 * 🔒 FREE-TIER VISION ALLOWLIST (admin 2026-10-23). Free image/PDF reads go GLM-4.6V-flash ($0) →
 * gemini-2.5-flash-lite → gemini-2.5-flash, and NOTHING dearer. Enforced HERE, on the resolved list,
 * so the Google doors on Free ALWAYS use this fixed cheap order — `VISION_VERTEX_MODELS` /
 * `VISION_GEMINI_MODELS` / `VISION_GROK_MODELS` tune the PAID tier only and can never add
 * `gemini-2.5-pro`, Grok or Claude to a Free call. `VISION_GLM_MODELS` may only narrow GLM to its
 * free `*v-flash` ids (an override with none falls back to `glm-4.6v-flash`).
 */
export const FREE_VISION_PAID_MODELS: readonly string[] = Object.freeze(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
const FREE_GLM_VISION = /^glm-[\w.]*v-flash$/i;

function freeOnly(list: string[], allowed: (m: string) => boolean, fallback: readonly string[]): string[] {
  const kept = list.filter(allowed);
  return kept.length > 0 ? kept : [...fallback];
}

function fromEnvList(envVal: string | undefined, fallback: string[]): string[] {
  const list = (envVal || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : fallback;
}

/** Claude model for cheap file DESCRIPTION (v5.0 attachment describe). Vision + PDF capable. */
export function claudeVisionModel(): string {
  return process.env.VISION_CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
}

/**
 * Claude model for a full ANSWER that includes the attachment (Pro chat / SDA / vision chain
 * replies, where the model's reply IS what the user reads — quality tier, not describe tier).
 */
export function claudeVisionAnswerModel(): string {
  return process.env.VISION_CLAUDE_ANSWER_MODEL || 'claude-sonnet-4-6';
}

/**
 * GLM (Z.AI) vision models, tried in order. Images only. Leader: `glm-4.6v-flash` — served at
 * $0 in / $0 out on Z.AI (verified against the official pricing page, 2026-07-11), so free-tier
 * image turns cost NavBharatAI nothing (NAVBHARATAI_ROUTING_PLAN.md §1 row 3). Self-gates on
 * GLM_API_KEY at the call site; on failure/rate-limit the chain falls to Vertex/Gemini as before.
 */
export function glmVisionModels(tier: VisionTier = 'paid'): string[] {
  const list = fromEnvList(process.env.VISION_GLM_MODELS, ['glm-4.6v-flash']);
  return tier === 'free' ? freeOnly(list, m => FREE_GLM_VISION.test(m), ['glm-4.6v-flash']) : list;
}

/** Grok vision-capable models, tried in order. Images only — Grok does not read PDFs. */
export function grokVisionModels(tier: VisionTier = 'paid'): string[] {
  return tier === 'free' ? [] : fromEnvList(process.env.VISION_GROK_MODELS, ['grok-4']); // never on Free
}

/** API-key Gemini vision models (images AND PDFs), tried in order. */
export function geminiVisionModels(tier: VisionTier = 'paid'): string[] {
  if (tier === 'free') return [...FREE_VISION_PAID_MODELS]; // VISION_*_MODELS tunes PAID only
  return fromEnvList(process.env.VISION_GEMINI_MODELS, ['gemini-2.5-flash', 'gemini-2.5-pro']);
}

/** Vertex (service-account) Gemini vision models (images AND PDFs), tried in order. */
export function vertexVisionModels(tier: VisionTier = 'paid'): string[] {
  if (tier === 'free') return [...FREE_VISION_PAID_MODELS]; // VISION_*_MODELS tunes PAID only
  return fromEnvList(process.env.VISION_VERTEX_MODELS, ['gemini-2.5-flash', 'gemini-2.5-pro']);
}
