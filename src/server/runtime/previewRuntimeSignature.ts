// WHICH VERSION OF OUR PREVIEW RUNTIME BAKED THAT PAGE?
//
// 🔒 THE ROOT CAUSE THIS CLOSES (admin report 2026-08-27, App Mart games showing
// `(0, _jsxDevRuntime.jsxDEV) is not a function`).
//
// A store app's page is COMPILED ONCE at publish and stored (navStoreWeb.saveWebAppBakedPage), then
// served to every viewer. The stored bake is invalidated by exactly one thing: the app's own version
// number, which changes when the creator re-publishes.
//
// So a bug in OUR preview runtime becomes PERMANENT for every app baked while the bug existed. We
// deploy the fix, the runtime is correct from that second onward, and the published app keeps serving
// the broken page it was baked with — until its creator happens to re-publish, which they have no
// reason to do and no way to know they must. The fix reaches everyone except the people it was for.
//
// That is the same shape as the rest of this week's findings: a stored artefact that outlives the
// thing that produced it, with nothing recording which producer it came from.
//
// THE FIX: stamp every bake with a signature of the runtime that produced it, and treat a bake whose
// signature is not the current one as no bake at all. It then falls through to the serve-time compile
// — slower for one open, correct always — and the next publish re-bakes it.
//
// 🔒 WHY THIS IS MEASURED AND NOT A HAND-MAINTAINED VERSION NUMBER. A `const RUNTIME_VERSION = 7` that
// someone must remember to increment is a rule, and this whole file exists because a rule that depends
// on remembering is a bug with a delay on it. Instead we RENDER a fixed, minimal app through the real
// renderer and hash the result: any change to the harness, the Babel presets, the importmap, the
// shims — anything that could alter what a viewer runs — changes those bytes and therefore the
// signature, automatically and with nobody in the loop. A pure comment change also bumps it, which
// costs one serve-time compile per app and is the correct side to err on.

import { createHash } from 'crypto';
import { VirtualFileSystem } from '../project/ProjectModel';
import { renderPreview } from './renderPreview';

/**
 * The smallest input that still exercises the React path — a JSX element, so the JSX runtime, the
 * source-stamping plugin and the module loader all appear in the output being hashed.
 *
 * Deliberately fixed: the signature must describe the RUNTIME, so nothing about a real app may leak
 * into it. The origin is pinned for the same reason — the real one differs per deployment and would
 * otherwise make every instance disagree about what the current runtime is.
 */
const PROBE_FILES: Record<string, string> = {
  'package.json': '{"name":"probe","dependencies":{"react":"18.3.1","react-dom":"18.3.1"}}',
  'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  'src/main.tsx': "import { createRoot } from 'react-dom/client';\nexport default function P() { return <div className=\"p\">probe</div>; }\ncreateRoot(document.getElementById('root')!).render(<P />);\n",
};

const PROBE_ORIGIN = 'https://signature.invalid';

let cached: string | null = null;

/**
 * A short, stable fingerprint of the current preview runtime. Memoized — the probe render costs a few
 * milliseconds and the answer cannot change within a process.
 *
 * NEVER THROWS. A signature we cannot compute must not stop a publish, so the failure value is a
 * constant that simply never matches a real bake: every page then falls through to the serve-time
 * compile, which is the slow-but-correct path this whole mechanism degrades to by design.
 */
export function previewRuntimeSignature(): string {
  if (cached) return cached;
  try {
    const html = renderPreview(VirtualFileSystem.fromRecord(PROBE_FILES), PROBE_ORIGIN, 'signature-probe');
    cached = createHash('sha256').update(html).digest('hex').slice(0, 16);
  } catch {
    cached = 'unavailable';
  }
  return cached;
}

/**
 * May a stored bake be served?
 *
 * Both conditions are required and they answer different questions: the version says "is this the app
 * the creator last published", the signature says "was it built by the runtime we are running now".
 * A bake missing a signature is from before this mechanism existed and is refused — those are exactly
 * the pages baked during the jsxDEV window, so trusting them is the one thing we must not do.
 */
export function bakeIsCurrent(baked: { version?: number; runtime?: string } | null, version: number): boolean {
  if (!baked) return false;
  if (baked.version !== version) return false;
  if (!baked.runtime) return false;
  return baked.runtime === previewRuntimeSignature();
}
