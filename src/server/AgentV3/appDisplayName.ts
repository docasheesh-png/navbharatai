// THE APP'S DISPLAY NAME — for the manifest, the icon and the share preview (autopsy d829b523, 2026-09-27).
//
// 🔴 WHAT SHIPPED. The production-defaults pass named every app after the PROMPT: `deriveTitle(prompt)`
// is the build-list title, i.e. the user's first message cut at 80 characters. So a water reminder the
// model had named **HydroTrack** went out with:
//   manifest   name        "Build a water drinking reminder app which reminds me to drink water in re…"
//              short_name  "Build a wate"      ← the label under the icon on a phone's home screen
//   <meta name="description">, og:title, og:description  — the same order, word for word
//   public/icon.svg  a monogram of "B" — for "Build"
// Every one of those is in the user's PUBLISHED app: the home-screen label, the Google result, the
// WhatsApp link preview. An instruction to us, shown to their visitors.
//
// 🔑 THE NAME ALREADY EXISTED. The model writes the app's name into index.html's <title> (the golden
// scaffolds do too, from the app they were chosen for) — and the defaults pass only ever ADDS a missing
// <title>, so the one place the real name lived was never read for the name itself. Read it first; a
// cleaned prompt is only the fallback for an app whose title is a placeholder.
//
// PURE — no I/O, no clock. Never throws.

/** Titles that name no app: framework and template defaults, and our own preview placeholders. */
const PLACEHOLDER_TITLE =
  /^(?:app|my app|my real app|react app|vite app|vite \+ react(?: \+ ts)?|vite \+ vue(?: \+ ts)?|vite \+ preact|vite \+ svelte|vite \+ solid|vite \+ lit|document|untitled|home|index|preview|navbharatai preview|loading…?|loading\.\.\.|new app|my vue app|my svelte app|my solid app|my preact app|my lit app|my static site|next\.js app|create next app)$/i;

/** An order to the builder rather than a name: "Build a …", "Make me …", "Create …", "banao …". */
const IMPERATIVE_OPENER =
  /^(?:please\s+|pls\s+|kindly\s+|can you\s+|could you\s+|i want(?: you)? to\s+|i need(?: you to)?\s+|i want\s+|help me\s+)*(?:build|make|create|develop|design|generate|code|write|give me|bana(?:o|do|dein|iye)?)\b\s*(?:me\s+|for me\s+|us\s+)?(?:an?\s+|the\s+|my\s+|one\s+)?/i;

/**
 * The Hinglish order ends with its verb: "ek billing app banao", "mujhe ek notes app chahiye". Its head
 * and tail are stripped the same way the English opener is. Word-bounded, so "banana shop" survives.
 */
const HINDI_LEAD = /^(?:(?:mujhe|mere liye|hamare liye|meri|mera|ek|ik)\s+)+/i;
const HINDI_TAIL = /\s+(?:bana(?:o|do|dein|iye|dijiye|na hai|ni hai|ke do)|chahiye|chaiye|karo|kar do|de do)$/i;

function withoutOrder(text: string): { rest: string; hadOpener: boolean } {
  const opener = text.match(IMPERATIVE_OPENER);
  let rest = opener ? text.slice(opener[0].length) : text;
  const hadHindiTail = HINDI_TAIL.test(rest.replace(/[.!?]+$/, ''));
  rest = rest.replace(/[.!?]+$/, '').replace(HINDI_TAIL, '').replace(HINDI_LEAD, '').trim();
  return { rest, hadOpener: !!opener || hadHindiTail };
}

/** Where a name stops and its description begins. */
const CLAUSE_END = /\s*(?:[.,;:!?(\n—–-]\s|\s(?:which|that|where|who|to|for|with|so|and|using|in|on|by|according)\s)/i;

/** A trailing kind-word that says what the thing IS, not what it is called. */
const TRAILING_KIND = /\s+(?:app|application|website|web app|webapp|site|tool|page|system|software)$/i;

const MAX_NAME = 40;
const MAX_SHORT = 12;
const MAX_DESCRIPTION = 155;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])([a-z]*)/g, (_m, a: string, b: string) => a.toUpperCase() + b);
}

/** Cut at a word boundary to `max` characters; a single overlong word is cut hard. */
function clip(s: string, max: number, ellipsis = false): string {
  if (s.length <= max) return s;
  const room = ellipsis ? max - 1 : max;
  const cut = s.slice(0, room + 1);
  const space = cut.lastIndexOf(' ');
  const out = (space > 0 ? cut.slice(0, space) : s.slice(0, room)).replace(/[\s,;:—–-]+$/, '');
  return ellipsis ? `${out}…` : out;
}

/**
 * The app's name as its own index.html states it, or null when the <title> is missing, a template
 * placeholder, or itself an echo of the order ("Build a …").
 */
export function titleFromIndexHtml(indexHtml: string | null | undefined): string | null {
  const m = String(indexHtml ?? '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const title = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
  if (!title || title.length < 2 || title.includes('{') || title.includes('<')) return null;
  if (PLACEHOLDER_TITLE.test(title)) return null;
  if (IMPERATIVE_OPENER.test(title) && title.split(' ').length > 3) return null;
  return clip(title, MAX_NAME);
}

/**
 * A short name recovered from the order itself: the thing asked for, without the verb and without the
 * clause that describes it. "Build a water drinking reminder app which reminds me…" → "Water Drinking
 * Reminder". Null when nothing name-like is left.
 */
export function nameFromPrompt(prompt: string | null | undefined): string | null {
  const one = String(prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!one) return null;
  let rest = withoutOrder(one).rest;
  const end = rest.search(CLAUSE_END);
  if (end > 0) rest = rest.slice(0, end);
  rest = rest.replace(/[.,;:!?]+$/, '').trim();
  // "banana shop ka app" — the Hindi possessive before the kind-word goes with it.
  const stripped = rest.replace(TRAILING_KIND, '').replace(/\s+(?:ka|ki|ke|wala|wali|vala|vali)$/i, '').trim();
  if (stripped) rest = stripped;
  if (!/\p{L}/u.test(rest)) return null;
  const words = rest.split(' ').slice(0, 5).join(' ');
  return clip(/[a-z]/.test(words[0] ?? '') ? titleCase(words) : words, MAX_NAME);
}

/**
 * One sentence saying what the app does, built from the order with its imperative removed and its
 * first person turned to the reader's ("reminds me" → "reminds you"), because the description is read
 * by the app's visitors, not by us.
 */
export function descriptionFromPrompt(prompt: string | null | undefined, fallbackName: string): string {
  const one = String(prompt ?? '').replace(/\s+/g, ' ').trim();
  const firstSentence = one.split(/(?<=[.!?])\s/)[0] ?? one;
  const { rest, hadOpener: opener } = withoutOrder(firstSentence);
  let body = rest
    .replace(/\bme\b/gi, 'you')
    .replace(/\bmy\b/gi, 'your')
    .replace(/[.!?]+$/, '')
    .trim();
  if (!/\p{L}/u.test(body) || body.length < 8) return fallbackName;
  const article = opener && /^[aeiou]/i.test(body) ? 'An ' : opener ? 'A ' : '';
  const sentence = article ? `${article}${body}` : body.charAt(0).toUpperCase() + body.slice(1);
  return clip(`${sentence}.`, MAX_DESCRIPTION, true);
}

/** The label under the home-screen icon: whole words that fit, never a word cut in half if avoidable. */
export function shortNameFor(name: string): string {
  const n = String(name || '').trim() || 'App';
  if (n.length <= MAX_SHORT) return n;
  const words = n.split(' ');
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > MAX_SHORT) break;
    out = next;
  }
  return out || n.slice(0, MAX_SHORT);
}

export interface AppDisplayName {
  name: string;
  shortName: string;
  description: string;
  /** Where the name came from — for the report, never shown to a user. */
  source: 'user-chosen' | 'index-title' | 'prompt' | 'fallback';
}

/**
 * Name, short name and description for an app, from the best evidence available. PURE.
 *
 * Order: the name the USER chose (the rename card — `appName.ts`), then the app's own <title>, then the
 * order with its verb removed. The user's choice wins because "har jagah wahi name" is that feature's
 * whole promise; their home-screen label is one more place.
 */
export function resolveAppDisplayName(opts: {
  chosenName?: string | null;
  indexHtml?: string | null;
  prompt?: string | null;
}): AppDisplayName {
  const chosen = String(opts.chosenName ?? '').replace(/\s+/g, ' ').trim();
  const fromChosen = chosen.length >= 2 ? clip(chosen, MAX_NAME) : null;
  const fromTitle = fromChosen ? null : titleFromIndexHtml(opts.indexHtml);
  const fromPrompt = fromChosen || fromTitle ? null : nameFromPrompt(opts.prompt);
  const name = fromChosen ?? fromTitle ?? fromPrompt ?? 'App';
  const source: AppDisplayName['source'] = fromChosen ? 'user-chosen' : fromTitle ? 'index-title' : fromPrompt ? 'prompt' : 'fallback';
  return {
    name,
    shortName: shortNameFor(name),
    description: descriptionFromPrompt(opts.prompt, name),
    source,
  };
}
