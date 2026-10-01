import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadWorkspaceFiles, loadWorkspaceFilesWithStatus } from '../src/server/AgentV3/WorkspaceFileStore';

/**
 * 🔴 Autopsy 4d538ca3: build 1 settled with a restore point and 11 files in the durable project; build 2
 * then logged "durable read 103ms (0 file(s))". `loadWorkspaceFiles` answers `{}` both for an empty store
 * and for a read that threw, so nothing could say which it was. The turn-start read now carries its
 * status, and a failed read is recorded as DURABLE_READ_FAILED instead of passing for "nothing saved".
 */
describe('the durable read says WHY it returned nothing', () => {
  it('no database in this process is its own answer, never "empty"', async () => {
    const r = await loadWorkspaceFilesWithStatus('ws-any');
    expect(r.status).toBe('no-store');
    expect(r.files).toEqual({});
  });

  it('the old call keeps its exact shape for its 20 other callers', async () => {
    expect(await loadWorkspaceFiles('ws-any')).toEqual({});
  });

  it('the turn-start guardian reads with status, names the status, and records a failed read', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('const durable = await loadWorkspaceFilesWithStatus(workspaceId);');
    expect(route).toContain("code: 'DURABLE_READ_FAILED'");
    expect(route.match(/file\(s\), \$\{durable\.status\}\)/g)?.length).toBe(2);
  });

  it('a read that throws is "unreadable", never "empty"', () => {
    const store = readFileSync('src/server/AgentV3/WorkspaceFileStore.ts', 'utf8');
    const body = store.slice(store.indexOf('export async function loadWorkspaceFilesWithStatus'));
    expect(body).toMatch(/catch \(err\) \{\s*return \{ files: \{\}, status: 'unreadable'/);
  });
});
