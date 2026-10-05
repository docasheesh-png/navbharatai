// WhatsApp webhook authenticity (Q-612, admin decision 2026-10-05, option (a)).
//
// THE HOLE THIS CLOSES. `POST /api/bots/whatsapp/webhook/:botId` used to take any body at face value: it
// looked the bot up, ran the owner's flow and sent the replies with the OWNER's Cloud API token to
// whatever `from` number the body named. Anyone who learned a webhook address could make a stranger's
// business number message people. Telegram's sibling route always checked its secret header; WhatsApp
// had no equivalent, because Meta authenticates its deliveries differently — it signs every POST with the
// app's App Secret: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(appSecret, raw body)>`.
//
// The Meta app is the USER's own, so the App Secret is per bot: it is collected at connect, stored
// encrypted (lib/secrets, the same AES-256-GCM path as the bot token), and never returned to a browser.
//
// EXISTING BOTS. Bots connected before this change have no App Secret on file. They keep working until the
// cut-over date (`WHATSAPP_SIGNATURE_REQUIRED_AFTER`, one env-tunable ISO date) so their owners can add it
// from the Bot Builder; after that date an unsigned bot's deliveries are refused.
//
// PURE — no Express, no Firestore. The route applies the verdict.

import crypto from 'crypto';

/** Default cut-over: 30 days after the admin's decision (2026-10-05). Overridable by env. */
export const WHATSAPP_SIGNATURE_DEFAULT_CUTOVER = '2026-11-05T00:00:00.000Z';

/** The env key that moves the cut-over date. An ISO date or date-time; anything unreadable is ignored. */
export const WHATSAPP_SIGNATURE_CUTOVER_ENV = 'WHATSAPP_SIGNATURE_REQUIRED_AFTER';

/** The moment after which a WhatsApp bot without an App Secret is refused (epoch ms). */
export function whatsappSignatureCutoverMs(env: Record<string, string | undefined> = process.env): number {
  const raw = String(env[WHATSAPP_SIGNATURE_CUTOVER_ENV] ?? '').trim();
  if (raw) {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return t;
    console.warn(`[bots] ${WHATSAPP_SIGNATURE_CUTOVER_ENV} is not a readable date; using the default ${WHATSAPP_SIGNATURE_DEFAULT_CUTOVER}.`);
  }
  return Date.parse(WHATSAPP_SIGNATURE_DEFAULT_CUTOVER);
}

/** The cut-over as an ISO string, for the owner's notice and the admin ledger. */
export function whatsappSignatureCutoverIso(env: Record<string, string | undefined> = process.env): string {
  return new Date(whatsappSignatureCutoverMs(env)).toISOString();
}

/**
 * Is this string shaped like a Meta App Secret? Meta issues 32 lowercase hexadecimal characters
 * (App settings → Basic → App secret). The check exists to catch the common paste mistake — the access
 * token or the Phone Number ID in the wrong box — before it silently fails every delivery.
 */
export function isMetaAppSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/i.test(value.trim());
}

/**
 * Verify Meta's `X-Hub-Signature-256` header against the EXACT raw request bytes.
 *
 * The raw bytes matter: re-serialising the parsed JSON changes whitespace and escapes, so the HMAC would
 * never match. `server.ts` stores them on `req.rawBody` in express.json's verify hook. Constant-time
 * compare; a missing body, header or secret is a failure, never a pass.
 */
export function verifyMetaSignature(rawBody: Buffer | string | undefined | null, header: unknown, appSecret: string): boolean {
  if (!appSecret || rawBody == null) return false;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(value.trim());
  if (!m) return false;
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const expected = crypto.createHmac('sha256', appSecret).update(body).digest();
  const given = Buffer.from(m[1], 'hex');
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

export type WhatsAppWebhookVerdict =
  /** Signed bot, valid signature: run the flow. */
  | 'serve'
  /** Signed bot, missing or wrong signature: 401, nothing runs, nothing is sent. */
  | 'bad-signature'
  /** Legacy bot with no App Secret, before the cut-over: served, and the owner is told. */
  | 'unsigned-legacy'
  /** Legacy bot with no App Secret, after the cut-over: refused. */
  | 'unsigned-refused';

/**
 * What the webhook does with one delivery. `hasAppSecret` is whether the bot RECORD carries an encrypted
 * App Secret — not whether it decrypted: a secret that fails to decrypt must fail closed (bad-signature),
 * never fall through to the legacy path.
 */
export function whatsappWebhookVerdict(opts: { hasAppSecret: boolean; signatureOk: boolean; now: number; cutoverMs: number }): WhatsAppWebhookVerdict {
  if (opts.hasAppSecret) return opts.signatureOk ? 'serve' : 'bad-signature';
  return opts.now < opts.cutoverMs ? 'unsigned-legacy' : 'unsigned-refused';
}
