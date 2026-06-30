// AgentV3 — Workspace Memory & Artifact Intelligence (Phase 2).
//
// A per-workspace memory the agent builds from REAL activity, never synthetic:
//  - Artifact index / project graph: files → exported symbols, React components,
//    detected routes, import edges and external dependencies. Updated on every
//    real write/edit so the agent always has an accurate map of the codebase
//    (cat 22 — Project/Codebase/Symbol/Dependency graph).
//  - Episodic memory: build requests, errors hit and fixes applied — the raw
//    material for learning across a build (cat 24 — error/fix/project memory).
//  - Recall: phrase + per-token (multi-word) relevance search across symbols,
//    files and episodes, with a recency boost for episodes, so the agent can
//    answer "what components exist?", "where is X?", "what failed before?"
//    instead of re-scanning the whole tree.
//
// Per-workspace and in-process (registry mirrors WorkspaceRegistry). The legacy
// global `Memory/ProjectMemoryManager` writes a single shared file in cwd, which
// is unsafe for v3.0's multi-workspace/multi-user model — this replaces it for
// the v3.0 engine. A durable backend can swap the Map without changing callers.

import { scanSecurity, type SecurityFinding } from './SecurityAnalysis';
import { bm25, type Bm25Doc } from './Bm25';

// Words too generic to carry recall signal — dropped from the query token set so a
// multi-word query like "build the timer app" ranks on "timer"/"app", not on "the".
const RECALL_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'you',
  'are', 'was', 'has', 'have', 'will', 'would', 'should', 'can', 'use', 'using',
  'add', 'added', 'make', 'made', 'please', 'need', 'want', 'how', 'what', 'when',
]);

export type SymbolKind = 'function' | 'class' | 'const' | 'interface' | 'type' | 'enum' | 'component';

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  file: string;
}

export interface ProjectGraph {
  files: string[];
  symbols: SymbolInfo[];
  /** React/UI components (PascalCase exports in .tsx/.jsx). */
  components: string[];
  /** Detected route paths (router calls, <Route path>, `path:` entries). */
  routes: string[];
  /** file → the module specifiers it imports. */
  imports: Record<string, string[]>;
  /** External (bare) dependencies seen across imports. */
  dependencies: string[];
}

export type EpisodeKind = 'request' | 'error' | 'fix' | 'note' | 'audit';

export interface Episode {
  ts: number;
  kind: EpisodeKind;
  text: string;
  file?: string;
}

export interface MemorySnapshot {
  graph: ProjectGraph;
  episodes: Episode[];
}

export interface RecallHit {
  type: 'symbol' | 'file' | 'episode';
  ref: string;
  file?: string;
  detail?: string;
  score: number;
  /** Episode timestamp (ms) when this hit is backed by an episode — for recency/aging. */
  ts?: number;
}

/** Facts extracted from a single file — kept per-file so re-index/remove is clean. */
interface FileFacts {
  symbols: SymbolInfo[];
  components: string[];
  routes: string[];
  imports: string[];
  dependencies: string[];
  security: SecurityFinding[];
}

const MAX_EPISODES = 500;
const isCode = (f: string): boolean => /\.(t|j)sx?$/.test(f);
// A React component name is PascalCase: starts uppercase AND has a lowercase
// letter (so ALL_CAPS constants like PRIMARY are not mistaken for components).
const isComponentName = (n: string): boolean => /^[A-Z]/.test(n) && /[a-z]/.test(n);

/** External dependency root from a module specifier ('react-dom/client' → 'react-dom'; '@x/y/z' → '@x/y'). */
function depRoot(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/')) return null; // local import, not a dependency
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Extract real facts from a source file. Heuristic but grounded in the actual text. */
export function extractFacts(file: string, content: string): FileFacts {
  const symbols: SymbolInfo[] = [];
  const components: string[] = [];
  const imports: string[] = [];
  const depSet = new Set<string>();
  const routes = new Set<string>();

  if (isCode(file)) {
    const symRe = /export\s+(?:default\s+)?(?:async\s+)?(function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
    for (let m = symRe.exec(content); m; m = symRe.exec(content)) {
      const raw = m[1];
      const name = m[2];
      const kind: SymbolKind =
        raw === 'let' || raw === 'var' ? 'const' : (raw as SymbolKind);
      symbols.push({ name, kind, file });
      // A PascalCase export in a JSX file is treated as a UI component.
      if ((kind === 'const' || kind === 'function') && isComponentName(name) && /\.(t|j)sx$/.test(file)) {
        components.push(name);
      }
    }

    const importRe = /import\s+[^;]*?from\s+['"]([^'"]+)['"]/g;
    for (let m = importRe.exec(content); m; m = importRe.exec(content)) {
      imports.push(m[1]);
      const root = depRoot(m[1]);
      if (root) depSet.add(root);
    }
    const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (let m = requireRe.exec(content); m; m = requireRe.exec(content)) {
      imports.push(m[1]);
      const root = depRoot(m[1]);
      if (root) depSet.add(root);
    }

    // Routes: server route registrations, <Route path=...>, and `path: '...'`.
    const routePatterns = [
      /\b(?:app|router)\.(?:get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g,
      /<Route\s+[^>]*?path=['"]([^'"]+)['"]/g,
      /\bpath:\s*['"]([^'"]+)['"]/g,
    ];
    for (const re of routePatterns) {
      for (let m = re.exec(content); m; m = re.exec(content)) routes.add(m[1]);
    }
  }

  return {
    symbols,
    components: [...new Set(components)],
    routes: [...routes],
    imports: [...new Set(imports)],
    dependencies: [...depSet],
    // Security scanning runs on ALL files (secrets live in config/.env too).
    security: scanSecurity(file, content),
  };
}

export class WorkspaceMemory {
  private readonly fileFacts = new Map<string, FileFacts>();
  private readonly episodes: Episode[] = [];

  /** Index (or re-index) a file's content into the project graph. */
  indexFile(file: string, content: string): void {
    this.fileFacts.set(file, extractFacts(file, content));
  }

  /** Drop a deleted file from the graph. */
  removeFile(file: string): void {
    this.fileFacts.delete(file);
  }

  private episode(kind: EpisodeKind, text: string, file?: string): void {
    this.episodes.push({ ts: Date.now(), kind, text: text.slice(0, 2000), file });
    if (this.episodes.length > MAX_EPISODES) this.episodes.splice(0, this.episodes.length - MAX_EPISODES);
  }
  recordRequest(text: string): void { this.episode('request', text); }
  /** The user's most recent request texts (oldest→newest) — conversational context for intent. */
  recentRequests(limit = 3): string[] {
    return this.episodes.filter((e) => e.kind === 'request').slice(-Math.max(1, limit)).map((e) => e.text);
  }
  recordError(text: string, file?: string): void { this.episode('error', text, file); }
  recordFix(text: string, file?: string): void { this.episode('fix', text, file); }
  recordNote(text: string, file?: string): void { this.episode('note', text, file); }
  /** Governance decision-audit trail (Layer 58). Recorded but NOT fed back as a
   *  build "lesson" — it is a separate, queryable record of risky actions taken. */
  recordAudit(text: string, file?: string): void { this.episode('audit', text, file); }

  /** Aggregate the per-file facts into the project graph. */
  graph(): ProjectGraph {
    const files = [...this.fileFacts.keys()].sort();
    const symbols: SymbolInfo[] = [];
    const components = new Set<string>();
    const routes = new Set<string>();
    const imports: Record<string, string[]> = {};
    const deps = new Set<string>();
    for (const [file, facts] of this.fileFacts) {
      symbols.push(...facts.symbols);
      facts.components.forEach((c) => components.add(c));
      facts.routes.forEach((r) => routes.add(r));
      if (facts.imports.length) imports[file] = facts.imports;
      facts.dependencies.forEach((d) => deps.add(d));
    }
    return {
      files,
      symbols,
      components: [...components].sort(),
      routes: [...routes].sort(),
      imports,
      dependencies: [...deps].sort(),
    };
  }

  /** All security findings across the indexed files (cat 16). */
  securityFindings(): SecurityFinding[] {
    const out: SecurityFinding[] = [];
    for (const facts of this.fileFacts.values()) out.push(...facts.security);
    return out;
  }

  snapshot(): MemorySnapshot {
    return { graph: this.graph(), episodes: [...this.episodes] };
  }

  /**
   * Search symbols, files and episodes for a free-text query, best matches first.
   *
   * Relevance combines (a) whole-phrase match — exact > prefix > substring, which keeps the
   * old behaviour ("UserCard" → the UserCard symbol first) — with (b) BM25 token relevance over
   * the whole memory corpus, so a MULTI-WORD query like "countdown timer logic" finds an episode
   * "fixed the countdown timer", and a RARE discriminating token outranks a common one (a search
   * engine's ranking, not a flat per-token tally). Episodes additionally get a small RECENCY boost
   * (newer ranks above stale at equal relevance), deterministic and independent of wall-clock. A
   * hit with zero phrase- and token-relevance is never returned (recency alone can't surface an
   * unrelated note).
   */
  recall(query: string, limit = 10): RecallHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    // (a) Whole-phrase bonus — keeps the exact/prefix/substring guarantees recall always had.
    const phraseBonus = (text: string): number => {
      const t = text.toLowerCase();
      if (t === q) return 10;
      if (t.startsWith(q)) return 6;
      if (t.includes(q)) return 4;
      return 0;
    };

    // (b) BM25 token relevance over the FULL corpus (symbols + files + episodes). Building the
    // corpus once lets IDF weigh a rare token (e.g. "stripe") above a common one (e.g. "page").
    type Item = { hit: RecallHit; text: string };
    const items: Item[] = [];
    for (const { name, kind, file } of this.graph().symbols) {
      items.push({ hit: { type: 'symbol', ref: name, file, detail: kind, score: 0 }, text: name });
    }
    for (const file of this.fileFacts.keys()) {
      items.push({ hit: { type: 'file', ref: file, file, score: 0 }, text: file });
    }
    for (const e of this.episodes) {
      items.push({ hit: { type: 'episode', ref: e.text.slice(0, 120), file: e.file, detail: e.kind, score: 0, ts: e.ts }, text: e.text });
    }
    const docs: Bm25Doc[] = items.map((it, i) => ({ id: String(i), text: it.text }));
    const tokenScores = bm25(q, docs, { stopwords: RECALL_STOPWORDS });

    // Deterministic recency weight in [0, 0.9): newest episode ≈ 0.9, oldest ≈ 0. Computed from
    // the spread of episode timestamps in memory so it never depends on Date.now() (test-stable),
    // and is small enough to only break ties — it can't overtake a real token/phrase match.
    const tsList = this.episodes.map((e) => e.ts);
    const minTs = tsList.length ? Math.min(...tsList) : 0;
    const maxTs = tsList.length ? Math.max(...tsList) : 0;
    const span = maxTs - minTs;
    const recency = (ts: number): number => (span > 0 ? ((ts - minTs) / span) * 0.9 : 0);

    const hits: RecallHit[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const base = phraseBonus(it.text) + (tokenScores.get(String(i)) ?? 0);
      if (base <= 0) continue; // no phrase- or token-relevance → never surfaced (recency can't rescue it)
      const isEpisode = it.hit.type === 'episode';
      it.hit.score = isEpisode && typeof it.hit.ts === 'number' ? base + recency(it.hit.ts) : base;
      hits.push(it.hit);
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ── Level 5: reverse import graph ───────────────────────────────────────────

  /**
   * Resolve a relative import specifier against an importer's directory to a
   * normalised path without extension (best-effort — collapses ./ and ../).
   */
  private static resolveSpecifier(importerDir: string, spec: string): string {
    if (!spec.startsWith('.')) return spec;
    const parts = importerDir ? importerDir.split('/') : [];
    for (const seg of spec.replace(/\.[^./]+$/, '').split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  }

  /**
   * Files that directly import the given file (reverse dependency lookup).
   * Matching is performed by normalising relative specifiers against each
   * importer's directory and falling back to basename comparison for robustness.
   */
  reverseDeps(file: string): string[] {
    const fileNoExt = file.replace(/\.[^.]+$/, '');
    const basename = fileNoExt.split('/').pop() ?? '';
    const result: string[] = [];
    for (const [f, facts] of this.fileFacts) {
      if (f === file) continue;
      const fDir = f.split('/').slice(0, -1).join('/');
      for (const imp of facts.imports) {
        if (!imp.startsWith('.')) continue;
        const resolved = WorkspaceMemory.resolveSpecifier(fDir, imp);
        const impBasename = imp.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
        if (resolved === fileNoExt || impBasename === basename) {
          result.push(f);
          break;
        }
      }
    }
    return result;
  }

  /**
   * Full impact radius of changing a file: direct importers and their transitive
   * importers (BFS, depth-limited to 5 to avoid huge traversals). Useful for
   * showing the agent which files may be affected by an API change.
   */
  impactRadius(file: string): { direct: string[]; transitive: string[] } {
    const direct = this.reverseDeps(file);
    const visited = new Set<string>([file, ...direct]);
    const queue = [...direct];
    const transitive: string[] = [];
    let depth = 0;
    while (queue.length > 0 && depth < 5) {
      const next = queue.shift()!;
      const nextDeps = this.reverseDeps(next);
      for (const dep of nextDeps) {
        if (!visited.has(dep)) {
          visited.add(dep);
          transitive.push(dep);
          queue.push(dep);
        }
      }
      depth++;
    }
    return { direct, transitive };
  }

  /** A compact, human-readable map of the project for injecting into agent context. */
  projectMap(): string {
    const g = this.graph();
    if (g.files.length === 0 && this.episodes.length === 0) return '';
    const recentErrors = this.episodes.filter((e) => e.kind === 'error').slice(-3).map((e) => `  - ${e.text.slice(0, 100)}`);
    const lines = [
      `Project memory: ${g.files.length} files, ${g.symbols.length} symbols.`,
      g.components.length ? `Components: ${g.components.slice(0, 20).join(', ')}` : '',
      g.routes.length ? `Routes: ${g.routes.slice(0, 20).join(', ')}` : '',
      g.dependencies.length ? `Dependencies: ${g.dependencies.slice(0, 20).join(', ')}` : '',
      recentErrors.length ? `Recent errors:\n${recentErrors.join('\n')}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  }
}

// ── Per-workspace registry (in-process, TTL-pruned, like WorkspaceRegistry) ──
const memories = new Map<string, { mem: WorkspaceMemory; createdAt: number }>();
const TTL_MS = 2 * 60 * 60 * 1000;

function prune(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, v] of memories) if (v.createdAt < cutoff) memories.delete(id);
}

/** Get (or create) the memory for a workspace. */
export function getWorkspaceMemory(workspaceId: string): WorkspaceMemory {
  prune();
  let entry = memories.get(workspaceId);
  if (!entry) {
    entry = { mem: new WorkspaceMemory(), createdAt: Date.now() };
    memories.set(workspaceId, entry);
  }
  return entry.mem;
}

/** Test-only: clear the registry. */
export function _clearWorkspaceMemory(): void {
  memories.clear();
}

/**
 * Pre-index existing sandbox files into a workspace's project memory when the
 * in-memory graph is COLD — e.g. the server process restarted but the sandbox
 * files persisted, or an edit session resumes work that was built in another
 * process. This makes `recall` ("where is the login component?") and `evaluate`
 * (architecture / dependency analysis) work IMMEDIATELY on a resumed edit
 * session, instead of only after the agent has manually re-read files this turn.
 *
 * Cheap and best-effort by design:
 *  - only files NOT already in the graph are read (warm memory ⇒ zero reads),
 *  - only code files are indexed (that is what produces symbols/components/routes),
 *  - the file count and per-file size are capped,
 *  - any read error skips that file and never blocks the build.
 *
 * Returns the paths actually indexed (for logging/tests). Never throws.
 */
export async function warmIndexFiles(
  mem: WorkspaceMemory,
  fileTree: readonly string[],
  read: (path: string) => Promise<string>,
  opts: { maxFiles?: number; maxBytes?: number } = {},
): Promise<string[]> {
  const maxFiles = opts.maxFiles ?? 80;
  const maxBytes = opts.maxBytes ?? 200_000;
  const known = new Set(mem.graph().files);
  const targets = fileTree.filter((f) => isCode(f) && !known.has(f)).slice(0, maxFiles);
  const indexed: string[] = [];
  for (const file of targets) {
    try {
      const content = await read(file);
      if (typeof content !== 'string' || content.length > maxBytes) continue;
      mem.indexFile(file, content);
      indexed.push(file);
    } catch { /* unreadable file — skip, never block the build */ }
  }
  return indexed;
}
