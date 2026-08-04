import { describe, it, expect } from 'vitest';
import { parseTelegramUpdate, tgReplyMarkup, tgGetMe, tgSendMessage } from './telegramApi';
import { parseWhatsAppMessage, verifyWhatsAppSubscription, waSendMessage } from './whatsappApi';

describe('Telegram connector', () => {
  it('parses a text message update, ignores non-messages', () => {
    expect(parseTelegramUpdate({ message: { chat: { id: 42 }, text: 'hi' } })).toEqual({ chatId: 42, text: 'hi' });
    expect(parseTelegramUpdate({ edited_message: { chat: { id: 42 }, text: 'x' } })).toBeNull();
    expect(parseTelegramUpdate({})).toBeNull();
  });

  it('builds quick-reply keyboard, or removes it when there are no buttons', () => {
    expect(tgReplyMarkup(['A', 'B'])).toMatchObject({ keyboard: [[{ text: 'A' }], [{ text: 'B' }]], resize_keyboard: true });
    expect(tgReplyMarkup([])).toMatchObject({ remove_keyboard: true });
  });

  it('getMe returns the username on ok, and never throws on a network error', async () => {
    const ok = await tgGetMe('t', async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { username: 'my_bot' } }), text: async () => '' }));
    expect(ok).toEqual({ ok: true, username: 'my_bot', description: undefined });
    const boom = await tgGetMe('t', async () => { throw new Error('down'); });
    expect(boom.ok).toBe(false);
  });

  it('sendMessage posts text + reply_markup to the bot token', async () => {
    let body = '';
    await tgSendMessage('123:ABC', 5, { text: 'hello', buttons: ['Yes'] }, async (_u, init) => { body = init?.body || ''; return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' }; });
    const sent = JSON.parse(body);
    expect(sent.chat_id).toBe(5);
    expect(sent.text).toBe('hello');
    expect(sent.reply_markup.keyboard).toEqual([[{ text: 'Yes' }]]);
  });
});

describe('WhatsApp connector', () => {
  it('parses a text message + an interactive button reply, ignores status callbacks', () => {
    const textBody = { entry: [{ changes: [{ value: { messages: [{ from: '9199', type: 'text', text: { body: 'hi' } }] } }] }] };
    expect(parseWhatsAppMessage(textBody)).toEqual({ from: '9199', text: 'hi' });
    const btnBody = { entry: [{ changes: [{ value: { messages: [{ from: '9199', type: 'interactive', interactive: { button_reply: { title: 'Track Order' } } }] } }] }] };
    expect(parseWhatsAppMessage(btnBody)).toEqual({ from: '9199', text: 'Track Order' });
    const statusBody = { entry: [{ changes: [{ value: { statuses: [{ status: 'delivered' }] } }] }] };
    expect(parseWhatsAppMessage(statusBody)).toBeNull();
  });

  it('verifies the Meta subscription handshake only with the right verify token', () => {
    const q = { 'hub.mode': 'subscribe', 'hub.verify_token': 'secret123', 'hub.challenge': 'CHAL' };
    expect(verifyWhatsAppSubscription(q, 'secret123')).toBe('CHAL');
    expect(verifyWhatsAppSubscription(q, 'wrong')).toBeNull();
    expect(verifyWhatsAppSubscription({ 'hub.mode': 'x' }, 'secret123')).toBeNull();
  });

  it('sends interactive buttons for ≤3 options, falls back to text otherwise', async () => {
    let body = '';
    const f = async (_u: string, init?: { body?: string }) => { body = init?.body || ''; return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; };
    await waSendMessage('TOK', 'PNID', '9199', { text: 'pick', buttons: ['A', 'B'] }, f);
    expect(JSON.parse(body).type).toBe('interactive');
    await waSendMessage('TOK', 'PNID', '9199', { text: 'pick', buttons: ['A', 'B', 'C', 'D'] }, f);
    const sent = JSON.parse(body);
    expect(sent.type).toBe('text');
    expect(sent.text.body).toContain('1. A');
  });
});
