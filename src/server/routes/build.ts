import type { Express, Request, Response } from 'express';
import { runBuild } from '../project/BuildPipeline';
import { makeAiEditGenerator, type ModelCall } from '../project/aiEdits';
import { VirtualFileSystem } from '../project/ProjectModel';
import { callClaude, callGemini, callGroq, callOpenAI, callDeepSeek, callOpenRouter } from '../lib/aiCalls';
import { aiRouter } from '../lib/aiRouter';
import { getPreviewService } from '../runtime/PreviewService';

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
const previewService = getPreviewService();

/**
 * Resilient model call: try providers in order and return the first non-empty
 * reply. The engine must run even when one provider's key is absent — relying on
 * Claude alone made the new engine silently fall back to the legacy path in
 * production (where only Gemini/Groq keys were set). Providers without a native
 * system-prompt slot get the system text prepended to the user message.
 */
/** Canned "no real answer" replies that must NOT count as a usable generation. */
function isUsableResponse(out: string | undefined | null): boolean {
  if (!out || !out.trim()) return false;
  const t = out.trim();
  if (t.length < 12) return false;
  // aiRouter / offline / provider canned fallbacks — treat as failure so the
  // chain tries the NEXT provider instead of poisoning generation with prose
  // that parses to zero file edits.
  if (/temporarily busy|try again in|service is (temporarily )?unavailable|could not (process|generate)|i (cannot|can't) (help|assist)|api key/i.test(t)) return false;
  return true;
}

function makeResilientModelCall(userKey?: string): ModelCall {
  const key = typeof userKey === 'string' && userKey.trim() ? userKey : undefined;
  return async (system, user) => {
    const attempts: Array<{ name: string; run: () => Promise<string> }> = [
      // Claude first — when ANTHROPIC_BASE_URL points at the user's paid proxy
      // (e.g. aicredit.ai) this is the highest-quality coder; it cleanly throws
      // and falls through if the proxy/key is unavailable.
      { name: 'claude', run: () => callClaude(user, key, [], system) },
      // aiRouter is the same provider-selection path the legacy build uses in prod.
      { name: 'aiRouter', run: () => aiRouter.route(user, [], 'free' as any, undefined, system) },
      { name: 'gemini', run: () => callGemini(user, key, [], system) },
      { name: 'groq', run: () => callGroq(`${system}\n\n${user}`, key, []) },
      { name: 'openai', run: () => callOpenAI(`${system}\n\n${user}`, key, []) },
      { name: 'deepseek', run: () => callDeepSeek(`${system}\n\n${user}`, key, []) },
      { name: 'openrouter', run: () => callOpenRouter(`${system}\n\n${user}`, key, []) },
    ];
    let lastErr: unknown;
    let lastOut = '';
    for (const a of attempts) {
      try {
        const out = await a.run();
        if (isUsableResponse(out)) return out;
        if (out && out.trim()) { lastOut = out; console.warn(`[BUILD] provider ${a.name} returned a canned/empty reply — trying next`); }
      } catch (e: any) {
        lastErr = e;
        console.warn(`[BUILD] provider ${a.name} failed: ${e?.message || e}`);
      }
    }
    // Nothing usable from any provider — return the last non-empty reply (if any)
    // so the caller at least sees the real message instead of throwing blindly.
    if (lastOut) return lastOut;
    throw new Error(`All AI providers failed for build${lastErr ? `: ${(lastErr as any)?.message || lastErr}` : ''}`);
  };
}

export function registerBuildRoutes(app: Express): void {
  app.post('/api/build', async (req: Request, res: Response) => {
    try {
      const { prompt, files, userKey, preview } = req.body || {};
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'prompt (string) is required' });
      }

      // Model call backed by the shared aiCalls layer — multi-provider with fallback.
      const callModel: ModelCall = makeResilientModelCall(userKey);
      const { generate, fix, completeFeatures } = makeAiEditGenerator(callModel);

      const result = await runBuild({
        prompt,
        files: files && typeof files === 'object' ? files : undefined,
        generate,
        fix,
        completeFeatures,
        // Bound total model calls so a synchronous build can't hit the gateway
        // timeout (504): fast single-shot generate + at most 1 repair + 1
        // feature-completion pass.
        maxRepairAttempts: 1,
        maxFeatureAttempts: 1,
      });

      // Preview is a privilege: only start it when the critical gates pass.
      let previewInfo: unknown = undefined;
      if (preview && result.previewAllowed) {
        const vfs = VirtualFileSystem.fromRecord(result.files);
        previewInfo = await previewService.startPreview('build', vfs);
      } else if (preview && !result.previewAllowed) {
        previewInfo = { ok: false, target: 'static', reason: 'Preview blocked: critical validation gates failed. See validation report.' };
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
        validation: result.validation,
        previewAllowed: result.previewAllowed,
        preview: previewInfo,
      });
    } catch (err: any) {
      console.error('[BUILD] error:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Build failed' });
    }
  });
}
