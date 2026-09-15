// DELIVERY PROOF — the platform brings the preview up ITSELF, so "is there an app?" is never left to
// the agent's cooperation (autopsy 4efab9d7, 2026-09-15).
//
// THE ADMIN'S RULE, verbatim: *"app bani = preview chala. agar preview chala gaya to ₹0 charge karoge
// to aise to mai barbad ho jaunga."* — a build whose app renders must never be called "not built"
// and made free.
//
// WHAT ACTUALLY HAPPENED in that build, and why every existing proof was structurally unable to fire:
// the model made two read calls and then timed out for eight minutes on one vendor's key pool. It never
// ran `npm run dev`, so it never called `update_preview`, so no `preview` event was ever emitted, so
// `lastPreviewUrl` stayed empty. EVERY runtime check in this engine — the render rescue, the browser
// verify loop, the page-render check, the journey — is gated on that one URL, and **the only thing
// that ever set it was the agent**. The production bundle compiled (`PROD_BUILD_OK`), a snapshot was
// saved, the dashboard was rendering on the admin's own phone, and the platform recorded
// `PREVIEW_NEVER_CAME_UP` about an app it had every means to start and never tried to.
//
// So: after a build that was expected to produce an app, if no preview URL was ever published, the
// platform starts the dev server deterministically (the same `npm run dev` the revive path already
// uses — no model call, no code change), probes the port it knows (recipe → declared → framework
// default), and if a page genuinely serves, PUBLISHES the URL. From there the existing verify loop,
// render rescue and release gate run exactly as they do for an agent-published preview. A rendered app
// is then billed; an app that does not come up is honestly not proven, exactly as before.
//
// PURE decisions here; the I/O lives in the route and is bounded by the budget below.

export interface PlatformPreviewInput {
  /** The turn was supposed to produce an app (new build / edit), not a chat or an import. */
  expectsArtifacts: boolean;
  /** A preview URL was already published this build (by the agent or an earlier pass). */
  hasPreviewUrl: boolean;
  aborted: boolean;
  isImportTurn: boolean;
  /** Files present in the workspace right now — the app the user would see. */
  appFiles: number;
  /** A `package.json` is present — a runnable web app has one; a bare HTML file needs no server. */
  hasPackageJson: boolean;
  /** ms left before the build's wall-clock cap; null = uncapped. */
  remainingMs: number | null;
  /** `AGENTV3_PLATFORM_PREVIEW` kill switch — anything but 'off' is on. */
  env?: NodeJS.ProcessEnv;
}

/** Below this much remaining budget, starting a server risks the wall-clock cap more than it proves. */
export const PLATFORM_PREVIEW_MIN_REMAINING_MS = 150_000;
/** The attempt itself is bounded — a server that has not come up in four minutes is the finding. */
export const PLATFORM_PREVIEW_MAX_BUDGET_MS = 4 * 60_000;
/** Margin kept back from the wall-clock cap so the verify pass after us still has room. */
const PLATFORM_PREVIEW_CAP_MARGIN_MS = 120_000;

export function platformPreviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_PLATFORM_PREVIEW ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Should the platform try to bring the preview up itself? Pure. Every `false` names its reason, so the
 * build report can say why no proof was attempted rather than leaving another silent gap.
 */
export function shouldAttemptPlatformPreview(i: PlatformPreviewInput): { attempt: boolean; reason: string } {
  if (!platformPreviewEnabled(i.env)) return { attempt: false, reason: 'AGENTV3_PLATFORM_PREVIEW=off' };
  if (i.hasPreviewUrl) return { attempt: false, reason: 'a preview URL was already published' };
  if (i.aborted) return { attempt: false, reason: 'the build was aborted' };
  if (i.isImportTurn) return { attempt: false, reason: 'import turns boot their own preview' };
  if (!i.expectsArtifacts) return { attempt: false, reason: 'this turn was not expected to produce an app' };
  if (!(i.appFiles > 0)) return { attempt: false, reason: 'the workspace has no files — there is no app to start' };
  if (!i.hasPackageJson) return { attempt: false, reason: 'no package.json — nothing to run a dev server from' };
  if (i.remainingMs !== null && i.remainingMs < PLATFORM_PREVIEW_MIN_REMAINING_MS) {
    return { attempt: false, reason: `only ${Math.round(i.remainingMs / 1000)}s of build budget left` };
  }
  return { attempt: true, reason: 'no preview was ever published — the platform will start the app and look' };
}

/** How long the attempt may take: the wake budget, capped, and never past the wall-clock margin. Pure. */
export function platformPreviewBudgetMs(remainingMs: number | null, wakeBudgetMs: number): number {
  const wake = Number.isFinite(wakeBudgetMs) && wakeBudgetMs > 0 ? wakeBudgetMs : PLATFORM_PREVIEW_MAX_BUDGET_MS;
  const capped = Math.min(wake, PLATFORM_PREVIEW_MAX_BUDGET_MS);
  if (remainingMs === null) return capped;
  return Math.max(30_000, Math.min(capped, remainingMs - PLATFORM_PREVIEW_CAP_MARGIN_MS));
}

/** The port to try first: a port we have SEEN serving beats one the app declares beats the framework default. Pure. */
export function platformPreviewPort(recipePort: number | null | undefined, declaredPort: number | null | undefined, frameworkDefault: number): number {
  const ok = (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p > 0 && p < 65536;
  if (ok(recipePort)) return recipePort;
  if (ok(declaredPort)) return declaredPort;
  return frameworkDefault;
}
