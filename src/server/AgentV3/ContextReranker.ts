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
    // Generated output is never grounding material, and a minified bundle is the single most
    // expensive thing that can win a ranking — see the note on isGeneratedArtifact. The path rule
    // catches the usual homes; looksMinified catches a hashed chunk sitting somewhere unexpected.
    .filter(([p, c]) => typeof c === 'string' && !isGeneratedArtifact(p) && !looksMinified(c))
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

// ── Retrieval v2 (Mitrify autopsy: "retrieval quality kamzor hai" → world-class candidate selection) ──
//
// THE BUG this replaces: candidates were picked by path-token overlap with the request. A survey /
// vague request ("give me a survey of what this app is") shares NO tokens with any filename → every
// file ties at overlap 0 → sort keeps tree order → the FIRST 14 files alphabetically became the
// "most relevant" candidates (BackButton.tsx, ChangeCredentialsDialog.tsx…). Pure noise, injected
// into every turn of a 317-file app.
//
// v2 selects candidates from three REAL signals, intent-aware:
//   1. CONTENT hits (grep for the request's salient terms) — the strongest "where does this live".
//   2. STRUCTURAL ANCHORS — entry points & structural files (package.json, README, main/App, routes,
//      schema, server index): what a senior engineer opens FIRST in an unknown repo.
//   3. IMPORT-GRAPH CENTRALITY — files the rest of the codebase imports most (storage.ts, db.ts,
//      schema.ts): structurally load-bearing even when their name echoes nothing in the request.
// An OVERVIEW request (survey/structure/explain/analyze…) skips filename matching entirely — anchors
// + centrality ARE the right answer. A targeted request uses content hits first, then filename
// overlap (only where overlap > 0 — the tie bug can never pick arbitrary files again), then priors.

/**
 * Tokenize a FILE PATH for filename↔request matching: besides the normal split, camelCase and
 * PascalCase are broken apart — `CustomerHomePage.tsx` must match the request token "customer"
 * (plain tokenize keeps it as one opaque token, so real page names never matched). Pure.
 */
export function pathTokenize(p: string): string[] {
  const spaced = String(p || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return tokenize(spaced);
}

/** Overview/survey-style request? (EN + common Hinglish forms.) Pure. */
export function isOverviewRequest(prompt: string): boolean {
  return /\b(survey|overview|structure[ds]?|architecture|walk\s?through|explain (this|the) (app|project|codebase|repo)|analy[sz]e|summar(y|ise|ize)|describe (this|the|it)|what (is|does) (this|the|it)|how (is|does) (this|the|it).{0,20}(work|structured|organi[sz]ed)|samjhao|samajhao|kya hai|kaise (kaam|bana))\b/i.test(String(prompt || ''));
}

/** Priority-ordered structural anchor patterns — what an engineer opens first in an unknown repo. */
const ANCHOR_PATTERNS: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)readme\.md$/i,
  /(^|\/)(src|client\/src|app)\/(main|index)\.(t|j)sx?$/,
  /(^|\/)(src|client\/src)\/app\.(t|j)sx?$/i,
  /(^|\/)(server|api|backend)\/(index|server|main|app)\.(t|j)s$/,
  /(^|\/)server\.(t|j)s$/,
  /(^|\/)(manage\.py|main\.py|app\.py)$/,
  /(^|\/)routes?\.(t|j)sx?$/,
  /(^|\/)(router|routes\/index)\.(t|j)sx?$/,
  /(^|\/)schema\.(t|j)s$/,
  /(^|\/)(prisma\/schema\.prisma|drizzle\.config\.(t|j)s)$/,
  /(^|\/)(storage|db|database)\.(t|j)s$/,
  /(^|\/)(vite|next|nuxt|svelte|astro)\.config\.(t|j)s$/,
];

/**
 * The structural anchor files PRESENT in this tree, in priority order (entry → routes → data → config).
 * Deterministic; each pattern contributes its lexicographically-first match so monorepos stay stable. Pure.
 */
export function structuralAnchors(fileTree: readonly string[], max = 8): string[] {
  const out: string[] = [];
  for (const re of ANCHOR_PATTERNS) {
    const matches = fileTree.filter((p) => re.test(p) && !/(^|\/)node_modules\//.test(p)).sort();
    for (const m of matches.slice(0, 2)) {
      if (!out.includes(m)) out.push(m);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * Rank files by IMPORT-GRAPH CENTRALITY (in-degree): how many OTHER files import them. Central files
 * (storage.ts, schema.ts, lib/db.ts) are structurally load-bearing for almost any edit, even when
 * their name echoes nothing in the request. Import specifiers are resolved to tree files by basename
 * (`./storage`, `@/lib/db` → the tree file whose path ends with that segment) — a deliberate, cheap
 * heuristic that needs no resolver config. UI-kit primitives (components/ui/*) are excluded: a
 * shadcn `button` is imported everywhere yet grounds nothing. Pure.
 */
export function centralFiles(fileTree: readonly string[], imports: Record<string, string[]> | undefined, top = 6): string[] {
  if (!imports) return [];
  const inDegree = new Map<string, number>();
  const bySuffix = (seg: string): string[] =>
    fileTree.filter((p) => !/(^|\/)components\/ui\//.test(p) && new RegExp(`(^|/)${seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(t|j)sx?$`).test(p));
  for (const [from, specs] of Object.entries(imports)) {
    for (const spec of specs || []) {
      // Only project-internal specifiers (relative / '@/' / '~/') — bare imports are npm packages.
      if (!/^(\.|@\/|~\/)/.test(spec)) continue;
      const seg = spec.replace(/\.(t|j)sx?$/, '').split('/').filter(Boolean).pop();
      if (!seg || seg === '.' || seg === '..') continue;
      for (const target of bySuffix(seg)) {
        if (target === from) continue;
        inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
      }
    }
  }
  return [...inDegree.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, top))
    .map(([p]) => p);
}

/**
 * GENERATED OUTPUT — never grounding material, and expensive to include.
 *
 * ROOT CAUSE (real build report, Shiv Medical Store, 2026-08-10, ₹567 on a free-tier build): this is a
 * Capacitor app, so `npx cap sync` copies the built web bundle into
 * `android/app/src/main/assets/public/`. Only `node_modules/` was excluded, so the MINIFIED REACT
 * BUNDLE (`assets/index-CW6KpYSX.js`) ranked as the #1 "most relevant existing file" and was re-sent in
 * the grounding preamble of all ~26 model calls in that build.
 *
 * It costs twice over. Tokens are the bill — that build spent ~776k input tokens to change 3 files —
 * and the model's context is filled with minified vendor code instead of the app's real source, so it
 * grounds on nothing useful. A build artifact can never inform an edit: it is the OUTPUT of the very
 * files we should be showing.
 */
const GENERATED_PATH_RE = [
  /(^|\/)node_modules\//,
  /(^|\/)(dist|build|out|coverage|\.next|\.nuxt|\.svelte-kit|\.output|\.turbo|\.cache)\//,
  // Capacitor / Cordova copy the built web app into the native projects.
  /(^|\/)android\/app\/src\/main\/assets\/public\//,
  /(^|\/)ios\/App\/App\/public\//,
  /(^|\/)(www|platforms)\//,
  // Test/report output.
  /(^|\/)(test-results|playwright-report|\.nyc_output)\//,
  /(^|\/)vendor\//,
  // Bundler output by name.
  /\.min\.(js|css)$/i,
  /\.bundle\.(js|css)$/i,
  /\.(js|css)\.map$/i,
];

/** True when the path is generated/build output rather than source the model should read. Pure. */
export function isGeneratedArtifact(p: string): boolean {
  return GENERATED_PATH_RE.some((re) => re.test(p));
}

/**
 * A content-side backstop for bundles the path rules miss (a hashed chunk dropped somewhere unusual).
 * Minified code is characterised by enormously long lines — real source almost never exceeds ~200
 * columns, while a bundle is routinely one line of hundreds of thousands of characters.
 *
 * Checked on a PREFIX, so this stays cheap on a large file.
 */
export function looksMinified(content: string): boolean {
  const head = content.slice(0, 20000);
  if (!head.trim()) return false;
  let longest = 0;
  for (const line of head.split('\n')) {
    if (line.length > longest) longest = line.length;
    if (longest > 1000) return true;
  }
  // A single unbroken line that fills the whole sample is a bundle even below the 1000 threshold.
  return content.length > 5000 && !head.includes('\n');
}

/** Files worth grounding on: code + the two doc anchors (package.json / README). Pure. */
export function groundableFile(p: string): boolean {
  if (isGeneratedArtifact(p)) return false;
  return /\.(t|j)sx?$|\.vue$|\.svelte$|\.css$|\.html$|\.py$/.test(p) || /(^|\/)package\.json$/.test(p) || /(^|\/)readme\.md$/i.test(p);
}

export interface GroundingSelection {
  candidates: string[];
  /** True → an overview/survey request: the caller should preserve anchor order (skip BM25 re-rank). */
  overview: boolean;
}

/**
 * Retrieval v2 entry point: choose WHICH files to read for grounding, intent-aware. See the block
 * comment above for the three signals. Pure + deterministic.
 */
export function selectGroundingCandidates(opts: {
  fileTree: readonly string[];
  prompt: string;
  contentHits?: readonly string[];
  imports?: Record<string, string[]>;
  cap?: number;
}): GroundingSelection {
  const tree = (opts.fileTree || []).filter(groundableFile);
  const cap = Math.max(1, opts.cap ?? 16);
  const overview = isOverviewRequest(opts.prompt);
  const anchors = structuralAnchors(tree, 8);
  const central = centralFiles(tree, opts.imports, 6);
  const hits = (opts.contentHits || []).filter(groundableFile);
  if (overview) {
    // Survey/structure: entry points + load-bearing files ARE the answer; filename overlap is noise.
    return { candidates: [...new Set([...anchors, ...central, ...hits])].slice(0, Math.min(cap, 12)), overview };
  }
  // Targeted request: content hits (strongest) → filename overlap (ONLY > 0 — never the tie bug) →
  // structural priors as backstop so a vague ask still grounds on the right skeleton.
  const qTokens = new Set(tokenize(opts.prompt));
  const pathRanked = tree
    .map((p) => ({ p, overlap: pathTokenize(p).filter((t) => qTokens.has(t)).length }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.p.localeCompare(b.p))
    .slice(0, 10)
    .map((x) => x.p);
  return { candidates: [...new Set([...hits, ...pathRanked, ...anchors.slice(0, 4), ...central.slice(0, 4)])].slice(0, cap), overview };
}

/**
 * Build a grounded, CITED context block from the top BM25-ranked workspace files for the query.
 * Returns '' when nothing is relevant. Pure (given the file map). The agent is told these are
 * grounding hints (read the file for the full content), each labelled with its source path:line.
 * `preserveOrder` (overview mode) keeps the caller's candidate order — anchors first — instead of
 * BM25, whose scores are meaningless for a survey-style query that matches no content terms.
 */
export function buildGroundedContext(files: Record<string, string>, query: string, topK = 3, opts?: { preserveOrder?: boolean }): string {
  const ranked = opts?.preserveOrder
    ? Object.keys(files).slice(0, Math.max(0, topK)).map((path) => ({ path, score: 1 }))
    : rankByBM25(files, query, topK);
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
