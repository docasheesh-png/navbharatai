/**
 * Phase 3 — Static runtime adapter (implements PreviewRuntime for the 'static' target).
 *
 * Builds a self-contained HTML preview from the VFS and stores it in an in-memory
 * session map (24h TTL) so it can be served at /preview/{sessionId}. No external
 * infra needed — this is the fully-working backend for pure HTML/CSS/JS apps.
 */
import crypto from 'crypto';
import type { PreviewRuntime, RuntimeTarget } from './RuntimeRouter';
import { VirtualFileSystem } from '../project/ProjectModel';
import { renderPreview } from './renderPreview';

interface StaticSession {
  html: string;
  projectId: string;
  createdAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000;

export class StaticRuntime implements PreviewRuntime {
  readonly target: RuntimeTarget = 'static';
  private sessions = new Map<string, StaticSession>();

  async start(projectId: string, vfs: VirtualFileSystem): Promise<{ url: string; sessionId: string }> {
    this.sweep();
    const sessionId = crypto.randomBytes(8).toString('hex');
    const html = renderPreview(vfs);
    this.sessions.set(sessionId, { html, projectId, createdAt: Date.now() });
    return { url: `/preview/${sessionId}`, sessionId };
  }

  async stop(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async status(sessionId: string): Promise<'starting' | 'ready' | 'stopped' | 'error'> {
    return this.sessions.has(sessionId) ? 'ready' : 'stopped';
  }

  /** Serve the built HTML for a session (used by the /preview/:id route). */
  getHtml(sessionId: string): string | undefined {
    const s = this.sessions.get(sessionId);
    return s?.html;
  }

  private sweep(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, s] of this.sessions) if (s.createdAt < cutoff) this.sessions.delete(id);
  }
}
