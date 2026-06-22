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
} from '../AgentV3';
import type { IEngineerActuator } from '../EngineerAI/actuators/IEngineerActuator';
import { LocalActuator } from '../EngineerAI/actuators/LocalActuator';
import { E2BActuator } from '../EngineerAI/actuators/E2BActuator';
import { DockerActuator } from '../EngineerAI/actuators/DockerActuator';

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

/** Hybrid sandbox selection (D4): E2B for real builds, Docker/Local fallbacks. */
function buildActuator(): IEngineerActuator {
  if (process.env.E2B_API_KEY) return new E2BActuator();
  if (process.env.DOCKER_ENABLED === 'true') return new DockerActuator();
  return new LocalActuator();
}

function maxBuildBudgetUsd(): number {
  const raw = Number(process.env.AGENTV3_MAX_BUILD_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 25;
}

export function registerAgentV3Routes(app: Express): void {
  // Capability probe — lets the frontend decide whether to show the v3.0 toggle.
  app.get('/api/agentv3/status', (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    res.json({ enabled: isAgentV3Enabled(userId), ...agentV3Status() });
  });

  // Build entry — runs the native tool-use loop and streams events as NDJSON.
  app.post('/api/agentv3/chat', buildRateLimiter(), async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    if (!isAgentV3Enabled(userId)) {
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
    const onlyOpus = req.body?.onlyOpus === true;

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
    const workspaceId = `agentv3-${userId ?? 'anon'}-${Date.now()}`;
    try {
      await actuator.ensureWorkspace(workspaceId, 'react');
      const client = new ClaudeClient();
      const model = resolveModel(onlyOpus);
      const budget = maxBuildBudgetUsd();

      // The Architect can delegate to specialist sub-agents via the task tool.
      const spawnSubAgent = makeSubAgentSpawn({
        client, actuator, workspaceId, state, events, model, onlyOpus, maxBudgetUsd: budget,
      });
      const dispatcher = new ToolDispatcher(actuator, workspaceId, state, events, spawnSubAgent);
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
        agentRole: 'architect',
      });
      const result = await runner.run(prompt);
      send({ type: 'result', ...result });
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });
}
