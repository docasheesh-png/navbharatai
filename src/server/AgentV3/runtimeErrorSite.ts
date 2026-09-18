/**
 * 🔎 WHICH LINE OF THE USER'S OWN CODE CRASHED — the fact every runtime capture threw away
 * (admin 2026-09-18: *"agli baar aisa runtime crash ho to report khud offending file/stack le aaye"*).
 *
 * ## The gap this closes, stated as the autopsy that hit it
 *
 * Build `95598899` left the app throwing `Cannot read properties of null (reading 'useState')` on
 * load. The report recorded the SENTENCE and nothing else, so the autopsy could not name the file,
 * could not read it, and closed with the cause **unexplained** — the honest outcome, and a wasted
 * report. The stack that names the file existed in the browser at the moment of capture:
 * `page.on('pageerror', e => rec('pageerror', e && e.message || e))` — `e.stack` was one property
 * away and was dropped, in **three** separate capture sites (the console bridge, the page-route
 * check, the journey runner), each written independently.
 *
 * 🔑 **AND A MESSAGE CAN NEVER CARRY IT.** `locationTag`/`parseLocation` already pull a `file:line:col`
 * out of error TEXT, which is why a Vite compile error reads well in the report. A React runtime
 * crash's message is one sentence with no path in it at all, so that parser correctly returns
 * nothing — the information was never in the string it was given.
 *
 * ## Why this is a new module rather than a wider regex
 *
 * `parseLocation` answers *"is there a file:line:col in this text?"* and is reused here unchanged.
 * A stack asks a SECOND question it was never meant to answer: *"which of these frames is the app's
 * OWN code?"* The first match in a React stack is almost always `node_modules/.vite/deps/react-dom.js`
 * — technically a correct location and useless to a person reading the report. Widening the shared
 * regex would have changed every existing caller to answer a question they did not ask.
 *
 * 🔒 **THE EXTRACTION LIVES HERE, ON THE SERVER, BECAUSE THE CAPTURES LIVE IN SANDBOX SCRIPTS.** All
 * three sites are JavaScript inside a TypeScript template literal, run inside the sandbox — they
 * cannot import this module, and a copy of these rules in each of them is precisely the drifted-copy
 * class this repo has paid for repeatedly (four `safeRelPath`s, two complex-app detectors). So the
 * scripts' only new job is to STOP DISCARDING the stack; every rule about what a frame means is here,
 * in one tested place.
 *
 * PURE. No I/O, no clock, never throws.
 */
import { parseLocation } from '../AppMakerLab/intelligence/LogIntelligenceEngine';

/** A location in the user's own source, as the report and the repair prompt will name it. */
export interface RuntimeErrorSite {
  /** Repo-relative where we can make it so (`src/App.tsx`); otherwise exactly what the frame said. */
  file: string;
  line: number;
  column: number;
}

/**
 * Frames that are NOT the user's app, even though they carry a perfectly valid file:line:col.
 *
 * ⚠️ Conservative on purpose: a frame this cannot classify is KEPT, because naming a slightly-wrong
 * file still points a reader at the right area, while naming `react-dom.js` on every crash would
 * teach everyone to ignore the field.
 */
const NOT_THE_APP = [
  /node_modules/,
  /\/@vite\//,
  /\/@react-refresh/,
  /\/@fs\//,
  /\/@id\//,
  /chrome-extension:\/\//,
  /^\s*at\s+node:/,
  /\/\.vite\//,
];

/** How much of a stack is worth walking — a real crash's own frame is never 60 deep. */
const MAX_FRAMES = 40;

/**
 * Two things have to go before the shared parser is asked, and BOTH were found by this module's own
 * tests rather than reasoned about:
 *
 * 1. **The origin.** `FILE_LOC`'s character class contains digits, so `http://localhost:5173/src/App.tsx`
 *    matched from the PORT and produced `5173/src/App.tsx` — a path that exists nowhere. Dropping
 *    `scheme://host:port` leaves `/src/App.tsx`, which `repoRelative` turns into a path someone can open.
 * 2. **Vite's HMR query.** A hot-reloaded module is served as `src/App.tsx?t=1758…`; that class stops at
 *    `?`, so the `:line:col` no longer follows the extension and the frame silently did not parse at all.
 *
 * Both are fixed HERE rather than in `FILE_LOC`, so every existing caller of the shared parser is
 * untouched.
 */
function cleanFrame(line: string): string {
  return line
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^/\s)'"]*/gi, '')  // scheme://host[:port]
    .replace(/\?[^\s:)'"]*/g, '');                      // ?t=… , ?import , ?v=…
}

/** `/src/App.tsx` → `src/App.tsx`. A path we cannot shorten is returned as-is. */
function repoRelative(file: string): string {
  return file.replace(/^\/+/, '');
}

/**
 * The first frame of the app's OWN code in a stack, or null when the stack names none.
 *
 * Accepts the whole captured string — message line included — because a message that DOES embed a
 * path is still a correct answer, and because the three capture sites each hand over a slightly
 * different shape. `null` means "this stack does not tell us", never a guess: an unattributed crash
 * must read as unattributed, exactly as `RUNTIME_UNCHECKED` reads as unchecked.
 */
export function appSourceFrame(stack: string | null | undefined): RuntimeErrorSite | null {
  const text = String(stack ?? '');
  if (!text.trim()) return null;
  const lines = text.split('\n').slice(0, MAX_FRAMES);
  for (const raw of lines) {
    if (NOT_THE_APP.some((re) => re.test(raw))) continue;
    const loc = parseLocation(cleanFrame(raw));
    if (!loc) continue;
    const file = repoRelative(loc.file);
    if (!file) continue;
    return { file, line: loc.line, column: loc.column };
  }
  return null;
}

/**
 * The display form, deliberately identical in shape to `locationTag`'s — a reader must not have to
 * learn two notations for one idea. Empty string when there is nothing to say.
 */
export function siteTag(site: RuntimeErrorSite | null | undefined): string {
  if (!site || !site.file) return '';
  return ` [at ${site.file}:${site.line}:${site.column}]`;
}

/** Convenience for a caller holding a raw stack: the tag, or '' when no app frame is in it. */
export function siteTagFromStack(stack: string | null | undefined): string {
  return siteTag(appSourceFrame(stack));
}
