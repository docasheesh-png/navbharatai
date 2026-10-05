// Hosted chat-bot connectors (admin 2026-07-23: "user sach me bot bana kar WhatsApp/Telegram par add
// kar sake"). REAL, turnkey Telegram integration: the user pastes their @BotFather token, we validate it,
// store it (encrypted), point Telegram's webhook at us, and from then on every message their bot receives
// runs their designed flow (botFlowRunner) and replies for real. WhatsApp Cloud API connector below.
//
// Security: the token is a secret (encrypted at rest, never returned to a client). Every webhook is
// authenticated before any flow runs:
//   • Telegram — the per-bot secret Telegram echoes in the X-Telegram-Bot-Api-Secret-Token header.
//   • WhatsApp — Meta's X-Hub-Signature-256 HMAC over the raw body, keyed by the owner's Meta App Secret
//     (Q-612, admin decision 2026-10-05). Bots connected before that have no App Secret on file; they are
//     served until WHATSAPP_SIGNATURE_REQUIRED_AFTER and refused after it (see bots/whatsappSignature.ts).
//
// Admin ledger (admin 2026-10-05: "kis kis user ne bot banaye hai, uska bhi hisab admin panel me rakho"):
// GET /api/admin/bots lists every user's bots with the owner, the platform and whether a WhatsApp bot is
// signed. Admin-gated by the shared `requireAdmin` (lib/adminAuth.ts); never a token or a secret.

import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { requireAdmin, safeStrEqual } from '../lib/adminAuth';
import { getServerDb } from '../lib/serverDb';
import { resolveUserIdentities, identityLabel } from '../lib/adminUserLookup';
import { botStore, isBotId, type BotStamp } from '../bots/BotStore';
import { runBotTurn, type BotFlow } from '../bots/botFlowRunner';
import { tgGetMe, tgSetWebhook, tgDeleteWebhook, tgSendMessage, parseTelegramUpdate } from '../bots/telegramApi';
import { waSendMessage, parseWhatsAppMessage, verifyWhatsAppSubscription } from '../bots/whatsappApi';
import {
  isMetaAppSecret, verifyMetaSignature, whatsappWebhookVerdict, whatsappSignatureCutoverMs, whatsappSignatureCutoverIso,
} from '../bots/whatsappSignature';
import { routeParam } from '../lib/expressCompat';
import { guardedPublicFetch } from '../lib/ssrfGuard';

/** Our public HTTPS base (for the webhook URL Telegram will call). Prefer an explicit env; else derive
 *  from the forwarded request headers (Cloud Run sets x-forwarded-proto). */
function publicBaseUrl(req: Request): string {
  const env = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const host = req.get('host') || 'navbharatai.com';
  return `${proto}://${host}`;
}

function validFlow(f: unknown): f is BotFlow {
  const flow = f as BotFlow | null;
  return !!flow && Array.isArray(flow.nodes) && Array.isArray(flow.edges) && flow.nodes.some(n => n.type === 'start');
}

/** The App Secret field's help text — the same words on the connect error and the add-secret error. */
const APP_SECRET_HELP = 'Paste the App Secret from your Meta app (App settings → Basic → App secret → Show). It is 32 letters and digits.';

/**
 * Webhook stamps are throttled per instance: a bot answering a busy chat must not turn every message into
 * an extra Firestore write. `lastWebhookAt` and `lastSignatureFailureAt` are "roughly when", and ten minutes
 * of resolution is enough for both the owner's notice and the admin ledger. The map is bounded.
 */
const STAMP_EVERY_MS = 10 * 60 * 1000;
const lastStamp = new Map<string, number>();
function stampThrottled(botId: string, kind: keyof BotStamp, now: number): void {
  const key = `${kind}:${botId}`;
  const prev = lastStamp.get(key) ?? 0;
  if (now - prev < STAMP_EVERY_MS) return;
  if (lastStamp.size > 20_000) lastStamp.clear();
  lastStamp.set(key, now);
  void botStore.stamp(botId, { [kind]: now });
}

/** The raw request bytes — kept for the webhook route only (RAW_BODY_ROUTES in src/server/lib/requestBodyLimits.ts). */
function rawBodyOf(req: Request): Buffer | undefined {
  const raw = (req as Request & { rawBody?: unknown }).rawBody;
  return Buffer.isBuffer(raw) ? raw : undefined;
}

export function registerBotRoutes(app: Express): void {
  // ——— Telegram: connect (validate token → store → setWebhook → live) ———
  app.post('/api/bots/telegram/connect', async (req: Request, res: Response) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: 'Please sign in to connect a bot.' });
      const token = String(req.body?.token || '').trim();
      const flow = req.body?.flow;
      if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
        return res.status(400).json({ error: 'That does not look like a Telegram bot token. Copy the full token from @BotFather (it looks like 123456789:ABCdef...).' });
      }
      if (!validFlow(flow)) return res.status(400).json({ error: 'The bot flow is empty or missing a Start node — design your flow first.' });

      const me = await tgGetMe(token);
      if (!me.ok) return res.status(400).json({ error: 'Telegram rejected this token — double-check you copied the full token from @BotFather.' });

      const botId = crypto.randomBytes(12).toString('hex');
      const webhookSecret = crypto.randomBytes(24).toString('hex');
      const webhookUrl = `${publicBaseUrl(req)}/api/bots/telegram/webhook/${botId}`;
      const set = await tgSetWebhook(token, webhookUrl, webhookSecret);
      if (!set.ok) return res.status(502).json({ error: `Telegram could not set the webhook (${set.description || 'unknown'}). The app must be reachable on a public HTTPS URL.` });

      const ok = await botStore.create({ botId, ownerUid: uid, platform: 'telegram', token, webhookSecret, botUsername: me.username || '', flow, createdAt: Date.now(), active: true });
      if (!ok) { await tgDeleteWebhook(token); return res.status(500).json({ error: 'Could not save the bot — please try again.' }); }

      return res.json({ ok: true, botId, botUsername: me.username || null, link: me.username ? `https://t.me/${me.username}` : null });
    } catch {
      return res.status(500).json({ error: 'Unexpected error connecting the bot.' });
    }
  });

  // ——— Telegram: incoming updates (Telegram → us). Auth = the per-bot secret header. Always 200 fast. ———
  app.post('/api/bots/telegram/webhook/:botId', async (req: Request, res: Response) => {
    try {
      const bot = await botStore.get(routeParam(req.params.botId));
      if (!bot || bot.platform !== 'telegram' || !bot.active) return res.status(200).end();
      // Constant-time: a `!==` on a secret leaks, through response timing, how much of a guess was right.
      const header = req.headers['x-telegram-bot-api-secret-token'];
      if (typeof header !== 'string' || !bot.webhookSecret || !safeStrEqual(header, bot.webhookSecret)) return res.status(401).end();
      const upd = parseTelegramUpdate(req.body);
      if (!upd) return res.status(200).end();
      stampThrottled(bot.botId, 'lastWebhookAt', Date.now());
      const session = await botStore.getSession(bot.botId, upd.chatId);
      const result = await runBotTurn(bot.flow, session, upd.text, guardedPublicFetch);
      for (const reply of result.replies) await tgSendMessage(bot.token, upd.chatId, reply);
      await botStore.saveSession(bot.botId, upd.chatId, result.session);
      return res.status(200).end();
    } catch {
      return res.status(200).end();
    }
  });

  // ——— WhatsApp Cloud API: webhook VERIFY (GET, Meta's subscription handshake) ———
  app.get('/api/bots/whatsapp/webhook/:botId', async (req: Request, res: Response) => {
    const bot = await botStore.get(routeParam(req.params.botId));
    const challenge = verifyWhatsAppSubscription(req.query, bot?.webhookSecret || '');
    if (challenge !== null) return res.status(200).send(challenge);
    return res.status(403).end();
  });

  // ——— WhatsApp Cloud API: incoming messages (Meta → us). Auth = Meta's signature, BEFORE any flow runs. ———
  app.post('/api/bots/whatsapp/webhook/:botId', async (req: Request, res: Response) => {
    try {
      const bot = await botStore.get(routeParam(req.params.botId));
      if (!bot || bot.platform !== 'whatsapp' || !bot.active || !bot.phoneNumberId) return res.status(200).end();
      const now = Date.now();
      const hasAppSecret = !!bot.appSecretEnc;
      const verdict = whatsappWebhookVerdict({
        hasAppSecret,
        signatureOk: hasAppSecret && verifyMetaSignature(rawBodyOf(req), req.headers['x-hub-signature-256'], bot.appSecret),
        now,
        cutoverMs: whatsappSignatureCutoverMs(),
      });
      if (verdict === 'bad-signature') {
        stampThrottled(bot.botId, 'lastSignatureFailureAt', now);
        return res.status(401).end();
      }
      if (verdict === 'unsigned-refused') return res.status(403).end();
      // Recorded once per bot: the owner's Bot Builder shows the notice from `signed: false` either way;
      // this stamp is what tells the admin ledger the legacy bot is still receiving real traffic.
      if (verdict === 'unsigned-legacy' && !bot.unsignedSeenAt) void botStore.stamp(bot.botId, { unsignedSeenAt: now });

      const msg = parseWhatsAppMessage(req.body);
      if (!msg) return res.status(200).end();
      stampThrottled(bot.botId, 'lastWebhookAt', now);
      const session = await botStore.getSession(bot.botId, msg.from);
      const result = await runBotTurn(bot.flow, session, msg.text, guardedPublicFetch);
      for (const reply of result.replies) await waSendMessage(bot.token, bot.phoneNumberId, msg.from, reply);
      await botStore.saveSession(bot.botId, msg.from, result.session);
      return res.status(200).end();
    } catch {
      return res.status(200).end();
    }
  });

  // ——— WhatsApp: connect (store creds + flow; the user sets the webhook URL in the Meta dashboard) ———
  app.post('/api/bots/whatsapp/connect', async (req: Request, res: Response) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: 'Please sign in to connect a bot.' });
      const token = String(req.body?.token || '').trim();               // permanent Cloud API access token
      const phoneNumberId = String(req.body?.phoneNumberId || '').trim();
      const appSecret = String(req.body?.appSecret || '').trim();       // Meta App Secret — signs every delivery
      const flow = req.body?.flow;
      if (!token || !phoneNumberId) return res.status(400).json({ error: 'Both the WhatsApp permanent access token and the Phone Number ID are required (from the Meta app dashboard).' });
      if (!isMetaAppSecret(appSecret)) return res.status(400).json({ error: `The App Secret is required so only Meta can trigger your bot. ${APP_SECRET_HELP}` });
      if (!validFlow(flow)) return res.status(400).json({ error: 'The bot flow is empty or missing a Start node — design your flow first.' });

      const botId = crypto.randomBytes(12).toString('hex');
      const webhookSecret = crypto.randomBytes(24).toString('hex'); // the Meta "Verify token" the user pastes
      const ok = await botStore.create({ botId, ownerUid: uid, platform: 'whatsapp', token, appSecret, webhookSecret, botUsername: phoneNumberId, flow, createdAt: Date.now(), active: true, phoneNumberId });
      if (!ok) return res.status(500).json({ error: 'Could not save the bot — please try again.' });

      // Unlike Telegram, WhatsApp's webhook is registered by the USER in the Meta dashboard, so we hand
      // back the exact Callback URL + Verify token they must paste there. Never the token or App Secret.
      return res.json({
        ok: true,
        botId,
        callbackUrl: `${publicBaseUrl(req)}/api/bots/whatsapp/webhook/${botId}`,
        verifyToken: webhookSecret,
        signed: true,
      });
    } catch {
      return res.status(500).json({ error: 'Unexpected error connecting the bot.' });
    }
  });

  // ——— WhatsApp: add the App Secret to a bot that was connected without one (legacy bots) ———
  app.post('/api/bots/whatsapp/app-secret', async (req: Request, res: Response) => {
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: 'Please sign in.' });
      const botId = String(req.body?.botId || '').trim();
      const appSecret = String(req.body?.appSecret || '').trim();
      if (!isBotId(botId)) return res.status(400).json({ error: 'Bot not found (or not yours).' });
      if (!isMetaAppSecret(appSecret)) return res.status(400).json({ error: APP_SECRET_HELP });
      const result = await botStore.setAppSecret(botId, uid, appSecret);
      if (result === 'not-found') return res.status(404).json({ error: 'Bot not found (or not yours).' });
      if (result !== 'ok') return res.status(500).json({ error: 'Could not save the App Secret — please try again.' });
      return res.json({ ok: true, botId, signed: true });
    } catch {
      return res.status(500).json({ error: 'Unexpected error saving the App Secret.' });
    }
  });

  // ——— Shared: list + disconnect ———
  app.get('/api/bots', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Please sign in.' });
    // The cut-over date travels with the list so the owner's notice names the real date, not a copy of it.
    return res.json({ bots: await botStore.listForUser(uid), whatsappSignatureRequiredAfter: whatsappSignatureCutoverIso() });
  });

  app.post('/api/bots/disconnect', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Please sign in.' });
    const rec = await botStore.remove(String(req.body?.botId || ''), uid);
    if (!rec) return res.status(404).json({ error: 'Bot not found (or not yours).' });
    if (rec.platform === 'telegram') await tgDeleteWebhook(rec.token);
    return res.json({ ok: true });
  });

  // ——— Admin: the bot ledger — every user's bots, who built them, and whether they are signed ———
  app.get('/api/admin/bots', requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.max(1, Math.min(50, Math.floor(Number(req.query.limit)) || 25));
      const rawCursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
      if (rawCursor && !isBotId(rawCursor)) return res.status(400).json({ ok: false, error: 'That page cursor is not valid — reload the list.' });
      const [page, counts] = await Promise.all([
        botStore.listAllPage({ limit, afterBotId: rawCursor || null }),
        rawCursor ? Promise.resolve(null) : botStore.ledgerCounts(),
      ]);
      // A failed read is NOT an empty ledger: "nobody built a bot" over a failed read is the exact lie a
      // ledger exists to prevent.
      if (!page.ok) return res.status(502).json({ ok: false, error: 'Could not read the bot list.' });
      const identities = await resolveUserIdentities(page.rows.map(r => r.ownerUid), getServerDb() as never).catch(() => new Map());
      const rows = page.rows.map(r => {
        const id = identities.get(r.ownerUid);
        return { ...r, owner: id ? { email: id.email, name: id.name, label: identityLabel(id), anonymous: id.anonymous } : null };
      });
      return res.json({
        ok: true,
        rows,
        counts,
        nextCursor: page.nextAfterBotId,
        whatsappSignatureRequiredAfter: whatsappSignatureCutoverIso(),
      });
    } catch (e) {
      console.error('[ADMIN] bot ledger error:', e instanceof Error ? e.message : 'unknown');
      return res.status(500).json({ ok: false, error: 'Internal server error.' });
    }
  });
}
