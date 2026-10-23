import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { request } from 'node:http';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
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
  // Synthetic path-matching fixture only. Actual professional entitlement scoping is checked below.
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
  it.each(['chat', 'debug', 'appDebug', 'design', 'imageGen', 'screenshotToPrompt', 'appReview', 'repoAnalyst', 'audit'])('actual %s registrations bind policy at the handler', name => {
    const source = readFileSync(`src/server/routes/${name}.ts`, 'utf8');
    expect(source).toMatch(/app\.post\('[^']+', freeModuleInferenceScope,/);
  });
  it('actual paid SDA retains its original gate, independent audit and charge path, not Free middleware', () => {
    const source = readFileSync('src/server/routes/sda.ts', 'utf8');
    const parsed = ts.createSourceFile('sda.ts', source, ts.ScriptTarget.Latest, true);
    const registration = postRegistration(parsed, '/api/sda-chat');
    const handler = registration.arguments[registration.arguments.length - 1];
    const calls = callExpressions(handler).map(call => call.expression.getText(parsed));
    expect(calls).toContain('gateProfessionalTurn');
    expect(calls).toContain('auditSdaReply');
    expect(calls).toContain('chargeForAiTurn');
    expect(source).not.toMatch(/freeModuleInferenceScope|runWithInferenceScope|InferenceGateway|strictFreeRequired/);
    // Behavioral companion: doctorTextIngress.test.ts runs both flags ON and verifies actual
    // paid provider, independent audit and unchanged charging, not just these source boundaries.
  });
  it.each([
    ['chat', 'gateProfessionalTurn'], ['exam', 'gateProfessionalExam'],
  ])('actual professional %s chooses Free versus paid scope only after verified server entitlement', (operation, gateName) => {
    const source = readFileSync('src/server/routes/professionals.ts', 'utf8');
    const parsed = ts.createSourceFile('professionals.ts', source, ts.ScriptTarget.Latest, true);
    const registration = postRegistration(parsed, `/api/professional/:id/${operation}`);
    expect(registration.arguments.slice(1, -1).map(argument => argument.getText(parsed))).not.toContain('freeModuleInferenceScope');
    expect(source).not.toContain('freeModuleInferenceScope');
    const handler = registration.arguments[registration.arguments.length - 1];
    const calls = callExpressions(handler);
    const identity = calls.filter(call => call.expression.getText(parsed) === 'verifyFirebaseIdentity');
    const gate = calls.filter(call => call.expression.getText(parsed) === gateName);
    const scope = calls.filter(call => call.expression.getText(parsed) === 'runWithInferenceScope');
    expect(identity).toHaveLength(1); expect(gate).toHaveLength(1); expect(scope).toHaveLength(1);
    expect(identity[0].getStart(parsed)).toBeLessThan(gate[0].getStart(parsed));
    expect(gate[0].getStart(parsed)).toBeLessThan(scope[0].getStart(parsed));
    expect(gate[0].arguments[0].getText(parsed)).toBe('verifiedUserId');
    expect(ts.isAwaitExpression(gate[0].parent)).toBe(true);
    expect(scope[0].arguments[0].getText(parsed)).toBe("gate.tier === 'free' ? 'free-modules' : 'paid-professional'");
    // Behavioral companion: professionalPaidBoundary.test.ts invokes every registered middleware
    // and the REAL entitlement gate, then asserts Free/paid policy despite forged request tiers.
  });

});

function callExpressions(root: ts.Node): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root); return found;
}
function postRegistration(parsed: ts.SourceFile, path: string): ts.CallExpression {
  const registrations = callExpressions(parsed).filter(call =>
    call.expression.getText(parsed) === 'app.post' && call.arguments[0] &&
    ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === path);
  expect(registrations, `actual route ${path} must exist exactly once`).toHaveLength(1);
  return registrations[0];
}
