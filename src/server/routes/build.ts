import type { Express, Request, Response } from 'express';
import { runBuild } from '../project/BuildPipeline';
import { makeAiEditGenerator, type ModelCall } from '../project/aiEdits';
import { VirtualFileSystem } from '../project/ProjectModel';
import { callClaude } from '../lib/aiCalls';
import { PreviewService } from '../runtime/PreviewService';

/**
 * Phase 4 integration — the real, engine-backed build endpoint.
 *
 * POST /api/build { prompt, files?, userKey?, preview? }
 *   → runBuild: AI generates surgical FileEdits → EditEngine applies → ProjectVerifier
 *     + RepairLoop self-heal → returns the resulting files + verification report.
 *   → if `preview` is truthy, also starts a live preview (static or server-container).
 *
 * This is the modern replacement for the old fire-and-forget full-rewrite /api/pro-build.
 * The Pro frontend can migrate to it incrementally; the legacy route is untouched.
 */
const previewService = new PreviewService();

export function registerBuildRoutes(app: Express): void {
  app.post('/api/build', async (req: Request, res: Response) => {
    try {
      const { prompt, files, userKey, preview } = req.body || {};
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'prompt (string) is required' });
      }

      // Model call backed by the shared aiCalls layer (Claude via proxy/SDK).
      const callModel: ModelCall = (system, user) =>
        callClaude(user, typeof userKey === 'string' ? userKey : undefined, [], system);
      const { generate, fix } = makeAiEditGenerator(callModel);

      const result = await runBuild({
        prompt,
        files: files && typeof files === 'object' ? files : undefined,
        generate,
        fix,
      });

      let previewInfo: unknown = undefined;
      if (preview) {
        const vfs = VirtualFileSystem.fromRecord(result.files);
        previewInfo = await previewService.startPreview('build', vfs);
      }

      return res.json({
        ok: result.ok,
        files: result.files,
        fileCount: result.fileCount,
        applied: result.applied,
        failed: result.failed,
        verify: result.verify,
        repairAttempts: result.repairAttempts,
        baselineSnapshotId: result.baselineSnapshotId,
        preview: previewInfo,
      });
    } catch (err: any) {
      console.error('[BUILD] error:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Build failed' });
    }
  });
}
