// WHERE DID THE TEXT IN A MISSED EDIT COME FROM? (Q-2697 / Q-2917 / Q-2926, autopsies 9ed80cc9, aba63ead, a360bc2c)
//
// 🔴 THE CLASS. `edit_file` needs the model to quote the file's current text. On weak rungs it missed 8 times in
// 45 s (9ed80cc9), 4 times in #2475 and twice in #2466. Reading #2475's misses one by one, three were the SAME
// mistake in three costumes — the model quoted a version of the file that was not on disk:
//   · App.tsx at 268 s: text from BEFORE its own successful edit at 245 s;
//   · BattlegroundGame.tsx at 585 s: text from its own change that the syntax guard REJECTED at 577 s ("It was NOT
//     saved") — it was "fixing" a write that never happened;
//   · BattlegroundGame.tsx at 595 s: text from before a platform pass put the file back (the repair undo; Q-2913).
// The error said only "not found" plus the nearest region, so the model could not tell WHICH of its beliefs was
// wrong, and it guessed again. Each extra guess is a model turn and a typecheck.
//
// 🧬 THE FIX. The dispatcher remembers, per file, the last version the model READ and the last version it PROPOSED
// that was REFUSED. On a miss, `explainEditMiss` names the source of the quoted text in one sentence — so the next
// call quotes the right version on the first retry. A quote found in no version the model saw is named too: it was
// reconstructed from memory, and the region shown is what to copy. PURE apart from the in-memory map it is handed.

export type FileViewKind = 'read' | 'refused';

const MAX_VIEW_CHARS = 400_000;
const MIN_QUOTE_CHARS = 12;

/** Per-dispatcher memory of the file versions the model has seen. Bounded: big files are not kept. */
export class FileViews {
  private readonly read = new Map<string, string>();
  private readonly refused = new Map<string, string>();

  note(path: string, content: string, kind: FileViewKind): void {
    if (typeof content !== 'string' || content.length > MAX_VIEW_CHARS) return;
    (kind === 'read' ? this.read : this.refused).set(normPath(path), content);
  }

  lastRead(path: string): string | undefined { return this.read.get(normPath(path)); }
  lastRefused(path: string): string | undefined { return this.refused.get(normPath(path)); }
  /** A version that was written to disk is no longer a refused proposal. */
  clearRefused(path: string): void { this.refused.delete(normPath(path)); }
}

function normPath(p: string): string {
  return String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Does `haystack` contain the quote, verbatim or ignoring whitespace runs? */
function contains(haystack: string | undefined, quote: string): boolean {
  if (!haystack) return false;
  if (haystack.includes(quote)) return true;
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
  const q = squash(quote);
  return q.length >= MIN_QUOTE_CHARS && squash(haystack).includes(q);
}

/**
 * One sentence naming where the missed quote came from, or '' when nothing can be said. Checked in order of how
 * specific the answer is: a refused proposal, then a stale read, then "no version you saw". PURE.
 */
export function explainEditMiss(path: string, quote: string, current: string, views: FileViews | null | undefined): string {
  if (!views || typeof quote !== 'string' || quote.trim().length < MIN_QUOTE_CHARS) return '';
  if (contains(current, quote)) return '';
  if (contains(views.lastRefused(path), quote)) {
    return `WHY IT MISSED: that text comes from your earlier change to ${path} that was REFUSED and never saved — `
      + `the file on disk does not have it. Quote the CURRENT text shown below, not your refused version. `;
  }
  const seen = views.lastRead(path);
  if (seen !== undefined && seen !== current && contains(seen, quote)) {
    return `WHY IT MISSED: that text was in ${path} when you read it, but the file has changed since `
      + `(your own earlier edit, or a platform pass). Quote the CURRENT text shown below, not what you read before. `;
  }
  if (seen === undefined) {
    return `WHY IT MISSED: you have not read ${path} in this run, so that text was written from memory. `
      + `Quote the CURRENT text shown below. `;
  }
  return `WHY IT MISSED: that text is in no version of ${path} you have read in this run — it was reconstructed `
    + `from memory, not copied. Quote the CURRENT text shown below exactly. `;
}
