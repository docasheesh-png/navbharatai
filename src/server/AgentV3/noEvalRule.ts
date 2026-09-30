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

/**
 * BUILD WHAT WAS ASKED (autopsy 53a621e3, 2026-09-30). Asked for a basic calculator — digits, four
 * operators, C, backspace, equals — the build added sin/cos/tan/log/ln/sqrt/π/powers/parentheses and a
 * history panel, pulled in mathjs for them, and shipped a 788 KB bundle for a four-function keypad. Every
 * unrequested feature is more code to get wrong, more tokens billed, and a screen that no longer matches
 * what the user described. The requirement notes (RequirementGapAnalyzer) remain the ONE sanctioned
 * source of additions a prompt left implicit; anything else is offered, not built.
 */
export const BUILD_WHAT_WAS_ASKED_RULE =
  '- Build what the user asked for. Do not add features, screens or buttons they did not ask for (unless the ' +
  'build\'s own requirement notes list them); mention at most one or two optional extras in your final message instead.';

/**
 * NEVER FAKE A FEATURE'S RESULT (autopsy 33812996, 2026-09-30). Asked for a Circle to Search app with
 * music recognition, screen translation, AI overview and multi-engine search, the build shipped a song
 * "recognised" by `MOCK_DB[Math.random() * MOCK_DB.length]`, a translator returning `[Translated to hi]: …`,
 * and search results and AI overviews written into the code — and the summary described every one as a
 * working feature. NO_INVENTED_PEOPLE_RULE covered made-up PEOPLE; this is its sibling for made-up RESULTS.
 * Shared by both lanes, like the rules above.
 */
export const NO_FAKE_RESULTS_RULE =
  '- Never fake what a feature returns: song recognition that picks a random song, a translator that echoes ' +
  '"[Translated to X]: text", or search results and AI answers written into the code are not features. Call a ' +
  'real service (keyless where one exists — e.g. open the chosen search engine\'s results page), or, when the ' +
  'feature needs a key or a server the app does not have, show an honest "connect X to turn this on" state and ' +
  'say so in your final message. Sample entries shown for layout are labelled on screen as examples.';
