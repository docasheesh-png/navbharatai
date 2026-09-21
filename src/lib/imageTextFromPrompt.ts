// The prompt already said it — so stop making the user type it twice.
//
// Somebody asks for *"Sharma Sweets ka banner, phone 98765 43210"*. Today that sentence goes to the
// image engine, which cannot write a phone number, AND the user then types the same number again into
// the overlay. Both halves are avoidable: the number is right there in what they wrote.
//
// 🔑 PRECISION FIRST, AND THE ASYMMETRY IS THE WHOLE DESIGN. A missed phone number costs one manual
// retype — exactly today's cost, so a miss is free. A WRONG guess pre-fills junk onto somebody's
// banner that they have to notice and delete, and the one they are most likely not to notice is a
// number that is nearly right. So every rule below refuses unless it is sure, and "not sure" always
// means extract nothing.
//
// ⚠️ IT DECIDES NOTHING. This module only SUGGESTS what to put in the overlay; nothing here changes
// the picture, the price, or what the engine is asked for. The user sees the suggestion in an editable
// box before anything is drawn.

import { MAX_TEXT_CHARS, defaultLayer, type TextLayer } from './textOverlay';
import { normalizePhone } from './phoneNumber';
import { requestedText } from '../server/lib/imagePromptCraft';

/** One piece of text found in the prompt, and what kind of thing it is. */
export interface ExtractedText {
  /** `name` and `phone` and `address` become caption layers; `list` becomes a rate-card layer. */
  kind: 'name' | 'phone' | 'address' | 'list';
  /** Exactly as the user wrote it — never normalised. A banner shows `98765 43210`, not `+919876543210`. */
  text: string;
}

/**
 * An Indian phone number as people actually type one into a sentence.
 *
 * Mobile numbers here start 6–9 and run ten digits, optionally behind `+91`, `91` or a `0`, and are
 * usually broken once for readability (`98765 43210`, `98765-43210`). The boundaries are explicit
 * rather than `\b`, because `\b` sits happily in the middle of a longer digit run and would pull ten
 * digits out of a twelve-digit order number.
 */
const PHONE_RE = /(?<![\d])(?:(?:\+?91[\s-]?)|0)?([6-9]\d{4})[\s-]?(\d{5})(?![\d])/g;

/** A six-digit Indian PIN code — the one part of an address that is unambiguous. */
const PIN_RE = /(?<![\d])[1-9]\d{5}(?![\d])/;

/**
 * Words that mark a piece of an Indian address.
 *
 * Deliberately places, not adjectives: every one of these is a noun that appears in a real address and
 * essentially nowhere else in a request for a picture. "Market" is the loosest and still earns its
 * place — a prompt saying "market" without an address around it will not also carry a PIN or a
 * house-number pattern, and the rule below needs two signals, not one.
 */
const ADDRESS_MARKERS = /\b(?:shop|dukan|plot|near|opp|opposite|road|rd|marg|gali|nagar|colony|sector|market|bazaar|chowk|vihar|puram|layout|cross|main|street|floor|block|behind)\b/i;

/** "address:" / "pata:" — an explicit label, which is the strongest signal there is. */
const ADDRESS_LABEL = /(?:address|pata|पता)\s*[:\-–]\s*([^\n]{4,120})/i;

/** A rate-card row: something, then a price at the end. Mirrors `parseListRow`'s anchor-at-the-end rule. */
const PRICED_ROW = /^\s*(.{1,40}?)[\s.·]*(?:₹|rs\.?|inr)?\s*\d+(?:[.,]\d+)?\s*(?:\/?-)?\s*$/i;

/** The most rows a suggestion may carry, matching what the list layer will actually draw. */
const MAX_ROWS = 20;

function unique(items: ExtractedText[]): ExtractedText[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = `${i.kind}:${i.text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Every phone number in the prompt, as written.
 *
 * Each candidate is confirmed by `normalizePhone` — this repo's existing answer to "could this be
 * dialled" — rather than by a second opinion invented here. A number the auth path would reject is
 * not a number worth printing on a shop board.
 */
export function findPhones(prompt: string): string[] {
  const out: string[] = [];
  for (const m of String(prompt ?? '').matchAll(PHONE_RE)) {
    const asWritten = m[0].trim();
    if (!normalizePhone(`${m[1]}${m[2]}`)) continue;
    out.push(asWritten);
  }
  return out;
}

/**
 * An address, or ''.
 *
 * Two ways in, and nothing else. An explicit `address:` label is taken at its word. Otherwise a
 * clause must carry BOTH a place marker AND a PIN code — two independent signals, because either
 * alone is a sentence a normal prompt could contain by accident ("a market scene", "poster 110011").
 */
export function findAddress(prompt: string): string {
  const text = String(prompt ?? '');
  const labelled = ADDRESS_LABEL.exec(text);
  // ⚠️ An `address:` label runs to the end of the line, and people write the phone right after it.
  // Left in, the address layer would carry "…Kanpur 208001, phone +91 98765-43210" as one blob — and
  // the phone would then be skipped as a duplicate, so the user would lose the separate, bigger
  // number a shop board actually wants. Cut at the phone; the phone rule picks it up on its own.
  if (labelled) return trimTrailing(labelled[1].split(/[,;]?\s*(?:phone|mobile|mob|call|contact|ph|\u092b\u093c\u094b\u0928)\b/i)[0]);

  // 🔴 SPLIT ON COMMAS AND THE ADDRESS DIES: "Shop 5, Rajouri Market, Delhi 110027" becomes three
  // pieces of which none carries BOTH signals — "Rajouri Market" has the marker, "Delhi 110027" has
  // the PIN. An address is the comma-joined whole, so the LINE is what gets tested.
  //
  // Then the SPAN is cut from the first marker word to the end of the PIN, which is what keeps the
  // surrounding sentence out: "make a poster for my shop, Shop 5, Rajouri Market, Delhi 110027, very
  // colourful" yields the address and neither the request nor the adjective.
  for (const line of text.split(/[\n;]/)) {
    const pin = PIN_RE.exec(line);
    if (!pin || !ADDRESS_MARKERS.test(line)) continue;
    const end = pin.index + pin[0].length;
    const start = addressStart(line.slice(0, end));
    if (start < 0) continue;
    const span = line.slice(start, end);
    if (span.length < 6 || span.length > 120) continue;
    return trimTrailing(span);
  }
  return '';
}

/**
 * Where the address really begins inside a longer sentence.
 *
 * 🔴 THE FIRST MARKER IS THE WRONG ANSWER, and the miss is a common sentence: in "make a poster for
 * my shop, Shop 5, Rajouri Market, Delhi 110027" the first "shop" is the user talking ABOUT their
 * shop, so starting there yields "shop, Shop 5, …" — the leading junk this module exists to avoid.
 * The LAST marker is wrong too: it would start at "Market" and throw the house number away.
 *
 * An address COMPONENT is a marker followed by its own identifier — "Shop 5", "Plot 12", "Near ABC" —
 * with no comma between, which is exactly what "my shop," is not. So: the earliest marker of that
 * shape, and only if there is none, the first marker at all.
 */
function addressStart(upToPin: string): number {
  const re = new RegExp(ADDRESS_MARKERS.source, 'gi');
  let first = -1;
  for (const m of upToPin.matchAll(re)) {
    if (first < 0) first = m.index ?? -1;
    const after = upToPin.slice((m.index ?? 0) + m[0].length);
    if (/^\s+(?:\d|[A-Z\u0900-\u097F])/.test(after)) return widenLeft(upToPin, m.index ?? 0);
  }
  return first < 0 ? first : widenLeft(upToPin, first);
}

/**
 * Pull the start back over the proper noun a marker belongs to.
 *
 * "Rajouri Market" is one place, so beginning at "Market" throws half its name away. A CAPITALISED
 * word sitting directly before the marker, with no comma between them, is part of it. The comma is
 * what keeps "…for my shop, Shop 5" out: a comma means a new clause, not a longer place name — and
 * lower case keeps ordinary prose out ("the busy Market").
 */
function widenLeft(line: string, index: number): number {
  let start = index;
  for (let guard = 0; guard < 4; guard++) {
    const before = line.slice(0, start);
    const m = /([A-Z\u0900-\u097F][\w\u0900-\u097F]*)\s+$/.exec(before);
    if (!m) break;
    start = before.length - m[0].length;
  }
  return start;
}

/** Drop the punctuation a clause ends up carrying when it is cut out of a sentence. */
function trimTrailing(s: string): string {
  return s.trim().replace(/[,;.\s\u2013-]+$/, '').trim();
}

/**
 * A rate card, or ''.
 *
 * 🔴 TWO WAYS IN, AND COMMA-SPLITTING ARBITRARY PROSE IS NOT ONE OF THEM. The first draft split the
 * WHOLE prompt on commas and called any fragment ending in digits a priced row — so
 * *"address: Shop 12, Nehru Market, Kanpur 208001, phone +91 98765-43210"* came back as a three-item
 * menu selling "Shop" for ₹12 and "Kanpur" for ₹208001. An address is the single most likely thing to
 * sit next to a shop name, so that false positive would have been the common case, not the rare one.
 *
 * So: either the user LABELLED it (`rate list:`, `menu:`, `daam:`) — in which case commas inside that
 * section are rows, because that is how a menu gets typed on one line — or they typed the rows on
 * separate LINES, which is itself the declaration. Prose with numbers in it is neither.
 *
 * Two rows minimum either way: one is just a sentence with a number in it.
 */
export function findRateList(prompt: string): string {
  const text = String(prompt ?? '');
  const labelled = /(?:rate\s*list|price\s*list|menu|daam|bhav|\u0926\u093e\u092e|\u0930\u0947\u091f)\s*[:\-\u2013]\s*([\s\S]{4,400})/i.exec(text);

  const rowsIn = (body: string, separators: RegExp) => body
    .split(separators)
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && PRICED_ROW.test(r))
    .slice(0, MAX_ROWS);

  if (labelled) {
    const rows = rowsIn(labelled[1], /[\n,;]/);
    if (rows.length >= 2) return rows.join('\n');
  }
  // Unlabelled: only newline-separated rows count, and EVERY non-empty line must be one — a menu
  // typed into a box is all rows, whereas a paragraph that happens to contain two is prose.
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every((l) => PRICED_ROW.test(l))) return lines.slice(0, MAX_ROWS).join('\n');
  return '';
}

/**
 * Everything worth pre-filling, in the order it should appear on the picture.
 *
 * Name first because it is the headline, then the rate card, then the address, then the phone —
 * top-to-bottom is how a shop board reads, and the caller places them in that order.
 *
 * ⚠️ A phone number found INSIDE the address is not repeated as its own layer: it is already on the
 * picture, and a duplicate is exactly the kind of junk this module exists not to create.
 */
export function extractImageText(prompt: string): ExtractedText[] {
  const text = String(prompt ?? '');
  if (!text.trim()) return [];
  const out: ExtractedText[] = [];

  const name = requestedText(text);
  if (name) out.push({ kind: 'name', text: name });

  const list = findRateList(text);
  if (list) out.push({ kind: 'list', text: list });

  const address = findAddress(text);
  if (address) out.push({ kind: 'address', text: address });

  for (const phone of findPhones(text)) {
    if (address && address.includes(phone)) continue;
    out.push({ kind: 'phone', text: phone });
  }

  return unique(out);
}

/**
 * The categories an image engine can never render, and which are therefore OURS to draw.
 *
 * A shop NAME is deliberately absent: one to five words is what these engines are genuinely good at,
 * and a name integrated into the artwork looks better than a caption laid over it. The three below
 * are different in kind — a wrong digit is not a worse-looking banner, it is a wrong banner.
 */
export const ENGINE_CANNOT_RENDER: ReadonlyArray<ExtractedText['kind']> = ['phone', 'address', 'list'];

/**
 * One line telling the engine to leave these alone, or '' when there is nothing to leave alone.
 *
 * Appended to the brief so the picture comes back with clean space where the real text will go,
 * instead of with a plausible-looking wrong number underneath it that the overlay then has to cover.
 */
export function noTextDirection(found: ExtractedText[]): string {
  const kinds = found.filter((f) => ENGINE_CANNOT_RENDER.includes(f.kind)).map((f) => f.kind);
  if (kinds.length === 0) return '';
  const what = [
    kinds.includes('phone') ? 'phone numbers' : '',
    kinds.includes('address') ? 'addresses' : '',
    kinds.includes('list') ? 'price or menu lists' : '',
  ].filter(Boolean);
  return `Do NOT draw any ${what.join(', ')} in the image — leave clean, uncluttered space for them instead.`;
}


/**
 * Turn what was found into ready-placed layers, top to bottom, the way a shop board reads.
 *
 * The sizes and positions are a starting point, not a verdict — every one is draggable and every box
 * is editable the moment the editor opens. What this removes is the blank-page moment, not the user's
 * control: they arrive at something already nearly right instead of at an empty text box.
 *
 * ⚠️ NOTHING IS PRE-FILLED SILENTLY ONTO A PICTURE. These layers appear in the EDITOR, which the user
 * opened on purpose and must still press Done in. An extraction that got it wrong costs one look.
 */
export function layersFromExtracted(found: ExtractedText[], makeId: () => string): TextLayer[] {
  const layers: TextLayer[] = [];
  for (const item of found) {
    const text = item.text.slice(0, MAX_TEXT_CHARS);
    if (!text) continue;
    if (item.kind === 'list') {
      const l = defaultLayer(makeId(), text, 'list');
      l.yPct = 0.5;
      layers.push(l);
      continue;
    }
    const l = defaultLayer(makeId(), text);
    if (item.kind === 'name') {
      l.yPct = 0.16;
      l.sizePct = 0.11;
    } else if (item.kind === 'phone') {
      l.yPct = 0.86;
      l.sizePct = 0.07;
    } else {
      // An address is the longest and least important line, so it sits smallest and lowest.
      l.yPct = 0.94;
      l.sizePct = 0.045;
    }
    layers.push(l);
  }
  return layers;
}
