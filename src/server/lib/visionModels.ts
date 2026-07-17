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
export function glmVisionModels(): string[] {
  return fromEnvList(process.env.VISION_GLM_MODELS, ['glm-4.6v-flash']);
}

/** Grok vision-capable models, tried in order. Images only — Grok does not read PDFs. */
export function grokVisionModels(): string[] {
  return fromEnvList(process.env.VISION_GROK_MODELS, ['grok-4']);
}

/** API-key Gemini vision models (images AND PDFs), tried in order. */
export function geminiVisionModels(): string[] {
  return fromEnvList(process.env.VISION_GEMINI_MODELS, ['gemini-2.5-flash', 'gemini-2.5-pro']);
}

/** Vertex (service-account) Gemini vision models (images AND PDFs), tried in order. */
export function vertexVisionModels(): string[] {
  return fromEnvList(process.env.VISION_VERTEX_MODELS, ['gemini-2.5-flash', 'gemini-2.5-pro']);
}
