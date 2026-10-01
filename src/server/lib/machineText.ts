/**
 * Machine text (URLs, `scheme:` tokens, stack frames) blanked out of a request before any
 * keyword reader looks at it. PURE.
 *
 * 🔴 THE CLASS (autopsy 33812996, 2026-09-30). A "Circle to Search" request ended with its reference
 * link — `https://play.google.com/store/apps/details?id=com.circletosearch.android`. The word
 * `store` inside that URL made the requirement analyser file it as an ECOMMERCE app (payments, cart,
 * checkout, orders, inventory), and the URL's path segments turned two modules into six in the build-
 * time estimate. The same shape had been fixed once already, for ONE reader: the feature-request
 * detector (autopsy "Lekhan Sahyak", 2026-09-27) stopped reading `about:srcdoc` as "an About page".
 * The other readers were never hunted, so the rule now lives here and every reader that asks "what
 * did the user ask for?" calls it.
 *
 * Blanked, not deleted: offsets and lengths of the surrounding text are kept, so a reader that looks
 * at a window around a word (negation, deferral) sees the same neighbourhood it always did.
 *
 * ⚠️ PRECISION-FIRST, the same asymmetry as the domain analyser: blanking a URL can only REMOVE
 * evidence. A reference link to a restaurant's site no longer names the restaurant domain — that
 * costs today's no-guidance behaviour. Reading a path word as a feature costs a build of things
 * nobody asked for.
 */
import { isPastedSource, pastedVisibleText, readablePrompt } from './pastedSource';

export function withoutMachineText(text: string, opts: { drop?: boolean; keepPasted?: boolean } = {}): string {
  // `drop` REMOVES instead of blanking — for a reader that measures the request's SIZE, where a
  // 90-character link is not 90 characters of request.
  const gone = (m: string) => (opts.drop ? '' : ' '.repeat(m.length));
  // `keepPasted` — for the readers that size the BUILD (complexity, the time estimate): a pasted app's
  // own code is honest evidence of how big the app is, and routing on it worked (autopsy a106df77).
  const text0 = String(text ?? '');
  return withoutUrlsAndFrames(opts.keepPasted ? text0 : requestWords(text0), gone);
}

/**
 * 🔴 PASTED SOURCE IS MACHINE TEXT TOO (autopsy a106df77, 2026-10-01). A whole HTML app pasted into the
 * build box was read word by word as the request: `.tabs` in its CSS asked for a filter, `removeItem`
 * in its script asked for delete. What a reader should see is what the user wrote around the paste,
 * plus the words a visitor reads on the pasted page — its tabs, buttons and headings ARE the request.
 * An ordinary prompt is returned unchanged.
 */
function requestWords(text: string): string {
  if (!isPastedSource(text)) return text;
  return [readablePrompt(text), pastedVisibleText(text)].filter(Boolean).join('\n');
}

function withoutUrlsAndFrames(text: string, gone: (m: string) => string): string {
  return text
    // Stack frames: "    at App (eval at requireModule (about:srcdoc:739:12), <anonymous>:22:46)".
    .replace(/^[ \t]*at [^\n]*$/gm, gone)
    // URLs and scheme tokens: https://…, about:srcdoc, blob:…, data:…, file:…, chrome-extension://…
    .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|(?:about|blob|data|file|javascript|webpack|node):(?=[^\s]))[^\s)'"]*/gi, gone)
    // A bare web address with no scheme: www.example.com/…, play.google.com/store/…
    .replace(/\b(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|in|org|net|io|app|dev|co|ai|me|xyz|info|gov|edu)\/[^\s)'"]*/gi, gone);
}
