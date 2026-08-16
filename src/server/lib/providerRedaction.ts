// White-Label Law (CLAUDE.md §2/§4) — the ONE place that scrubs third-party AI/infra vendor identity out of
// any text that could reach an end user. A user must NEVER learn which backend model/provider did the work; to
// them it is always NavBharatAI. Admin-only surfaces (build diagnostics for the admin, logs, telemetry) keep
// the real names — these helpers are ONLY for text/reports a NORMAL end user can see.
//
// Centralised here (rule 4 — one shared implementation, not drifted copies) so the build-report anonymiser
// (Fix 68) and the chat/error anonymiser (Fix 62 `redactProviderError`) apply the SAME redaction by construction.

/**
 * Provider API HOSTNAMES — scrubbed FIRST, and the ordering is the whole point.
 *
 * FOUND 2026-08-16, auditing "F12 me dikh jata hai ki kaun sa AI use ho raha hai". The URL rule below
 * only catches a full `https://…`, but a NETWORK error prints a BARE host — `getaddrinfo ENOTFOUND
 * open.bigmodel.cn`, `ECONNREFUSED api.anthropic.com:443` — and those are the likeliest crash messages
 * of all. `open.bigmodel.cn` survived redaction completely; `api.moonshot.cn` came out as
 * "api.NavBharatAI.cn", which is arguably worse — mangled AND still obviously a vendor host.
 *
 * 🔒 THIS MUST RUN BEFORE the vendor-name pass. Otherwise "moonshot" inside the host is replaced first
 * and the hostname is left as recognisable wreckage rather than removed.
 *
 * ⚠️ `e2b.app` / `e2b.dev` are DELIBERATELY ABSENT. That domain is the user's OWN live preview URL —
 * they must be able to open it. The infra vendor's NAME is degraded separately (\bE2B\b below), which
 * is the part that identifies the vendor; the preview host is the user's own working link.
 */
const PROVIDER_HOST_RE = new RegExp(
  String.raw`\b(?:[\w-]+\.)*(?:` + [
    String.raw`anthropic\.com`,
    String.raw`openai\.com`,
    String.raw`generativelanguage\.googleapis\.com`,
    String.raw`aiplatform\.googleapis\.com`,
    String.raw`bigmodel\.cn`,
    String.raw`z\.ai`,
    String.raw`moonshot\.(?:cn|ai)`,
    String.raw`x\.ai`,
    String.raw`deepseek\.com`,
    String.raw`mistral\.ai`,
    String.raw`cohere\.(?:com|ai)`,
    String.raw`bedrock-runtime\.[\w-]+\.amazonaws\.com`,
  ].join('|') + String.raw`)(?::\d+)?\b`,
  'gi',
);

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
    .replace(PROVIDER_HOST_RE, 'the AI service')                     // bare vendor hosts (see the note above) — BEFORE the name pass
    .replace(/https?:\/\/[^\s)]+/gi, '[link]')                       // URLs, incl. token-embedded clone URLs
    .replace(/x-access-token:[^@\s]+/gi, '[token]')                  // git credential in a remote URL
    .replace(/\b(bearer|token|key|secret|password)[\s:=]+[A-Za-z0-9._\-]{6,}/gi, '$1 [redacted]')
    .replace(MODEL_ID_RE, 'the model')
    .replace(AI_VENDOR_RE, 'NavBharatAI')
    .replace(MODEL_TIER_RE, 'the model')
    // Don't name the infra vendor — but NEVER inside the preview HOST. `e2b.app` is the user's own
    // live app URL, and the bare `\bE2B\b` rule used to rewrite it to "the build engine.app", i.e. a
    // dead link. Latent until now only because the preview URL travels as a structured `preview` event
    // rather than inside redacted prose; the moment any narration mentioned it, the link broke.
    .replace(/\bE2B\b(?!\.(?:app|dev))/gi, 'the build engine')
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
  // Hosts are checked too — a guard that disagreed with the scrubber would pass text the scrubber
  // would have cleaned, which is the worst of both.
  if (PROVIDER_HOST_RE.test(String(s ?? ''))) { PROVIDER_HOST_RE.lastIndex = 0; return true; }
  PROVIDER_HOST_RE.lastIndex = 0;
  return /\b(?:glm|kimi|claude|anthropic|sonnet|opus|haiku|gemini|vertex|grok|xai|openai|gpt|deepseek|moonshot|z\.?ai|bedrock|cohere|mistral)\b|(?:glm|kimi|claude|gemini|grok|gpt)[-/][\w.:-]+/i.test(String(s ?? ''));
}
