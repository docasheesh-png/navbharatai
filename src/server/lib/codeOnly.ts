/**
 * THE CODE OF A SOURCE FILE, WITHOUT ITS COMMENTS (admin plan 2026-11-24, item 1; weakness audit P0-4).
 *
 * The game checks decide facts about a generated game by reading its source: "does it have levels / enemies /
 * a restart button / a canvas / a vehicle?". They read the raw text, so a comment counted as code:
 * `// TODO: levels` satisfied the user's "levels" requirement, and `// add touchstart later` made a keyboard-only
 * game look touch-ready. A note about a feature is not the feature.
 *
 * Only comments are blanked. Strings and template literals are KEPT, because UI text that proves a feature
 * ("Play again", `Level ${n}`) lives in them. One left-to-right pass, so a `//` inside a string or a `/*` inside a
 * template is never taken for a comment. Length and newlines are preserved, so offsets and line numbers still
 * mean the same thing. PURE.
 */
export function withoutComments(src: string): string {
  if (typeof src !== 'string' || src.length === 0) return '';
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) out += src[k] === '\n' ? '\n' : ' '; };
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && c2 === '/') {
      let j = src.indexOf('\n', i);
      j = j < 0 ? n : j;
      blank(i, j); i = j; continue;
    }
    if (c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== '`') j += src[j] === '\\' ? 2 : 1;
      j = Math.min(j + 1, n);
      out += src.slice(i, j); i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      j = Math.min(j + 1, n);
      out += src.slice(i, j); i = j; continue;
    }
    out += c; i++;
  }
  return out;
}
