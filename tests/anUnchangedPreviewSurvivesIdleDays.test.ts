import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { SandboxStore } from '../src/server/AgentV3/SandboxStore';
import { workspaceContentHash } from '../src/server/AgentV3/snapshotIdentity';
import { choosePreviewSource } from '../src/components/agentv3/previewSource';
import { PREVIEW_BRIDGE_MARKER } from '../src/server/AgentV3/previewBridge';
import { __setRunningBuildForTest, type RunningBuild } from '../src/server/AgentV3/runningBuildRegistry';

const deps = vi.hoisted(() => ({
  files: { 'index.html': '<!doctype html><html><body><canvas id="game"></canvas></body></html>' } as Record<string, string>,
  loadFiles: vi.fn(), loadWithStatus: vi.fn(), savedAt: vi.fn(), countFiles: vi.fn(),
  getPortUrl: vi.fn(), getSandboxId: vi.fn(), runCommand: vi.fn(), listFiles: vi.fn(),
}));
vi.mock('../src/server/AgentV3/WorkspaceFileStore', async (original) => ({
  ...await original<typeof import('../src/server/AgentV3/WorkspaceFileStore')>(),
  loadWorkspaceFiles: deps.loadFiles, loadWorkspaceFilesWithStatus: deps.loadWithStatus,
  workspaceFilesSavedAt: deps.savedAt, countWorkspaceFiles: deps.countFiles,
}));
vi.mock('../src/server/routes/actuatorFactory', () => ({ buildActuator: () => ({
  getPortUrl: deps.getPortUrl, getSandboxId: deps.getSandboxId,
  runCommand: deps.runCommand, listFiles: deps.listFiles,
}) }));

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const WS = 'agentv3-anon-11111111-1111-4111-8111-111111111111';
const COPY = 'https://example--sn-game.web.app';
let routes: ReturnType<typeof captureRoutes>;
beforeAll(async () => {
  routes = captureRoutes((await import('../src/server/routes/agentv3')).registerAgentV3Routes);
}, 30_000);
beforeEach(() => {
  vi.stubEnv('AGENTV3_ENABLED', 'true');
  vi.stubEnv('AGENTV3_ALLOWLIST', '');
  vi.stubEnv('AGENTV3_PREVIEW_SNAPSHOT', 'on');
  // Synthetic marker only. Every sandbox operation is mocked; no provider is contacted.
  vi.stubEnv('E2B_API_KEY', 'test-no-provider-access');
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  deps.loadFiles.mockReset().mockImplementation(async () => ({ ...deps.files }));
  deps.loadWithStatus.mockReset().mockImplementation(async () => ({ files: { ...deps.files }, status: 'ok', savedAt: NOW - 10 * DAY + 1000 }));
  deps.savedAt.mockReset().mockResolvedValue(NOW - 10 * DAY + 1000);
  deps.countFiles.mockReset().mockResolvedValue(1);
  deps.getPortUrl.mockReset().mockResolvedValue('https://3000-paused-machine.e2b.app');
  deps.getSandboxId.mockReset().mockResolvedValue('paused-machine');
  deps.runCommand.mockReset().mockResolvedValue({ stdout: '__STATUS__000', stderr: '', exitCode: 0 });
  deps.listFiles.mockReset().mockResolvedValue([]);
  vi.spyOn(SandboxStore.prototype, 'getRecord').mockImplementation(async () => ({
    workspaceId: WS, userId: 'anon', sandboxId: 'paused-machine', updatedAt: NOW - 10 * DAY,
    snapshotUrl: COPY, snapshotAt: NOW - 10 * DAY, snapshotFilesHash: workspaceContentHash(deps.files),
  }));
});
afterEach(() => {
  __setRunningBuildForTest('returning-preview-test', null);
  vi.restoreAllMocks(); vi.unstubAllEnvs();
});

async function request(path: string) {
  const res = mockRes();
  await routes.get(`POST /api/agentv3/${path}`)!(mockReq({ body: { workspaceId: WS } }), res);
  expect(res.statusCode).toBe(200);
  return res.body;
}

describe('a returning user keeps the real saved game while its machine remains paused', () => {
  it('offers the same real build in the default phone-browser preview ten days later', async () => {
    const body = await request('inbrowser-preview');
    expect(body.snapshotUrl).toBe(COPY);
    expect(choosePreviewSource({ choice: 'auto', buildPhase: 'idle', snapshotUrl: body.snapshotUrl })).toBe('snapshot');
    expect(deps.getPortUrl).not.toHaveBeenCalled();
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it('the health route proves the same content without waking the machine to obtain its URL', async () => {
    const body = await request('preview-health');
    expect(body.idleSnapshotUrl).toBe(COPY);
    expect(deps.loadWithStatus).toHaveBeenCalledWith(WS);
    expect(deps.getPortUrl).not.toHaveBeenCalled();
    expect(deps.runCommand).not.toHaveBeenCalled();
    expect(body.currentPreviewUrl).toBeNull();
    expect(body.snapshotServing).not.toBe(true);
  });

  it('even a recent copy leaves the paused machine untouched during a health check', async () => {
    vi.mocked(SandboxStore.prototype.getRecord).mockResolvedValue({
      workspaceId: WS, userId: 'anon', sandboxId: 'paused-machine', updatedAt: NOW - 1000,
      snapshotUrl: COPY, snapshotAt: NOW - 1000, snapshotFilesHash: workspaceContentHash(deps.files),
    });
    deps.savedAt.mockResolvedValue(NOW - 1000);
    const body = await request('preview-health');
    expect(body.idleSnapshotUrl).toBe(COPY);
    expect(deps.getPortUrl).not.toHaveBeenCalled();
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it.each(['preview-health', 'inbrowser-preview'])('%s compares the app source without secret files', async (path) => {
    const files = { ...deps.files, '.env': 'EXAMPLE_SETTING=synthetic-only' };
    deps.loadFiles.mockResolvedValue(files);
    deps.loadWithStatus.mockResolvedValue({ files, status: 'ok', savedAt: NOW });
    const body = await request(path);
    expect(path === 'preview-health' ? body.idleSnapshotUrl : body.snapshotUrl).toBe(COPY);
    expect(deps.getPortUrl).not.toHaveBeenCalled();
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it.each(['preview-health', 'inbrowser-preview'])('%s ignores the platform preview bridge when comparing source', async (path) => {
    const files = { ...deps.files, 'index.html': deps.files['index.html'].replace('</body>',
      `<script>window.${PREVIEW_BRIDGE_MARKER}=true;</script></body>`) };
    deps.loadFiles.mockResolvedValue(files);
    deps.loadWithStatus.mockResolvedValue({ files, status: 'ok', savedAt: NOW });
    const body = await request(path);
    expect(path === 'preview-health' ? body.idleSnapshotUrl : body.snapshotUrl).toBe(COPY);
    expect(deps.getPortUrl).not.toHaveBeenCalled();
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it('a matching older durable tree must not hide a build with new unsaved writes', async () => {
    __setRunningBuildForTest('returning-preview-test', { workspaceId: WS, ended: false } as RunningBuild);
    const body = await request('preview-health');
    expect(body.idleSnapshotUrl).toBeUndefined();
    expect(deps.runCommand).toHaveBeenCalled();
  });

  it('never offers an old copy as current after the durable project changes', async () => {
    deps.loadWithStatus.mockResolvedValue({ files: { 'index.html': 'edited game' }, status: 'ok', savedAt: NOW });
    const body = await request('preview-health');
    expect(body.idleSnapshotUrl).toBeUndefined();
  });

  it.each(['unreadable', 'no-store', 'empty'])('cannot invent a match when durable files are %s', async (status) => {
    deps.loadWithStatus.mockResolvedValue({ files: {}, status, savedAt: null });
    const body = await request('preview-health');
    expect(body.idleSnapshotUrl).toBeUndefined();
  });
});
