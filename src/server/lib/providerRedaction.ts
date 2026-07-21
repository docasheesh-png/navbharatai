// White-Label Law (CLAUDE.md §2/§4) — the ONE place that scrubs third-party AI/infra vendor identity out of
// any text that could reach an end user. A user must NEVER learn which backend model/provider did the work; to
// them it is always NavBharatAI. Admin-only surfaces (build diagnostics for the admin, logs, telemetry) keep
// the real names — these helpers are ONLY for text/reports a NORMAL end user can see.
//
// Centralised here (rule 4 — one shared implementation, not drifted copies) so the build-report anonymiser
// (Fix 68) and the chat/error anonymiser (Fix 62 `redactProviderError`) apply the SAME redaction by construction.

// Model ids first (so `glm-5.2` doesn't leave a stray `-5.2`), then vendor names, then the Claude tier words.
const MODEL_ID_RE = /\b(?:glm|kimi|claude|gemini|grok|gpt|deepseek|mistral|llama|qwen|nova|titan)[-/][\w.:-]+/gi;
const AI_VENDOR_RE = /\b(?:anthropic|claude|openai|chatgpt|gpt-?\d[\w.-]*|google\s+gemini|gemini|vertex(?:\s*ai)?|xai|grok|moonshot|kimi|z\.?ai|chatglm|glm|deepseek|cohere|mistral|perplexity|bedrock)\b/gi;
const MODEL_TIER_RE = /\b(?:sonnet|opus|haiku)\b/gi; // Claude tier words identify the vendor

/**
 * Scrub every provider/model/secret token out of free text, degrading a vendor name to "NavBharatAI" and a bare
 * model id to a neutral "the model". No length cap — safe for a report root-cause / summary. Returns '' for
 * nullish input.
 */
export function redactProvidersText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/https?:\/\/[^\s)]+/gi, '[link]')                       // URLs, incl. token-embedded clone URLs
    .replace(/x-access-token:[^@\s]+/gi, '[token]')                  // git credential in a remote URL
    .replace(/\b(bearer|token|key|secret|password)[\s:=]+[A-Za-z0-9._\-]{6,}/gi, '$1 [redacted]')
    .replace(MODEL_ID_RE, 'the model')
    .replace(AI_VENDOR_RE, 'NavBharatAI')
    .replace(MODEL_TIER_RE, 'the model')
    .replace(/\bE2B\b/gi, 'the build engine')                       // don't name the infra vendor
    .replace(/\bNavBharatAI(?:\s+NavBharatAI)+\b/g, 'NavBharatAI')  // collapse repeats from adjacent vendor tokens
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * The chat/error variant (Fix 62): same redaction, then capped at 200 chars for a toast/chat line. A raw
 * provider/infra error must never reach a user verbatim.
 */
export function redactProviderError(raw: unknown): string {
  return redactProvidersText(raw).replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** True if any forbidden vendor/model token survives in `s` (used by the regression test + as a guard). */
export function hasProviderLeak(s: string): boolean {
  return /\b(?:glm|kimi|claude|anthropic|sonnet|opus|haiku|gemini|vertex|grok|xai|openai|gpt|deepseek|moonshot|z\.?ai|bedrock|cohere|mistral)\b|(?:glm|kimi|claude|gemini|grok|gpt)[-/][\w.:-]+/i.test(String(s ?? ''));
}
