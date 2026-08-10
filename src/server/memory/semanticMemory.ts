// Semantic conversation memory (RAG) — the PURE, dependency-free core (admin 2026-07-17).
import { parseEnvFlag } from '../lib/envFlag';
//
// WHY: today an AI only "remembers" the recent-history WINDOW the client resends (last ~20 turns) plus
// curated profile facts. Anything older that slid out of the window is forgotten. This adds retrieval-
// augmented memory: every meaningful turn is embedded into a vector and stored per user; on a new
// message we embed the query, find the most SEMANTICALLY-similar past turns (even far outside the
// window), and inject them into the prompt. So "you told me 3 weeks ago you're allergic to penicillin"
// is recalled on demand, not only if it happened to be one of the last 20 messages.
//
// This file is the PURE core (cosine similarity, top-K selection, chunk shaping, prompt formatting,
// flags) so the tricky logic is unit-tested with zero infra. The Gemini embedding client lives in
// embeddings.ts and the Firestore persistence in ConversationMemoryStore.ts.
//
// Design invariants (protect the first absolute rule — never break a chat):
//  - ADDITIVE: the recent-history transcript + profile facts are unchanged; this only ADDS a block.
//  - GATED: off unless SEMANTIC_MEMORY is on AND an embedding key exists; any error → silent no-op.
//  - BOUNDED: a fixed cap of stored chunks per user+scope, newest-wins, so a doc never grows forever.

/** One remembered conversation chunk: the text, its embedding vector, who said it, and when. */
export interface MemoryChunk {
  text: string;
  embedding: number[];
  role: 'user' | 'assistant';
  ts: number;
}

/** A chunk paired with its similarity to the current query (retrieval result). */
export interface ScoredChunk extends MemoryChunk {
  score: number;
}

// ─── Tunables (env-overridable; the code default is the source of truth) ──────────────────────────
/** Max chunks stored per user+scope (single Firestore doc stays well under the 1 MiB limit). */
export function memoryMaxChunks(): number {
  return clampInt(process.env.SEMANTIC_MEMORY_MAX_CHUNKS, 60, 4, 400);
}
/** How many relevant past chunks to inject into the prompt. */
export function memoryTopK(): number {
  return clampInt(process.env.SEMANTIC_MEMORY_TOP_K, 5, 1, 20);
}
/** Minimum cosine similarity for a chunk to be considered relevant (below = noise, dropped). */
export function memoryMinScore(): number {
  const v = Number(process.env.SEMANTIC_MEMORY_MIN_SCORE);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.72;
}
/** The Gemini embedding model id. */
export function memoryEmbedModel(): string {
  return (process.env.SEMANTIC_MEMORY_EMBED_MODEL || 'text-embedding-004').trim() || 'text-embedding-004';
}
/**
 * Master switch. OFF by default (canary): a build only does RAG memory when SEMANTIC_MEMORY is a
 * truthy flag ('on'/'true'/'1'). Even when on, the store/embeddings degrade to no-op without a key,
 * so flipping this can never break a chat — worst case it does nothing.
 */
export function semanticMemoryEnabled(): boolean {
  const v = (process.env.SEMANTIC_MEMORY || '').trim().toLowerCase();
  return parseEnvFlag(v) === true;
}

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Cosine similarity of two equal-length vectors. Returns 0 for mismatched/empty/zero vectors. Pure. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Is this text worth remembering? Skips empties, trivially short turns, and bare pleasantries — storing
 * them wastes the cap and adds noise to retrieval. Pure.
 */
export function shouldRemember(text: string): boolean {
  const t = (text || '').trim();
  if (t.length < 12) return false; // one-word/emoji turns carry no recallable fact
  const trivial = /^(hi|hello|hey|ok|okay|thanks|thank you|thx|yes|no|yeah|nope|hmm|good|great|nice|cool|namaste|shukriya|dhanyavaad|theek hai|acha|haan|nahi)[\s!.]*$/i;
  return !trivial.test(t);
}

/** Round each component so the stored vector is compact (smaller Firestore doc) without hurting recall. Pure. */
export function quantizeEmbedding(vec: number[], decimals = 5): number[] {
  if (!Array.isArray(vec)) return [];
  const f = Math.pow(10, decimals);
  return vec.map((x) => Math.round(x * f) / f);
}

/**
 * Select the most relevant stored chunks for a query embedding: cosine-score every chunk, keep those at
 * or above minScore, sort by score desc, and take the top K. `excludeTexts` drops chunks whose text is
 * already in the recent window (so we never inject a turn the prompt already contains). Pure.
 */
export function selectRelevant(
  queryEmbedding: number[],
  chunks: MemoryChunk[],
  opts?: { topK?: number; minScore?: number; excludeTexts?: Iterable<string> },
): ScoredChunk[] {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0 || !Array.isArray(chunks) || chunks.length === 0) {
    return [];
  }
  const topK = opts?.topK ?? memoryTopK();
  const minScore = opts?.minScore ?? memoryMinScore();
  const excluded = new Set<string>();
  for (const t of opts?.excludeTexts ?? []) excluded.add(normalizeText(t));

  const scored: ScoredChunk[] = [];
  for (const c of chunks) {
    if (!c || !Array.isArray(c.embedding) || typeof c.text !== 'string') continue;
    if (excluded.has(normalizeText(c.text))) continue;
    const score = cosineSimilarity(queryEmbedding, c.embedding);
    if (score >= minScore) scored.push({ ...c, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, Math.max(0, topK));
}

/** Format selected chunks as the system/prompt block the model reads. '' when nothing relevant. Pure. */
export function formatMemoryBlock(chunks: ScoredChunk[]): string {
  if (!Array.isArray(chunks) || chunks.length === 0) return '';
  // Oldest-first inside the block reads like a natural recollection; newest relevance still drove selection.
  const ordered = [...chunks].sort((a, b) => a.ts - b.ts);
  const lines = ordered.map((c) => `• ${c.role === 'user' ? 'They said' : 'You replied'}: ${c.text.replace(/\s+/g, ' ').trim()}`);
  return `RELEVANT THINGS FROM EARLIER CONVERSATIONS WITH THIS PERSON (recalled by meaning, may be from long ago — use naturally only if relevant, never quote this list verbatim or say "my notes"):\n${lines.join('\n')}`;
}

/**
 * Merge new chunks into existing storage: append, drop exact-duplicate texts (a resend/retry never
 * stores the same turn twice), and keep only the newest `cap` by timestamp. Pure.
 */
export function mergeChunks(existing: MemoryChunk[], incoming: MemoryChunk[], cap: number): MemoryChunk[] {
  const all = [...(existing || []), ...(incoming || [])].filter(
    (c) => c && typeof c.text === 'string' && c.text.trim().length > 0 && Array.isArray(c.embedding) && c.embedding.length > 0,
  );
  const seen = new Set<string>();
  const deduped: MemoryChunk[] = [];
  // Walk newest-first so a duplicate keeps its NEWEST occurrence, then cap, then restore chronological order.
  for (const c of [...all].sort((a, b) => b.ts - a.ts)) {
    const key = `${c.role}:${normalizeText(c.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
    if (deduped.length >= Math.max(1, cap)) break;
  }
  return deduped.sort((a, b) => a.ts - b.ts);
}

function normalizeText(t: string): string {
  return (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
