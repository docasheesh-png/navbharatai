// AgentV3 — Semantic embedding-based file search (Level 3).
//
// Vector-similarity search over the project's source files: when the agent looks
// for files relevant to an edit ("fix the checkout flow"), this returns the MOST
// RELEVANT files by semantic similarity — even when the keywords don't appear
// verbatim in file names.
//
// Uses OpenAI text-embedding-ada-002 (the `openai` npm package is already in
// the project's dependencies). Requires OPENAI_API_KEY in the environment.
// Gracefully degrades to empty results when the key is absent — the rest of the
// engine is completely unaffected.
//
// In-memory store (no external vector DB). Embeddings are computed once per file
// and cached in the EmbeddingStore for the process lifetime. On server restart
// they are recomputed lazily as files are re-indexed.

let OpenAIClass: any;

async function loadOpenAI(): Promise<any> {
  if (OpenAIClass) return OpenAIClass;
  try {
    const mod = await import('openai');
    OpenAIClass = mod.OpenAI ?? mod.default;
    return OpenAIClass;
  } catch {
    return null;
  }
}

import { saveEmbedding, removeEmbedding, loadEmbeddings, hashContent, needsReembed } from './EmbeddingStore';

export interface EmbeddingEntry {
  id: string;
  text: string;
  embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * In-memory vector store for project file embeddings.
 * Each entry is keyed by file path.
 */
export class EmbeddingStore {
  private readonly entries = new Map<string, EmbeddingEntry>();
  // P-DATA.3 — per-path content hash, so an unchanged file is never re-embedded (cost/latency).
  private readonly hashes = new Map<string, string>();
  private client: any = null;
  private readonly apiKey: string;
  private readonly workspaceId?: string;
  private hydrated = false;

  constructor(apiKey?: string, workspaceId?: string) {
    this.apiKey = apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.workspaceId = workspaceId;
  }

  /**
   * P-DATA.3 — hydrate the in-memory index from the durable store ONCE (cold start), so a restarted
   * instance can search immediately without re-embedding the whole workspace. Best-effort, idempotent.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.workspaceId) return;
    try {
      const rows = await loadEmbeddings(this.workspaceId);
      for (const r of rows) {
        if (!this.entries.has(r.path) && Array.isArray(r.embedding) && r.embedding.length > 0) {
          this.entries.set(r.path, { id: r.path, text: '', embedding: r.embedding });
          if (r.hash) this.hashes.set(r.path, r.hash);
        }
      }
    } catch { /* best-effort */ }
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    if (!this.apiKey) return null;
    const Cls = await loadOpenAI();
    if (!Cls) return null;
    this.client = new Cls({ apiKey: this.apiKey });
    return this.client;
  }

  /**
   * Embed a text via OpenAI ada-002. Returns null when the API is unavailable.
   * Never throws.
   */
  async embed(text: string): Promise<number[] | null> {
    const client = await this.getClient();
    if (!client) return null;
    try {
      const res = await client.embeddings.create({
        model: 'text-embedding-ada-002',
        input: text.slice(0, 8000),
      });
      return (res.data?.[0]?.embedding as number[]) ?? null;
    } catch {
      return null;
    }
  }

  /** Add (or update) a file in the embedding index. No-op if embed fails. */
  async addFile(path: string, content: string): Promise<void> {
    // P-DATA.3 — skip re-embedding an unchanged file (same content hash) — saves an API call + cost.
    const hash = hashContent(content);
    if (this.entries.has(path) && !needsReembed(this.hashes.get(path), hash)) return;
    const text = buildEmbedText(path, content);
    const embedding = await this.embed(text);
    if (!embedding) return;
    this.entries.set(path, { id: path, text, embedding });
    this.hashes.set(path, hash);
    // Persist durably (best-effort) so a cold start hydrates instead of re-embedding.
    if (this.workspaceId) saveEmbedding(this.workspaceId, { path, hash, embedding }).catch(() => {});
  }

  /** Remove a file from the index (called when a file is deleted). */
  removeFile(path: string): void {
    this.entries.delete(path);
    this.hashes.delete(path);
    if (this.workspaceId) removeEmbedding(this.workspaceId, path).catch(() => {});
  }

  /**
   * Return the top-K most semantically relevant file paths for a query.
   * Returns [] when no embeddings exist or the API is unavailable.
   */
  async search(query: string, topK = 5): Promise<string[]> {
    await this.hydrate(); // P-DATA.3 — pull the durable index in on a cold start before searching.
    if (this.entries.size === 0) return [];
    const queryEmb = await this.embed(query);
    if (!queryEmb) return [];
    const scored = [...this.entries.values()].map((e) => ({
      id: e.id,
      score: cosineSimilarity(queryEmb, e.embedding),
    }));
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.id);
  }

  /** Number of indexed files. */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * Build a compact, embeddable text representation of a file.
 * Includes the file path (important semantic signal) and exported symbol names.
 */
function buildEmbedText(path: string, content: string): string {
  const exports = (
    content.match(
      /export\s+(?:default\s+)?(?:function|class|const|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    ) ?? []
  )
    .map((m) => m.split(/\s+/).pop() ?? '')
    .slice(0, 10)
    .join(', ');
  const firstLines = content.split('\n').slice(0, 5).join(' ').replace(/\s+/g, ' ').slice(0, 300);
  return `File: ${path}\nExports: ${exports || 'none'}\nContent: ${firstLines}`;
}

// ── Per-workspace store registry ─────────────────────────────────────────────

const stores = new Map<string, EmbeddingStore>();

/** Get (or create) the EmbeddingStore for a workspace. */
export function getEmbeddingStore(workspaceId: string): EmbeddingStore {
  let s = stores.get(workspaceId);
  if (!s) {
    s = new EmbeddingStore(undefined, workspaceId); // P-DATA.3 — durable, per-workspace embeddings.
    stores.set(workspaceId, s);
  }
  return s;
}

/** Test-only: clear all stores. */
export function _clearEmbeddingStores(): void {
  stores.clear();
}
