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

export function renderPreview(vfs: VirtualFileSystem, origin?: string): string {
  // `origin` (the caller's site origin, e.g. https://navbharatai.com) is used to load the
  // self-hosted compiler via an ABSOLUTE URL. Inside a sandboxed <iframe srcDoc> a root-relative
  // path like "/vendor/babel.min.js" does not reliably resolve to the app origin, so the compiler
  // failed to load ("Could not load the preview compiler"). An absolute same-origin URL fixes it.
  if (isReactProject(vfs)) return buildReactPreview(vfs, origin);
  if (isVueProject(vfs)) return buildVuePreview(vfs, origin);
  return buildStaticPreview(vfs);
}
