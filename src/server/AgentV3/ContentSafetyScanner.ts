// AgentV3 — Content Safety Scanner: inspect a RENDERED, about-to-be-PUBLISHED app for abuse.
//
// WHY (hosting Phase A): all three existing scanners (SecurityAnalysis, CodeSafetyScanner,
// PackageSafetyScanner) inspect SOURCE CODE for what it might do to the *builder's* machine. NONE
// look at the shipped page for what it does to the *end user* — so a phishing / credential-harvest /
// crypto-wallet-drainer site could be published on NavBharatAI's hosting, hurting real users and the
// platform's domain reputation. This is that missing layer: it scans the built dist HTML/JS/text for
// the clearest abuse signatures BEFORE the app goes live.
//
// Philosophy (matches CodeSafetyScanner, deliberately CONSERVATIVE): a real login form for the user's
// OWN product must NEVER be flagged. Only unambiguous, high-signal abuse patterns fire. The default
// posture is WARN-ONLY (surface + audit, never block) so a rollout can watch real false-positive rates
// before any blocking is enabled (env AGENTV3_PUBLISH_SCAN=block).

export type ContentFindingSeverity = 'critical' | 'high' | 'medium';

export interface ContentScanFinding {
  severity: ContentFindingSeverity;
  rule: string;
  description: string;
  matchSnippet: string;
}

export interface ContentScanResult {
  /** false when ANY critical/high finding exists (used only when block mode is enabled). */
  safe: boolean;
  findings: ContentScanFinding[];
}

interface ContentRule {
  severity: ContentFindingSeverity;
  id: string;
  description: string;
  test: RegExp;
}

// Per-file scan ceiling so a giant bundle can't blow up the regex pass.
const PER_FILE_MAX = 500_000;
const SCANNED_EXT = /\.(html?|js|mjs|cjs|jsx|ts|tsx|txt)$/i;

const CONTENT_RULES: ContentRule[] = [
  // ── HIGH: crypto seed-phrase / private-key harvest (wallet drainers) — almost never legitimate ──
  {
    severity: 'high',
    id: 'SEED_PHRASE_HARVEST',
    description: 'Collects a wallet seed phrase / recovery phrase / mnemonic — the classic crypto-wallet-drainer scam.',
    test: /\b(seed\s*phrase|recovery\s*phrase|secret\s*recovery\s*phrase|mnemonic\s*phrase|12[\s-]word|24[\s-]word)\b/i,
  },
  {
    severity: 'high',
    id: 'PRIVATE_KEY_HARVEST',
    description: 'Prompts the user to enter their wallet PRIVATE KEY — a wallet-drainer signature.',
    test: /\b(enter|paste|import|type)\b[^<>{}\n]{0,40}\bprivate\s*key\b/i,
  },
  // ── HIGH: brand-impersonation "account suspended / verify" phishing lures ──
  {
    severity: 'high',
    id: 'BRAND_PHISH_LURE',
    description: 'Impersonation lure — a well-known brand plus an "account suspended / verify your account" prompt asking for credentials.',
    test: /\b(paypal|metamask|binance|coinbase|netflix|amazon|microsoft|apple\s*id|google\s*account|whatsapp|instagram|facebook|sbi|hdfc|icici|paytm|phonepe)\b[\s\S]{0,120}\b(account\s*(has\s*been\s*)?(suspended|locked|limited|disabled)|verify\s*your\s*(account|identity)|unusual\s*(sign[\s-]?in|activity)|confirm\s*your\s*password)\b/i,
  },
  // ── MEDIUM: OTP / CVV / full-card capture on a non-payment-processor page ──
  {
    severity: 'medium',
    id: 'SENSITIVE_FINANCIAL_CAPTURE',
    description: 'Captures highly sensitive financial data (CVV / full card number / OTP) directly rather than via a real payment processor.',
    test: /\b(cvv|cvc|card\s*verification)\b[\s\S]{0,60}\b(input|type\s*=|placeholder)/i,
  },
];

/** Decode + concatenate the scannable text of a dist file map (bounded). Pure. */
function scannableText(files: Map<string, Buffer> | null | undefined): string {
  if (!files || files.size === 0) return '';
  const parts: string[] = [];
  for (const [path, buf] of files) {
    if (!SCANNED_EXT.test(path)) continue;
    try {
      parts.push(buf.toString('utf-8').slice(0, PER_FILE_MAX));
    } catch { /* skip a non-utf8 file */ }
  }
  return parts.join('\n');
}

/**
 * Scan a built app's published content for abuse. Pure + deterministic + never throws. `safe` is false
 * only when a critical/high finding exists; the CALLER decides whether to block (block mode) or merely
 * surface it (warn mode, the default).
 */
export function scanPublishedContent(files: Map<string, Buffer>): ContentScanResult {
  const text = scannableText(files);
  const findings: ContentScanFinding[] = [];
  if (!text) return { safe: true, findings };
  for (const rule of CONTENT_RULES) {
    const m = rule.test.exec(text);
    if (m) {
      findings.push({
        severity: rule.severity,
        rule: rule.id,
        description: rule.description,
        matchSnippet: m[0].slice(0, 120),
      });
    }
  }
  const safe = !findings.some((f) => f.severity === 'critical' || f.severity === 'high');
  return { safe, findings };
}

/** Is publish-scan set to hard-BLOCK on an unsafe verdict? Default (unset/anything else) = warn-only. */
export function publishScanBlocks(): boolean {
  return String(process.env.AGENTV3_PUBLISH_SCAN || '').toLowerCase() === 'block';
}

/** One-line honest summary of a scan for narration / audit. '' when clean. */
export function contentScanSummary(result: ContentScanResult): string {
  if (!result.findings.length) return '';
  const top = result.findings[0];
  return `content-safety: ${result.findings.length} finding(s) — [${top.severity}] ${top.rule}: ${top.description}`;
}
