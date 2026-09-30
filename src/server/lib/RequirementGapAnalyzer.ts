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

import { withoutUrls } from './promptUrls';
import { indicDomainMatches, usesIndicScript } from './indicDomainTerms';
import { withoutMachineText } from './machineText';

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
    re: /hospital|clinic|patient|\bemr\b|\behr\b|health|medical|doctor|pharmacy|appointment|\blab\b|diagnos|\baspatal\b|\bmareez\b|\bdawai\b|\bdavai\b|\bdavakhana\b|\bilaj\b|\bchikitsa\b|\bswasthya\b|अस्पताल|क्लिनिक|मरीज|दवाई|दवाखाना|इलाज|चिकित्सा|स्वास्थ्य|डॉक्टर/i,
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
    // A STOCK / INVENTORY REGISTER IS NOT A SHOP (autopsy 8e124182, 2026-09-30). With no domain of its own,
    // a stock-inventory app (add items, stock in, stock out, low-stock alerts, Excel export) matched
    // ecommerce on the word "inventory" and would have been told it lacked a cart, checkout and refunds.
    // Deliberately a PHRASE headline, never the bare word: a shop that "tracks inventory" is still a shop,
    // and scores higher on ecommerce's own features anyway. Listed before ecommerce so an exact tie —
    // which only a genuine inventory prompt can produce — goes here.
    key: 'inventory',
    re: /\b(?:stock|inventory)\s+(?:management|manager|register|keeping|control|tracker|tracking|system|app(?:lication)?)\b|\bstock\s+(?:in|out)\b|\b(?:add|reduce|issue|receive)\s+stock\b|\bwarehouse\s+(?:stock|inventory)\b|\bgodown\s+stock\b|स्टॉक/i,
    features: [
      { label: 'stock in / stock out ledger', re: /stock\s*(?:in|out)|add\s+stock|reduce\s+stock|issue|receive|movement|transaction/i },
      { label: 'low-stock alerts', re: /low.?stock|reorder|threshold|alert/i },
      { label: 'items with units + suppliers', re: /unit|vendor|supplier|sku|item/i },
      { label: 'reports & export', re: /report|export|excel|csv|download/i },
      { label: 'audit trail of changes', re: /audit|history|log/i },
      { label: 'roles (who may change stock)', re: /role|rbac|permission|admin|staff/i },
    ],
  },
  {
    key: 'ecommerce',
    // `shop`/`store`/`cart` are boundary-anchored (see the corpus test): unanchored they matched inside
    // "photoshop", "bookstore"/"restore" and "cartoon", turning a drawing app into an ecommerce build.
    re: /\bshops?\b|shopping|\bstores?\b|e[-\s]?commerce|\bcarts?\b|checkout|\bproduct\b|\border\b|inventory|marketplace|catalog|\bdukaan\b|\bdukan\b|\bdukandar\b|\bkirana\b|\bbazaar\b|\bbazar\b|\bsaaman\b|\bsamaan\b|दुकान|दुकानदार|किराना|बाजार|बाज़ार|सामान|ऑर्डर/i,
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
    // ⚠️ `billing` was a HEADLINE word here and in `restaurant` until 2026-09-17, and it cannot select
    // a domain: a shop bills, a restaurant bills, a clinic bills, a freelancer bills. It made
    // "ek dukaan ka billing app banao" a SAAS app — the Hindi half of the same class this file already
    // records for `cart`/`shop`/`friend`, one level up (a word shared by five domains instead of a stem
    // hiding inside another word). It remains a FEATURE regex below, where it belongs: "does this
    // prompt mention billing?" is a real question; "is this a billing app, therefore SaaS?" is not.
    re: /\bsaas\b|subscription|\bteam\b|workspace|tenant|\bb2b\b/i,
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
    re: /\bschool\b|college|student|teacher|\bcourse\b|\blms\b|e-?learning|classroom|\bexam\b|\btutors?\b|tutoring|coaching|edtech|syllabus|curriculum|\bvidyalaya\b|\bpathshala\b|\bpadhai\b|\bshikshak\b|\bchhatra\b|\bkaksha\b|विद्यालय|पाठशाला|पढ़ाई|शिक्षक|छात्र|कक्षा|स्कूल|कॉलेज|परीक्षा/i,
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
    re: /logistic|delivery|courier|shipment|\bfleet\b|\bdriver\b|dispatch|last.?mile|parcel|consignment|freight|warehouse|\bgodown\b|\bvahan\b|\bgaadi\b|\bmaal\b|गोदाम|वाहन|गाड़ी|कूरियर|डिलीवरी/i,
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
    re: /restaurant|\bcafe\b|\bmenu\b|\bdine\b|kitchen|\bkot\b|food.?order|eatery|canteen|\bpos\b|\bdhaba\b|\bbhojan\b|\bkhana\b|\brasoi\b|\bthali\b|\bnashta\b|ढाबा|भोजन|खाना|रसोई|थाली|नाश्ता|रेस्टोरेंट|मेन्यू|मेनू/i,
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
    re: /fintech|\bwallet\b|\bupi\b|\bloan\b|lending|\bbank(ing)?\b|\bemi\b|insurance|remittance|payout|\bledger\b|expense track|budgeting|neobank|\bkyc\b|\budhaar\b|\budhari\b|\bkhata\b|\bbahi\b|\blenden\b|\bbyaj\b|\bkarz\b|\bkist\b|उधार|खाता|बही|लेनदेन|ब्याज|कर्ज|किस्त/i,
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
    re: /real.?estate|property|realty|\blisting\b|apartment|\bflat\b|\bvilla\b|broker|landlord|mortgage|homes?\s+for\s+(sale|rent)|\bmakan\b|\bkiraya\b|\bkirayedar\b|\bzameen\b|\bjameen\b|मकान|किराया|किरायेदार|जमीन|ज़मीन/i,
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
    re: /fitness|\bgym\b|workout|\btrainer\b|\byoga\b|wellness|nutrition|\bcalorie|exercise|bodybuild|crossfit|\bpilates\b|\bvyayam\b|\bkasrat\b|व्यायाम|कसरत|जिम/i,
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
    re: /\bevent\b|conference|festival|concert|meetup|webinar|\bexpo\b|\bgala\b|seminar|\bsummit\b|\bshaadi\b|\bshadi\b|\bvivah\b|\bsamaroh\b|\bmela\b|शादी|विवाह|समारोह|मेला|कार्यक्रम/i,
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
    re: /\bjob\b|recruit|hiring|\bcareers?\b|applicant|\bresume\b|\bcv\b|vacancy|employer|candidate|\bats\b|job.?board|placement|\bnaukri\b|\brozgar\b|\bbharti\b|\bniyukti\b|नौकरी|रोजगार|रोज़गार|भर्ती|नियुक्ति/i,
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
  {
    key: 'game',
    // `\bgames?\b` deliberately does NOT match "gamification" or "gamified" — those are engagement
    // features on an ordinary app, and classifying them as a game would hand the build a game engine.
    // "game plan" is an idiom, not a game — a sales tool must not be handed a game engine.
    re: /\bgames?\b(?!\s+plans?\b)|\bgameplay\b|platformer|\bshooter\b|\brpg\b|roguelike|tower\s?defen[cs]e|endless\s?runner|\barcade\b|\bfps\b|racing\s?game|puzzle\s?game|multiplayer/i,
    features: [
      // What a game prompt almost never says but every finished game needs. Each of these is the
      // difference between a tech demo and something someone plays twice.
      { label: 'win / lose conditions and a reason the run ends', re: /win|lose|lost|game.?over|defeat|victor|objective|goal|survive|complete/i },
      { label: 'scoring or progression the player can see', re: /score|point|level|progress|rank|xp|coin|star|unlock/i },
      { label: 'a difficulty curve — it must get harder', re: /difficult|hard|easy|wave|challeng|curve|progressiv|speed.?up/i },
      { label: 'saving progress between sessions', re: /save|progress|persist|continue|resume|high.?score|checkpoint/i },
      { label: 'touch controls, so it is playable on a phone', re: /touch|mobile|phone|android|\bios\b|joystick|swipe|tap|responsive/i },
      { label: 'sound effects and music', re: /sound|audio|music|\bsfx\b|noise|effect/i },
      { label: 'pause and restart', re: /pause|restart|retry|resume|menu|replay|play.?again/i },
      { label: 'a tutorial or first-run explanation of the controls', re: /tutorial|how to play|instruction|onboard|explain|guide|help/i },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ORDINARY ENGLISH IS NOT A DOMAIN (autopsy of buildId 424ecdab, 2026-09-14).
//
// The user wrote: "You are my ruthless mentor. Dont sugar coat anything. if my idea is weak call it
// trash and tell me why. your job is to tell me until it's a bullet proof." They wanted a persona.
// `\bjob\b` matched "your **job** is to tell me", this analyzer returned `domain: 'jobs'`, and the
// REQUIREMENT-AWARENESS guidance — which is phrased as an instruction ("INCLUDE them by default") —
// was prepended to the build prompt. The model had already read the request correctly ("Got it. I'll
// be your ruthless mentor"), then reversed itself thirty seconds later, in its own words: *"I'm
// treating this as a jobs app (the requirement awareness flagged it)"*. It spent 15.2 minutes
// building a recruitment ATS — login, employer and candidate dashboards, a hiring pipeline,
// interview scheduling — and shipped RED. **Our own injection overrode a correct reading.**
//
// 🔴 WHY THE EXISTING TRIPWIRE COULD NOT CATCH IT, AND WHY THAT IS THE REAL LESSON. The corpus test
// below already calls itself "the tripwire for the whole class", written after the 2026-08-02 autopsy
// where "mobile-friendly" made a to-do list a social network. But every case in it is a SUBSTRING
// failure — `cartoon`/`photoshop`/`friendly`/`portable` — and every fix was a `\b` anchor. `\bjob\b`
// is ALREADY anchored and still wrong, because "job" here is a whole word used as ordinary English.
// The class was never "a stem leaks inside a longer word"; it was "a keyword is also ordinary
// English", of which substrings are one species. Six keywords had been narrowed one at a time
// (`shop`, `store`, `cart`, `friend`, `book`, `table`, `tutor`, `like`, `game plan`) and the class was
// declared closed each time.
//
// 🔬 MEASURED, NOT ASSUMED: swept against 26 innocent sentences a real user types, **22 selected a
// domain** — "good job!" → jobs, "in order to make this faster" → ecommerce, "of course" → education,
// "add a click event listener" → events, "set the CSS property" → real-estate, "add a hamburger menu"
// → restaurant, "send a POST request" → social, "the database driver keeps timing out" → logistics,
// "store the result" → ecommerce, "a team of three developers" → saas. Every one of those would have
// been handed a domain's implicit-feature list to build.
//
// THE FIX, at the level of the class rather than the keyword: ONE shared list of the ways these words
// are used when they do NOT mean the domain, stripped from the text ONCE before any domain is matched,
// by ONE function that both entry points call. A new keyword that leaks adds a line HERE — it does not
// get another negative lookahead buried inside a twelve-alternative headline regex, which is how the
// previous six fixes left no mechanism behind for the seventh.
//
// ⚠️ PRECISION-FIRST, and the asymmetry is why. Missing an idiom costs what we have today. Stripping
// a genuine signal would make a real recruitment app lose its domain — so every entry below matches a
// SPECIFIC construction, never a bare word, and removal only ever DELETES evidence: it cannot invent a
// domain that was not already matching. The genuine-classification corpus is asserted unchanged.
const NON_DOMAIN_USES: RegExp[] = [
  // jobs — a duty, praise, or a background task. None of them is employment.
  /\b(?:your|my|our|his|her|their|its)\s+jobs?\b/gi,
  /\b(?:good|great|nice|excellent|amazing|fine|bad|poor|terrible|lousy)\s+jobs?\b/gi,
  /\bjobs?\s+(?:is|was|are|were)\s+to\b/gi,
  /\b(?:cron|background|scheduled|batch|build|queue|worker|async|print)\s+jobs?\b/gi,
  /\bjobs?\s+(?:queue|runner|scheduler|id)\b/gi,
  // jobs — "resume the build", "resume from where you left off": continue, not a CV.
  /\bresumes?\s+(?:the|this|that|my|our|it|from|where|building|work|again)\b/gi,
  // jobs — resuming MEDIA or a transfer is a player control, not a CV (autopsy 6a4a799f: a music app's
  // "Resume playback" and "Pause/resume" made it a jobs app, and the builder of "Blue Berry" was told to
  // INCLUDE employer & candidate roles and interview scheduling). "upload your resume" keeps its meaning.
  /\bresum(?:e|es|ed|ing)\s+(?:playback|playing|play|music|songs?|tracks?|audio|video|videos|media|podcasts?|episodes?|downloads?|uploads?|streams?|streaming|listening|watching|reading|progress|sessions?|timers?|the\s+(?:song|track|video|download|timer))\b/gi,
  // The separator is OPTIONAL (autopsy e7baf61d, 2026-09-29): a JEE study planner listed its timer's
  // controls one per line — "Start\nPause\nResume\nFinish" — which no separator in the list above could
  // match, and the build was handed employer & candidate roles and job postings to INCLUDE. A control
  // word written on the line next to "resume" is the same player control as one written beside it.
  /\b(?:pause|play|start|stop)\s*(?:\/|and|&|or|,)?\s*resume\b|\bresume\s*(?:\/|and|&|or|,)?\s*(?:pause|finish|stop|end|restart|reset)\b/gi,
  // ANY domain — a CODE CALL written into the prompt is an identifier, never a noun. A spec that lists an
  // API ("speak(text, language) stop() pause() resume()") read as a jobs app off `resume()` (autopsy
  // SignBridge, 2026-09-26) — and the builder of a sign-language translator was told to INCLUDE employer
  // roles, interview scheduling and an admin dashboard. The paren must touch the name (`cart (with
  // checkout)` is prose), and the plural shorthand `product(s)` is prose too, so both are left alone.
  /\b[A-Za-z_$][\w$]*\((?!e?s\))[^()\n]{0,80}\)/g,
  // ecommerce — "store X locally / in IndexedDB / on the device" is PERSISTENCE, never a shop. Same
  // report: "Store translation history locally" was the ecommerce signal.
  /\bstor(?:e|es|ed|ing)\s+(?:[\w-]+\s+){1,4}?(?:locally|offline|on\s+(?:the\s+)?(?:device|phone|disk)|in\s+(?:local\s*storage|indexeddb|the\s+browser|an?\s+database|the\s+database|firestore|supabase|sqlite|memory))\b/gi,
  // social — text on a screen is not a social network. "Use clear messages such as …", "clear status
  // messages", "display messages as chat bubbles" (SignBridge again) describe copy and a visual style;
  // posting, following and friends are what make a social app, and those keep their meaning.
  /\b(?:error|status|clear|warning|success|compatibility|validation|toast|helpful|friendly|system|informative|confirmation|feedback|console|log|commit)\s+messages?\b/gi,
  /\bmessages?\s+(?:such\s+as|like\s*:)/gi,
  /\b(?:display|show|render)\s+(?:the\s+)?messages?\s+as\b/gi,
  /\bchat[- ]bubbles?\b/gi,
  // social — "Proper messages show karo" (autopsy 4499741f): a music player's error-handling section was
  // read as a social network. Messages an app SHOWS its user are copy, in English or Hinglish word order.
  /\b(?:proper|appropriate|meaningful|clear|user[- ]?friendly|helpful|short|simple)\s+(?:error\s+)?messages?\b/gi,
  /\bmessages?\s+(?:show|dikha\w*|display|bata\w*)\b/gi,
  // social — a chat with an AI ASSISTANT is a tool, not a social network (autopsy 466c260a: "pdf,
  // code, file handling, picture editor, pro chat, codestudio" — a productivity workspace — was read
  // as SOCIAL off "pro chat" and its build was told to include auth, a realtime feed, moderation and
  // media upload). Chatting with people ("group chat", "chat with friends", "chat app") keeps its meaning.
  /\b(?:ai|pro|gpt|smart|assistant|bot|llm|help|support|doubt|study|voice)[\s-]+chat(?:bot)?s?\b/gi,
  /\bchat\s*(?:bot|gpt)s?\b|\bchat\s+(?:with|to)\s+(?:an?\s+|the\s+|our\s+)?(?:ai|assistant|bot|gpt|llm|model|pdfs?|documents?|files?)\b/gi,
  /\bthe\s+following\b|\bas\s+follows\b/gi,
  // ecommerce — purpose, arithmetic, sorting, and "store" as the verb.
  /\bin\s+order\s+to\b/gi,
  /\border(?:ed|s)?\s+(?:by|alphabetically|ascending|descending)\b/gi,
  /\bthe\s+products?\s+of\b/gi,
  /\b(?:store|stores|storing|stored)\s+(?:the|this|that|these|those|it|them|all|any|each|every|my|our|your|data|results?|values?|state|items?|files?|everything|locally|in)\b/gi,
  /\b(?:local|session|browser|cloud|object|data|key.?value|file)\s+stores?\b/gi,
  // "Store:" / "Store —" as a heading or an imperative before a list ("Store:\n- provider\n- endpoint")
  // is an instruction to persist, never a shop (build 681bd91b: an AI chat app read as ecommerce, and
  // its build prompt was handed cart, checkout and refunds to include).
  /\bstor(?:e|es|ed|ing)\s*(?::|—|-\s)/gi,
  // fintech — UPI named as one of the ways somebody PAID for what they are recording is a field value,
  // not a payments product (autopsy 2a7fa4b0: "an app to add expenses with … payment method like cash
  // card UPI" was read as FINTECH and its build prompt was told to include KYC, 2FA and fraud checks —
  // for a personal expense tracker). "UPI payment app", "UPI wallet" keep their domain.
  /\bpayment\s+(?:method|mode|type|option)s?\b[^.,;\n]{0,40}/gi,
  /\bcash\b[^.\n]{0,20}\bupi\b|\bupi\b[^.\n]{0,20}\bcash\b/gi,
  // education — "of course" is agreement, not a syllabus.
  /\bof\s+course\b/gi,
  // events — a DOM event is not a conference.
  /\b(?:click|change|input|submit|key(?:board|down|up|press)?|mouse|touch|scroll|focus|blur|drag|drop|custom|dom|browser|window|resize|load)\s+events?\b/gi,
  /\bevents?\s+(?:handler|listener|bubbling|loop|delegation|emitter|target|object)\b/gi,
  /\b(?:add|remove)\s*event\s*listener\b/gi,
  // events — Expo is a React Native TOOLCHAIN, not an exhibition (autopsy 0d297b25: "Act as a senior
  // Expo/React Native Android developer … configure EAS" was read as an EVENTS app and handed "QR
  // check-in"). Only the toolchain's own constructions: "an expo on handicrafts" keeps its domain.
  /\bexpo\s*(?:\/|and|&|\+)\s*react[\s-]?native\b/gi,
  /\breact[\s-]?native\s*(?:\/|and|&|\+|with|using)\s*expo\b/gi,
  /\bexpo[\s-](?:go|sdk|cli|router|eas|dev(?:elopment)?\s+build|prebuild|config|project|app\.json|managed|bare|modules?)\b/gi,
  /\bexpo\s+(?:version|v?\d)/gi,
  /\bexpo-[a-z][\w-]*/gi,
  // real-estate — a CSS/JS property is not a house; "flat" is a layout, not an apartment;
  // "listing" is a rendered list of anything.
  /\b(?:css|style|styling|js|javascript|object|custom|computed)\s+propert(?:y|ies)\b/gi,
  /\bpropert(?:y|ies)\s+(?:name|value|key|of|is|are|on)\b/gi,
  /\bflat\s+(?:design|list|structure|file|rate|array|layout|colou?rs?|hierarchy|style|ui)\b/gi,
  /\b(?:file|code|command|feature|price|product|task|item)\s+listings?\b/gi,
  // social — "social login" / "social sign-in buttons" is a WAY TO SIGN IN (Google, GitHub), and
  // "social icons / links" is a footer. Neither is a social network (autopsy 1a32248f: a login page with
  // "social-login buttons" was read as SOCIAL and told to include a realtime feed, moderation and media
  // upload). "a social network", "social feed", "social app" keep their domain.
  /\bsocial[\s-]*(?:log[\s-]?ins?|sign[\s-]?(?:ins?|ons?|ups?)|auth(?:entication)?|oauth|providers?|buttons?|icons?|links?|handles?|share\s+buttons?|media\s+(?:icons?|links?|handles?|buttons?))\b/gi,
  // social — PUBLISHING TO social media is marketing, not a social network (autopsy a5b661c8,
  // 2026-09-30: "an approval app for plan, design and posting a collection … I am making advt on social
  // media" was read as SOCIAL and handed a realtime feed, notifications and moderation to consider — for
  // a campaign workflow whose users post to Instagram, not to each other). "a social media app", "a
  // social network", "social feed" keep their domain.
  /\b(?:on|to|via|through|across|for)\s+(?:the\s+|my\s+|our\s+)?social[\s-]*media(?:\s+(?:platforms?|channels?|accounts?|pages?|handles?|sites?))?\b/gi,
  /\bsocial[\s-]*media\s+(?:marketing|ads?|advertis(?:ing|ements?)|advts?|campaigns?|posts?|posting|scheduler|scheduling|manager|management|calendar|content|promotions?|presence|strategy|analytics|agency|handles?|accounts?)\b/gi,
  // social — following instructions, an HTTP POST, a user's own profile, and "message" as output.
  /\bfollow(?:s|ing|ed)?\s+(?:the|these|this|those|my|our|your|a|an|it|them|up|along|instructions?|steps?|guidelines?|conventions?|patterns?|rules?)\b/gi,
  /\b(?:http|api|rest|ajax|fetch|axios|curl|a|the)\s+post\s+(?:request|endpoint|route|method|call|body|handler|api)\b/gi,
  /\bposts?\s+(?:request|endpoint|route|method|body|to\s+the\s+api)\b/gi,
  /\b(?:error|success|warning|toast|log|status|commit|alert|confirmation|validation|welcome|greeting)\s+messages?\b/gi,
  /\bmessages?\s+(?:saying|like|that\s+says)\b/gi,
  /\b(?:code|inline|block|html|todo|doc|jsdoc)\s+comments?\b/gi,
  /\b(?:my|your|our|their|his|her|the\s+user'?s?)\s+profile\b/gi,
  // saas — "a team of", "billing" on its own is generic money language.
  /\b(?:a|our|my|your|the|small|large|whole|entire|dev(?:eloper)?|engineering|design|support)\s+teams?\s+of\b/gi,
  /\bteams?\s+(?:of|member)\b/gi,
  // restaurant — a navigation menu is not a food menu; POS is also "position".
  /\b(?:nav(?:igation)?|hamburger|burger|side|slide.?out|drop.?down|context|main|top|bottom|tab|kebab|user|profile|settings?|mobile|left|right)\s*-?\s*menus?\b/gi,
  /\bmenus?\s+(?:bar|item|button|icon|toggle|opens?|closes?)\b/gi,
  // …and a SECTION of an app's navigation named after what it manages (autopsy 8e124182, 2026-09-30): a
  // stock-inventory spec's "Add New Stock Item Menu" / "Reduce Stock Items Menu" was read as a restaurant,
  // and the builder was told to include kitchen order tickets, GST invoices and delivery. A food menu is
  // never an "items menu" — a restaurant writes "menu items".
  /\b(?:items?|stocks?|inventory|products?|reports?|admin|dashboard|options?|actions?|features?|app|sub)\s*-?\s*menus?\b/gi,
  // logistics — a device driver is not a delivery rider.
  /\b(?:device|database|db|odbc|jdbc|display|graphics|printer|audio|network|usb|chrome|web)\s+drivers?\b/gi,
  // booking — a support ticket is not an event ticket; a book is a thing on a shelf.
  /\b(?:support|help.?desk|bug|issue|jira|trouble|service)\s+tickets?\b/gi,
  /\b(?:read|reading|reads|write|writing|wrote|buy|buying|sell|selling|borrow|lend|shelf|library|audio|e-?)\s+books?\b/gi,
  /\bbooks?\s+(?:i'?ve|i\s+have|i\s+read|on\s+my\s+shelf)\b/gi,
  // booking — a book a student STUDIES from (autopsy e7baf61d, 2026-09-29): a JEE planner tracking
  // "Book Progress", "Reference Book" and "Books Completed" across NCERT and HC Verma was read as a
  // booking app, and would have been told to include payments, deposits and a cancellation policy.
  /\b(?:reference|text|study|course|note|exercise|work|practice|question|guide|school|college|coaching|revision)\s*-?\s*books?\b/gi,
  /\bbooks?\s+(?:progress|completed|finished|solved|read|chapters?|summar(?:y|ies)|notes|tracker|tracking|list|wise)\b/gi,
];

/**
 * The text with every ordinary-English use of a domain keyword removed, so no domain can be selected
 * by an idiom, a technical compound, or a verb that happens to spell a noun we care about.
 *
 * 🔒 ONE function, called by BOTH entry points. `analyzeRequirementGaps` and `missingDomainFeatures`
 * carried duplicate domain-selection code already; letting only one of them strip would reproduce this
 * repo's most expensive shape — a fix applied to one of two lanes (see `a38c6fef`). Pure.
 */
export function stripNonDomainUses(input: string): string {
  // A link names a place, never a feature — `play.google.com/store/...` made a search app a shop
  // (a9f8d186 / 33812996). Blanked first, by BOTH helpers two sessions wrote for this class.
  let out = withoutMachineText(withoutUrls(String(input || '')));
  for (const re of NON_DOMAIN_USES) out = out.replace(re, ' ');
  // A prompt that names the React Native toolchain anywhere is using "Expo" as its name every time —
  // "if the project uses Expo, configure EAS" has no construction of its own to match. Conditional on
  // THAT evidence, never a bare-word strip: without it, "expo" keeps its meaning.
  if (REACT_NATIVE_CONTEXT.test(String(text || ''))) out = out.replace(/\bexpo\b/gi, ' ');
  // Same shape for "book": in a prompt about STUDYING, a book is a textbook ("Each book should show
  // Questions Solved" — autopsy e7baf61d), and no construction of its own marks it. Only the NOUN is
  // stripped: "book a session", "book a slot" keep their booking meaning in any context.
  if (STUDY_CONTEXT.test(String(text || ''))) out = out.replace(STUDY_BOOK_NOUN, ' ');
  // Same shape for "chat": in a prompt for an AI ASSISTANT, the chat is the user talking to the AI
  // (autopsy d8ed307a — a Bengali "personal AI Assistant" whose English words were "Chat History", "Chat"
  // and "Clear History" was read as SOCIAL and handed auth, a realtime feed and moderation). Only when
  // nothing says people chat with EACH OTHER — "group chat", "chat with friends", "users can message"
  // keep their meaning in any context.
  const raw = String(text || '');
  if (AI_ASSISTANT_CONTEXT.test(raw) && !PEOPLE_CHAT.test(raw)) out = out.replace(/\b(?:chats?|conversations?|messages?)\b/gi, ' ');
  return out;
}

/** Evidence the product IS an AI assistant, so its "chat" is with the AI (autopsy d8ed307a). */
const AI_ASSISTANT_CONTEXT = /\b(?:(?:personal\s+)?ai[\s-]+(?:assistant|companion|chatbot|tutor|helper)|chat\s*bot|virtual\s+assistant|personal\s+assistant)\b/i;
/** Evidence people talk to each other, which makes an assistant app social after all. */
const PEOPLE_CHAT = /\bgroup\s+chats?\b|\bchat\s+(?:with|between)\s+(?:friends|users|people|members|each\s+other|other\s+users)\b|\b(?:users|members|people)\s+(?:can\s+)?(?:chat|message|talk)\b|\b(?:friends?|followers?|dm|direct\s+messages?)\b/i;

/** Evidence that the prompt is about studying, so a bare "book" is a textbook (autopsy e7baf61d). */
const STUDY_CONTEXT = /\b(?:syllabus|ncert|jee|neet|upsc|cbse|icse|pyqs?|chapters?\s+(?:tracker|completed|wise|list)|study\s+(?:hours?|sessions?|timer|plan|planner|tracker)|exam\s+prep(?:aration)?|revision\s+(?:schedule|system|reminders?))\b/i;
const STUDY_BOOK_NOUN = /\bbooks?\b(?!\s+(?:a|an|the|your|my|now|online|appointments?|slots?|sessions?|tickets?|tables?|rooms?|seats?|classes?|tutors?|demos?)\b)/gi;

/** Evidence that "Expo" in this prompt is the React Native toolchain (autopsy 0d297b25). */
const REACT_NATIVE_CONTEXT = /\breact[\s-]?native\b|\beas\.json\b|\beas\s+(?:build|submit|update|cli)\b|\bconfigure\s+eas\b/i;

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
  const text = String(prompt || '');
  // 🔴 A PROMPT WRITTEN IN AN INDIAN SCRIPT IS AN INDIAN-MARKET PROMPT (2026-09-18). The regex above
  // names the languages in ENGLISH ("hindi", "tamil"), so a prompt typed entirely IN Tamil — or in
  // Devanagari — was not recognised as Indian at all, and `indiaFirstGuidance` never reached the
  // builder: a user who literally typed their own language got $ / Stripe / MM-DD-YYYY defaults. The
  // script test is the most direct evidence there is. See `INDIC_SCRIPT_RE` for the one honest gap
  // (Urdu shares its script with Arabic and Persian, so script alone cannot claim it for India).
  return INDIA_CONTEXT_RE.test(text) || usesIndicScript(text);
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

/**
 * 🔑 THE ONE PLACE A DOMAIN IS CHOSEN. Both readers (the analyzer and the suggestion bulb) called this
 * same filter+reduce inline, so any change to HOW a domain is recognised had to be made twice — the
 * duplication this file already warns about for `stripNonDomainUses`. Centralised when the languages of
 * India were added (2026-09-18), so a script added to `indicDomainTerms` reaches every reader at once.
 *
 * A domain fires when its ENGLISH/Hindi regex matches, OR when the prompt names it in one of the nine
 * Indic scripts. Ties are broken by feature score, and `>=` keeps the EARLIER domain — so every existing
 * classification is byte-identical unless a later domain is strictly more specific. Pure.
 */
function selectDomain(text: string): DomainDef | undefined {
  return DOMAINS
    .filter((d) => d.re.test(text) || indicDomainMatches(d.key, text))
    .reduce<DomainDef | undefined>(
      (best, d) => (best && domainFeatureScore(best, text) >= domainFeatureScore(d, text) ? best : d),
      undefined,
    );
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
  const original = String(prompt || '');
  // Domain matching and feature detection both read the text with ordinary-English uses of domain
  // keywords removed (see NON_DOMAIN_USES). `india` deliberately reads the ORIGINAL: stripping an
  // idiom must never be able to hide "in Hindi" / "₹" and turn an Indian build into a US-centric one.
  const text = stripNonDomainUses(original);
  // Pick the BEST-matching domain among all whose headline regex fires, scored by how many of its feature
  // signals the prompt hits. Array order breaks ties (`>=` keeps the earlier one), so EVERY existing
  // classification stays byte-identical unless a LATER domain is STRICTLY more specific — the fix for the
  // real misclassification (deep-test 2026-07-21): a restaurant POS ("menu / KOT / table / GST billing")
  // resolved to 'ecommerce' because ecommerce's `\border\b` matched "orders" first, so the build was handed
  // ecommerce implicit features (cart/checkout/refunds) instead of restaurant ones. Pure + deterministic.
  const domain = selectDomain(text);
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

  // 🔒 AN APP THE USER DECLARED SINGLE-PERSON HAS NO SECOND PARTY (autopsy e7baf61d, 2026-09-29). A JEE
  // study planner said "No account required" and "Everything stored locally"; the domain list then
  // proposed student / teacher / admin roles, enrolment and fees — every one of which needs a second
  // person and a server the user had just ruled out. The domain is still NAMED (reports read it); only
  // the features and questions it would have ADDED are withdrawn, because the user already answered them.
  if (declaresSinglePersonApp(original)) {
    likelyMissing.length = 0;
    return { domain: domain ? domain.key : 'general', mentioned, likelyMissing, nonFunctional, india: detectIndiaContext(original), clarifyingQuestions: [] };
  }

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
    india: detectIndiaContext(original),
    clarifyingQuestions: clarifyingQuestions.slice(0, 6),
  };
}

/**
 * Did the user declare an app for ONE person — no accounts AND data kept on the device? PURE.
 *
 * Both halves are required, on purpose. "No login needed for customers" alone is a business choosing a
 * frictionless storefront, which still takes payments; "stored locally" alone is a caching remark. Together
 * they rule out every feature that needs a second party (roles, payments, enrolment, employers), because
 * there is nowhere for a second party's data to go.
 */
export function declaresSinglePersonApp(prompt: string): boolean {
  const t = String(prompt || '');
  const noAccount = /\bno\s+(?:user\s+)?(?:accounts?|log\s?-?ins?|sign\s?-?ups?|registration|auth(?:entication)?)\b(?:\s+(?:is\s+)?(?:required|needed|necessary))?|\bwithout\s+(?:an?\s+)?(?:accounts?|log\s?-?in|sign(?:ing)?\s?-?(?:up|in)|registration)\b|\b(?:accounts?|log\s?-?in|sign\s?-?up)\s+(?:is\s+)?not\s+(?:required|needed)\b/i;
  const localOnly = /\b(?:everything|all\s+(?:the\s+)?data|all\s+data|data)\s+(?:is\s+|will\s+be\s+)?(?:stored|saved|kept)\s+(?:locally|on\s+(?:the\s+|my\s+)?(?:device|phone))\b|\boffline\s+(?:database|storage|only)\b|\blocal[- ]only\b|\bstored\s+locally\b/i;
  return noAccount.test(t) && localOnly.test(t);
}

/** Whether the analyzed gaps are worth surfacing — a real domain was detected AND there is something
 *  genuinely missing or worth confirming. Keeps the build report (and any future clarification pass)
 *  high-signal: a generic/clear prompt with no domain gaps produces no noise. Pure. */
export function shouldSurfaceRequirementGaps(g: RequirementGaps): boolean {
  return g.domain !== 'general' && (g.likelyMissing.length > 0 || g.clarifyingQuestions.length > 0);
}

/**
 * Domain feature labels this app does NOT yet have — checked against its REAL source, not just the
 * prompt — for the "what could I build next?" suggestion bulb (admin 2026-08-13).
 *
 * Detects the domain from `appText` (the original intent / summary), then keeps each domain feature whose
 * presence regex fires NOWHERE — neither in the app's files nor in the intent text. So a feature added in
 * a later build turn is correctly treated as already-present and never re-suggested. Pure.
 */
export function missingDomainFeatures(appText: string, source: string): { domain: string; labels: string[] } {
  const text = stripNonDomainUses(String(appText || ''));
  const src = String(source || '');
  const domain = selectDomain(text);
  // The same single-person rule as `analyzeRequirementGaps`: the suggestion bulb must not offer roles or
  // payments to an app its user declared has no accounts and keeps its data on the device.
  if (declaresSinglePersonApp(String(appText || ''))) return { domain: domain ? domain.key : 'general', labels: [] };
  const feats = domain ? domain.features : GENERIC_FEATURES;
  const labels = feats.filter((f) => !f.re.test(src) && !f.re.test(text)).map((f) => f.label);
  return { domain: domain ? domain.key : 'general', labels };
}

/** Build a concise, bounded guidance block that tells the BUILDER to proactively INCLUDE the features a
 *  domain almost always needs but the prompt left implicit — so a rich request never gets a shallow app,
 *  with NO clarifying round-trip (friction-free requirement awareness). Returns '' when there is nothing
 *  worth adding (no domain, or nothing missing), so a clear/generic prompt is left exactly as-is. Pure. */
/**
 * Did the user state the app's SIZE themselves — "a simple daily habit tracker", "a basic calculator",
 * "chhota sa notes app", "keep it simple"? PURE, precision-first.
 *
 * 🔴 AUTOPSY 12c642ed (2026-09-30). The prompt was *"Build a simple daily habit tracker"* followed by
 * the four things it should do. The domain half below then told the builder that "a production
 * productivity app almost always needs" categories and tags, filter, sort and search, due dates and
 * reminders, and drag-and-drop ordering — INCLUDE them by default. The builder read that block as
 * *"the explicit requirements from the request block"*, built all nine, and a 3-minute estimate
 * became 13.7 minutes plus a 184-second styling heal for 41 classes nobody asked for.
 *
 * The requirement-aware switch exists so an AMBIGUOUS domain prompt ("hospital app") is not built
 * shallow. A user who says "simple" has answered the scope question already; adding a domain's
 * features on top overrules the one sentence about size they wrote.
 *
 * ⚠️ The size word must describe the thing being built (within a few words of an app noun), and a
 * "simple but …" / "simple yet …" is not a scope limit — "a simple but complete CRM" asks for more.
 */
const SMALL_SCOPE_WORD = String.raw`(?:simple|basic|minimal|minimalist|small|tiny|lightweight|bare[- ]?bones|no[- ]frills|chhota|chota|chhoti|choti|sadharan|saadharan|saada|sada)`;
const APP_NOUN = String.raw`(?:app|apps|application|web ?app|website|site|page|tool|tracker|game|list|calculator|dashboard|form|planner|manager|timer|counter|to-?do|notes?|blog|portfolio|journal|diary|quiz|clock|widget|landing)`;
const SMALL_SCOPE_RE = new RegExp(String.raw`\b${SMALL_SCOPE_WORD}(?:\s+sa|\s+si)?\s+(?!(?:but|yet|though|however)\b)(?:[\w'-]+\s+){0,3}${APP_NOUN}\b`, 'i');
const KEEP_IT_SIMPLE_RE = /\bkeep\s+(?:it|this|the\s+(?:app|ui|design))\s+(?:very\s+|really\s+)?(?:simple|basic|minimal)\b/i;

export function userAskedForSmallScope(prompt: string): boolean {
  const text = String(prompt ?? '');
  return SMALL_SCOPE_RE.test(text) || KEEP_IT_SIMPLE_RE.test(text);
}

export function buildRequirementGuidance(
  g: RequirementGaps,
  opts: { userAskedForAnApp?: boolean; userAskedForSmallScope?: boolean } = {},
): string {
  const parts: string[] = [];
  // 🔒 THE SECOND LAYER (autopsy 424ecdab, 2026-09-14). The keyword fix above stops an idiom SELECTING
  // a domain; this stops a domain — however it was selected — being turned into an INSTRUCTION on a turn
  // where the user never asked for an app at all.
  //
  // The two halves of this block are not equally dangerous and are no longer gated together:
  //   • the DOMAIN half INVENTS an app ("a production jobs app almost always needs… INCLUDE them by
  //     default"). On a persona or chat turn that is the sentence that built a recruitment ATS for
  //     someone who asked for a mentor, and it outranked the model's own correct reading.
  //   • the INDIA half invents nothing — it restates the market the user's own words already named
  //     (₹ / GST / UPI / Hindi) and can only change FORMATTING. It stays ungated, so a request that
  //     says "in ₹" keeps Indian rails whatever the lane decides.
  //
  // ⚠️ The caller passes the answer to "did the user ask for an app to be PRODUCED?" — deliberately a
  // different question from `intent` ("which lane runs this turn?"). Reusing one verdict for two
  // questions is the documented shape that let a later widening silently cancel an earlier narrowing
  // (see `userAskedForAnAppToBeBuilt`). Defaults to TRUE so every existing caller — and
  // `renderRequirementGaps`, which only describes — behaves byte-identically.
  const askedForAnApp = opts.userAskedForAnApp !== false;
  // Domain feature guidance — only when a real domain has genuinely-missing features AND an app was asked for.
  // A user who stated the size ("a simple habit tracker") has already answered the scope question —
  // see `userAskedForSmallScope`. The India half below is unaffected: it invents no feature.
  if (askedForAnApp && opts.userAskedForSmallScope !== true && shouldSurfaceRequirementGaps(g)) {
    const feats = g.likelyMissing.slice(0, 6);
    if (feats.length > 0) {
      parts.push([
        `[REQUIREMENT AWARENESS — this looks like a ${g.domain} app]`,
        `A production ${g.domain} app almost always needs the following, which the request left implicit. INCLUDE them by default (real, wired — never stubbed) unless one is clearly out of scope for what the user asked; if it genuinely does not fit, skip it silently rather than asking:`,
        // These are OUR suggestions. The builder once described them to the user as "the explicit
        // requirements from the request block" (autopsy 12c642ed).
        `(These are NavBharatAI's suggestions, not the user's words — never describe them as something the user asked for, and never let them displace or delay what the user did ask for.)`,
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
