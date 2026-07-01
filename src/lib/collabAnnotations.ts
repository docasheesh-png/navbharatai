// P-DESIGN.7 — Real-time collaboration annotations (pure helpers).
//
// LiveCollaboration shares a single code buffer over Firestore. To add live cursors + line-anchored
// comments without a new dependency (no Yjs/CRDT — that would break the codebase's dependency-free
// policy; last-write-wins debounced sync is the intentional model), all the coordinate/record logic
// lives here as pure functions, unit-tested without a DOM. The component is a thin Firestore adapter
// over these.

export interface CommentAnnotation {
  id: string;
  line: number;
  text: string;
  authorId: string;
  authorName: string;
  color: string;
  timestamp: number;
  resolved: boolean;
}

/**
 * 1-based line number containing a caret offset within `text`. Clamps the offset into range so a
 * stale offset (buffer shrank under a remote edit) never returns a nonsense line. Pure.
 */
export function lineOfOffset(text: string, offset: number): number {
  if (!text) return 1;
  const clamped = Math.max(0, Math.min(text.length, Math.floor(Number.isFinite(offset) ? offset : 0)));
  let line = 1;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}

/** Total number of lines in a buffer (>= 1). Pure. */
export function lineCount(text: string): number {
  if (!text) return 1;
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

/**
 * The [start, end] character offsets of a 1-based line within `text` — used to select/scroll to a
 * line when a comment is clicked. `end` excludes the trailing newline. Pure.
 */
export function offsetRangeOfLine(text: string, line: number): [number, number] {
  if (!text) return [0, 0];
  const target = Math.max(1, Math.floor(line));
  let curLine = 1;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (curLine === target) break;
    if (text.charCodeAt(i) === 10) {
      curLine++;
      start = i + 1;
    }
  }
  if (curLine < target) return [text.length, text.length]; // line past the end
  let end = start;
  while (end < text.length && text.charCodeAt(end) !== 10) end++;
  return [start, end];
}

/** Build a normalised comment annotation record (clamps text/line, coerces types). Pure. */
export function buildAnnotation(input: {
  id: string;
  line: number;
  text: string;
  authorId: string;
  authorName?: string;
  color?: string;
  timestamp: number;
}): CommentAnnotation {
  return {
    id: String(input.id),
    line: Math.max(1, Math.floor(Number.isFinite(input.line) ? input.line : 1)),
    text: String(input.text ?? '').trim().slice(0, 2000),
    authorId: String(input.authorId ?? ''),
    authorName: String(input.authorName ?? 'User'),
    color: /^#[0-9a-fA-F]{3,8}$/.test(String(input.color)) ? String(input.color) : '#6366f1',
    timestamp: Number.isFinite(input.timestamp) && input.timestamp > 0 ? input.timestamp : 0,
    resolved: false,
  };
}

/** Sort annotations for display: unresolved first, then by line, then by time. Pure (returns a copy). */
export function sortAnnotations(list: CommentAnnotation[]): CommentAnnotation[] {
  return [...list].sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    if (a.line !== b.line) return a.line - b.line;
    return a.timestamp - b.timestamp;
  });
}
