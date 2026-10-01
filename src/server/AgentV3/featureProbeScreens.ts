// A CONTROL ON ANOTHER SCREEN IS NOT A MISSING CONTROL (autopsy a106df77, 2026-10-01).
//
// 🔴 WHAT HAPPENED. The bill maker's home screen is a dashboard; its "Add Item" and "Delete" live on the
// New Bill and Bills screens. The feature probe (FeaturePresence.ts) read only the page the preview
// opened on, so on every multi-screen app it reported controls "missing" that were one tab away. The
// sign-in case (autopsy 8e124182) had already been taught to read the screens behind the door; the
// ordinary multi-route app never was.
//
// 🔑 THE FIX: when the home screen leaves a requested control unseen, the probe also reads the app's own
// declared routes (PageRouteCheck.extractPageRoutes, which since a106df77 joins nested routes) in a real
// browser and judges them together. Paid only when something would otherwise be called missing, and
// bounded: at most MAX_PROBE_SCREENS screens inside PROBE_SCREENS_BUDGET_MS. A screen that does not
// render is not read — an error page proves nothing either way.
//
// Kill switch: AGENTV3_FEATURE_PROBE_SCREENS=off. PURE except the env read.
import { isSignInRoute } from './signInExplore';

export const MAX_PROBE_SCREENS = 4;
export const PROBE_SCREENS_BUDGET_MS = 45_000;

export function featureProbeScreensEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_FEATURE_PROBE_SCREENS ?? '').trim().toLowerCase() !== 'off';
}

/** The routes worth reading: not home (already read), not dynamic, not the sign-in page; capped. PURE. */
export function screensToProbe(routes: readonly string[], max = MAX_PROBE_SCREENS): string[] {
  const out: string[] = [];
  for (const r of routes ?? []) {
    const p = String(r ?? '').trim();
    if (!p.startsWith('/') || p === '/' || /[:*[\]]/.test(p)) continue;
    if (isSignInRoute(p)) continue;
    if (!out.includes(p)) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

/** The URL of `route` on the same origin as the preview. Null when the preview URL is unreadable. PURE. */
export function screenUrl(previewUrl: string, route: string): string | null {
  try {
    const u = new URL(previewUrl);
    u.pathname = route;
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export interface ProbedScreen {
  route: string;
  html: string;
}

/** The home capture plus every other screen that rendered, as one document for the probe. PURE. */
export function combineScreens(homeHtml: string, screens: readonly ProbedScreen[]): string {
  return [homeHtml, ...screens.map((s) => s.html)].filter(Boolean).join('\n');
}

/** The report's line for what the probe read. PURE. */
export function screensReadNote(screens: readonly ProbedScreen[]): string {
  return screens.length ? `screens=/,${screens.map((s) => s.route).join(',')}` : 'screens=/';
}
