import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { registerMobileShipRoutes } from '../src/server/routes/mobileShip';
import { appBuildStore } from '../src/server/lib/AppBuildStore';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../src/server/lib/authMiddleware', () => ({ verifyFirebaseIdentity: vi.fn(async () => ({ uid: 'tracking-user' })) }));
vi.mock('../src/server/lib/AppBuildStore', () => ({ appBuildStore: {
  setOutcome: vi.fn(), record: vi.fn(), setLatestRun: vi.fn(),
} }));
vi.mock('../src/server/lib/mobileBuildOutcomeStore', () => ({
  recordBuildOutcome: vi.fn(), recordBuildFailureCode: vi.fn(), cureFamily: vi.fn(), recordRepairOutcome: vi.fn(),
}));

const routes = captureRoutes(registerMobileShipRoutes);
const headers = { 'x-github-token': 'test-only' };
const run = { id: 124, status: 'in_progress', conclusion: null, path: '.github/workflows/android-apk.yml',
  head_branch: 'feature/apk', event: 'workflow_dispatch', display_title: 'APK request_123', created_at: '2026-11-01T12:00:00Z' };

beforeEach(() => vi.clearAllMocks());

describe('the panel follows its own build', () => {
  it('filters runs to the selected branch and exposes correlation fields', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { workflow_runs: [run] } });
    const res = mockRes();
    await routes.get('GET /api/mobile-ship/runs')!(mockReq({ headers, query: {
      owner: 'owner', repo: 'app', workflow: 'android-apk.yml', branch: 'feature/apk',
    } }), res);
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('&branch=feature%2Fapk'), expect.anything());
    expect(res.body.runs[0]).toMatchObject({ id: 124, branch: 'feature/apk', event: 'workflow_dispatch', displayTitle: 'APK request_123' });
  });

  it('does not label a running build with an older completed result', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { workflow_runs: [run, { ...run, id: 123, status: 'completed', conclusion: 'success' }] } });
    await routes.get('GET /api/mobile-ship/runs')!(mockReq({ headers, query: { owner: 'owner', repo: 'app', workflow: 'android-apk.yml' } }), mockRes());
    expect(appBuildStore.setOutcome).not.toHaveBeenCalled();
  });

  it('reads the exact run even after other runs push it out of the recent list', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { ...run, status: 'completed', conclusion: 'success' } });
    const res = mockRes();
    await routes.get('GET /api/mobile-ship/runs')!(mockReq({ headers, query: {
      owner: 'owner', repo: 'app', workflow: 'android-apk.yml', runId: '124',
    } }), res);
    expect(axios.get).toHaveBeenCalledWith('https://api.github.com/repos/owner/app/actions/runs/124', expect.anything());
    expect(res.body.runs).toHaveLength(1);
    expect(appBuildStore.setOutcome).toHaveBeenCalledWith('tracking-user', 'owner', 'app', 'success');
  });

  it('rejects a pinned run from another workflow', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { ...run, path: '.github/workflows/deploy.yml' } });
    const res = mockRes();
    await routes.get('GET /api/mobile-ship/runs')!(mockReq({ headers, query: {
      owner: 'owner', repo: 'app', workflow: 'android-apk.yml', runId: '124',
    } }), res);
    expect(res.statusCode).toBe(404);
    expect(appBuildStore.setOutcome).not.toHaveBeenCalled();
  });

  it.each([true, false])('correlates new workflows and remains compatible with legacy workflows (supports=%s)', async (supports) => {
    const content = supports ? 'on:\n  workflow_dispatch:\n    inputs:\n      build_request_id:\n        type: string\n' : 'on:\n  workflow_dispatch:\n';
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { encoding: 'base64', content: Buffer.from(content).toString('base64') } });
    vi.mocked(axios.post).mockResolvedValueOnce({ status: 204 });
    const res = mockRes();
    await routes.get('POST /api/mobile-ship/trigger')!(mockReq({ headers, body: {
      owner: 'owner', repo: 'app', workflow: 'android-apk.yml', buildRequestId: 'request_123',
    } }), res);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.dispatchedAt).toBe('string');
    expect(Number.isFinite(Date.parse(res.body.dispatchedAt))).toBe(true);
    expect(res.body.buildRequestId).toBe(supports ? 'request_123' : undefined);
    expect(vi.mocked(axios.post).mock.calls[0][1]).toEqual(supports
      ? { ref: 'main', inputs: { build_request_id: 'request_123' } } : { ref: 'main' });
  });

  it('still dispatches once without a new input when workflow capability lookup is forbidden', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce({ response: { status: 403 } });
    vi.mocked(axios.post).mockResolvedValueOnce({ status: 204 });
    const res = mockRes();
    await routes.get('POST /api/mobile-ship/trigger')!(mockReq({ headers, body: {
      owner: 'owner', repo: 'app', workflow: 'android-apk.yml', buildRequestId: 'request_123',
    } }), res);
    expect(res.body.ok).toBe(true);
    expect(res.body.buildRequestId).toBeUndefined();
    expect(axios.post).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/dispatches'), { ref: 'main' }, expect.anything());
  });

  it('rejects malformed tracking ids before making a GitHub request', async () => {
    const runs = mockRes();
    await routes.get('GET /api/mobile-ship/runs')!(mockReq({ headers, query: {
      owner: 'owner', repo: 'app', workflow: 'android-apk.yml', runId: '../124',
    } }), runs);
    expect(runs.statusCode).toBe(400);
    const trigger = mockRes();
    await routes.get('POST /api/mobile-ship/trigger')!(mockReq({ headers, body: {
      owner: 'owner', repo: 'app', workflow: 'android-apk.yml', buildRequestId: '../request',
    } }), trigger);
    expect(trigger.statusCode).toBe(400);
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });
});
