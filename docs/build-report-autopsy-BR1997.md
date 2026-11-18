# BR1997 — a shell `rm` deleted a stylesheet the app entry still imported; the bash result now names any module that still imports a deleted file

Scope: BR1997 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `2c66e533` (BR1996, #4273). Read only via the read-only failed-BR MCP tools (`list_build_reports`, `get_build_report`). No remote autopsy write, replay, deploy, provider call, or production read or write happened outside those tools. Routing, billing, Router One and Pro Chain V2 admission were not touched.

## What the report holds (described generically; no request text, ids or timestamps)

- **The request:** a small one-line new-app request for a vite-react web tool on the free Weak tier. Surplus delivered every turn, with no Claude.
- **Outcome:** SUCCEEDED, gate YELLOW (no user journey could be derived). The app rendered in a real browser at the end.
- **Billing:** not charged (free build). No amount is discussed here, and owner rule t362u is not affected.
- **Time:** the ETA shown was 4–10 min. The build took about 15 min. About 7.5 min of that was the repair described below.
- **Truncation:** complete. The report is retained.

The order, in seconds after the report's start (rounded):

1. **About 7–94 s.** The fast lane planned and wrote 11 files, including two stylesheets under `src/assets/styles/`. At about 94 s the platform "wired 1 orphaned global stylesheet into the entry", so `src/main.tsx` gained a side-effect import of one of them.
2. **About 96–124 s.** One repair round, then the typecheck passed, missing React packages were installed, and the dev server started. The app first rendered at about 129 s.
3. **About 126–388 s.** The design-consistency heal ran (one page lacked an empty state). At about 281 s the builder said it had found "duplicate CSS files" and ran `rm` on the stylesheet the entry imported. The deletion was confirmed and recorded (FILE_DELETED). Nothing told the builder that `src/main.tsx` still imported the file. The later `tsc --noEmit` exited 0, because tsc does not resolve a side-effect CSS import.
4. **About 388–410 s.** Finishing passes wrote 9 files. POST_GREEN_RECHECK_OK said the app still rendered.
5. **About 422 s.** The real-browser check found a build-error overlay (HTTP 500 on the entry module). The user saw "I opened the preview and it didn't render correctly … Fixing it now…".
6. **About 428–892 s.** Repair: two exploration-only hand-backs and two edit misses. The builder then removed the bad import from the entry. The app rendered again at about 892 s.

## Root causes

| # | Defect in this report | Root cause | Closed by | Lock |
|---|---|---|---|---|
| D1 | A shell `rm` deleted a stylesheet that `src/main.tsx` still imported. The builder was not told, the typecheck could not see it, and the dangling import cost about 7.5 min of repair after the user saw a broken preview. | The shell-deletion path (Q-246) confirms each removal and tells the save and the graph, but nobody checked whether a remaining module still imports the removed file. The project graph keeps only `from` imports, so a side-effect `import './x.css'` is invisible to it as well. | **F1 ✅ RESOLVED (advisory note, never a refusal; reworked after review).** After a shell command's deletion is confirmed, the builder's bash result names each module whose **current** sandbox text has a live, relative, **extensioned** import that joins to exactly a deleted path, for example "[deleted-file check] ⚠️ A file this command deleted is still imported: src/main.tsx imports './assets/styles/x.css' (src/assets/styles/x.css is gone) … Remove or repoint the import, or restore the file". **Precision:** a small tokenizer skips comments (including a trailing `//`), string literals and template literals, so an import-like pattern in text is never read as an import. An extensionless or directory specifier (`./foo`) is never named, because a remaining sibling (`foo.tsx`, `foo/index.ts`) may still serve it; tsc already reports a missing TS module. Bare and alias specifiers, importers that were also deleted, and unreadable files give no note. **Bounded (audit P0-C):** the candidates are the build's recorded JS/TS files, likely entry modules first (shallow `main`/`index`/`App`, then deeper ones, then the rest), at most 60. They are read 12 at a time, 5 s each, within an 8 s wall-clock budget; on expiry the pass uses what it has read, and the bash result never waits longer. The read is `E2BActuator.readFileAdvisory`, which shares `fileOp` but whose timeout does **not** drop the cached sandbox (a dead-sandbox error is handled as for every read); `readFile` is unchanged. **Visibility:** the note is added after the terminal line, so it is not in the user's terminal, and the `tool_result` summary strips it (`withoutDeletedImportNote`, a no-op on content without the note). No importer means the result is byte-identical to main. `reconcileDeletions` returns its confirmed list; its other caller ignores it. Kill switch: `AGENTV3_DELETED_IMPORT_NOTE=off`. Pure logic in `src/server/AgentV3/deletedImportNote.ts`. | `tests/br1997Autopsy.test.ts` (38 tests). Pure: CSS side-effect import, parent-relative, `require`, explicit `.ts`, a `?inline` suffix; the tokenizer (multi-line, `export … from`, dynamic import, member calls, a `from` variable); `exactImportTarget`. Neighbours: siblings (`foo.tsx`, `foo/index.ts`), another extension, no importer, a similar name, bare and alias specifiers, comments including a trailing `//`, strings and templates, a deleted importer, non-source importers, empty input. Budget: a stalled read hits the per-file timeout; stalled reads hit the overall budget; at most 12 in flight. Ordering. E2B: an advisory timeout keeps the sandbox, and a plain `readFile` timeout still drops it. End to end on the real dispatcher: the report's shape; not in the terminal or the summary; entry read first with 100 recorded files; stalled reads return within 8 s on a fake clock; the advisory read is used; no importer is byte-identical to the switch-off run; switch off; importer already repointed; unreadable importer; an `rm` that removed nothing. Source pins. |
| D2 | POST_GREEN_RECHECK_OK at about 410 s said the app still rendered, about 12 s before the real-browser check found the build-error overlay. The import had been dangling since about 281 s. | Not established from the report. The recheck may have read a page the dev server had not yet recompiled, or the overlay may not have been detected by that check. | **🟡 BLOCKED — Q-2712** | Not changed: the cause is not proven, and a stricter recheck could start failing healthy builds |
| D3 | The platform's orphan-stylesheet wiring added an import the builder did not write, so the builder took that stylesheet for an unused duplicate | Wiring an orphan stylesheet into the entry is intended (it styles the app). The harm was the silent delete, which F1 now reports. | Not changed: covered by F1 | F1 |
| D4 | SIMPLE_BUILD_SUCCESS and OUTCOME_BUILD_PARTIAL were both recorded at the fast-lane finish | Admin-only events. The fast lane "succeeded" (files built, preview listening) before the render was proven; the final outcome was BUILD_SUCCESS. | Not changed: admin only, and the final outcome is right | — |
| D5 | The ETA (4–10 min) was overrun about 1.5× past its top | The repair in D1 and the post-green passes | Not changed: D1's fix removes the main cause | — |
| D6 | TIME_TO_FIRST_CALL "0s" | A backfilled call against a 0 s window | **✅ Already closed on main by BR1958 (#4132)** | `tests/br1995Autopsy.test.ts` E2 |

**BR1992 review residual:** AgentRunner takes `recordModel` once at `run()` start. Every turn here was Surplus and no fall-back happened, so it is **not** on this path. Not changed.

## Side-effect review (owner rule t311u)

| Change | Adjacent behaviour | Check | Decision |
|---|---|---|---|
| F1: the dangling-import note | A shell delete that nothing imports | Byte-identical output to the switch-off run (end-to-end test) | Ship |
| F1 | Commands that delete nothing, or whose deletion is not confirmed | `reconcileDeletions` returns an empty list, so nothing is read and nothing is added | Ship |
| F1 | The graph prune before the gate also calls `reconcileDeletions` | It ignores the new return value; pinned unchanged | Ship |
| F1 | False positives | Only a relative import that resolves exactly to a deleted path, in the importer's current text, with comments stripped. Similar names, packages, aliases and repointed importers give nothing (tests). | Ship |
| F1 | Time on the bash critical path (audit P0-C; the first version read up to 60 files one after another with only `fileOp`'s 30 s bound, and failed review for it) | Reads happen only after a confirmed shell delete (rare): 12 at a time, 5 s each, 8 s in all, then whatever was read is used. Tests: a stalled read, stalled reads against the budget (fake clock, end to end), the concurrency bound | Ship |
| F1 | The cached sandbox (`fileOp` drops it on a timeout) | The note reads with `readFileAdvisory`, whose timeout keeps the handle; `readFile` and every other `fileOp` caller keep today's eviction (both pinned by tests). An actuator without the advisory read (Docker, Local) has no timeout eviction to begin with | Ship |
| F1 | Extensionless imports (`./foo`) | Never named: a remaining sibling may serve them, and tsc reports a missing TS module. Fewer notes, never a wrong one | Ship |
| F1 | Users | The note is added after the terminal line and stripped from the `tool_result` summary, so it reaches the builder only. It holds only project file paths, with no provider, admin or money text. The strip matches the note's exact opening, so other output is unchanged (test) | Ship |
| F1 | Commands, files and the delete itself | Never refuses, edits or restores anything | Ship |
| Make the post-green recheck stricter (D2) | Every build's finishing verdict | — | **Not shipped** → Q-2712 |

## Queue

- **Q-2712 (BLOCKED):** POST_GREEN_RECHECK_OK reported a rendering app while a dangling import had already broken the dev server.

No row is closed.

Lessons carried:
- BR1982 and BR1990: the note fires only on positive evidence, with false-positive neighbour tests.
- BR1983: no admin or provider text reaches users.
- BR1987: no Node path or charge changed.
- BR1989: no parser change; the existing `importSpecifiers` and `resolveLocalImport` are reused.
- t362u: no money text is touched.
