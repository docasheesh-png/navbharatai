// A BOT YOU CONNECTED CAN BE DISCONNECTED (Q-816, found while deciding the Q-162 routes; admin 2026-10-12: "han").
// Bot Builder could connect a Telegram or WhatsApp bot and offered no way to undo it: `POST /api/bots/disconnect`
// existed and nothing called it. THE CLASS: a capability the server has and the screen never offers. Now "Your
// bots" lists every connected bot with a Disconnect button. Two honesty holes in the server came with it: a
// failed read of the list answered "no bots", and a failed delete answered "not found (or not yours)".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { mockReq, mockRes } from './helpers/routeTestUtils';

const state = vi.hoisted(() => ({
  list: [] as unknown[] | null,
  removed: null as unknown,
  webhook: { ok: true } as { ok: boolean },
  deleteCalls: [] as string[],
}));

vi.mock('../src/server/lib/authMiddleware', () => ({ verifyFirebaseToken: vi.fn(async () => 'u1') }));
vi.mock('../src/server/bots/telegramApi', async (orig) => ({
  ...(await orig<typeof import('../src/server/bots/telegramApi')>()),
  tgDeleteWebhook: vi.fn(async (token: string) => { state.deleteCalls.push(token); return state.webhook; }),
}));
vi.mock('../src/server/bots/BotStore', async (orig) => {
  const real = await orig<typeof import('../src/server/bots/BotStore')>();
  return {
    ...real,
    botStore: {
      async listForUser() { return state.list; },
      async remove() { return state.removed; },
    },
  };
});

import { registerBotRoutes } from '../src/server/routes/bots';
import { readOwnerBots, botLabel, disconnectedLine, disconnectConfirmText } from '../src/lib/connectedBots';
import { ConnectedBotsView } from '../src/components/ide/ConnectedBotsPanel';

type H = (req: any, res: any) => any;
const routes = new Map<string, H>();
registerBotRoutes({ get: (p: string, ...h: H[]) => routes.set(`GET ${p}`, h[h.length - 1]), post: (p: string, ...h: H[]) => routes.set(`POST ${p}`, h[h.length - 1]), use: () => {} } as never);
const call = async (key: string, body: unknown = {}) => { const res = mockRes(); await routes.get(key)!(mockReq({ body }), res); return res; };

const BOT_ID = 'a'.repeat(24);
const tg = { botId: BOT_ID, platform: 'telegram' as const, botUsername: 'dukaan_bot', createdAt: Date.UTC(2026, 9, 1), active: true, signed: null, lastSignatureFailureAt: null };
const wa = { ...tg, botId: 'b'.repeat(24), platform: 'whatsapp' as const, botUsername: '+91 98xxxx', signed: true };

beforeEach(() => { state.list = []; state.removed = null; state.webhook = { ok: true }; state.deleteCalls = []; });

describe('the server tells the truth about the list and the disconnect', () => {
  it('🔒 a list that could not be read is a 502, never "no bots"', async () => {
    state.list = null;
    const res = await call('GET /api/bots');
    expect(res.statusCode).toBe(502);
    expect(res.body.bots).toBeUndefined();
  });

  it('a list that was read comes back as a list (empty included)', async () => {
    state.list = [];
    expect((await call('GET /api/bots')).body.bots).toEqual([]);
  });

  it('🔒 a delete that failed is a 502, never "not found (or not yours)"', async () => {
    state.removed = 'error';
    const res = await call('POST /api/bots/disconnect', { botId: BOT_ID });
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/Could not disconnect/);
  });

  it('a bot that is not theirs, or not a bot id at all, is a not-found', async () => {
    state.removed = null;
    expect((await call('POST /api/bots/disconnect', { botId: BOT_ID })).statusCode).toBe(404);
    expect((await call('POST /api/bots/disconnect', { botId: 'nope' })).statusCode).toBe(400);
  });

  it('a Telegram disconnect asks Telegram to stop delivering, and says whether it did', async () => {
    state.removed = { ...tg, ownerUid: 'u1', token: 'TOKEN', appSecret: '' };
    let res = await call('POST /api/bots/disconnect', { botId: BOT_ID });
    expect(res.body).toEqual({ ok: true, platform: 'telegram', webhookRemoved: true });
    expect(state.deleteCalls).toEqual(['TOKEN']);
    state.webhook = { ok: false };
    res = await call('POST /api/bots/disconnect', { botId: BOT_ID });
    expect(res.body.webhookRemoved).toBe(false);
  });

  it('a WhatsApp disconnect has nothing to ask Meta for — webhookRemoved is null, not a guess', async () => {
    state.removed = { ...wa, ownerUid: 'u1', token: 'T', appSecret: 'S' };
    const res = await call('POST /api/bots/disconnect', { botId: wa.botId });
    expect(res.body).toEqual({ ok: true, platform: 'whatsapp', webhookRemoved: null });
    expect(state.deleteCalls).toEqual([]);
  });
});

describe('what the screen says', () => {
  it('a body that is not a list is not "no bots"', () => {
    expect(readOwnerBots(false, { bots: [tg] })).toBeNull();
    expect(readOwnerBots(true, { error: 'x' })).toBeNull();
    expect(readOwnerBots(true, { bots: [] })).toEqual([]);
    expect(readOwnerBots(true, { bots: [tg, { botId: 1 }, null] })).toEqual([tg]);
  });

  it('names a bot the way its platform does', () => {
    expect(botLabel(tg)).toBe('@dukaan_bot');
    expect(botLabel(wa)).toBe('+91 98xxxx');
    expect(botLabel({ ...tg, botUsername: '' })).toBe('Telegram bot');
  });

  it('says what a disconnect really did', () => {
    expect(disconnectedLine(tg, { webhookRemoved: true })).toBe('Disconnected — @dukaan_bot no longer runs your flow.');
    expect(disconnectedLine(tg, { webhookRemoved: false })).toMatch(/Telegram did not confirm/);
    expect(disconnectedLine(wa, { webhookRemoved: null })).toMatch(/remove the Callback URL in your Meta app/);
    expect(disconnectConfirmText(tg)).toMatch(/^Disconnect @dukaan_bot\?/);
  });

  const view = (p: Partial<Parameters<typeof ConnectedBotsView>[0]>) => renderToStaticMarkup(createElement(ConnectedBotsView, {
    bots: [], failed: false, open: true, busyId: '', notes: {}, onToggle: () => {}, onDisconnect: () => {}, ...p,
  }));

  it('lists the bots with a Disconnect button when opened', () => {
    const html = view({ bots: [tg, wa] });
    expect(html).toContain('Your bots');
    expect(html).toContain('2 connected');
    expect(html).toContain('@dukaan_bot');
    expect(html.match(/Disconnect/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('🔒 a failed read says so; no bots and nothing said shows nothing', () => {
    expect(view({ bots: null, failed: true })).toMatch(/Could not read your connected bots/);
    expect(view({ bots: [] })).toBe('');
  });

  it('after the last bot is disconnected, the result line stays on screen', () => {
    const html = view({ bots: [], notes: { [BOT_ID]: 'Disconnected — @dukaan_bot no longer runs your flow.' } });
    expect(html).toContain('No bots are connected now.');
    expect(html).toContain('Disconnected — @dukaan_bot no longer runs your flow.');
  });
});

describe('🔒 the wiring', () => {
  it('Bot Builder shows the panel, and the panel calls the real routes', () => {
    expect(readFileSync('src/components/ide/BotBuilder.tsx', 'utf8')).toContain('<ConnectedBotsPanel refreshKey={botsRefresh} />');
    const panel = readFileSync('src/components/ide/ConnectedBotsPanel.tsx', 'utf8');
    expect(panel).toContain("fetch('/api/bots', { headers })");
    expect(panel).toContain("fetch('/api/bots/disconnect', { method: 'POST'");
  });

  it('the route is no longer in the uncalled-route backlog', () => {
    expect(readFileSync('tests/fixtures/uncalledApiRoutesBaseline.json', 'utf8')).not.toContain('POST /api/bots/disconnect');
  });
});
