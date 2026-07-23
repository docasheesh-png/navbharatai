// Telegram Bot API client — the REAL wire to Telegram (admin 2026-07-23). Thin, fetch-based, and
// injectable so it is unit-testable without a network. The bot token is a SECRET: it only ever appears in
// the request URL to api.telegram.org — never logged, never returned to the client.
//
// Telegram Bot API docs: https://core.telegram.org/bots/api

import type { BotReply } from './botFlowRunner';

export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

const base = (token: string) => `https://api.telegram.org/bot${token}`;

function fetcher(f?: Fetcher): Fetcher {
  return f ?? (globalThis.fetch as unknown as Fetcher);
}

async function call(token: string, method: string, payload: Record<string, unknown> | null, f?: Fetcher): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const fetchImpl = fetcher(f);
  try {
    const res = await fetchImpl(`${base(token)}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    const j = (await res.json()) as { ok?: boolean; result?: unknown; description?: string } | null;
    return { ok: !!j?.ok, result: j?.result, description: j?.description };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : 'network error' };
  }
}

/** Validate a token and get the bot's @username. Returns { ok:false } for a bad/revoked token. */
export async function tgGetMe(token: string, f?: Fetcher): Promise<{ ok: boolean; username?: string; description?: string }> {
  const r = await call(token, 'getMe', null, f);
  const username = (r.result as { username?: string } | undefined)?.username;
  return { ok: r.ok, username, description: r.description };
}

/** Point Telegram at our webhook. `secret` is echoed back by Telegram in the X-Telegram-Bot-Api-Secret-Token
 *  header on every update, so we can reject spoofed calls. */
export async function tgSetWebhook(token: string, url: string, secret: string, f?: Fetcher): Promise<{ ok: boolean; description?: string }> {
  return call(token, 'setWebhook', { url, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true }, f);
}

export async function tgDeleteWebhook(token: string, f?: Fetcher): Promise<{ ok: boolean; description?: string }> {
  return call(token, 'deleteWebhook', { drop_pending_updates: false }, f);
}

/** Reply-keyboard markup for quick-reply buttons (one per row), or a keyboard-remove when there are none. */
export function tgReplyMarkup(buttons: string[]): Record<string, unknown> {
  if (buttons && buttons.length > 0) {
    return { keyboard: buttons.map(b => [{ text: b }]), resize_keyboard: true, one_time_keyboard: true };
  }
  return { remove_keyboard: true };
}

/** Send one reply (text + optional quick-reply buttons) to a chat. */
export async function tgSendMessage(token: string, chatId: number | string, reply: BotReply, f?: Fetcher): Promise<{ ok: boolean; description?: string }> {
  return call(token, 'sendMessage', { chat_id: chatId, text: reply.text, reply_markup: tgReplyMarkup(reply.buttons || []) }, f);
}

/** Extract the (chatId, text) we care about from a Telegram update body. Returns null for non-message
 *  updates (edits, channel posts, etc.) we don't handle. Pure. */
export function parseTelegramUpdate(body: unknown): { chatId: number; text: string } | null {
  const msg = (body as { message?: { chat?: { id?: number }; text?: string } } | null)?.message;
  const chatId = msg?.chat?.id;
  if (typeof chatId !== 'number') return null;
  return { chatId, text: typeof msg?.text === 'string' ? msg.text : '' };
}
