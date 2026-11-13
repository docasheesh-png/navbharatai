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
