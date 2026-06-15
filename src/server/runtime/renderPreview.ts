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

export function renderPreview(vfs: VirtualFileSystem): string {
  return isReactProject(vfs) ? buildReactPreview(vfs) : buildStaticPreview(vfs);
}
