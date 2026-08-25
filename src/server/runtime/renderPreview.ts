/**
 * Phase 3 — Preview renderer selector.
 *
 * Picks the right self-contained-HTML builder for a project that can preview
 * WITHOUT external infra:
 *   - React/Vite frontend (JSX + ESM modules) → in-browser bundled (ReactPreview)
 *   - plain HTML/CSS/JS                        → inlined (StaticPreview)
 *
 * Both produce one standalone HTML string served by StaticRuntime at /preview/:id.
 */
import { VirtualFileSystem } from '../project/ProjectModel';
import { buildStaticPreview } from './StaticPreview';
import { buildReactPreview, isReactProject, findReactEntry } from './ReactPreview';
import { buildVuePreview, isVueProject, findVueEntry } from './VuePreview';
import { injectPreviewNavGuard } from './previewNavGuard';

/**
 * WHICH RENDERER THIS APP ACTUALLY NEEDS — and why it is not just "is react in package.json".
 *
 * 🔒 ROOT CAUSE (admin report 2026-08-25, a published store app). A vanilla HTML/canvas game — an
 * `index.html` with an inline `<script>`, a `style.css`, and the `package.json` OUR OWN builder
 * scaffolds with `react` in its dependencies — was routed to the React renderer purely because that
 * dependency was listed. The React renderer then looked for a React module entry, found none, and
 * served "No React entry module found" to every viewer. The creator never saw it: their own preview
 * runs on the live sandbox dev server, not this static renderer, so the app was broken only for
 * strangers opening it from the store.
 *
 * A listed dependency says NOTHING about whether a React entry exists — an unused scaffold dependency
 * is extremely common. The only honest test is whether an entry actually RESOLVES, so that is what
 * this asks. `.jsx`/`.tsx` files present but no entry means the same thing: components without an
 * entry are not a React app you can boot.
 *
 * THE ONE CASE THAT MUST STAY AN ERROR: an app whose `index.html` points at a script that is not in
 * the tree is genuinely broken, and falling back to static would render a page with a dead script —
 * a blank screen instead of a message. Blank-and-wrong is worse than an honest refusal, so that case
 * keeps the framework renderer and its error. Pure + unit-tested.
 */
export type PreviewKind = 'react' | 'vue' | 'static';

export function choosePreviewKind(vfs: VirtualFileSystem): PreviewKind {
  const reactish = isReactProject(vfs);
  const vueish = isVueProject(vfs);
  if (!reactish && !vueish) return 'static';

  if (reactish && findReactEntry(vfs)) return 'react';
  if (vueish && findVueEntry(vfs)) return 'vue';

  // Framework-shaped, but no entry resolves. If index.html references a local script we do not have,
  // the app is genuinely incomplete — keep the framework renderer so the viewer gets the honest
  // message rather than a blank page.
  if (referencesMissingLocalScript(vfs)) return reactish ? 'react' : 'vue';

  // Otherwise this is a self-contained page that merely carries a framework dependency it never uses.
  return 'static';
}

/** True when index.html points at a local script file the tree does not contain. Pure. */
function referencesMissingLocalScript(vfs: VirtualFileSystem): boolean {
  const html = vfs.readText('index.html');
  if (!html) return false;
  const re = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const src = m[1];
    if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) continue;   // remote/inline — not ours
    const spec = src.replace(/^\.?\//, '').split('?')[0];
    const known = vfs.paths().some((p) => p === spec || p.endsWith('/' + spec));
    if (!known) return true;
  }
  return false;
}

export function renderPreview(vfs: VirtualFileSystem, origin?: string, workspaceId?: string): string {
  // `origin` (the caller's site origin, e.g. https://navbharatai.com) is used to load the
  // self-hosted compiler via an ABSOLUTE URL. Inside a sandboxed <iframe srcDoc> a root-relative
  // path like "/vendor/babel.min.js" does not reliably resolve to the app origin, so the compiler
  // failed to load ("Could not load the preview compiler"). An absolute same-origin URL fixes it.
  //
  // Every preview document is wrapped with the navigation guard (injectPreviewNavGuard): a srcdoc iframe
  // is same-origin with the platform, so an absolute redirect inside the generated app (auth redirect,
  // location='/', a link to '/') would otherwise load the NavBharatAI platform app INTO the preview
  // (preview-takeover autopsy 2026-07-21). The guard neutralizes those cross-document platform escapes.
  // workspaceId namespaces the app's browser-side database (pgShim). Without it the database is
  // memory-only — honest, and stated in the preview's console — rather than shared between apps.
  const kind = choosePreviewKind(vfs);
  const html =
    kind === 'react' ? buildReactPreview(vfs, origin, workspaceId)
    : kind === 'vue' ? buildVuePreview(vfs, origin)
    : buildStaticPreview(vfs);
  return injectPreviewNavGuard(html);
}
