// DOES THE DOMAIN ACTUALLY SHOW THE USER'S APP? — asked by opening it, not by inferring it.
//
// WHY THIS EXISTS (admin, 2026-08-21, mitrify.com). The connect screen said, in green:
//
//     ✅ Live! Your domain is connected, with HTTPS.
//        ownership: active · host: active · SSL: active
//
// …and opening mitrify.com gave Firebase's **"Site Not Found"** page. Both were true at once, because
// those three states describe DNS and a certificate — NOT whether anything has been published to the
// site the domain points at. A domain connected AFTER the last publish points at an empty site, and
// the next publish is what fills it.
//
// 🔒 THIS IS THE RULE-2 PART. "Live!" over a domain that answers with an error page is a fake success,
// and it cost the admin a round trip: they read "Live!", opened the domain, saw an error, and
// reasonably concluded the connection had failed. The only honest way to claim a domain is live is to
// OPEN it — the same "preview is EARNED" discipline the build path already follows.
//
// 🔒 AND THE SECURITY PART. The domain is user-supplied, so fetching it server-side is an SSRF vector:
// someone could connect a domain whose A record points at 127.0.0.1 or the cloud metadata address and
// make our server fetch it. Every request therefore goes through the shared `assertPublicHttpUrl`,
// which resolves EVERY A/AAAA record and refuses any private/loopback/link-local answer. Never bypass
// it for "it's their own verified domain" — verification proves ownership, not that the target is safe.

import { assertPublicHttpUrl } from './ssrfGuard';

export type ServingState =
  /** The domain answered with a real page — the app is genuinely being served. */
  | 'serving'
  /** The domain resolves to the hosting service, which has nothing published for it yet. */
  | 'nothing_published'
  /** It answered, but with an error of its own. */
  | 'error'
  /** We could not reach it at all, or were not allowed to try. Never treated as "broken". */
  | 'unknown';

export interface ServingCheck {
  state: ServingState;
  /** The HTTP status we saw, or 0 when nothing answered. */
  status: number;
  /** One honest sentence, or '' when there is nothing worth saying. */
  note: string;
}

type Fetcher = (url: string, init: { signal: AbortSignal; redirect: 'follow' }) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * Firebase's empty-site page. Matched on BOTH markers together, because "site not found" is common
 * enough wording that either alone could match a user's own 404 page and mislabel a working app as
 * unpublished.
 */
export function isEmptySitePage(status: number, body: string): boolean {
  if (status !== 404) return false;
  const b = String(body ?? '').toLowerCase();
  return b.includes('site not found') && b.includes("haven't deployed");
}

/**
 * Open the domain and report what it actually serves. Never throws.
 *
 * A failure to reach it is `unknown`, NOT a failure of the domain: our egress may be restricted, the
 * check may race a deploy, or the network may simply blip. Reporting a working site as broken would
 * be the same dishonesty in the other direction.
 */
export async function checkDomainServing(
  domain: string,
  fetcher?: Fetcher,
  timeoutMs = 6000,
  /**
   * TEST SEAM for the SSRF guard — and a deliberately narrow one.
   *
   * ⚠️ WHY IT EXISTS (caught by the gate 2026-08-21, before CI): the tests used the real
   * `mitrify.com`, so they ran a LIVE DNS lookup and passed only while that domain happened to
   * resolve. The moment its A record changed at the registrar, four tests went red for a reason that
   * had nothing to do with the code. A test whose verdict depends on somebody else's DNS is not a
   * test — it is a weather report.
   *
   * The default is ALWAYS the real guard, so production behaviour is unchanged, and the test that
   * proves a private address is refused deliberately does NOT pass a seam — that one must exercise the
   * genuine article or it proves nothing.
   */
  guardFn: (url: string) => Promise<{ ok: boolean; reason?: string }> = assertPublicHttpUrl,
): Promise<ServingCheck> {
  const host = String(domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host) return { state: 'unknown', status: 0, note: '' };
  const url = `https://${host}/`;

  const guard = await guardFn(url).catch(() => ({ ok: false, reason: 'check failed' }));
  if (!guard.ok) return { state: 'unknown', status: 0, note: '' };

  const doFetch: Fetcher = fetcher ?? ((u, init) => fetch(u, init) as unknown as ReturnType<Fetcher>);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { signal: ctrl.signal, redirect: 'follow' });
    // Only a 404 can be the empty-site page, so the body is read only then — a working app's HTML can
    // be megabytes, and downloading it on every status poll would be a cost with no answer in it.
    if (res.status === 404) {
      const body = await res.text().catch(() => '');
      if (isEmptySitePage(res.status, body)) {
        return {
          state: 'nothing_published',
          status: 404,
          note: 'Your domain is connected, but no app has been published to it yet — opening it shows an '
            + 'error page. Press Publish once and your domain will start showing your app.',
        };
      }
      return { state: 'error', status: 404, note: 'Your domain is connected, but it answered with a "not found" page.' };
    }
    if (res.status >= 200 && res.status < 400) return { state: 'serving', status: res.status, note: '' };
    return { state: 'error', status: res.status, note: `Your domain is connected, but it answered with an error (HTTP ${res.status}).` };
  } catch {
    return { state: 'unknown', status: 0, note: '' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * May the connect screen claim the domain is LIVE?
 *
 * Only when the hosting service reports it fully active AND opening it did not find an empty site.
 * `unknown` deliberately does NOT block the claim: if we cannot reach the domain from here, the three
 * active states are still the best evidence we have, and downgrading a genuinely working domain to a
 * warning because OUR egress failed would trade one wrong answer for another. Only positive evidence
 * that it serves nothing takes the word "Live" away. PURE.
 */
export function canClaimLive(active: boolean, serving: ServingState): boolean {
  return active && serving !== 'nothing_published' && serving !== 'error';
}
