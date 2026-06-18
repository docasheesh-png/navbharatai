/**
 * Phase 7 — Whole-project context retrieval.
 *
 * Problem: the old approach dumped the first 20 files × 1000 chars into every
 * prompt — blind on any real project with 60+ files. This module replaces that
 * with relevance-ranked, budget-capped selection so the agent always sees the
 * files that actually matter for the current task.
 *
 * Strategy (no embeddings, no extra API key):
 *   1. Extract search terms from instruction + recent observations.
 *   2. grep -rl inside the sandbox to find files containing those terms.
 *   3. Rank: recently-edited > grep-matched > config/entry files > rest.
 *   4. Pack file contents into a char budget, capping per file.
 *   5. Always show the full file-tree (paths only) so the agent knows the shape.
 */

const CONTEXT_BUDGET = 14_000;    // total chars of file content per prompt
const MAX_CHARS_PER_FILE = 3_000; // hard cap per single file
const MAX_FILES_TO_READ = 30;     // never read more than this many files per step
const MAX_TERMS = 8;

/** Entry files and config that are always worth including if budget allows. */
const ALWAYS_RELEVANT = [
  'package.json', 'tsconfig.json', 'vite.config', 'tailwind.config',
  'index.html', 'main.tsx', 'main.ts', 'App.tsx', 'App.ts',
  'index.ts', 'index.tsx', 'server.ts', 'index.js',
];

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can',
  'that', 'this', 'it', 'they', 'we', 'you', 'my', 'our', 'its',
  'please', 'make', 'create', 'build', 'add', 'fix', 'update', 'change',
  'file', 'code', 'app', 'page', 'component', 'function', 'class', 'just',
  'need', 'want', 'also', 'then', 'when', 'here', 'there', 'what', 'how',
  'step', 'task', 'like', 'from', 'into', 'about', 'after', 'before',
]);

/**
 * Extract meaningful grep terms from the task instruction and recent observations.
 * Returns up to MAX_TERMS deduplicated strings.
 */
export function extractSearchTerms(instruction: string, recentObservations: string[]): string[] {
  const combined = [instruction, ...recentObservations.slice(-4)].join(' ');

  // Identifiers: words with uppercase or underscore (component/function names, file names)
  const identifiers = combined
    .split(/[\s,;:'"()\[\]{}<>!?=+\-*/\\]+/)
    .filter(w => w.length >= 3 && /[A-Z_]/.test(w))
    .map(w => w.replace(/[^a-zA-Z0-9_.$]/g, ''))
    .filter(Boolean);

  // General keywords: lowercase words 4+ chars, not stop words
  const keywords = combined
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 4 && !STOP_WORDS.has(w));

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const w of [...identifiers, ...keywords]) {
    if (w.length < 3 || seen.has(w)) continue;
    seen.add(w);
    terms.push(w);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

/**
 * Rank all workspace files by relevance to the current task.
 * Returns the full list sorted by score (highest first).
 */
export function rankFiles(
  allFiles: string[],
  matchedFiles: string[],   // from grep searchFiles()
  recentlyEdited: string[], // files edited in recent history steps
): string[] {
  const score = new Map<string, number>();
  for (const f of allFiles) score.set(f, 0);

  // Recently edited: highest priority — agent was just working on these
  for (const f of recentlyEdited) score.set(f, (score.get(f) ?? 0) + 4);

  // Grep matches: high priority — contain the search terms
  for (const f of matchedFiles) score.set(f, (score.get(f) ?? 0) + 2);

  // Entry/config files: small boost — always good context
  for (const f of allFiles) {
    if (ALWAYS_RELEVANT.some(pat => f === pat || f.endsWith(`/${pat}`) || f.includes(pat))) {
      score.set(f, (score.get(f) ?? 0) + 1);
    }
  }

  return [...allFiles].sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
}

/**
 * Pack the top-ranked files into sections, respecting the char budget.
 * Returns ready-to-embed prompt sections and the overall file tree string.
 */
export function buildFileTree(allFiles: string[]): string {
  return allFiles.join('\n');
}

/**
 * Synchronously pack file contents (caller provides pre-read content map).
 * This is called after the async reads happen in EngineerAgentLoop.buildPrompt().
 */
export function packFileSections(
  rankedFiles: string[],
  contentMap: Map<string, string>,
  budget = CONTEXT_BUDGET,
  maxPerFile = MAX_CHARS_PER_FILE,
  maxFiles = MAX_FILES_TO_READ,
): string[] {
  const sections: string[] = [];
  let remaining = budget;
  let count = 0;

  for (const filePath of rankedFiles) {
    if (remaining <= 0 || count >= maxFiles) break;
    const raw = contentMap.get(filePath);
    if (raw === undefined) {
      sections.push(`--- ${filePath} --- (unreadable)`);
      count++;
      continue;
    }
    const cap = Math.min(maxPerFile, remaining);
    const slice = raw.slice(0, cap);
    const truncated = raw.length > cap;
    sections.push(`--- ${filePath}${truncated ? ' (truncated)' : ''} ---\n${slice}`);
    remaining -= slice.length;
    count++;
  }
  return sections;
}
