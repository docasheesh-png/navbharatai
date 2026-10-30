// WHITE-LABEL LAW (owner, 2026-10-30): a user must only ever see "NavBharatAI" — never the
// backend vendor / model that served a request. This is the ONE shared list + scrubber used by
// the server (error JSON + stream error/status events) and the client (error bubbles / toasts).
// Real names stay in server logs and admin-only panels; those never go through this.
// Pure and dependency-free so both bundles can import it.

export const VENDOR_BRAND_PATTERNS: readonly RegExp[] = [
  /\bz\.ai\b/gi,
  /\bzhipu(?:\s*ai)?\b/gi,
  /\bglm(?:-?[a-z]?[0-9][0-9.a-z-]*|\s[a-z]?[0-9](?:\.[0-9]+)?[a-z]?(?![0-9]))?(?:[-\s](?:flash(?:x)?|pro|lite|mini|turbo|air|chat|coder|instruct))*\b/gi,
  /\bkimi(?:-?[a-z]?[0-9][0-9.a-z-]*|\s[a-z]?[0-9](?:\.[0-9]+)?[a-z]?(?![0-9]))?(?:[-\s](?:flash(?:x)?|pro|lite|mini|turbo|air|chat|coder|instruct))*\b/gi,
  /\bmoonshot(?:\s*ai)?\b/gi,
  /\banthropic\b/gi,
  /\bclaude(?:-?[a-z]?[0-9][0-9.a-z-]*|\s[a-z]?[0-9](?:\.[0-9]+)?[a-z]?(?![0-9]))?(?:[-\s](?:flash(?:x)?|pro|lite|mini|turbo|air|chat|coder|instruct))*\b/gi,
  /\b(?:sonnet|opus|haiku)\b/gi,
  /\bgoogle\s+gemini\b/gi,
  /\bgemini(?:-?[a-z]?[0-9][0-9.a-z-]*|\s[a-z]?[0-9](?:\.[0-9]+)?[a-z]?(?![0-9]))?(?:[-\s](?:flash(?:x)?|pro|lite|mini|turbo|air|chat|coder|instruct))*\b/gi,
  /\bvertex(?:\s*ai)?\b/gi,
  /\bgrok(?:-?[a-z]?[0-9][0-9.a-z-]*|\s[a-z]?[0-9](?:\.[0-9]+)?[a-z]?(?![0-9]))?(?:[-\s](?:flash(?:x)?|pro|lite|mini|turbo|air|chat|coder|instruct))*\b/gi,
  /\bx\.?ai\b/gi,
  /\bdeepseek(?:-?[a-z]?[0-9][0-9.a-z-]*|\s[a-z]?[0-9](?:\.[0-9]+)?[a-z]?(?![0-9]))?(?:[-\s](?:flash(?:x)?|pro|lite|mini|turbo|air|chat|coder|instruct))*\b/gi,
  /\bopen\s?ai\b/gi,
  /\bchat\s?gpt\b/gi,
  /\bgpt[-\s]?[0-9o][0-9.a-z-]*(?:[-\s](?:mini|turbo|nano))*\b/gi,
  /\bopen\s?router\b/gi,
  /\bgroq\b/gi,
  /\bdeep\s?infra\b/gi,
  /\bcloudflare(?:\s+workers?)?(?:\s+ai)?\b/gi,
  /\bworkers\s+ai\b/gi,
  /\bcheaper\s?inference\b/gi,
  /\bsurplus\b/gi,
  /\b(?:aws\s+)?bedrock\b/gi,
  /\b(?:amazon\s+nova|nova\s+sonic)\b/gi,
  /\bsonic\b/gi,
  /\bpollinations(?:\.ai)?\b/gi,
  /\bE2B\b/g,
];

/** Replace every backend vendor/model name with "NavBharatAI" (collapsing repeats). */
export function scrubVendorBrands(text: string): string {
  if (typeof text !== 'string' || !text) return text;
  let s = text;
  for (const re of VENDOR_BRAND_PATTERNS) { re.lastIndex = 0; s = s.replace(re, 'NavBharatAI'); }
  return s.replace(/NavBharatAI(?:[\s/,|·-]+NavBharatAI)+/g, 'NavBharatAI');
}

/** True when the text names any backend vendor/model. */
export function mentionsVendorBrand(text: unknown): boolean {
  if (typeof text !== 'string' || !text) return false;
  return VENDOR_BRAND_PATTERNS.some((re) => { re.lastIndex = 0; return re.test(text); });
}

/** Fields of an error / status payload that a user can read. Answer content is NOT here. */
export const USER_VISIBLE_ERROR_FIELDS = ['error', 'message', 'reply', 'detail', 'details', 'summary', 'label', 'reason', 'hint', 'notice', 'title', 's'] as const;

/** Return a copy with vendor names scrubbed from user-visible string fields (nested ok, bounded). */
export function scrubVendorBrandsInPayload<T>(payload: T, depth = 0): T {
  if (depth > 4 || payload == null) return payload;
  if (typeof payload === 'string') return scrubVendorBrands(payload) as unknown as T;
  if (Array.isArray(payload)) return payload.map((v) => scrubVendorBrandsInPayload(v, depth + 1)) as unknown as T;
  if (typeof payload !== 'object') return payload;
  const out: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (key === 'model' || key === 'provider' || key === 'providerName' || key === 'modelName') {
      if (typeof v === 'string' && mentionsVendorBrand(v)) out[key] = 'navbharatai';
    } else if ((USER_VISIBLE_ERROR_FIELDS as readonly string[]).includes(key)) {
      out[key] = scrubVendorBrandsInPayload(v, depth + 1);
    } else if (v && typeof v === 'object' && (key === 'error' || key === 'failure')) {
      out[key] = scrubVendorBrandsInPayload(v, depth + 1);
    }
  }
  return out as T;
}
