// AgentV3 — Product Understanding: requirement coverage (Phase 10 v1).
//
// The #1 rule is "real features only — nothing half-done". A build can pass every
// technical gate (compiles, no security issues) and STILL have silently skipped a
// feature the user explicitly asked for. This PURE, deterministic analyser compares
// the user's original request against what was actually built (the project graph's
// components, routes and file names — names only, never file bodies) and flags any
// clearly-named feature that was requested but has no matching surface.
//
// Advisory, high-precision and conservative: it only knows a curated set of common,
// high-signal app surfaces (login, dashboard, cart, …), only fires when such a
// surface is named in the request, and is silent before anything is built — so it
// never nags a solid build and never invents requirements.

import type { ProjectGraph } from './WorkspaceMemory';
import { isAffirmativelyRequested } from './featureRequest';

export interface RequirementFinding {
  level: 'medium';
  feature: string;
  message: string;
  /**
   * True when the file BODIES were searched and the feature's implementation was not found there
   * either — so "missing" is a checked fact, not merely "no file is named after it".
   *
   * This is the difference between a finding worth ACTING on and one worth only mentioning. Until
   * bodies were readable this module could never tell those apart, which is exactly why an
   * explicitly-requested feature could be reported missing, be right, and still be ignored.
   */
  confirmed: boolean;
}

export interface RequirementCoverageReport {
  /** Feature labels detected in the request. */
  requested: string[];
  /** Requested features with a matching component/route/file. */
  covered: string[];
  /** Requested features with no matching surface. */
  missing: string[];
  /**
   * The subset of `missing` whose absence was CONFIRMED against the file bodies. These are the ones
   * a repair pass may safely act on; the rest stay advisory, as this module always has been.
   */
  confirmedMissing: string[];
  findings: RequirementFinding[];
}

interface FeatureSpec {
  label: string;
  /** Fires when the user's request mentions this feature. */
  request: RegExp;
  /** Matches a built component/route/file name that satisfies it. */
  artifact: RegExp;
  /**
   * Matches the feature's implementation INSIDE a file body, for a feature built inline under no
   * name of its own. See `analyzeRequirementCoverage`'s `sources` argument for why this exists.
   * Deliberately absent for features that always own a file (a dashboard, an about page) — an
   * evidence pattern with nothing distinctive to match on would only add false negatives.
   */
  evidence?: RegExp;
}

// Curated, high-signal app surfaces only. Each `artifact` is deliberately broad
// (synonyms) so a feature built under a reasonable alternate name still counts.
const FEATURES: FeatureSpec[] = [
  { label: 'login / authentication', request: /\b(login|log ?in|sign ?in|authentication|auth)\b/i, artifact: /(login|signin|sign-in|auth)/i },
  // ROOT-CAUSE FIX (2026-07-04, from a real blocked build): artifact was /register/, which does
  // NOT match "Registration.tsx"/"useRegistrations" ("registr-a-tion" has no "register" substring)
  // — a Hospital app whose OPD Registration page was fully built was reported "Requested feature
  // not found: sign-up / registration". /regist/ covers register/registration/registrations.
  { label: 'sign-up / registration', request: /\b(sign ?up|register|registration|create account)\b/i, artifact: /(signup|sign-up|regist)/i },
  { label: 'dashboard', request: /\bdashboard\b/i, artifact: /dashboard/i },
  { label: 'user profile', request: /\bprofile\b/i, artifact: /profile/i },
  { label: 'settings', request: /\bsettings\b/i, artifact: /settings/i },
  // Search & notifications are frequently built INLINE (a search input inside a list page; a
  // toast system instead of a "Notification" component). Name-only matching must accept the
  // common real-world artifact names, or it reports built features as missing (real case:
  // ToastContext + inline patient search were both flagged "not found").
  { label: 'search', request: /\bsearch\b/i, artifact: /(search|filter)/i, evidence: /\b(?:searchTerm|searchQuery|searchText|setSearch|handleSearch|onSearch)\b|placeholder\s*=\s*["'{][^"'}]*\b(?:search|khoj|dhoond)/i },
  { label: 'shopping cart', request: /\b(cart|basket)\b/i, artifact: /(cart|basket)/i, evidence: /\b(?:addToCart|removeFromCart|cartItems|useCart|CartContext)\b/i },
  { label: 'checkout', request: /\bcheckout\b/i, artifact: /checkout/i },
  { label: 'payment', request: /\b(payment|payments|billing)\b/i, artifact: /(payment|pay|billing|checkout)/i },
  { label: 'admin panel', request: /\badmin\b/i, artifact: /admin/i },
  { label: 'chat / messaging', request: /\b(chat|messaging|messages)\b/i, artifact: /(chat|message|messaging|conversation)/i },
  { label: 'notifications', request: /\bnotification/i, artifact: /(notification|toast|snackbar)/i, evidence: /\b(?:toast\.(?:success|error|info)|useToast|notify\(|showNotification|enqueueSnackbar)\b/i },
  { label: 'contact page', request: /\bcontact\b/i, artifact: /contact/i },
  { label: 'about page', request: /\babout\b/i, artifact: /about/i },
  // High-signal surfaces users frequently ask for and builders frequently skip silently. Each
  // `artifact` is broad (synonyms + common real component names) so a feature built under a
  // reasonable alternate name still counts — the module stays high-precision, not nagging.
  { label: 'file / image upload', request: /\b(upload|file upload|image upload|attach(ment)?)\b/i, artifact: /(upload|dropzone|filepicker|attach)/i, evidence: /type\s*=\s*["'{]\s*file\b|\bnew FormData\(|\bmulter\(|\.files\[0\]/i },
  { label: 'calendar / booking / appointment', request: /\b(calendar|booking|appointment|schedul(e|ing)|reservation)\b/i, artifact: /(calendar|booking|appointment|schedul|reservation|datepicker)/i },
  { label: 'reviews / ratings', request: /\b(review|reviews|rating|ratings)\b/i, artifact: /(review|rating|star)/i },
  { label: 'comments', request: /\bcomments?\b/i, artifact: /(comment|discuss|reply|replies)/i },
  { label: 'wishlist / favorites', request: /\b(wishlist|favou?rites?|saved items?|bookmarks?)\b/i, artifact: /(wishlist|favou?rite|saved|bookmark)/i, evidence: /\b(?:toggleFavou?rite|isFavou?rite|addToWishlist|toggleBookmark)\b/i },
  { label: 'map / location', request: /\b(maps?|location|geolocation)\b/i, artifact: /(map|leaflet|mapbox|googlemap|location|geo)/i },
  { label: 'blog / articles', request: /\b(blog|articles?)\b/i, artifact: /(blog|article|post|feed)/i },
  { label: 'analytics / reports / charts', request: /\b(analytics|reports?|charts?|graphs?|statistics)\b/i, artifact: /(analytic|report|chart|graph|stat|metric|dashboard)/i },
  { label: 'gallery / portfolio', request: /\b(gallery|portfolio)\b/i, artifact: /(gallery|portfolio|lightbox)/i },
  { label: 'password reset', request: /\b(forgot password|reset password|password reset)\b/i, artifact: /(forgot|reset|password)/i },
];

/**
 * The single request to audit coverage against, given every `request` episode in workspace memory.
 *
 * ROOT-CAUSE FIX (real report 1682cd03, 2026-07-17): coverage used to run against the CUMULATIVE
 * join of every request episode the workspace ever saw. On a long-lived app a tiny follow-up edit
 * ("rest timer me 30s ka option bhi add karo") then re-audited the ENTIRE original build spec against
 * the app's CURRENT graph — so features from the first build (login, blog) that were dropped, declined,
 * or built under a non-matching name got falsely re-flagged "Requested feature not found" on an
 * unrelated micro-edit, and one such advisory even became the build's reported rootCause on a 95/100
 * PASSING build. The readiness question on an edit turn is "did THIS change land cleanly", not "does the
 * app re-satisfy its whole original spec". So on a follow-up turn (more than one request episode) we
 * audit only the MOST RECENT request. A first build has exactly one request episode → this returns that
 * full spec unchanged, so multi-feature first-build coverage is completely intact. PURE.
 */
export function currentRequestForCoverage(requests: ReadonlyArray<string>): string {
  const reqs = (Array.isArray(requests) ? requests : [])
    .map((r) => (r || '').toString())
    .filter((r) => r.trim());
  if (reqs.length === 0) return '';
  return reqs[reqs.length - 1];
}

/**
 * Compare the user's request against what was built. PURE & deterministic.
 * Silent (empty report) when there is no request or nothing has been built yet.
 *
 * `sources` — the built file BODIES (path + content), optional.
 *
 * ROOT CAUSE this closes (admin report 2026-08-12, the dukaan stock app). The user wrote, in their own
 * words: *"Saari cheezon ki list dikhe, upar search box ho"* — a search box above the list. No search
 * was built. This module noticed, and said so:
 *
 *     [warning] READINESS_WARNING: Requested feature not found: search   autoResolved: true
 *
 * …and the build shipped, and the user was told their app was ready. The finding was RIGHT and was
 * ignored — which is worse than not having it, because it cost tokens to produce and bought nothing.
 *
 * WHY it was ignored is the honest part, and it is this module's own fault: matching NAMES ONLY, it
 * could never distinguish "nobody built it" from "somebody built it inside another file". Its own
 * history records two false positives of exactly that kind (Registration.tsx, ShopSphere's admin/
 * folder), so it was correctly labelled advisory — and an advisory nobody may act on is where a true
 * finding goes to die.
 *
 * Reading bodies is what makes the finding trustworthy: a search box built inline inside ProductList
 * has no file named for it, but it does have `searchTerm` / `placeholder="Search…"`. A feature whose
 * implementation is found in a body is COVERED (fewer false positives than before). A feature found in
 * neither the names nor the bodies is `confirmed` missing — a checked fact, which a repair pass may
 * safely act on. Omitting `sources` keeps the previous name-only behaviour exactly, with every finding
 * `confirmed: false`.
 */
export function analyzeRequirementCoverage(
  request: string,
  graph: ProjectGraph,
  sources?: ReadonlyArray<{ path: string; content: string }>,
): RequirementCoverageReport {
  const empty: RequirementCoverageReport = { requested: [], covered: [], missing: [], confirmedMissing: [], findings: [] };
  const req = (request || '').toString();
  const files = Array.isArray(graph?.files) ? graph.files : [];
  const components = Array.isArray(graph?.components) ? graph.components : [];
  const routes = Array.isArray(graph?.routes) ? graph.routes : [];

  // Nothing requested, or nothing built yet → nothing to check; stay silent.
  if (!req.trim() || (files.length === 0 && components.length === 0 && routes.length === 0)) {
    return empty;
  }

  // Searchable surface of what was built — PATHS + names, never file contents. Full relative paths are
  // included (not just basenames) because folder-routing frameworks encode the feature in the DIRECTORY,
  // not the filename: Nuxt/Next put the admin panel at `pages/admin/…` and admin widgets at
  // `components/admin/…`, so a basename-only surface dropped the `admin/` segment and reported
  // "admin panel not found" on a build that clearly had one (ShopSphere autopsy 2026-07-19:
  // components/admin/VendorApprovalModal.vue + RBACGuard.vue + server/middleware/rbac.ts all present).
  // The basename is a substring of the full path, so nothing that matched before stops matching.
  const surface = [...components, ...routes, ...files, ...files.map((f) => f.split('/').pop() || f)].join('\n');

  // The file BODIES, joined once. Bounded: a coverage scan must never become the reason a large
  // project's readiness pass slows down, and a feature implemented past 600k characters of source is
  // not something a regex was going to settle anyway.
  const bodies = (Array.isArray(sources) ? sources : [])
    .map((s) => (s && typeof s.content === 'string' ? s.content : ''))
    .join('\n')
    .slice(0, 600_000);
  const canReadBodies = bodies.trim().length > 0;

  const requested: string[] = [];
  const covered: string[] = [];
  const missing: string[] = [];
  const confirmedMissing: string[] = [];
  for (const feat of FEATURES) {
    // Negation-aware (deep-test App #1): "No settings, no other features" must NOT count settings as
    // requested — a plain keyword test flagged a false "Requested feature not found: settings".
    if (!isAffirmativelyRequested(req, feat.request)) continue;
    requested.push(feat.label);
    if (feat.artifact.test(surface)) { covered.push(feat.label); continue; }
    // Named nowhere — but it may be built INLINE. Check the bodies before calling it missing.
    if (canReadBodies && feat.evidence && feat.evidence.test(bodies)) { covered.push(feat.label); continue; }
    missing.push(feat.label);
    // CONFIRMED only when we genuinely looked and genuinely did not find it. Without bodies, or
    // without an evidence pattern for this feature, "missing" stays the advisory it always was —
    // acting on a guess is how a duplicate search box gets bolted onto an app that already had one.
    if (canReadBodies && feat.evidence) confirmedMissing.push(feat.label);
  }

  const findings: RequirementFinding[] = missing.slice(0, 5).map((feature) => ({
    level: 'medium' as const,
    feature,
    confirmed: confirmedMissing.includes(feature),
    message: confirmedMissing.includes(feature)
      ? `Requested "${feature}" but it is not in the app — no page, component, or code implementing it was found anywhere.`
      : `Requested "${feature}" but no matching page/component was found — confirm it was actually built (or built under another name).`,
  }));

  return { requested, covered, missing, confirmedMissing, findings };
}

/** A short, honest requirement-coverage block for the `evaluate` output. */
export function requirementCoverageSummary(report: RequirementCoverageReport): string {
  const { requested, missing, findings } = report;
  if (requested.length === 0) {
    return 'Requirement coverage: — (no specific named features detected in the request).';
  }
  if (findings.length === 0) {
    return `Requirement coverage: ✓ all ${requested.length} detected feature(s) have a matching page/component.`;
  }
  const head = `Requirement coverage — ${missing.length} requested feature(s) not found in the build:`;
  const body = findings.map((f) => `  ⚠ ${f.message}`);
  return [head, ...body].join('\n');
}
