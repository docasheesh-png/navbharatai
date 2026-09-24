// Where a link to one of NavBharatAI's own legal pages goes, inside the app (admin 2026-09-23).
//
// Admin, verbatim: *"mobile app me navbharatai ke about us me jab terms and conditions etc par click
// karte hai to open nahi ho raha. crash jaisa feel ho raha."*
//
// 🔴 THE CAUSE: A RELATIVE LINK MEANS A DIFFERENT PLACE IN THE BUNDLED APP. `/terms` is a real page on
// navbharatai.com — the server renders it (`server/lib/legalPaths.ts`). But the Android and iOS apps
// are BUNDLED: the WebView's origin is `https://localhost` (Android) or `capacitor://localhost`
// (iOS), with no server behind it. A plain `<a href="/terms">` therefore sends the WebView to
// `https://localhost/terms`, the local asset server answers with index.html, and the WHOLE APP boots
// again from its splash screen. It looks like a crash, and every bit of state the user had is gone.
//
// 🔎 IT WAS NEVER ONE LINK. The About page had three, and the legal documents themselves carry about
// twenty — the Terms link to the Refund policy, the Privacy Policy to the Grievance Officer three
// times — all rendered inside the app's own Legal page. On the phone, every one of them reloaded
// the app. Both places now ask this ONE resolver, so a link added to a document tomorrow cannot bring
// the bug back.
//
// WHAT A LINK BECOMES:
//   • a document the app can show (`/privacy`, `/terms`, `/refund`, `/grievance`, `/dpa`, `/security`,
//     and every alias the server redirects to one of them) → the app's own Legal page, Settings →
//     Legal & Trust. That page loads the document from the app bundle, so it works with no network, and the
//     user stays exactly where they were.
//   • a page only the server has (`/contact`, `/delete-account`) → the real URL, opened in the browser
//     (`openExternalUrl`: the system browser in the app, a new tab on the web).
//   • anything else → `null`, and the caller leaves the link alone.
//
// 🔒 THE TABLE IS THE SERVER'S. The paths are read from `server/lib/legalPaths.ts`, the module the
// server's own routes and SPA fallback already share, so a legal page added there is resolved here
// with no second list to keep in step.

import {
  PUBLIC_LEGAL_ROUTES, LEGAL_PATH_ALIASES, DELETE_ACCOUNT_PATH, CONTACT_PATH,
} from '../server/lib/legalPaths';
import { NATIVE_API_ORIGIN } from './apiBase';
import { openExternalUrl } from './mobileNative';

export type LegalLinkTarget =
  | { kind: 'in-app'; screen: string }
  | { kind: 'external'; url: string };

/** Hosts whose paths are ours to resolve. Any other host is somebody else's page, left alone. */
const OWN_HOSTS = new Set(['navbharatai.com', 'www.navbharatai.com']);

/** Pages only the server renders: opened at their real address, never inside the WebView. */
const SERVER_ONLY_PATHS = new Set([CONTACT_PATH, DELETE_ACCOUNT_PATH]);

/**
 * Resolve a link. PURE — no DOM, no navigation.
 *
 * A relative href is read against navbharatai.com, which is what it means on the website. An
 * absolute link counts only when it points at navbharatai.com. The path is normalised (lower case, no
 * trailing slash) and passed through the same alias table the server's redirects use, so
 * `/terms-and-conditions` lands on the same document `/terms` does.
 */
export function legalLinkTarget(href: string | null | undefined): LegalLinkTarget | null {
  if (typeof href !== 'string' || !href.trim()) return null;
  let url: URL;
  try {
    url = new URL(href.trim(), NATIVE_API_ORIGIN);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!OWN_HOSTS.has(url.hostname.toLowerCase())) return null;

  let path = url.pathname.toLowerCase();
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  path = LEGAL_PATH_ALIASES[path] ?? path;

  const screen = PUBLIC_LEGAL_ROUTES[path];
  if (screen) return { kind: 'in-app', screen };
  if (SERVER_ONLY_PATHS.has(path)) return { kind: 'external', url: `${NATIVE_API_ORIGIN}${path}` };
  return null;
}

/**
 * Follow a legal link the way the app should. Returns `true` when it handled the link, so a click
 * handler knows to `preventDefault()`; `false` leaves the browser's own behaviour in place.
 *
 * The in-app case uses `navbharat:navigate`, the event App already uses to open a Settings sub-screen
 * from deep inside a surface (the Database card does exactly this). It opens or focuses Settings and
 * never closes it, so a link from one legal page to another simply swaps the document.
 */
export function openLegalLink(href: string | null | undefined): boolean {
  const target = legalLinkTarget(href);
  if (!target) return false;
  if (target.kind === 'in-app') {
    window.dispatchEvent(new CustomEvent('navbharat:navigate', {
      detail: { view: 'settings', settingsScreen: target.screen },
    }));
  } else {
    openExternalUrl(target.url);
  }
  return true;
}
