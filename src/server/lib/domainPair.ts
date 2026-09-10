/**
 * `www` ↔ apex — the two spellings of one website (ROADMAP §13, 1.2).
 *
 * Every host handles this; we did not. A user connected `mitrify.com`, a friend typed
 * `www.mitrify.com`, and got nothing — because to the hosting service those are two unrelated
 * domains, and we had attached one. So a connect now attaches BOTH: the CANONICAL one serves the
 * app, the ALTERNATE is attached with a `redirectTarget` (a real field on the hosting API's
 * CustomDomain resource, verified against Google's discovery document 2026-09-10) so it answers
 * with a redirect to the canonical rather than a second copy of the site.
 *
 * 🔒 THE CANONICAL IS ALWAYS THE APEX. If the user types `www.mitrify.com` we connect `mitrify.com`
 * and redirect `www` to it — not the other way round — for a reason that is DNS, not taste: the
 * managed-DNS zone must be the registrable domain (a zone named `www.x.com` is not something a
 * registrar delegates), and the apex needs an A record either way. The screen says which one it
 * connected, so a user who typed `www` is never surprised silently.
 *
 * 🔒 ONLY A TWO-LABEL HOST GETS A `www` TWIN. `blog.x.com` does not become `www.blog.x.com` — nobody
 * types that, and an alternate whose records the user never adds would sit "pending" forever under
 * a domain that is otherwise done. The honest cost: a three-label APEX such as `shop.co.in` gets no
 * twin either, because without a public-suffix list this code cannot tell it from a subdomain, and
 * guessing wrong is worse than offering less. Stated here so nobody "fixes" it with a heuristic.
 *
 * PURE.
 */

export interface DomainPair {
  /** The host that serves the app and that every record, verdict and zone is keyed by. */
  canonical: string;
  /** The `www.` twin that redirects to `canonical`, or null when there is none to offer. */
  alternate: string | null;
}

/** `www.x.com` → `x.com`; anything else unchanged. Lower-cased, no trailing dot. */
export function canonicalHost(host: string): string {
  const h = String(host ?? '').trim().toLowerCase().replace(/\.$/, '');
  return h.startsWith('www.') ? h.slice(4) : h;
}

/** The `www.` twin of a canonical host, or null — see the header for why only two labels qualify. */
export function alternateHost(canonical: string): string | null {
  const h = canonicalHost(canonical);
  if (!h || h.startsWith('www.')) return null;
  return h.split('.').length === 2 ? `www.${h}` : null;
}

export function domainPair(input: string): DomainPair {
  const canonical = canonicalHost(input);
  return { canonical, alternate: alternateHost(canonical) };
}

/** Is `host` the alternate of `canonical`? Used to recognise a link/record that belongs to the twin. */
export function isAlternateOf(host: string, canonical: string): boolean {
  const alt = alternateHost(canonical);
  return !!alt && canonicalHost(host) === canonicalHost(canonical) && String(host).toLowerCase() === alt;
}
