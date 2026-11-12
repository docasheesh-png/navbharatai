# BR1967 — a succeeded “Upgrade my AI Anime Video Generator…”

Scope: BR1967 only, inside the frozen audit boundary 1951..2105. Branched from `2901f76c0055f19e1d2996567ce528d44de97358` (the #4153 squash-merge of exact BR1966 head `6022d7e02`, which is origin/main at branch creation). The parent reviews and merges this PR; BR1968 is not started. Nothing was replayed, deployed or reconfigured; no provider was called, and no autopsy was written to a remote service (`get_failed_build_autopsy` returns "Failed report not found in retained storage" for a succeeded build). A gift-removal PR may land in parallel; this branch integrates it by ordinary merge only if needed, never rebase or force-push.

The production follow-up is a neighbour lock, not a classifier change. This prompt already scores LARGE (~12 distinct features) and correctly opens the mega-app roadmap. The fast lane then built milestone 1 as a 7-file simple success — that hand-off is designed (Q-975 / `milestoneLaneRequest` exist so the lane receives the milestone brief, not the later video pipeline). Widening `CREATE_WORDS` so “Process Story” / “कहानी संसाधित करें” derives a journey, tightening the unsized-app ETA band for milestone-1 fast-lane previews, and restating “milestone 1 of N” on the simple-lane success summary are queued (Q-2636, Q-2637, Q-2638). Skipping the fast lane whenever a mega-roadmap is active, or treating a video/anime generator as `fastLaneSkipsImageApp`, would send a local scene-division preview down the full builder (the costly direction) and was not shipped.

This does not claim that an on-device 5–30 minute anime MP4 generator can be delivered. The planner’s honest infra ceiling (external TTS / image / video APIs, user-configured keys and costs) is the correct limit.

## Identity and evidence
- Prompt: **"Upgrade my AI Anime Video Generator…"** (845 chars; ends “creat app”). Full text in the evidence file.
- Outcome **succeeded** (`ok=true`). Root cause recorded: `BUILD_SUCCESS`. Model qwen3-coder (SURPLUS), weak (free) tier, vite-react. **Not charged** (`charged` false, `billedUsd` 0, `walletDebited` false). Sandbox cost $0.008536.
- Build `495ba39f-c702-41a6-b9a2-512cce55678a`, workspace `agentv3-XmyDmxOrLNThgar9leVrqn2zaSr2-bea438fc-41dd-4419-b708-6a7c35ac36a3`, history `1794109496632`, session `bea438fc-41dd-4419-b708-6a7c35ac36a3`, report digest `cffea1301ecbc753c6bcc6f9038f85dd582c3e6aae5d8b362be3e1ee5411c07e`, promptHash `8d8c0d47`.
- Started **2026-11-08 09:14:56.632 IST**, ended **09:18:16.127 IST** (199495 ms / 3.32 min). No user-wait. ETA shown 4.0–9.9 min (midpoint 6.3 min, key `app_unsized`, evidenced); actual 199495 ms landed **UNDER** the band (ratio 0.527) — **D08**, queued as Q-2637.
- 102 issue entries (report count 101), 0 errors, 1 warning (`RELEASE_GATE`), 0 auto-resolved, 0 leftOpen, healRule 3, 2 unresolved (`RELEASE_GATE` warning + `IN_BUILD_GREEN_RACED` info with `autoResolved` false), 2 commands, 10 model calls (SURPLUS / qwen3-coder; provider tokens in 28,716 / out 5,903 / cache-read 21,408). Indexed in [the evidence file](build-report-autopsy-BR1967-evidence.json).
- Request analysis: `app_unsized`, complexity 15, startTier gemini / cheapest band; Surplus admitted. APP_SCOPE: LARGE, ~12 distinct features (**D01** — correct, not a defect). COMPLEXITY_ROUTING COMPLEX score 15.
- Original retained report bytes sha256 `8726689d83d1a6f55ee27663f6af7247204d23fdf09f0016be3e4dba457890a3` (54257 bytes; matches the fetch asset name). Pretty-printed copy sha256 `6b1a551f241e7d91177c866d49a07002edac8f3c423cfed74d125843fab40396` (62482 bytes). Digest matches the list_build_reports value.

## Five buckets (report-backed)
1 neighbour lock of this prompt (LARGE / not an image-app skip / Process-Story is not a submit word today) · no production classifier or delivery-path change · 3 queued residuals of this report (Process-Story journey, ETA under-band, thin simple-lane summary) · the rest not-a-defect / designed / existing siblings (Q-975 milestone lane, Q-2616 Generate/Calculate check limit, Q-979 chat-handler headroom).

## What happened (IST, 2026-11-08)
1. **09:14:56.** APP_SCOPE LARGE — ~12 distinct features requested (**D01**, correct). A big-app planner runs next.
2. **09:15:09.** MEGA_ROADMAP_ACTIVE — building step 1 for a fast preview: 6 checkpoints, all marked `[infra]`: Story Input & Scene Division; Hindi Voice Generation; Visual Scene Preview; Video Clip Generation; Episode Assembly & Export; Progress Dashboard & Cost Controls. Honest note: full video generation needs external AI media APIs with limits/costs (**D02**, **D13**). Planner narration: start with a working core (paste a Hindi story, choose a duration, see real scene division), then voice, visuals, and video assembly.
3. **09:15:09.** ETA ~4–10 min (midpoint ~6 min, blended, confidence 0.86) (**D08**).
4. **09:15:14.** CHANGE_CLASSIFIED: New app (11 part(s) named) — no earlier app on record, despite the prompt starting “Upgrade my…” and ending “creat app” (**D12**, designed).
5. **09:15:15.** PROJECT_MODE: Software Project Mode is ON for this account, but the mega-app roadmap already owns this build — mutually exclusive by design (**D14**).
6. **09:15:15–09:16:36.** Fast lane: plan 5.6 s, contract 5.5 s (wrote `src/types.ts`), generate 67.4 s (vite.config.ts, package.json, index.html, src/App.tsx, src/main.tsx, src/index.css), verify 14.5 s. `SIMPLE_BUILD_SUCCESS`: “Built your app file-by-file — 7 file(s).” `FAST_LANE_PHASES` 108.4 s. `OUTCOME_BUILD_PARTIAL` then later `OUTCOME_BUILD_SUCCESS` (**D03**, designed milestone-1 preview via Q-975).
7. **09:16:36.** READY_BEFORE_END: the app was never judged finished during the build (**D16**). WRITE_TIME_TYPECHECK: never ran — the fast lane writes its whole list at once and runs a single typecheck of its own (**D10**, designed).
8. **~09:16:58.** The app rendered 122 s into the build (`IN_BUILD_GREEN_RACED`: a file was written while the preview was opening, so no snapshot was taken) (**D09**, existing race). Later `PREVIEW_SNAPSHOT_SAVED` / `PREVIEW_SNAPSHOT_CURRENT` did land.
9. **09:17:18.** FEATURE_COVERAGE: the 1 requested control judged here is present (Add / create). The rest of the request was not judged (**D11**, designed checklist). Capture: painted, 4403 B HTML, 5 inputs, 1 button.
10. **09:17:18.** JOURNEY_NOT_DERIVED: fields “कहानी पेस्ट करें *” and “एपिसोड की अवधि चुनें” were addressable, but the only button (“कहानी संसाधित करें”) is not a submit / add / save / create word (**D05**, check limit; Q-2636). Detail cites a form `<input` in `src/App.tsx`.
11. **09:17:37.** EXPLORE_PASSED: pressed 1 control, “कहानी संसाधित करें” — it responded (nothing visibly changed) (**D07**, expected empty-form explore path when no journey was derived; historical handler body is only a capped preview and is not treated as a proven no-op).
12. **09:17:37.** RELEASE_GATE YELLOW: it runs and renders and the pressed control broke nothing, but no save-and-reload journey was proven (**D06**, consequence of D05). Milestone 1 had asked to store unfinished projects in localStorage.
13. **09:18:11–09:18:16.** Final card: “Here’s what I built: Stack: React + Vite, 14 files, 1 component.” Report `summary` is only the simple-lane line “Built your app file-by-file — 7 file(s).” — no restatement of milestone 1 of 6 (**D04**, Q-2638). CHANGE_RECORDED CHG-0001 new-app/standard · 6 file(s) · status partial · gate YELLOW. No `CLAIM_UNSUPPORTED` (the summary did not claim a finished video) (**D15**). Build ended succeeded. Not charged.

## Prevention classes in this PR
| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | Neighbour locks. This prompt stays LARGE (~12 features). A video/anime generator is not `fastLaneSkipsImageApp`. “कहानी संसाधित करें” / “Process Story” / “Generate” / “Calculate” still do not match `CREATE_WORDS`; Save/Add still do. | existing `analyzeAppScope` / `countEnumeratedFeatures` / `fastLaneSkipsImageApp` / `submitTargetIn` / `noJourneyReason` / `deriveJourneys` | `tests/anAiAnimeVideoGeneratorStaysLarge.test.ts` |
| F2 | Not shipped. Expanding submit words, skipping the fast lane for mega-roadmap or video apps, changing the ETA scorer, or rewriting the simple-lane success summary each fails t311u or needs a product/copy decision. | queued as Q-2636, Q-2637, Q-2638 | corpus required before any of those edits |

## Side-effect review (owner rule t311u: no fix may create another problem)
| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 | Existing neighbour suites (YouTube SEO, exam-analyse, continue/fix, India-map, shop-ERP quality lines, glued GTA titles) still run unchanged. Image-generator prompts still skip the fast lane. Save/Add buttons still derive a journey. | None — no production code changed. | Ship the lock. |
| Fast-lane skip when mega-roadmap is active | Q-975 already hands the lane the milestone brief so step 1 can preview quickly. | Every mega-roadmap first step would pay for the full builder. | Do not ship; designed. |
| `fastLaneSkipsImageApp` for video/anime | Image skip exists because the lane cannot run `generate_image_ai`. Milestone 1 is local word-count scene division. | False skip of a cheap preview; later visual/video steps are already infra-ceilinged. | Do not ship; F1 locks today’s false. |
| Expand `CREATE_WORDS` with process / संसाधित / generate / calculate | Sibling of Q-2616 and autopsy 876afca9. JS `\b` does not bound Devanagari. | False journeys on “Process payment”, batch Process, Reprocess; save-reload could false-RED when scene output is not a list item. | Queue Q-2636. |
| Tighter ETA for milestone-1 fast lane | This build’s 3.3 min vs 4.0–9.9 min `app_unsized` band. | Full-builder milestone-1 builds (game / image / reasoning-rung skip) can still take 4–10 min. | Queue Q-2637. |
| Milestone remainder on the simple-lane summary | Report summary is only “7 file(s).” The planner already narrated the plan at 09:15:09. | A promise of later milestones needs a handler; a new branch in `agentv3.ts` trips Q-979. | Queue Q-2638. |

## Queue
This commit closes no earlier row. New rows Q-2636 (Process-Story / कहानी संसाधित करें not a submit word), Q-2637 (ETA under-band for a milestone-1 fast lane), Q-2638 (thin simple-lane success summary). Q-2633 / Q-2634 / Q-2635 and earlier blockers stay open. Q-2616 is the English Generate sibling of Q-2636 and is not closed or rewritten.

## Inode cleanup (authorized for merged BR worktrees ≤1966 only)
Removed `node_modules` from `/workspace/wt-br1965-autopsy` (1.4G) and `/workspace/wt-br1966-autopsy` (1.4G) so this worktree could `npm ci`. Worktrees for BR1960–1964 already had no `node_modules`. Admin Test Chat trees (`wt-admin-test-chat-providers`, `wt-admin-test-chat-callable`) were not touched.
