// AgentV3 — A ONE-FILE APP KEEPS ITS DESIGN: fold the linked stylesheet into index.html, deterministically.
//
// 🎨 WHY (admin 2026-09-30: "app/game ek dam simple se html bante hai — na koi design, na sundarta").
// When a user asks for the whole app in ONE html file, the static scaffold's design kit lives in
// `style.css`. The first version of the one-file rule told the model to copy that file into a <style>
// tag and delete it. A cheap model will not reproduce ~450 lines of CSS it did not write: it deletes
// the file and writes a few rules of its own, so every one-file app shipped without the kit — the plain
// look, by instruction. Moving a linked stylesheet into the page is not a judgement call, so it is done
// here, by construction, after the build: the model keeps the <link>, and the delivered app is still
// exactly one file.
//
// 🔒 WHAT IT WILL NEVER DO: invent CSS (it moves only the file the page already links), touch a page
// that does not link it, or run when the link cannot be found exactly — then nothing changes. PURE: the
// caller reads and writes the files.

/** A <link> to `href` whose rel is stylesheet, with the attributes in any order. */
function linkTagFor(href: string): RegExp {
  const esc = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<link\\b(?=[^>]*\\brel\\s*=\\s*["']?stylesheet["']?)(?=[^>]*\\bhref\\s*=\\s*["'](?:\\./)?${esc}["'])[^>]*>`, 'i');
}

/**
 * index.html with `<link rel="stylesheet" href="style.css">` replaced by a <style> block holding that
 * stylesheet, or null when the page does not link it. A `</style` inside the CSS (which would end the
 * block early) is escaped so the stylesheet cannot close its own tag.
 */
export function inlineLinkedStylesheet(indexHtml: string, href: string, css: string): string | null {
  if (typeof indexHtml !== 'string' || typeof css !== 'string' || !css.trim()) return null;
  const re = linkTagFor(href);
  if (!re.test(indexHtml)) return null;
  const safe = css.replace(/<\/style/gi, '<\\/style');
  return indexHtml.replace(re, () => `<style>\n${safe}\n</style>`);
}
