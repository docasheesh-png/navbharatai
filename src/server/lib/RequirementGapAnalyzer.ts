// T1.4 (roadmap 2026-07-19) — Requirement-gap analyzer (smart-clarification, safe slice).
//
// The audit's #1 category (Requirement Understanding) was thin: no business-logic inference, no domain
// awareness, no clarifying questions — a weak AI builds a login page for "build a hospital system". This
// PURE analyzer reads a build prompt and surfaces, deterministically:
//   • the likely DOMAIN (healthcare / ecommerce / social / saas / booking / …),
//   • the features that domain almost always needs but the prompt may have left implicit (RBAC, audit log,
//     payments, multi-tenant, offline, …), flagged as MENTIONED or LIKELY-MISSING,
//   • the non-functional requirements it can detect (scale, offline, security, i18n),
//   • a short list of high-value CLARIFYING QUESTIONS to ask before building.
// It changes NO build flow — it is a tool the planner can call (or a future clarification pass can consume).
// Real, complete, unit-tested. (The interactive "pause and ask the user" loop is a deliberate follow-up.)

export interface RequirementGaps {
  domain: string;
  mentioned: string[];
  likelyMissing: string[];
  nonFunctional: { scale: boolean; offline: boolean; security: boolean; i18n: boolean };
  clarifyingQuestions: string[];
}

interface DomainDef {
  key: string;
  re: RegExp;
  features: Array<{ label: string; re: RegExp }>;
}

// Each feature carries a regex that decides whether the prompt already MENTIONS it (so we only ask about
// what's genuinely missing). Kept deterministic + dependency-free.
const DOMAINS: DomainDef[] = [
  {
    key: 'healthcare',
    re: /hospital|clinic|patient|\bemr\b|\behr\b|health|medical|doctor|pharmacy|appointment|\blab\b|diagnos/i,
    features: [
      { label: 'role-based access (staff / doctor / admin)', re: /role|rbac|permission|staff|admin|access control/i },
      { label: 'audit log of record changes', re: /audit|history|log|track changes/i },
      { label: 'patient records (EMR) with privacy', re: /emr|ehr|record|history|privacy|hipaa/i },
      { label: 'appointment / scheduling flow', re: /appointment|schedul|booking|calendar|slot/i },
      { label: 'pharmacy / inventory', re: /pharmacy|inventory|stock|medicine|drug/i },
      { label: 'multi-facility / multi-tenant', re: /multi.?(hospital|facility|tenant|branch|clinic)/i },
      { label: 'offline entry (OPD)', re: /offline|sync/i },
    ],
  },
  {
    key: 'ecommerce',
    re: /shop|store|ecommerce|e-commerce|cart|checkout|\bproduct\b|\border\b|inventory|marketplace|catalog/i,
    features: [
      { label: 'payments + refunds', re: /pay|payment|checkout|stripe|razorpay|refund/i },
      { label: 'product catalog + search', re: /catalog|search|filter|browse/i },
      { label: 'cart & checkout', re: /cart|checkout|basket/i },
      { label: 'order management', re: /order|fulfil|shipping|delivery/i },
      { label: 'inventory tracking', re: /inventory|stock/i },
      { label: 'accounts & addresses', re: /account|address|login|profile/i },
    ],
  },
  {
    key: 'social',
    re: /social|\bfeed\b|\bpost\b|follow|\bchat\b|message|comment|\blike\b|friend|profile/i,
    features: [
      { label: 'auth & profiles', re: /auth|login|profile|account/i },
      { label: 'realtime feed / updates', re: /realtime|live|feed|stream/i },
      { label: 'notifications', re: /notif|alert|push/i },
      { label: 'moderation / reporting', re: /moderat|report|block|abuse/i },
      { label: 'media upload', re: /image|photo|video|media|upload/i },
    ],
  },
  {
    key: 'saas',
    re: /\bsaas\b|subscription|\bteam\b|workspace|tenant|\bb2b\b|billing/i,
    features: [
      { label: 'multi-tenant isolation', re: /multi.?tenant|tenant|workspace|organi[sz]ation/i },
      { label: 'team roles (RBAC)', re: /role|rbac|permission|team|member|invite/i },
      { label: 'subscription billing', re: /subscription|billing|plan|pricing|stripe/i },
      { label: 'audit log', re: /audit|activity|history/i },
      { label: 'API keys / webhooks', re: /api key|webhook|integration/i },
    ],
  },
  {
    key: 'booking',
    re: /book|reservation|reserve|\bslot\b|rental|\brent\b|table|ticket/i,
    features: [
      { label: 'availability calendar', re: /calendar|availab|slot|schedul/i },
      { label: 'booking + confirmation', re: /book|reserv|confirm/i },
      { label: 'payments / deposits', re: /pay|payment|deposit|checkout/i },
      { label: 'reminders / notifications', re: /remind|notif|alert|email|sms/i },
      { label: 'cancellation policy', re: /cancel|refund|policy/i },
    ],
  },
];

const GENERIC_FEATURES: Array<{ label: string; re: RegExp }> = [
  { label: 'user authentication', re: /auth|login|sign.?in|sign.?up|account|user/i },
  { label: 'admin panel', re: /admin|dashboard|manage|backend/i },
];

/** Analyze a build prompt for its likely domain, missing features, NFRs and clarifying questions. Pure. */
export function analyzeRequirementGaps(prompt: string): RequirementGaps {
  const text = String(prompt || '');
  const domain = DOMAINS.find((d) => d.re.test(text));
  const feats = domain ? domain.features : GENERIC_FEATURES;

  const mentioned: string[] = [];
  const likelyMissing: string[] = [];
  for (const f of feats) {
    if (f.re.test(text)) mentioned.push(f.label);
    else likelyMissing.push(f.label);
  }

  const nonFunctional = {
    scale: /scale|scalab|concurrent|throughput|\b\d[\d,]{2,}\s*(users|requests)|million|lakh|crore/i.test(text),
    offline: /offline|sync|no internet|poor network/i.test(text),
    security: /secure|security|auth|login|role|permission|encrypt|gdpr|hipaa|dpdp/i.test(text),
    i18n: /language|hindi|hinglish|translat|locale|i18n|multilingual|regional/i.test(text),
  };

  // Ask about the highest-value missing pieces first (cap at 6 so we never over-ask — the admin's rule).
  const clarifyingQuestions: string[] = [];
  for (const label of likelyMissing.slice(0, 4)) clarifyingQuestions.push(`Does it need ${label}?`);
  if (!nonFunctional.security) clarifyingQuestions.push('Who are the user roles, and does it need login / access control?');
  if (!nonFunctional.scale) clarifyingQuestions.push('Roughly how many users / how much data should it handle?');
  if (!nonFunctional.offline && domain?.key === 'healthcare') clarifyingQuestions.push('Does it need to work offline?');

  return {
    domain: domain ? domain.key : 'general',
    mentioned,
    likelyMissing,
    nonFunctional,
    clarifyingQuestions: clarifyingQuestions.slice(0, 6),
  };
}

/** Render the gaps as a compact, human-readable block the planner/agent can act on. Pure. */
export function renderRequirementGaps(g: RequirementGaps): string {
  const nf = Object.entries(g.nonFunctional).filter(([, v]) => v).map(([k]) => k);
  return [
    `Likely domain: ${g.domain}.`,
    g.likelyMissing.length ? `Commonly needed but NOT stated — confirm or assume sensible defaults: ${g.likelyMissing.join('; ')}.` : 'The prompt covers the usual features for this domain.',
    nf.length ? `Non-functional signals present: ${nf.join(', ')}.` : 'No explicit non-functional requirements (scale/offline/security/i18n) — assume sensible defaults.',
    g.clarifyingQuestions.length ? `Questions to confirm before building:\n- ${g.clarifyingQuestions.join('\n- ')}` : '',
  ].filter(Boolean).join('\n');
}
