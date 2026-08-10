// ROUTE FINGERPRINT — remember WHICH pages worked, so a later turn cannot quietly break one.
//
// ADMIN 2026-08-09, after Green Guard shipped: "jo jo bacha hai usko bhi smart fix karo."
//
// THE HOLE THIS CLOSES. Green Guard protects a turn that ends NOT-GREEN. But "green" was decided by
// opening ONE url — the app's home page. So an edit that leaves the home page rendering while breaking
// /admin, /checkout or /profile ends the turn GREEN, the broken state becomes the new last known good,
// and the guard cheerfully protects the damage. That is the largest remaining way a working app gets
// broken, and it is the one a user finds days later.
//
// THE SMART PART IS THE SAMPLE, NOT THE SWEEP. A real app can declare hundreds of routes; visiting them
// all would add minutes to every build and would be a worse product than the bug. Instead:
//   • only the app's OWN visitable pages are considered (an /api endpoint is not a page, a `:id` route
//     has no real value to substitute, a file asset is not a screen);
//   • a small, STABLE, deterministic sample is taken — same routes every turn, so today's result is
//     comparable with yesterday's, which is the whole point of a fingerprint;
//   • the check only runs on a turn that ALREADY looks green, so a failing build pays nothing.
//
// And the comparison is deliberately ASYMMETRIC: a route that rendered before and does not now is a
// REGRESSION (this turn broke it). A route that never rendered is NOT held against the turn — it may
// need a login, a seeded database, or simply not exist yet. Only losing something we ourselves watched
// working counts. That asymmetry is what keeps this from false-failing honest builds.
//
// PURE — no browser, no I/O. The route visiting lives in the route layer; every rule is here.

/** One route's observed health at a point in time. */
export interface RouteHealth {
  route: string;
  rendered: boolean;
}

/** The health of the pages we watch, taken when the app was verified working. */
export interface RouteFingerprintData {
  /** Routes that genuinely rendered, sorted for a stable, comparable record. */
  ok: string[];
  /** When it was taken (epoch ms) — for honest admin reporting only. */
  at: number;
}

/** How many pages we are willing to open on a green turn. Deliberately small — see the header. */
export const MAX_CHECK_ROUTES = 5;

/** Not a page: server endpoints, asset paths, and framework internals. */
const NOT_A_PAGE = /^\/(?:api|_next|static|assets|favicon|robots|sitemap|health|healthz|graphql)\b/i;
/** A route we cannot visit without inventing data: params, wildcards, optional segments, regex. */
const NOT_VISITABLE = /[:*?()[\]+]|\{|\}/;

/**
 * Choose the pages to watch: the home page first (always the most meaningful), then the shallowest
 * remaining routes in alphabetical order.
 *
 * Shallowest-first is not cosmetic — a top-level page like `/orders` is far more likely to be a real
 * screen a user reaches than `/settings/billing/invoices/archive`, and shallow pages break loudly when
 * a shared layout or provider is damaged, which is exactly the class of regression worth catching.
 * Alphabetical after depth makes the sample DETERMINISTIC: the same app yields the same routes every
 * turn, so two fingerprints are always comparable. PURE.
 */
export function pickCheckRoutes(routes: readonly string[], max = MAX_CHECK_ROUTES): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const raw of routes || []) {
    if (typeof raw !== 'string') continue;
    const r = raw.trim();
    if (!r.startsWith('/')) continue;          // relative/named routes are not addresses we can open
    if (r.length > 100) continue;
    if (NOT_A_PAGE.test(r)) continue;
    if (NOT_VISITABLE.test(r)) continue;
    const norm = r.length > 1 && r.endsWith('/') ? r.slice(0, -1) : r;
    if (seen.has(norm)) continue;
    seen.add(norm);
    candidates.push(norm);
  }
  const depth = (r: string) => (r === '/' ? 0 : r.split('/').filter(Boolean).length);
  const rest = candidates
    .filter((r) => r !== '/')
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  const out = candidates.includes('/') ? ['/', ...rest] : rest;
  return out.slice(0, Math.max(0, max));
}

/** Build the record of what worked. Only rendered routes are kept — see the asymmetry note. PURE. */
export function buildFingerprint(results: readonly RouteHealth[], at: number): RouteFingerprintData {
  const ok = [...new Set((results || []).filter((r) => r?.rendered && typeof r.route === 'string').map((r) => r.route))].sort();
  return { ok, at };
}

/**
 * Routes that rendered in the saved fingerprint and do NOT render now — the regressions this turn
 * caused. A route absent from the current results was not checked, and an unchecked route is never
 * counted as broken: an unmeasured thing must not be reported as a failure (that is the same honesty
 * rule the preview verdict follows). PURE.
 */
export function regressedRoutes(
  previous: RouteFingerprintData | null | undefined,
  current: readonly RouteHealth[],
): string[] {
  const was = previous?.ok;
  if (!Array.isArray(was) || was.length === 0) return [];
  const now = new Map<string, boolean>();
  for (const r of current || []) if (r && typeof r.route === 'string') now.set(r.route, r.rendered === true);
  return was.filter((r) => now.has(r) && now.get(r) === false);
}

/** The honest admin line for a regression — plain, specific, no vendor name. PURE. */
export function regressionMessage(broken: readonly string[]): string {
  const shown = broken.slice(0, 3).join(', ');
  const more = broken.length - Math.min(3, broken.length);
  return `This change broke ${broken.length} page${broken.length === 1 ? '' : 's'} that worked before (${shown}${more > 0 ? ` +${more} more` : ''}) — the home page still loaded, so it would have passed unnoticed.`;
}

/** Where a workspace's fingerprint lives — its own key, so a restore never writes it into the app. */
export function fingerprintWorkspaceKey(workspaceId: string): string {
  return `${workspaceId}::greenmeta`;
}
/** The single pseudo-file that key holds (the store is a file store; this keeps it one small doc). */
export const FINGERPRINT_FILE = 'fingerprint.json';

/** Serialize/parse, tolerating anything — a corrupt fingerprint must degrade to "no fingerprint". PURE. */
export function encodeFingerprint(fp: RouteFingerprintData): Record<string, string> {
  return { [FINGERPRINT_FILE]: JSON.stringify(fp) };
}
export function decodeFingerprint(files: Record<string, string> | null | undefined): RouteFingerprintData | null {
  try {
    const raw = files?.[FINGERPRINT_FILE];
    if (typeof raw !== 'string' || !raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.ok)) return null;
    return { ok: parsed.ok.filter((r: unknown) => typeof r === 'string'), at: typeof parsed.at === 'number' ? parsed.at : 0 };
  } catch {
    return null;
  }
}

/** Kill switch, independent of Green Guard's — the extra page visits can be turned off on their own. */
export function routeFingerprintEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_ROUTE_FINGERPRINT ?? '').trim().toLowerCase() !== 'off';
}
