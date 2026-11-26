// A LIBRARY PICK IS A MENTION, NOT A REPLACEMENT (admin 2026-11-26: "game library se koi character choose kiya jata hai, to
// woh character ka pura discription inputbox me aa jata hai, aur input box me jo bhi user ne pahle se likha hai, woh sab
// delete ho jata hai … bas us object ki id input box me us jagah likh jaye, jahan cursor hai").
//
// The composer now inserts a short mention where the cursor is — @character:<id>, @car:<id> or @model:<id> — and keeps
// everything the user typed. The build reads the mention here, once, before any other reader sees the request:
//   • a request that is ONLY mentions becomes the instruction each pick always meant (the same words as before: make this my
//     character / my car / add this model);
//   • a request with the user's own words keeps them, and each mention becomes the model's name with its exact library id,
//     so "@model:x ko gaon ke kuen ke paas rakho" is "the <name> (library id: "x") ko gaon ke kuen ke paas rakho" — WHAT is
//     named exactly, WHERE is the user's own words.
// An id the library does not hold is left as the user wrote it. PURE (the lookup is injected; the default reads the
// reviewed catalogue).

import { addToGamePrompt, browseLibrary, useAsCharacterPrompt, type LibraryBrowseRow } from './libraryThumbnails';
import { useAsCarPrompt } from '../carSwap';

export type LibraryUse = 'character' | 'car' | 'model';
const MENTION = /@(character|car|model):([a-z0-9][a-z0-9._:-]{0,160})/gi;

/** The text the composer inserts at the cursor for a pick. PURE. */
export function libraryMentionToken(use: LibraryUse, id: string): string {
  return `@${use}:${id}`;
}

/** The library row with this exact id, or null. */
export function libraryRowById(id: string): Pick<LibraryBrowseRow, 'id' | 'name'> | null {
  const { rows } = browseLibrary({ q: id, limit: 50 });
  return rows.find((r) => r.id === id) ?? null;
}

/** The instruction one pick always meant, for a request that is only that pick. */
function wholeInstruction(use: LibraryUse, row: Pick<LibraryBrowseRow, 'id' | 'name'>): string | null {
  return use === 'character' ? useAsCharacterPrompt(row) : use === 'car' ? useAsCarPrompt(row) : addToGamePrompt(row);
}

/** How a mention reads inside the user's own sentence. */
function inlineName(use: LibraryUse, row: Pick<LibraryBrowseRow, 'id' | 'name'>): string {
  const what = use === 'character' ? ' (as my player character)' : use === 'car' ? ' (as the car I drive)' : '';
  return `the ${row.name} from the NavBharatAI library (library id: "${row.id}")${what}`;
}

/** The request with every library mention read. PURE given `lookup`. Never throws. */
export function expandLibraryMentions(prompt: string, lookup: (id: string) => Pick<LibraryBrowseRow, 'id' | 'name'> | null = libraryRowById): string {
  const text = String(prompt ?? '');
  if (!text.includes('@')) return text;
  const found: Array<{ use: LibraryUse; row: Pick<LibraryBrowseRow, 'id' | 'name'> }> = [];
  const replaced = text.replace(MENTION, (whole, use: string, id: string) => {
    let row: Pick<LibraryBrowseRow, 'id' | 'name'> | null = null;
    try { row = lookup(id); } catch { row = null; }
    if (!row) return whole;
    const u = use.toLowerCase() as LibraryUse;
    found.push({ use: u, row });
    return inlineName(u, row);
  });
  if (found.length === 0) return text;
  // Only the picks, nothing of the user's own: each pick's full instruction, as it always was.
  const rest = text.replace(MENTION, '').replace(/[\s,.;&+]|and|aur/gi, '');
  if (!rest) return found.map((f) => wholeInstruction(f.use, f.row) ?? inlineName(f.use, f.row)).join('\n');
  return replaced;
}
