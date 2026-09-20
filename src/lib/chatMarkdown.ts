/**
 * THE MARKDOWN SETUP EVERY CHAT SURFACE SHARES — and the line breaks it was dropping.
 *
 * 🔴 THE REPORT (admin, 2026-09-20, with a screenshot of a Hindi song in free chat). A four-line
 * mukhda arrived as ONE long line, with its own `[Mukhda]` label run into the lyrics beside it:
 *
 *     [Mukhda] धूल जमी है इन राहों पर, धुंधली सी यादें बाकी हैं। खोए हैं हम ऐसी रातों में, …
 *
 * **The model was not at fault, and that label is the proof.** `SONGCRAFT_DIRECTIVE` tells it in so
 * many words to *"Label each part on its own line"* and to keep each sung line separate — so the
 * label appearing INSIDE the lyric line is a break that was written and then thrown away. Only the
 * renderer could have done that.
 *
 * 🔑 THE CAUSE IS COMMONMARK ITSELF, which is why nothing looked broken. In CommonMark a single
 * newline inside a paragraph is a SOFT break and renders as a SPACE; only a blank line starts a new
 * paragraph. `react-markdown` follows the spec exactly and correctly. So a song, a poem, an address,
 * a shayari, a list of steps typed on plain lines — everything whose meaning IS its line breaks —
 * was silently flattened on every chat surface in this app.
 *
 * 🔎 AND NO SURFACE PASSED ANY PLUGIN AT ALL (rule 3, the siblings). Four `<ReactMarkdown>` call
 * sites, four times zero `remarkPlugins` — the drifted-copy class this repo keeps paying for, in its
 * cheapest form: nobody copied a mistake, everybody omitted the same thing. That omission also made
 * real code DEAD: `AIChat.tsx` carries styled `table` / `thead` / `th` / `td` components and a
 * task-list `input` component, and **GFM tables and task lists are not CommonMark** — without
 * `remark-gfm` not one of those components could ever fire. They had been written, reviewed and
 * shipped against a feature the renderer did not have.
 *
 * 🔒 WHY THIS IS ONE EXPORTED CONSTANT AND NOT A LINE IN EACH FILE. A per-file plugin array is how
 * the next surface gets added without one. `tests/theLineBreaksTheModelWrote.test.ts` reads the
 * source of every chat markdown surface and fails when one renders without these plugins, so a fifth
 * chat panel cannot quietly reintroduce the bug.
 *
 * ⚠️ WHAT `remark-breaks` REALLY CHANGES, stated rather than discovered later: EVERY single newline
 * becomes a `<br>`. If a model ever hard-wraps ordinary prose at 80 columns, that prose will now show
 * those wraps. That is the accepted trade and it is the same one GitHub comments, and every chat
 * product people compare us with, already make — because in a CHAT the author's newline is a
 * deliberate act, while a hard-wrapped paragraph is a habit models do not have. It is NOT applied to
 * curated long-form documents (see below).
 */
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { PluggableList } from 'unified';

/**
 * The plugin list for a CHAT surface — anywhere a person or a model is typing to someone.
 *
 * • `remark-gfm` — tables, task lists, strikethrough, autolinks. Restores the table and checkbox
 *   components that were already written for it.
 * • `remark-breaks` — a newline is a line break, because in a chat the author meant it.
 *
 * ⚠️ Deliberately NOT for `LegalDocPage` or any curated long-form document: those are authored as
 * wrapped prose in source files, so turning their wraps into visible breaks would change a page
 * nobody reported a problem with. The bug is about somebody's typed lines, not about our own copy.
 */
export const CHAT_MARKDOWN_PLUGINS: PluggableList = [remarkGfm, remarkBreaks];
