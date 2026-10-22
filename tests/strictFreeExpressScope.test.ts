import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { request } from 'node:http';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
const calls = vi.hoisted(() => ({ free: vi.fn(), paid: vi.fn() }));
vi.mock('../src/server/AI/LiveRegistry/runtime', () => ({ strictFreeText: calls.free }));
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: vi.fn() }));
vi.mock('../src/server/lib/ProviderCooldownStore', () => ({ providerCooldownStore: { startSync: vi.fn(), write: vi.fn() } }));
import { AIRouter } from '../src/server/AI/Router/AIRouter';
import { freeModuleInferenceScope } from '../src/server/AI/inferencePolicy';
import { apiVersionMiddleware } from '../src/server/routes/apiVersion';
const old = process.env.STRICT_FREE_MODULES_ENABLED;
let server: Server;
function post(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const address = server.address() as { port: number };
    const req = request({ hostname: '127.0.0.1', port: address.port, path, method: 'POST' }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    }); req.on('error', reject); req.end();
  });
}
beforeEach(async () => {
  vi.clearAllMocks(); process.env.STRICT_FREE_MODULES_ENABLED = 'true';
  calls.free.mockResolvedValue({ content: 'free', provider: 'OPENROUTER', model: 'test:free', latencyMs: 0 });
  calls.paid.mockResolvedValue({ content: 'paid', provider: 'GROK', model: 'paid', latencyMs: 0 });
  const ai = new AIRouter();
  ai.registerProvider({ name: 'GROK', priority: 1, execute: calls.paid, healthCheck: async () => true } as any);
  const app = express(); app.use(apiVersionMiddleware);
  const handler: express.RequestHandler = async (_req, res) => { try { res.json((await ai.route('test')).response.content); } catch { res.status(503).end(); } };
  app.post('/api/chat/navbharat', freeModuleInferenceScope, handler);
  app.post('/api/professional/:id/chat', freeModuleInferenceScope, handler);
  app.post('/api/agentv3/research', handler);
  const mounted = express.Router(); mounted.post('/chat', freeModuleInferenceScope, handler); app.use('/mounted', mounted);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
});
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); if (old === undefined) delete process.env.STRICT_FREE_MODULES_ENABLED; else process.env.STRICT_FREE_MODULES_ENABLED = old; });
describe('real Express matching cannot bypass the mounted scope', () => {
  it.each(['/api/chat/navbharat', '/api/chat/navbharat/', '/API/CHAT/NAVBHARAT', '/api/v1/chat/navbharat/', '/api/professional/%64octor/chat/', '/API/PROFESSIONAL/doctor/CHAT', '/mounted/CHAT/'])('routes %s through free dispatcher only', async path => {
    expect(await post(path)).toMatchObject({ status: 200, body: '"free"' }); expect(calls.free).toHaveBeenCalledOnce(); expect(calls.paid).not.toHaveBeenCalled();
  });
  it.each(['/api//chat/navbharat', '/%61pi/chat/navbharat', '/api/chat/navbharat//', '/api/chat/navbharat%2f'])('rejects unmatched variant %s without any inference', async path => {
    expect((await post(path)).status).toBe(404); expect(calls.free).not.toHaveBeenCalled(); expect(calls.paid).not.toHaveBeenCalled();
  });
  it('preserves unrelated ancillary Builder routes', async () => {
    expect(await post('/api/agentv3/research')).toMatchObject({ status: 200, body: '"paid"' }); expect(calls.free).not.toHaveBeenCalled();
  });
  it.each(['chat', 'sda', 'professionals', 'debug', 'appDebug', 'design', 'imageGen', 'screenshotToPrompt', 'appReview', 'repoAnalyst', 'audit'])('actual %s registrations bind policy at the handler', name => {
    const source = readFileSync(`src/server/routes/${name}.ts`, 'utf8');
    expect(source).toMatch(/app\.post\('[^']+', freeModuleInferenceScope,/);
  });
});
