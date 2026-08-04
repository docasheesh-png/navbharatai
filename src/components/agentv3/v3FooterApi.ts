// Dynamic per-view footer (admin 2026-07-07): on mobile/tablet the app's single bottom nav shows
// VIEW-SPECIFIC options — v5.0 first. When NavBharatAI Pro v5.0 is the active view, the nav swaps
// its default items (Home / AI / Preview / Studio / More) for v5.0's own six:
// History · Pro Chat · Preview · Files · Code Studio · More.
//
// (Admin 2026-08-04: the footer slot was "Report" — the SAME action already sitting in the More
// sheet, so one tap-target was duplicated while the code editor, which shares v5.0's live file state,
// had no direct route on mobile. Report stays in More, where it now carries a send count; the footer
// slot now opens Code Studio.)
//
// The nav bar itself stays ONE component in App.tsx (same design, same gating, same safe-area
// padding). AgentV3Panel registers this API upward (via onFooterApi) so the nav's v5.0 items drive
// the panel's real internals — the same openTab/history/report code paths the header uses on
// desktop. No duplicated logic, no fake buttons.

export type V3FooterSection = 'chat' | 'preview' | 'files' | 'diff' | 'terminal' | 'history';

export interface V3FooterApi {
  /** Which surface is on top right now (drives the active highlight). */
  section: V3FooterSection;
  /** Open the session-history sheet (same list as the desktop ☰ menu). */
  openHistory: () => void;
  /** Show the v5.0 chat full-width (collapse the workspace). */
  openChat: () => void;
  /** Open the live preview surface. */
  openPreview: () => void;
  /** Open the built-files list (tap → Open / Copy file / Copy path / Delete). */
  openFiles: () => void;
  /** Open the More sheet (framework, diff, terminal, checkpoints, Report, GitHub, deploy, live site…). */
  openMore: () => void;
  /** Admin 2026-07-07: green dot on the Preview item the moment the app is genuinely viewable. */
  previewReady: boolean;
  /** Admin 2026-07-07: the REAL number of built files, shown on the Files item (0 = hidden). */
  fileCount: number;
}

/**
 * "App ban gayi" signal for the footer's green dot (admin 2026-07-07): true when a live preview URL
 * exists (the server booted the app), OR the build finished successfully with real files (the
 * in-browser preview renders those). Honest by construction — no timer, no guess. Pure.
 */
export function previewReadySignal(hasPreviewUrl: boolean, done: boolean, ok: boolean | undefined, fileCount: number): boolean {
  if (hasPreviewUrl) return true;
  return done === true && ok !== false && fileCount > 0;
}

/** The footer section that should highlight, from the panel's real surface state. Pure. */
export function footerSection(showWorkspace: boolean, tab: string): V3FooterSection {
  if (!showWorkspace) return 'chat';
  switch (tab) {
    case 'preview': case 'files': case 'diff': case 'terminal': case 'history':
      return tab;
    default:
      return 'chat';
  }
}

/**
 * Should the v5.0 panel run in mobile-footer layout? True exactly when the app's bottom nav is
 * visible — which is now the MOBILE view mode only (tablet & desktop use the side rail, no bottom
 * nav), not focus mode — the same condition App.tsx renders the nav under, so the header controls and
 * their footer replacements can never BOTH disappear. Pure.
 */
export function v3MobileFooterActive(effectiveDeviceMode: string, focusMode: boolean): boolean {
  return effectiveDeviceMode === 'mobile' && !focusMode;
}
