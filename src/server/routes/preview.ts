import type { Express, Request, Response } from 'express';
import { VirtualFileSystem } from '../project/ProjectModel';
import { PreviewService } from '../runtime/PreviewService';

/**
 * Preview routes (Phase 3). Starts a live preview for a project's files via the
 * hybrid PreviewService (RuntimeRouter picks static/webcontainer/server-container)
 * and serves built static previews.
 *
 * - POST /api/preview        — body { projectId?, files: {path: content} } → start preview
 * - GET  /preview/:sessionId — serve the built static HTML (static target)
 */
const previewService = new PreviewService();

export function registerPreviewRoutes(app: Express): void {
  app.post('/api/preview', async (req: Request, res: Response) => {
    try {
      const { projectId, files } = req.body || {};
      if (!files || typeof files !== 'object') {
        return res.status(400).json({ error: 'files (object of path->content) required' });
      }
      const vfs = VirtualFileSystem.fromRecord(files);
      if (vfs.count === 0) return res.status(400).json({ error: 'No files provided' });
      const result = await previewService.startPreview(String(projectId || 'project'), vfs);
      return res.status(result.ok ? 200 : 202).json(result);
    } catch (err: any) {
      console.error('[PREVIEW] start error:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Preview failed' });
    }
  });

  app.get('/preview/:sessionId', (req: Request, res: Response) => {
    const html = previewService.static.getHtml(req.params.sessionId);
    if (!html) {
      return res.status(404).send('<!DOCTYPE html><meta charset="utf-8"><body style="font-family:system-ui;background:#0d1117;color:#c9d1d9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Preview expired or not found.</p></body>');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });
}
