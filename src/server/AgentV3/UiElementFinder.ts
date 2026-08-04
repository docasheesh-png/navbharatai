// Visual → source: answer "WHERE in the code is the thing I can SEE?" — and, just as importantly,
// "is it even there?".
//
// THE FAILURE THIS EXISTS TO KILL (mitrify autopsy 2026-08-04). The user asked to remove a small green
// dot from the home page. The engine could screenshot the page but had no way to map a PIXEL to a
// FILE, so it brute-forced Tailwind class names — `w-2`, `h-2`, `rounded-full`, `bg-green`, `dot`,
// `circle` — about thirty times across twenty minutes, found nothing, and then GUESSED: it deleted the
// app's logo and reported "done, I removed the green dot". 27 minutes, ₹393, the logo gone, the dot
// still there. And the dot never existed at all — the admin confirmed it afterwards.
//
// Both halves of that disaster come from one missing capability, so this module provides both:
//   1. FIND — scan the RENDERED page and rank elements against a plain-language visual description,
//      returning each one's className (directly greppable in the source), its text, its position and
//      its `data-nbai-src` stamp when the preview provides one. One query replaces thirty greps.
//   2. PROVE ABSENCE — when nothing matches, say so with evidence: what was searched for, and what
//      IS actually on the page (e.g. every green element, or every small round one). An honest "that
//      is not on this page" is a correct answer; guessing at a neighbouring element is not.
//
// PURE + dependency-free: the browser-side scan hands over plain records, and every decision here is
// deterministic and unit-tested. No Playwright, no DOM, no network.

/** One element as captured from the rendered page by the browser-side scan. */
export interface ScannedElement {
  tag: string;
  /** The class attribute verbatim — the single most useful field, because it greps straight to source. */
  className?: string;
  id?: string;
  /** Trimmed, capped visible text. */
  text?: string;
  /** Best-effort CSS selector for this element. */
  selector?: string;
  /** `data-nbai-src` ("file:line:col") when the preview stamped it — an exact source location. */
  source?: string;
  /** Layout box in CSS pixels. */
  rect?: { x: number; y: number; w: number; h: number };
  /** Computed colours, as the browser reports them (e.g. "rgb(34, 197, 94)"). */
  bg?: string;
  color?: string;
  borderRadius?: string;
  /** For <img>: the resolved source URL. */
  src?: string;
}

export interface UiMatch {
  element: ScannedElement;
  score: number;
  /** Why this element matched — shown to the agent so a weak match is visibly weak. */
  reasons: string[];
}

/** Colour families the query language actually uses. */
const COLOR_HUES: Array<{ name: string; test: (r: number, g: number, b: number) => boolean }> = [
  { name: 'white', test: (r, g, b) => r > 230 && g > 230 && b > 230 },
  { name: 'black', test: (r, g, b) => r < 40 && g < 40 && b < 40 },
  { name: 'grey', test: (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) < 24 },
  { name: 'green', test: (r, g, b) => g > r + 25 && g > b + 25 },
  { name: 'red', test: (r, g, b) => r > g + 45 && r > b + 45 },
  { name: 'orange', test: (r, g, b) => r > 180 && g > 90 && g < 200 && b < 90 },
  { name: 'yellow', test: (r, g, b) => r > 180 && g > 180 && b < 120 },
  { name: 'blue', test: (r, g, b) => b > r + 25 && b > g + 10 },
  { name: 'purple', test: (r, g, b) => r > g + 25 && b > g + 25 },
  { name: 'pink', test: (r, g, b) => r > 200 && b > 130 && g < r - 40 },
];

/** Parse a CSS colour the browser reported. Returns null for transparent/none/unparseable. */
export function parseCssColor(css: string | undefined): { r: number; g: number; b: number; a: number } | null {
  if (!css) return null;
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/i.exec(css);
  if (m) {
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if (!Number.isFinite(a) || a <= 0.05) return null; // fully/near transparent — not a visible colour
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  return null;
}

/** The colour FAMILY a CSS colour belongs to ('green', 'red', …), or null when there is no visible colour. */
export function colorFamily(css: string | undefined): string | null {
  const c = parseCssColor(css);
  if (!c) return null;
  for (const hue of COLOR_HUES) if (hue.test(c.r, c.g, c.b)) return hue.name;
  return null;
}

/** Is this element small and round — i.e. what a person calls a "dot", "badge" or "indicator"? */
export function looksLikeDot(el: ScannedElement): boolean {
  const r = el.rect;
  if (!r || r.w <= 0 || r.h <= 0) return false;
  if (r.w > 40 || r.h > 40) return false;                 // a dot is small
  if (Math.abs(r.w - r.h) > Math.max(4, r.w * 0.35)) return false; // …and roughly square
  const br = el.borderRadius || '';
  const roundedByStyle = /9999px|50%|100%/.test(br) || (parseFloat(br) >= Math.min(r.w, r.h) / 2 - 0.5 && parseFloat(br) > 0);
  const roundedByClass = /\brounded-full\b/.test(el.className || '');
  return roundedByStyle || roundedByClass;
}

const COLOR_WORDS = COLOR_HUES.map((h) => h.name).concat(['gray']);
const DOT_WORDS = ['dot', 'dote', 'circle', 'badge', 'indicator', 'bullet', 'bindi', 'point'];
const IMAGE_WORDS = ['logo', 'image', 'img', 'picture', 'photo', 'icon', 'avatar'];
const BUTTON_WORDS = ['button', 'btn', 'link', 'cta'];

/** What a plain-language visual description is actually asking for. PURE. */
export function parseVisualQuery(query: string): {
  colors: string[];
  wantsDot: boolean;
  wantsImage: boolean;
  wantsButton: boolean;
  textTerms: string[];
} {
  const q = (query || '').toLowerCase();
  const words = q.split(/[^a-z0-9]+/i).filter(Boolean);
  const colors = COLOR_WORDS.filter((c) => words.includes(c)).map((c) => (c === 'gray' ? 'grey' : c));
  const stop = new Set([...COLOR_WORDS, ...DOT_WORDS, ...IMAGE_WORDS, ...BUTTON_WORDS,
    'the', 'a', 'an', 'on', 'in', 'at', 'of', 'is', 'it', 'small', 'tiny', 'little', 'big', 'large',
    'page', 'home', 'top', 'bottom', 'left', 'right', 'corner', 'remove', 'delete', 'hide', 'hatao',
    'find', 'where', 'kaha', 'kahan', 'par', 'se', 'ko', 'wala', 'wali', 'near', 'next', 'to']);
  return {
    colors,
    wantsDot: DOT_WORDS.some((w) => words.includes(w)),
    wantsImage: IMAGE_WORDS.some((w) => words.includes(w)),
    wantsButton: BUTTON_WORDS.some((w) => words.includes(w)),
    textTerms: words.filter((w) => w.length > 2 && !stop.has(w)),
  };
}

/**
 * Rank the scanned elements against a plain-language description. Highest score first; elements that
 * match nothing at all are dropped rather than padded in — a weak list reads as "found it" to the
 * caller, which is exactly the mistake this module exists to prevent. PURE.
 */
export function findUiElements(elements: ScannedElement[], query: string, limit = 8): UiMatch[] {
  const want = parseVisualQuery(query);
  const matches: UiMatch[] = [];

  // Did the query name a STRUCTURE (a shape or an element role), not just a colour?
  const askedStructure = want.wantsDot || want.wantsImage || want.wantsButton;

  for (const el of elements) {
    const reasons: string[] = [];
    let score = 0;
    let structuralHit = false;

    if (want.colors.length > 0) {
      const bgFam = colorFamily(el.bg);
      const fgFam = colorFamily(el.color);
      if (bgFam && want.colors.includes(bgFam)) { score += 40; reasons.push(`${bgFam} background`); }
      else if (fgFam && want.colors.includes(fgFam)) { score += 25; reasons.push(`${fgFam} text/icon colour`); }
    }
    if (want.wantsDot && looksLikeDot(el)) {
      score += 40; structuralHit = true;
      reasons.push(`small round element (${Math.round(el.rect?.w ?? 0)}×${Math.round(el.rect?.h ?? 0)}px)`);
    }
    if (want.wantsImage && (el.tag === 'img' || el.tag === 'svg')) { score += 30; structuralHit = true; reasons.push(`<${el.tag}>`); }
    if (want.wantsButton && (el.tag === 'button' || el.tag === 'a')) { score += 30; structuralHit = true; reasons.push(`<${el.tag}>`); }

    const hay = `${el.text ?? ''} ${el.className ?? ''} ${el.id ?? ''} ${el.src ?? ''}`.toLowerCase();
    let textHit = false;
    for (const term of want.textTerms) {
      if (hay.includes(term)) { score += 20; textHit = true; reasons.push(`matches "${term}"`); }
    }

    // COLOUR ALONE IS NEVER A MATCH WHEN A SHAPE OR ROLE WAS NAMED. Asked for a "green dot", a green
    // BUTTON is not a weaker answer — it is a DIFFERENT OBJECT, and returning it is precisely how the
    // reported build ended up editing the wrong element with full confidence. When the structure does
    // not match, this element belongs in the honest not-found report (which names the green things that
    // DO exist), never in the hit list.
    if (askedStructure && !structuralHit && !textHit) continue;

    // An exact source stamp is not evidence of a match, but it makes a match far more actionable.
    if (score > 0 && el.source) { score += 5; reasons.push('has an exact source stamp'); }

    if (score > 0) matches.push({ element: el, score, reasons });
  }

  matches.sort((a, b) => b.score - a.score || (a.element.selector || '').localeCompare(b.element.selector || ''));
  return matches.slice(0, Math.max(1, limit));
}

/** One element rendered as a line the agent can act on. PURE. */
function describeElement(m: UiMatch): string {
  const el = m.element;
  const bits: string[] = [`<${el.tag}>`];
  if (el.source) bits.push(`SOURCE ${el.source}`);
  if (el.className) bits.push(`class="${el.className.slice(0, 160)}"`);
  if (el.id) bits.push(`id="${el.id}"`);
  if (el.text) bits.push(`text="${el.text.slice(0, 60)}"`);
  if (el.src) bits.push(`src="${el.src.slice(0, 120)}"`);
  if (el.rect) bits.push(`at ${Math.round(el.rect.x)},${Math.round(el.rect.y)} ${Math.round(el.rect.w)}×${Math.round(el.rect.h)}px`);
  if (el.bg && colorFamily(el.bg)) bits.push(`bg ${el.bg}`);
  if (el.selector) bits.push(`selector ${el.selector}`);
  return `• ${bits.join(' · ')}\n    why: ${m.reasons.join(', ')}`;
}

/**
 * The agent-facing answer — including the HONEST empty answer.
 *
 * The empty case is the important one. "Nothing matched" alone invites another guess, so the report
 * also states what IS on the page (the colours actually present, the small round elements that exist),
 * which is what turns "I could not find it" into a verifiable finding the agent can tell the user:
 * *"there is no green dot on this page — the only green here is the Submit button."* PURE.
 */
export function formatUiFindings(elements: ScannedElement[], query: string, limit = 8): string {
  const matches = findUiElements(elements, query, limit);
  if (matches.length > 0) {
    const head = `Found ${matches.length} element${matches.length === 1 ? '' : 's'} matching "${query}" on the rendered page, best first:`;
    const body = matches.map(describeElement).join('\n');
    const how = matches.some((m) => m.element.source)
      ? '\n\nSOURCE stamps above are exact file:line:col — open that file and edit there.'
      : '\n\nNo source stamps on this page, so locate the code by grepping the EXACT class string above (it is the same text in the JSX). Do not guess a different element.';
    return `${head}\n${body}${how}`;
  }

  // ── Nothing matched: prove absence with evidence, never with silence.
  const want = parseVisualQuery(query);
  const lines: string[] = [
    `NOT FOUND: nothing on the rendered page matches "${query}".`,
    '',
    'This is a real finding, not a dead end — do NOT edit some other element instead. Report it to the',
    'user honestly and ask what they mean. Evidence from the page as it actually renders right now:',
  ];

  if (want.colors.length > 0) {
    const present = new Map<string, ScannedElement>();
    for (const el of elements) {
      const fam = colorFamily(el.bg) || colorFamily(el.color);
      if (fam && !present.has(fam)) present.set(fam, el);
    }
    const askedFor = want.colors.join('/');
    const hit = want.colors.filter((c) => present.has(c));
    lines.push(hit.length === 0
      ? `• No ${askedFor} element exists on this page at all. Colours actually present: ${[...present.keys()].join(', ') || 'none detected'}.`
      : `• ${askedFor} does appear on the page, but not in the shape described — e.g. ${hit.map((c) => `${c}: <${present.get(c)!.tag}>${present.get(c)!.className ? ` class="${present.get(c)!.className!.slice(0, 60)}"` : ''}`).join('; ')}.`);
  }
  if (want.wantsDot) {
    const dots = elements.filter(looksLikeDot);
    lines.push(dots.length === 0
      ? '• There are no small round "dot"-shaped elements on this page.'
      : `• Small round elements DO exist (${dots.length}), but none in the colour asked for: ${dots.slice(0, 3).map((d) => `<${d.tag}>${d.className ? ` class="${d.className.slice(0, 40)}"` : ''}`).join('; ')}.`);
  }
  lines.push(
    '',
    'Also consider: the thing may be part of an IMAGE or SVG asset (a logo file, an icon) rather than',
    'markup, or it may be on a different route/screen than the one rendered here. Say which of these you',
    'checked. NEVER substitute a different change for the one you could not find.',
  );
  return lines.join('\n');
}
