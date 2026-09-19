// WHERE DOES A LINK LAND? — ONE answer, read by the browser, the native shell and the manifest test.
//
// Admin 2026-09-19, asked what makes an app feel native rather than like a website: tapping a
// navbharatai.com link in WhatsApp opened a BROWSER. Every app people compare us to opens its own
// links. Android calls that an "App Link", and it has two halves that fail in opposite ways:
//
//   • claim a URL we cannot serve  ⇒ the app opens and dumps the user on Home, having eaten the link
//     they asked for. Worse than not claiming it, because the browser would at least have shown it.
//   • serve a URL we do not claim  ⇒ dead code nobody reaches.
//
// So the claim and the destination must be ONE fact. This module is that fact: `deepLinkTarget` says
// where a URL goes, `APP_LINK_CLAIMS` says what to write in AndroidManifest.xml, and
// `tests/aLinkOpensTheApp.test.ts` asserts the manifest against the list — a path added to one and
// not the other fails CI. It is deliberately the same shape as autopsy 1a7f4a58's fix (one derivation,
// every reader asks it) because that autopsy was two subsystems answering the same question differently.
//
// 🔒 WHAT IS DELIBERATELY NOT CLAIMED. `/privacy` and `/terms` are server-rendered pages that Google
// Play and Meta fetch with tools that may not run JavaScript, and a person who taps a privacy link
// asked for THAT PAGE. Opening the app on Home instead would be the first failure above. They stay
// with the browser, on purpose — not an oversight.

/** The views a URL may name. Kept as strings the app's own ViewType already contains. */
export type DeepLinkView = 'admin' | 'appstore' | 'home';

export interface DeepLinkTarget {
  /** The view to open. */
  view: DeepLinkView;
  /** The path as the app should record it, trailing slash stripped ('' for the root). */
  path: string;
  /** The query string as given, including '?', or '' — `/store/app/<id>` and `?view=appstore` need it. */
  search: string;
}

/**
 * One claim to write into AndroidManifest.xml.
 *
 * `kind` mirrors Android's own attribute names, because a `path` matches exactly and a `pathPrefix`
 * matches a subtree — and claiming a subtree by accident is how an app swallows URLs it cannot serve.
 */
export interface AppLinkClaim {
  kind: 'path' | 'pathPrefix';
  value: string;
}

/**
 * Exactly what the app promises to open, and nothing more.
 *
 * ⚠️ A query string is NOT matchable by an Android intent filter — it matches the PATH only. That is
 * why `/?view=appstore` is served by the `/` claim and then resolved here by reading the query. Adding
 * a query-only destination therefore needs no manifest change; adding a PATH needs both.
 */
export const APP_LINK_CLAIMS: readonly AppLinkClaim[] = [
  { kind: 'path', value: '/' },
  { kind: 'path', value: '/admin' },
  { kind: 'path', value: '/store' },
  { kind: 'pathPrefix', value: '/store/app/' },
];

/** The hosts the app claims. Both spellings, because a shared link carries whichever the sharer had. */
export const APP_LINK_HOSTS: readonly string[] = ['navbharatai.com', 'www.navbharatai.com'];

/** Trailing slashes are noise in a shared link; '' is the root. */
function normalizePath(pathname: string): string {
  return String(pathname || '').replace(/\/+$/, '');
}

/**
 * Where a PATH + QUERY goes, or null when it is not a destination this app serves.
 *
 * Pure and origin-free so the SAME rule answers for `window.location` on the web (where the origin is
 * ours by definition) and for a deep-link URL in the native shell (where it must be checked first, by
 * `deepLinkTarget`).
 */
export function routeForPath(pathname: string, search = ''): DeepLinkTarget | null {
  const path = normalizePath(pathname);
  const query = search && !search.startsWith('?') ? `?${search}` : (search || '');

  // ⚠️ THE ORDER IS TODAY'S BEHAVIOUR, PRESERVED EXACTLY, and it is not arbitrary. App.tsx checked
  // the admin route BEFORE the store route, so `/admin?view=appstore` opens admin; and it honoured
  // `?view=appstore` on ANY path, not just the root. Both are kept — this module replaces two readers
  // with one rule, and a refactor that quietly re-decides an existing URL is the trade this repo's
  // rules forbid.
  if (path === '/admin') return { view: 'admin', path, search: query };
  if (path === '/store' || path.startsWith('/store/app/')) return { view: 'appstore', path, search: query };
  // `?view=appstore` is the share link that predates `/store` and is still in circulation.
  try {
    if (new URLSearchParams(query).get('view') === 'appstore') return { view: 'appstore', path, search: query };
  } catch { /* an unparseable query names no destination — fall through */ }
  if (path === '') return { view: 'home', path, search: query };
  return null;
}

/**
 * Where a whole URL goes, or null when it is not ours.
 *
 * 🔒 THE HOST CHECK IS THE SECURITY HALF, and it is why this is not just `routeForPath(new URL(u))`.
 * A deep link arrives from outside the app and names its own origin; honouring a path from
 * `https://evil.example/admin` because the PATH matched would let any website open any screen of the
 * app. Only https, only our hosts. An unparseable URL is not ours.
 */
export function deepLinkTarget(url: string | null | undefined): DeepLinkTarget | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(String(url));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!APP_LINK_HOSTS.includes(parsed.hostname.toLowerCase())) return null;
  return routeForPath(parsed.pathname, parsed.search);
}
