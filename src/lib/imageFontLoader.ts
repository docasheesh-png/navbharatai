// Fetching a font before the canvas measures with it (admin-asked 2026-09-21).
//
// 🔴 WHY THIS IS NOT ONE LINE OF CSS. A `<link>` makes the font available to the PAGE eventually; a
// canvas does not wait. `measureText` with a family the document has not finished loading silently
// measures in the FALLBACK face, so the text is laid out and wrapped at one set of widths and then
// repainted at another the moment the real font arrives — the preview the user positioned is not the
// file they save, and nothing fails to reveal it. `document.fonts.load()` is the only thing that
// answers "is it really here?", so every repaint waits for it.
//
// 🔒 AND IT NEVER LIES ABOUT SUCCESS. A blocked network, an ad blocker, an offline phone, a family
// name Google does not serve — each ends with `check()` false, and this returns false so the editor
// can SAY the font could not be loaded rather than quietly drawing in something else. The second
// absolute rule applies to a dropdown as much as to a button: the option either works or it says it
// does not.

import { fontChoice, googleFontHref } from './imageFonts';

/** Families whose stylesheet has already been requested, so a re-select costs no second `<link>`. */
const requested = new Set<string>();
/** One in-flight promise per font id — ten layers on one face must not fetch it ten times. */
const inFlight = new Map<string, Promise<boolean>>();

/** The element id a family's stylesheet is parked under, so the set survives a component remount. */
const linkId = (id: string) => `nbai-font-${id}`;

function ensureStylesheet(id: string): void {
  const href = googleFontHref(id);
  if (!href) return;
  if (requested.has(id)) return;
  requested.add(id);
  if (typeof document === 'undefined') return;
  if (document.getElementById(linkId(id))) return;
  const link = document.createElement('link');
  link.id = linkId(id);
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

/**
 * Make a font id really usable by a 2D context, and answer honestly whether it is.
 *
 * Both weights are requested because the editor's Bold button switches between them at draw time: a
 * layer that loaded only 400 and is then set bold would be laid out in synthesized bold at one width
 * and — if 700 arrived later — repainted at another.
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
      ensureStylesheet(choice.id);
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (!fonts || typeof fonts.load !== 'function') return true;
      const family = `"${choice.family}"`;
      await Promise.all([
        fonts.load(`400 64px ${family}`),
        fonts.load(`700 64px ${family}`),
      ]);
      // `load` resolves even when it matched nothing, so the verdict is `check`, never the await.
      return typeof fonts.check === 'function' ? fonts.check(`700 64px ${family}`) : true;
    } catch {
      return false;
    }
  })();

  inFlight.set(choice.id, run);
  // A failure is not cached: a font that could not load on a dead connection must be retryable when
  // the connection comes back, and the user's retry is simply selecting it again.
  void run.then((ok) => { if (!ok) inFlight.delete(choice.id); }).catch(() => inFlight.delete(choice.id));
  return run;
}
