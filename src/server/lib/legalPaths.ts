// SINGLE SOURCE OF TRUTH for every public legal URL this server answers.
//
// WHY IT IS ITS OWN MODULE: two places have to agree about these paths — the handlers that render
// them (routes/legal.ts) and the SPA catch-all that must DEFER to those handlers (lib/spaFallback.ts).
// When the two lists were maintained by hand, a path added to one and forgotten in the other failed
// SILENTLY: the catch-all answered 200 with index.html, so the URL looked alive to a human and was
// empty to a crawler that does not run JavaScript. That is the precise failure the server-rendered
// legal pages exist to prevent, so the lists are derived from one place instead of kept in step.
//
// Deliberately dependency-free (no express, no document bodies) so the pure fallback helper can
// import it without dragging a route module into the decision.

/** Public URL path → the legal registry id it serves. */
export const PUBLIC_LEGAL_ROUTES: Readonly<Record<string, string>> = {
  '/privacy': 'legal_privacy',
  '/terms': 'legal_terms',
};

/**
 * Account & data deletion — the URL Google Play requires from any app that lets people create an
 * account. Served from its own module rather than the five-document registry: Play wants a short,
 * prominently actionable set of STEPS, and the registry's documents are long-form by contract.
 */
export const DELETE_ACCOUNT_PATH = '/delete-account';

/**
 * Legacy / alternate spellings that must reach the same document.
 *
 * WHY THIS EXISTS: the Google Play listing has carried `https://www.navbharatai.com/privacy-policy`
 * as its Privacy Policy URL since long before these server routes were written — and a URL stored in
 * somebody else's console cannot be grepped for, corrected in a commit, or even reliably enumerated.
 * The same is true of every link already pasted into a Meta app review, an email, or a partner form.
 * Fixing only the one field we happen to know about would leave every other copy pointing at the SPA
 * shell: a working-looking link for a human, an empty page for a non-JS checker.
 *
 * So the old paths are made to WORK rather than assumed to be updated. 301 (permanent) keeps
 * `/privacy` canonical while guaranteeing a checker that follows the redirect lands on real HTML.
 */
export const LEGAL_PATH_ALIASES: Readonly<Record<string, string>> = {
  '/privacy-policy': '/privacy',
  '/privacypolicy': '/privacy',
  '/privacy.html': '/privacy',
  '/terms-of-service': '/terms',
  '/terms-and-conditions': '/terms',
  '/terms.html': '/terms',
  '/account-deletion': DELETE_ACCOUNT_PATH,
  '/delete_account': DELETE_ACCOUNT_PATH,
};

/** Every path registerLegalRoutes() owns — canonical pages, the deletion page, and the aliases. */
export const ALL_PUBLIC_LEGAL_PATHS: readonly string[] = [
  ...Object.keys(PUBLIC_LEGAL_ROUTES),
  DELETE_ACCOUNT_PATH,
  ...Object.keys(LEGAL_PATH_ALIASES),
];
