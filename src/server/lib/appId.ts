// Shared reverse-DNS application-id helpers for the export generators (mobile Capacitor, desktop Electron).
//
// Both Capacitor and Electron identify an app by a reverse-DNS id (e.g. com.acme.myshop). Centralized here
// (rule 4 — one shared, tested implementation) so the mobile and desktop generators can never drift on what
// a valid id is or how one is derived from an app name. Pure; deterministic.

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

/** A valid application id: 2+ dot-separated segments, each starting with a letter, then [a-z0-9_]. */
export function isValidAppId(id: string): boolean {
  return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(id);
}

/** Derive a valid reverse-DNS app id from an app name — `com.navbharat.<slug>` (safe fallback when empty). */
export function deriveAppId(appName: string): string {
  let slug = clean(appName).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!slug || !/^[a-z]/.test(slug)) slug = `app${slug}`; // a segment must start with a letter
  return `com.navbharat.${slug}`;
}

/** Resolve the id to use: an explicit valid id wins; otherwise derive from the app name. Never returns invalid. */
export function resolveAppId(requestedAppId: string | undefined, appName: string): string {
  const requested = clean(requestedAppId).toLowerCase();
  return isValidAppId(requested) ? requested : deriveAppId(appName);
}
