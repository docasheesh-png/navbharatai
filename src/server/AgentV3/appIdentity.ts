// THE GUARD FOR THE WHOLE CLASS: a stored answer must still be ABOUT the app that is here now.
//
// 🔒 WHY THIS EXISTS (admin 2026-08-25: "jo bola tha wahi guard banao, par apne engineering soch laga
// ke"). Seven bugs in two days shared one shape — a stored answer describing an app, read later while
// looking at a DIFFERENT app:
//
//   #2658  the live URL, the publish message, the publish state, the first-publish celebration
//   #2662  the preview recipe's port, the previous app's dev server, the framework badge
//
// The worst of them told the admin their UPI API build had produced a piano.
//
// ⚠️ MY OWN FIRST DESIGN WAS WRONG, and recording that is the point of this comment. PROGRESS.md
// proposed "stamp every record with the buildId and discard on mismatch". That would have been a
// cure worse than the disease: buildId changes on EVERY build, so a single one-line edit to an app
// would throw away its live URL, its preview recipe and its publish state — the engine would forget
// a working app because the user fixed a typo in it.
//
// The mistake was confusing "this app CHANGED" with "this is a DIFFERENT app". Editing a component
// changes an app; it does not replace it. So the fingerprint must be taken of the app's SHAPE — what
// kind of thing it is and how it runs — not of its content:
//
//     framework   vite-react → node-express     a different app
//     devCommand  npm run dev → npm run server:dev   a different app
//     port        5173 → 3000                   a different app
//     any source file edited                    the SAME app
//
// Every one of those three would have caught the piano. None of them fires on an ordinary edit.
//
// 🔒 THE SAFETY RULE, WHICH MATTERS MORE THAN THE DETECTION: **silence is never a conflict.** A field
// we do not know cannot disagree with anything. If this module discarded records whenever it was
// unsure, every preview whose framework we failed to read would lose its proven revival recipe and
// fall back to guessing — turning a rare wrong-app bug into a common slow-preview bug for everybody.
// It reports a conflict ONLY on positive evidence that two known values disagree. That is why it is
// safe to put on a hot read path, and why turning it on cannot make anything worse than today.

/**
 * What KIND of app this is, and how it runs. Every field is optional because every field is
 * genuinely unknowable sometimes — and an unknown field is silence, not disagreement.
 */
export interface AppShape {
  /** The framework id (vite-react, node-express, …) — the coarsest and most decisive signal. */
  framework?: string | null;
  /** The command that starts its dev server. */
  devCommand?: string | null;
  /** The port it serves on. */
  port?: number | null;
}

/** Which field proved the two shapes describe different apps. `''` when nothing did. */
export type ShapeConflict = '' | 'framework' | 'devCommand' | 'port';

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const knownPort = (p: unknown): p is number =>
  typeof p === 'number' && Number.isInteger(p) && p > 0 && p < 65536;

/**
 * Do these two shapes positively disagree? PURE.
 *
 * Returns the FIRST field that proves it, in decreasing order of authority — framework is a stronger
 * statement than a port number, and naming the strongest evidence makes the report line honest rather
 * than incidental.
 *
 * 🔒 Two values must BOTH be known to disagree. `{framework:'x'}` vs `{}` is not a conflict; it is one
 * fact and one silence.
 */
export function shapeConflict(stored: AppShape | null | undefined, current: AppShape | null | undefined): ShapeConflict {
  if (!stored || !current) return '';
  const a = norm(stored.framework);
  const b = norm(current.framework);
  if (a && b && a !== b) return 'framework';
  const c = norm(stored.devCommand);
  const d = norm(current.devCommand);
  if (c && d && c !== d) return 'devCommand';
  if (knownPort(stored.port) && knownPort(current.port) && stored.port !== current.port) return 'port';
  return '';
}

/**
 * May a stored answer about an app still be trusted?
 *
 * The one question every reader in this class forgot to ask. Written as a function so a reader cannot
 * forget by omission — using the stored value now means calling this, and the compiler makes the
 * `current` shape a required argument, so there is no way to read the record without stating what you
 * are comparing it against.
 */
export function stillDescribes(stored: AppShape | null | undefined, current: AppShape | null | undefined): boolean {
  return shapeConflict(stored, current) === '';
}

/**
 * Read a stored value only if it still describes the current app — otherwise `null`. PURE.
 *
 * 🔑 THIS IS THE ACTUAL GUARD. The seven bugs were all a reader trusting `record.value` directly. A
 * reader that goes through here CANNOT do that: the value is only reachable by supplying the shape it
 * must match. Forgetting becomes a type error rather than a wrong answer on somebody's screen.
 */
export function readIfCurrent<T>(
  record: { shape?: AppShape | null; value: T } | null | undefined,
  current: AppShape | null | undefined,
): T | null {
  if (!record) return null;
  return stillDescribes(record.shape, current) ? record.value : null;
}

/**
 * The honest sentence for a discarded record — names the evidence, never just "stale".
 *
 * `subject` is what was discarded in the user's terms ("the saved preview settings"), so the line
 * reads as an explanation rather than an internal log leaking onto a screen.
 */
export function conflictNote(conflict: ShapeConflict, subject: string, stored: AppShape, current: AppShape): string {
  if (!conflict) return '';
  const was = conflict === 'port' ? String(stored.port) : String(stored[conflict] ?? '');
  const now = conflict === 'port' ? String(current.port) : String(current[conflict] ?? '');
  const what = conflict === 'devCommand' ? 'start command' : conflict;
  return `${subject} described a different app (${what} was "${was}", it is now "${now}") — it was set aside `
    + 'so nothing from the previous app can be shown for this one.';
}
