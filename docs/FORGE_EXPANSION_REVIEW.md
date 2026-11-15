# Forge expansion follow-up to #4236

Base: d73f0349c30b0058bd1c2dd34a03ba66fcb9f2c8.

- Repeated-ancestor identity: A0/B1/C and A1/B0/C previously both became C_1p. Branch-depth suffixes distinguish the copies. The equivalent nested-mirror collision is repaired too. Simple single-parent repeat/mirror names remain unchanged; deeply branched names change, so callers relying on those generated names should regenerate references together with the kit.
- Expansion budget: the old 400-node validation happened after multiplicative repeat/mirror expansion. The engine now stops before emitting node 401; validation reports a normal refusal. This caps expanded nodes, not arbitrary input bytes, input traversal, or all possible geometry resource use. Existing shape/depth/triangle validation remains necessary.
- Subject selection: the longest matching token phrase at the earliest subject position wins, so 'bullet bike' selects bike, not rail. First-subject ordering and token boundaries remain enforced.
- Prompt honesty: repeated copies share geometry but still cost node, transformation, drawing and rendered-triangle resources.

Validation: 67 targeted tests passed (new 9 regressions plus 58 subject/spin/example tests), using the repository-owned engine and checker. Reverting the original two repairs made 3 of the initial 4 regressions fail. Tests cover nested/mixed repeat and mirror identities, parent links, geometry sharing, translated child meshes, exactly 400 nodes, refusal on node 401, and bounded refusal of a six-level 64-copy tree. No model/provider calls were made. Independent static review found no blocker to this scoped draft.

A broader focused-suite attempt had 134 test assertions pass but one suite could not load because this isolated checkout lacks SecurityAnalysis; this is NOT full CI. Full exact-tree local CI, hosted checks and browser/mobile validation remain pending. No merge, deployment or public activation is included.

This patch does not resolve the separate #4228 write atomicity, global cache isolation, or admitted AI-accounting work. Do not infer general Forge safety from these narrow checks.

## Hosted failure follow-up
The initial draft hosted run failed three tests: current generated engine digest was not registered (causing two history-test failures), and the early node-limit diagnostic broke an existing message contract. The fix records both the initial draft and current engine digests, preserving all old history, and reports the truthful lower bound "expands to 401 nodes or more; the limit is 400" without raising the limit. The official history generator reported one new current digest. The three failed test files plus the Forge suites now pass locally: 7 files, 255 tests. Full latest combined-tree CI remains required; this focused result does not replace it.
