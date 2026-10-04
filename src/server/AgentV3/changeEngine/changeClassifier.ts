// CHANGE ENGINE — what KIND of change is this edit, and how deep must the engine go for it?
//
// WHY THIS EXISTS (Change Intelligence Engine, slice 1, 2026-10-04). An edit to an existing app used to
// be one undifferentiated thing: `IntentClassifier` decides only chat / new_build / edit_existing, and
// `RequestAnalyser`'s task type exists to pick a model's price, not to decide what must be preserved or
// re-checked. So "make the button blue" and "add Google login" entered the same pipeline with the same
// context and the same checks. A world-best builder treats them differently: the first must be fast and
// touch one file; the second touches auth, routing, env and a provider, and every feature the app
// already had must still be there afterwards.
//
// This module answers that one question, deterministically, from the user's own words. It is PURE (no
// I/O, no model call, ₹0) and it decides only how much the engine LOOKS AT, never what the user gets:
//
//   light    — a micro visual change. The builder gets a one-line summary of the app's requirements.
//   standard — an ordinary local change or feature. The builder gets the requirement ledger.
//   deep     — a change that crosses the app (theme, auth, data, integrations, architecture, security,
//              or a request for many features at once). The builder gets the full ledger, the open
//              issues, and an explicit instruction to name which existing requirements it touches.
//
// 🔒 PRECISION RULE. When signals disagree the HIGHER risk wins. Treating a cross-cutting change as
// micro is the expensive mistake (features silently lost); treating a micro change as deep costs a few
// hundred extra prompt tokens. That asymmetry is the whole design, and the tests lock it.
//
// ⚠️ It is NOT a router. The model ladder, the fast lane and the complexity router are unchanged — this
// classification is recorded (CHANGE_CLASSIFIED) and sizes the change-engine context, nothing else.

import { countEnumeratedFeatures } from '../enumeratedFeatures';

export type ChangeKind =
  | 'micro-ui'
  | 'local'
  | 'feature'
  | 'bug'
  | 'refactor'
  | 'cross-cutting'
  | 'data'
  | 'integration'
  | 'security'
  | 'architectural'
  | 'large';

export type ChangeRisk = 'low' | 'medium' | 'high';
export type ChangeDepth = 'light' | 'standard' | 'deep';

export interface ChangeClassification {
  /** The primary kind — the highest-risk kind the request matched. */
  kind: ChangeKind;
  /** Every kind the request matched, highest risk first (always contains `kind`). */
  kinds: ChangeKind[];
  risk: ChangeRisk;
  depth: ChangeDepth;
  /** Short machine-readable reasons, for the admin report. Never user-facing. */
  reasons: string[];
}

interface KindRule {
  kind: ChangeKind;
  risk: ChangeRisk;
  /** Higher = wins a tie between kinds of the same risk. */
  rank: number;
  re: RegExp;
}

// Order is irrelevant — the winner is chosen by (risk, rank). English + the Hinglish the users type.
const RULES: readonly KindRule[] = [
  {
    kind: 'security', risk: 'high', rank: 9,
    re: /\b(security|secure|vulnerab\w*|xss|csrf|sql ?injection|exploit|hack(?:ed|er)?|leak(?:ed|ing)?|api[ -]?keys?|secrets?|permissions?|rbac|roles? based|access control|rate[ -]?limit\w*|encrypt\w*|password hash\w*)\b/i,
  },
  {
    kind: 'architectural', risk: 'high', rank: 8,
    re: /\b(migrate (?:it |the app )?to|switch (?:it |the app )?(?:to|from) (?:next|nextjs|next\.js|react|vue|svelte|angular|typescript)|convert (?:it |the app )?to (?:typescript|next|react)|rewrite (?:the )?(?:whole|entire|complete) app|monorepo|server[ -]side render\w*|\bssr\b|state management|redux|zustand|add (?:a )?backend|separate (?:the )?(?:frontend|backend)|microservice\w*)\b/i,
  },
  {
    kind: 'integration', risk: 'high', rank: 7,
    re: /\b((?:google|github|facebook|apple|microsoft|twitter|social) (?:login|sign[ -]?in|auth\w*)|sign in with \w+|oauth|razorpay|cashfree|stripe|paypal|payment gateway|upi payment|webhooks?|whatsapp (?:api|integration|message)|send (?:an )?(?:sms|email|otp)|sms|otp|push notifications?|google maps|maps? integration|third[ -]party api|connect (?:to|with) (?:an? )?(?:api|service))\b/i,
  },
  {
    kind: 'data', risk: 'high', rank: 6,
    re: /\b(databases?|db|schema|tables?|columns?|migrations?|supabase|firestore|firebase database|postgres\w*|mysql|mongo\w*|prisma|sql|save (?:it )?(?:to|in) (?:the )?(?:cloud|server|database)|persist\w*|store (?:the )?data|data (?:model|structure))\b/i,
  },
  {
    kind: 'cross-cutting', risk: 'high', rank: 5,
    re: /\b(dark ?mode|light ?mode|themes?|theming|colou?r scheme|i18n|translat\w*|multi[ -]?language|hindi (?:version|language)|responsive|mobile[ -]friendly|accessib\w*|a11y|every ?where|all (?:the )?(?:pages|screens)|whole app|entire app|har (?:page|screen|jagah)|sab (?:jagah|pages?|screens?)|poore? app|navigation|nav ?bar|layout|routing|login|log ?in|sign ?up|authentication|auth)\b/i,
  },
  {
    kind: 'refactor', risk: 'medium', rank: 4,
    re: /\b(refactor\w*|clean ?up (?:the )?code|restructur\w*|reorgani[sz]\w*|split (?:the |this )?(?:file|component)|extract (?:a |the )?(?:component|hook|function)|code quality|improve (?:the )?code)\b/i,
  },
  {
    kind: 'bug', risk: 'medium', rank: 3,
    re: /\b(bugs?|fix(?:es|ed)?|errors?|crash\w*|broken|not working|doesn'?t work|does not work|isn'?t working|kaam nahi|nahi chal|chal nahi|galat|issue|problem|white screen|blank (?:page|screen)|exception|undefined)\b/i,
  },
  {
    kind: 'feature', risk: 'medium', rank: 2,
    re: /\b(add|create|implement|build|make|introduce|enable|support|allow|show|display|banao|bana do|jodo|jod do|daalo|dal do|dikhao|dikha do|chahiye)\b/i,
  },
  {
    kind: 'micro-ui', risk: 'low', rank: 1,
    re: /\b(colou?rs?|rang|red|blue|green|yellow|orange|purple|pink|black|white|gr[ae]y|violet|indigo|teal|neela|laal|hara|peela|kala|safed|font|font[ -]?size|bold|italic|padding|margin|spacing|gap|border|rounded|shadow|align\w*|cent(?:er|re)|bigger|smaller|larger|text|label|wording|title|heading|placeholder|icon|emoji|button (?:text|colou?r|size)|background|bg)\b/i,
  },
];

const RISK_ORDER: Record<ChangeRisk, number> = { low: 0, medium: 1, high: 2 };

/** A request this long, or naming this many features, is a large change whatever its words. */
const LARGE_WORDS = 120;
const LARGE_FEATURES = 4;
/** A micro change is a SHORT request. Beyond this a "colour" word sits inside something bigger. */
const MICRO_MAX_WORDS = 18;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Classify an edit request. Pure; never throws. An empty or non-string request is `local` / standard —
 * the safe middle, never `light` (an unread request must never get the thinnest context).
 */
export function classifyChange(request: unknown): ChangeClassification {
  const text = typeof request === 'string' ? request : '';
  const reasons: string[] = [];
  if (!text.trim()) {
    return { kind: 'local', kinds: ['local'], risk: 'medium', depth: 'standard', reasons: ['empty-request'] };
  }
  const words = wordCount(text);
  let enumerated = 0;
  try { enumerated = countEnumeratedFeatures(text); } catch { enumerated = 0; }

  const matched = RULES.filter((r) => r.re.test(text));
  // A colour word inside a long request is not a micro change — drop the micro match when the request
  // is long, and let whatever else it says decide.
  const effective = words > MICRO_MAX_WORDS ? matched.filter((r) => r.kind !== 'micro-ui') : matched;
  // "Add/make" alone is a weak feature signal. When a micro-ui word is present and nothing stronger is,
  // "make the button blue" is micro — the verb is grammar, not a feature request.
  const nonMicro = effective.filter((r) => r.kind !== 'micro-ui' && r.kind !== 'feature');
  const hasMicro = effective.some((r) => r.kind === 'micro-ui');
  const ruled = hasMicro && nonMicro.length === 0 ? effective.filter((r) => r.kind !== 'feature') : effective;

  const kinds: ChangeKind[] = [];
  const isLarge = words > LARGE_WORDS || enumerated >= LARGE_FEATURES;
  if (isLarge) {
    kinds.push('large');
    reasons.push(words > LARGE_WORDS ? `long-request:${words}w` : `enumerated-features:${enumerated}`);
  }
  const sorted = [...ruled].sort((a, b) => RISK_ORDER[b.risk] - RISK_ORDER[a.risk] || b.rank - a.rank);
  for (const r of sorted) {
    if (!kinds.includes(r.kind)) kinds.push(r.kind);
    reasons.push(`matched:${r.kind}`);
  }
  if (kinds.length === 0) {
    kinds.push('local');
    reasons.push('no-signal');
  }

  const kind = kinds[0];
  const risk: ChangeRisk = kind === 'large' ? 'high' : (RULES.find((r) => r.kind === kind)?.risk ?? 'medium');
  const depth: ChangeDepth = risk === 'high' ? 'deep' : risk === 'low' ? 'light' : 'standard';
  return { kind, kinds, risk, depth, reasons };
}

/** One admin-report line. Never user-facing. */
export function describeChangeClassification(c: ChangeClassification): string {
  const also = c.kinds.slice(1);
  return `Change classified as ${c.kind} (risk ${c.risk}, depth ${c.depth})${also.length ? `; also ${also.join(', ')}` : ''}`;
}
