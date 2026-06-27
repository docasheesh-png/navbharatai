// AgentV3 — Smart Planning Gate (Complexity Classifier).
//
// Decides whether a build request needs a planning phase (plan → approval → build)
// or can skip straight to building. Philosophy: optimistic (lean toward skipping).
// Simple apps waste 2-3 minutes on a planning + approval round-trip; complex apps
// genuinely benefit from a plan first.
//
// PURE & synchronous — no I/O, no async. Never throws.

export type PlanningDecision = 'skip' | 'plan';

/** Definite single-screen, no-backend, no-auth utility apps — skip planning. */
const SIMPLE_APP_PATTERNS: RegExp[] = [
  /\btodo\b/i,
  /\bcalculator\b/i, /\bcalc\b/i,
  /\btimer\b/i, /\bstopwatch\b/i, /\bstop.?watch\b/i,
  /\bcounter\b/i,
  /\bnotes?\s+app\b/i,
  /\bclock\b/i,
  /\bquiz\b/i,
  /\bflashcard/i,
  /\bpomodoro\b/i,
  /\bword.?count/i,
  /\bunit.?convert/i,
  /\bcurrency.?convert/i,
  /\btip.?calc/i,
  /\bbmi\b/i,
  /\bdice\b/i,
  /\bcoin.?flip/i,
  /\brandom.?number/i,
  /\bpassword.?gen/i,
  /\bcolor.?pick/i,
  /\bpaint\s+app\b/i,
  /\bsimple\s+\w+\s+app\b/i,
  /\bbasic\s+\w+\s+app\b/i,
  /\bexpense.?track/i,
  /\bbudget.?track/i,
  /\bshopping.?list\b/i,
  /\bweather\s+app\b/i,
  /\bweather\s+display\b/i,
  // Hindi/Hinglish common simple app names
  /\bsaral\b/i,
  /\bchota\s+app\b/i,
];

/**
 * Signals that a request is genuinely complex and will benefit from a plan
 * before the agent dives in — multi-system, multi-screen, non-trivial scope.
 */
const COMPLEXITY_SIGNALS: RegExp[] = [
  // Auth / user management
  /\bauth(entication)?\b/i,
  /\blogin\b/i, /\bsignup\b/i, /\bsign.?up\b/i, /\bregister\b/i,
  /\bpassword\s+reset\b/i,
  /\bjwt\b/i, /\boauth\b/i, /\bsso\b/i,
  /\buser\s+management\b/i, /\buser\s+roles?\b/i,
  // Payments
  /\bpayment\b/i, /\bcheckout\b/i, /\bstripe\b/i, /\brazorpay\b/i,
  /\bcashfree\b/i, /\bsubscription\b/i, /\bbilling\b/i,
  // Backend / data
  /\bdatabase\b/i, /\bsupabase\b/i, /\bfirebase\s+firestore\b/i,
  /\bpostgres\b/i, /\bmongodb\b/i, /\bmysql\b/i,
  /\brest\s+api\b/i, /\bapi\s+server\b/i, /\bbackend\b/i,
  /\bserver.?side\b/i, /\bexpress\s+server\b/i,
  /\bwebsocket\b/i, /\brealtime\b/i, /\breal.?time\b/i,
  // Complex UI / multi-page
  /\bdashboard\b/i, /\badmin\s+panel\b/i, /\badmin\s+dashboard\b/i,
  /\bmulti.?page\b/i, /\bmultiple\s+(pages?|screens?|routes?)\b/i,
  /\brouting\b/i, /\breact.?router\b/i,
  // Analytics / reporting
  /\banalytics\b/i, /\breport\b/i, /\bexport\s+(to\s+)?(csv|pdf|excel)\b/i,
  /\bfile\s+upload\b/i, /\bimage\s+upload\b/i,
  // Multi-user / tenancy
  /\bmulti.?tenant\b/i, /\brole.?based\b/i, /\bpermission(s)?\b/i,
  // Deploy / infra
  /\bdocker\b/i, /\bkubernetes\b/i, /\bci.?cd\b/i,
  // Hindi complexity signals
  /\bpura\s+system\b/i, /\bpuri\s+application\b/i, /\bbahut\s+saari\s+features?\b/i,
  /\bsab\s+kuch\b.*\bapp\b/i,
];

/**
 * Decide if the planning phase should be skipped for a given prompt.
 *
 * 'skip' → go straight to build (saves 2-3 min, no approval gate).
 * 'plan' → show plan, wait for user approval, then build.
 */
export function decidePlanning(prompt: string): PlanningDecision {
  // Any definite complexity signal → always plan
  if (COMPLEXITY_SIGNALS.some(r => r.test(prompt))) return 'plan';

  // Known simple app type → always skip
  if (SIMPLE_APP_PATTERNS.some(r => r.test(prompt))) return 'skip';

  // Short prompts with no complexity → user knows what they want, skip plan
  if (prompt.length < 120) return 'skip';

  // Long prompts likely have many requirements → plan
  if (prompt.length > 400) return 'plan';

  // Default: optimistic skip (agent can handle most well-scoped medium requests)
  return 'skip';
}
