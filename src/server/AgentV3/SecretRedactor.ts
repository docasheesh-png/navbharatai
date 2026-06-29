// AgentV3 — secret redaction for tool output (R1.1, roadmap §3.2).
//
// Tool results (bash stdout/stderr, file reads, error messages) flow back to BOTH
// the model transcript AND the user's screen. A command that accidentally prints an
// API key, a `.env` value, or a connection string would otherwise leak that secret
// into the visible transcript forever. redactSecrets() masks the most common secret
// shapes BEFORE they are shown or persisted.
//
// Design goals:
// - HIGH PRECISION over recall: only mask things that are almost certainly secrets
//   (known provider key prefixes, obvious `SECRET=value` assignments, credentials in
//   URLs, private-key blocks, JWTs). False positives would corrupt legitimate output
//   the agent needs, so we deliberately do NOT mask arbitrary high-entropy strings.
// - Never throw: redaction must never break a build. Any failure returns input as-is.
// - Idempotent: re-running on already-redacted text changes nothing.

const PLACEHOLDER = '[REDACTED:%s]';

function mask(kind: string): string {
  return PLACEHOLDER.replace('%s', kind);
}

/**
 * Provider-specific API-key shapes. Each entry is a high-precision regex for a known
 * key format — matching one of these is strong evidence of a real secret.
 */
const PROVIDER_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  // OpenAI / Anthropic style: sk-... (incl. sk-ant-, sk-proj-). >= 20 trailing chars.
  { kind: 'api-key', re: /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}\b/g },
  // xAI / Grok
  { kind: 'api-key', re: /\bxai-[A-Za-z0-9]{20,}\b/g },
  // Google API key
  { kind: 'google-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // AWS access key id
  { kind: 'aws-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  // GitHub tokens (PAT, OAuth, server-to-server, refresh, fine-grained)
  { kind: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
  { kind: 'github-token', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
  // Slack tokens
  { kind: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  // Stripe live/test secret keys
  { kind: 'stripe-key', re: /\b(?:r|s)k_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  // Google OAuth client secret
  { kind: 'google-oauth', re: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g },
  // SendGrid
  { kind: 'sendgrid-key', re: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g },
];

/** Multi-line / structural secret blocks handled separately (need the `m`/`s` flags). */
const BLOCK_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  // PEM private key blocks (RSA/EC/OPENSSH/generic).
  {
    kind: 'private-key',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  },
  // JWTs: three base64url segments. Require a reasonably long signature to avoid
  // matching innocuous dotted identifiers.
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

/**
 * Credentials embedded in a URL: scheme://user:password@host → mask only the password.
 * Keeps the rest of the URL readable (host/path are useful, password is the secret).
 */
const URL_CRED_RE = /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/:@]+):([^\s/@]+)@/g;

/**
 * Generic `KEY=value` / `KEY: value` assignments where the KEY name strongly implies a
 * secret. Masks the value only. Quotes (if present) are preserved around the placeholder.
 * The value must be non-trivial (>= 6 chars) to skip empty/placeholder assignments.
 */
const SECRET_KEY_NAME = /(?:secret|password|passwd|pwd|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth[_-]?token|client[_-]?secret|credential|conn(?:ection)?[_-]?string)/i;
const ASSIGNMENT_RE = new RegExp(
  // (1:key)(2:sep)(3:gap-ws)(4:quote)(5:value)(\4:matching close quote)
  `\\b([A-Za-z0-9_.-]*${SECRET_KEY_NAME.source}[A-Za-z0-9_.-]*\\s*)([=:])(\\s*)(['"]?)([^\\s'"\`]{6,})(\\4)`,
  'gi',
);

/**
 * Mask secrets in a block of text. High-precision: only well-known secret shapes and
 * explicit secret-named assignments are masked. Returns the input unchanged on any error
 * or when given a non-string.
 */
export function redactSecrets(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) {
    return typeof input === 'string' ? input : String(input ?? '');
  }
  try {
    let out = input;

    // 1. Structural blocks first (private keys, JWTs) — before token-level passes.
    for (const { kind, re } of BLOCK_PATTERNS) {
      out = out.replace(re, mask(kind));
    }

    // 2. Provider key shapes.
    for (const { kind, re } of PROVIDER_PATTERNS) {
      out = out.replace(re, mask(kind));
    }

    // 3. Credentials inside URLs (mask the password segment only).
    out = out.replace(URL_CRED_RE, (_m, prefix: string) => `${prefix}:${mask('credential')}@`);

    // 4. Secret-named assignments (KEY=value / KEY: value) — preserve original spacing/quotes.
    out = out.replace(ASSIGNMENT_RE, (_m, key: string, sep: string, gap: string, q: string) =>
      `${key}${sep}${gap}${q}${mask('secret')}${q}`,
    );

    return out;
  } catch {
    return input;
  }
}

/** True if redacting `input` would change it (i.e. it contains a detectable secret). */
export function containsSecret(input: unknown): boolean {
  return typeof input === 'string' && redactSecrets(input) !== input;
}

/**
 * P-AI.6 — general PII patterns (India-focused), separate from secret/API-key shapes. Used to
 * mask personal data in USER-UPLOADED content (documents, pasted code/data) before it enters the
 * transcript/model context or logs. Ordered email → PAN → IFSC → Aadhaar → phone so longer/structured
 * shapes match before the looser phone pattern.
 */
const PII_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // PAN: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).
  { kind: 'pan', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  // IFSC: 4 letters, '0', 6 alphanumerics (e.g. HDFC0001234).
  { kind: 'ifsc', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  // Aadhaar: 12 digits (first 2-9), optionally space/hyphen-grouped 4-4-4.
  { kind: 'aadhaar', re: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g },
  // Indian mobile: 10 digits starting 6-9, optional +91 / 0 prefix.
  { kind: 'phone', re: /\b(?:\+?91[\s-]?|0)?[6-9]\d{9}\b/g },
];

/**
 * Mask personal data (email / PAN / IFSC / Aadhaar / phone) in a block of text. Higher recall than
 * `redactSecrets` (PII is worth masking even at some false-positive cost). Never throws; returns the
 * input unchanged on error or non-string.
 */
export function redactPII(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) {
    return typeof input === 'string' ? input : String(input ?? '');
  }
  try {
    let out = input;
    for (const { kind, re } of PII_PATTERNS) out = out.replace(re, mask(kind));
    return out;
  } catch {
    return input;
  }
}

/** True if `input` contains detectable PII. */
export function containsPII(input: unknown): boolean {
  return typeof input === 'string' && redactPII(input) !== input;
}

/**
 * Recursively redact every string leaf in a value (object / array / string). Used to clean a
 * tool-call INPUT object (e.g. a bash command that inlines a key) before it is shown to the user.
 * Non-string leaves pass through unchanged. Never throws; returns the input as-is on error.
 * Bounded depth guards against pathological/cyclic structures.
 */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  try {
    if (typeof value === 'string') return redactSecrets(value);
    if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = redactDeep(v, depth + 1);
      }
      return out;
    }
    return value;
  } catch {
    return value;
  }
}
