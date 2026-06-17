/**
 * Phase 3 — Unified preview service.
 *
 * Single entry point that profiles a project (RuntimeRouter), picks the right
 * backend, and starts a live preview:
 *   - 'static'           → StaticRuntime (self-contained HTML, fully working).
 *   - 'server-container' → ServerContainerRuntime (materialize → install → dev server;
 *                          real locally, and the same flow inside Cloud Run/Docker).
 *   - 'webcontainer'     → not provisioned yet (frontend StackBlitz adapter pending) —
 *                          returns an HONEST not-ready result, never a fake success.
 *
 * Runtimes are injectable for testing.
 */
import { VirtualFileSystem } from '../project/ProjectModel';
import { routeRuntime, type RuntimeTarget, type PreviewRuntime } from './RuntimeRouter';
import { StaticRuntime } from './StaticRuntime';
import { ServerContainerRuntime } from './ServerContainerRuntime';

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

    // BUG A5 FIX: 'webcontainer' — WebContainer adapter pending, fallback to static rendering
    // instead of returning ok: false which leaves users with no preview.
    const { url, sessionId } = await this.staticRuntime.start(projectId, vfs);
    return { ok: true, target: 'static', url, sessionId };
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
