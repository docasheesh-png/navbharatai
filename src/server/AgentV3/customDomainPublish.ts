// PUBLISHING TO THE USER'S OWN DOMAIN — and the silence that made it look like nothing deployed.
//
// 🔒 ROOT CAUSE (admin 2026-08-24, verbatim: "yeh theek se deploy ho hi nahi raha hai"). Their screen
// said the domain was fully connected — `ownership: active · host: active · SSL: active` — and opening
// mitrify.com gave Firebase's **"Site Not Found"**. Both were true, and the reason was one line in the
// publish route:
//
//     try { if (await workspaceHasFirebaseDomain(ws)) await deployToSite(ws, files); }
//     catch (e) { console.warn('[agentv3] custom-domain site publish failed (primary publish is live):', e); }
//
// A publish puts the app on TWO places: the shared preview channel (the link we hand back) and, for a
// workspace with a connected domain, that workspace's OWN dedicated site — which is the only one the
// custom domain actually serves. The second deploy was best-effort, and its failure went to a Cloud Run
// log nobody reads. So the user got "Your app is live at …", a link that genuinely worked, and a domain
// that stayed empty forever. Nothing anywhere said the half they cared about had not happened.
//
// That is a rule-2 fake success in its purest form: we reported the part that worked and swallowed the
// part that did not. And it is unfalsifiable from the outside — every visible signal says success, so
// the user reasonably concludes the DOMAIN connection is broken and goes back to re-checking DNS that
// was correct all along. The admin lost days to exactly that loop.
//
// THREE silent paths existed, not one, which is why this is a module and not a bigger try/catch:
//   1. the deploy threw                        → swallowed by the catch
//   2. the domain lookup threw                 → `firebaseDomainsForWorkspace` returns [] on ANY error,
//                                                so a Firestore hiccup reads as "no domain to publish
//                                                to" and skips the deploy with no trace at all
//   3. the deploy failed transiently           → no retry; one blip cost the user their domain until
//                                                they happened to publish again
//
// So: the outcome is a VALUE, every path is named, a transient failure is retried once, and the caller
// is handed an honest sentence to show the user. The primary publish is still never failed by this —
// the app really is live — but "live" no longer gets to mean "and your domain was updated" unless it
// actually was.
//
// 🔒 WHITE-LABEL LAW. `note` is user-facing, so it never carries the provider's own error text (which
// literally reads "Firebase Hosting site release failed (HTTP 403)"). The raw reason travels in
// `reason`, which belongs to logs and admin diagnostics only. See CLAUDE.md — provider anonymization.

/** What actually happened to the user's own domain during a publish. */
export interface CustomDomainPublishOutcome {
  /** Did we get as far as attempting the dedicated-site deploy? */
  attempted: boolean;
  /** The connected domains we were publishing for ('' entries impossible — the lookup filters them). */
  domains: string[];
  /** True only when the site deploy genuinely succeeded (or there was nothing to do). */
  ok: boolean;
  /** One honest, NavBharatAI-branded sentence for the user, or '' when there is nothing to say. */
  note: string;
  /** The real, unredacted reason — for server logs and the admin report. NEVER shown to a user. */
  reason: string;
  /** How many deploy attempts were made (0 when there was no domain, 1 or 2 otherwise). */
  attempts: number;
}

export interface CustomDomainPublishDeps {
  workspaceId: string;
  /**
   * The workspace's connected domains, or NULL when the lookup itself failed.
   *
   * 🔒 THE NULL IS THE POINT. The existing helper collapses "no domains" and "could not ask" into the
   * same empty array, and those two demand opposite behaviour: the first means correctly skip, the
   * second means we may have just silently skipped a domain the user is watching. Only a caller that
   * can tell them apart can be honest about which one happened.
   */
  listDomains: () => Promise<string[] | null>;
  /** Deploy the built files to the workspace's dedicated site. Throws on failure. */
  deployToSite: () => Promise<unknown>;
  /** Injected so the retry costs no real time in tests. */
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
}

/**
 * Is this failure worth a second attempt?
 *
 * A 4xx is the service telling us the REQUEST is wrong — a missing IAM role, a site that cannot be
 * created, a quota already spent. Repeating it changes nothing and just makes the user wait through a
 * second upload of every file. Anything else (5xx, a socket reset, a timeout, an error with no status
 * at all) is the kind of thing that works on the next try, and those are precisely the failures that
 * used to cost a user their domain with no way to know.
 *
 * PURE, and matched against the shape `hostingCall` produces: `… failed (HTTP 403): …`.
 */
export function isRetryableDomainPublishError(message: string): boolean {
  const m = String(message ?? '');
  const http = /HTTP (\d{3})/.exec(m);
  if (!http) return true;              // no status ⇒ network/DNS/timeout ⇒ retry
  const status = Number(http[1]);
  return !(status >= 400 && status < 500);
}

/**
 * The sentence the user sees when their own domain did not get the new build.
 *
 * It names the domain, because "your domain" is meaningless to someone who connected two, and it says
 * the app IS live — the worst possible message here is one that reads as "the publish failed", sending
 * someone to re-run a publish that already worked while the actual problem goes unexamined.
 *
 * PURE. Provider-anonymous by construction: it takes only the domains, never the error.
 */
export function customDomainPublishNote(domains: readonly string[]): string {
  const list = domains.filter(Boolean);
  if (list.length === 0) return '';
  const which = list.length === 1 ? list[0] : list.join(', ');
  return `Your app is live, but it could not be updated on your own domain (${which}) this time — `
    + `opening it may still show an error page. Press Publish again in a minute. If it keeps saying `
    + `this, tell us and we will look at it.`;
}

/** The sentence for the case where we could not even find out whether a domain is connected. */
export function domainLookupFailedNote(): string {
  return 'Your app is live. We could not check whether you have your own domain connected, so if you '
    + 'have one, open it to make sure it is showing the new version — and press Publish again if it is not.';
}

/**
 * Publish the built app to the workspace's own domain site, and report honestly what happened.
 *
 * NEVER THROWS. The primary publish has already succeeded by the time this runs and the app genuinely
 * is live at its NavBharatAI link — failing the whole publish because the second target had a bad
 * minute would take a working result away from the user. The correct behaviour is exactly what this
 * returns: succeed, and say what did not happen.
 */
export async function publishToCustomDomainSite(
  deps: CustomDomainPublishDeps,
): Promise<CustomDomainPublishOutcome> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delay = deps.retryDelayMs ?? 1500;

  let domains: string[] | null;
  try {
    domains = await deps.listDomains();
  } catch (err) {
    domains = null;
    void err;
  }

  if (domains === null) {
    // Path 2. We do not know whether there is a domain, so we cannot claim the publish is complete —
    // and we must not invent a domain name in the message either.
    return {
      attempted: false,
      domains: [],
      ok: false,
      note: domainLookupFailedNote(),
      reason: 'could not read the workspace’s connected domains',
      attempts: 0,
    };
  }

  const list = domains.filter((d) => typeof d === 'string' && d.length > 0);
  if (list.length === 0) {
    // Nothing connected — the common case, and genuinely nothing to say. Silence here is honest.
    return { attempted: false, domains: [], ok: true, note: '', reason: '', attempts: 0 };
  }

  let lastError = '';
  // COUNTED, never inferred. Deriving the count from the last error afterwards looks equivalent and is
  // not: a first failure that was retryable followed by a second that is not would report "1 attempt"
  // for two real uploads. A field that exists to make the system honest cannot itself be a guess.
  let made = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    made = attempt;
    try {
      await deps.deployToSite();
      return { attempted: true, domains: list, ok: true, note: '', reason: '', attempts: made };
    } catch (err) {
      lastError = err instanceof Error ? (err.message || String(err)) : String(err);
      if (attempt === 2 || !isRetryableDomainPublishError(lastError)) break;
      await sleep(delay);
    }
  }

  return {
    attempted: true,
    domains: list,
    ok: false,
    note: customDomainPublishNote(list),
    reason: lastError,
    attempts: made,
  };
}
