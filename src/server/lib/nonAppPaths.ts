// Paths that live INSIDE a project folder but are not part of the app that runs.
//
// ROOT CAUSE (mitrify autopsy 2026-08-04): the reported build's integrity check found "5 files each
// mount a React root" and "./index.css imported by 5 modules" — and FOUR of the five were
// `.local/skills/artifacts/artifacts/{mockup-sandbox,react-vite,slides,video-js}/files/src/main.tsx`:
// AI-assistant scaffold TEMPLATES that had ridden along in the user's project. They are complete
// mini-apps by design, so to every analyzer they look like real duplicate entry points. The engine
// then "repaired" them — it edited four files that are not part of the user's application at all.
//
// Two harms, both real: the user's integrity report is polluted with findings about code they never
// wrote, and the engine spends turns (and the user's money) editing files that can never affect their
// app. A tool's own scratch directory is not the user's source, and must be treated that way
// everywhere — hence ONE shared predicate rather than a copy per call site (rule 4: fix the class).
//
// PURE + dependency-free.

/**
 * Local state directories belonging to development TOOLS and AI assistants. None of them is ever part
 * of the running application; several (notably `.local/skills/**`) contain whole app scaffolds.
 *
 * Deliberately conservative: only directories whose entire purpose is assistant/tool state. Ordinary
 * project config (`.github`, `.husky`, `.vscode`, `.devcontainer`) is NOT listed — those are genuinely
 * part of a repo the user maintains, even though they are also not "app source".
 */
export const NON_APP_DIR_RE = /(^|\/)\.(local|claude|cursor|windsurf|continue|codeium|aider)(\/|$)/;

/** True when a path lives inside a tool/assistant state directory rather than the user's app. PURE. */
export function isNonAppPath(path: string): boolean {
  return NON_APP_DIR_RE.test(path || '');
}
