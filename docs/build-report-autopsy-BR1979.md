# BR1979 — "ake app banane jisse free mein I video Bani": a missing tsconfig.node.json sent a finished app to the full builder

Scope: BR1979 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `08a37a81c3fc63ad5bdc07ee349b30f4da2a077e` (#4231, after BR1978 #4230). Before exact-head CI, origin/main `dafaf4061e1b36563f80dd66ab73559d60abfddd` (#4233) was brought in with an ordinary merge (no rebase, no force). No PR or autopsy for BR1979 or later existed (gh title search `BR1979` empty; no `docs/build-report-autopsy-BR19{79..}`; `get_failed_build_autopsy` is not used for a succeeded report). Read only via `get_build_report` — no remote autopsy write, no replay, no deploy, no provider call. `src/server/AI/RouterOne/*` was not touched.

## What the user asked

`ake app  banane jisse free mein I video Bani` (44 characters, typo for "ek app banane…", promptHash `13a9d071`). A free in-browser video maker. The engine understood the request and delivered that app.

## What happened (IST, 2026-11-08)

1. **09:50:31.** FREE_BUILD_TIME_CAP 25 min. APP_SCOPE ordinary one-shot. TIER_LADDER Weak default (GLM → KIMI → GLM). COMPLEXITY_ROUTING simple 15. SURPLUS_ADMITTED qwen3-coder. ETA ~4–9 min (app_unsized, 30 recent builds). **09:50:32 SANDBOX_UNAVAILABLE** (E2B concurrent-sandbox cap of 20) plus AGENT_NOTE "can't create files… please try building again in a little while". Project context: file listing **0 path(s)** — no starter. CHANGE_CLASSIFIED new app. PROJECT_MODE not a mega-project.
2. **09:51:49–09:51:52.** The fast lane still ran. Six of 13 planned writes were refused (`Could not read the existing … safely (transient sandbox error) — not overwriting it`): `src/types.ts`, `src/hooks/useVideoRecording.ts`, `src/utils/videoUtils.ts`, `src/utils.ts`, `src/components/VideoRecorder.tsx`, `index.html`. PLATFORM_WRITE_REFUSED stayed unresolved. Seven other files, including `tsconfig.json`, landed.
3. **09:52:21.** Fast-lane verify failed: `tsconfig.json(33,5): error TS6053: File '.../tsconfig.node.json' not found`. SIMPLE_BUILD_FALLBACK / TYPECHECK_FAILED. The lane had already generated the app (104.6 s: generate 59 s, verify 11 s over 2 runs, one 16.6 s repair). Salvage handed 11 files to the full builder. The official starter tsconfig has `include: ["src"]` and **no** project references; the model had added `"references": [{ "path": "./tsconfig.node.json" }]` without writing that sibling.
4. **09:53:45–09:57:26.** The full builder rejected two truncated writes to `src/types.ts` (syntax guard worked). Preview published; three IN_BUILD_GREEN_UNCHECKED blanks; first real-browser render at 414 s. WRITE_TIME_TYPECHECK: 11 clean runs.
5. **10:01:27–10:08:32.** Readiness: no error boundary (starter was never seeded). DEAD_SALVAGE_REMOVED `src/hooks/useVideoRecording.ts`. E2E scaffolded. APP_SHOWS_ERROR / PREVIEW_NOT_RENDERED: the preview has no camera (`NotFoundError: Requested device not found`); the app had auto-requested getUserMedia and painted an error box. The model spent further turns investigating the console. RELEASE_GATE YELLOW for that on-screen message. Explore passed; mobile layout OK; prod build OK. SANDBOX_RECOVERED. Charged ₹5.15 (₹5.58 → ₹5.02 after the 10% build discount, plus the 2.5% sandbox fee); wallet debited 514 tokens. ETA ratio 3.0×, OVER the 4.0–9.4 min band (17.5 min, not counting 0.5 min waiting for the unanswered bug-hunt offer).

Outcome **succeeded** (`ok=true`), truncation complete. counts: total 417, errors 1, warnings 15, unresolved 6 (PLATFORM_WRITE_REFUSED, 3× IN_BUILD_GREEN_UNCHECKED, APP_SHOWS_ERROR, RELEASE_GATE). 94 Surplus calls (qwen3-coder); the Weak ladder was never used; PROVIDER_TIME_WASTED 0.

## The real delivered tree (not a reconstructed model)

Manifest `fileHashes` (21 paths): `src/{main.tsx,App.tsx,types.ts,utils.ts,styles/app.css,components/VideoPreview.tsx,components/VideoRecorder.tsx}`, `index.html`, `package.json`, `vite.config.ts`, `tsconfig.json`, `.gitignore`, `README.md`, `playwright.config.ts`, `e2e/smoke.spec.ts`, `docs/decisions/ADR-001.md`, `public/{manifest.webmanifest,robots.txt,icon.svg,sw.js,nbai-native.css}`. **No `tsconfig.node.json`**, no `src/hooks/useVideoRecording.ts`, no `src/utils/videoUtils.ts`. The full builder removed the dangling reference (its own summary says so) and deleted the unused hook.

The user-facing result is a working client-side video recorder — not a stub. The DNA is that a single missing project-reference file turned a ~2 min fast-lane app into a 17 min full-builder run.

## Root causes, and what this PR does

| # | Defect in this report | Root cause | Closed by | Lock in this PR |
|---|---|---|---|---|
| D1 | User told to "try building again" while the build continued | The pre-#4146 goodbye invited a second Start under a hard E2B cap | **BR1961 F2 (#4146)** `sandboxUnavailableNotice` | `tests/br1979Autopsy.test.ts`: this report's old goodbye is gone; the notice says we are still trying |
| D2 | The text-only fast lane ran against a workspace setup that had already failed (0 paths, 6 refused writes) | `fastLaneWouldRun` did not yet require `!sandboxUnavailable` | **BR1952 (#4124)** `FAST_LANE_SKIPPED_SANDBOX` | Same file: the route still gates the lane on `sandboxUnavailable` and records `FAST_LANE_SKIPPED_SANDBOX` |
| D3 | Fast-lane verify failed TS6053 (`tsconfig.node.json` not found) and handed a finished app to the full builder | A generated tsconfig.json that already has `include: ["src"]` also referenced a sibling the batch never wrote. `sanitizeTsconfigExtends` only strips bare-package `extends`, not dangling `references` | **This PR** `sanitizeTsconfigReferences` — before the lane writes/verifies, again before tsc, and on preview restore | Same file plus `FrameworkFoundation.test.ts`: this report's tsconfig is repaired; neighbours keep a present sibling, the official starter, and a Vite 5 solution-style `{ files: [], references }` config |

The first two fixes were merged after this build ran (2026-11-08 09:50 IST). D3 is new production code, narrow by construction (t311u): only a `tsconfig.node.json` reference, only when that file is in neither the batch nor `existingPaths`, and only when the tsconfig already lists its own sources.

## Side-effect review (owner rule t311u)

| Candidate | Adjacent behaviour | Risk | Decision |
|---|---|---|---|
| Strip a dangling `./tsconfig.node.json` reference when `include`/`files` is already set | Official starter has `include: ["src"]` and no references. A Vite 5 solution-style `{ files: [], references: [app, node] }` is left untouched (stripping its last reference would typecheck nothing). A present sibling (batch or disk) is kept. Other references and relative `extends` are not touched. Same kill switch as the extends sanitizer (`AGENTV3_TSCONFIG_SANITIZE=off`). | Low. The app tsconfig still typechecks `src`. vite.config.ts is not in `include`. | Ship. Mutations: drop the strip, or treat a missing sibling as present, must turn red. |
| Widen the strip to every missing `references` path | Monorepo / imported project references not in a partial file list would be dropped. | High. | Do not ship. |
| Auto-write the canonical `tsconfig.node.json` and keep the reference | A non-composite app tsconfig that references a composite node project can raise TS6305/TS6306 (notes autopsy 70e030bb). | Medium. | Do not ship. |
| Change APP_SHOWS_ERROR to ignore camera `NotFoundError` in a headless preview | Admin policy (Q-362): a page that paints an error has not done its job. A genuinely broken getUserMedia call can show the same banner. The detector starts no repair by itself. | High — could hide a real broken video app. | Do not ship. The YELLOW gate is honest about what the preview showed. |
| Recover the Vite starter for ordinary apps after SANDBOX_UNAVAILABLE (sibling of `prepareGameSeedWorkspace`) | Would have given this build `tsconfig.node.json` and an error boundary. Overlap with D2 (the full builder can recover) and a risk of writing the starter over a user's files if the empty listing was a false read. | Medium. | Do not ship in this PR. D2 already skips the wasted fast lane; D3 fixes the dangling reference when a lane does run on an empty workspace. |
| SANDBOX_UNAVAILABLE / E2B cap | Already Q-2621. | Infrastructure. | Carry. This report's evidence is added to that row. F2 and #4124 already address the goodbye and the wasted lane. |
| PLATFORM_WRITE_REFUSED on a transient read | Intentional fail-closed (do not overwrite a file that could not be read). Already locked: a refused write is not counted as written. Six files were later written or dropped as dead salvage. | Changing the write door could clobber user files. | Do not ship. |
| Charge ₹5.15 / ETA 3.0× | Consequence of D2+D3 (and the camera chase). The app rendered. | Billing / ETA policy. | Do not ship. |
| Q-2649..Q-2654 and earlier rows | None is this report's DNA (the prompt named a video maker, not a bare "game"/"app"). | — | Carry unchanged, except Q-2621 evidence. |

## Queue

This commit closes no row and opens no row. Q-2621 gains BR1979 evidence and stays blocked on an ops/capacity decision. Q-2649, Q-2650, Q-2651, Q-2652, Q-2653, Q-2654, Q-2648, Q-2647, Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068 and earlier blockers stay open.
