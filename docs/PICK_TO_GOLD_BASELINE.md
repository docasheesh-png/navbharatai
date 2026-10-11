# PICK-TO-GOLD BASELINE

Measured on `origin/main` = **`23ece92a1`**, 2026-10-11, in the Claude Code cloud container
(node **v22.22.2**). This is the "before" state the suggestion's Phase 1 asks for, so that any later
refactor can be compared against something real rather than remembered.

**Every number here was produced by running the command.** Two measurements in the first pass were wrong
and are corrected below, with what caused each — a baseline that records a wrong failure is worse than no
baseline, because the next session plans around it.

---

## Result: `main` is GREEN. A large refactor is not blocked by a broken baseline.

| CI-equivalent step | Result | Time |
|---|---|---|
| `npm run typecheck` (frontend) | ✅ PASS | 19 s |
| `npm run native:guard` | ✅ PASS | <1 s |
| `npm run typecheck:server` | ✅ PASS | 48 s |
| `node scripts/noUnusedImports.mjs` | ✅ PASS | — |
| `npx vitest run` | ✅ **35,630 passed · 10 skipped · 0 failed** (2,446 files) | 582 s |
| `npm run build` | ✅ PASS | — |
| `npm run test:bundle` | ✅ PASS | — |
| `npm run boot:check` | ✅ PASS | — |
| `npm run deps:server-gate` | ✅ PASS | — |

CI itself is also healthy again: runs on `main` succeeded on 2026-10-08 (269 s, 134 s, 883 s). ⚠️ This is a
recovery — **CI was down repo-wide from 2026-10-05 04:14 UTC**, failing in 3–5 s with no runner assigned
across three different sessions' branches. It resolved without a code change; the cause was never visible
from a session (Actions billing/permission paths are blocked by the proxy). Recorded so a future session
recognises the signature instead of diagnosing it as a code defect.

## ⚠️ Two corrections to my own first pass — both were measurement errors, not repo defects

**1. "typecheck, native:guard and typecheck:server FAILED" — false. They never ran.**
I wrapped them in `/usr/bin/time -f "%es"`, which does not exist in this container:
`/bin/bash: /usr/bin/time: No such file or directory`. The wrapper failed, the step never executed, and my
harness recorded `!!! FAILED`. Re-run without it: **all three pass.** A step that cannot run is not a step
that failed, and the two must never share a label.

**2. "8 test files fail on main" — false. My `node_modules` was six days stale.**
The 8 were all 3D/game files and every one failed at *import*, with **zero failed assertions** — the shape
of a missing module, not of a broken feature:

```
Error: Cannot find package 'three' imported from tests/aGunFeelsLikeAGun.test.ts
```

`three@0.180.0` is declared in `package.json:125` **and** present in `package-lock.json`; it landed in
`6b58e95f8` while this container's install was older. After `npm ci`, those exact 8 files:
**8 passed, 99 tests passed.**

🔑 **The lesson, and it is the reason this section exists:** had I filed the baseline from the first pass, it
would have said *"main has 8 failing tests and three broken typechecks"* — and the suggestion's Phase 1
says explicitly **"DO NOT proceed with a large refactor if the baseline is already broken."** A false
baseline would have blocked the whole programme on nothing. Before recording a failure, establish that the
thing being measured actually ran.

## Scale (the thing any refactor has to move)

| | count |
|---|---|
| TS/TSX files | 4,711 |
| Lines of TS/TSX | 185,184 |
| `src/server/` files | 2,383 |
| `src/server/AgentV3/` files | 1,144 |
| Test files | 1,543 tracked (2,446 collected incl. co-located) |
| Tests | 35,630 |

**Largest files — the refactor risk surface, and the audit's finding F1:**

| lines | file |
|---|---|
| **26,187** | `src/server/routes/agentv3.ts` ← the build lifecycle, inlined in one Express handler |
| 11,423 | `src/server/AgentV3/ToolDispatcher.ts` |
| 4,324 | `src/server/lib/Game3DGenerator.ts` |
| 4,152 | `src/server/AgentV3/BuildDiagnostics.ts` |
| 3,889 | `src/server/AgentV3/ToolCatalog.ts` |
| 3,751 | `src/server/AppContext/AppKnowledgeBase.ts` |
| 3,605 | `src/server/routes/admin.ts` |

## Performance baseline

- Full suite: **582 s** (66 % test execution, 30 % import, 3 % transform). The import share is large enough
  that adding heavy test-time dependencies is a real cost, which is what Phase 33 is right about.
- Frontend typecheck 19 s · server typecheck 48 s · native guard <1 s.
- A full local CI-equivalent gate is ≈ **12–14 minutes**, which is why it runs once, last, on the final
  state (`CLAUDE.md` safeguard #5) rather than repeatedly.

## Known-broken areas: none found on `main`

No failing test, typecheck, build, bundle, boot or dependency gate at `23ece92a1`. The warnings observed are
the standing ones: an `npm audit` advisory notice (the `audit:gate` CI step is the authority on whether it
blocks) and a `punycode` deprecation warning from a transitive dependency.

## What this means for the programme

- ✅ The baseline is green, so **Phase 1's stop condition does not apply** — incremental work may proceed.
- ⚠️ But the gate costs ~13 minutes per change and `main` moves several times an hour across concurrent
  sessions, so the economic unit is **one small, independently-gated change at a time**, not a 38-phase
  march. That is also what the suggestion's own Phase 34 and `CLAUDE.md`'s safeguard #5 require.
- 🔴 Any work touching `routes/agentv3.ts` (26 k lines) must assume a merge conflict and re-gate on the
  merged state — not because of this change, but because that file is where every concurrent session lands.
