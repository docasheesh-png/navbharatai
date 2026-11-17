# BR1998 — a message that was pasted source code was told "I could not find @override in this project"; annotations in pasted code are no longer reported as missing files

Scope: BR1998 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `8e5fec7b` (BR1997, #4274). Read only via the read-only failed-BR MCP tools (`list_build_reports`, `get_build_report`). No remote autopsy write, replay, deploy, provider call, or production read or write happened outside those tools. Routing, billing, Router One and Pro Chain V2 admission were not touched.

## What the report holds (described generically; no request text, ids or timestamps)

- **The request:** the whole message was one pasted mobile-framework source file (Dart), sent to an existing vite-react project of about 20 of the user's own files. Free Weak tier. Surplus delivered every turn, with no Claude.
- **Outcome:** SUCCEEDED, gate YELLOW (no save-and-reload journey could be reached). The app rendered in a real browser at about 176 s and again at the end.
- **Billing:** not charged (free build). No amount is discussed here, and owner rule t362u is not affected.
- **Time:** a rough estimate of 4–12 min was shown, labelled a guess. The build took about 19 min.
- **Truncation:** complete. The report is retained.

The order, in seconds after the report's start (rounded):

1. **About 4 s.** The message read as an order to build and was turned into an edit, because the workspace already had files (BUILD_ORDER_READ_AS_EDIT).
2. **About 8 s.** The user was shown "⚠️ I could not find @override in this project, so I worked from the rest of your message." `@override` is a Dart annotation in the pasted code, not a file the user named.
3. **About 15–465 s.** The builder restyled the existing app. Its readiness check flagged two features as placeholders. The builder argued that they were intentional and ended its turn, and the platform resumed it (resume 1 of 2).
4. **About 479–1010 s.** A frontend specialist replaced the placeholders with working features. It had one edit miss and one exploration hand-back. The readiness check then read 100/100.
5. **About 1055–1180 s.** Summary, end-of-build checks (render, mobile layout, two controls pressed, production build), and settle.

## Root causes

| # | Defect in this report | Root cause | Closed by | Lock |
|---|---|---|---|---|
| D1 | "⚠️ I could not find @override in this project" was shown for an annotation inside the user's pasted code | `MENTION_RE` in `fileMentions.ts` treats `@` after whitespace as a file mention. The guard was meant to exclude decorators in pasted code, but an indented annotation sits after whitespace, so it matched, resolved to no file and was reported as missing. | **F1 ✅ RESOLVED.** An **unresolved** token is dropped as a code annotation only when all three hold: it is a bare identifier (no `.`, `/` or `-`); it is the first thing on its line; and the message looks like pasted code (at least 3 lines ending in `{`, `}` or `;`). Resolved mentions, path-shaped tokens, mid-line mentions and ordinary messages behave exactly as before, so for any message that is not pasted code the result is byte-identical. Pure and linear in the message length: no I/O, so nothing is added to a tool or bash critical path. | `tests/br1998Autopsy.test.ts` F1 (the report's shape with synthetic Dart; Java `@Override` at column 0, Kotlin `@Composable fun`, TS `@Component({`). Neighbours: English, Hinglish and Hindi messages naming a missing file at line start; path-shaped missing mentions in a code message; a mid-line mention in a code message; two code lines are not enough; Python decorators still reported; resolved mentions (including a bare `@Makefile`) unchanged; email and no-mention messages; `looksLikePastedCode`; a 200 KB message stays fast. Source pin that the route still emits the notice. The existing `fileMentions.test.ts` passes unchanged. |
| D2 | The builder ended its turn calling the placeholder features intentional, and the platform had to resume it | Model judgement. The platform's resume (UNFINISHED_BUILD_RESUMED) worked as designed and the features were then built for real. | Not changed: the existing resume handled it | — |
| D3 | USAGE_NOT_REPORTED (a provider sent no token counts) | Admin-only cost under-count, with no user-visible effect | Not changed: already tracked as **Q-2414** | — |
| D4 | The ETA (4–12 min, labelled a guess) was overrun about 1.6× past its top | A large edit with a resume and a specialist pass. The user was told it was a rough guess. | Not changed | — |
| D5 | TIME_TO_FIRST_CALL "0s" | A backfilled call against a 0 s window | **✅ Already closed on main by BR1958 (#4132)** | `tests/br1995Autopsy.test.ts` E2 |
| D6 | `npm test` failed with "Missing script", and one `edit_file` miss | Builder tool use; both were recovered in the build | Not changed: no platform defect | — |

**BR1992 review residual:** AgentRunner takes `recordModel` once at `run()` start. Every turn here was Surplus and no fall-back happened, so it is **not** on this path. Not changed.

## Side-effect review (owner rule t311u)

| Change | Adjacent behaviour | Check | Decision |
|---|---|---|---|
| F1: drop an unresolved annotation in pasted code | A user who names a missing file in an ordinary message (English, Hinglish, Hindi) | Still told, unchanged (tests) | Ship |
| F1 | A user who names a missing path (`@src/Missing.tsx`, `@Missing.tsx`) inside a code message | Still told: path-shaped tokens are never dropped | Ship |
| F1 | Resolved mentions, the scope block and the cap | Untouched: only the unresolved branch changed (tests, including a bare `@Makefile` at line start in code) | Ship |
| F1 | A user who writes a bare `@Name` at the start of a line inside pasted code and means a missing file | Not told any more. It would not have resolved anyway, because a bare name has no extension. This is the one narrowed case. | Ship |
| F1 | Python and other brace-less code | Still reported, as before. Conservative: silence only when the code shape is certain | Ship |
| F1 | Critical-path cost (lesson from BR1997) | Pure string work, linear, computed lazily once per message; no I/O, no timers (200 KB test) | Ship |

## Queue

No new row. D3 is already tracked as Q-2414. No row is closed.

Lessons carried:
- BR1982 and BR1990: the guard drops a notice only on positive evidence, with false-positive neighbour tests.
- BR1983: no admin or provider text reaches users.
- BR1985/86: English, Hinglish and Hindi tests of the opposite class.
- BR1987: no Node path or charge changed.
- BR1989: the mention regex is unchanged; the new check is a separate, line-anchored test.
- BR1997: nothing is added to a tool or bash critical path.
- t362u: no money text is touched.
