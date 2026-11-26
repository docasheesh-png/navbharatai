# Automatic game repair: safety suspension

The #4193 automatic post-playtest repair path is suspended in code, including
explicit environment opt-ins. `runGameRepair` itself returns a skipped receipt
without invoking repair, replay, changed-source or rollback callbacks. The normal
builder, manual user-requested edits, playtest and measured completion gate are
not disabled. A broken game remains reported as incomplete, not magically fixed.

## Verified risk

The former route captured only `collectWorkspaceFiles(...).files`. That collector
is best-effort deploy text, not a full backup: binaries, excluded files, oversized
files and failed reads can be omitted. The actuator's inventory is also bounded,
so even an empty `skipped` list is not proof of a complete inventory. Repair can
run commands that move, overwrite or remove omitted bytes. Restoring the text map
cannot undo those operations; partial inventories can also classify an existing
but uncaptured path as newly created. A failed automatic repair could therefore
lose or modify original project data. This is a reproducible code path, not
evidence that a particular production user has suffered loss.

## Scope and future release gate

This mitigation does not modify existing project files, delete data, migrate
storage, change live environment settings or deploy itself. It deliberately
suspends automatic mutation instead of promising rollback from an incomplete
snapshot. The old route callback wiring is unreachable and the helper also fails
closed for direct callers. Completion checks keep their previous policy.

Re-enabling requires a separate reviewed byte-preserving snapshot protocol with
complete inventory evidence, metadata and binary handling, atomic/fenced restore,
verified successful recovery, no races with active writers, quota/failure tests,
and the full exact-tree CI. Prefix inventories or a zero skipped count are not
substitutes. Existing unrelated repair paths are outside this narrow mitigation.

## 2026-11-21 — what replaced it (the suspension itself still stands)

The owner asked for game repair back "carefully": optional, asked of the user, and undoable in one prompt. That is
built WITHOUT re-enabling this path — `gameAutoRepairEnabled()` still returns false and `runGameRepair` is still a stub:

- **Fixing is the user's choice.** The playtest's problems are offered as the one-tap "Make the game playable" fix
  (`buildFindingSuggestions`, `GAME_PLAYTEST_ISSUES`); it runs only when the user taps it, as a normal turn.
- **A normal turn is versioned by the real version system,** not a private snapshot: every good build is saved whole in
  `BuildHistoryStore` (the Time Machine), and `/api/agentv3/restore-version` saves the current app before restoring.
- **Every turn on a measured game is compared with the game as it was measured before it** (`gameRegression.ts`). A turn
  that made it worse — a new unplayable defect, or a big score drop below the playable line — records `GAME_GOT_WORSE`
  with the saved version from just before the turn, and the ❗️ button carries a one-tap "Go back" (a row in the ❗️ "What you need to do" list, `gameUndo.ts`). Nothing is
  restored until the user taps.

None of the risks above apply: no repair runs unasked, and no rollback is made from an incomplete snapshot.

## 2026-11-26 — one narrow in-build repair, with a real way back (the suspension above still stands)

The admin approved (Q-3374) ONE bounded repair inside the build for placeholder findings only. It does not use this path:
`gameAutoRepairEnabled()` still returns false, `runGameRepair` is still a stub, and measured defects are still not repaired
automatically. What it does instead answers each requirement listed under "Scope and future release gate":

- **Complete inventory, binaries and metadata** — `gameWorkspaceBackup.ts` archives the WHOLE project tree with tar (modes,
  symlinks, hard links, every binary) outside the project, and writes a manifest of every path's type, mode, link target and
  the sha256 of every regular file. Only folders named `node_modules` and Vite's transient `*.timestamp-*.mjs` files are
  outside it, by declaration.
- **Fail closed** — a special file, a control character in a name, a tree over 400 MB, too little free space, or any tar
  warning (a file that changed or could not be read) means no backup, and then no repair.
- **Verified recovery** — a restore removes every non-directory outside the dependency folders, extracts the archive,
  removes directories the repair created, and compares a fresh manifest with the backup's byte for byte, checked against
  the backup's own fingerprint. A mismatch is reported as a warning and the backup is kept for recovery.
- **No races with active writers** — the repair runs with file tools only (every other tool is refused by the runner,
  `onlyTheseTools`), so it cannot run commands or installers; its pass is aborted and given 15 s to stand down before the
  restore starts; a write it made into a dependency folder is never kept and is reported as not restorable.
- **Narrow scope** — only when the findings are ALL MISSING_MODEL and/or EMPTY_MAP; kept only if the game, played again, has
  fewer placeholder findings, no new kind, no new defect and a score not lower.
- **Tests** — `tests/aGameRepairCanAlwaysGoBack.test.ts` runs the real backup and restore against a real directory for every
  scenario this document lists (binary move, binary delete, a file a text map never saw, a mode change, a swapped link, a
  created directory) and for each refusal; `tests/aPlaceholderIsRepairedInTheBuild.test.ts` covers the keep/undo decision.

Kill switch: `AGENTV3_GAME_PLACEHOLDER_REPAIR=off` (see `docs/claude/ENV_REGISTRY.md`).
