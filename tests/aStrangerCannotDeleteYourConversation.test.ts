/**
 * BLD-2: GET-one, DELETE and pin must trust only a verified identity.
 * A claimed ?userId= is not enough to read, pin, or wipe someone else's app.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';
process.env.AGENTV3_ENABLED = 'true';

const VICTIM = 'victim-uid';
const SID = 'sessVictim01';
const ANON_SID = 'anoncapABC123xyz';

let getOne: (req: any, res: any) => any;
let del: (req: any, res: any) => any;
let pin: (req: any, res: any) => any;
let store: { get: (id: string) => Promise<{ userId?: string; pinned?: boolean } | null>; create: (i: any) => Promise<unknown> };

beforeAll(async () => {
  const routesMod = await import('../src/server/routes/agentv3');
  const routes = captureRoutes(routesMod.registerAgentV3Routes);
  getOne = routes.get('GET /api/agentv3/conversations/:id')!;
  del = routes.get('DELETE /api/agentv3/conversations/:id')!;
  pin = routes.get('POST /api/agentv3/conversations/:id/pin')!;
  store = routesMod.getConversationStore() as typeof store;
  const now = Date.now();
  await store.create({ id: SID, userId: VICTIM, workspaceId: SID, title: 'private', createdAt: now, messages: [{ role: 'user', content: 'secret' }] });
  await store.create({ id: ANON_SID, userId: 'anon', workspaceId: ANON_SID, title: 'anon app', createdAt: now, messages: [{ role: 'user', content: 'hi' }] });
}, 60_000);

function claimed(methodPath: { params: Record<string, string> }, extra: Record<string, unknown> = {}) {
  return mockReq({
    params: methodPath.params,
    query: { userId: VICTIM },
    body: {},
    headers: {},
    ...extra,
  });
}

describe('a stranger cannot delete your conversation (BLD-2)', () => {
  it('(a) DELETE with only a claimed userId does not purge', async () => {
    const res = mockRes();
    await del(claimed({ params: { id: SID } }), res);
    expect([401, 403, 404]).toContain(res.statusCode);
    expect(await store.get(SID)).not.toBeNull();
  });

  it('(b) DELETE with the verified header succeeds and the record is gone', async () => {
    const res = mockRes();
    await del(mockReq({
      params: { id: SID },
      query: { userId: VICTIM },
      headers: { 'x-test-verified-uid': VICTIM },
    }), res);
    expect(res.statusCode).toBe(200);
    expect(await store.get(SID)).toBeNull();
  });

  it('(c) pin without a verified identity is refused; with it, it sticks', async () => {
    const now = Date.now();
    await store.create({ id: 'pinme000001', userId: VICTIM, workspaceId: 'pinme000001', title: 'pin', createdAt: now, messages: [] });
    const denied = mockRes();
    await pin(claimed({ params: { id: 'pinme000001' } }, { body: { pinned: true } }), denied);
    expect([401, 403, 404]).toContain(denied.statusCode);
    expect((await store.get('pinme000001'))?.pinned).not.toBe(true);

    const ok = mockRes();
    await pin(mockReq({
      params: { id: 'pinme000001' },
      query: { userId: VICTIM },
      body: { pinned: true },
      headers: { 'x-test-verified-uid': VICTIM },
    }), ok);
    expect(ok.statusCode).toBe(200);
    expect((await store.get('pinme000001'))?.pinned).toBe(true);
  });

  it('(d) GET-one with only a claimed userId is no-access', async () => {
    const now = Date.now();
    await store.create({ id: 'readmenot01', userId: VICTIM, workspaceId: 'readmenot01', title: 'nope', createdAt: now, messages: [{ role: 'user', content: 'x' }] });
    const res = mockRes();
    await getOne(claimed({ params: { id: 'readmenot01' } }), res);
    expect([401, 403, 404]).toContain(res.statusCode);
    expect(res.body?.conversation).toBeUndefined();
  });

  it('(e) an anon record is still reachable by its id without a token', async () => {
    const res = mockRes();
    await getOne(mockReq({ params: { id: ANON_SID }, query: { userId: 'stranger' }, headers: {} }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.conversation?.userId).toBe('anon');
    expect(res.body?.conversation?.id).toBe(ANON_SID);
  });
});

describe('a flaky token retries GET-one once (BLD-2 client)', () => {
  const root = join(__dirname, '..');
  const hook = readFileSync(join(root, 'src/hooks/useAgentV3Build.ts'), 'utf8');
  const panel = readFileSync(join(root, 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');

  it('the history loader force-refreshes and rebuilds headers with authedHeaders', () => {
    const at = hook.indexOf('oneRes.status === 401 || oneRes.status === 403');
    expect(at).toBeGreaterThan(-1);
    const slice = hook.slice(at, at + 500);
    expect(slice).toContain('getIdToken(true)');
    expect(slice).toContain('authedHeaders()');
  });

  it('the app-name GET retries the same way', () => {
    const at = panel.indexOf('retry with the next header build');
    expect(at).toBeGreaterThan(-1);
    const slice = panel.slice(Math.max(0, at - 200), at + 350);
    expect(slice).toContain('/api/agentv3/conversations/');
    expect(slice).toContain('getIdToken(true)');
    expect(slice).toContain('authedHeaders()');
  });
});
