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
  /** True when the prompt is clearly for the Indian market (₹ / GST / UPI / Hindi / Aadhaar / …). */
  india: boolean;
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
    // `shop`/`store`/`cart` are boundary-anchored (see the corpus test): unanchored they matched inside
    // "photoshop", "bookstore"/"restore" and "cartoon", turning a drawing app into an ecommerce build.
    re: /\bshops?\b|shopping|\bstores?\b|ecommerce|e-commerce|\bcarts?\b|checkout|\bproduct\b|\border\b|inventory|marketplace|catalog/i,
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
    // `friend` is boundary-anchored: unanchored it matched "mobile-friendly" / "user-friendly", the
    // single most common phrase in a build prompt, so ordinary apps (a to-do list, a calculator, a
    // weather dashboard) were classified as social networks and handed moderation + media upload.
    // `\blike\b` is narrowed to the social SIGNAL (likes / a like button): bare "like" is ordinary
    // English and fired on "a photoshop-like image editor", classifying it as a social network.
    re: /social|\bfeed\b|\bpost\b|follow|\bchat\b|message|comment|\blikes\b|\blike button\b|\bfriends?\b|profile/i,
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
    // `book` is boundary-anchored (it matched "bookstore"), and `table` is DROPPED entirely: a bare
    // "table" is far more often a data/pricing table than a restaurant one, so it turned a data-table
    // component into a reservations app. Genuine table booking still classifies here via `book` /
    // `reserve` / `reservation`, which is what actually carries the booking intent.
    re: /\bbooks?\b|\bbooking\b|reservation|reserve|\bslot\b|rental|\brent\b|ticket/i,
    features: [
      { label: 'availability calendar', re: /calendar|availab|slot|schedul/i },
      { label: 'booking + confirmation', re: /book|reserv|confirm/i },
      { label: 'payments / deposits', re: /pay|payment|deposit|checkout/i },
      { label: 'reminders / notifications', re: /remind|notif|alert|email|sms/i },
      { label: 'cancellation policy', re: /cancel|refund|policy/i },
    ],
  },
  // Appended (2026-07-20) AFTER the domains above so existing classifications never change (first match
  // wins): these only catch prompts the domains above did not. High-demand verticals for the SMB market.
  {
    key: 'education',
    // `\btutor` is closed to `\btutors?\b|tutoring`: the open prefix matched "tutorial", so any app
    // described as having a tutorial was classified as an education platform.
    re: /\bschool\b|college|student|teacher|\bcourse\b|\blms\b|e-?learning|classroom|\bexam\b|\btutors?\b|tutoring|coaching|edtech|syllabus|curriculum/i,
    features: [
      { label: 'roles (student / teacher / admin)', re: /role|rbac|permission|teacher|admin|staff/i },
      { label: 'courses & lessons / content', re: /course|lesson|module|content|curriculum|syllabus/i },
      { label: 'enrolment & attendance', re: /enrol|enroll|attendance|register|roster/i },
      { label: 'assignments & grading', re: /assignment|homework|grade|grading|marks|quiz|\bexam\b/i },
      { label: 'progress tracking', re: /progress|report card|analytics|dashboard/i },
      { label: 'fees / payments', re: /fee|payment|pay|invoice/i },
    ],
  },
  {
    key: 'logistics',
    re: /logistic|delivery|courier|shipment|\bfleet\b|\bdriver\b|dispatch|last.?mile|parcel|consignment|freight|warehouse/i,
    features: [
      { label: 'shipment / order tracking', re: /track|status|trace|realtime|live/i },
      { label: 'driver / agent app & assignment', re: /driver|agent|assign|dispatch|rider/i },
      { label: 'route / delivery management', re: /route|zone|delivery|pickup|drop/i },
      { label: 'proof of delivery (POD)', re: /proof|pod|signature|otp|photo/i },
      { label: 'notifications (customer + driver)', re: /notif|alert|sms|whatsapp|email/i },
      { label: 'admin dashboard & reports', re: /admin|dashboard|report|analytics/i },
    ],
  },
  {
    key: 'restaurant',
    re: /restaurant|\bcafe\b|\bmenu\b|\bdine\b|kitchen|\bkot\b|food.?order|eatery|canteen|\bpos\b|billing/i,
    features: [
      { label: 'menu management', re: /menu|dish|item|category|price/i },
      { label: 'table / order management (dine-in + takeaway)', re: /table|order|takeaway|dine|counter/i },
      { label: 'kitchen order tickets (KOT)', re: /kot|kitchen|prepare|cook/i },
      { label: 'billing & GST invoice', re: /bill|invoice|gst|tax|payment/i },
      { label: 'delivery / online ordering', re: /delivery|online|swiggy|zomato|pickup/i },
      { label: 'staff roles & shifts', re: /staff|role|waiter|cashier|shift/i },
    ],
  },
  // Appended (2026-07-21) — more high-demand SMB verticals. Placed AFTER every domain above so first-match-
  // wins keeps all existing classifications byte-identical (e.g. "rent/ticket" still resolve to booking).
  {
    key: 'fintech',
    re: /fintech|\bwallet\b|\bupi\b|\bloan\b|lending|\bbank(ing)?\b|\bemi\b|insurance|remittance|payout|\bledger\b|expense track|budgeting|neobank|\bkyc\b/i,
    features: [
      { label: 'KYC / identity verification', re: /kyc|verif|identity|aadhaar|pan|document/i },
      { label: 'transaction ledger + statements', re: /ledger|transaction|statement|history|balance/i },
      { label: 'secure auth + 2FA', re: /2fa|otp|two.?factor|mfa|biometric|pin/i },
      { label: 'fraud / limit checks', re: /fraud|limit|risk|suspicious|block/i },
      { label: 'audit log', re: /audit|log|track changes/i },
      { label: 'payments / transfers', re: /pay|payment|transfer|deposit|withdraw|payout/i },
      { label: 'roles (admin / user)', re: /role|rbac|permission|admin/i },
    ],
  },
  {
    key: 'real-estate',
    re: /real.?estate|property|realty|\blisting\b|apartment|\bflat\b|\bvilla\b|broker|landlord|mortgage|homes?\s+for\s+(sale|rent)/i,
    features: [
      { label: 'property listings + photos', re: /listing|property|photo|image|gallery|media/i },
      { label: 'search & filters (price / location / beds)', re: /search|filter|location|price|bedroom|\bbhk\b/i },
      { label: 'map view', re: /map|location|nearby|geo/i },
      { label: 'agent / owner contact + inquiry', re: /contact|inquir|enquir|lead|agent|owner/i },
      { label: 'saved searches / favorites', re: /save|favorite|favourite|wishlist|shortlist/i },
      { label: 'roles (buyer / seller / agent / admin)', re: /role|rbac|buyer|seller|agent|admin/i },
      { label: 'mortgage / EMI calculator', re: /mortgage|emi|loan|calculat/i },
    ],
  },
  {
    key: 'fitness',
    re: /fitness|\bgym\b|workout|\btrainer\b|\byoga\b|wellness|nutrition|\bcalorie|exercise|bodybuild|crossfit|\bpilates\b/i,
    features: [
      { label: 'membership plans + billing', re: /member|plan|subscri|billing|fee|pay/i },
      { label: 'class / session scheduling', re: /class|session|schedul|slot|calendar|book/i },
      { label: 'trainer assignment', re: /trainer|coach|instructor|assign/i },
      { label: 'progress / goal tracking', re: /progress|goal|track|weight|metric|analytics/i },
      { label: 'roles (member / trainer / admin)', re: /role|rbac|member|trainer|admin|staff/i },
      { label: 'attendance / check-in', re: /attendance|check.?in|visit|entry/i },
      { label: 'reminders / notifications', re: /remind|notif|alert|sms|email/i },
    ],
  },
  {
    key: 'events',
    re: /\bevent\b|conference|festival|concert|meetup|webinar|\bexpo\b|\bgala\b|seminar|\bsummit\b/i,
    features: [
      { label: 'event listings + agenda / schedule', re: /listing|agenda|schedul|program|session|speaker/i },
      { label: 'ticket types + capacity', re: /ticket|capacity|seat|tier|pass/i },
      { label: 'registration / RSVP', re: /regist|rsvp|sign.?up|attend/i },
      { label: 'QR check-in', re: /qr|check.?in|scan|entry|badge/i },
      { label: 'payments', re: /pay|payment|checkout|stripe|razorpay/i },
      { label: 'attendee management + roles', re: /attendee|organi[sz]er|role|admin|guest/i },
      { label: 'reminders / notifications', re: /remind|notif|alert|email|sms/i },
    ],
  },
  {
    key: 'jobs',
    re: /\bjob\b|recruit|hiring|\bcareers?\b|applicant|\bresume\b|\bcv\b|vacancy|employer|candidate|\bats\b|job.?board|placement/i,
    features: [
      { label: 'job postings + search / filters', re: /post|listing|search|filter|categor|location/i },
      { label: 'applications + resume upload', re: /appl|resume|\bcv\b|upload|attach/i },
      { label: 'candidate pipeline / stages', re: /pipeline|stage|shortlist|screen|status|track/i },
      { label: 'employer & candidate roles', re: /role|employer|recruiter|candidate|admin/i },
      { label: 'interview scheduling', re: /interview|schedul|slot|calendar/i },
      { label: 'notifications (status updates)', re: /notif|alert|email|update/i },
      { label: 'admin dashboard & reports', re: /admin|dashboard|report|analytics/i },
    ],
  },
  // Appended (2026-07-22, autopsy of buildId a4be5a05) — a textbook CRM prompt ("manage contacts + a sales
  // pipeline, kanban deal stages lead → qualified → won/lost, contact profiles, notes & tasks, pipeline-value
  // dashboard") was misclassified as 'social' because the ONLY firing headline was social's `profile` (from
  // "contact profiles"), so the build was handed social implicit features (realtime feed / moderation / media
  // upload) instead of CRM ones. No CRM domain existed. Placed LAST so best-feature-score keeps every existing
  // classification byte-identical unless a prompt is STRICTLY more CRM than its prior match. Pure + deterministic.
  {
    key: 'crm',
    re: /\bcrm\b|sales pipeline|sales funnel|deal (stage|pipeline|flow)|\bpipeline\b.*\bdeal|\bdeal\b.*\bpipeline|lead.*(qualif|pipeline|convert|nurtur|won|lost)|\b(manage|track)\s+(contacts|leads|deals)|customer relationship/i,
    features: [
      { label: 'contact / lead management (profiles, company, activity history)', re: /contact|lead|customer|client|account|company/i },
      { label: 'sales pipeline with deal stages (kanban: lead → qualified → won/lost)', re: /pipeline|deal|stage|kanban|funnel|opportunit|\bwon\b|\blost\b|qualif/i },
      { label: 'activity timeline, notes & tasks per contact', re: /activit|note|task|follow.?up|reminder|timeline|interaction|\blog\b/i },
      { label: 'pipeline-value dashboard & sales reporting', re: /dashboard|report|pipeline value|revenue|forecast|metric|analytic/i },
      { label: 'search & filters across contacts and deals', re: /search|filter|sort|segment/i },
      { label: 'roles (sales rep / manager / admin)', re: /role|rbac|permission|\brep\b|manager|team|admin/i },
    ],
  },
  // Appended (2026-08-02, autopsy of buildId 858f6d7b) — the to-do / notes / kanban / habit family is one
  // of the MOST-built categories on the platform and had no domain at all, so every such prompt fell to
  // whichever unrelated headline happened to fire (social, via "mobile-friendly"). Even with that keyword
  // bug fixed, the honest outcome would have been `general` — which offers a task app nothing useful.
  // These are the features a task/notes app actually tends to need and prompts routinely leave implicit.
  // Placed LAST so best-feature-score keeps every existing classification unchanged: a CRM prompt that
  // also says "kanban" still resolves to CRM, because CRM scores strictly higher on it.
  {
    key: 'productivity',
    re: /to.?do\b|\btodo\b|task (manager|list|board|track)|\btasks?\b.*\b(list|manage|track|board|categor)|kanban|checklist|\bnotes? app\b|note.?taking|habit track|\bhabits?\b.*\b(track|streak)|productivity app|\bplanner\b|reminder app/i,
    features: [
      { label: 'create / edit / complete / delete items', re: /add|creat|edit|updat|complete|delete|remove|\bcrud\b/i },
      { label: 'categories, tags or lists to organise items', re: /categor|tag|label|list|group|project|folder/i },
      { label: 'filter, sort & search', re: /filter|sort|search|\ball\b|active|done|pending|archiv/i },
      { label: 'persistence (saved across reloads / synced across devices)', re: /save|persist|storage|local.?storage|sync|offline|database|reload/i },
      { label: 'due dates, reminders & notifications', re: /due|deadline|date|remind|notif|alert|schedul|recurring/i },
      { label: 'ordering — drag-and-drop or priority', re: /drag|reorder|priorit|\border\b|rank|move/i },
      { label: 'progress / streaks / completion stats', re: /progress|streak|stat|chart|analytic|complet.*rate|dashboard/i },
    ],
  },
];

const GENERIC_FEATURES: Array<{ label: string; re: RegExp }> = [
  { label: 'user authentication', re: /auth|login|sign.?in|sign.?up|account|user/i },
  { label: 'admin panel', re: /admin|dashboard|manage|backend/i },
];

// M7-S7.1 (India moat) — a prompt clearly for the Indian market. US-centric builders default to $/Stripe/
// English; NavBharatAI's edge is India-first defaults (₹, UPI/Cashfree, GST, Hindi, Aadhaar/PAN).
const INDIA_CONTEXT_RE =
  /\b(india|indian|bharat|desi|hindi|hinglish|marathi|tamil|telugu|bengali|gujarati|kannada|punjabi|odia|malayalam)\b|₹|\brs\.?\b|\binr\b|\bgst\b|\bgstin\b|\bupi\b|aadhaar|aadhar|\bpan\s?card\b|cashfree|razorpay|paytm|phonepe|\blakh\b|\bcrore\b|pincode|\bpin\s?code\b/i;

/** True when the prompt is clearly for the Indian market. Pure. */
export function detectIndiaContext(prompt: string): boolean {
  return INDIA_CONTEXT_RE.test(String(prompt || ''));
}

/**
 * India-first defaults a world-best Indian app builder bakes in by default — the moat US-centric builders
 * (Stripe / USD / English) ignore. Domain tunes which extras apply (GST for commerce, Aadhaar for fintech).
 * Pure.
 */
export function indiaFirstGuidance(domain: string): string {
  const lines = [
    'Use ₹ (INR) with Indian digit grouping (e.g. ₹1,00,000) and DD/MM/YYYY dates — never $ / USD by default.',
    'For payments, default to India-first rails — UPI, and a gateway like Cashfree or Razorpay — not Stripe/PayPal.',
    'Offer a Hindi (or the stated regional language) option for the main UI text where practical.',
  ];
  if (/ecommerce|restaurant|saas|logistics|fintech|real-estate|events|fitness|booking|jobs/.test(domain)) {
    lines.push('Where money changes hands, produce a GST-compliant invoice (GSTIN + tax breakup).');
  }
  if (domain === 'fintech') {
    lines.push('For identity, use Aadhaar / PAN-based KYC (Indian norms) — never SSN.');
  }
  return ['[INDIA-FIRST — build this for the Indian market by default]', ...lines.map((l) => `- ${l}`)].join('\n');
}

/** How specifically a domain fits the prompt: the count of its FEATURE signals present in the text. Used to
 *  pick the BEST-fitting domain rather than merely the FIRST in array order — so a generic domain (ecommerce's
 *  broad "order"/"inventory") can no longer STEAL a more-specific one. Pure. */
function domainFeatureScore(domain: DomainDef, text: string): number {
  let score = 0;
  for (const f of domain.features) if (f.re.test(text)) score++;
  return score;
}

/** Analyze a build prompt for its likely domain, missing features, NFRs and clarifying questions. Pure. */
export function analyzeRequirementGaps(prompt: string): RequirementGaps {
  const text = String(prompt || '');
  // Pick the BEST-matching domain among all whose headline regex fires, scored by how many of its feature
  // signals the prompt hits. Array order breaks ties (`>=` keeps the earlier one), so EVERY existing
  // classification stays byte-identical unless a LATER domain is STRICTLY more specific — the fix for the
  // real misclassification (deep-test 2026-07-21): a restaurant POS ("menu / KOT / table / GST billing")
  // resolved to 'ecommerce' because ecommerce's `\border\b` matched "orders" first, so the build was handed
  // ecommerce implicit features (cart/checkout/refunds) instead of restaurant ones. Pure + deterministic.
  const domain = DOMAINS
    .filter((d) => d.re.test(text))
    .reduce<DomainDef | undefined>(
      (best, d) => (best && domainFeatureScore(best, text) >= domainFeatureScore(d, text) ? best : d),
      undefined,
    );
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
    india: detectIndiaContext(text),
    clarifyingQuestions: clarifyingQuestions.slice(0, 6),
  };
}

/** Whether the analyzed gaps are worth surfacing — a real domain was detected AND there is something
 *  genuinely missing or worth confirming. Keeps the build report (and any future clarification pass)
 *  high-signal: a generic/clear prompt with no domain gaps produces no noise. Pure. */
export function shouldSurfaceRequirementGaps(g: RequirementGaps): boolean {
  return g.domain !== 'general' && (g.likelyMissing.length > 0 || g.clarifyingQuestions.length > 0);
}

/** Build a concise, bounded guidance block that tells the BUILDER to proactively INCLUDE the features a
 *  domain almost always needs but the prompt left implicit — so a rich request never gets a shallow app,
 *  with NO clarifying round-trip (friction-free requirement awareness). Returns '' when there is nothing
 *  worth adding (no domain, or nothing missing), so a clear/generic prompt is left exactly as-is. Pure. */
export function buildRequirementGuidance(g: RequirementGaps): string {
  const parts: string[] = [];
  // Domain feature guidance (unchanged) — only when a real domain has genuinely-missing features.
  if (shouldSurfaceRequirementGaps(g)) {
    const feats = g.likelyMissing.slice(0, 6);
    if (feats.length > 0) {
      parts.push([
        `[REQUIREMENT AWARENESS — this looks like a ${g.domain} app]`,
        `A production ${g.domain} app almost always needs the following, which the request left implicit. INCLUDE them by default (real, wired — never stubbed) unless one is clearly out of scope for what the user asked; if it genuinely does not fit, skip it silently rather than asking:`,
        ...feats.map((f) => `- ${f}`),
      ].join('\n'));
    }
  }
  // M7-S7.1 (India moat): India-first defaults whenever the market is clearly Indian — even for a
  // general-domain prompt, so ₹/UPI/GST/Hindi is the default, not a US-centric $/Stripe/English app.
  if (g.india) parts.push(indiaFirstGuidance(g.domain));
  return parts.join('\n\n');
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
