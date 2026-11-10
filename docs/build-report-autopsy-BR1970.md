# BR1970 — a stopped “The AI service is temporarily busy. Please try again in 1-2 minutes.”

Scope: BR1970 only, inside the frozen audit boundary 1951..2105. Branched from `1b2f2a90365fc9cefc17fa2ba554bf64d43249e7` (the #4158 squash-merge of exact BR1969 head `047ec81da`, which is origin/main at branch creation). The parent reviews and merges this PR; BR1971 is not started. Nothing was replayed, deployed or reconfigured; no provider was called, and no autopsy was written to a remote service (`get_failed_build_autopsy` returned `state: not_started`, `record: null`, matching digest).

This report is a 9.7-second user-stop. The prompt is the platform’s English Free busy line (`freeBusyMessage` / AIRouter fallback) without the trailing 🙏. It was admitted as an ordinary unsized edit (ETA 5–14 min, key `edit_unsized`). Setup then hit `SANDBOX_UNAVAILABLE`: E2B’s concurrent cap of 20 — already queued as Q-2621 (BR1961). The user stopped about 4 seconds later. Nothing was written (`fileHashes` empty). `zeroBillReason` is “stopped by the user before any file was written — never charged”. That billing path is already locked; this PR only neighbour-locks it beside this prompt.

The production follow-up shipped here is **Q-2641**, not a new busy-prompt filter. The reviewer asked to keep the injected “made by NavBharatAI” badge inside a 390×844 phone without exempting `[data-nbai-signature]` in `mobileLayoutCheck`, without rewriting existing signed apps, and without changing paid-removal copy or the CSS-only 32×32 ×. The reviewer’s CSS (`left:auto`, `box-sizing:border-box`, `width:max-content`, `max-width:calc(100vw - 24px)`, `right`/`bottom` `max(12px, env(safe-area-inset-*))`, label `min-width:0` + ellipsis) is not enough when a transformed `html`/`body` is wider than the viewport: `right:12px` is then 12px from that wide containing block (BR1969: 224px badge reaching 420px). Fixtures at 390×844 show that case still overflows under the reviewer `right` alone. A CSS-only extra, `right: max(..., calc(12px + 100% - 100vw))`, places the box at the visual viewport’s bottom-right without JavaScript, popover, or top-layer (popover would need `showPopover()` and is forbidden by the CSS-only × rule). Existing version-2 signed apps are not rewritten (`APP_SIGNATURE_VERSION` stays `"2"`; `hasCurrentAppSignature` still short-circuits). Chromium headless on this machine hung on dbus (same skip as the existing badge/phone browser suites); the three fixtures are proven with the CSS containing-block geometry the overflow depends on.

Filtering our own busy copy out of the builder is queued as Q-2642, not shipped: a status-page or screenshot caption that quotes the same sentence must still build.

This does not claim the historical empty workspace was repaired, or that the E2B cap of 20 was raised.

## Identity and evidence
- Prompt: **"The AI service is temporarily busy. Please try again in 1-2 minutes."** (67 chars). Equals `freeBusyMessage('Please build me an app')` without the trailing 🙏. Full text in the evidence file.
- Outcome **stopped** (`ok=false`). Root cause: stopped by the user — no failure of the app or the engine is implied. Model qwen3-coder (SURPLUS), weak (free) tier, vite-react. **Not charged** (`charged` false, `billedUsd` 0, `walletDebited` false, `zeroBillReason`: stopped by the user before any file was written — never charged). Sandbox cost $0.000322.
- Build `cc0309bd-d019-4d53-bfe2-14b10c607e2a`, workspace `agentv3-v1PafwMznwgkH9HhZTwiZ9TBVgx1-37b1faa9-18af-4461-95e8-246d9de1e073`, session `37b1faa9-18af-4461-95e8-246d9de1e073`, report digest `4a2ffae8542a4fcbea28ee277b0cddb28cede6be6384192cc08204dc48671e69`, promptHash `0609173d`. The list endpoint’s historyId equals `startedAt` (`1794109919760`); the report body itself has no separate `historyId`.
- Started **2026-11-08 09:21:59.760 IST**, ended **09:22:09.464 IST** (9704 ms / 9.7 s). ETA shown 4.5–13.6 min (midpoint 6.7 min, key `edit_unsized`); cut short at 0.2 min (`untested`, `withinBand` false) — designed, a stop does not test completion time.
- 36 issue entries (report count 35), 1 error (`SANDBOX_UNAVAILABLE`, unresolved), 0 warnings, 0 auto-resolved among problems, 0 commands, 1 model call (SURPLUS / qwen3-coder; provider tokens in 381 / out 2 / cache-read 336; the admission classification, `latencyMs` 12961). Indexed in [the evidence file](build-report-autopsy-BR1970-evidence.json).
- Request analysis: `edit_unsized`, complexity 15, startTier gemini / cheapest band. APP_SCOPE: ordinary one-shot / no mega-signal. PROJECT_MODE on; “this turn is not a fresh build, so no plan was created.” Manifest `fileHashes` empty.
- Original retained report bytes sha256 `dfe16f3ee1c3c67dbe4ae9fa1827807988ff4adb98af5af69020ceefc18fb557` (13674 bytes). Pretty-printed copy sha256 `fe35d7fc70991829eca34d6c8b49e55945f4d8d78d8da44a2b6ed0bfdb68d5ef` (16734 bytes). Digest matches the list_build_reports value.

## Five buckets (report-backed)
1 neighbour lock of this prompt (ordinary/direct; English busy line without emoji; user-stop before writes is never charged) · 1 production CSS change for Q-2641 (new signature injections stay inside a 390×844 visual viewport, including a transformed html/body plus a wide track; existing v2 apps untouched) · 1 queued residual of this report (do not start a coding build when the prompt is only a known busy line) · 1 already-queued sibling (Q-2621, E2B cap of 20) · the rest designed (user-stop, not charged, untested ETA, UPSELL_SUPPRESSED, RELEASE_GATE RED because the build was stopped).

## What happened (IST, 2026-11-08)
1. **09:21:59.** FREE_BUILD_TIME_CAP 25 min (paid would be 29 min). APP_SCOPE: ordinary one-shot, no mega-signal (**D01**, today’s behaviour for this text). TIER_LADDER Weak default. COMPLEXITY_ROUTING simple score 15 — first rung. Surplus admitted (qwen3-coder).
2. **09:22:00.** ETA ~5–14 min (midpoint ~7 min, blended, confidence 0.77) from 13 recent *edits* (`edit_unsized`) (**D12**, not tested — the user stopped).
3. **09:22:00.341.** `SANDBOX_UNAVAILABLE` (error, not auto-resolved): “Rate limit exceeded… maximum number of concurrent E2B sandboxes (20)” (**D03**, Q-2621). AGENT_NOTE: the build engine is temporarily unavailable; try again in a little while.
4. **09:22:03–09:22:04.** PROJECT_MODE: not a fresh build, no plan. CHANGE_CLASSIFIED: local, risk medium, 0 files. USER_STOPPED_BUILD / OUTCOME_USER_STOPPED ~4 s after the sandbox error (**D04**).
5. **09:22:04–09:22:09.** READY_BEFORE_END not measured (edit of existing files). WRITE_TIME_TYPECHECK: no TypeScript written. FINISHING_PASSES_HELD_AT_CAP: e2e-scaffold deferred. RELEASE_GATE RED: stopped before it could be finished or checked. UPSELL_SUPPRESSED: a stopped build is not evidence that adding credits would help. CHANGE_RECORDED: 0 files, status stopped, gate RED. Summary: “Stopped, as you asked. Nothing had been written yet, so nothing was lost.” Not charged.

The same workspace’s next report (BR1971, not started here) is a succeeded “Continue from where you left off…”.

## Prevention classes in this PR
| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | Neighbour locks. This prompt is the English busy line without the emoji and stays ordinary/direct (not a game). A user-stop before any file is written is never charged. Hindi/Hinglish busy lines and a genuine continue stay ordinary. | existing `analyzeAppScope` / `freeBusyMessage` / `zeroBillReasonFor` | `tests/aTemporarilyBusyLineStillBuildsDirect.test.ts` |
| F2 | New signature injections stay inside a 390×844 visual viewport: reviewer CSS plus `right: max(..., calc(12px + 100% - 100vw))` for a transformed, wider containing block. 32×32 CSS-only × kept. Body-level injection kept. Existing v2 apps not rewritten. `mobileLayoutCheck` is not taught to ignore the badge. Paid-removal copy untouched. | `src/server/AgentV3/appSignature.ts` | `tests/theSignatureFitsAPhone.test.ts`, `src/server/AgentV3/appSignature.test.ts` |

## Side-effect review (owner rule t311u: no fix may create another problem)
| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 | Existing continue/fix, exam-analyse, and zero-bill stop tests. | None — no admission change. | Ship the lock. |
| Refuse a build whose prompt is only a busy line | Would have skipped this wasted sandbox setup. | A status page / banner / screenshot caption that quotes the same sentence would be refused. Hindi/Hinglish variants and emoji-stripped copies must be listed exactly. | Queue Q-2642. |
| Raise the E2B cap of 20 or add an admission queue | Q-2621 (BR1961, SANDBOX_RECOVERED). This report did not recover; the user stopped. | Immediate retries under a hard cap of 20 can stampede (sibling of Q-2567). | Leave Q-2621. |
| F2 badge CSS | Plain 390×844 page; transformed html/body; wide 700px track; transformed + wide track. Reviewer `right` alone still overflows the last fixture (right edge 688). The extra calc keeps the visual right edge at 378. Existing v2 markup is unchanged on re-inject. 4px-grid census still passes. Close-control 32×32 / checkbox CSS hide unchanged. | `100%` on `right` is the containing-block width; if a transform also *translates* the block, visual alignment can drift. Popover/top-layer would need JS (`showPopover` / `showModal`) and a backdrop risk. Exempting the badge in `mobileLayoutCheck` would hide a real overflow. | Ship CSS; do not exempt; do not bump the version (existing signed apps stay as written). |

## Queue
This commit **closes Q-2641** (badge overflow on a narrow phone) and opens **Q-2642** (do not start a coding build when the prompt is only a known busy line). Q-2640 (vehicle+race without the word game), Q-2621 (E2B cap of 20), Q-2611 (responsive / all-device-sizes summary claim) and earlier blockers stay open.

## Inode cleanup (authorized for merged BR worktrees ≤1969)
Removed `node_modules` from `/workspace/wt-br1969-autopsy` (1.4G) so this worktree could `npm ci`. Worktrees for BR1960–1968 already had no `node_modules`. Admin Test Chat trees (`wt-admin-test-chat-providers`, `wt-admin-test-chat-callable`) were not touched.
