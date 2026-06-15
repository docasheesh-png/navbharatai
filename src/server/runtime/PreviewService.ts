/**
 * Phase 3 — Unified preview service.
 *
 * Single entry point that profiles a project (RuntimeRouter), picks the right
 * backend, and starts a live preview. The 'static' target is fully implemented
 * via StaticRuntime; 'webcontainer' and 'server-container' are declared but not
 * yet provisioned — they return an HONEST not-ready result (never a fake success)
 * until their adapters (StackBlitz SDK / container orchestration) land.
 */
import { VirtualFileSystem } from '../project/ProjectModel';
import { routeRuntime, type RuntimeTarget } from './RuntimeRouter';
import { StaticRuntime } from './StaticRuntime';

export interface PreviewResult {
  ok: boolean;
  target: RuntimeTarget;
  url?: string;
  sessionId?: string;
  /** Set when ok=false — explains why (e.g. backend not provisioned yet). */
  reason?: string;
}

export class PreviewService {
  private staticRuntime = new StaticRuntime();

  /** Expose the static runtime so the HTTP layer can serve /preview/:id. */
  get static(): StaticRuntime {
    return this.staticRuntime;
  }

  async startPreview(projectId: string, vfs: VirtualFileSystem): Promise<PreviewResult> {
    const { target } = routeRuntime(vfs);

    if (target === 'static') {
      const { url, sessionId } = await this.staticRuntime.start(projectId, vfs);
      return { ok: true, target, url, sessionId };
    }

    // Honest placeholder until the real adapters are provisioned.
    return {
      ok: false,
      target,
      reason: target === 'webcontainer'
        ? 'WebContainer runtime not provisioned yet (frontend StackBlitz adapter pending).'
        : 'Server-container runtime not provisioned yet (container orchestration pending).',
    };
  }
}
