import type { Express, Request, Response } from 'express';
import { buildRateLimiter } from '../lib/authMiddleware';
import {
  isAgentV3Enabled,
  agentV3Status,
  AgentEventStream,
  WorkspaceState,
  ToolDispatcher,
  ClaudeClient,
  AgentRunner,
  catalogForTools,
  roleConfig,
  makeSubAgentSpawn,
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
} from '../AgentV3';
import { randomUUID } from 'crypto';
import type { IEngineerActuator } from '../EngineerAI/actuators/IEngineerActuator';
import { LocalActuator } from '../EngineerAI/actuators/LocalActuator';
import { E2BActuator } from '../EngineerAI/actuators/E2BActuator';
import { DockerActuator } from '../EngineerAI/actuators/DockerActuator';
import { userCostStore } from '../lib/UserCostStore';
import { makeResilientTurnRunner } from './agentv3Resilient';

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

export function registerAgentV3Routes(app: Express): void {
  // Capability probe — lets the frontend decide whether to show the v3.0 toggle.
  app.get('/api/agentv3/status', (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    const email = typeof req.query.email === 'string' ? req.query.email : null;
    res.json({ enabled: isAgentV3Enabled(userId, email), ...agentV3Status(), team: agentLifecycle.snapshot() });
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

    // NDJSON stream (mirrors the Engineer route's streaming contract).
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (obj: unknown): void => {
      if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n');
    };

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
      const dispatcher = new ToolDispatcher(actuator, workspaceId, state, events, spawnSubAgent, git);
      const runner = new AgentRunner({
        client,
        dispatcher,
        state,
        events,
        model,
        system: architectSystemPrompt(),
        tools: catalogForTools(roleConfig('architect').tools),
        onlyOpus,
        maxBudgetUsd: budget,
        maxSteps,
        agentRole: 'architect',
      });

      let buildPrompt = prompt;

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
          maxBudgetUsd: budget,
          maxSteps: 4,
          agentRole: 'architect',
        });
        await planRunner.run(prompt);

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
          send({ type: 'result', ok: false, summary, steps: 0, billedUsd: 0 });
          return;
        }
        const todos = state.snapshot().todos;
        if (todos.length > 0) {
          buildPrompt = `${prompt}\n\nApproved plan:\n${todos.map((t) => `- ${t.title}`).join('\n')}`;
        }
      }

      const result = await runner.run(buildPrompt);

      // Bill the user the marked-up cost (D5/D6), recorded in the same place the
      // platform records every build's cost. Best-effort — never blocks the run.
      if (userId && result.billedUsd > 0) {
        userCostStore.record(userId, result.billedUsd).catch(() => {});
      }

      send({ type: 'result', ...result });
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      activeBuilds.delete(buildKey);
      if (!res.writableEnded) res.end();
    }
  });
}
