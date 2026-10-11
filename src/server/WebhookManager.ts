/**
 * P-PME.9 — per-user Webhook Manager.
 *
 * Lets a user register their own webhook URLs (e.g. Slack/Discord/their CI) and receive a POST on
 * build/deploy events. The events are FIRED by `userWebhookEvents.ts` from the one place each outcome is
 * decided — until 2026-10-11 nothing fired them at all and only "Send test" ever sent (see there).
 * P-BRE.7 covers a single global `BUILD_WEBHOOK_URL`; this adds managed, per-user, multi-URL,
 * per-event subscriptions stored in Firestore.
 *
 * Pure validation (`isValidWebhookUrl`, `normalizeEvents`) is unit-tested; the Firestore CRUD is
 * best-effort (degrades to a no-op when the DB / VITEST is unavailable, never throws).
 */
import crypto from 'crypto';
import { loadFirebaseAdmin } from './lib/firebaseAdminModule';
import { getServerDb } from './lib/serverDb';
import { assertPublicHttpUrl, publicOnlyInit, type UrlCheck } from './lib/ssrfGuard';

export const WEBHOOK_EVENTS = ['BUILD_COMPLETE', 'BUILD_FAILED', 'DEPLOY_COMPLETE', 'DEPLOY_FAILED'] as const;
export type WebhookEvent = typeof WEBHOOK_EVENTS[number];

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  createdAt: string;
}

const MAX_WEBHOOKS_PER_USER = 20;

/**
 * Accept only well-formed http(s) URLs. Pure, and ONLY the shape — whether the address may be reached
 * is `assertPublicHttpUrl`'s question, asked when a webhook is added AND again when it is sent.
 */
export function isValidWebhookUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Keep only known events; default to ALL events when none valid are supplied. Pure. */
export function normalizeEvents(events: unknown): WebhookEvent[] {
  if (!Array.isArray(events)) return [...WEBHOOK_EVENTS];
  const filtered = events.filter((e): e is WebhookEvent => WEBHOOK_EVENTS.includes(e as WebhookEvent));
  return filtered.length ? [...new Set(filtered)] : [...WEBHOOK_EVENTS];
}

async function getAdminFirestore(): Promise<import('firebase-admin/firestore').Firestore | null> {
  if (process.env.VITEST) return null;
  try {
    const admin = await loadFirebaseAdmin();
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return getServerDb(); // shared collision-free handle → navbharat-prod
  } catch {
    return null;
  }
}

/** List a user's registered webhooks. Best-effort → [] when unavailable. */
export async function listWebhooks(userId: string): Promise<Webhook[]> {
  const db = await getAdminFirestore();
  if (!db) return [];
  try {
    const snap = await db.collection('webhooks').doc(userId).get();
    const hooks = snap.exists ? (snap.data()?.hooks as Webhook[] | undefined) : undefined;
    return Array.isArray(hooks) ? hooks : [];
  } catch (err) {
    console.error('[WEBHOOK] list failed:', err);
    return [];
  }
}

export interface AddWebhookResult { ok: boolean; webhook?: Webhook; error?: string }

/** Register a webhook for a user (validated, capped). */
export async function addWebhook(
  userId: string,
  url: string,
  events: unknown,
  nowIso: string,
  deps: { checkUrl?: (url: string) => Promise<UrlCheck> } = {},
): Promise<AddWebhookResult> {
  if (!isValidWebhookUrl(url)) return { ok: false, error: 'A valid http(s) URL is required.' };
  // 🔒 OUR SERVER POSTS TO THIS ADDRESS (2026-10-11). Unchecked, a signed-in user could register the
  // cloud metadata server or an internal address and make NavBharatAI's server send to it with one press
  // of "Send test". Refused here so the list never holds one; checked again at send time (DNS can change).
  const reach = await (deps.checkUrl ?? assertPublicHttpUrl)(url);
  if (!reach.ok) return { ok: false, error: `That address cannot receive webhooks: ${reach.reason ?? 'it is not a public internet address.'}` };
  const db = await getAdminFirestore();
  if (!db) return { ok: false, error: 'Database unavailable.' };
  try {
    const existing = await listWebhooks(userId);
    if (existing.length >= MAX_WEBHOOKS_PER_USER) {
      return { ok: false, error: `Webhook limit reached (${MAX_WEBHOOKS_PER_USER}).` };
    }
    const webhook: Webhook = {
      id: crypto.randomBytes(8).toString('hex'),
      url,
      events: normalizeEvents(events),
      createdAt: nowIso,
    };
    await db.collection('webhooks').doc(userId).set({ hooks: [...existing, webhook] }, { merge: true });
    return { ok: true, webhook };
  } catch (err) {
    console.error('[WEBHOOK] add failed:', err);
    return { ok: false, error: 'Failed to add webhook.' };
  }
}

/** Remove a webhook by id. Returns true if a webhook was removed. */
export async function removeWebhook(userId: string, id: string): Promise<boolean> {
  const db = await getAdminFirestore();
  if (!db) return false;
  try {
    const existing = await listWebhooks(userId);
    const next = existing.filter((h) => h.id !== id);
    if (next.length === existing.length) return false;
    await db.collection('webhooks').doc(userId).set({ hooks: next }, { merge: true });
    return true;
  } catch (err) {
    console.error('[WEBHOOK] remove failed:', err);
    return false;
  }
}

/**
 * POST one event to a USER-SUPPLIED address. The address is vetted again here, not only when it was
 * added: a name that resolved to a public address then can resolve to a private one now. The connection
 * itself goes through `publicOnlyInit` (no DNS-rebinding window) and a redirect is refused (an unvetted
 * second hop). Never throws; false on any failure. 5 s timeout, as the page promises.
 */
export async function sendUserWebhook(url: string, body: unknown, timeoutMs = 5000): Promise<boolean> {
  const reach = await assertPublicHttpUrl(url).catch((): UrlCheck => ({ ok: false }));
  if (!reach.ok) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, publicOnlyInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: controller.signal,
    }));
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fire all of a user's webhooks subscribed to `event`. Best-effort + parallel; a single failing
 * webhook never affects the others or the caller. Returns how many were attempted/succeeded.
 */
export async function fireWebhooks(
  userId: string,
  event: WebhookEvent,
  payload: Record<string, unknown> = {},
  deps: { list?: (uid: string) => Promise<Webhook[]>; send?: (url: string, body: unknown) => Promise<boolean> } = {},
): Promise<{ attempted: number; succeeded: number }> {
  const hooks = (await (deps.list ?? listWebhooks)(userId)).filter((h) => Array.isArray(h.events) && h.events.includes(event));
  if (hooks.length === 0) return { attempted: 0, succeeded: 0 };
  const body = { event, ...payload };
  const send = deps.send ?? sendUserWebhook;
  const results = await Promise.all(hooks.map((h) => send(h.url, body).catch(() => false)));
  return { attempted: hooks.length, succeeded: results.filter(Boolean).length };
}
