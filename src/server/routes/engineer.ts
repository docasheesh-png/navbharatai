import type { Express, Request, Response } from 'express';
import { buildEngineerRouter } from '../EngineerAI/EngineerRouterFactory';
import { EngineerAgentLoop } from '../EngineerAI/EngineerAgentLoop';

/**
 * Engineer AI route — Phase 1 (process-level sandbox, no Docker yet).
 * POST /api/engineer-chat (SSE), modeled on /api/pro-build's wire protocol.
 * Body: { workspaceId: string, instruction: string }
 * Events: iteration_start, plan, files_changed, build_result, complete,
 * max_iterations_reached, error.
 */
export function registerEngineerRoutes(app: Express): void {
  const router = buildEngineerRouter();
  const agentLoop = new EngineerAgentLoop(router);

  app.post('/api/engineer-chat', async (req: Request, res: Response) => {
    const { workspaceId, instruction } = req.body || {};
    if (typeof workspaceId !== 'string' || !workspaceId || typeof instruction !== 'string' || !instruction) {
      res.status(400).json({ error: 'workspaceId and instruction are required.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      for await (const event of agentLoop.run({ workspaceId, instruction })) {
        send(event);
      }
    } catch (err: any) {
      send({ type: 'error', message: err?.message || 'Engineer AI failed unexpectedly.' });
    } finally {
      res.end();
    }
  });
}
