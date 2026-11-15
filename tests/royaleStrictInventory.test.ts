import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('firebase-admin', () => ({ apps: [{}], initializeApp: vi.fn() }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => ({ collection: () => ({ doc: () => ({ get: mock.get }) }) }) }));
import { inspectWorkspaceFilePaths } from '../src/server/AgentV3/WorkspaceFileStore';
beforeEach(() => { vi.stubEnv('VITEST',''); mock.get.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe('strict new-project inventory distinguishes unknown from empty', () => {
  it('returns null for read failure', async () => { mock.get.mockRejectedValue(new Error('timeout')); expect(await inspectWorkspaceFilePaths('test')).toBeNull(); });
  it('does not call absent metadata a new project', async () => { mock.get.mockResolvedValue({exists:false}); expect(await inspectWorkspaceFilePaths('test')).toBeNull(); });
  it('rejects malformed metadata', async () => { mock.get.mockResolvedValue({exists:true,data:()=>({paths:[7]})}); expect(await inspectWorkspaceFilePaths('test')).toBeNull(); });
  it('rejects an empty index with a positive saved count', async () => { mock.get.mockResolvedValue({exists:true,data:()=>({paths:[],count:4})}); expect(await inspectWorkspaceFilePaths('test')).toBeNull(); });
  it('proves empty only from valid existing metadata', async () => { mock.get.mockResolvedValue({exists:true,data:()=>({paths:[],count:0})}); expect(await inspectWorkspaceFilePaths('test')).toEqual([]); });
  it('preserves generated source even with no manual ownership', async () => { mock.get.mockResolvedValue({exists:true,data:()=>({paths:['src/App.tsx','src/App.tsx'],count:1})}); expect(await inspectWorkspaceFilePaths('test')).toEqual(['src/App.tsx']); });
});
