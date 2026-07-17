// PREVIEW PERSISTENCE (admin 2026-07-07): the v5.0 preview iframe must survive tab switches and
// collapsing back to chat. Same window semantics as v3SurfaceMount.ts, one level down: the panel's
// right workspace pane and PreviewSurface are hidden with CSS, never unmounted — unmounting tore
// down the iframe, so every Files/Terminal/chat detour destroyed the rendered preview ("preview
// gayab") and forced a full in-browser rebuild on return.
//
// The FIRST mount stays lazy: PreviewSurface auto-resumes sandboxes / compiles the in-browser
// preview on mount, so mounting it for a user who never opens Preview would spend real sandbox/
// compile cost for nothing. Once opened, it never unmounts for the rest of the session.

/** Is the preview pane the visible workspace surface right now? */
export function previewVisible(showWorkspace: boolean, tab: string): boolean {
  return showWorkspace && tab === 'preview';
}

/**
 * Should PreviewSurface be in the tree? True once the preview has EVER been opened this session
 * (keep-alive), or when it is becoming visible for the first time. Pure + unit-testable.
 */
export function previewMounted(everOpened: boolean, showWorkspace: boolean, tab: string): boolean {
  return everOpened || previewVisible(showWorkspace, tab);
}

/** Tailwind class for the keep-alive wrapper: hidden (display:none) keeps the iframe alive off-screen. */
export function previewWrapClass(showWorkspace: boolean, tab: string): string {
  return `flex-1 min-h-0 ${previewVisible(showWorkspace, tab) ? '' : 'hidden'}`;
}
