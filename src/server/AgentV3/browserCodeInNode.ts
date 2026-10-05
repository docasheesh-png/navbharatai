/**
 * BROWSER CODE RUN UNDER NODE (queue Q-146, recorded with ~10 minutes lost to `window is not defined`).
 *
 * A browser-only app keeps its data in `localStorage`, and its "seed" is code that fills it on first load.
 * The builder ran that seed with `node` / `tsx` to "load sample data", Node threw
 * `ReferenceError: localStorage is not defined`, and the builder then tried shims, polyfills and rewrites —
 * minutes of a paid build spent making browser code run where no browser exists.
 *
 * The answer is never a polyfill: code that touches `window`, `document` or browser storage runs in the
 * app, in the preview, and nowhere else. So when a Node-run command dies on exactly that error, the tool
 * result says so in one sentence, the first time, with the right place for the code. Guidance only —
 * nothing is edited. PURE.
 */

/** A command that runs a script under a server-side JavaScript runtime. */
const NODE_RUN = /(?:^|[\s;&|(])(?:node|tsx|ts-node|bun|deno|npx\s+(?:tsx|ts-node)|npm\s+run\s+[\w:-]*seed[\w:-]*)\b/;
/** The runtime's own error for a browser global it does not have. */
const BROWSER_GLOBAL = /ReferenceError:\s*(window|document|localStorage|sessionStorage|navigator|indexedDB|location)\s+is not defined/;

export function browserCodeInNodeHint(command: string, output: string): string | null {
  if (!NODE_RUN.test(String(command ?? ''))) return null;
  const m = String(output ?? '').slice(0, 20000).match(BROWSER_GLOBAL);
  if (!m) return null;
  return [
    `⚠️ BROWSER CODE, RUN UNDER NODE. \`${m[1]}\` exists only in a browser, so this script can never run here —`,
    'and a polyfill or a shim would only make it APPEAR to work: data written to a fake localStorage in this process',
    'never reaches the app. Code that reads or writes browser storage belongs in the app itself (for sample data:',
    'seed it on the app\'s first load when the store is empty). Do not run it with node again.',
  ].join('\n');
}
