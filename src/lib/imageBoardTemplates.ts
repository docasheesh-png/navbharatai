// One tap, and the board is laid out (admin-asked 2026-09-21, piece 3 of 3).
//
// Pieces 1 and 2 gave the editor a rate-card layer and filled it from the user's own prompt. What is
// still missing is the ARRANGEMENT: somebody who did not spell their whole shop board out in the
// prompt still opens a single empty caption and has to invent the layout — where the name goes, how
// big the phone should be, that an address belongs small and last.
//
// A template is that arrangement, and nothing more. It places named, empty slots; it fills the ones
// the prompt already answered; and every result is an ordinary layer the user can drag, retype or
// delete. Nothing here draws, measures or decides anything — it returns layers and stops.
//
// 🔑 IT COMPOSES WITH THE EXTRACTION RATHER THAN REPEATING IT. `layersFromExtracted` already knows
// where a name, phone and address belong when the prompt named them. A template answers the harder
// case — the prompt named SOME of them, or none — by keeping the slots it could not fill as empty,
// labelled boxes instead of silently dropping them. Two copies of "where does a phone go" would
// drift, so the placement lives here and the extraction stays a separate question.

import { MAX_LAYERS, MAX_TEXT_CHARS, defaultLayer, type LayerKind, type TextLayer } from './textOverlay';
import type { ExtractedText } from './imageTextFromPrompt';

/** Which extracted thing a slot wants, and where it sits. */
interface Slot {
  /** Matches `ExtractedText['kind']`, so a template slot and an extraction speak one vocabulary. */
  wants: ExtractedText['kind'];
  kind: LayerKind;
  label: string;
  yPct: number;
  sizePct: number;
  widthPct: number;
}

export interface BoardTemplate {
  id: string;
  /** What the button says. */
  label: string;
  /** One line under it, so the choice is not a guess. */
  hint: string;
  slots: Slot[];
}

/**
 * The three boards Indian shops actually print.
 *
 * Deliberately three. A gallery of twenty is a decision the user has to make before they can start,
 * and these cover the overwhelming majority: a shop's own board, a price board, and a sale poster.
 */
export const BOARD_TEMPLATES: readonly BoardTemplate[] = [
  {
    id: 'shop',
    label: 'Shop board',
    hint: 'Name, phone, address',
    slots: [
      { wants: 'name', kind: 'text', label: 'Shop name', yPct: 0.16, sizePct: 0.11, widthPct: 0.9 },
      { wants: 'phone', kind: 'text', label: 'Phone', yPct: 0.85, sizePct: 0.07, widthPct: 0.9 },
      { wants: 'address', kind: 'text', label: 'Address', yPct: 0.94, sizePct: 0.045, widthPct: 0.9 },
    ],
  },
  {
    id: 'rate',
    label: 'Rate list',
    hint: 'Title and a price table',
    slots: [
      { wants: 'name', kind: 'text', label: 'Title', yPct: 0.12, sizePct: 0.09, widthPct: 0.9 },
      { wants: 'list', kind: 'list', label: 'Items and prices', yPct: 0.52, sizePct: 0.055, widthPct: 0.7 },
      { wants: 'phone', kind: 'text', label: 'Phone', yPct: 0.93, sizePct: 0.05, widthPct: 0.9 },
    ],
  },
  {
    id: 'offer',
    label: 'Offer',
    hint: 'A big headline',
    slots: [
      { wants: 'name', kind: 'text', label: 'Offer', yPct: 0.44, sizePct: 0.16, widthPct: 0.9 },
      { wants: 'phone', kind: 'text', label: 'Phone', yPct: 0.88, sizePct: 0.06, widthPct: 0.9 },
    ],
  },
] as const;

export function findTemplate(id: string): BoardTemplate | null {
  return BOARD_TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * Lay a template out, filling what the prompt already answered.
 *
 * ⚠️ AN UNFILLED SLOT IS KEPT, NOT DROPPED, and that is the entire point of a template. Dropping it
 * would leave somebody who typed no phone number with no phone box either — which is the blank page
 * this is meant to remove. It arrives EMPTY and labelled, draws nothing until typed into, and can be
 * deleted in one tap if it is not wanted.
 *
 * ⚠️ AND ANYTHING EXTRACTED THAT THE TEMPLATE HAS NO SLOT FOR IS STILL ADDED, at the end. A user who
 * wrote a rate list and then picked "Shop board" must not silently lose their menu because the
 * template did not ask for one — a template arranges what is there; it never censors it.
 */
export function layersFromTemplate(
  template: BoardTemplate,
  found: ExtractedText[],
  makeId: () => string,
): TextLayer[] {
  const layers: TextLayer[] = [];
  const used = new Set<ExtractedText>();

  for (const slot of template.slots) {
    const match = found.find((f) => f.kind === slot.wants && !used.has(f));
    if (match) used.add(match);
    const layer = defaultLayer(makeId(), (match?.text ?? '').slice(0, MAX_TEXT_CHARS), slot.kind);
    layer.label = slot.label;
    layer.yPct = slot.yPct;
    layer.sizePct = slot.sizePct;
    layer.widthPct = slot.widthPct;
    layers.push(layer);
  }

  // Whatever the prompt gave that this template had no slot for — kept, never dropped.
  for (const item of found) {
    if (used.has(item)) continue;
    const layer = defaultLayer(makeId(), item.text.slice(0, MAX_TEXT_CHARS), item.kind === 'list' ? 'list' : 'text');
    layer.yPct = 0.62;
    layers.push(layer);
  }

  return layers.slice(0, MAX_LAYERS);
}
