// Pure conversation-memory helpers for NavBharatAI Voice (admin 2026-07-14: "co-founder memory" —
// the professional voice REMEMBERS you across calls, not from zero each time).
//
// These are the pure, dependency-free merge/dedup/cap rules used by VoiceMemoryStore (the Firestore
// wrapper). Kept separate so the tricky "what gets seeded / what gets remembered" logic is unit-tested
// without ever touching firebase-admin. A SonicTurn is one {role, content} conversation line.

import type { SonicTurn } from './SonicBridge';

/** Trim, drop empties, and collapse EXACT consecutive duplicates (same role + text back-to-back). */
export function dedupeConsecutive(turns: SonicTurn[]): SonicTurn[] {
  const out: SonicTurn[] = [];
  for (const t of turns) {
    const content = (t?.content || '').trim();
    if (!content) continue;
    const role = t.role === 'assistant' ? 'assistant' : 'user';
    const prev = out[out.length - 1];
    if (prev && prev.role === role && prev.content === content) continue;
    out.push({ role, content });
  }
  return out;
}

/**
 * Build the turns to SEED into a new voice session so it CONTINUES where you left off. Persisted
 * memory (older, from past voice calls) comes first, then the client's live text history (the chat
 * the user is looking at right now) — deduped and capped to the last `cap` turns so the newest,
 * most-relevant context always survives the cap. Either source may be empty.
 */
export function mergeSeed(persisted: SonicTurn[], clientHistory: SonicTurn[], cap = 16): SonicTurn[] {
  const merged = dedupeConsecutive([...(persisted || []), ...(clientHistory || [])]);
  return merged.slice(-Math.max(0, cap));
}

/**
 * Fold the turns spoken in THIS session into the stored rolling memory. Appends the fresh turns to
 * what was already remembered, dedups, and keeps only the last `cap` turns so the document stays
 * bounded (never grows forever). Returns the new memory to persist.
 */
export function appendMemory(existing: SonicTurn[], fresh: SonicTurn[], cap = 30): SonicTurn[] {
  const merged = dedupeConsecutive([...(existing || []), ...(fresh || [])]);
  return merged.slice(-Math.max(0, cap));
}

/**
 * Stable Firestore doc key for a user's voice memory with a given professional (default when none).
 *
 * 🔒 PER CONVERSATION since 2026-09-21 (review finding on the five-windows change): voice memory holds
 * spoken turns VERBATIM and was keyed per professional only, so a call from one Teacher AI window
 * seeded the other window's next call with its actual words — the exact class the text lane had just
 * closed, surviving on the sibling lane. With a conversation id the doc is that conversation's own;
 * without one (Doctor AI, a client built before ids) the key is byte-identical to before, so an
 * existing memory keeps working and is reachable only by an id-less caller — the same uniform rule as
 * `MemoryChunk.conversationId`.
 */
export function memoryKey(userId: string, professionalId?: string, conversationId?: string): string {
  const prof = (professionalId || 'default').replace(/[^\w-]/g, '_');
  if (!conversationId) return `${userId}__${prof}`;
  return `${userId}__${prof}__${conversationId.replace(/[^\w-]/g, '_')}`;
}
