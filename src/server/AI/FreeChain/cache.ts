import { createHash } from 'node:crypto';
import type { Firestore } from '../../lib/serverDb';
/** Deliberately small exact safe corpus. Empty history alone never proves that a prompt lacks PII. */
const PUBLIC_PROMPTS = new Set(['what is photosynthesis', 'explain photosynthesis', 'प्रकाश संश्लेषण क्या है', 'photosynthesis kya hai', 'what is a prime number', 'अभाज्य संख्या क्या है']);
export function normalizedCachePrompt(message: string): string { return message.normalize('NFC').trim().toLowerCase().replace(/[?।？！!]+$/u, '').replace(/\s+/g, ' '); }
export function safeCacheKey(input: { message: string; history: unknown[]; eligible: boolean; language: string; systemPrompt: string; modelFamily: string; faq?: boolean }): string | null {
  // `faq` = master-plan FAQ cache: caller has already proven the text is personal-data-free and undated.
  if (!input.eligible || input.history.length || !(PUBLIC_PROMPTS.has(normalizedCachePrompt(input.message)) || input.faq === true)) return null;
  return createHash('sha256').update(JSON.stringify(['v1', normalizedCachePrompt(input.message), input.language, input.systemPrompt, input.modelFamily])).digest('hex');
}
export class FreeChainCache {
  constructor(private db: Firestore) {}
  async get(key: string, now = Date.now()): Promise<{ content: string; provider: string; model: string } | null> {
    if (!/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(now) || now < 0) return null;
    const data = (await this.db.collection('free_chat_chain').doc('state').collection('cache').doc(key).get()).data();
    if (!data || !Number.isSafeInteger(data.expiresAt) || !(data.expiresAt > now) || typeof data.content !== 'string' || !data.content.trim() || data.content.length > 32000 || typeof data.provider !== 'string' || !data.provider.trim() || data.provider.length > 32 || typeof data.model !== 'string' || !data.model.trim() || data.model.length > 256) return null;
    return { content: data.content, provider: data.provider, model: data.model };
  }
  async put(key: string, value: { content: string; provider: string; model: string }, ttlS: number, now = Date.now()): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(now) || now < 0
      || !Number.isSafeInteger(ttlS) || ttlS < 1 || ttlS > 86400 || !Number.isSafeInteger(now + ttlS * 1000)
      || typeof value.content !== 'string' || !value.content.trim() || value.content.length > 32000
      || typeof value.provider !== 'string' || !value.provider.trim() || value.provider.length > 32
      || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 256) return;
    await this.db.collection('free_chat_chain').doc('state').collection('cache').doc(key).set({ ...value, expiresAt: now + ttlS * 1000, expireAt: new Date(now + ttlS * 1000) });
  }
}
