// P-AI.2 — Dependency-free RAG: BM25 reranker + grounding + citations.
//
// EmbeddingSearch needs OPENAI_API_KEY (absent in prod), so semantic retrieval is dormant. This is a
// LEXICAL retriever that works with zero infra: it ranks the workspace's own files against the user's
// request with Okapi BM25, then builds a grounded context block citing each source file (path +
// line). So an edit turn gets the genuinely-most-relevant existing files up front — real grounding,
// not a guess — and every injected snippet is traceable to its source (citation).
//
// Pure + deterministic → unit-tested. No dependency.

const STOPWORDS = new Set(
  'the a an and or of to in for on with is are be this that it as at by from into your you i we my our app build make create add fix change update use using need want please'.split(
    ' ',
  ),
);

/** Tokenize to lowercased word stems (alphanumerics), dropping stopwords + 1-char tokens. Pure. */
export function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Salient CONTENT-SEARCH terms from a request — meaningful words long enough to grep the codebase
 * for without over-matching (drops the short common words that would match half the files). Bounded.
 * Used to find the relevant files by CONTENT (e.g. the file where "credits" are decremented), not
 * just by filename — essential for editing a large imported app where the right file's NAME may not
 * echo the request. PURE.
 */
export function contentSearchTerms(text: string, max = 6): string[] {
  return [...new Set(tokenize(text).filter((t) => t.length >= 4))].slice(0, Math.max(0, max));
}

export interface RankedDoc {
  path: string;
  score: number;
}

interface Doc {
  path: string;
  tokens: string[];
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

/**
 * Rank documents (files) against a query with Okapi BM25. Returns docs with score > 0, highest first.
 * Pure. `files` is a path→content map.
 */
export function rankByBM25(files: Record<string, string>, query: string, limit = 5): RankedDoc[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];
  const docs: Doc[] = Object.entries(files || {})
    .filter(([, c]) => typeof c === 'string')
    .map(([path, content]) => ({ path, tokens: tokenize(content) }));
  if (docs.length === 0) return [];

  const N = docs.length;
  const avgLen = docs.reduce((s, d) => s + d.tokens.length, 0) / N || 1;
  // Document frequency per query term.
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let n = 0;
    for (const d of docs) if (d.tokens.includes(term)) n += 1;
    df.set(term, n);
  }

  const ranked: RankedDoc[] = docs.map((d) => {
    const len = d.tokens.length || 1;
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const f = tf.get(term) || 0;
      if (f === 0) continue;
      const n = df.get(term) || 0;
      // BM25 idf (with the +1 form so it's always positive).
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * (len / avgLen))));
    }
    return { path: d.path, score: Math.round(score * 1000) / 1000 };
  });

  return ranked
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, Math.max(0, limit));
}

/** First line index (1-based) in `content` that contains any query term, for the citation. Pure. */
export function firstRelevantLine(content: string, query: string): number {
  const terms = new Set(tokenize(query));
  if (terms.size === 0) return 1;
  const lines = String(content || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineTokens = tokenize(lines[i]);
    if (lineTokens.some((t) => terms.has(t))) return i + 1;
  }
  return 1;
}

/** A short snippet (a few lines) around the first relevant line, for grounding. Pure. */
export function snippetAround(content: string, line: number, radius = 3, maxChars = 500): string {
  const lines = String(content || '').split('\n');
  const start = Math.max(0, line - 1 - radius);
  const end = Math.min(lines.length, line - 1 + radius + 1);
  return lines.slice(start, end).join('\n').slice(0, maxChars);
}

/**
 * Build a grounded, CITED context block from the top BM25-ranked workspace files for the query.
 * Returns '' when nothing is relevant. Pure (given the file map). The agent is told these are
 * grounding hints (read the file for the full content), each labelled with its source path:line.
 */
export function buildGroundedContext(files: Record<string, string>, query: string, topK = 3): string {
  const ranked = rankByBM25(files, query, topK);
  if (ranked.length === 0) return '';
  const blocks: string[] = [];
  for (const { path } of ranked) {
    const content = files[path];
    if (typeof content !== 'string') continue;
    const line = firstRelevantLine(content, query);
    const snippet = snippetAround(content, line);
    blocks.push(`• ${path}:${line}\n${snippet}`);
  }
  if (blocks.length === 0) return '';
  return [
    'RELEVANT EXISTING FILES (grounding — ranked by relevance to this request; cited as path:line).',
    'These are the most likely files to read/modify; open them with read_file for full content before editing:',
    ...blocks,
  ].join('\n\n');
}
