// BotStore — persistence for hosted chat bots (admin 2026-07-23). Mirrors ApiKeyStore: VITEST-skip so
// tests never touch Firestore, best-effort (never throws / blocks a webhook).
//
// The bot TOKEN is a secret → stored ENCRYPTED (lib/secrets AES-256-GCM) and never returned to the client.
// Collections:
//   `bots`         doc=botId   { botId, ownerUid, platform, tokenEnc, webhookSecret, botUsername, flow, createdAt, active }
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
}

/** Display-safe view for the owner — never the token. */
export interface BotMeta {
  botId: string;
  platform: BotPlatform;
  botUsername: string;
  createdAt: number;
  active: boolean;
}

function metaOf(r: BotRecord): BotMeta {
  return { botId: r.botId, platform: r.platform, botUsername: r.botUsername, createdAt: r.createdAt, active: r.active };
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

  /** Persist a bot. `token` is encrypted here — callers pass the PLAINTEXT token. */
  async create(input: Omit<BotRecord, 'tokenEnc'> & { token: string }): Promise<boolean> {
    const db = this.getDb();
    if (!db || !input.botId || !input.ownerUid || !input.token) return false;
    try {
      const { token, ...rest } = input;
      const record: BotRecord = { ...rest, tokenEnc: encrypt(token) };
      await db.collection('bots').doc(record.botId).set(record, { merge: false });
      return true;
    } catch {
      return false;
    }
  }

  /** Full record incl. the DECRYPTED token — server-only (webhook + send path). Never send to a client. */
  async get(botId: string): Promise<(BotRecord & { token: string }) | null> {
    const db = this.getDb();
    if (!db || !botId) return null;
    try {
      const doc = await db.collection('bots').doc(botId).get();
      if (!doc.exists) return null;
      const r = doc.data() as BotRecord;
      return { ...r, token: r.tokenEnc ? decrypt(r.tokenEnc) : '' };
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

  /** Delete a bot the caller owns. Returns the record (for webhook teardown) or null. */
  async remove(botId: string, ownerUid: string): Promise<(BotRecord & { token: string }) | null> {
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
