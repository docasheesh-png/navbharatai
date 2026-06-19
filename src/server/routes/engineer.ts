import type { Express, Request, Response } from 'express';
import { buildEngineerRouter } from '../EngineerAI/EngineerRouterFactory';
import { EngineerAgentLoop } from '../EngineerAI/EngineerAgentLoop';
import { IEngineerActuator } from '../EngineerAI/actuators/IEngineerActuator';
import { LocalActuator } from '../EngineerAI/actuators/LocalActuator';
import { E2BActuator } from '../EngineerAI/actuators/E2BActuator';
import { deploymentService } from '../EngineerAI/DeploymentService';
import { usageTracker } from '../EngineerAI/UsageTracker';
import { DbProviderConfig } from '../EngineerAI/EngineerAITypes';
import { backendScaffolder } from '../EngineerAI/BackendScaffolder';

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
  const actuator = buildActuator();
  const agentLoop = new EngineerAgentLoop(router, actuator);

  app.post('/api/engineer-chat', async (req: Request, res: Response) => {
    const { workspaceId, instruction, projectType, resumeSandboxId, attachedImage, dbConfig } = req.body || {};
    if (typeof workspaceId !== 'string' || !workspaceId || typeof instruction !== 'string' || !instruction) {
      res.status(400).json({ error: 'workspaceId and instruction are required.' });
      return;
    }
    const resumeId = typeof resumeSandboxId === 'string' && resumeSandboxId ? resumeSandboxId : undefined;

    // Phase 14 — validate dbConfig if provided (must have a known provider).
    const VALID_PROVIDERS = ['supabase', 'firebase', 'mongodb', 'neon', 'appwrite', 'other'];
    const validatedDbConfig: DbProviderConfig | undefined =
      dbConfig && typeof dbConfig === 'object' && VALID_PROVIDERS.includes(dbConfig.provider)
        ? { provider: dbConfig.provider, platformName: dbConfig.platformName, credentials: dbConfig.credentials ?? {} }
        : undefined;

    // Phase 12C/12D — optional attached image (base64). Cap at ~8 MB decoded to
    // keep request size sane; ignore malformed payloads rather than failing.
    let image: { base64: string; mimeType: string; filename: string } | undefined;
    if (attachedImage && typeof attachedImage.base64 === 'string' && attachedImage.base64.length > 0
        && attachedImage.base64.length < 11_000_000) {
      image = {
        base64: attachedImage.base64,
        mimeType: typeof attachedImage.mimeType === 'string' ? attachedImage.mimeType : 'image/png',
        filename: typeof attachedImage.filename === 'string' ? attachedImage.filename : 'upload.png',
      };
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

    // Kill switch — abort the agent loop if the client disconnects.
    // CRITICAL: use res.on('close') NOT req.on('close').
    // req.on('close') fires when the request BODY is consumed by express.json() —
    // i.e. almost immediately, aborting the generator before it sends any events.
    // res.on('close') fires only when the response connection is dropped abnormally.
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });

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

      for await (const event of agentLoop.run({ workspaceId, instruction, projectType, resumeSandboxId: resumeId, attachedImage: image, dbConfig: validatedDbConfig }, abort.signal)) {
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

  // Restore the workspace to a checkpoint — called by the frontend "Restore" button.
  app.post('/api/engineer-restore', async (req: Request, res: Response) => {
    const { workspaceId, checkpointId } = req.body || {};
    if (typeof workspaceId !== 'string' || !workspaceId || typeof checkpointId !== 'string' || !checkpointId) {
      res.status(400).json({ error: 'workspaceId and checkpointId are required.' });
      return;
    }
    try {
      await actuator.restore(workspaceId, checkpointId);
      res.json({ restored: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to restore checkpoint.' });
    }
  });

  // Phase 9A — Live preview polling: return a fresh screenshot from the sandbox.
  // The frontend polls this every 3 s while a dev server is running.
  app.get('/api/engineer-preview/:workspaceId', async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    if (!workspaceId) { res.status(400).json({ error: 'workspaceId required.' }); return; }
    const url = (req.query.url as string) || 'http://localhost:3000';
    try {
      const shot = await actuator.screenshot(workspaceId, url);
      res.json({ base64: shot.base64, url });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Screenshot failed.' });
    }
  });

  // Phase 9A — User click relay: store a click from the live preview so the agent
  // sees it in its next buildPrompt() call and can interact with that element.
  app.post('/api/engineer-browser-event', (req: Request, res: Response) => {
    const { workspaceId, x, y } = req.body || {};
    if (typeof workspaceId !== 'string' || typeof x !== 'number' || typeof y !== 'number') {
      res.status(400).json({ error: 'workspaceId, x (number), y (number) are required.' });
      return;
    }
    agentLoop.addUserClick(workspaceId, Math.round(x), Math.round(y));
    res.json({ ok: true });
  });

  // Phase 13 — Real persistent deploy: download dist/ from the E2B sandbox and
  // publish to Firebase Hosting. Returns a permanent HTTPS URL that survives
  // sandbox pause/restart/deletion. Replaces the Phase 9B live-preview-URL shortcut.
  app.post('/api/engineer-deploy', async (req: Request, res: Response) => {
    const { workspaceId } = req.body || {};
    if (typeof workspaceId !== 'string' || !workspaceId) {
      res.status(400).json({ error: 'workspaceId is required.' });
      return;
    }
    try {
      const files = await actuator.downloadDistFiles(workspaceId);
      const url = await deploymentService.deployStatic(workspaceId, files);
      res.json({ url, deployed: true });
    } catch (err: any) {
      const msg = err?.message || 'Deploy failed.';
      // Surface actionable IAM hint when Firebase returns 403.
      const hint = msg.includes('403') || msg.includes('Firebase Hosting Admin')
        ? ' Grant the Cloud Run service account the "Firebase Hosting Admin" IAM role in GCP Console.'
        : '';
      res.status(500).json({ error: msg + hint });
    }
  });

  // Phase 12E — cost control: return per-workspace usage counters (sandbox
  // creations, commands, builds, screenshots) so the client can surface usage.
  app.get('/api/engineer-usage/:workspaceId', (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    if (!workspaceId) { res.status(400).json({ error: 'workspaceId required.' }); return; }
    res.json({ usage: usageTracker.get(workspaceId) });
  });

  // Phase 14 — BYOD: immediately scaffold the DB lib file + .env for the user's
  // chosen provider. Called when the user saves credentials in the Database panel.
  // This is a convenience shortcut; the agent loop also auto-scaffolds on first use.
  app.post('/api/engineer-db-scaffold', async (req: Request, res: Response) => {
    const { workspaceId, dbConfig } = req.body || {};
    if (typeof workspaceId !== 'string' || !workspaceId) {
      res.status(400).json({ error: 'workspaceId is required.' });
      return;
    }
    const VALID_PROVIDERS = ['supabase', 'firebase', 'mongodb', 'neon', 'appwrite', 'other'];
    if (!dbConfig || !VALID_PROVIDERS.includes(dbConfig.provider)) {
      res.status(400).json({ error: 'Valid dbConfig.provider is required.' });
      return;
    }
    try {
      await actuator.ensureWorkspace(workspaceId);
      const result = await backendScaffolder.scaffold(workspaceId, dbConfig, actuator);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Scaffold failed.' });
    }
  });

  // Pause a sandbox to stop compute billing while preserving full state for a
  // later resume. Called by the client when it leaves the Engineer AI surface.
  // Accepts sendBeacon (text/plain body) as well as JSON.
  app.post('/api/engineer-pause', async (req: Request, res: Response) => {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const sandboxId = body?.sandboxId;
    if (typeof sandboxId !== 'string' || !sandboxId) {
      res.status(400).json({ error: 'sandboxId is required.' });
      return;
    }
    try {
      const paused = await actuator.pauseSandbox(sandboxId);
      res.json({ paused });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to pause sandbox.' });
    }
  });
}
