// BotStore — persistence for hosted chat bots (admin 2026-07-23). Mirrors ApiKeyStore: VITEST-skip so
// tests never touch Firestore, best-effort (never throws / blocks a webhook).
//
// The bot TOKEN is a secret → stored ENCRYPTED (lib/secrets AES-256-GCM) and never returned to the client.
// A WhatsApp bot's Meta App Secret (Q-612, 2026-10-05) is a secret too → `appSecretEnc`, the same helper and
// the same rule: decrypted only on the server's webhook path, never placed in any API response.
// Collections:
//   `bots`         doc=botId   { botId, ownerUid, platform, tokenEnc, webhookSecret, botUsername, flow, createdAt, active,
//                                appSecretEnc?, appSecretSet?, unsignedSeenAt?, lastWebhookAt?, lastSignatureFailureAt? }
//   `bot_sessions` doc=botId_chatId  { botId, chatId, nodeId, vars, updatedAt }   ← per-chat conversation state

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { encrypt, decrypt } from '../lib/secrets';
import type { BotFlow, BotSession } from './botFlowRunner';

export type BotPlatform = 'telegram' | 'whatsapp';

export interface BotRecord {
  botId: string;
  ownerUid: string;
  platform: BotPlatform;
  tokenEnc: string;
  webhookSecret: string;
  botUsername: string;
  flow: BotFlow;
  createdAt: number;
  active: boolean;
  /** WhatsApp only: the Cloud API phone-number id used to send messages. */
  phoneNumberId?: string;
  /** WhatsApp only: the owner's Meta App Secret, ENCRYPTED. Verifies X-Hub-Signature-256 on every delivery. */
  appSecretEnc?: string;
  /** Mirrors `!!appSecretEnc` as a queryable flag for the admin ledger's signed count. Written with it. */
  appSecretSet?: boolean;
  /** WhatsApp only: first time an UNSIGNED (legacy) delivery was served — recorded once, so the owner is told. */
  unsignedSeenAt?: number;
  /** Last webhook delivery the bot accepted (throttled: at most one write per bot per ten minutes per instance). */
  lastWebhookAt?: number;
  /** Last delivery rejected for a wrong or missing signature — usually a wrong App Secret on file. */
  lastSignatureFailureAt?: number | null;
}

/** Fields the webhook path may stamp on a bot. Never the secrets. */
export type BotStamp = Partial<Pick<BotRecord, 'unsignedSeenAt' | 'lastWebhookAt' | 'lastSignatureFailureAt'>>;

/** Display-safe view for the owner — never the token, never the App Secret. */
export interface BotMeta {
  botId: string;
  platform: BotPlatform;
  botUsername: string;
  createdAt: number;
  active: boolean;
  /** WhatsApp: whether the Meta App Secret is on file (true) or this is a legacy unsigned bot (false).
   *  null for Telegram, whose deliveries are authenticated by the secret header we set ourselves. */
  signed: boolean | null;
  /** Last delivery rejected for a bad signature, so the owner can tell a wrong App Secret from a quiet bot. */
  lastSignatureFailureAt: number | null;
}

/** One row of the admin ledger — who built which bot. Never a token, never a secret. */
export interface BotLedgerRow {
  botId: string;
  ownerUid: string;
  platform: BotPlatform;
  botUsername: string;
  createdAt: number;
  active: boolean;
  /** WhatsApp: whether an App Secret is on file. null for platforms that authenticate another way. */
  signed: boolean | null;
  unsignedSeenAt: number | null;
  lastWebhookAt: number | null;
  lastSignatureFailureAt: number | null;
}

/** Totals for the ledger header. Each is null when it could not be read — never a guessed zero. */
export interface BotLedgerCounts {
  total: number | null;
  whatsapp: number | null;
  telegram: number | null;
  whatsappSigned: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Is the record signed? WhatsApp only; the ENCRYPTED field decides, never a decrypted value. */
export function botIsSigned(r: Pick<BotRecord, 'platform' | 'appSecretEnc'>): boolean | null {
  return r.platform === 'whatsapp' ? !!r.appSecretEnc : null;
}

export function metaOf(r: BotRecord): BotMeta {
  return {
    botId: r.botId,
    platform: r.platform,
    botUsername: r.botUsername,
    createdAt: r.createdAt,
    active: r.active,
    signed: botIsSigned(r),
    lastSignatureFailureAt: num(r.lastSignatureFailureAt),
  };
}

export function ledgerRowOf(r: BotRecord): BotLedgerRow {
  return {
    botId: r.botId,
    ownerUid: r.ownerUid,
    platform: r.platform,
    botUsername: r.botUsername,
    createdAt: num(r.createdAt) ?? 0,
    active: !!r.active,
    signed: botIsSigned(r),
    unsignedSeenAt: num(r.unsignedSeenAt),
    lastWebhookAt: num(r.lastWebhookAt),
    lastSignatureFailureAt: num(r.lastSignatureFailureAt),
  };
}

/** A bot id as the connect routes mint it (12 random bytes, hex). A ledger cursor must be one. */
export function isBotId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{24}$/.test(v);
}

class BotStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = getServerDb();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  /** Persist a bot. `token` (and a WhatsApp `appSecret`) are encrypted here — callers pass PLAINTEXT. */
  async create(input: Omit<BotRecord, 'tokenEnc' | 'appSecretEnc' | 'appSecretSet'> & { token: string; appSecret?: string }): Promise<boolean> {
    const db = this.getDb();
    if (!db || !input.botId || !input.ownerUid || !input.token) return false;
    try {
      const { token, appSecret, ...rest } = input;
      const record: BotRecord = { ...rest, tokenEnc: encrypt(token) };
      if (appSecret) {
        record.appSecretEnc = encrypt(appSecret);
        record.appSecretSet = true;
      }
      await db.collection('bots').doc(record.botId).set(record, { merge: false });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Full record incl. the DECRYPTED token and App Secret — server-only (webhook + send path). Never send to
   * a client. A secret that fails to decrypt comes back as '' while `appSecretEnc` stays set, so the webhook
   * fails CLOSED on it (see whatsappWebhookVerdict) instead of treating the bot as a legacy unsigned one.
   */
  async get(botId: string): Promise<(BotRecord & { token: string; appSecret: string }) | null> {
    const db = this.getDb();
    if (!db || !botId) return null;
    try {
      const doc = await db.collection('bots').doc(botId).get();
      if (!doc.exists) return null;
      const r = doc.data() as BotRecord;
      return { ...r, token: r.tokenEnc ? decrypt(r.tokenEnc) : '', appSecret: r.appSecretEnc ? decrypt(r.appSecretEnc) : '' };
    } catch {
      return null;
    }
  }

  async listForUser(ownerUid: string): Promise<BotMeta[]> {
    const db = this.getDb();
    if (!db || !ownerUid) return [];
    try {
      const snap = await db.collection('bots').where('ownerUid', '==', ownerUid).get();
      return snap.docs.map(d => metaOf(d.data() as BotRecord)).sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  /**
   * Put a Meta App Secret on a WhatsApp bot the caller owns — how a legacy bot becomes signed without
   * reconnecting (a reconnect would mint a new bot id and so a new webhook URL in Meta). Clears an old
   * signature-failure stamp, since the secret it was measured against is gone.
   */
  async setAppSecret(botId: string, ownerUid: string, appSecret: string): Promise<'ok' | 'not-found' | 'error'> {
    const db = this.getDb();
    if (!db || !botId || !ownerUid || !appSecret) return 'error';
    try {
      const ref = db.collection('bots').doc(botId);
      const doc = await ref.get();
      const r = doc.exists ? (doc.data() as BotRecord) : null;
      if (!r || r.ownerUid !== ownerUid || r.platform !== 'whatsapp') return 'not-found';
      await ref.update({ appSecretEnc: encrypt(appSecret), appSecretSet: true, lastSignatureFailureAt: null });
      return 'ok';
    } catch {
      return 'error';
    }
  }

  /** Best-effort stamp from the webhook path (never throws, never blocks a delivery). */
  async stamp(botId: string, fields: BotStamp): Promise<void> {
    const db = this.getDb();
    if (!db || !botId || Object.keys(fields).length === 0) return;
    try {
      await db.collection('bots').doc(botId).update(fields);
    } catch {
      /* a lost stamp only delays a notice; it never affects the reply */
    }
  }

  /**
   * ONE PAGE of every user's bots for the admin ledger, newest first, resumed from a DOCUMENT SNAPSHOT
   * (exact under this ordering, no composite index). `ok: false` means the store could not be read — NOT
   * that nobody built a bot; the panel shows the two differently.
   */
  async listAllPage(opts: { limit: number; afterBotId?: string | null }): Promise<{ ok: boolean; rows: BotLedgerRow[]; nextAfterBotId: string | null }> {
    const db = this.getDb();
    if (!db) return { ok: false, rows: [], nextAfterBotId: null };
    const size = Math.max(1, Math.min(50, Math.floor(opts.limit) || 25));
    try {
      const col = db.collection('bots');
      let q = col.orderBy('createdAt', 'desc').limit(size);
      if (opts.afterBotId) {
        const after = await col.doc(opts.afterBotId).get();
        if (!after.exists) return { ok: true, rows: [], nextAfterBotId: null };
        q = q.startAfter(after);
      }
      const snap = await q.get();
      const rows = snap.docs.map(d => ledgerRowOf({ ...(d.data() as BotRecord), botId: d.id }));
      const last = snap.docs[snap.docs.length - 1];
      return { ok: true, rows, nextAfterBotId: snap.docs.length === size && last ? last.id : null };
    } catch {
      return { ok: false, rows: [], nextAfterBotId: null };
    }
  }

  /** Totals for the ledger header (server-side count aggregations, never a full read). */
  async ledgerCounts(): Promise<BotLedgerCounts> {
    const none: BotLedgerCounts = { total: null, whatsapp: null, telegram: null, whatsappSigned: null };
    const db = this.getDb();
    if (!db) return none;
    const col = db.collection('bots');
    const count = async (q: admin.firestore.Query): Promise<number | null> => {
      try {
        return (await q.count().get()).data().count;
      } catch {
        return null;
      }
    };
    const [total, whatsapp, telegram, whatsappSigned] = await Promise.all([
      count(col),
      count(col.where('platform', '==', 'whatsapp')),
      count(col.where('platform', '==', 'telegram')),
      count(col.where('appSecretSet', '==', true)),
    ]);
    return { total, whatsapp, telegram, whatsappSigned };
  }

  /** Delete a bot the caller owns. Returns the record (for webhook teardown) or null. */
  async remove(botId: string, ownerUid: string): Promise<(BotRecord & { token: string; appSecret: string }) | null> {
    const db = this.getDb();
    if (!db || !botId || !ownerUid) return null;
    try {
      const rec = await this.get(botId);
      if (!rec || rec.ownerUid !== ownerUid) return null;
      await db.collection('bots').doc(botId).delete();
      return rec;
    } catch {
      return null;
    }
  }

  async getSession(botId: string, chatId: string | number): Promise<BotSession> {
    const db = this.getDb();
    const empty: BotSession = { nodeId: null, vars: {} };
    if (!db) return empty;
    try {
      const doc = await db.collection('bot_sessions').doc(`${botId}_${chatId}`).get();
      if (!doc.exists) return empty;
      const d = doc.data() as { nodeId?: string | null; vars?: Record<string, string> };
      return { nodeId: d.nodeId ?? null, vars: d.vars ?? {} };
    } catch {
      return empty;
    }
  }

  async saveSession(botId: string, chatId: string | number, session: BotSession): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    try {
      await db.collection('bot_sessions').doc(`${botId}_${chatId}`).set(
        { botId, chatId: String(chatId), nodeId: session.nodeId, vars: session.vars, updatedAt: Date.now() },
        { merge: false },
      );
    } catch {
      /* best-effort — a lost session just restarts the conversation, never crashes the webhook */
    }
  }
}

export const botStore = new BotStore();
