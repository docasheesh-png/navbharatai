// WhatsApp Cloud API client — the REAL wire to WhatsApp (admin 2026-07-23). Uses Meta's Graph API.
// Unlike Telegram, WhatsApp requires the USER to own a Meta app + a verified business phone number and to
// register the webhook themselves in the Meta dashboard (we hand them the exact Callback URL + Verify
// token). This client just sends messages and parses incoming ones. Injectable fetch → unit-testable.
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

import type { BotReply } from './botFlowRunner';
import type { Fetcher } from './telegramApi';

const GRAPH = 'https://graph.facebook.com/v20.0';

function fetcher(f?: Fetcher): Fetcher {
  return f ?? (globalThis.fetch as unknown as Fetcher);
}

/** Send one reply to a WhatsApp user. ≤3 quick-reply options become interactive reply buttons (the Cloud
 *  API max); more than 3 (or none) degrade to a plain text message so nothing is silently dropped. */
export async function waSendMessage(token: string, phoneNumberId: string, to: string, reply: BotReply, f?: Fetcher): Promise<{ ok: boolean; description?: string }> {
  const fetchImpl = fetcher(f);
  const buttons = (reply.buttons || []).filter(b => b && b.trim().length > 0);
  let payload: Record<string, unknown>;
  if (buttons.length >= 1 && buttons.length <= 3) {
    payload = {
      messaging_product: 'whatsapp', to, type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: reply.text || ' ' },
        action: { buttons: buttons.map((b, i) => ({ type: 'reply', reply: { id: `opt_${i}`, title: b.slice(0, 20) } })) },
      },
    };
  } else {
    const text = buttons.length > 3 ? `${reply.text}\n\n${buttons.map((b, i) => `${i + 1}. ${b}`).join('\n')}` : reply.text;
    payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text || ' ' } };
  }
  try {
    const res = await fetchImpl(`${GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = (await res.json()) as { error?: { message?: string } } | null;
    return { ok: res.ok && !j?.error, description: j?.error?.message };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : 'network error' };
  }
}

/** The Meta webhook verification handshake (GET). Returns the challenge to echo when the mode + verify
 *  token match the bot's stored secret, else null (→ 403). Pure. */
export function verifyWhatsAppSubscription(query: unknown, verifyToken: string): string | null {
  const q = query as Record<string, string | undefined>;
  const mode = q?.['hub.mode'];
  const tok = q?.['hub.verify_token'];
  const challenge = q?.['hub.challenge'];
  if (mode === 'subscribe' && tok && tok === verifyToken && typeof challenge === 'string') return challenge;
  return null;
}

/** Extract (from, text) from a WhatsApp webhook body. Handles plain text + interactive button replies.
 *  Returns null for status callbacks (delivery/read receipts) and anything without a user message. Pure. */
export function parseWhatsAppMessage(body: unknown): { from: string; text: string } | null {
  const value = (body as { entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ from?: string; type?: string; text?: { body?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }> } }> }> } | null)
    ?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  const from = msg?.from;
  if (!from) return null;
  let text = '';
  if (msg?.type === 'text') text = msg.text?.body || '';
  else if (msg?.type === 'interactive') text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
  return { from, text };
}
