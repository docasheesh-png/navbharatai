import type { Express, Request, Response } from 'express';
import { runBuild } from '../project/BuildPipeline';
import { runProEngine } from '../EngineerAI/ProEngineRunner';
import { Guider, gradeAgainstSpec } from '../Guider/Guider';
import { shouldConfirm } from '../Guider/GuiderGate';
import type { GuiderSpec } from '../Guider/GuiderTypes';
import { eventBus } from '../lib/eventBus';
import { EventType } from '../AppMakerLab/eventbus/EventTypes';

/** Compact textual view of the built files for the grader (tree + budgeted snippets). */
function buildGradeContext(files: Record<string, string>): string {
  const paths = Object.keys(files);
  let body = '';
  let budget = 10_000;
  for (const p of paths) {
    if (budget <= 0) break;
    const snippet = (files[p] || '').slice(0, 1500);
    const block = `\n--- ${p} ---\n${snippet}`;
    body += block.slice(0, budget);
    budget -= block.length;
  }
  return `Files (${paths.length}):\n${paths.join('\n')}\n${body}`;
}
import { makeAiEditGenerator, summarizeForMemory, type ModelCall, type BuildMemory } from '../project/aiEdits';
import { orchestrateGenerate } from '../pro/ProOrchestrator';
import { proMemoryStore } from '../pro/ProMemory';
import { VirtualFileSystem } from '../project/ProjectModel';
import { callClaude, callGemini, callGroq, callOpenAI, callDeepSeek, callOpenRouter } from '../lib/aiCalls';
import { AnthropicProvider } from '../AI/Router/providers/AnthropicProvider';
import { aiRouter } from '../lib/aiRouter';
import { getPreviewService } from '../runtime/PreviewService';
import { getMetrics, estimateTokens } from '../lib/metrics';

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
        if (isUsableResponse(out)) {
          // Observability: record (estimated) token use + cost for the provider
          // that actually produced the usable generation.
          try { getMetrics().recordModelCall(a.name, estimateTokens(system) + estimateTokens(user), estimateTokens(out)); } catch { /* never block a build on metrics */ }
          return out;
        }
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

/**
 * Phase 85 — Design-to-Code: when the user provides design images, wrap the
 * standard model call to include vision via AnthropicProvider (Claude Opus native
 * vision). Falls back to text-only callModel if Anthropic is unavailable.
 */
function makeVisionModelCall(baseCall: ModelCall, images: string[]): ModelCall {
  const provider = new AnthropicProvider('claude-opus-4-8');
  return async (system, user) => {
    try {
      const res = await provider.execute(user, undefined, undefined, system, images);
      if (res.content && isUsableResponse(res.content)) return res.content;
    } catch { /* fall through to base */ }
    return baseCall(system, user);
  };
}

/** Parse the Claude-Code-style memory payload from a request body (defensive). */
function parseMemory(body: any): BuildMemory {
  const history = Array.isArray(body?.history)
    ? body.history
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, 4000) }))
        .slice(-20)
    : [];
  const summary = typeof body?.memorySummary === 'string' ? body.memorySummary.slice(0, 2000) : '';
  const editLog = Array.isArray(body?.editLog)
    ? body.editLog.filter((e: any) => typeof e === 'string').slice(-30)
    : [];
  return { history, summary, editLog };
}

/** A one-line record of what this build/edit changed, for the session edit log. */
function editLogEntry(prompt: string, files: Record<string, string>, isEdit: boolean): string {
  const names = Object.keys(files).slice(0, 8).join(', ');
  return `${isEdit ? 'Edit' : 'Build'}: "${prompt.slice(0, 80)}" → ${Object.keys(files).length} file(s)${names ? ` (${names})` : ''}`;
}

export function registerBuildRoutes(app: Express): void {
  // ── Guider: propose a design + decide if user confirmation is needed (Hybrid).
  //    Flag-gated. The frontend calls this BEFORE a build; if `confirm` is false
  //    it builds straight away, otherwise it shows a confirmation card with the
  //    proposal (in the user's language) and only builds after approval. Never
  //    blocks: any failure returns `confirm:false` so the normal build proceeds.
  app.post('/api/guider/plan', async (req: Request, res: Response) => {
    try {
      const { prompt, files, userKey, isEdit, agentic } = req.body || {};
      if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt (string) is required' });
      const enabled = process.env.PRO_AGENTIC_ENGINE === '1' || agentic === true;
      const hasExistingFiles = !!(files && typeof files === 'object' && Object.keys(files).length > 0);
      if (!enabled || !shouldConfirm({ prompt, hasExistingFiles, isEdit: isEdit === true })) {
        return res.json({ confirm: false });
      }
      const callModel: ModelCall = makeResilientModelCall(userKey);
      const guider = new Guider({ callModel, generate: async () => ({ ok: false, gradeContext: '' }) });
      const plan = await guider.plan(prompt);
      return res.json({ confirm: true, plan });
    } catch {
      // Planning must never block a build — fall through to a normal (no-confirm) build.
      return res.json({ confirm: false });
    }
  });

  // ── Guider: grade a built app against the spec (Slice 3 — quality loop). Returns
  //    { grade: { pass, score, gaps[] } } or { grade: null } when disabled/empty.
  //    The frontend uses this AFTER a build fully completes to decide whether to
  //    auto-refine. Never throws — failure returns grade:null (no refine).
  app.post('/api/guider/grade', async (req: Request, res: Response) => {
    try {
      const { spec, prompt, files, userKey, agentic } = req.body || {};
      const enabled = process.env.PRO_AGENTIC_ENGINE === '1' || agentic === true;
      if (!enabled || !files || typeof files !== 'object' || Object.keys(files).length === 0) {
        return res.json({ grade: null });
      }
      const useSpec: GuiderSpec = (spec && Array.isArray(spec.acceptanceCriteria) && spec.acceptanceCriteria.length)
        ? spec
        : { summary: String(prompt || ''), requirements: [String(prompt || '')], acceptanceCriteria: [{ id: 'c1', text: String(prompt || '') }], outOfScope: [] };
      const callModel: ModelCall = makeResilientModelCall(userKey);
      const grade = await gradeAgainstSpec(callModel, useSpec, buildGradeContext(files));
      return res.json({ grade });
    } catch {
      return res.json({ grade: null });
    }
  });

  app.post('/api/build', async (req: Request, res: Response) => {
    try {
      const { prompt, files, userKey, preview, isEdit } = req.body || {};
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'prompt (string) is required' });
      }

      // Model call backed by the shared aiCalls layer — multi-provider with fallback.
      const memory = parseMemory(req.body);
      const callModel: ModelCall = makeResilientModelCall(userKey);
      const { generate, fix, completeFeatures } = makeAiEditGenerator(callModel, memory);

      const t0 = Date.now();
      const result = await runBuild({
        prompt,
        files: files && typeof files === 'object' ? files : undefined,
        generate,
        fix,
        completeFeatures,
        isEdit: isEdit === true,
        // Bound total model calls so a synchronous build can't hit the gateway
        // timeout (504): fast single-shot generate + 1 repair + up to 2
        // feature-completion passes (2 passes meaningfully raise coverage on big
        // multi-module apps while staying well under the call-count that caused 504).
        maxRepairAttempts: 1,
        maxFeatureAttempts: 2,
      });
      try { getMetrics().recordBuild({ ok: result.ok, previewAllowed: result.previewAllowed, isEdit: isEdit === true, ms: Date.now() - t0, repairAttempts: result.repairAttempts }); } catch { /* metrics never block */ }

      // Preview is a privilege: only start it when the critical gates pass.
      let previewInfo: unknown = undefined;
      if (preview && result.previewAllowed) {
        const vfs = VirtualFileSystem.fromRecord(result.files);
        previewInfo = await previewService.startPreview('build', vfs);
      } else if (preview && !result.previewAllowed) {
        previewInfo = { ok: false, target: 'static', reason: 'Preview blocked: critical validation gates failed. See validation report.' };
      }

      const thisEntry = editLogEntry(prompt, result.files, isEdit === true);
      const updatedSummary = await summarizeForMemory(callModel, memory.summary, [
        ...(memory.history || []),
        { role: 'user' as const, content: prompt },
        { role: 'assistant' as const, content: thisEntry },
      ]);
      const updatedEditLog = [...(memory.editLog || []), thisEntry].slice(-30);

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
        memorySummary: updatedSummary,
        editLog: updatedEditLog,
      });
    } catch (err: any) {
      console.error('[BUILD] error:', err?.message || err);
      // BUG E2 FIX: Sanitize raw error messages before sending to client (no file paths / stack traces)
      const safeMsg = (err?.message || 'Build failed').replace(/\/[^\s:]+\/[^\s:]+/g, '[path]').slice(0, 200);
      return res.status(500).json({ error: safeMsg });
    }
  });

  // Streaming build (SSE): module-by-module generation with LIVE real progress.
  // The open connection means the many small per-module calls never hit the
  // gateway 504, so large multi-module apps build to ~100% coverage.
  app.post('/api/build-stream', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    const send = (event: unknown) => { try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client gone */ } };
    // Heartbeat so proxies don't idle-timeout the stream during long model calls.
    const heartbeat = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch { /* ignore */ } }, 15_000);

    // ── Always-terminal guarantee ──────────────────────────────────────────────
    // Cloud Run hard-kills any request after CLOUD_RUN_TIMEOUT (300s). A long
    // agentic build can exceed that, cutting the stream BEFORE a terminal event is
    // sent — the client then shows "Build stream ended without a result". To make
    // sure the user ALWAYS gets a result, we run under a soft deadline below the
    // platform limit: when it fires we abort the engine and emit a `partial`
    // complete with whatever was built so far (the client can then auto-continue).
    const SOFT_DEADLINE_MS = 240_000; // 4 min, ~1 min under Cloud Run's 300s cap
    const startedAt = Date.now();
    const deadline = new AbortController();
    const deadlineTimer = setTimeout(() => deadline.abort(), SOFT_DEADLINE_MS);
    let sentTerminal = false;
    let sid = 'pro'; // correlation id for G1 lifecycle events (set from sessionId after parse)
    const sendComplete = (payload: Record<string, unknown>) => {
      if (sentTerminal) return;
      sentTerminal = true;
      send({ type: 'complete', ...payload });
    };
    const cleanup = () => { clearInterval(heartbeat); clearTimeout(deadlineTimer); };

    try {
      const { prompt, files, userKey, preview, isEdit } = req.body || {};
      if (!prompt || typeof prompt !== 'string') { send({ type: 'error', message: 'prompt (string) is required' }); cleanup(); return res.end(); }

      // Foundations (G1) — best-effort lifecycle events (never block the build).
      sid = typeof req.body?.sessionId === 'string' && req.body.sessionId ? req.body.sessionId : 'pro';
      eventBus.publish({ type: EventType.BUILD_STARTED, workspaceId: sid, sender: 'pro', payload: { isEdit: isEdit === true } });

      // Phase 85 — design-to-code: extract uploaded design images (base64 strings)
      const designImages: string[] | undefined = Array.isArray(req.body?.designImages)
        ? req.body.designImages.filter((x: any) => typeof x === 'string').slice(0, 4)
        : undefined;

      const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
      const inRequestMemory = parseMemory(req.body);
      // Phase 74 — load persisted memory from Firestore to supplement in-request
      // memory (frontend passes current session state; Firestore adds cross-session
      // persistence so the project stays coherent after a browser refresh).
      const persistedMemory = sessionId
        ? await proMemoryStore.load(sessionId).catch(() => null)
        : null;
      const memory: import('../project/aiEdits').BuildMemory = {
        history: inRequestMemory.history,
        summary: persistedMemory?.memorySummary || inRequestMemory.summary,
        editLog: (inRequestMemory.editLog ?? []).length > 0
          ? inRequestMemory.editLog
          : (persistedMemory?.editLog ?? []),
      };
      const baseCallModel: ModelCall = makeResilientModelCall(userKey);
      // Phase 85 — use vision-enabled model call when design images are uploaded.
      const callModel: ModelCall = designImages && designImages.length > 0
        ? makeVisionModelCall(baseCallModel, designImages)
        : baseCallModel;

      // ── Agentic edit engine (Phase 1 — VFS tier). Additive + flag-gated: it is
      //    the PRIMARY edit path when enabled, and falls back transparently to the
      //    legacy runBuild() pipeline below if it errors or yields nothing usable.
      //    No terminal complete/error is sent until a path actually succeeds, so a
      //    fallback is invisible to the UI. ────────────────────────────────────
      // Phase 6: agentic engine is ON by default — disable with PRO_AGENTIC_ENGINE=0
      const agenticEnabled = process.env.PRO_AGENTIC_ENGINE !== '0';
      if (agenticEnabled) {
        try {
          const eng = await runProEngine({
            // Phase 85: when design images are provided, prepend a design hint to the
            // agentic prompt so the agent knows it should match the visual design.
            prompt: designImages && designImages.length > 0
              ? `[DESIGN IMAGE(S) PROVIDED — generate UI code that matches the visual design in the image(s)]\n${prompt}`
              : prompt,
            files: files && typeof files === 'object' ? files : undefined,
            callModel,
            isEdit: isEdit === true,
            sessionId,
            // User's own E2B key unlocks the top tier for large apps (billed to them).
            userE2bKey: typeof req.body?.userE2bKey === 'string' ? req.body.userE2bKey : undefined,
            // GitHub token for clone_repo + git_push (from user's Secrets & Keys settings).
            githubToken: typeof req.body?.githubToken === 'string' ? req.body.githubToken : undefined,
            // User's database credentials (from Settings → App Settings → Database).
            dbConfig: req.body?.dbConfig && typeof req.body.dbConfig === 'object' ? req.body.dbConfig : undefined,
            send: (ev) => send(ev),
            signal: deadline.signal,
          });
          // Emit a terminal result when the engine produced usable files OR the soft
          // deadline fired (so the user always gets what was built — never "no result").
          if (eng.usable || deadline.signal.aborted) {
            send({ type: 'status', message: 'Updating project memory…' });
            const thisEntry = editLogEntry(prompt, eng.files, isEdit === true);
            const turnHistory = [
              ...(memory.history || []),
              { role: 'user' as const, content: prompt },
              { role: 'assistant' as const, content: thisEntry },
            ];
            const updatedSummary = await summarizeForMemory(callModel, memory.summary, turnHistory);
            const updatedEditLog = [...(memory.editLog || []), thisEntry].slice(-30);

            let previewInfo: unknown = undefined;
            if (preview && eng.previewAllowed) {
              const vfs = VirtualFileSystem.fromRecord(eng.files);
              previewInfo = await previewService.startPreview('build', vfs);
            } else if (preview && !eng.previewAllowed) {
              previewInfo = { ok: false, target: 'static', reason: 'Preview blocked: critical validation gates failed. See validation report.' };
            }

            sendComplete({
              ok: eng.ok,
              files: eng.files,
              fileCount: eng.fileCount,
              verify: eng.verify,
              validation: eng.validation,
              previewAllowed: eng.previewAllowed,
              preview: previewInfo,
              memorySummary: updatedSummary,
              editLog: updatedEditLog,
              // `partial` tells the client the build was cut short by the soft
              // deadline and can be auto-continued for a complete result.
              partial: eng.partial || deadline.signal.aborted,
            });
            eventBus.publish({ type: EventType.BUILD_COMPLETED, workspaceId: sid, sender: 'pro', payload: { path: 'agentic', tier: eng.tier, usable: eng.usable, partial: eng.partial || deadline.signal.aborted, fileCount: eng.fileCount, previewAllowed: eng.previewAllowed } });
            cleanup();
            return res.end();
          }
          // Not usable → fall through to the legacy pipeline.
          send({ type: 'status', message: 'Refining with the standard build pipeline…' });
        } catch (e: any) {
          console.warn('[BUILD] Agentic engine error — falling back to runBuild:', e?.message || e);
        }
      }

      const { generate: singleGenerate, fix, completeFeatures } = makeAiEditGenerator(callModel, memory);
      // Phase 72 — multi-agent orchestration: for full-stack tasks, fan out to two
      // parallel focused generation calls (frontend + backend) and merge results.
      const generate = (p: string, v: import('../project/ProjectModel').VirtualFileSystem) =>
        orchestrateGenerate(p, v, callModel).catch(() => singleGenerate(p, v));

      const t0 = Date.now();
      // Race the build against the soft deadline so a hung/slow build can never run
      // past Cloud Run's limit and drop the stream — we emit a partial result instead.
      const deadlineHit = new Promise<'deadline'>((resolve) => {
        if (deadline.signal.aborted) return resolve('deadline');
        deadline.signal.addEventListener('abort', () => resolve('deadline'), { once: true });
      });
      const raced = await Promise.race([
        runBuild({
          prompt,
          files: files && typeof files === 'object' ? files : undefined,
          generate, fix, completeFeatures,
          modular: true,            // one module per call, verified between each
          isEdit: isEdit === true,  // edits skip the feature-completion loop
          maxRepairAttempts: 1,
          onProgress: (ev) => send(ev),
        }),
        deadlineHit,
      ]);
      if (raced === 'deadline') {
        const inputFiles = files && typeof files === 'object' ? files : {};
        sendComplete({ ok: false, files: inputFiles, fileCount: Object.keys(inputFiles).length, previewAllowed: false, partial: true });
        cleanup();
        return res.end();
      }
      const result = raced;
      try { getMetrics().recordBuild({ ok: result.ok, previewAllowed: result.previewAllowed, isEdit: isEdit === true, ms: Date.now() - t0, repairAttempts: result.repairAttempts }); } catch { /* metrics never block */ }

      // Refresh the rolling memory so the NEXT turn stays coherent (Claude-Code
      // style): append this turn, re-summarize, extend the edit log. Best-effort.
      send({ type: 'status', message: 'Updating project memory…' });
      const thisEntry = editLogEntry(prompt, result.files, isEdit === true);
      const turnHistory = [
        ...(memory.history || []),
        { role: 'user' as const, content: prompt },
        { role: 'assistant' as const, content: thisEntry },
      ];
      const updatedSummary = await summarizeForMemory(callModel, memory.summary, turnHistory);
      const updatedEditLog = [...(memory.editLog || []), thisEntry].slice(-30);

      let previewInfo: unknown = undefined;
      if (preview && result.previewAllowed) {
        const vfs = VirtualFileSystem.fromRecord(result.files);
        previewInfo = await previewService.startPreview('build', vfs);
      } else if (preview && !result.previewAllowed) {
        previewInfo = { ok: false, target: 'static', reason: 'Preview blocked: critical validation gates failed. See validation report.' };
      }

      sendComplete({
        ok: result.ok,
        files: result.files,
        fileCount: result.fileCount,
        verify: result.verify,
        validation: result.validation,
        previewAllowed: result.previewAllowed,
        preview: previewInfo,
        memorySummary: updatedSummary,
        editLog: updatedEditLog,
        partial: false,
      });
      eventBus.publish({ type: EventType.BUILD_COMPLETED, workspaceId: sid, sender: 'pro', payload: { path: 'legacy', ok: result.ok, fileCount: result.fileCount, previewAllowed: result.previewAllowed, partial: false } });
      if (sessionId) {
        proMemoryStore.save(sessionId, {
          memorySummary: updatedSummary,
          editLog: updatedEditLog,
        }).catch(() => {});
      }
    } catch (err: any) {
      // Only surface an error if we haven't already given the user a result.
      if (!sentTerminal) {
        const safeMsg = (err?.message || 'Build failed').replace(/\/[^\s:]+\/[^\s:]+/g, '[path]').slice(0, 200);
        send({ type: 'error', message: safeMsg });
      }
      eventBus.publish({ type: EventType.BUILD_FAILED, workspaceId: sid, sender: 'pro', payload: { message: (err?.message || 'error').slice(0, 200), alreadyAnswered: sentTerminal } });
    } finally {
      // Last-resort guarantee: if no terminal event went out (an unexpected exit
      // path), return the user's input files as a partial result rather than
      // letting the stream close empty ("Build stream ended without a result").
      if (!sentTerminal) {
        const inputFiles = (req.body?.files && typeof req.body.files === 'object') ? req.body.files : {};
        send({ type: 'complete', ok: false, files: inputFiles, fileCount: Object.keys(inputFiles).length, previewAllowed: false, partial: true });
      }
      cleanup();
      res.end();
    }
  });
}
