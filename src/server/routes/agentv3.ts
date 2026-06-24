import type { Express, Request, Response } from 'express';
import { buildRateLimiter } from '../lib/authMiddleware';
import {
  isAgentV3Enabled,
  agentV3Status,
  AgentEventStream,
  WorkspaceState,
  ToolDispatcher,
  ClaudeClient,
  sanitizeApiKey,
  AgentRunner,
  catalogForTools,
  roleConfig,
  makeSubAgentSpawn,
  makeSecondOpinion,
  makeConsensus,
  type OpinionRouter,
  resolveModel,
  architectSystemPrompt,
  planSystemPrompt,
  awaitApproval,
  resolveApproval,
  GitManager,
  registerSession,
  restoreSession,
  agentLifecycle,
  getWorkspaceMemory,
  reflectOnBuild,
  reflectionNote,
  summarizeProject,
  formatRecalledLessons,
  detectLanguageHint,
  classifyIntent,
} from '../AgentV3';
import { randomUUID } from 'crypto';
import type { IEngineerActuator } from '../EngineerAI/actuators/IEngineerActuator';
import { LocalActuator } from '../EngineerAI/actuators/LocalActuator';
import { E2BActuator } from '../EngineerAI/actuators/E2BActuator';
import { DockerActuator } from '../EngineerAI/actuators/DockerActuator';
import { userCostStore } from '../lib/UserCostStore';
import { usdInrRate } from '../lib/UsdInrRate';
import { makeResilientTurnRunner } from './agentv3Resilient';
import { AIRouterManager } from '../AI/AIRouterManager';
import { buildDocumentContext } from '../lib/attachmentText';
import { describeVisionAttachments } from '../lib/visionDescribe';
import { planAnalysisSummary } from '../AgentV3/PlanIntelligence';

/**
 * AgentV3 (Vargen 3.0) routes.
 *
 * Flag-gated (AGENTV3_ENABLED, default OFF) + allowlist (admin-only now → all
 * logged-in users at GA, D8). The AgentV3 *module* imports nothing from the live
 * Pro/Engineer agent loops; this route is the composition root that wires the
 * v3.0 engine to the shared sandbox actuator (reused infra, not the live loop).
 *
 * POST /api/agentv3/chat streams the build as NDJSON: one AgentEvent per line
 * (tool_call / tool_result / file_changed / diff / todo_updated / narration /
 * done), then a final {type:'result',...}. Honest throughout — failures and
 * budget/step stops are reported as-is, never a fake success.
 */

/**
 * Hybrid sandbox selection (D4): E2B for real builds, Docker/Local fallbacks.
 *
 * Cached as a process-level singleton so the actuator's per-workspace sandbox map
 * survives across requests — that is what lets consecutive messages in the same
 * session reuse the SAME sandbox (and its files, node_modules and dev server),
 * enabling iterative building ("add a login page" after "build a todo app").
 */
let sharedActuator: IEngineerActuator | null = null;
function buildActuator(): IEngineerActuator {
  if (sharedActuator) return sharedActuator;
  if (process.env.E2B_API_KEY) sharedActuator = new E2BActuator();
  else if (process.env.DOCKER_ENABLED === 'true') sharedActuator = new DockerActuator();
  else sharedActuator = new LocalActuator();
  return sharedActuator;
}

/** A client-supplied session id must be a safe, bounded token (it becomes part of
 *  the workspace id, which is interpolated into sandbox paths/commands). */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * Derive the workspace id for a request. A stable `sessionId` → a stable workspace
 * (reused across messages = iterative building). No/invalid sessionId → a fresh,
 * timestamped one-shot workspace (the previous behaviour).
 */
export function deriveWorkspaceId(userId: string | null, sessionId: unknown): string {
  const uid = userId && /^[A-Za-z0-9_-]{1,64}$/.test(userId) ? userId : 'anon';
  if (typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId)) {
    return `agentv3-${uid}-${sessionId}`;
  }
  return `agentv3-${uid}-${Date.now()}`;
}

function maxBuildBudgetUsd(): number {
  const raw = Number(process.env.AGENTV3_MAX_BUILD_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 25;
}

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

/** One concurrent build per account — guards against runaway cost / abuse. */
const activeBuilds = new Set<string>();
const MAX_PROMPT_LEN = 20_000;

/**
 * Non-secret diagnosis of the Claude provider configuration. Surfaces ONLY what
 * is needed to tell whether the wrong key is set — never the secret itself. The
 * key prefix (e.g. "sk-ant-") is a public scheme marker, not sensitive; if it is
 * anything other than "sk-ant-" the configured ANTHROPIC_API_KEY is not a real
 * Anthropic key (e.g. a leftover proxy key), which is why direct calls 401 and
 * the engine silently falls back to Vertex/Gemini/Grok.
 */
export function agentV3KeyDiag(): {
  anthropicKeySet: boolean;
  anthropicKeyPrefix: string | null;
  anthropicKeyLength: number;
  looksLikeAnthropicKey: boolean;
  keyHadSurroundingWhitespaceOrQuotes: boolean;
  agentv3OverrideBaseUrlSet: boolean;
  sharedProxyBaseUrlSet: boolean;
  sonnetModel: string;
  opusModel: string;
} {
  const raw = process.env.ANTHROPIC_API_KEY ?? '';
  const key = sanitizeApiKey(raw) ?? '';
  return {
    anthropicKeySet: key.length > 0,
    anthropicKeyPrefix: key ? key.slice(0, 7) : null,
    anthropicKeyLength: key.length,
    looksLikeAnthropicKey: key.startsWith('sk-ant-'),
    // If the raw value differed from the sanitized one, the key in Cloud Run had
    // stray whitespace/quotes — a common cause of a 401 on an otherwise valid key.
    keyHadSurroundingWhitespaceOrQuotes: raw.length > 0 && raw !== key,
    agentv3OverrideBaseUrlSet: !!process.env.AGENTV3_ANTHROPIC_BASE_URL,
    sharedProxyBaseUrlSet: !!process.env.ANTHROPIC_BASE_URL,
    sonnetModel: resolveModel(false),
    opusModel: resolveModel(true),
  };
}

/** Throttle the public live-probe so it can't be abused for cost (one per 30s). */
let lastDiagProbeTs = 0;

export function registerAgentV3Routes(app: Express): void {
  // Capability probe — lets the frontend decide whether to show the v3.0 toggle.
  app.get('/api/agentv3/status', (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    res.json({ enabled: isAgentV3Enabled(userId, email), ...agentV3Status(), team: agentLifecycle.snapshot() });
  });

  // Provider diagnosis — confirms whether a real Anthropic key is configured.
  // Returns no secrets (only the public "sk-ant-" scheme prefix + lengths), so a
  // wrong/leftover key is visible without exposing it. Optional ?test=1 makes one
  // tiny real Claude call and reports the exact outcome (success or the precise
  // error), gated by the admin password so it can't be abused for cost.
  app.get('/api/agentv3/diag', async (req: Request, res: Response) => {
    const diag = agentV3KeyDiag();
    const wantsTest = req.query.test === '1';
    const adminOk =
      !!process.env.ADMIN_PASSWORD && req.query.admin === process.env.ADMIN_PASSWORD;
    // The live probe makes ONE tiny real Claude call. Admins can run it anytime;
    // otherwise it's throttled to one every 30s globally so it can't be abused.
    const now = Date.now();
    const throttled = now - lastDiagProbeTs < 30_000;
    if (!wantsTest) {
      res.json(diag);
      return;
    }
    if (!adminOk && throttled) {
      res.json({ ...diag, live: { ok: false, error: 'Live probe is throttled — try again in ~30s.' } });
      return;
    }
    lastDiagProbeTs = now;
    // Live probe: one minimal, real Claude call to surface the exact error.
    let live: { ok: boolean; model?: string; error?: string; status?: number };
    try {
      const client = new ClaudeClient();
      const turn = await client.runTurn({
        model: resolveModel(false),
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 16,
        cache: false,
      });
      live = { ok: true, model: resolveModel(false), error: turn.text ? undefined : 'empty response' };
    } catch (err) {
      const e = err as { status?: number; message?: string };
      live = { ok: false, status: e?.status, error: e?.message ? String(e.message).slice(0, 300) : String(err).slice(0, 300) };
    }
    res.json({ ...diag, live });
  });

  // Approve/reject a pending gate (plan mode / permission prompt, P4).
  app.post('/api/agentv3/respond', (req: Request, res: Response) => {
    const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId : '';
    const approved = req.body?.approved === true;
    if (!requestId) {
      res.status(400).json({ error: 'requestId is required.' });
      return;
    }
    res.json({ ok: resolveApproval(requestId, approved) });
  });

  // History → restore: roll the workspace back to a checkpoint commit (P-git).
  app.post('/api/agentv3/restore', async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const sha = typeof req.body?.sha === 'string' ? req.body.sha : '';
    if (!workspaceId || !sha) {
      res.status(400).json({ error: 'workspaceId and sha are required.' });
      return;
    }
    const ok = await restoreSession(workspaceId, sha, userId ?? undefined);
    res.json({ ok });
  });

  // Build entry — runs the native tool-use loop and streams events as NDJSON.
  app.post('/api/agentv3/chat', buildRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    if (!isAgentV3Enabled(userId, email)) {
      res.status(404).json({ error: 'AgentV3 (v3.0) is not enabled.' });
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(503).json({ error: 'AgentV3 requires ANTHROPIC_API_KEY to be configured.' });
      return;
    }
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
      res.status(400).json({ error: 'A non-empty "prompt" is required.' });
      return;
    }
    if (prompt.length > MAX_PROMPT_LEN) {
      res.status(400).json({ error: `Prompt is too long (max ${MAX_PROMPT_LEN} chars).` });
      return;
    }
    const buildKey = userId ?? 'anon';
    if (activeBuilds.has(buildKey)) {
      res.status(409).json({ error: 'A build is already running for this account. Stop it before starting another.' });
      return;
    }
    activeBuilds.add(buildKey);
    const onlyOpus = req.body?.onlyOpus === true;
    const planFirst = req.body?.planFirst !== false; // plan-mode ON by default (P4)
    const thinking = req.body?.thinking === true; // adaptive thinking, off by default

    // NDJSON stream (mirrors the Engineer route's streaming contract).
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (obj: unknown): void => {
      if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n');
    };

    // Intelligent cost routing (additive): a plain conversational turn — a
    // greeting, thanks, "who are you", small-talk — does NOT need the premium
    // Claude native-tool-use build loop (₹12–20/message). Answer those cheaply
    // via the existing NON-Claude free router (Vertex → Gemini → Grok) and skip
    // the whole build loop. CRITICAL: the reply carries NO provider attribution,
    // so the user can't tell which model answered — it reads as a normal reply.
    //
    // Conservative gate (any doubt → fall through to the real build path):
    //  • classifyIntent must say 'chat' (defaults to 'build' on any ambiguity), and
    //  • plan-mode must not be forcing a plan (a plain conversational turn).
    // A file attachment no longer forces the build path — it is pre-read into text
    // (below) so "read this file" can be answered cheaply via the chat path too.
    //
    // Attachments (images, PDFs, Word/Excel/PowerPoint, ZIP, text/code). Turn them
    // into TEXT the agent can read BEFORE any routing: documents are extracted on
    // the server for free, and images/PDFs are described by the cheap vision
    // providers (Gemini → Grok) by default — Claude is used to read them ONLY in
    // Power / Only-Opus mode (onlyOpus). This keeps file reading cheap and means a
    // file + a plain question can still take the cheap chat path below.
    const rawAttachments: Array<{ name: string; type: string; base64: string }> =
      Array.isArray(req.body?.attachments)
        ? req.body.attachments.filter(
            (a: any) => a && typeof a.base64 === 'string' && a.base64 && typeof a.type === 'string',
          )
        : [];
    let attachmentContext = '';
    if (rawAttachments.length > 0) {
      send({ type: 'narration', agent: 'architect', text: `📎 Reading ${rawAttachments.length} file(s)…`, ts: Date.now() });
      try {
        const docs = await buildDocumentContext(rawAttachments);
        const vis = await describeVisionAttachments(rawAttachments, { useClaude: onlyOpus });
        attachmentContext = [docs, vis].filter(Boolean).join('\n\n');
      } catch { /* best-effort — a bad file never blocks the turn */ }
    }

    const isPlainChatTurn =
      classifyIntent(prompt) === 'chat' && planFirst === false;
    if (isPlainChatTurn) {
      try {
        const chatRouter = AIRouterManager.getRouter('free');
        const chatPrompt = attachmentContext
          ? `${prompt}\n\nThe user attached file(s); here is the extracted content:\n\n${attachmentContext}`
          : prompt;
        const { response } = await chatRouter.route(
          chatPrompt,
          "You are NavBharatAI's friendly assistant. Reply briefly and warmly in " +
            "the user's language. Do not mention which model you are.",
        );
        const reply = response.content;
        // Record the turn in project memory so iterative context is preserved
        // (mirrors the build path's recordRequest). Best-effort.
        try {
          getWorkspaceMemory(deriveWorkspaceId(userId, req.body?.sessionId)).recordRequest(prompt);
        } catch { /* memory is best-effort — never blocks a reply */ }
        // Surface the reply EXACTLY like a normal build narration — no provider
        // name, no note — then close out the stream the same way a build does.
        const chatEvents = new AgentEventStream();
        chatEvents.subscribe((e) => send(e), false);
        chatEvents.emit({ type: 'narration', agent: 'architect', text: reply, ts: Date.now() });
        chatEvents.emit({ type: 'done', ok: true, summary: reply, ts: Date.now() });
        // billedUsd: 0 — the cheap free router is not billed to the user as a build.
        send({ type: 'result', ok: true, summary: reply, steps: 0, billedUsd: 0, billedInr: 0 });
        activeBuilds.delete(buildKey);
        if (!res.writableEnded) res.end();
        return;
      } catch {
        // The free router failed — do NOT error out. Fall through to the normal
        // build path so the user always gets an answer. (No return here.)
      }
    }

    const events = new AgentEventStream();
    events.subscribe((e) => send(e), false);
    const state = new WorkspaceState(events);

    const actuator = buildActuator();
    const workspaceId = deriveWorkspaceId(userId, req.body?.sessionId);
    try {
      // Native Claude for real tool-use, with a multi-provider text fallback
      // (Vertex → Gemini → Grok) so chat never dies if Claude is down/misconfigured.
      const client = makeResilientTurnRunner(new ClaudeClient());
      const model = resolveModel(onlyOpus);
      const budget = maxBuildBudgetUsd();
      const maxSteps = envInt('AGENTV3_MAX_STEPS', 80);
      const subAgentMaxSteps = envInt('AGENTV3_SUBAGENT_MAX_STEPS', 40);

      // Sandbox + git setup is best-effort: a plain chat (e.g. "hello") must still
      // get a reply even when no sandbox is available (no E2B key, or a read-only
      // filesystem). If setup fails we tell the user honestly and keep chatting —
      // the build tools will report the real sandbox error only if the user asks
      // to build. This is what makes v3.0 conversational like Claude Code.
      let git: GitManager | undefined;
      try {
        await actuator.ensureWorkspace(workspaceId, 'react');
        // Real git repo → real checkpoints/History/restore (best-effort on
        // sandboxes without a shell).
        git = new GitManager(actuator, workspaceId);
        await git.ensureRepo();
        registerSession(workspaceId, git, userId ?? undefined);
        events.emit({ type: 'workspace', workspaceId, ts: Date.now() });
      } catch (setupErr) {
        const m = setupErr instanceof Error ? setupErr.message : String(setupErr);
        git = undefined;
        events.emit({
          type: 'narration',
          agent: 'architect',
          text: `Note: the build sandbox isn't available right now (${m}). I can still chat, but I won't be able to build until it's back.`,
          ts: Date.now(),
        });
      }

      // Remember the build request in project memory (episodic — the team can
      // recall what was asked for during the build).
      getWorkspaceMemory(workspaceId).recordRequest(prompt);

      // The Architect can delegate to specialist sub-agents via the task tool.
      const spawnSubAgent = makeSubAgentSpawn({
        client, actuator, workspaceId, state, events, model, onlyOpus,
        maxBudgetUsd: budget, maxSteps: subAgentMaxSteps, checkpointer: git,
      });
      // Layer 84 (Multi-Model Ensemble): the Architect can call second_opinion to
      // get an independent cross-model review from the NON-Claude free router
      // (Vertex → Gemini → Grok). Adapt the real AIRouter to the OpinionRouter
      // port (its route(prompt, system) already returns { response: { content,
      // provider } }). Never throws — the tool itself degrades gracefully.
      const opinionRouter = AIRouterManager.getRouter('free') as unknown as OpinionRouter;
      const secondOpinion = makeSecondOpinion(opinionRouter);
      // Layer 49 (Collective Intelligence): the Architect can call consensus to
      // convene a multi-perspective panel (correctness, security, UX) on a hard
      // decision, using the SAME non-Claude free router. Never throws.
      const consensus = makeConsensus(opinionRouter);
      const dispatcher = new ToolDispatcher(actuator, workspaceId, state, events, spawnSubAgent, git, secondOpinion, consensus);
      const runner = new AgentRunner({
        client,
        dispatcher,
        state,
        events,
        model,
        system: architectSystemPrompt(),
        tools: catalogForTools(roleConfig('architect').tools),
        onlyOpus,
        thinking,
        maxBudgetUsd: budget,
        maxSteps,
        agentRole: 'architect',
      });

      let buildPrompt = prompt;

      // Continual learning (Layer 79): recall the relevant lessons recorded by
      // the Layer 57 reflection of earlier builds in this session (and any past
      // error/fix episodes) and prepend them as guidance, so iterative builds
      // actually apply what was learned. Best-effort — recall can NEVER block a
      // build, and the current request is not echoed back (request episodes are
      // excluded by formatRecalledLessons).
      try {
        const lessonsMem = getWorkspaceMemory(workspaceId);
        const hits = lessonsMem.recall(prompt, 8);
        const lessons = formatRecalledLessons(hits);
        if (lessons) buildPrompt = `${lessons}\n\n---\n\n${buildPrompt}`;
      } catch { /* recall is best-effort — never blocks a build */ }

      // Universal Language (Layer 73): build in the user's language. If the
      // request is written in a distinctive non-Latin script we name the
      // language explicitly; otherwise we instruct Claude to mirror whatever
      // language the request used. Best-effort — NEVER blocks a build.
      try {
        const hint = detectLanguageHint(prompt);
        const langInstruction = hint
          ? `Language: the user is writing in ${hint.name}. Generate ALL user-facing text in the app (labels, buttons, headings, placeholders, messages) in ${hint.name}. Keep code identifiers and comments in English.`
          : `Language: generate all user-facing text in the app in the SAME language the user used in this request (default to English if it is English). Keep code identifiers and comments in English.`;
        buildPrompt = `${langInstruction}\n\n${buildPrompt}`;
      } catch { /* best-effort — never blocks a build */ }

      // Attachments: prepend the extracted file content/description so the build
      // loop can act on the uploaded file(s). Computed earlier (cheap vision /
      // free document extraction); empty when there were no attachments.
      if (attachmentContext) {
        buildPrompt = `The user attached file(s); here is the extracted content:\n\n${attachmentContext}\n\n---\n\n${buildPrompt}`;
      }

      // Plan mode (P4): plan first, then block for the user's approval before
      // building. A real gate — the build does not start until the user answers.
      if (planFirst) {
        const planRunner = new AgentRunner({
          client,
          dispatcher: new ToolDispatcher(actuator, workspaceId, state, events),
          state,
          events,
          model,
          system: planSystemPrompt(),
          tools: catalogForTools(['update_todo']),
          onlyOpus,
          thinking,
          maxBudgetUsd: budget,
          maxSteps: 4,
          agentRole: 'architect',
        });
        await planRunner.run(prompt);

        // Strategic Intelligence (Layer 54): review the proposed plan for gaps
        // (no verification step, no setup, missing deploy, under-scoped, vague)
        // and surface them next to the plan BEFORE the user approves. Best-effort —
        // a review failure must never block the approval gate.
        try {
          const planTodos = state.snapshot().todos;
          if (planTodos.length > 0) {
            events.emit({
              type: 'narration',
              agent: 'architect',
              text: planAnalysisSummary(planTodos, prompt),
              ts: Date.now(),
            });
          }
        } catch { /* plan review is advisory — never blocks the gate */ }

        const requestId = randomUUID();
        events.emit({
          type: 'permission_request',
          agent: 'architect',
          action: 'Approve this plan to start building',
          callId: requestId,
          ts: Date.now(),
        });
        const approved = await awaitApproval(requestId);
        if (!approved) {
          const summary = 'Plan was not approved — build cancelled.';
          events.emit({ type: 'done', ok: false, summary, ts: Date.now() });
          send({ type: 'result', ok: false, summary, steps: 0, billedUsd: 0, billedInr: 0 });
          return;
        }
        const todos = state.snapshot().todos;
        if (todos.length > 0) {
          buildPrompt = `${prompt}\n\nApproved plan:\n${todos.map((t) => `- ${t.title}`).join('\n')}`;
        }
      }

      const result = await runner.run(buildPrompt);

      // Build Reflection (Layer 57, seed): derive a short reflection from what
      // happened this build (errors hit, fixes applied, outcome) and store it
      // back into project memory so the NEXT build in this session can recall
      // those lessons. Best-effort — wrapped so it can NEVER affect the build.
      try {
        const reflectMem = getWorkspaceMemory(workspaceId);
        const reflection = reflectOnBuild({
          ok: result.ok,
          summary: result.summary,
          steps: result.steps,
          episodes: reflectMem.snapshot().episodes,
        });
        reflectMem.recordNote(reflectionNote(reflection));
      } catch { /* reflection is best-effort — never affects the build result */ }

      // Project Summary (Layer 27, "What I built"): on a SUCCESSFUL build, emit a
      // short, friendly recap of what was created (stack, files/components/routes,
      // how to run) as a final narration so it shows as the last chat message.
      // Best-effort — wrapped so it can NEVER affect the build result.
      if (result.ok) {
        try {
          const summaryText = summarizeProject(getWorkspaceMemory(workspaceId).graph(), prompt);
          if (summaryText) events.emit({ type: 'narration', agent: 'architect', text: summaryText, ts: Date.now() });
        } catch { /* summary is best-effort — never affects the build */ }
      }

      // Bill the user the marked-up cost (D5/D6), recorded in the same place the
      // platform records every build's cost. Best-effort — never blocks the run.
      // Internal accounting stays in USD (currency-stable); the customer-facing amount
      // is shown in INR (billedInr = billedUsd × the real-time USD→INR rate).
      if (userId && result.billedUsd > 0) {
        userCostStore.record(userId, result.billedUsd).catch(() => {});
      }

      send({ type: 'result', ...result, billedInr: Math.round(result.billedUsd * usdInrRate() * 100) / 100 });
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      activeBuilds.delete(buildKey);
      if (!res.writableEnded) res.end();
    }
  });
}
