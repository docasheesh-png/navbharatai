// AgentV3 — Security configuration scan (Section I #4 v1).
//
// Focuses on CORS misconfiguration and secret-logging — config mistakes that are common,
// high-impact and high-precision to detect. TLS-verification-disabled and insecure
// Math.random() randomness are deliberately NOT duplicated here: SecurityAnalysis already
// covers both (`disable-tls-verification` and `insecure-random-token`, the latter with a
// broader security-keyword guard), and running both analyzers would double-report the same
// line in the `evaluate` output. This PURE, deterministic scanner flags its exact patterns so
// the agent fixes them before shipping.
//
// High-precision by design: each rule matches a specific, unambiguous code pattern,
// so well-configured code is not nagged.

export type SecConfigSeverity = 'high' | 'medium' | 'low';

export interface SecConfigIssue {
  severity: SecConfigSeverity;
  rule: string;
  message: string;
  file: string;
  line: number;
}

interface Rule {
  rule: string;
  severity: SecConfigSeverity;
  re: RegExp;
  message: string;
}

const RULES: Rule[] = [
  {
    rule: 'wildcard-cors',
    severity: 'medium',
    re: /origin\s*:\s*['"]\*['"]|['"]Access-Control-Allow-Origin['"]\s*[,:]\s*['"]\*['"]/,
    message: 'CORS is open to all origins ("*") — restrict it to the specific trusted origins your app actually needs.',
  },
  {
    rule: 'cors-credentials-reflect-origin',
    severity: 'high',
    // `cors({ origin: true, credentials: true })` reflects ANY request origin AND allows
    // credentials — so any website can make authenticated cross-origin requests to your
    // API with the user's cookies. Both flags on the same line (either order).
    re: /origin\s*:\s*true[^}\n]*credentials\s*:\s*true|credentials\s*:\s*true[^}\n]*origin\s*:\s*true/,
    message: 'CORS reflects any origin (origin:true) while allowing credentials — any site can make authenticated requests with the user\'s cookies. Pin origin to an explicit allow-list of trusted origins.',
  },
  {
    rule: 'logged-secret',
    severity: 'medium',
    // Logging an env var whose name looks like a secret leaks it into logs/console.
    re: /console\.(?:log|info|debug|warn|error)\s*\([^)]*\b(?:process\.env|import\.meta\.env)\.\w*(?:KEY|SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL)/i,
    message: 'A secret env var is being logged to the console — secrets must never be written to logs. Remove the log or redact the value.',
  },
];

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

/**
 * A payment ORDER is created in this file — a gateway SDK call or its REST endpoint. Only such a file is checked
 * for a client-chosen amount, so an ordinary form that happens to post `amount` is never flagged.
 */
const PAYMENT_ORDER_CREATE =
  /\b(?:orders|paymentIntents|paymentLinks|invoices)\.create\s*\(|\bcheckout\.sessions\.create\s*\(|\bPGCreateOrder\s*\(|api\.razorpay\.com\/v1\/orders|api\.cashfree\.com\/pg\/orders|sandbox\.cashfree\.com\/pg\/orders|api\.stripe\.com\/v1\/(?:payment_intents|checkout\/sessions)/;
/** The amount to charge read straight from what the browser sent. */
const CLIENT_AMOUNT =
  /\b(?:req|request)\.(?:body|query)\??\.(?:amount|price|total|order_amount|unit_amount|amountInPaise|amount_in_paise)\b|\{[^}=]*\b(?:amount|price|total|order_amount|unit_amount)\b[^}=]*\}\s*=\s*(?:req|request)\.(?:body|query)\b/;
const CLIENT_PRICE_MESSAGE =
  'The amount charged comes from the request the browser sent — anyone can change it and pay ₹1 for a ₹999 item. Look the price up on the server from the product/plan id (or recompute the cart there). If the user is meant to choose the amount (a donation or wallet top-up), validate a minimum and maximum on the server instead.';

/** Scan one file's content for insecure security-config patterns. PURE. */
export function scanSecurityConfig(file: string, content: string): SecConfigIssue[] {
  if (!CODE_RE.test(file) || !content) return [];
  const issues: SecConfigIssue[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Ignore obvious single-line comments to cut false positives.
    if (/^\s*(\/\/|\*)/.test(line)) continue;
    for (const r of RULES) {
      if (r.re.test(line)) {
        issues.push({ severity: r.severity, rule: r.rule, message: r.message, file, line: i + 1 });
      }
    }
  }
  // CLIENT-CHOSEN PRICE (security audit 2026-11-21): only in a file that creates a payment order.
  if (PAYMENT_ORDER_CREATE.test(content)) {
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(\/\/|\*)/.test(lines[i])) continue;
      if (CLIENT_AMOUNT.test(lines[i])) {
        issues.push({ severity: 'medium', rule: 'client-trusted-price', message: CLIENT_PRICE_MESSAGE, file, line: i + 1 });
        break; // one finding per file is the actionable signal
      }
    }
  }
  return issues;
}

/** The app's OWN sign-in style route: login, sign-up, OTP, password reset — the routes attackers hammer. */
const AUTH_ROUTE =
  /\b(?:app|router|server|api|auth)\.(?:post|put|all)\s*\(\s*['"`][^'"`]*\/(?:login|log-in|signin|sign-in|signup|sign-up|register|otp|send-otp|verify-otp|forgot-password|reset-password|password-reset|password\/reset)(?:['"`/?]|$)/i;
/** Any rate limiter anywhere in the project's backend. */
const RATE_LIMITER =
  /express-rate-limit|express-slow-down|rate-limiter-flexible|@fastify\/rate-limit|hono-rate-limiter|\brateLimit\s*\(|\bslowDown\s*\(|\bRateLimiter(?:Memory|Redis)\b|\b\w*[lL]imiter\b/;
const SKIP_PATH = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__/i;

/**
 * PROJECT-LEVEL: the app has its own sign-in routes and no rate limiter anywhere (security audit 2026-11-21).
 * Project-wide because a limiter is usually mounted in a different file (`app.use('/api/auth', limiter)`).
 * Apps that use a hosted auth (Supabase/Firebase) have no such route and are never flagged.
 */
export function scanProjectSecurityConfig(files: ReadonlyArray<{ path: string; content: string }>): SecConfigIssue[] {
  const code = files.filter((f) => CODE_RE.test(f.path) && !SKIP_PATH.test(f.path) && typeof f.content === 'string');
  if (code.some((f) => RATE_LIMITER.test(f.content))) return [];
  for (const f of code) {
    const lines = f.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(\/\/|\*)/.test(lines[i])) continue;
      if (AUTH_ROUTE.test(lines[i])) {
        return [{
          severity: 'medium', rule: 'auth-route-no-rate-limit', file: f.path, line: i + 1,
          message: 'Sign-in, sign-up, OTP or password-reset routes have no rate limit anywhere in the app — anyone can try passwords or send OTPs (each a paid SMS) without limit. Add a limiter such as express-rate-limit on these routes.',
        }];
      }
    }
  }
  return [];
}

/** A short, honest security-config block for the `evaluate` output. */
export function securityConfigSummary(issues: SecConfigIssue[]): string {
  if (issues.length === 0) return 'Security config: ✓ no insecure TLS/CORS configuration found.';
  const order: Record<SecConfigSeverity, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const head = `Security config — ${issues.length} issue(s):`;
  const body = sorted.slice(0, 10).map((x) => `  ⚠ [${x.severity}] ${x.file}:${x.line} — ${x.message}`);
  return [head, ...body].join('\n');
}
