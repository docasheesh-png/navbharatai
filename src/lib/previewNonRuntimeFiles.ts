// FILES THAT NEVER RUN IN THE APP — and so must never decide what the in-browser preview downloads.
//
// 🔴 THE REPORT (admin, workspace …344af61b, build f2ff962f, 2026-09-12 → opened again 2026-09-26).
// After the build, our own post-build passes added `src/App.test.tsx` (Vitest + Testing Library) and
// `e2e/smoke.spec.ts` (Playwright), and a review pass added `@playwright/test` to package.json. Two
// weeks later the in-browser preview of that app died with
// `Cannot read properties of null (reading 'useState')`.
//
// Both preview builders pre-load every bare import they find by scanning EVERY file in the project
// (`collectBare`) and `import()`-ing each one before the app starts. So the preview of a to-do list
// fetched and EXECUTED `vitest`, `@testing-library/react` and `@playwright/test` inside the user's
// browser. Those are test tools: they are never part of the running app, and `@testing-library/react`
// is not loaded with `?external=react`, so it brings its OWN copy of React and flips React's test-mode
// global as a side effect of being imported. A second React in the page is the textbook cause of
// "reading 'useState' of null". Whether it was the only cause in that report cannot be proven without
// the user's browser — but loading test tools into a live preview is wrong however it ends, and every
// failure among them surfaced as a "missing dependency" the app never had.
//
// THE RULE: a bare import found in a test, spec, e2e or tool-config file is not a dependency of the
// app. The files themselves stay in the preview's file map (nothing is hidden or deleted); only their
// imports stop being pre-loaded. A test file is never an entry either — it is never `require`d by the
// app, so nothing that runs can reach it.
//
// ONE definition, read by the client builder (`src/lib/previewUtils.ts`) and the server builder
// (`src/server/runtime/ReactPreview.ts`), because the two preview paths drifting apart is the class
// this repo keeps paying for. PURE.

/**
 * Regex SOURCE (not a RegExp) so both builders can embed it into the script they send to the browser.
 * Matched case-insensitively against a project-relative path.
 */
export const NON_RUNTIME_FILE_SOURCE =
  '(^|/)(e2e|__tests__|__mocks__|cypress|playwright|test|tests)/'
  + '|\\.(test|spec|e2e|stories|story)\\.[cm]?[jt]sx?$'
  + '|(^|/)(vite|vitest|playwright|jest|cypress|tailwind|postcss|eslint|prettier|babel|webpack|rollup|svelte|astro|next|nuxt)\\.config\\.[cm]?[jt]s$'
  + '|(^|/)(setupTests|vitest\\.setup|jest\\.setup|test-setup)\\.[cm]?[jt]sx?$';

const NON_RUNTIME = new RegExp(NON_RUNTIME_FILE_SOURCE, 'i');

/** True for a file whose imports are never part of the running app (tests, specs, tool configs). */
export function isNonRuntimeFile(path: string): boolean {
  return NON_RUNTIME.test(String(path ?? '').replace(/^\.?\//, ''));
}
