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

export function renderPreview(vfs: VirtualFileSystem): string {
  // React detection wins over Vue when both signals exist (a React app may have a
  // vue dep listed); a genuine Vue SFC app has no react and routes to Vue.
  if (isReactProject(vfs)) return buildReactPreview(vfs);
  if (isVueProject(vfs)) return buildVuePreview(vfs);
  return buildStaticPreview(vfs);
}
