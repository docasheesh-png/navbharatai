import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  getConnection: vi.fn(), createProject: vi.fn(), waitUntilReady: vi.fn(),
  fetchProjectCredentials: vi.fn(), applySchemaToProject: vi.fn(), fetchPoolerConnection: vi.fn(),
  loadWorkspaceFiles: vi.fn(), loadUserVaultRows: vi.fn(), getServerDb: vi.fn(), addSecret: vi.fn(),
}));

vi.mock('./supabaseConnectionStore', () => ({
  getConnection: deps.getConnection, needsRefresh: () => false, updateTokens: vi.fn(),
}));
vi.mock('./supabaseProvision', async (original) => ({
  ...await original<typeof import('./supabaseProvision')>(),
  createProject: deps.createProject, waitUntilReady: deps.waitUntilReady,
  fetchProjectCredentials: deps.fetchProjectCredentials, applySchemaToProject: deps.applySchemaToProject,
  fetchPoolerConnection: deps.fetchPoolerConnection,
}));
vi.mock('./secrets', () => ({
  encrypt: (value: string) => `encrypted:${value}`, secretCreatedAtMs: () => null,
  loadUserVaultRows: deps.loadUserVaultRows,
}));
vi.mock('./serverDb', () => ({ getServerDb: deps.getServerDb }));
vi.mock('./audit', () => ({ audit: vi.fn() }));
vi.mock('../AgentV3/WorkspaceFileStore', () => ({ loadWorkspaceFiles: deps.loadWorkspaceFiles }));

import { provisionDatabaseForUser } from './supabaseProvisionFlow';

beforeEach(() => {
  vi.clearAllMocks();
  deps.getConnection.mockResolvedValue({ orgId: 'own-org', accessToken: 'own-token' });
  deps.createProject.mockResolvedValue({ ok: true, project: { id: 'own-project', name: 'My app' } });
  deps.waitUntilReady.mockResolvedValue({ ok: true });
  deps.fetchProjectCredentials.mockResolvedValue({ ok: true, credentials: {
    projectRef: 'own-project', url: 'https://own-project.supabase.co', anonKey: 'own-anon-key',
  } });
  deps.applySchemaToProject.mockResolvedValue({ ok: true });
  deps.fetchPoolerConnection.mockResolvedValue(null);
  deps.loadWorkspaceFiles.mockResolvedValue({ 'migrations/001_init.sql': 'CREATE TABLE own_records(id INT);' });
  deps.loadUserVaultRows.mockResolvedValue([]);
  const vault = { where: vi.fn(), get: vi.fn().mockResolvedValue({ docs: [] }), add: deps.addSecret };
  vault.where.mockReturnValue(vault);
  deps.getServerDb.mockReturnValue({ collection: () => vault });
});

describe('database provisioning authorizes workspace access before any effects', () => {
  it.each([
    ['foreign workspace', 'alice', 'agentv3-bob-session123'],
    ['anonymous workspace', 'alice', 'agentv3-anon-session123'],
    ['unverified identity', '', 'agentv3-bob-session123'],
    ['malformed workspace', 'alice', 'some-app'],
  ])('refuses %s without reading source/vault or provisioning', async (_label, uid, workspaceId) => {
    const result = await provisionDatabaseForUser(uid, { workspaceId, forceNew: true });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(deps.getConnection).not.toHaveBeenCalled();
    expect(deps.loadUserVaultRows).not.toHaveBeenCalled();
    expect(deps.loadWorkspaceFiles).not.toHaveBeenCalled();
    expect(deps.createProject).not.toHaveBeenCalled();
    expect(deps.applySchemaToProject).not.toHaveBeenCalled();
    expect(deps.getServerDb).not.toHaveBeenCalled();
  });

  it('also refuses a foreign workspace on the database-reuse path', async () => {
    expect(await provisionDatabaseForUser('alice', { workspaceId: 'agentv3-bob-session123' }))
      .toMatchObject({ ok: false, status: 403 });
    expect(deps.loadUserVaultRows).not.toHaveBeenCalled();
    expect(deps.getConnection).not.toHaveBeenCalled();
    expect(deps.addSecret).not.toHaveBeenCalled();
  });

  it('lets the verified owner/internal build caller apply only their own saved schema', async () => {
    const workspaceId = 'agentv3-alice-session123';
    expect(await provisionDatabaseForUser('alice', { workspaceId, appLabel: 'My app' }))
      .toMatchObject({ ok: true, schemaApplied: true });
    expect(deps.loadWorkspaceFiles).toHaveBeenCalledExactlyOnceWith(workspaceId);
    expect(deps.applySchemaToProject).toHaveBeenCalledExactlyOnceWith(
      'own-token', 'own-project', 'CREATE TABLE own_records(id INT);',
    );
    expect(deps.addSecret).toHaveBeenCalled();
    for (const [row] of deps.addSecret.mock.calls) {
      expect(row).toMatchObject({ user_id: 'alice', workspace_id: workspaceId });
    }
  });

  it('normalizes an owned workspace once for authorization, source reads and vault scope', async () => {
    expect(await provisionDatabaseForUser('alice', { workspaceId: '  agentv3-alice-session123  ' }))
      .toMatchObject({ ok: true });
    expect(deps.loadWorkspaceFiles).toHaveBeenCalledExactlyOnceWith('agentv3-alice-session123');
    expect(deps.addSecret.mock.calls.every(([row]) => row.workspace_id === 'agentv3-alice-session123')).toBe(true);
  });

  it.each([undefined, '', '   '])('preserves Settings provisioning without an app (%s)', async (workspaceId) => {
    expect(await provisionDatabaseForUser('alice', { workspaceId })).toMatchObject({ ok: true, schemaApplied: null });
    expect(deps.loadWorkspaceFiles).not.toHaveBeenCalled();
    expect(deps.applySchemaToProject).not.toHaveBeenCalled();
    expect(deps.addSecret).toHaveBeenCalled();
    for (const [row] of deps.addSecret.mock.calls) {
      expect(row).toMatchObject({ user_id: 'alice', workspace_id: null });
    }
  });
});
