// The fonts a user may put on their own picture (admin-asked 2026-09-21: "font badalne ka bhi system
// add karo, kam se kam 25+ font chahiye").
//
// 🔴 THE ONE RULE THAT MAKES THIS DIFFERENT FROM EVERY OTHER FONT PICKER: HINDI MUST NOT BREAK.
// This editor exists because an image model cannot spell — and the script it fails hardest at is
// Devanagari. A font list that quietly turned "शर्मा स्वीट्स" into empty boxes the moment somebody
// picked a pretty display face would undo the entire reason the feature was built. So every family
// here is tagged with whether it REALLY carries Devanagari, the list is grouped by that in the UI,
// and `fontFamilyStack` always ends in the Devanagari fallbacks whatever is chosen — a Latin-only
// face renders its Latin and hands the Hindi to a face that has it, rather than drawing boxes.
//
// 🔒 PURE. No DOM, no network. Loading a family is `imageFontLoader.ts`'s job, deliberately split so
// the list itself can be tested (and counted) without a browser.

/**
 * Where the Devanagari always comes from, whatever face the user picked.
 *
 * Android ships Noto Sans Devanagari, iOS/macOS Kohinoor and Devanagari Sangam MN, Windows Nirmala
 * UI. Naming them explicitly (rather than trusting `sans-serif`) is what keeps a mixed line —
 * "Sharma जी" — on ONE baseline instead of two: a bare generic picks the system UI face and then
 * falls back per glyph, with a different vertical rhythm on each half.
 */
export const DEVANAGARI_STACK =
  '"Noto Sans Devanagari", "Nirmala UI", "Kohinoor Devanagari", "Devanagari Sangam MN", "Mangal"';

/** The default stack — what a layer uses until somebody chooses otherwise. */
export const FONT_STACK =
  `${DEVANAGARI_STACK}, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

export interface FontChoice {
  id: string;
  /** What the user reads in the picker. */
  label: string;
  /** The CSS family name. Empty means "the default stack" — no family is prepended. */
  family: string;
  /**
   * The Google Fonts `family=` value, including its axis spec, or '' for the system default.
   *
   * ⚠️ THE AXIS SPEC IS PER FAMILY AND IS NOT DECORATION. The CSS2 API answers HTTP 400 for a weight
   * a family does not publish, so asking a single-weight display face (Anton, Bebas Neue, Lobster…)
   * for `wght@400;700` would make that font fail to load at all. Those are listed without an axis and
   * their bold is synthesized by the text engine, which is what a poster face wants anyway.
   */
  google: string;
  /** True when the FACE ITSELF carries Devanagari, so Hindi comes out in the chosen font. */
  devanagari: boolean;
}

/** The id of the default choice — always available, never fetched. */
export const DEFAULT_FONT_ID = 'system';

const w = ':wght@400;700';

/**
 * The catalogue. Grouped in the UI by `devanagari`, because that is the question a NavBharatAI user
 * is actually asking ("will my shop's name work?") rather than serif-vs-sans.
 *
 * 45 entries against the admin's "25+". The Devanagari half is deliberately as long as the Latin
 * half: this is an India-first product, and a Hindi shopkeeper having four fonts while an English
 * one has thirty would be the same quiet second-class treatment the language rule already forbids
 * elsewhere.
 */
export const FONT_CHOICES: FontChoice[] = [
  { id: DEFAULT_FONT_ID, label: 'Default', family: '', google: '', devanagari: true },

  // ── Hindi + English ──────────────────────────────────────────────────────────────────────────
  { id: 'noto-devanagari', label: 'Noto Sans Devanagari', family: 'Noto Sans Devanagari', google: `Noto+Sans+Devanagari${w}`, devanagari: true },
  { id: 'poppins', label: 'Poppins', family: 'Poppins', google: `Poppins${w}`, devanagari: true },
  { id: 'hind', label: 'Hind', family: 'Hind', google: `Hind${w}`, devanagari: true },
  { id: 'mukta', label: 'Mukta', family: 'Mukta', google: `Mukta${w}`, devanagari: true },
  { id: 'rajdhani', label: 'Rajdhani', family: 'Rajdhani', google: `Rajdhani${w}`, devanagari: true },
  { id: 'teko', label: 'Teko', family: 'Teko', google: `Teko${w}`, devanagari: true },
  { id: 'khand', label: 'Khand', family: 'Khand', google: `Khand${w}`, devanagari: true },
  { id: 'baloo2', label: 'Baloo 2', family: 'Baloo 2', google: `Baloo+2${w}`, devanagari: true },
  { id: 'kalam', label: 'Kalam (handwriting)', family: 'Kalam', google: `Kalam${w}`, devanagari: true },
  { id: 'martel', label: 'Martel', family: 'Martel', google: `Martel${w}`, devanagari: true },
  { id: 'halant', label: 'Halant', family: 'Halant', google: `Halant${w}`, devanagari: true },
  { id: 'biryani', label: 'Biryani', family: 'Biryani', google: `Biryani${w}`, devanagari: true },
  { id: 'laila', label: 'Laila', family: 'Laila', google: `Laila${w}`, devanagari: true },
  { id: 'eczar', label: 'Eczar', family: 'Eczar', google: `Eczar${w}`, devanagari: true },
  { id: 'sarala', label: 'Sarala', family: 'Sarala', google: `Sarala${w}`, devanagari: true },
  { id: 'amita', label: 'Amita', family: 'Amita', google: `Amita${w}`, devanagari: true },
  { id: 'tiro-devanagari', label: 'Tiro Devanagari', family: 'Tiro Devanagari Hindi', google: 'Tiro+Devanagari+Hindi', devanagari: true },
  { id: 'yatra-one', label: 'Yatra One', family: 'Yatra One', google: 'Yatra+One', devanagari: true },
  { id: 'modak', label: 'Modak', family: 'Modak', google: 'Modak', devanagari: true },

  // ── English only ─────────────────────────────────────────────────────────────────────────────
  { id: 'montserrat', label: 'Montserrat', family: 'Montserrat', google: `Montserrat${w}`, devanagari: false },
  { id: 'raleway', label: 'Raleway', family: 'Raleway', google: `Raleway${w}`, devanagari: false },
  { id: 'nunito', label: 'Nunito', family: 'Nunito', google: `Nunito${w}`, devanagari: false },
  { id: 'rubik', label: 'Rubik', family: 'Rubik', google: `Rubik${w}`, devanagari: false },
  { id: 'josefin-sans', label: 'Josefin Sans', family: 'Josefin Sans', google: `Josefin+Sans${w}`, devanagari: false },
  { id: 'exo-2', label: 'Exo 2', family: 'Exo 2', google: `Exo+2${w}`, devanagari: false },
  { id: 'oswald', label: 'Oswald', family: 'Oswald', google: `Oswald${w}`, devanagari: false },
  { id: 'fredoka', label: 'Fredoka', family: 'Fredoka', google: `Fredoka${w}`, devanagari: false },
  { id: 'playfair', label: 'Playfair Display', family: 'Playfair Display', google: `Playfair+Display${w}`, devanagari: false },
  { id: 'merriweather', label: 'Merriweather', family: 'Merriweather', google: `Merriweather${w}`, devanagari: false },
  { id: 'roboto-slab', label: 'Roboto Slab', family: 'Roboto Slab', google: `Roboto+Slab${w}`, devanagari: false },
  { id: 'cinzel', label: 'Cinzel', family: 'Cinzel', google: `Cinzel${w}`, devanagari: false },
  { id: 'courier-prime', label: 'Courier Prime', family: 'Courier Prime', google: `Courier+Prime${w}`, devanagari: false },
  { id: 'caveat', label: 'Caveat (handwriting)', family: 'Caveat', google: `Caveat${w}`, devanagari: false },
  { id: 'dancing-script', label: 'Dancing Script', family: 'Dancing Script', google: `Dancing+Script${w}`, devanagari: false },
  { id: 'anton', label: 'Anton', family: 'Anton', google: 'Anton', devanagari: false },
  { id: 'bebas-neue', label: 'Bebas Neue', family: 'Bebas Neue', google: 'Bebas+Neue', devanagari: false },
  { id: 'archivo-black', label: 'Archivo Black', family: 'Archivo Black', google: 'Archivo+Black', devanagari: false },
  { id: 'abril-fatface', label: 'Abril Fatface', family: 'Abril Fatface', google: 'Abril+Fatface', devanagari: false },
  { id: 'righteous', label: 'Righteous', family: 'Righteous', google: 'Righteous', devanagari: false },
  { id: 'lobster', label: 'Lobster', family: 'Lobster', google: 'Lobster', devanagari: false },
  { id: 'pacifico', label: 'Pacifico', family: 'Pacifico', google: 'Pacifico', devanagari: false },
  { id: 'satisfy', label: 'Satisfy', family: 'Satisfy', google: 'Satisfy', devanagari: false },
  { id: 'permanent-marker', label: 'Permanent Marker', family: 'Permanent Marker', google: 'Permanent+Marker', devanagari: false },
  { id: 'bungee', label: 'Bungee', family: 'Bungee', google: 'Bungee', devanagari: false },
];

/** The choice for an id, falling back to the default rather than throwing on a stored unknown. */
export function fontChoice(id: string): FontChoice {
  return FONT_CHOICES.find((f) => f.id === id) || FONT_CHOICES[0];
}

/**
 * The CSS font-family list for a choice.
 *
 * 🔒 THE DEVANAGARI STACK IS ALWAYS LAST, for every choice including the Latin-only ones. That single
 * line is what makes a Hindi phone number safe under a decorative English headline face: the browser
 * resolves per GLYPH, so the Latin comes from the chosen font and anything it lacks comes from a face
 * that has it. Dropping it to "keep the stack clean" would put □□□ on somebody's banner.
 */
export function fontFamilyStack(id: string): string {
  const choice = fontChoice(id);
  return choice.family ? `"${choice.family}", ${FONT_STACK}` : FONT_STACK;
}

/** The Google Fonts stylesheet URL for one choice, or '' when nothing needs fetching. */
export function googleFontHref(id: string): string {
  const choice = fontChoice(id);
  if (!choice.google) return '';
  return `https://fonts.googleapis.com/css2?family=${choice.google}&display=swap`;
}
