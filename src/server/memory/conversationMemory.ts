// Semantic conversation memory — orchestration (admin 2026-07-17).
//
// Ties the pure core + Gemini embeddings + Firestore store into the two calls a chat surface needs:
//   retrieveMemoryBlock() — before building the prompt: recall relevant past turns as a prompt block.
//   rememberTurn()        — after the reply: embed + persist this turn for future recall.
//
// BOTH are fully gated and best-effort: they do nothing unless SEMANTIC_MEMORY is on, an embedding key
// exists, and a verified user id is present; and every failure is swallowed. So enabling this can never
// break or slow a chat beyond the bounded embed timeout — worst case it silently adds/recalls nothing.

import {
  semanticMemoryEnabled,
  shouldRemember,
  quantizeEmbedding,
  selectRelevant,
  formatMemoryBlock,
  memoryMaxChunks,
  type MemoryChunk,
} from './semanticMemory';
import { embedText, embeddingsAvailable } from './embeddings';
import { loadMemory, appendMemory } from './ConversationMemoryStore';

/** Cheap synchronous gate — all three conditions must hold for memory to do anything. */
function active(userId: string | undefined | null): userId is string {
  return !!userId && semanticMemoryEnabled() && embeddingsAvailable();
}

/**
 * Recall the most relevant past turns for `query` and return them as a prompt block ('' when disabled,
 * off, or nothing relevant). `excludeTexts` are turns already in the recent window, so we never
 * re-inject what the prompt already shows.
 */
export async function retrieveMemoryBlock(
  userId: string | undefined | null,
  scope: string,
  query: string,
  excludeTexts?: Iterable<string>,
): Promise<string> {
  if (!active(userId) || !scope || !query.trim()) return '';
  try {
    const chunks = await loadMemory(userId, scope);
    if (chunks.length === 0) return '';
    const queryVec = await embedText(query);
    if (!queryVec) return '';
    const relevant = selectRelevant(queryVec, chunks, { excludeTexts });
    return formatMemoryBlock(relevant);
  } catch {
    return '';
  }
}

/**
 * Persist this turn (the user message + the assistant reply) as embedded memory, so it can be recalled
 * later. Skips trivial turns, embeds what remains, and appends within the bounded cap. Best-effort +
 * non-throwing — safe to await or fire-and-forget.
 */
export async function rememberTurn(
  userId: string | undefined | null,
  scope: string,
  userText: string,
  assistantText: string,
): Promise<void> {
  if (!active(userId) || !scope) return;
  try {
    const now = Date.now();
    const pending: Array<{ role: 'user' | 'assistant'; text: string; ts: number }> = [];
    if (shouldRemember(userText)) pending.push({ role: 'user', text: userText.trim(), ts: now });
    if (shouldRemember(assistantText)) pending.push({ role: 'assistant', text: assistantText.trim(), ts: now + 1 });
    if (pending.length === 0) return;

    const chunks: MemoryChunk[] = [];
    for (const p of pending) {
      const vec = await embedText(p.text);
      if (vec) chunks.push({ role: p.role, text: p.text, ts: p.ts, embedding: quantizeEmbedding(vec) });
    }
    if (chunks.length > 0) await appendMemory(userId, scope, chunks, memoryMaxChunks());
  } catch {
    /* best-effort */
  }
}
