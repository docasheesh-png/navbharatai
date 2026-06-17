import type { Express, Request, Response } from 'express';
import { buildEngineerRouter } from '../EngineerAI/EngineerRouterFactory';
import { EngineerAgentLoop } from '../EngineerAI/EngineerAgentLoop';
import { IEngineerActuator } from '../EngineerAI/actuators/IEngineerActuator';
import { LocalActuator } from '../EngineerAI/actuators/LocalActuator';
import { E2BActuator } from '../EngineerAI/actuators/E2BActuator';

// Real e2b.dev cloud sandbox when configured, otherwise the process-level
// LocalActuator (same isolation guarantees as Phase 1).
function buildActuator(): IEngineerActuator {
  if (process.env.E2B_API_KEY) return new E2BActuator();
  return new LocalActuator();
}

/**
 * Engineer AI route — POST /api/engineer-chat (NDJSON stream).
 * Body: { workspaceId: string, instruction: string, projectType?: string }
 * Events: action_start, command_result, files_changed, build_result,
 *         browse_result, complete, max_steps_reached, aborted, error, ping.
 */
export function registerEngineerRoutes(app: Express): void {
  const router = buildEngineerRouter();
  const agentLoop = new EngineerAgentLoop(router, buildActuator());

  app.post('/api/engineer-chat', async (req: Request, res: Response) => {
    const { workspaceId, instruction, projectType } = req.body || {};
    if (typeof workspaceId !== 'string' || !workspaceId || typeof instruction !== 'string' || !instruction) {
      res.status(400).json({ error: 'workspaceId and instruction are required.' });
      return;
    }

    // NDJSON streaming — avoids iOS Safari SSE buffering quirks.
    // Each event is a single JSON object followed by a newline character.
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // Kill switch — abort the agent loop if the client disconnects
    const abort = new AbortController();
    req.on('close', () => abort.abort());

    const send = (data: object) => {
      if (!res.writableEnded) res.write(JSON.stringify(data) + '\n');
    };

    // Keep-alive: send a no-op ping line every 15 s to prevent proxy/mobile idle timeouts.
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(JSON.stringify({ type: 'ping' }) + '\n');
    }, 15_000);

    try {
      // Immediate probe — verifies the SSE pipe reaches the client before any
      // long-running E2B or AI operation begins.
      send({ type: 'status', message: 'Connecting…' });

      for await (const event of agentLoop.run({ workspaceId, instruction, projectType }, abort.signal)) {
        send(event);
        if (abort.signal.aborted) break;
      }
    } catch (err: any) {
      send({ type: 'error', message: err?.message || 'Engineer AI failed unexpectedly.' });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });
}
