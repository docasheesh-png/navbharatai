/**
 * Q-612 (forensic audit 2026-10-04, admin decision 2026-10-05, option (a) + the bot ledger).
 *
 * THE DEFECT. `POST /api/bots/whatsapp/webhook/:botId` ran the owner's flow and sent the replies with the
 * OWNER's Cloud API token to whatever `from` number an unauthenticated body named. Telegram's sibling
 * route always checked its secret header; WhatsApp had nothing.
 *
 * THE CLASS. "A hosted-bot webhook that runs a flow before it has authenticated the sender." Locked two
 * ways: behaviour (the real route handlers, driven with real HMACs) and a source census that fails the
 * day a new platform's webhook is added without an authentication check ahead of `runBotTurn`.
 *
 * Also locked: the App Secret never leaves the server, and the admin ledger refuses non-admins.
 */

import crypto from 'crypto';
import { readFileSync } from 'fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockReq, mockRes } from './helpers/routeTestUtils';

// ── Fakes ────────────────────────────────────────────────────────────────────────────────────────────
type Rec = Record<string, any>;
const store = vi.hoisted(() => ({ bots: new Map<string, Record<string, any>>(), stamps: [] as Array<{ botId: string; fields: Record<string, unknown> }> }));
const sent = vi.hoisted(() => ({ wa: [] as unknown[], turns: 0 }));
const authUid = vi.hoisted(() => ({ uid: 'owner-1' as string | null }));

vi.mock('../src/server/lib/authMiddleware', () => ({ verifyFirebaseToken: vi.fn(async () => authUid.uid) }));

vi.mock('../src/server/bots/botFlowRunner', () => ({
  runBotTurn: vi.fn(async () => { sent.turns += 1; return { replies: [{ text: 'hello', buttons: [] }], session: { nodeId: 'n', vars: {} }, ended: false }; }),
}));

vi.mock('../src/server/bots/whatsappApi', async (orig) => ({
  ...(await orig<typeof import('../src/server/bots/whatsappApi')>()),
  waSendMessage: vi.fn(async (...args: unknown[]) => { sent.wa.push(args); return { ok: true }; }),
}));

vi.mock('../src/server/lib/serverDb', () => ({
  getServerDb: () => ({
    collection: (name: string) => ({ doc: (id: string) => ({ name, id }) }),
    getAll: async (...refs: Array<{ id: string }>) => refs.map((r) => ({
      id: r.id, exists: r.id === 'owner-1', data: () => ({ userEmail: 'owner@example.com', userName: 'Asha' }),
    })),
  }),
}));

vi.mock('../src/server/bots/BotStore', async (orig) => {
  const real = await orig<typeof import('../src/server/bots/BotStore')>();
  // Mirrors the real store's contract: secrets are held ENCRYPTED on the record; `get` hands back plaintext
  // for the server path only; `listForUser` / `listAllPage` go through the REAL display mappers.
  const enc = (s: string) => `ENC(${Buffer.from(s).toString('base64')})`;
  const dec = (s: string) => Buffer.from(s.slice(4, -1), 'base64').toString('utf8');
  const fake = {
    async create(input: Rec) {
      const { token, appSecret, ...rest } = input;
      const r: Rec = { ...rest, tokenEnc: enc(token) };
      if (appSecret) { r.appSecretEnc = enc(appSecret); r.appSecretSet = true; }
      store.bots.set(r.botId, r);
      return true;
    },
    async get(botId: string) {
      const r = store.bots.get(botId);
      return r ? { ...r, token: dec(r.tokenEnc), appSecret: r.appSecretEnc ? dec(r.appSecretEnc) : '' } : null;
    },
    async listForUser(uid: string) { return [...store.bots.values()].filter((r) => r.ownerUid === uid).map((r) => real.metaOf(r as never)); },
    async setAppSecret(botId: string, uid: string, s: string) {
      const r = store.bots.get(botId);
      if (!r || r.ownerUid !== uid || r.platform !== 'whatsapp') return 'not-found';
      r.appSecretEnc = enc(s); r.appSecretSet = true; r.lastSignatureFailureAt = null;
      return 'ok';
    },
    async stamp(botId: string, fields: Rec) { store.stamps.push({ botId, fields }); },
    async listAllPage() { return { ok: true, rows: [...store.bots.values()].map((r) => real.ledgerRowOf(r as never)), nextAfterBotId: null }; },
    async ledgerCounts() { return { total: store.bots.size, whatsapp: null, telegram: null, whatsappSigned: null }; },
    async remove() { return null; },
    async getSession() { return { nodeId: null, vars: {} }; },
    async saveSession() { /* no-op */ },
  };
  return { ...real, botStore: fake };
});

import { registerBotRoutes } from '../src/server/routes/bots';
import { mintAdminToken } from '../src/server/lib/adminAuth';
import { verifyMetaSignature, whatsappSignatureCutoverMs, whatsappWebhookVerdict, WHATSAPP_SIGNATURE_DEFAULT_CUTOVER } from '../src/server/bots/whatsappSignature';

// ── A route capture that runs the WHOLE chain (middleware included), unlike the shared helper ────────────
type H = (req: any, res: any, next?: () => void) => any;
const routes = new Map<string, H[]>();
const rec = (m: string) => (p: string, ...h: H[]) => { routes.set(`${m} ${p}`, h); };
registerBotRoutes({ get: rec('GET'), post: rec('POST'), use: () => {} } as never);

async function call(key: string, req: any) {
  const res = mockRes();
  const chain = routes.get(key);
  if (!chain) throw new Error(`no route ${key}`);
  // Middleware calls next() without returning it, so every step's promise is collected and awaited.
  let i = 0;
  const pending: Array<Promise<unknown>> = [];
  const next = (): void => { const h = chain[i++]; if (h) pending.push(Promise.resolve(h(req, res, next))); };
  next();
  for (let k = 0; k < pending.length; k++) await pending[k];
  return res;
}

const APP_SECRET = '0123456789abcdef0123456789abcdef';
const FLOW = { nodes: [{ id: 's', type: 'start', data: {} }], edges: [] };
const META_BODY = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '919999999999', type: 'text', text: { body: 'hi' } }] } }] }] });
const sign = (raw: string, secret = APP_SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(Buffer.from(raw)).digest('hex')}`;

function seedWhatsApp(botId: string, opts: { signed: boolean }) {
  const r: Rec = {
    botId, ownerUid: 'owner-1', platform: 'whatsapp', tokenEnc: `ENC(${Buffer.from('OWNER-TOKEN').toString('base64')})`,
    webhookSecret: 'verify-tok', botUsername: '1234567890', flow: FLOW, createdAt: 1, active: true, phoneNumberId: '1234567890',
  };
  if (opts.signed) { r.appSecretEnc = `ENC(${Buffer.from(APP_SECRET).toString('base64')})`; r.appSecretSet = true; }
  store.bots.set(botId, r);
}

function delivery(botId: string, headers: Record<string, string> = {}, raw = META_BODY) {
  const req = mockReq({ params: { botId }, body: JSON.parse(raw), headers });
  req.rawBody = Buffer.from(raw);
  return req;
}

const SIGNED = 'a'.repeat(24);
const LEGACY = 'b'.repeat(24);
const prevEnv = { cut: process.env.WHATSAPP_SIGNATURE_REQUIRED_AFTER, pass: process.env.ADMIN_PASSWORD, user: process.env.ADMIN_USERNAME };

beforeEach(() => {
  store.bots.clear(); store.stamps.length = 0; sent.wa.length = 0; sent.turns = 0; authUid.uid = 'owner-1';
  seedWhatsApp(SIGNED, { signed: true });
  seedWhatsApp(LEGACY, { signed: false });
});
afterEach(() => {
  for (const [k, v] of [['WHATSAPP_SIGNATURE_REQUIRED_AFTER', prevEnv.cut], ['ADMIN_PASSWORD', prevEnv.pass], ['ADMIN_USERNAME', prevEnv.user]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// ── 1. A signed bot answers only Meta ─────────────────────────────────────────────────────────────────
describe('🔒 a WhatsApp bot with an App Secret runs its flow only for a valid Meta signature', () => {
  it('valid X-Hub-Signature-256 over the raw bytes → the flow runs and the reply is sent', async () => {
    const res = await call('POST /api/bots/whatsapp/webhook/:botId', delivery(SIGNED, { 'x-hub-signature-256': sign(META_BODY) }));
    expect(res.statusCode).toBe(200);
    expect(sent.turns).toBe(1);
    expect(sent.wa).toHaveLength(1);
  });

  it.each([
    ['missing header', {}],
    ['signed with a different secret', { 'x-hub-signature-256': sign(META_BODY, 'f'.repeat(32)) }],
    ['malformed header', { 'x-hub-signature-256': 'sha256=nothex' }],
    ['bare hex without the sha256= prefix', { 'x-hub-signature-256': sign(META_BODY).slice(7) }],
  ])('%s → 401, no flow, no reply to the number in the body', async (_n, headers) => {
    const res = await call('POST /api/bots/whatsapp/webhook/:botId', delivery(SIGNED, headers as Record<string, string>));
    expect(res.statusCode).toBe(401);
    expect(sent.turns).toBe(0);
    expect(sent.wa).toHaveLength(0);
  });

  it('a body altered after signing (a different `from` number) is refused', async () => {
    const tampered = META_BODY.replace('919999999999', '911111111111');
    const res = await call('POST /api/bots/whatsapp/webhook/:botId', delivery(SIGNED, { 'x-hub-signature-256': sign(META_BODY) }, tampered));
    expect(res.statusCode).toBe(401);
    expect(sent.wa).toHaveLength(0);
  });

  it('no raw body captured → refused (never a check over re-serialised JSON)', async () => {
    const req = delivery(SIGNED, { 'x-hub-signature-256': sign(META_BODY) });
    delete req.rawBody;
    const res = await call('POST /api/bots/whatsapp/webhook/:botId', req);
    expect(res.statusCode).toBe(401);
    expect(sent.wa).toHaveLength(0);
  });

  it('a secret that fails to decrypt fails CLOSED — it is never treated as a legacy unsigned bot', () => {
    expect(whatsappWebhookVerdict({ hasAppSecret: true, signatureOk: verifyMetaSignature(Buffer.from('x'), sign('x'), ''), now: 0, cutoverMs: Number.MAX_SAFE_INTEGER })).toBe('bad-signature');
  });
});

// ── 2. Legacy bots: a notice period, then a cut-over ──────────────────────────────────────────────────
describe('🔒 a legacy bot without an App Secret is served until the cut-over date, then refused', () => {
  it('before the cut-over → served, and the unsigned traffic is recorded once', async () => {
    process.env.WHATSAPP_SIGNATURE_REQUIRED_AFTER = new Date(Date.now() + 86_400_000).toISOString();
    const res = await call('POST /api/bots/whatsapp/webhook/:botId', delivery(LEGACY));
    expect(res.statusCode).toBe(200);
    expect(sent.wa).toHaveLength(1);
    expect(store.stamps.some((s) => s.botId === LEGACY && typeof s.fields.unsignedSeenAt === 'number')).toBe(true);
    // Once per bot: a bot already stamped is not stamped again.
    store.bots.get(LEGACY)!.unsignedSeenAt = Date.now();
    store.stamps.length = 0;
    await call('POST /api/bots/whatsapp/webhook/:botId', delivery(LEGACY));
    expect(store.stamps.some((s) => 'unsignedSeenAt' in s.fields)).toBe(false);
  });

  it('after the cut-over → refused, no flow, no reply', async () => {
    process.env.WHATSAPP_SIGNATURE_REQUIRED_AFTER = new Date(Date.now() - 1000).toISOString();
    const res = await call('POST /api/bots/whatsapp/webhook/:botId', delivery(LEGACY));
    expect(res.statusCode).toBe(403);
    expect(sent.turns).toBe(0);
    expect(sent.wa).toHaveLength(0);
  });

  it('the cut-over is ONE env-tunable date with a sane default; an unreadable value falls back to it', () => {
    expect(whatsappSignatureCutoverMs({})).toBe(Date.parse(WHATSAPP_SIGNATURE_DEFAULT_CUTOVER));
    expect(whatsappSignatureCutoverMs({ WHATSAPP_SIGNATURE_REQUIRED_AFTER: '2027-01-01' })).toBe(Date.parse('2027-01-01'));
    expect(whatsappSignatureCutoverMs({ WHATSAPP_SIGNATURE_REQUIRED_AFTER: 'soon' })).toBe(Date.parse(WHATSAPP_SIGNATURE_DEFAULT_CUTOVER));
    const days = (Date.parse(WHATSAPP_SIGNATURE_DEFAULT_CUTOVER) - Date.parse('2026-10-05')) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(35);
  });

  it('a legacy bot becomes signed in place (same bot id, same webhook URL) and is then held to the signature', async () => {
    process.env.WHATSAPP_SIGNATURE_REQUIRED_AFTER = new Date(Date.now() + 86_400_000).toISOString();
    const save = await call('POST /api/bots/whatsapp/app-secret', mockReq({ body: { botId: LEGACY, appSecret: APP_SECRET } }));
    expect(save.statusCode).toBe(200);
    expect(JSON.stringify(save.body)).not.toContain(APP_SECRET);
    const unsigned = await call('POST /api/bots/whatsapp/webhook/:botId', delivery(LEGACY));
    expect(unsigned.statusCode).toBe(401);
    const signed = await call('POST /api/bots/whatsapp/webhook/:botId', delivery(LEGACY, { 'x-hub-signature-256': sign(META_BODY) }));
    expect(signed.statusCode).toBe(200);
  });

  it('only the owner can set a bot\'s App Secret, and only a well-formed one', async () => {
    authUid.uid = 'someone-else';
    expect((await call('POST /api/bots/whatsapp/app-secret', mockReq({ body: { botId: LEGACY, appSecret: APP_SECRET } }))).statusCode).toBe(404);
    authUid.uid = 'owner-1';
    expect((await call('POST /api/bots/whatsapp/app-secret', mockReq({ body: { botId: LEGACY, appSecret: 'EAAG-access-token-pasted-by-mistake' } }))).statusCode).toBe(400);
    authUid.uid = null;
    expect((await call('POST /api/bots/whatsapp/app-secret', mockReq({ body: { botId: LEGACY, appSecret: APP_SECRET } }))).statusCode).toBe(401);
  });
});

// ── 3. The secret never leaves the server ─────────────────────────────────────────────────────────────
describe('🔒 the App Secret never appears in any API response', () => {
  it('connect requires it, stores it, and does not echo it', async () => {
    const missing = await call('POST /api/bots/whatsapp/connect', mockReq({ body: { token: 'T', phoneNumberId: 'P', flow: FLOW } }));
    expect(missing.statusCode).toBe(400);
    const res = await call('POST /api/bots/whatsapp/connect', mockReq({ body: { token: 'T', phoneNumberId: 'P', appSecret: APP_SECRET, flow: FLOW }, headers: { host: 'x.test' } }));
    expect(res.statusCode).toBe(200);
    expect(res.body.signed).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(APP_SECRET);
    const created = store.bots.get(res.body.botId)!;
    expect(created.appSecretEnc).toBeTruthy();
    expect(JSON.stringify(created)).not.toContain(APP_SECRET); // at rest it is ciphertext only
  });

  it('the owner\'s list and the admin ledger carry signed status but no secret, ciphertext or token', async () => {
    const list = await call('GET /api/bots', mockReq());
    const listJson = JSON.stringify(list.body);
    process.env.ADMIN_PASSWORD = 'p'; process.env.ADMIN_USERNAME = 'u';
    const ledger = await call('GET /api/admin/bots', mockReq({ headers: { 'x-admin-token': mintAdminToken('p', 'u', Date.now()) } }));
    const ledgerJson = JSON.stringify(ledger.body);
    for (const json of [listJson, ledgerJson]) {
      expect(json).not.toContain(APP_SECRET);
      expect(json).not.toContain('appSecretEnc');
      expect(json).not.toContain('tokenEnc');
      expect(json).not.toContain('OWNER-TOKEN');
      expect(json).not.toContain('verify-tok');
    }
    expect(list.body.bots.find((b: Rec) => b.botId === LEGACY).signed).toBe(false);
    expect(list.body.bots.find((b: Rec) => b.botId === SIGNED).signed).toBe(true);
    expect(typeof list.body.whatsappSignatureRequiredAfter).toBe('string');
  });
});

// ── 4. The admin ledger ───────────────────────────────────────────────────────────────────────────────
describe('🔒 the bot ledger is admin-only and says who built which bot and whether it is signed', () => {
  it('refuses a request with no admin token, and one with a forged token', async () => {
    process.env.ADMIN_PASSWORD = 'p'; process.env.ADMIN_USERNAME = 'u';
    expect((await call('GET /api/admin/bots', mockReq())).statusCode).toBe(401);
    expect((await call('GET /api/admin/bots', mockReq({ headers: { 'x-admin-token': mintAdminToken('wrong', 'u', Date.now()) } }))).statusCode).toBe(401);
    // A signed-in USER is not an admin.
    expect((await call('GET /api/admin/bots', mockReq({ headers: { authorization: 'Bearer user-token' } }))).statusCode).toBe(401);
  });

  it('returns each bot with its owner identity, platform and signed status', async () => {
    process.env.ADMIN_PASSWORD = 'p'; process.env.ADMIN_USERNAME = 'u';
    const res = await call('GET /api/admin/bots', mockReq({ headers: { 'x-admin-token': mintAdminToken('p', 'u', Date.now()) } }));
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    const byId = new Map<string, Rec>(res.body.rows.map((r: Rec) => [r.botId, r]));
    expect(byId.get(SIGNED)).toMatchObject({ ownerUid: 'owner-1', platform: 'whatsapp', signed: true });
    expect(byId.get(LEGACY)).toMatchObject({ ownerUid: 'owner-1', platform: 'whatsapp', signed: false });
    expect(byId.get(SIGNED)!.owner).toMatchObject({ email: 'owner@example.com', name: 'Asha' });
    expect(res.body.counts.total).toBe(2);
  });

  it('a malformed cursor is refused rather than read', async () => {
    process.env.ADMIN_PASSWORD = 'p'; process.env.ADMIN_USERNAME = 'u';
    const res = await call('GET /api/admin/bots', mockReq({ query: { cursor: '../users/x' }, headers: { 'x-admin-token': mintAdminToken('p', 'u', Date.now()) } }));
    expect(res.statusCode).toBe(400);
  });
});

// ── 5. The class: no hosted-bot webhook runs a flow before authenticating ─────────────────────────────
describe('🔒 census — every hosted-bot webhook authenticates before runBotTurn', () => {
  const src = readFileSync('src/server/routes/bots.ts', 'utf8');
  const blocks = src.split(/\n {2}app\./).filter((b) => /^post\('\/api\/bots\/[a-z]+\/webhook\//.test(b));

  it('finds every platform webhook (a census that finds nothing proves nothing)', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  it.each(blocks.map((b) => [b.slice(0, b.indexOf(',')), b]))('%s checks a secret or a signature, in constant time, before the flow', (_name, block) => {
    const run = block.indexOf('runBotTurn(');
    const auth = Math.max(block.indexOf('verifyMetaSignature('), block.indexOf('safeStrEqual('));
    expect(run).toBeGreaterThan(0);
    expect(auth, 'no authentication check in this webhook').toBeGreaterThan(0);
    expect(auth).toBeLessThan(run);
    expect(block).not.toMatch(/!==\s*bot\.webhookSecret|===\s*bot\.webhookSecret/);
  });
});

// ── 6. What the owner and the admin are told ──────────────────────────────────────────────────────────
vi.mock('../src/lib/firebase', () => ({ auth: { currentUser: null } }));

describe('🔒 the owner notice and the ledger column say the true state', () => {
  it('the owner is told about an unsigned WhatsApp bot and a signed one whose check failed — nothing else', async () => {
    const { appSecretNeed, looksLikeAppSecret } = await import('../src/components/ide/WhatsAppAppSecretNotice');
    expect(appSecretNeed({ platform: 'whatsapp', signed: false, lastSignatureFailureAt: null })).toBe('missing');
    expect(appSecretNeed({ platform: 'whatsapp', signed: true, lastSignatureFailureAt: 123 })).toBe('mismatch');
    expect(appSecretNeed({ platform: 'whatsapp', signed: true, lastSignatureFailureAt: null })).toBeNull();
    expect(appSecretNeed({ platform: 'telegram', signed: null, lastSignatureFailureAt: null })).toBeNull();
    expect(looksLikeAppSecret(APP_SECRET)).toBe(true);
    expect(looksLikeAppSecret('EAAGm0PX4ZCpsBA')).toBe(false);
  });

  it('the ledger names an unsigned bot as legacy before the cut-over and refused after it', async () => {
    const { webhookAuthView, countText } = await import('../src/components/admin/BotsLedgerPanel');
    expect(webhookAuthView({ platform: 'whatsapp', signed: true }, 1000, 2000).tone).toBe('ok');
    expect(webhookAuthView({ platform: 'whatsapp', signed: false }, 3000, 2000)).toMatchObject({ label: 'Unsigned (legacy)', tone: 'warn' });
    expect(webhookAuthView({ platform: 'whatsapp', signed: false }, 1000, 2000)).toMatchObject({ label: 'Unsigned — refused', tone: 'bad' });
    expect(webhookAuthView({ platform: 'telegram', signed: null }, 1000, 2000).tone).toBe('ok');
    expect(countText(null)).toBe('—'); // an unread count is never shown as zero
    expect(countText(0)).toBe('0');
  });

  it('the server and the client agree on what an App Secret looks like', async () => {
    const { looksLikeAppSecret } = await import('../src/components/ide/WhatsAppAppSecretNotice');
    const { isMetaAppSecret } = await import('../src/server/bots/whatsappSignature');
    for (const s of [APP_SECRET, APP_SECRET.toUpperCase(), 'short', '', 'g'.repeat(32), `${APP_SECRET}0`]) {
      expect(looksLikeAppSecret(s), s).toBe(isMetaAppSecret(s));
    }
  });
});
