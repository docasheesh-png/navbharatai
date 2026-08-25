// AgentV3 — a user interface with no way to build or serve it.
//
// ⚠️ THE ROOT CAUSE OF TWO SEPARATE ADMIN REPORTS (2026-08-25), found by reading the scaffold rather
// than by guessing at either symptom.
//
// The `node-express` template ships exactly three files: package.json, tsconfig.json, src/index.ts.
// No Vite. No index.html. No React. And its build script is
//     npx esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js
// which produces a NODE BUNDLE — not a website.
//
// So when a build writes React components into that workspace (and it does: complex apps are exactly
// the ones that want a UI), those files are DEAD BY CONSTRUCTION. Nothing compiles them, nothing
// serves them, and no page exists at all. Both symptoms follow directly:
//
//   • the preview lands on the Express port and shows `{"error":"Not found"}` — the server correctly
//     reporting that nothing is routed at `/`, because there is genuinely no page (report #2666)
//   • publish runs `npm run build`, gets no web output, and ships the starter page instead (#2656)
//
// Two reports, one cause, and neither was diagnosable from its own symptom — which is why this module
// checks the CONDITION rather than either outcome.
//
// WHAT IT DELIBERATELY DOES NOT DO. It never blocks a build. A project in this state may still be
// exactly what the user asked for mid-way through, and a platform that refuses to save work because it
// disapproves of the layout is worse than one that says so clearly. This is a loud, honest finding.
//
// PURE — no I/O.

/** Source that only makes sense if something renders it. `.ts` is excluded: an API is full of it. */
const UI_SOURCE = /\.(tsx|jsx|vue|svelte)$/i;

/** Anything that turns that source into a page. One of these in ANY package.json is enough. */
const FRONTEND_BUILDERS = [
  'vite', 'next', 'nuxt', 'astro', 'parcel', 'webpack', 'rollup', 'esbuild-loader',
  '@remix-run/dev', '@sveltejs/kit', '@angular/cli', 'react-scripts', '@builder.io/qwik',
];

/** Paths we must not read as project source. */
const VENDOR = /(^|\/)(node_modules|dist|build|\.next|out|coverage)\//;

export interface UiWithoutBuildInput {
  /** Every path in the workspace. */
  paths: string[];
  /**
   * The RAW text of every package.json in the workspace, not only the root one.
   *
   * A monorepo keeps its frontend build in `client/package.json` while the root has none — judging by
   * the root alone would accuse a perfectly ordinary layout. One builder anywhere clears the project.
   */
  packageJsonFiles: string[];
}

export interface UiWithoutBuildVerdict {
  /** Does this project contain UI source it cannot build or serve? */
  stranded: boolean;
  /** Up to a few of the stranded files, for a message a person can act on. */
  examples: string[];
  /** The honest sentence, or '' when nothing is wrong. */
  message: string;
}

/** Does any package.json here declare something that can build a front end? PURE. */
export function hasFrontendBuilder(packageJsonFiles: string[]): boolean {
  for (const raw of packageJsonFiles ?? []) {
    let deps: Record<string, unknown> = {};
    try {
      const pkg = JSON.parse(String(raw ?? '')) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
        scripts?: Record<string, unknown>;
      };
      deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      // A script naming a builder counts too — some projects call it through npx without declaring it.
      const scripts = Object.values(pkg.scripts ?? {}).join(' ').toLowerCase();
      if (FRONTEND_BUILDERS.some((b) => scripts.includes(b))) return true;
    } catch {
      continue; // an unreadable package.json is not evidence of absence
    }
    if (FRONTEND_BUILDERS.some((b) => b in deps)) return true;
  }
  return false;
}

/**
 * Is this project's user interface stranded?
 *
 * Requires ALL THREE, so it cannot fire on an ordinary project:
 *   1. UI component files exist                    (an API-only project has none)
 *   2. no package.json declares a frontend builder (a Vite/Next/monorepo project does)
 *   3. no index.html anywhere                      (a plain HTML site has one)
 *
 * Any single one of those absent means the project is fine, or at least not diagnosable as this.
 */
export function uiWithoutBuildVerdict(input: UiWithoutBuildInput): UiWithoutBuildVerdict {
  const none: UiWithoutBuildVerdict = { stranded: false, examples: [], message: '' };
  const paths = (input?.paths ?? []).map((p) => String(p ?? '')).filter((p) => p && !VENDOR.test(p));
  if (paths.length === 0) return none;

  const ui = paths.filter((p) => UI_SOURCE.test(p));
  if (ui.length === 0) return none;                                   // 1
  if (hasFrontendBuilder(input?.packageJsonFiles ?? [])) return none; // 2
  if (paths.some((p) => /(^|\/)index\.html$/i.test(p))) return none;  // 3

  const examples = ui.slice(0, 3);
  return {
    stranded: true,
    examples,
    message:
      `This project has ${ui.length} interface file(s) (${examples.join(', ')}${ui.length > examples.length ? ', …' : ''}) `
      + 'but nothing that can turn them into a web page — there is no index.html and no frontend build '
      + 'tool in any package.json. As it stands those files are never compiled and never served, so the '
      + 'preview shows the server\'s response instead of a page, and publishing produces no site. Either '
      + 'the app needs a frontend setup added, or those files belong in a separate frontend project.',
  };
}
