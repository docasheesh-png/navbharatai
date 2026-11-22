// BUILD PHASE: "no live preview was ever available" — moved out of the build route's handler, unchanged in behaviour (Q-3237,
// admin decision 2026-11-21, option A: the handler is split one phase per PR).
//
// NO PREVIEW AT ALL IS THE LOUDEST FINDING THERE IS — and it was the one thing the report never said (build f323a4db/49a7a987,
// admin 2026-08-06). Every post-build verification is gated on a preview URL: the route smoke check, the page-render check and
// the E2E scaffold all silently no-op without one. So EXACTLY when the app is most broken — it never came up — we verify the
// LEAST, and the report reads clean. `PREVIEW_ERROR` fires only when a preview ATTEMPT reports an error; a preview that was
// never produced at all raised nothing. This is that gap, deliberately a WARNING on the build itself.
import type { BuildDiagnostics } from '../BuildDiagnostics';

export function recordPreviewNeverCameUp(facts: {
  ok: boolean;
  hadPreview: boolean;
  importTurn: boolean;
  aborted: boolean;
  awaitingShell: boolean;
  record: BuildDiagnostics['record'];
}): boolean {
  if (!facts.ok || facts.hadPreview || facts.importTurn || facts.aborted || facts.awaitingShell) return false;
  try {
    facts.record({
      phase: 'preview', severity: 'warning', code: 'PREVIEW_NEVER_CAME_UP',
      message: 'The build finished, but no live preview was ever available — so nothing here has been '
        + 'proven to RUN. The route smoke check, the page-render check and the end-to-end scaffold all '
        + 'need a running app and were skipped, which is why the rest of this report looks quiet.',
      autoResolved: false,
    });
    return true;
  } catch { return false; /* diagnostics are best-effort and must never affect the build */ }
}
