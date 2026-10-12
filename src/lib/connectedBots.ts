// YOUR BOTS, AND HOW TO DISCONNECT ONE (Q-816, found while deciding the Q-162 routes, 2026-10-11).
//
// A user could connect a Telegram or WhatsApp bot from Bot Builder and had no way to undo it: the server's
// `POST /api/bots/disconnect` existed and nothing in the app called it. A connection you cannot undo is half a
// feature. THE CLASS: a capability the server has and the screen never offers. This module is the pure half of
// the screen that offers it — reading the list honestly and saying what a disconnect really did. PURE.

import type { OwnerBot } from '../components/ide/WhatsAppAppSecretNotice';

/**
 * The owner's bots from `GET /api/bots`, or null when the body is not a list. A failed read is never shown as
 * "no bots": that sentence over a failed read is how a connected bot becomes invisible.
 */
export function readOwnerBots(ok: boolean, body: unknown): OwnerBot[] | null {
  if (!ok || !body || typeof body !== 'object') return null;
  const list = (body as { bots?: unknown }).bots;
  if (!Array.isArray(list)) return null;
  return list.filter((b): b is OwnerBot => !!b && typeof b === 'object'
    && typeof (b as OwnerBot).botId === 'string' && ((b as OwnerBot).platform === 'telegram' || (b as OwnerBot).platform === 'whatsapp'));
}

/** How a bot is named on the screen: its @handle on Telegram, its number's label on WhatsApp. PURE. */
export function botLabel(bot: Pick<OwnerBot, 'platform' | 'botUsername' | 'botId'>): string {
  const name = String(bot.botUsername || '').trim();
  if (bot.platform === 'telegram') return name ? `@${name.replace(/^@/, '')}` : 'Telegram bot';
  return name || 'WhatsApp number';
}

/**
 * What a disconnect really did, in one sentence — from the server's answer, never assumed.
 *
 *  • Telegram: NavBharatAI also asks Telegram to stop delivering. When Telegram does not confirm that, the user
 *    is told, because messages would keep arriving and go unanswered.
 *  • WhatsApp: NavBharatAI cannot change the user's Meta app, so the Callback URL stays there until they remove
 *    it — said plainly, with where.
 */
export function disconnectedLine(bot: Pick<OwnerBot, 'platform' | 'botUsername' | 'botId'>, body: unknown): string {
  const label = botLabel(bot);
  const webhookRemoved = body && typeof body === 'object' ? (body as { webhookRemoved?: unknown }).webhookRemoved : undefined;
  if (bot.platform === 'telegram') {
    return webhookRemoved === true
      ? `Disconnected — ${label} no longer runs your flow.`
      : `Disconnected from NavBharatAI, but Telegram did not confirm it stopped sending ${label}'s messages here, so they may go unanswered. Connecting the bot again, or to another service, replaces that.`;
  }
  return `Disconnected — ${label} no longer runs your flow here. To stop Meta sending its messages, remove the Callback URL in your Meta app (WhatsApp → Configuration).`;
}

/** The confirmation asked before a disconnect — what stops, in the user's words. PURE. */
export function disconnectConfirmText(bot: Pick<OwnerBot, 'platform' | 'botUsername' | 'botId'>): string {
  return `Disconnect ${botLabel(bot)}? It stops answering messages with your flow straight away. You can connect it again later with Go Live.`;
}
