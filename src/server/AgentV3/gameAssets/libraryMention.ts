// A LIBRARY PICK IS A MENTION, NOT A REPLACEMENT (admin 2026-11-26: "game library se koi character choose kiya jata hai, to
// woh character ka pura discription inputbox me aa jata hai, aur input box me jo bhi user ne pahle se likha hai, woh sab
// delete ho jata hai … bas us object ki id input box me us jagah likh jaye, jahan cursor hai").
//
// The composer now inserts a short mention where the cursor is — @character:<id>, @car:<id> or @model:<id> — and keeps
// everything the user typed. The build reads the mention here, once, before any other reader sees the request:
//   • a request that is ONLY mentions becomes the instruction each pick always meant (the same words as before: make this my
//     character / my car / add this model);
//   • a request with the user's own words keeps them, and each mention becomes the model's name with its exact library id
//     and its ROLE, so "@model:x ko gaon ke kuen ke paas rakho" is "the <name> (library id: "x") ko gaon ke kuen ke paas
//     rakho" — WHAT is named exactly, WHERE is the user's own words — and "aur @model:y ko enemy bot" names y as the look of
//     the enemies (build #2565), which the new-game asset seed and the enemies feature then read (libraryPicks.ts).
// An id the library does not hold is left as the user wrote it; the file-mention reader names it to the user. PURE (the
// lookup is injected; the default reads the reviewed catalogue).

import { addToGamePrompt, libraryBrowseRows, mapPlaceRows, useAsCharacterPrompt, type LibraryBrowseRow } from './libraryThumbnails';
import { useAsCarPrompt } from '../carSwap';
import { ENEMY_WORDS } from '../../lib/GameEnemiesFeature';
import { libraryIdPhrase, libraryMentionRe, type LibraryUse, type PickRole } from './libraryPicks';

export type { LibraryUse } from './libraryPicks';

/** The text the composer inserts at the cursor for a pick. PURE. */
export function libraryMentionToken(use: LibraryUse, id: string): string {
  return `@${use}:${id}`;
}

// 🔴 BUILD #2565 (2026-11-27): THE LOOKUP SEARCHED NAMES FOR AN ID. It was `browseLibrary({ q: id })` — the screen's search,
// which matches a row's NAME, subjects and category, never its id — so "lib12-young-man" looked for the words "lib12",
// "young" and "man" in the name "Young Man" and found nothing. 1,021 of the library's 1,022 rows could not be found by their
// own id, so every pick fell through unread and the user was told the picks were missing project files. An id is looked up
// as an id: one exact map over every row the screen can show (models and map places).
let byId: Map<string, Pick<LibraryBrowseRow, 'id' | 'name'>> | null = null;
/** The library row with this exact id (a model or a map place), or null. */
export function libraryRowById(id: string): Pick<LibraryBrowseRow, 'id' | 'name'> | null {
  if (!byId) {
    const map = new Map<string, Pick<LibraryBrowseRow, 'id' | 'name'>>();
    for (const r of [...mapPlaceRows(), ...libraryBrowseRows(undefined, () => false)]) if (!map.has(r.id)) map.set(r.id, { id: r.id, name: r.name });
    byId = map;
  }
  return byId.get(String(id ?? '')) ?? null;
}

/** The instruction one pick always meant, for a request that is only that pick. */
function wholeInstruction(use: LibraryUse, row: Pick<LibraryBrowseRow, 'id' | 'name'>): string | null {
  return use === 'character' ? useAsCharacterPrompt(row) : use === 'car' ? useAsCarPrompt(row) : addToGamePrompt(row);
}

/** Where one clause of a request ends: punctuation, a new line, or a joining word. */
const CLAUSE_END = /[\n.!?,;|]|\b(?:aur|and|or|ya|but|lekin|phir|then)\b/gi;
const PLAYER_WORDS = /\b(?:hero|heroine|player|khiladi|character|charecter|charactor)\b|हीरो|खिलाड़ी/i;

/**
 * What a pick is FOR. A `@character:` pick is the player and a `@car:` pick the car — that is what the screen's mode said.
 * A `@model:` pick is read from its OWN clause only: "aur @model:x ko enemy bot" → the look of the enemies; "hero @model:x
 * ho" → the player. Both kinds of word, or neither → just a model: nothing is guessed. PURE.
 */
export function pickRole(text: string, at: number, length: number, use: LibraryUse): PickRole {
  if (use === 'character') return 'player';
  if (use === 'car') return 'car';
  const head = text.slice(0, at);
  let start = 0;
  for (const m of head.matchAll(CLAUSE_END)) start = (m.index ?? 0) + m[0].length;
  const tail = text.slice(at + length);
  const stops = [tail.search(new RegExp(CLAUSE_END.source, 'i')), tail.search(libraryMentionRe())].filter((n) => n >= 0);
  const clause = `${head.slice(start).replace(libraryMentionRe(), ' ')} ${tail.slice(0, stops.length ? Math.min(...stops) : tail.length)}`;
  const enemy = ENEMY_WORDS.test(clause);
  const player = PLAYER_WORDS.test(clause);
  return enemy && !player ? 'enemy' : player && !enemy ? 'player' : 'model';
}

/** How a mention reads inside the user's own sentence. */
function inlineName(role: PickRole, row: Pick<LibraryBrowseRow, 'id' | 'name'>): string {
  return `the ${row.name} from the NavBharatAI library ${libraryIdPhrase(row.id, role)}`;
}

/** The request with every library mention read. PURE given `lookup`. Never throws. */
export function expandLibraryMentions(prompt: string, lookup: (id: string) => Pick<LibraryBrowseRow, 'id' | 'name'> | null = libraryRowById): string {
  const text = String(prompt ?? '');
  if (!text.includes('@')) return text;
  const found: Array<{ use: LibraryUse; row: Pick<LibraryBrowseRow, 'id' | 'name'> }> = [];
  const replaced = text.replace(libraryMentionRe(), (whole: string, use: string, id: string, offset: number) => {
    let row: Pick<LibraryBrowseRow, 'id' | 'name'> | null = null;
    try { row = lookup(id); } catch { row = null; }
    if (!row) return whole;
    const u = use.toLowerCase() as LibraryUse;
    found.push({ use: u, row });
    return inlineName(pickRole(text, offset, whole.length, u), row);
  });
  if (found.length === 0) return text;
  // Only the picks, nothing of the user's own: each pick's full instruction, as it always was.
  // An id the library does not hold is the user's own text here: it stays, so it is never dropped without a word.
  const rest = text.replace(libraryMentionRe(), (whole: string, _use: string, id: string) => (found.some((f) => f.row.id === id) ? '' : whole)).replace(/[\s,.;&+]|and|aur/gi, '');
  if (!rest) return found.map((f) => wholeInstruction(f.use, f.row) ?? inlineName(f.use === 'character' ? 'player' : f.use === 'car' ? 'car' : 'model', f.row)).join('\n');
  return replaced;
}
