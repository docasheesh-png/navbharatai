// THE ONE SPELLING OF A GAME LIBRARY PICK, written once and read everywhere (build #2565, 2026-11-27).
//
// A pick travels through the build in two shapes:
//   1. what the composer inserts at the cursor — `@character:<id>`, `@car:<id>`, `@model:<id>` (GameLibraryPicker.tsx);
//   2. what the build reads it into — `the <name> from the NavBharatAI library (library id: "<id>")`, followed by the ROLE
//      the user gave it: their player, the look of the enemies, the car they drive, or just a model (libraryMention.ts).
// Every reader (the file-mention parser, the new-game asset seed, the enemies feature) reads those shapes through THIS file,
// so a writer and a reader can never drift apart. Build #2565 lost both of its picks to exactly that kind of gap: the
// expander looked an id up by its display name, found nothing, left `@character:…` and `@model:…` in the request, and the
// file-mention parser — which knew nothing of library picks — told the user "I could not find these in this project:
// @character, @model". PURE: no imports.

/** Every kind the composer can insert. A new picker mode must be added here, or tests/libraryMentionsResolve.test.ts fails. */
export const LIBRARY_USES = ['character', 'car', 'model'] as const;
export type LibraryUse = typeof LIBRARY_USES[number];

const ID = '[a-z0-9][a-z0-9._:-]{0,160}';
/** `@character:<id>` / `@car:<id>` / `@model:<id>` — a fresh global regex each call (it is stateful). */
export function libraryMentionRe(): RegExp {
  return new RegExp(`@(${LIBRARY_USES.join('|')}):(${ID})`, 'gi');
}
/** The same token, anchored at the start of `text` (for a reader that already stands on the `@`). */
export function libraryMentionAt(text: string): { use: LibraryUse; id: string; length: number } | null {
  const m = new RegExp(`^@(${LIBRARY_USES.join('|')}):(${ID})`, 'i').exec(text);
  if (!m) return null;
  return { use: m[1].toLowerCase() as LibraryUse, id: m[2], length: m[0].length };
}

/** What a pick is FOR in the user's request. */
export type PickRole = 'player' | 'enemy' | 'car' | 'model';

/** The words written after `(library id: "…")` for each role. Readers match these exactly. */
export const PICK_ROLE_MARK: Readonly<Record<PickRole, string>> = Object.freeze({
  player: '(as my player character)',
  enemy: '(worn by the hostile characters)',
  car: '(as the car I drive)',
  model: '',
});

/** `(library id: "<id>")` and its role mark — the inline shape of one pick. PURE. */
export function libraryIdPhrase(id: string, role: PickRole): string {
  const mark = PICK_ROLE_MARK[role];
  return `(library id: "${id}")${mark ? ` ${mark}` : ''}`;
}

const ROLE_BY_MARK = new Map<string, PickRole>((Object.entries(PICK_ROLE_MARK) as Array<[PickRole, string]>).filter(([, m]) => m).map(([r, m]) => [m, r]));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PHRASE_RE = new RegExp(`\\(library id: "([^"\\n]{1,160})"\\)(?: (${[...ROLE_BY_MARK.keys()].map(escape).join('|')}))?`, 'g');

/**
 * Every library pick a (read) request names, in order, deduped by id+role. The role comes from the mark after the id, or —
 * for the whole instructions the library screen has always sent — from the words just before it ("…my game's player
 * character (library id: …)", "…the car I drive in my racing game (library id: …)"). PURE.
 */
export function libraryPicksIn(text: string | null | undefined): Array<{ id: string; role: PickRole }> {
  const s = String(text ?? '');
  const out: Array<{ id: string; role: PickRole }> = [];
  for (const m of s.matchAll(PHRASE_RE)) {
    const before = s.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
    const role: PickRole = m[2] ? ROLE_BY_MARK.get(m[2])!
      : /player character $/.test(before) ? 'player'
        : /car I drive in my racing game $/.test(before) ? 'car'
          : 'model';
    if (!out.some((p) => p.id === m[1] && p.role === role)) out.push({ id: m[1], role });
  }
  return out;
}
