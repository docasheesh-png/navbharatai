// Fetching a font before the canvas measures with it (admin-asked 2026-09-21).
//
// 🔴 WHY THIS IS NOT ONE LINE OF CSS. A `<link>` makes the font available to the PAGE eventually; a
// canvas does not wait. `measureText` with a family the document has not finished loading silently
// measures in the FALLBACK face, so the text is laid out and wrapped at one set of widths and then
// repainted at another the moment the real font arrives — the preview the user positioned is not the
// file they save, and nothing fails to reveal it. So every repaint waits for a verdict from here.
//
// 🔴 THE VERDICT USED TO BE `document.fonts.check()`, AND THAT IS WHY "FONT CHANGE DOES NOT WORK"
// (admin 2026-09-21: "text ka font change kiya par ho nahi raha hai"). Measured in a real Chromium
// against a stylesheet that took 1.5 s to arrive: `fonts.load()` resolved in 0 ms having matched
// NOTHING, `fonts.check()` answered TRUE, and the canvas measured "Hello World" at 423.8 px in the
// fallback against 355 px in the real face. `check()` is true when NO face of that family exists yet —
// it means "nothing is pending", not "the face is here" — and it is equally true for a family Google
// refuses outright, so the "could not be loaded" warning could never fire either. The editor set the
// font to `ready`, painted in the fallback, and had no reason to ever paint again.
//
// 🔑 THE FIX IS THE ORDER, AND THE PROOF. First the STYLESHEET, awaited on its own `load`/`error` —
// that is the event which decides whether the family's faces exist at all. Then `fonts.load()` for
// both weights, and the verdict is the FACES IT RETURNED: at least one, every one `loaded`. Nothing
// here asks `check()` for a verdict any more; a test asserts that it cannot creep back.
//
// 🔒 AND IT NEVER LIES ABOUT SUCCESS. A blocked network, an ad blocker, an offline phone, a family
// name Google does not serve (HTTP 400 — the `<link>` fires `error`), a policy that blocks the
// stylesheet — each ends with `false`, so the editor can SAY the font could not be loaded rather than
// quietly drawing in something else. The second absolute rule applies to a dropdown as much as to a
// button: the option either works or it says it does not.

import { fontChoice, googleFontHref } from './imageFonts';

/** One in-flight (or settled-true) promise per font id — ten layers on one face must not fetch it ten times. */
const inFlight = new Map<string, Promise<boolean>>();
/** The stylesheet's own outcome per font id, so a second font on the same family waits for the same `<link>`. */
const sheets = new Map<string, Promise<boolean>>();

/** The element id a family's stylesheet is parked under, so the set survives a component remount. */
const linkId = (id: string) => `nbai-font-${id}`;

/**
 * Append the family's stylesheet and resolve with whether it ARRIVED — `true` on `load`, `false` on
 * `error` (a 400 for a weight the family does not publish, a blocked host, an offline device).
 *
 * ⚠️ A failed stylesheet is REMOVED, not remembered: the commonest cause is a connection that has
 * since come back, and the user's retry (choosing the font again) must really fetch again. A
 * `<link>` already in the document from an earlier mount is trusted only if its `sheet` exists.
 */
function ensureStylesheet(id: string): Promise<boolean> {
  const href = googleFontHref(id);
  if (!href) return Promise.resolve(true);
  const pending = sheets.get(id);
  if (pending) return pending;
  if (typeof document === 'undefined') return Promise.resolve(false);
  const existing = document.getElementById(linkId(id)) as HTMLLinkElement | null;
  if (existing) {
    const ok = Promise.resolve(Boolean(existing.sheet));
    if (existing.sheet) sheets.set(id, ok);
    return ok;
  }
  const run = new Promise<boolean>((resolve) => {
    const link = document.createElement('link');
    link.id = linkId(id);
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve(true);
    link.onerror = () => {
      sheets.delete(id);
      link.remove();
      resolve(false);
    };
    document.head.appendChild(link);
  });
  sheets.set(id, run);
  return run;
}

/**
 * Make a font id really usable by a 2D context, and answer honestly whether it is.
 *
 * Both weights are requested because the editor's Bold button switches between them at draw time: a
 * layer that loaded only 400 and is then set bold would be laid out in synthesized bold at one width
 * and — if 700 arrived later — repainted at another. A single-weight display face (Anton, Lobster…)
 * answers both asks with its one face, which is why the rule is "at least one face, all loaded" and
 * not "exactly two".
 *
 * ⚠️ A DEVICE WITH NO `document.fonts` GETS `true`, NOT `false`. That API is the only way to know,
 * so its absence is "cannot answer", and this repo's own rule for that (see `devanagariRendersHere`)
 * is not to raise a warning it cannot justify. The CSS stack still resolves the family if it is
 * there; if it is not, the fallback draws and the picture is readable either way.
 */
export function loadImageFont(id: string): Promise<boolean> {
  const choice = fontChoice(id);
  // The default stack is the device's own fonts — nothing to fetch, nothing that can fail.
  if (!choice.family) return Promise.resolve(true);

  const existing = inFlight.get(choice.id);
  if (existing) return existing;

  const run = (async () => {
    try {
      // 1. The stylesheet, awaited — the fact that decides whether any face of this family exists.
      if (!(await ensureStylesheet(choice.id))) return false;
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (!fonts || typeof fonts.load !== 'function') return true;
      // 2. The faces. `load()` resolves to the FontFace objects it matched AND loaded; that array is
      //    the verdict. Empty means the family has no face here, however the stylesheet fared.
      const family = `"${choice.family}"`;
      const faces = (await Promise.all([
        fonts.load(`400 64px ${family}`),
        fonts.load(`700 64px ${family}`),
      ])).flat();
      return faces.length > 0 && faces.every((f) => f.status === 'loaded');
    } catch {
      // `load()` REJECTS when a matched face's file fails to fetch — a real "could not be loaded".
      return false;
    }
  })();

  inFlight.set(choice.id, run);
  // A failure is not cached: a font that could not load on a dead connection must be retryable when
  // the connection comes back, and the user's retry is simply selecting it again.
  void run.then((ok) => { if (!ok) inFlight.delete(choice.id); }).catch(() => inFlight.delete(choice.id));
  return run;
}
