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
import { buildReactPreview, isReactProject } from './ReactPreview';
import { buildVuePreview, isVueProject } from './VuePreview';
import { injectPreviewNavGuard } from './previewNavGuard';

export function renderPreview(vfs: VirtualFileSystem, origin?: string): string {
  // `origin` (the caller's site origin, e.g. https://navbharatai.com) is used to load the
  // self-hosted compiler via an ABSOLUTE URL. Inside a sandboxed <iframe srcDoc> a root-relative
  // path like "/vendor/babel.min.js" does not reliably resolve to the app origin, so the compiler
  // failed to load ("Could not load the preview compiler"). An absolute same-origin URL fixes it.
  //
  // Every preview document is wrapped with the navigation guard (injectPreviewNavGuard): a srcdoc iframe
  // is same-origin with the platform, so an absolute redirect inside the generated app (auth redirect,
  // location='/', a link to '/') would otherwise load the NavBharatAI platform app INTO the preview
  // (preview-takeover autopsy 2026-07-21). The guard neutralizes those cross-document platform escapes.
  const html =
    isReactProject(vfs) ? buildReactPreview(vfs, origin)
    : isVueProject(vfs) ? buildVuePreview(vfs, origin)
    : buildStaticPreview(vfs);
  return injectPreviewNavGuard(html);
}
