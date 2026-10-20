import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

const deps = vi.hoisted(() => ({
  verify: vi.fn(async (token: string) => {
    if (token === 'owner-token') return { uid: 'victimUid123', email: 'owner@example.test' };
    if (token === 'other-token') return { uid: 'otherUid456', email: 'other@example.test' };
    throw new Error('expired or invalid token');
  }),
  loadDiagnostics: vi.fn(async () => null),
  writeDiagnostics: vi.fn(async () => {}),
  mutateQueue: vi.fn(async () => ({ items: [] })),
  countFiles: vi.fn(async () => 0),
  loadQueue: vi.fn(async () => ({ items: [] })),
  actuator: vi.fn(() => ({})),
}));
// Mock the SDK boundary, not the request verifier. With VITEST unset below, these routes execute
// the production header parsing, signature-verifier call and verified workspace ownership decision.
vi.mock('../src/server/lib/firebaseAdminModule', () => ({ loadFirebaseAdmin: async () => ({
  apps: [{}], auth: () => ({ verifyIdToken: deps.verify }),
}) }));
vi.mock('../src/server/AgentV3/DiagnosticsStore', async (original) => ({
  ...await original<typeof import('../src/server/AgentV3/DiagnosticsStore')>(),
  loadDiagnostics: deps.loadDiagnostics,
  saveDiagnostics: deps.writeDiagnostics,
  saveDiagnosticsHistory: deps.writeDiagnostics,
  saveLatestForUser: deps.writeDiagnostics,
}));
vi.mock('../src/server/AgentV3/WorkspaceFileStore', async (original) => ({
  ...await original<typeof import('../src/server/AgentV3/WorkspaceFileStore')>(),
  countWorkspaceFiles: deps.countFiles,
}));
vi.mock('../src/server/AgentV3/BuildQueueStore', async (original) => ({
  ...await original<typeof import('../src/server/AgentV3/BuildQueueStore')>(),
  loadQueue: deps.loadQueue,
  mutateQueue: deps.mutateQueue,
}));
vi.mock('../src/server/routes/actuatorFactory', () => ({ buildActuator: deps.actuator }));

let routes: ReturnType<typeof captureRoutes>;
beforeAll(async () => {
  routes = captureRoutes((await import('../src/server/routes/agentv3')).registerAgentV3Routes);
}, 30_000);
beforeEach(() => {
  vi.stubEnv('VITEST', '');
  vi.stubEnv('AGENTV3_ENABLED', 'true');
  vi.stubEnv('AGENTV3_ALLOWLIST', '');
  vi.stubEnv('E2B_API_KEY', '');
  vi.stubEnv('DOCKER_ENABLED', 'false');
  vi.stubEnv('AGENTV3_PREVIEW_SNAPSHOT', 'off');
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

const workspaceId = 'agentv3-victimUid123-11111111-1111-4111-8111-111111111111';
const previewRoutes = ['POST /api/agentv3/preview-error', 'POST /api/agentv3/preview-diagnose', 'POST /api/agentv3/preview-health'];
const queueRoutes = ['POST /api/agentv3/queue/enqueue', 'GET /api/agentv3/queue', 'POST /api/agentv3/queue/cancel', 'POST /api/agentv3/queue/next', 'POST /api/agentv3/queue/complete'];

async function request(route: string, token?: string, ws = workspaceId) {
  const input = { workspaceId: ws, userId: 'victimUid123', email: 'owner@example.test', message: 'runtime error', framework: 'vite-react', prompt: 'change app', id: 'queued-item' };
  const res = mockRes();
  await routes.get(route)!(mockReq({ body: input, query: input, headers: token ? { authorization: `Bearer ${token}` } : {} }), res);
  return res;
}

describe('workspace preview and queue authorization uses the verified token', () => {
  for (const route of [...previewRoutes, ...queueRoutes]) {
    for (const [label, token] of [['missing', undefined], ['expired', 'expired-token'], ['malformed', 'bad-token'], ['another account', 'other-token']] as const) {
      it(`${route} refuses ${label} token even when the claimed uid matches`, async () => {
        const res = await request(route, token);
        expect(res.statusCode).toBe(403);
        expect(deps.loadDiagnostics).not.toHaveBeenCalled();
        expect(deps.writeDiagnostics).not.toHaveBeenCalled();
        expect(deps.mutateQueue).not.toHaveBeenCalled();
        expect(deps.countFiles).not.toHaveBeenCalled();
        expect(deps.loadQueue).not.toHaveBeenCalled();
        expect(deps.actuator).not.toHaveBeenCalled();
        if (token) expect(deps.verify).toHaveBeenCalledWith(token);
      });
    }
  }
  for (const route of previewRoutes) {
    it(`${route} accepts the verified owner after an expired-token refusal`, async () => {
      expect((await request(route, 'expired-token')).statusCode).toBe(403);
      expect((await request(route, 'owner-token')).statusCode).toBe(200);
      expect(deps.verify).toHaveBeenCalledWith('owner-token');
      if (route.endsWith('/preview-error')) expect(deps.loadDiagnostics).toHaveBeenCalledWith(workspaceId);
      if (route.endsWith('/preview-health')) expect(deps.countFiles).toHaveBeenCalledWith(workspaceId);
    });
    it(`${route} preserves the existing anonymous-session capability`, async () => {
      expect((await request(route, undefined, 'agentv3-anon-11111111-1111-4111-8111-111111111111')).statusCode).toBe(200);
    });
  }
});
