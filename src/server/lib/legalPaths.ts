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
  /**
   * The refund policy needs a URL whose PAGE IS THE REFUND POLICY. The rules themselves are older
   * than this route (Terms Section 4) — what a payment aggregator's onboarding asks for, and what
   * India's payment-aggregator norms sit behind, is a separately addressable page, and "halfway
   * down our Terms" is not an address anybody can check.
   */
  '/refund': 'legal_refund',
  /**
   * The grievance page needs a PUBLIC url for the same reason the other two do, and one more: this
   * is the address a regulator, a Play reviewer or an angry user is given, and it must answer for a
   * checker that does not run JavaScript. Served with the officer's real details (see routes/legal).
   */
  '/grievance': 'legal_grievance',
  /**
   * The DPA and the Security page lost their Settings tiles (admin 2026-09-14) and gained these URLs
   * in the same change — deliberately, and it is a net INCREASE in reach rather than a hiding.
   *
   * A tile could only ever be opened by somebody already signed into the app. The people who want
   * these two documents are a business customer's lawyer and a security researcher, neither of whom
   * has an account. A URL is what they can be sent, and what the Privacy Policy can link to from the
   * exact section where a reader is already asking the question.
   */
  '/dpa': 'legal_dpa',
  '/security': 'legal_security',
};

/**
 * Account & data deletion — the URL Google Play requires from any app that lets people create an
 * account. Served from its own module rather than the five-document registry: Play wants a short,
 * prominently actionable set of STEPS, and the registry's documents are long-form by contract.
 */
export const DELETE_ACCOUNT_PATH = '/delete-account';

/**
 * Contact Us — required by payment-aggregator onboarding alongside the Terms and the Refund policy,
 * and the one of the three NavBharatAI did not have at all. Its own module for the same reason the
 * deletion page has one: it must be actionable in ten seconds, and the five-document registry is
 * long-form by contract.
 */
export const CONTACT_PATH = '/contact';

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
  // Every spelling a form, a reviewer or a customer actually types for the refund page. It has no
  // long history of pasted links yet, so these exist to stop a near-miss becoming a dead link later.
  '/refund-policy': '/refund',
  '/refunds': '/refund',
  '/cancellation-policy': '/refund',
  '/refund-and-cancellation-policy': '/refund',
  '/return-policy': '/refund',
  '/grievance-officer': '/grievance',
  '/grievance-redressal': '/grievance',
  '/grievances': '/grievance',
  '/complaint': '/grievance',
  '/contact-us': CONTACT_PATH,
  '/contactus': CONTACT_PATH,
  '/support': CONTACT_PATH,
  '/help': CONTACT_PATH,
  '/account-deletion': DELETE_ACCOUNT_PATH,
  '/delete_account': DELETE_ACCOUNT_PATH,
};

/** Every path registerLegalRoutes() owns — canonical pages, the deletion page, and the aliases. */
export const ALL_PUBLIC_LEGAL_PATHS: readonly string[] = [
  ...Object.keys(PUBLIC_LEGAL_ROUTES),
  DELETE_ACCOUNT_PATH,
  CONTACT_PATH,
  ...Object.keys(LEGAL_PATH_ALIASES),
];
