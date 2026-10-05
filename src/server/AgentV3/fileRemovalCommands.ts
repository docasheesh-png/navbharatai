// THE COMMANDS THAT DELETE ONE FILE — one list, read by every delete guard (Q-118 sibling hunt, 2026-10-05).
//
// Three parsers each spelled the delete verbs by hand: `singleSourceDeleteTargets` and
// `runtimeManifestDeletionTarget` (CommandGovernance.ts) and `shellRemovalTargets` (shellWriteTargets.ts).
// All three knew `rm` and `unlink`; none knew `shred`. So `shred -u src/components/Cart.tsx` deleted a
// source file past the still-imported-file guard, the runtime-manifest guard, the user-file guard and the
// requested-feature guard at once — four guards with the same blind spot, because each kept its own copy
// of the list. `shred` without `-u` leaves the file in place full of random bytes, which breaks every
// importer exactly as a delete does, so it counts with or without the flag.
//
// `tests/aRequestedFeatureFileIsNotDeleted.test.ts` fails when a guard spells the verbs itself again.
// PURE.

/** Commands whose operands are files that stop existing (or stop being code). */
export const FILE_REMOVAL_COMMANDS: ReadonlySet<string> = new Set(['rm', 'unlink', 'shred']);

const VERBS = [...FILE_REMOVAL_COMMANDS].join('|');

/** One shell segment that removes files: `rm a b`, `unlink a`, `shred -u a`. Group 1 is the operand list. */
export const FILE_REMOVAL_SEGMENT_RE = new RegExp(`^(?:${VERBS})\\s+(.+)$`, 'i');

/** The same, also matching `git rm` — for guards that refuse a delete whatever tool performs it. */
export const FILE_REMOVAL_OR_GIT_RM_SEGMENT_RE = new RegExp(`^(?:${VERBS}|git\\s+rm)\\s+(.+)$`, 'i');
