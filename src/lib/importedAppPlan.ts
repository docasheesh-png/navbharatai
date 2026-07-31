// importedAppPlan — a pure decision for what to do after a .zip project import (Pro / v5.0).
//
// Autopsy of the admin's report (2026-07-31): after uploading a .zip via the attach button, the files
// synced into Code Studio + the workspace, but for a FRAMEWORK app (Vite/Next/React with a package.json
// — the most common real project) NOTHING started: the chat only said "type 'run this app'". The user had
// to take a manual step for the preview to run. The GitHub-import path already auto-boots the preview
// (it calls handleSend with a message that triggers the build), so a .zip import must be just as
// one-shot: sync → auto-trigger the build/preview.
//
// This module isolates the two pure questions — WHAT kind of app is this, and SHOULD we auto-run it —
// so the decision is unit-tested and identical wherever it is used. Framework apps genuinely need a real
// dev server (npm install + npm run dev on E2B); the in-browser Babel preview cannot resolve npm packages,
// so a framework app is the case that must auto-trigger. Static / simple-React apps already preview live
// in-browser, so they must NOT spend a build turn.

export type ImportedAppKind = 'framework' | 'simple-react' | 'static' | 'other';

export interface ImportedAppPlan {
  kind: ImportedAppKind;
  /** True when the in-browser preview can render it as-is (static HTML/CSS/JS or Babel-transpilable React). */
  inBrowserPreview: boolean;
  /** True when we should AUTO-TRIGGER the real build/preview (framework apps only — they need a dev server). */
  autoRun: boolean;
}

/**
 * Classify an imported project from its file map and decide whether to auto-run it. Pure + deterministic.
 * Mirrors the long-standing heuristic in useZipImport, with the auto-run decision made explicit:
 *  - framework (build tool + package.json) → needs a dev server → AUTO-RUN.
 *  - simple-react (JSX/TSX, no bundler)     → Babel in-browser preview → no build turn.
 *  - static (html, no package.json)         → in-browser preview → no build turn.
 *  - other                                   → just loaded into the IDE.
 */
export function planImportedApp(files: Record<string, string>): ImportedAppPlan {
  const keys = Object.keys(files || {});
  const pkg = files?.['package.json'] || '';
  const hasPackageJson = !!pkg;
  // A real bundler/framework in package.json ⇒ needs `npm install` + a dev server to preview.
  const hasBuildTool = /["'](vite|webpack|rollup|parcel|next|nuxt|gatsby|create-react-app|@vitejs)\s*["']/.test(pkg);
  const hasJsxEntry = keys.some((k) => /\.(tsx|jsx)$/i.test(k));
  const hasHtml = keys.some((k) => k === 'index.html' || k.endsWith('.html'));

  const isFrameworkApp = hasBuildTool && hasPackageJson;
  const isSimpleReact = hasJsxEntry && !hasBuildTool;
  const isStaticApp = !hasPackageJson && hasHtml;

  const kind: ImportedAppKind = isFrameworkApp
    ? 'framework'
    : isSimpleReact
      ? 'simple-react'
      : isStaticApp
        ? 'static'
        : 'other';

  return {
    kind,
    inBrowserPreview: isSimpleReact || isStaticApp,
    // Only a framework app needs (and benefits from) auto-triggering the real dev-server build — the
    // others already show a live in-browser preview, and 'other' has nothing runnable to boot.
    autoRun: isFrameworkApp,
  };
}

/**
 * The exact natural-language message the import auto-sends to the engine to boot a framework app's live
 * preview. Kept here (one source of truth) so the hook and its test agree. Mirrors the intent of the
 * GitHub-import auto-message: install dependencies and launch the live preview, do not rebuild the app.
 */
export const RUN_IMPORTED_APP_MESSAGE =
  'Run this imported app: install its dependencies and start the dev server so the live preview works. '
  + 'Do not rebuild or change the app — just get the existing project running and show the preview.';
