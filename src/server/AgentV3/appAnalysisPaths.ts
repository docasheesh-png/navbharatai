import { isNonAppPath } from '../lib/nonAppPaths';

// Validation is stricter about what it excludes than retrieval: src/app/build/page.tsx and an
// authored Cordova www/js/app.js are source, even though a retrieval ranking may avoid those names.
const ROOT_OUTPUT = /^(dist|build|out|coverage|\.next|\.nuxt|\.svelte-kit|\.output|\.vercel\/output|\.turbo|\.cache|test-results|playwright-report|\.nyc_output|platforms)\//;
const DEPENDENCY_PATH = /(^|\/)node_modules\//;
const COPIED_NATIVE_WEB = /(^|\/)(android\/app\/src\/main\/assets\/public|ios\/App\/App\/public)\//;

/** Source checks and their repairs must judge app files, never copied bundles or tool templates. */
export function isAppAnalysisPath(path: string): boolean {
  const normalized = String(path ?? '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
  return !ROOT_OUTPUT.test(normalized) && !DEPENDENCY_PATH.test(normalized)
    && !COPIED_NATIVE_WEB.test(normalized) && !isNonAppPath(normalized);
}
