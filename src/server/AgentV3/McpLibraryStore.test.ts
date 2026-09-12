import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { upsertSaved, mcpLibraryStore, MAX_SAVED_SERVICES } from './McpLibraryStore';
import type { McpServerConfig } from './mcpTransport';

/**
 * THE ACCOUNT LIBRARY — "saved once, chosen per app".
 *
 * Two properties are worth a test rather than a comment, because getting either wrong is invisible
 * until a user is hurt by it:
 *
 *   1. Re-saving a name REPLACES it. Appending would leave two records for `notion` whose precedence
 *      nothing chose — the duplicate class this codebase has already been bitten by elsewhere.
 *   2. Nothing attaches itself. The library is an offer; a service reaches an app only through the
 *      attach route, which re-proves it and passes every check the typed-in path passes.
 */

const cfg = (id: string, url = `https://${id}.example.com/mcp`, key?: string): McpServerConfig => ({
  id, url, ...(key ? { headers: { Authorization: key } } : {}),
});

describe('upsertSaved', () => {
  it('remembers a new service', () => {
    expect(upsertSaved([], cfg('notion'))).toEqual([cfg('notion')]);
  });

  it('🔒 re-saving the same name REPLACES it — a rotated key is the record, not a second row', () => {
    const next = upsertSaved([cfg('notion', undefined, 'Bearer old'), cfg('linear')], cfg('notion', undefined, 'Bearer new'));
    expect(next).not.toBeNull();
    expect(next!.filter((s) => s.id === 'notion')).toHaveLength(1);
    expect(next!.find((s) => s.id === 'notion')?.headers?.Authorization).toBe('Bearer new');
    // The others are untouched and still there.
    expect(next!.map((s) => s.id).sort()).toEqual(['linear', 'notion']);
  });

  it('refuses a NEW name once the account is full', () => {
    const full = Array.from({ length: MAX_SAVED_SERVICES }, (_, i) => cfg(`svc${i}`));
    expect(upsertSaved(full, cfg('one-more'))).toBeNull();
  });

  it('🔒 but still allows REPLACING one while full — a cap must not block a key rotation', () => {
    const full = Array.from({ length: MAX_SAVED_SERVICES }, (_, i) => cfg(`svc${i}`));
    const next = upsertSaved(full, cfg('svc3', undefined, 'Bearer rotated'));
    expect(next).not.toBeNull();
    expect(next).toHaveLength(MAX_SAVED_SERVICES);
    expect(next!.find((s) => s.id === 'svc3')?.headers?.Authorization).toBe('Bearer rotated');
  });
});

describe('the store degrades honestly without storage', () => {
  // Under VITEST getDb() returns null, so this is the "Firestore unavailable" path.
  it('reads as empty rather than throwing', async () => {
    await expect(mcpLibraryStore.listFull('u1')).resolves.toEqual([]);
    await expect(mcpLibraryStore.listForDisplay('u1')).resolves.toEqual([]);
    await expect(mcpLibraryStore.get('u1', 'notion')).resolves.toBeNull();
  });

  it('reports a failed write as false rather than a silent success', async () => {
    await expect(mcpLibraryStore.save('u1', cfg('notion'))).resolves.toBe(false);
    await expect(mcpLibraryStore.remove('u1', 'notion')).resolves.toBe(false);
  });

  it('a missing user id is never a shared bucket', async () => {
    await expect(mcpLibraryStore.listFull('')).resolves.toEqual([]);
    await expect(mcpLibraryStore.save('', cfg('notion'))).resolves.toBe(false);
  });
});

describe('🔒 the wiring — the library must not become a back door', () => {
  const routes = readFileSync(resolve(__dirname, '../routes/agentv3.ts'), 'utf8');
  const ui = readFileSync(resolve(__dirname, '../../components/agentv3/ConnectedServices.tsx'), 'utf8');
  const attach = routes.slice(routes.indexOf("app.post('/api/agentv3/mcp/attach'"));
  const attachBody = attach.slice(0, attach.indexOf("app.post('/api/agentv3/mcp/forget'"));

  it('ATTACH exists and belongs to the workspace owner', () => {
    expect(attachBody).toContain('assertVerifiedWorkspaceOwner');
  });

  it('🔒 ATTACH passes the SAME plan gate as typing the service in', () => {
    expect(attachBody).toContain('canUseConnectedServices');
  });

  it('🔒 ATTACH re-checks the address — a host that resolved publicly then can resolve elsewhere now', () => {
    expect(attachBody).toContain('assertPublicHttpUrl');
  });

  it('🔒 ATTACH re-proves the service before listing it as connected', () => {
    // A saved key can be revoked. Attaching without asking would list a dead service as working.
    expect(attachBody).toContain('listRemoteTools');
    expect(attachBody).toContain('probe.tools.length === 0');
  });

  it('🔒 ATTACH still obeys the per-app cap and the duplicate rule', () => {
    expect(attachBody).toContain('canConnectServer');
  });

  it('🔒 FORGET is NOT plan-gated — a lapsed plan must never trap a key in our storage', () => {
    const at = routes.indexOf("app.post('/api/agentv3/mcp/forget'");
    expect(at).toBeGreaterThan(-1);
    const body = routes.slice(at, at + 900);
    expect(body).not.toContain('canUseConnectedServices');
    expect(body).toContain('mcpLibraryStore.remove');
  });

  it('🔒 the LIST route sends the library WITHOUT credentials', () => {
    const at = routes.indexOf("app.post('/api/agentv3/mcp/list'");
    const body = routes.slice(at, at + 1600);
    expect(body).toContain('mcpLibraryStore.listForDisplay');
    expect(body).not.toContain('mcpLibraryStore.listFull');
  });

  it('🔒 nothing auto-attaches — the screen offers, the user taps', () => {
    // The saved list is rendered as buttons calling attach(); there is no effect that attaches on load.
    expect(ui).toContain('void attach(s.id)');
    expect(ui).not.toMatch(/useEffect\([^)]*attach\(/);
  });

  it('the screen never offers a service this app already has', () => {
    expect(ui).toContain('attachable');
  });
});
