// Shared by the architect prompt (systemPrompt.ts) and the fast lane's per-file prompt (SimpleBuilder.ts).
// Its own module so neither prompt file has to import the other.

/**
 * NO eval FOR USER INPUT (autopsy 53a621e3, 2026-09-30). A calculator's first App.tsx evaluated the typed
 * expression with `new Function()`. The write-time security scan flagged it, and the rewrite (a parser, a
 * new file, two type errors) cost ~70 s of a 4.7-min build. Said once, up front, to BOTH lanes — the
 * fast lane's per-file prompt carries the same constant — so the first version is already the safe one.
 */
export const NO_EVAL_RULE =
  '- Never evaluate user-typed text with eval(), new Function() or setTimeout(string) — a calculator or ' +
  'formula field uses a real expression parser (e.g. `mathjs` evaluate, or a small tokenizer), from the first version.';
