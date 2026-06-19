/**
 * Phase 3 — Unified preview service.
 *
 * Single entry point that profiles a project (RuntimeRouter), picks the right
 * backend, and starts a live preview:
 *   - 'static'           → StaticRuntime (self-contained HTML, fully working).
 *   - 'server-container' → ServerContainerRuntime (materialize → install → dev server;
 *                          real locally, and the same flow inside Cloud Run/Docker).
 *   - 'webcontainer'     → StackBlitz adapter not provisioned yet. Falls back to the
 *                          in-browser static/React renderer when it CAN render the
 *                          project; otherwise returns an HONEST {ok:false} (e.g. Vue/
 *                          Svelte SFC apps) — never a blank page faked as success.
 *
 * Runtimes are injectable for testing.
 */
import { VirtualFileSystem } from '../project/ProjectModel';
import { routeRuntime, type RuntimeTarget, type PreviewRuntime } from './RuntimeRouter';
import { StaticRuntime } from './StaticRuntime';
import { ServerContainerRuntime } from './ServerContainerRuntime';
import { isReactProject } from './ReactPreview';

/** Framework single-file-component extensions we can NOT transpile in-browser yet. */
const UNSUPPORTED_SFC = ['.vue', '.svelte', '.astro'];

/**
 * Can our in-browser renderer (ReactPreview / StaticPreview) actually produce a
 * real preview for this project? True for React apps and plain static sites;
 * false for framework SFC apps (Vue/Svelte/Astro) that need a real bundler /
 * WebContainer — for those we must NOT pretend success with a blank static page.
 */
function canStaticRender(vfs: VirtualFileSystem): boolean {
  if (vfs.paths().some((p) => UNSUPPORTED_SFC.some((ext) => p.toLowerCase().endsWith(ext)))) return false;
  if (isReactProject(vfs)) return true;
  // Plain static: a usable HTML entry the static builder can inline.
  return vfs.has('index.html') || vfs.has('public/index.html');
}

export interface PreviewResult {
  ok: boolean;
  target: RuntimeTarget;
  url?: string;
  sessionId?: string;
  reason?: string;
}

export interface PreviewServiceDeps {
  staticRuntime?: StaticRuntime;
  serverRuntime?: PreviewRuntime;
}

export class PreviewService {
  private staticRuntime: StaticRuntime;
  private serverRuntime: PreviewRuntime;

  constructor(deps: PreviewServiceDeps = {}) {
    this.staticRuntime = deps.staticRuntime ?? new StaticRuntime();
    this.serverRuntime = deps.serverRuntime ?? new ServerContainerRuntime();
  }

  /** Expose the static runtime so the HTTP layer can serve /preview/:id. */
  get static(): StaticRuntime {
    return this.staticRuntime;
  }

  /**
   * Internal origin a reverse proxy should forward to for a server-container
   * preview session (or null if unknown/not a server runtime). Used by the
   * `/preview-app/:id/*` proxy route.
   */
  serverTarget(sessionId: string): { host: string; port: number; origin: string } | null {
    const rt = this.serverRuntime as { getTarget?: (id: string) => { host: string; port: number; origin: string } | null };
    return typeof rt.getTarget === 'function' ? rt.getTarget(sessionId) : null;
  }

  async startPreview(projectId: string, vfs: VirtualFileSystem): Promise<PreviewResult> {
    const { target } = routeRuntime(vfs);

    if (target === 'static') {
      const { url, sessionId } = await this.staticRuntime.start(projectId, vfs);
      return { ok: true, target, url, sessionId };
    }

    if (target === 'server-container') {
      const { url, sessionId } = await this.serverRuntime.start(projectId, vfs);
      return { ok: true, target, url, sessionId };
    }

    // 'webcontainer' — the real StackBlitz WebContainer adapter isn't provisioned
    // yet. We fall back to the in-browser static/React renderer ONLY when it can
    // genuinely render the project; otherwise we return an HONEST not-ready result
    // rather than a blank static page falsely reported as success (no fake success).
    if (canStaticRender(vfs)) {
      const { url, sessionId } = await this.staticRuntime.start(projectId, vfs);
      return { ok: true, target: 'static', url, sessionId };
    }
    return {
      ok: false,
      target: 'webcontainer',
      reason: 'This framework (e.g. Vue/Svelte) needs the WebContainer runtime, which is not provisioned yet. React and static apps preview fully; this one cannot be previewed honestly right now.',
    };
  }
}

/**
 * Process-wide shared PreviewService. The build route STARTS previews and the
 * preview route (+ the WebSocket upgrade proxy in server.ts) RESOLVES them — they
 * must share ONE ServerContainerRuntime, otherwise each holds its own session
 * map and the proxy 404s on every session the builder created. Always use this
 * accessor instead of `new PreviewService()` in route/server code.
 */
let _sharedPreviewService: PreviewService | null = null;
export function getPreviewService(): PreviewService {
  if (!_sharedPreviewService) _sharedPreviewService = new PreviewService();
  return _sharedPreviewService;
}
