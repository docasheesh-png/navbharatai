// AgentV3 — BM25 relevance ranking (best-in-class recall).
//
// WorkspaceMemory.recall historically scored a query token with a flat "+2 whole-word /
// +1 substring" per hit. That treats every token as equally important, so a common token
// ("app", "page", "button") counts as much as a rare, discriminating one ("countdown",
// "stripe", "websocket") — and the genuinely relevant memory can rank below noise.
//
// BM25 is the ranking function used by real search engines (Lucene/Elasticsearch). It scores
// each document for a query by, per query term:
//   • IDF — inverse document frequency: a term in FEW documents is more discriminating, so it
//     is weighted higher than a term that appears almost everywhere.
//   • TF saturation — repeating a term helps, but with diminishing returns (k1), so a doc that
//     spams one word can't dominate.
//   • Length normalisation (b) — a short, focused doc that contains the term outranks a long
//     doc where the term is diluted.
//
// PURE & deterministic (no I/O, no wall-clock), so it is fully unit-testable and safe to fold
// into recall as the token-relevance signal under the existing exact/prefix/substring bonuses.

export interface Bm25Doc {
  /** Caller-chosen stable id; the returned Map is keyed by this. */
  id: string;
  /** Raw text of the document (tokenised internally). */
  text: string;
}

export interface Bm25Options {
  /** Term-frequency saturation. Lucene default 1.2; 1.5 is a touch more permissive. */
  k1?: number;
  /** Length-normalisation strength in [0,1]. Lucene default 0.75. */
  b?: number;
  /** Minimum token length to index (shorter tokens carry little signal). */
  minTokenLen?: number;
  /** Tokens to drop entirely (generic words). */
  stopwords?: Set<string>;
}

const DEFAULT_STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'you',
  'are', 'was', 'has', 'have', 'will', 'use', 'using',
]);

/** Lowercase alphanumeric tokens, length-filtered and stopword-filtered. PURE. */
export function bm25Tokenize(text: string, minLen = 3, stopwords: Set<string> = DEFAULT_STOPWORDS): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= minLen && !stopwords.has(t));
}

/**
 * Score every document against the query with Okapi BM25.
 * Returns a Map of doc id → score (≥ 0). Documents that share no query term score 0
 * (and are simply absent from the practical ranking). PURE & deterministic.
 */
export function bm25(query: string, docs: Bm25Doc[], opts: Bm25Options = {}): Map<string, number> {
  const k1 = opts.k1 ?? 1.5;
  const b = opts.b ?? 0.75;
  const minLen = opts.minTokenLen ?? 3;
  const stop = opts.stopwords ?? DEFAULT_STOPWORDS;

  const out = new Map<string, number>();
  if (!Array.isArray(docs) || docs.length === 0) return out;

  const queryTerms = [...new Set(bm25Tokenize(query, minLen, stop))];
  if (queryTerms.length === 0) {
    for (const d of docs) out.set(d.id, 0);
    return out;
  }

  // Tokenise every doc once; collect term frequencies, doc lengths and document frequency.
  const docTerms: { id: string; tf: Map<string, number>; len: number }[] = [];
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const d of docs) {
    const toks = bm25Tokenize(d.text, minLen, stop);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    docTerms.push({ id: d.id, tf, len: toks.length });
    totalLen += toks.length;
  }
  const N = docs.length;
  const avgdl = totalLen / N || 1;

  // BM25+ IDF variant (always ≥ 0, so a term in every doc never produces a negative score).
  const idf = (term: string): number => {
    const n = df.get(term) ?? 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  for (const d of docTerms) {
    let score = 0;
    for (const term of queryTerms) {
      const f = d.tf.get(term);
      if (!f) continue;
      const denom = f + k1 * (1 - b + b * (d.len / avgdl));
      score += idf(term) * ((f * (k1 + 1)) / denom);
    }
    out.set(d.id, score);
  }
  return out;
}
