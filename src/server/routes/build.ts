import type { Express, Request, Response } from 'express';
import { buildRateLimiter, requireUserMatch, verifyFirebaseToken, enforceNotBanned } from '../lib/authMiddleware';
import { consumeEngineerQuota } from '../lib/engineerQuota';
import { runBuild } from '../project/BuildPipeline';
import { runProEngine } from '../EngineerAI/ProEngineRunner';
import { runUnifiedBuild, isUnifiedEngineEnabled } from '../project/UnifiedBuildOrchestrator';
import { eventBus } from '../lib/eventBus';
import { EventType } from '../AppMakerLab/eventbus/EventTypes';

/**
 * SECURITY (cost/history attribution): a build's cost and history are attributed ONLY to the
 * cryptographically-verified Firebase uid — NEVER a client-supplied `userId` body field, which any
 * caller could set to a victim's uid to inflate that victim's monthly cost/quota or forge build
 * history under their name. No verified identity → no attribution (an anonymous build is simply not
 * recorded against anyone, exactly as before for signed-out users).
 */
export function resolveAttributionUserId(verifiedUid: string | null | undefined): string | undefined {
  return verifiedUid || undefined;
}

import { APP_KNOWLEDGE_BASE } from '../AppContext/AppKnowledgeBase';
import { makeAiEditGenerator, summarizeForMemory, type ModelCall, type BuildMemory } from '../project/aiEdits';
import { orchestrateGenerate } from '../pro/ProOrchestrator';
import { proMemoryStore } from '../pro/ProMemory';
import { proBuildSessionStore } from '../pro/ProBuildSession';
import { generateTestSuite } from '../pro/ProTestGen';
import { injectTestResults } from '../project/ValidationPipeline';
import { reviewCode } from '../pro/ProCodeReview';
import { VirtualFileSystem } from '../project/ProjectModel';
import { callClaude, callGemini, callGroq, callGrok, callOpenAI, callDeepSeek, callOpenRouter } from '../lib/aiCalls';
import { AnthropicProvider } from '../AI/Router/providers/AnthropicProvider';
import { aiRouter } from '../lib/aiRouter';
import { getPreviewService } from '../runtime/PreviewService';
import { getMetrics, estimateTokens } from '../lib/metrics';
import { metricsStore } from '../lib/metricsStore';
import { buildHistoryStore } from '../project/BuildHistoryStore';
import { listUserWorkspaceApps } from '../AgentV3/WorkspaceFileStore';
import { workspaceLock } from '../project/WorkspaceLock';
import { userCostStore } from '../lib/UserCostStore';
import { userBuildHistoryStore, type BuildStatus } from '../lib/UserBuildHistoryStore';
import { usdToInr } from '../lib/UsdInrRate';
import { envFlag } from '../lib/envFlag';
import { workspacePrefixFor } from '../lib/workspaceIdentity';

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
 * Phase 2.2 — Unified preview ladder helper.
 *
 * Single code path used by BOTH the agentic and legacy build routes. Wraps
 * startPreview with:
 *   - Consistent 8s timeout (was missing on the legacy path — could hang indefinitely)
 *   - try/catch so a preview failure never breaks the build response
 *   - Early `preview_url` SSE event so the iframe can start loading before
 *     `sendComplete` arrives (was previously only available after the full payload)
 *
 * Returns the PreviewResult (or a {ok:false} on failure) and also emits the
 * `preview_url` event via `send` when the preview is ready.
 */
async function startPreviewSafe(
  files: Record<string, string>,
  previewAllowed: boolean,
  wantPreview: boolean,
  send: (ev: unknown) => void,
): Promise<unknown> {
  if (!wantPreview) return undefined;
  if (!previewAllowed) {
    return { ok: false, target: 'static', reason: 'Preview blocked: critical validation gates failed. See validation report.' };
  }
  try {
    const vfs = VirtualFileSystem.fromRecord(files);
    const result = await Promise.race([
      previewService.startPreview('build', vfs),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 8000)),
    ]);
    if (result?.ok && result.url) {
      send({ type: 'preview_url', url: result.url });
    }
    return result;
  } catch {
    return { ok: false, target: 'static', reason: 'Preview start failed.' };
  }
}

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
      // Claude first (native Anthropic SDK) — highest-quality coder; cleanly
      // throws and falls through to Grok if no Anthropic key is configured.
      { name: 'claude', run: () => callClaude(user, key, [], system) },
      // Grok (xAI) — primary model for Engineer AI's structured-JSON agentic format.
      // Added here so Pro builds benefit from Grok even when Claude is unavailable.
      { name: 'grok', run: () => callGrok(user, key, [], system) },
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
  // G1.3 — Capability registry endpoint. Returns the full AppKnowledgeBase so AI
  // assistants and tooling can programmatically discover what NavBharatAI can do.
  // Public (no auth) — it's a feature list, not private data.
  app.get('/api/capabilities', (_req: Request, res: Response) => {
    res.json({ version: 1, features: APP_KNOWLEDGE_BASE });
  });

  // ── GUIDER (RETIRED) — two permanent no-ops, and the dead code below them is now gone.
  //
  // These were unauthenticated endpoints that, when a caller passed `agentic:true`, ran an LLM call on
  // NavBharatAI's OWN provider budget — a money-bleed surface, sibling of the retired /api/pro-* routes.
  // The SEC Phase 5 re-audit neutralised them by putting an early `return` at the top of each handler.
  //
  // WHY THE BODIES ARE DELETED RATHER THAN LEFT BEHIND THE RETURN. What sat under those returns was
  // ~40 lines of unreachable code that still CONSTRUCTED the paid model call. Unreachable is not the
  // same as harmless: it reads as a working feature that someone merely switched off, so the obvious
  // "cleanup" — deleting the stray early return — silently re-arms the exact money bleed the audit
  // closed. A guard whose removal looks like tidying is not a guard. If this capability is ever wanted
  // again it comes back through v5.0's authenticated, billed path, not by reviving this.
  //
  // The old comments claimed "the frontend calls this BEFORE a build" and "the frontend uses this AFTER
  // a build". Neither was true — v5.0 superseded both and no client has called either for months.
  //
  // KEPT AS 200 NO-OPS RATHER THAN DELETED OUTRIGHT, deliberately: the Android app ships BUNDLED, so an
  // old installed copy runs its own frozen frontend forever. A 404 would surface there as a broken
  // build; these responses are the exact "nothing to confirm" / "no grade" shapes such a client already
  // handles, so it degrades into a normal build instead of an error.
  app.post('/api/guider/plan', (_req: Request, res: Response) => {
    res.json({ confirm: false });
  });

  app.post('/api/guider/grade', (_req: Request, res: Response) => {
    res.json({ grade: null });
  });

  app.post('/api/build', buildRateLimiter(), enforceNotBanned(), async (req: Request, res: Response) => {
    try {
      const { prompt, files, userKey, preview, isEdit } = req.body || {};
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'prompt (string) is required' });
      }

      // Per-user daily build quota — an anti-abuse cost guard (a single user can't spin unlimited
      // sandboxes + model calls). Attributed to the VERIFIED Firebase uid only; fails OPEN on any
      // infra hiccup; env-tunable via ENGINEER_DAILY_LIMIT (default 50/day, `off` disables). Anon
      // users are governed by the IP rate-limiter above instead.
      const quotaUid = resolveAttributionUserId(await verifyFirebaseToken(req));
      if (quotaUid) {
        const q = await consumeEngineerQuota(quotaUid);
        if (!q.allowed) {
          return res.status(429).json({ error: `Daily build limit reached (${q.used}/${q.limit}). It resets at 00:00 UTC.` });
        }
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
  app.post('/api/build-stream', buildRateLimiter(), enforceNotBanned(), async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // Phase 1.5 — flush headers immediately so the browser opens the SSE pipe
    // before any async work begins. This is what drives "first token < 1 second."
    res.flushHeaders();
    const send = (event: unknown) => { try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client gone */ } };
    // Phase 1.5 — first visible event arrives within ~50ms of request receipt.
    send({ type: 'status', message: 'Analyzing your request…' });
    // Heartbeat so proxies don't idle-timeout the stream during long model calls.
    const heartbeat = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch { /* ignore */ } }, 15_000);

    // ── Always-terminal guarantee ──────────────────────────────────────────────
    // Cloud Run hard-kills any request after CLOUD_RUN_TIMEOUT (300s). A long
    // agentic build can exceed that, cutting the stream BEFORE a terminal event is
    // sent — the client then shows "Build stream ended without a result". To make
    // sure the user ALWAYS gets a result, we run under a soft deadline below the
    // platform limit: when it fires we abort the engine and emit a `partial`
    // complete with whatever was built so far (the client can then auto-continue).
    //
    // G11 — reduced from 240s to 200s so the ~60s post-engine work (memory
    // update + preview + code review) has a 5-min buffer before Cloud Run kills us.
    // Cloud Run request timeout is 3600s (1 hour); SOFT_DEADLINE_MS = 3300s (55 min)
    // leaves 5 min for the post-engine work (memory summarization, preview, code review).
    const SOFT_DEADLINE_MS = 3_300_000; // 55 min — 5 min buffer before Cloud Run's 1-hour hard kill
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
      // SECURITY: attribute cost/history to the VERIFIED Firebase identity only — never the
      // client-supplied req.body.userId (spoofable → griefing a victim's cost/quota/history).
      const reqUserId: string | undefined = resolveAttributionUserId(await verifyFirebaseToken(req));

      // Per-user daily build quota (same anti-abuse cost guard as /api/build; fails open,
      // env-tunable ENGINEER_DAILY_LIMIT). Refuse over-limit with an honest terminal SSE event.
      if (reqUserId) {
        const q = await consumeEngineerQuota(reqUserId);
        if (!q.allowed) {
          send({ type: 'error', message: `Daily build limit reached (${q.used}/${q.limit}). It resets at 00:00 UTC.` });
          cleanup();
          return res.end();
        }
      }

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
        // Phase 4.1 — distributed workspace lock: prevent two concurrent builds on
        // the same workspace across Cloud Run instances (race condition guard).
        // Fail-open: if Firestore is unreachable, the lock returns acquired:true so
        // builds always proceed. The lock is released in the finally block below.
        const lockResult = sid ? await workspaceLock.tryAcquire(sid) : { acquired: true, lockId: 'nosid' };
        if (!lockResult.acquired) {
          const existingFiles = files && typeof files === 'object' ? files : {};
          send({ type: 'status', message: `Another build is already running for this workspace. ${lockResult.reason || ''}` });
          send({ type: 'complete', ok: false, files: existingFiles, fileCount: Object.keys(existingFiles).length, previewAllowed: false, partial: true });
          return;
        }
        const wsLockId = lockResult.lockId!;
        try {
          const enginePrompt = designImages && designImages.length > 0
            ? `[DESIGN IMAGE(S) PROVIDED — generate UI code that matches the visual design in the image(s)]\n${prompt}`
            : prompt;
          const engineFiles = files && typeof files === 'object' ? files : undefined;
          const engineUserE2bKey = typeof req.body?.userE2bKey === 'string' ? req.body.userE2bKey : undefined;
          const engineGithubToken = typeof req.body?.githubToken === 'string' ? req.body.githubToken : undefined;
          const engineDbConfig = req.body?.dbConfig && typeof req.body.dbConfig === 'object' ? req.body.dbConfig : undefined;

          // Phase 1.2 — route through UnifiedBuildOrchestrator when ENGINE=v2 (opt-in).
          // ENGINE=v1 (or unset) keeps the direct runProEngine call below for zero-risk rollback.
          let eng: Awaited<ReturnType<typeof runProEngine>>;
          if (isUnifiedEngineEnabled()) {
            // Drain the async generator: forward progress events, capture the terminal result.
            let doneResult: Awaited<ReturnType<typeof runProEngine>> | null = null;
            for await (const ev of runUnifiedBuild({
              prompt: enginePrompt,
              files: engineFiles,
              callModel,
              mode: isEdit === true ? 'edit' : 'fresh_build',
              sessionId,
              userE2bKey: engineUserE2bKey,
              githubToken: engineGithubToken,
              dbConfig: engineDbConfig,
              signal: deadline.signal,
            })) {
              if (ev.type === '_done') {
                doneResult = ev.result as Awaited<ReturnType<typeof runProEngine>>;
              } else if (ev.type === '_error') {
                throw new Error(ev.message);
              } else {
                send(ev);
              }
            }
            if (!doneResult) throw new Error('UnifiedBuildOrchestrator: no result received');
            eng = doneResult;
          } else {
            // Race the engine against the soft deadline.  When the deadline fires
            // we immediately resolve with a sentinel so the route can emit a partial
            // result without waiting for an in-flight AI HTTP call to finish.  The
            // engine promise continues in the background and is silently abandoned
            // (the AI call will finish, but no further SSE events are sent).
            const DEADLINE_SENTINEL = '__deadline__' as const;
            const deadlineRace = new Promise<typeof DEADLINE_SENTINEL>((resolve) => {
              if (deadline.signal.aborted) { resolve(DEADLINE_SENTINEL); return; }
              deadline.signal.addEventListener('abort', () => resolve(DEADLINE_SENTINEL), { once: true });
            });
            const engineResult = await Promise.race([
              runProEngine({
                prompt: enginePrompt,
                files: engineFiles,
                callModel,
                isEdit: isEdit === true,
                sessionId,
                userE2bKey: engineUserE2bKey,
                githubToken: engineGithubToken,
                dbConfig: engineDbConfig,
                send: (ev) => send(ev),
                signal: deadline.signal,
              }),
              deadlineRace,
            ]);
            if (engineResult === DEADLINE_SENTINEL) {
              // Deadline fired while the AI was mid-call — emit partial immediately.
              const inputFiles = engineFiles && typeof engineFiles === 'object' ? engineFiles : {};
              sendComplete({ ok: false, files: inputFiles, fileCount: Object.keys(inputFiles).length, previewAllowed: false, partial: true });
              cleanup();
              return res.end();
            }
            eng = engineResult;
          }
          // Emit a terminal result when the engine produced usable files, the soft
          // deadline fired, OR any files exist (partial build) — never "no result".
          if (eng.usable || deadline.signal.aborted || eng.fileCount > 0) {
            // G3 — surface the execution tier so the client can show the badge.
            if (eng.tier) send({ type: 'status', message: `Engine: ${eng.tier === 'e2b' ? 'E2B cloud VM' : eng.tier === 'cloudrun' ? 'server container' : 'in-memory'}` });
            send({ type: 'status', message: 'Updating project memory…' });
            const thisEntry = editLogEntry(prompt, eng.files, isEdit === true);
            const turnHistory = [
              ...(memory.history || []),
              { role: 'user' as const, content: prompt },
              { role: 'assistant' as const, content: thisEntry },
            ];
            // G11 — cap memory update at 8s: summarizeForMemory is an AI call with
            // no timeout of its own. If it runs long after the soft deadline, the
            // total request time can exceed Cloud Run's 300s hard kill, causing
            // "Build stream ended without a result". Fall back to the existing
            // summary to keep memory coherent even on timeout.
            const updatedSummary = await Promise.race([
              summarizeForMemory(callModel, memory.summary, turnHistory),
              new Promise<string>((resolve) => setTimeout(() => resolve(memory.summary || ''), 8000)),
            ]);
            const updatedEditLog = [...(memory.editLog || []), thisEntry].slice(-30);

            // Phase 2.2 — unified preview ladder (both paths through one helper).
            const previewInfo = await startPreviewSafe(eng.files, eng.previewAllowed, !!preview, send);

            // G5 — code review quality gate (best-effort, 12s cap, never blocks build).
            let codeReview: unknown = undefined;
            if (!isEdit) {
              try {
                codeReview = await Promise.race([
                  reviewCode(VirtualFileSystem.fromRecord(eng.files), callModel),
                  new Promise(resolve => setTimeout(() => resolve(undefined), 12000)),
                ]);
              } catch { /* review never blocks */ }
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
              tier: eng.tier,
              partial: eng.partial || deadline.signal.aborted || !eng.usable,
              codeReview,
              costUsd: eng.estimatedCostUsd,
            });
            eventBus.publish({ type: EventType.BUILD_COMPLETED, workspaceId: sid, sender: 'pro', payload: { path: 'agentic', tier: eng.tier, usable: eng.usable, partial: eng.partial || deadline.signal.aborted, fileCount: eng.fileCount, previewAllowed: eng.previewAllowed } });
            // G2 — wire metrics that were previously missing from the agentic path.
            try { getMetrics().recordBuild({ ok: eng.ok, previewAllowed: !!eng.previewAllowed, isEdit: isEdit === true, ms: Date.now() - startedAt }); } catch { /* metrics never block */ }
            metricsStore.save().catch(() => {});
            // Phase 4.2 — accumulate per-user monthly AI cost (display-only, never blocks).
            if (reqUserId && typeof eng.estimatedCostUsd === 'number' && eng.estimatedCostUsd > 0) {
              userCostStore.record(reqUserId, eng.estimatedCostUsd).catch(() => {});
            }
            // My Profile — per-build history record.
            if (reqUserId) {
              try {
                const isPartial = eng.partial || deadline.signal.aborted;
                const isCompleted = eng.ok && !isPartial;
                const isFailed = !eng.ok && !isPartial && (eng.fileCount ?? 0) === 0;
                const buildStatus: BuildStatus = isCompleted ? 'completed' : isFailed ? 'failed' : 'cancelled';
                const fullCostInr = usdToInr(eng.estimatedCostUsd ?? 0);
                // Partial charge for cancelled builds: 50% if files were written, else 0.
                const costInr = buildStatus === 'completed'
                  ? fullCostInr
                  : buildStatus === 'cancelled' && (eng.fileCount ?? 0) > 0
                  ? Math.round(fullCostInr * 0.5 * 100) / 100
                  : 0;
                const durationMs = Date.now() - startedAt;
                userBuildHistoryStore.record({
                  id: `${reqUserId}_${startedAt}`,
                  userId: reqUserId,
                  sessionId: sessionId || '',
                  title: (prompt || '').trim().slice(0, 80),
                  createdAt: startedAt,
                  durationMs,
                  costInr,
                  fullCostInr,
                  status: buildStatus,
                  progressPercent: buildStatus === 'cancelled' ? Math.min(90, Math.round(((eng.fileCount ?? 0) / 10) * 100)) : 0,
                  tier: eng.tier || 'vfs',
                  fileCount: eng.fileCount ?? 0,
                }).catch(() => {});
              } catch { /* history never blocks the build */ }
            }
            // Phase 2.1 — save version checkpoint for every successful build.
            if (sessionId && eng.ok && !eng.partial) {
              const shortPrompt = (prompt || '').slice(0, 60).replace(/\s+/g, ' ');
              const commitMsg = isEdit
                ? `feat(edit): ${shortPrompt} — ${eng.fileCount} files`
                : `feat: build "${shortPrompt}" — ${eng.fileCount} files, ${eng.tier || 'vfs'} tier`;
              buildHistoryStore.save(sessionId, {
                commitMessage: commitMsg,
                fileCount: eng.fileCount,
                files: eng.files,
                isEdit: isEdit === true,
                tier: eng.tier,
                ok: eng.ok,
              }).catch(() => {});
            }
            if (sessionId) {
              proBuildSessionStore.save(sessionId, {
                ok: eng.ok, files: eng.files, fileCount: eng.fileCount,
                verify: eng.verify, validation: eng.validation,
                previewAllowed: eng.previewAllowed, preview: previewInfo,
                memorySummary: updatedSummary, editLog: updatedEditLog,
                partial: eng.partial || deadline.signal.aborted,
              }).catch(() => {});
            }
            cleanup();
            return res.end();
          }
          // Engine ran but produced zero files — surface a clear error.
          // We do NOT fall through to the legacy one-shot pipeline: the agentic
          // tool-calling loop IS the build pipeline. A zero-file result means the
          // agent replied conversationally or failed before writing anything.
          send({ type: 'error', message: 'Build did not produce any files. Please describe what you want to build in more detail, or try again.' });
          cleanup();
          return res.end();
        } catch (e: any) {
          // Re-throw so the outer catch handles it — no silent fallback to legacy.
          console.error('[BUILD] Agentic engine error:', e?.message || e);
          throw e;
        } finally {
          // Phase 4.1 — always release the workspace lock (success, failure, or error).
          if (sid && wsLockId !== 'nosid') workspaceLock.release(sid, wsLockId).catch(() => {});
        }
        // Never reaches here — all paths above return, throw, or res.end().
        return;
      }

      // ── Legacy pipeline — EMERGENCY FALLBACK ONLY (PRO_AGENTIC_ENGINE=0) ──────
      // Reached only when agenticEnabled=false. Kept as an escape hatch; the
      // standard path is the agentic tool-calling loop above.
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
      metricsStore.save().catch(() => {});

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

      // Phase 17 — auto test generation: generate Vitest test files for the most
      // important parts of the built app (like Claude Code does). Best-effort,
      // 20s cap — never blocks or fails the build.
      let finalFiles = result.files;
      let testGenResult = { generated: 0, testPaths: [] as string[] };
      if (!isEdit) {
        try {
          const vfsForTests = VirtualFileSystem.fromRecord(result.files);
          const testFiles = await Promise.race([
            generateTestSuite(vfsForTests, callModel, 4),
            new Promise<Record<string, string>>((resolve) => setTimeout(() => resolve({}), 20000)),
          ]);
          const testPaths = Object.keys(testFiles);
          if (testPaths.length > 0) {
            finalFiles = { ...result.files, ...testFiles };
            testGenResult = { generated: testPaths.length, testPaths };
            send({ type: 'status', message: `Generated ${testPaths.length} test file${testPaths.length > 1 ? 's' : ''}: ${testPaths.join(', ')}` });
          }
        } catch { /* test gen never blocks the build */ }
      }

      // Phase 2.2 — unified preview ladder (both paths through one helper).
      const previewInfo = await startPreviewSafe(finalFiles, result.previewAllowed, !!preview, send);

      // G5 — code review quality gate (best-effort, 12s cap, never blocks build).
      let codeReview: unknown = undefined;
      if (!isEdit) {
        try {
          send({ type: 'status', message: 'Running code review…' });
          codeReview = await Promise.race([
            reviewCode(VirtualFileSystem.fromRecord(finalFiles), callModel),
            new Promise(resolve => setTimeout(() => resolve(undefined), 12000)),
          ]);
        } catch { /* review never blocks */ }
      }

      const finalValidation = testGenResult.generated > 0 && result.validation
        ? injectTestResults(result.validation, testGenResult)
        : result.validation;

      sendComplete({
        ok: result.ok,
        files: finalFiles,
        fileCount: Object.keys(finalFiles).length,
        verify: result.verify,
        validation: finalValidation,
        previewAllowed: result.previewAllowed,
        preview: previewInfo,
        memorySummary: updatedSummary,
        editLog: updatedEditLog,
        partial: false,
        codeReview,
      });
      eventBus.publish({ type: EventType.BUILD_COMPLETED, workspaceId: sid, sender: 'pro', payload: { path: 'legacy', ok: result.ok, fileCount: result.fileCount, previewAllowed: result.previewAllowed, partial: false } });
      // Phase 2.1 — save version checkpoint for every successful build.
      if (sessionId && result.ok) {
        const shortPrompt = (prompt || '').slice(0, 60).replace(/\s+/g, ' ');
        const finalFileCount = Object.keys(finalFiles).length;
        const commitMsg = isEdit
          ? `feat(edit): ${shortPrompt} — ${finalFileCount} files`
          : `feat: build "${shortPrompt}" — ${finalFileCount} files, vfs tier`;
        buildHistoryStore.save(sessionId, {
          commitMessage: commitMsg,
          fileCount: finalFileCount,
          files: finalFiles,
          isEdit: isEdit === true,
          tier: 'vfs',
          ok: result.ok,
        }).catch(() => {});
      }
      if (sessionId) {
        proMemoryStore.save(sessionId, { memorySummary: updatedSummary, editLog: updatedEditLog }).catch(() => {});
        proBuildSessionStore.save(sessionId, {
          ok: result.ok, files: finalFiles, fileCount: Object.keys(finalFiles).length,
          verify: result.verify, validation: result.validation,
          previewAllowed: result.previewAllowed, preview: previewInfo,
          memorySummary: updatedSummary, editLog: updatedEditLog, partial: false,
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

  // G1.2 — Refresh-safe build recovery. Client calls this on mount to restore
  // the last completed build for a sessionId without re-running the build.
  app.get('/api/build-session/:sessionId', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ error: 'sessionId required' });
      const session = await proBuildSessionStore.load(sessionId);
      if (!session) return res.status(404).json({ error: 'not found' });
      return res.json(session);
    } catch {
      return res.status(500).json({ error: 'failed to load session' });
    }
  });

  // Phase 2.1 — List all version checkpoints for a workspace (metadata only, no files).
  // Used by the frontend version history panel.
  app.get('/api/build-history/:sessionId', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ error: 'sessionId required' });
      const versions = await buildHistoryStore.list(sessionId);
      return res.json({ versions });
    } catch {
      return res.status(500).json({ error: 'failed to load history' });
    }
  });

  // Phase 2.1 — Fetch a specific version's full file snapshot for restore.
  app.get('/api/build-history/:sessionId/:versionId', async (req: Request, res: Response) => {
    try {
      const { sessionId, versionId } = req.params;
      if (!sessionId || !versionId) return res.status(400).json({ error: 'sessionId and versionId required' });
      const version = await buildHistoryStore.get(sessionId, versionId);
      if (!version) return res.status(404).json({ error: 'version not found' });
      return res.json(version);
    } catch {
      return res.status(500).json({ error: 'failed to load version' });
    }
  });

  // Code Versioning — save a MANUAL named restore-point (checkpoint) to the SAME durable, cross-device
  // build-history store (admin 2026-07-24). This makes the Versioning tool genuinely strong: alongside
  // the automatic per-build checkpoints, a user can snapshot "this is good" before a risky change and
  // Restore to it later from any device. Bounded + best-effort; the sessionId is the unguessable
  // capability, mirroring the GET routes above.
  app.post('/api/build-history/:sessionId/checkpoint', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const body = req.body as { name?: unknown; files?: unknown };
      if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ error: 'sessionId required' });
      if (!body?.files || typeof body.files !== 'object' || Array.isArray(body.files)) {
        return res.status(400).json({ error: 'files map required' });
      }
      const files: Record<string, string> = {};
      let bytes = 0;
      for (const [k, v] of Object.entries(body.files as Record<string, unknown>)) {
        if (typeof k !== 'string' || typeof v !== 'string') continue;
        bytes += k.length + v.length;
        if (bytes > 5 * 1024 * 1024) break; // hard cap; the store caps again to the Firestore 1MB doc limit
        files[k] = v;
      }
      if (Object.keys(files).length === 0) return res.status(400).json({ error: 'no readable files to checkpoint' });
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : 'Manual checkpoint';
      await buildHistoryStore.save(sessionId, {
        commitMessage: name,
        fileCount: Object.keys(files).length,
        files,
        isEdit: true,
        tier: 'manual',
        ok: true,
      });
      return res.json({ ok: true });
    } catch {
      return res.status(500).json({ error: 'failed to save checkpoint' });
    }
  });

  // Code Versioning "Time Machine" — list the signed-in user's apps so they can pick WHICH app's
  // version history to view (admin 2026-07-24). Each Pro v5 app is `agentv3-{uid}-{sessionId}`; we
  // return the raw sessionId (the build-history key) + a friendly label. Anonymous → empty list.
  app.get('/api/versioning/apps', async (req: Request, res: Response) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.json({ apps: [] });
      const prefix = workspacePrefixFor(uid);
      if (!prefix) { res.json({ ok: true, apps: [] }); return; }
      const apps = (await listUserWorkspaceApps(uid)).map((a) => {
        const sessionId = a.workspaceId.startsWith(prefix) ? a.workspaceId.slice(prefix.length) : a.workspaceId;
        const when = a.savedAt > 0 ? new Date(a.savedAt).toISOString().slice(0, 10) : '';
        return {
          sessionId,
          label: `App · ${a.fileCount} file${a.fileCount === 1 ? '' : 's'}${when ? ` · ${when}` : ''}`,
          fileCount: a.fileCount,
          savedAt: a.savedAt,
        };
      });
      return res.json({ apps });
    } catch {
      return res.json({ apps: [] });
    }
  });

  // Phase 4.2 — Per-user monthly AI cost summary for the Billing panel.
  // SECURITY (audit IDOR): scope to the verified token uid — this exposes a user's build count and AI
  // spend; without the check any uid could be read. Client sends the Bearer token via authedHeaders();
  // VITEST skips the check (see requireUserMatch).
  app.get('/api/user/usage/:userId', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const doc = await userCostStore.get(userId, month);
    return res.json(doc ?? { userId, month: month ?? new Date().toISOString().slice(0, 7), totalBuilds: 0, totalCostUsd: 0, updatedAt: 0 });
  });
}
