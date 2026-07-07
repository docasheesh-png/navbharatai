// Dynamic per-view footer (admin 2026-07-07): on mobile/tablet the app's single bottom nav shows
// VIEW-SPECIFIC options — v3.0 first. When NavBharatAI Pro v3.0 is the active view, the nav swaps
// its default items (Home / AI / Preview / Studio / More) for v3.0's own six:
// History · Pro Chat · Preview · Files · Build Report · More.
//
// The nav bar itself stays ONE component in App.tsx (same design, same gating, same safe-area
// padding). AgentV3Panel registers this API upward (via onFooterApi) so the nav's v3.0 items drive
// the panel's real internals — the same openTab/history/report code paths the header uses on
// desktop. No duplicated logic, no fake buttons.

export type V3FooterSection = 'chat' | 'preview' | 'files' | 'diff' | 'terminal' | 'history';

export interface V3FooterApi {
  /** Which surface is on top right now (drives the active highlight). */
  section: V3FooterSection;
  /** Open the session-history sheet (same list as the desktop ☰ menu). */
  openHistory: () => void;
  /** Show the v3.0 chat full-width (collapse the workspace). */
  openChat: () => void;
  /** Open the live preview surface. */
  openPreview: () => void;
  /** Open the built-files list (tap → Open / Copy file / Copy path / Delete). */
  openFiles: () => void;
  /** Download the latest build report (same real diagnostics JSON as the desktop header button). */
  buildReport: () => void;
  /** True while the report download is being prepared (spinner on the footer item). */
  reportBusy: boolean;
  /** Open the More sheet (framework, diff, terminal, checkpoints, GitHub, deploy, live site…). */
  openMore: () => void;
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
 * Should the v3.0 panel run in mobile-footer layout? True exactly when the app's bottom nav is
 * visible (mobile/tablet device mode, not focus mode) — the same condition App.tsx renders the nav
 * under, so the header controls and their footer replacements can never BOTH disappear. Pure.
 */
export function v3MobileFooterActive(effectiveDeviceMode: string, focusMode: boolean): boolean {
  return effectiveDeviceMode !== 'desktop' && !focusMode;
}
