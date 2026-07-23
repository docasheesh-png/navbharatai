// Hosted chat-bot connectors (admin 2026-07-23: "user sach me bot bana kar WhatsApp/Telegram par add
// kar sake"). REAL, turnkey Telegram integration: the user pastes their @BotFather token, we validate it,
// store it (encrypted), point Telegram's webhook at us, and from then on every message their bot receives
// runs their designed flow (botFlowRunner) and replies for real. WhatsApp Cloud API connector below.
//
// Security: the token is a secret (encrypted at rest, never returned to a client). The webhook is
// authenticated by the per-bot secret Telegram echoes in the X-Telegram-Bot-Api-Secret-Token header.

import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { botStore } from '../bots/BotStore';
import { runBotTurn, type BotFlow } from '../bots/botFlowRunner';
import { tgGetMe, tgSetWebhook, tgDeleteWebhook, tgSendMessage, parseTelegramUpdate } from '../bots/telegramApi';
import { waSendMessage, parseWhatsAppMessage, verifyWhatsAppSubscription } from '../bots/whatsappApi';

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
      const bot = await botStore.get(req.params.botId);
      if (!bot || bot.platform !== 'telegram' || !bot.active) return res.status(200).end();
      if (req.headers['x-telegram-bot-api-secret-token'] !== bot.webhookSecret) return res.status(401).end();
      const upd = parseTelegramUpdate(req.body);
      if (!upd) return res.status(200).end();
      const session = await botStore.getSession(bot.botId, upd.chatId);
      const result = await runBotTurn(bot.flow, session, upd.text, globalThis.fetch as never);
      for (const reply of result.replies) await tgSendMessage(bot.token, upd.chatId, reply);
      await botStore.saveSession(bot.botId, upd.chatId, result.session);
      return res.status(200).end();
    } catch {
      return res.status(200).end();
    }
  });

  // ——— WhatsApp Cloud API: webhook VERIFY (GET, Meta's subscription handshake) ———
  app.get('/api/bots/whatsapp/webhook/:botId', async (req: Request, res: Response) => {
    const bot = await botStore.get(req.params.botId);
    const challenge = verifyWhatsAppSubscription(req.query, bot?.webhookSecret || '');
    if (challenge !== null) return res.status(200).send(challenge);
    return res.status(403).end();
  });

  // ——— WhatsApp Cloud API: incoming messages (Meta → us) ———
  app.post('/api/bots/whatsapp/webhook/:botId', async (req: Request, res: Response) => {
    try {
      const bot = await botStore.get(req.params.botId);
      if (!bot || bot.platform !== 'whatsapp' || !bot.active || !bot.phoneNumberId) return res.status(200).end();
      const msg = parseWhatsAppMessage(req.body);
      if (!msg) return res.status(200).end();
      const session = await botStore.getSession(bot.botId, msg.from);
      const result = await runBotTurn(bot.flow, session, msg.text, globalThis.fetch as never);
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
      const flow = req.body?.flow;
      if (!token || !phoneNumberId) return res.status(400).json({ error: 'Both the WhatsApp permanent access token and the Phone Number ID are required (from the Meta app dashboard).' });
      if (!validFlow(flow)) return res.status(400).json({ error: 'The bot flow is empty or missing a Start node — design your flow first.' });

      const botId = crypto.randomBytes(12).toString('hex');
      const webhookSecret = crypto.randomBytes(24).toString('hex'); // the Meta "Verify token" the user pastes
      const ok = await botStore.create({ botId, ownerUid: uid, platform: 'whatsapp', token, webhookSecret, botUsername: phoneNumberId, flow, createdAt: Date.now(), active: true, phoneNumberId });
      if (!ok) return res.status(500).json({ error: 'Could not save the bot — please try again.' });

      // Unlike Telegram, WhatsApp's webhook is registered by the USER in the Meta dashboard, so we hand
      // back the exact Callback URL + Verify token they must paste there.
      return res.json({
        ok: true,
        botId,
        callbackUrl: `${publicBaseUrl(req)}/api/bots/whatsapp/webhook/${botId}`,
        verifyToken: webhookSecret,
      });
    } catch {
      return res.status(500).json({ error: 'Unexpected error connecting the bot.' });
    }
  });

  // ——— Shared: list + disconnect ———
  app.get('/api/bots', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Please sign in.' });
    return res.json({ bots: await botStore.listForUser(uid) });
  });

  app.post('/api/bots/disconnect', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Please sign in.' });
    const rec = await botStore.remove(String(req.body?.botId || ''), uid);
    if (!rec) return res.status(404).json({ error: 'Bot not found (or not yours).' });
    if (rec.platform === 'telegram') await tgDeleteWebhook(rec.token);
    return res.json({ ok: true });
  });
}
