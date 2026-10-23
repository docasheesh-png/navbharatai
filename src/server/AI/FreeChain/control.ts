import { sanitizeText } from '../../../lib/observability/sanitize';
import { createHash } from 'node:crypto';
import type { Firestore } from '../../lib/serverDb';
import { readFreeChainControlAction, type FreeChainControlAction, type FreeChainControls } from '../../../lib/freeChatChainView';
import type { FreeChainConfig } from './config';
export function controlRef(db: Firestore) { return db.collection('free_chat_chain').doc('state'); }
export function controlsFrom(raw: unknown, cfg: FreeChainConfig): FreeChainControls {
  if (raw === undefined) return { enabled: true, rolloutPercent: cfg.rolloutPercent, disabledProviders: [] };
  const value = raw as Record<string, unknown>;
  if (!value || typeof value.enabled !== 'boolean' || typeof value.rolloutPercent !== 'number' || !Number.isInteger(value.rolloutPercent) || value.rolloutPercent < 0 || value.rolloutPercent > 100
    || !Array.isArray(value.disabledProviders) || value.disabledProviders.some(p => !cfg.rungs.some(r => r.id === p))) throw new Error('FREE_CHAIN_CONTROL_INVALID');
  return { enabled: value.enabled, rolloutPercent: value.rolloutPercent, disabledProviders: [...value.disabledProviders].sort() };
}
export async function readControls(db: Firestore, cfg: FreeChainConfig): Promise<FreeChainControls> {
  // No positive cached admission: administrative OFF is seen by every new request/attempt.
  const snap = await controlRef(db).get(); return controlsFrom(snap.data()?.controls, cfg);
}
// This caches rollout selection only. Every admitted physical attempt calls readControls again.
const selectionCache = new WeakMap<Firestore, { defaultPercent: number; until: number; value: Promise<FreeChainControls> }>();
export function readControlsForSelection(db: Firestore, cfg: FreeChainConfig): Promise<FreeChainControls> {
  const now = Date.now(); const cached = selectionCache.get(db);
  if (cached && cached.defaultPercent === cfg.rolloutPercent && cached.until > now) return cached.value;
  let timer: ReturnType<typeof setTimeout>;
  const value = Promise.race([readControls(db, cfg), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('FREE_CHAIN_CONTROL_UNAVAILABLE')), 1500);
  })]).finally(() => clearTimeout(timer));
  selectionCache.set(db, { defaultPercent: cfg.rolloutPercent, until: now + 1000, value });
  return value;
}
export async function writeControls(db: Firestore, cfg: FreeChainConfig, raw: FreeChainControlAction, actor: string): Promise<void> {
  const action = readFreeChainControlAction(raw); if (!action || !actor) throw new Error('FREE_CHAIN_CONTROL_INVALID');
  await db.runTransaction(async tx => {
    const ref = controlRef(db); const current = controlsFrom((await tx.get(ref)).data()?.controls, cfg);
    const expected = (action as FreeChainControlAction & { expectedControls?: FreeChainControls }).expectedControls;
    if (!expected || JSON.stringify(current) !== JSON.stringify({ ...expected, disabledProviders: [...expected.disabledProviders].sort() })) {
      throw Object.assign(new Error('FREE_CHAIN_CONTROL_CONFLICT'), { code: 'FREE_CHAIN_CONTROL_CONFLICT' });
    }
    const next: FreeChainControls = { enabled: action.enabled ?? current.enabled, rolloutPercent: action.rolloutPercent ?? current.rolloutPercent, disabledProviders: [...(action.disabledProviders ?? current.disabledProviders)].sort() };
    tx.set(ref, { controls: next, updatedAt: Date.now() }, { merge: true });
    tx.set(ref.collection('actions').doc(), { actor, reason: sanitizeText(action.reason, 500).slice(0, 500), before: current, after: next, at: Date.now() });
  });
  selectionCache.delete(db);
}
/** Never store a user prompt or an unhashed identity in the sticky-model mapping. */
export function conversationHash(uid: string, conversation: string): string { return createHash('sha256').update(JSON.stringify(['free-chain-v1', uid, conversation])).digest('hex'); }
