# BR2002 — a website that succeeded was recorded as a "stopped" change

Scope: BR2002 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `f2b1c01` (#4314, BR2001). Read only via the read-only failed-BR MCP tools. No replay, deploy, provider call or remote autopsy write.

## What the report holds (generic; no request text, ids or timestamps)

- **The request:** a one-line "build a website for my business". About 115 s in, the user added mid-build that it was for a restaurant. New app, free Weak tier. Surplus (qwen3-coder) answered every turn.
- **Outcome:** SUCCEEDED. RELEASE_GATE was YELLOW: nine controls pressed, no journey derived. The production build, phone layout and runtime checks passed. Not charged.
- **Time:** the ETA was 4.0–9.5 min ("app_unsized"). The build took 12.7 min, 2.2× the midpoint.
- **Truncation:** complete.

Timeline (seconds):

1. **7–113.** The fast lane planned 12 files and wrote 8 of them. It then stopped early because "the stages left could not finish inside its time budget". The salvage typecheck found 1 error.
2. **115–336.** The full builder picked up the user's message, fixed the import error, wrote `App.tsx`, the styles and the content, and started the dev server.
3. **377 / 396.** The app had not rendered yet: `ServicesSection.css` was imported but had never been written. The builder created it, and the first render came at 417 s.
4. **487–577.** A missing `teamMembers` export was fixed.
5. **601–754.** Summary, end-of-build checks, "Here's what I built", then the deep bug-hunt offer (left unanswered).
6. **791.7.** `CHANGE_RECORDED: CHG-0001 new-app/standard · 14 file(s) · status stopped · gate YELLOW`.

## Ledger

| # | Item | Bucket | Root cause | State |
|---|---|---|---|---|
| D1 | A successful build was recorded as a **stopped** change | ❌ false record (change history, Time Machine) | The settle passed `stopped: abort.signal.aborted \|\| userStop`. The bug-hunt offer at 754 s reads the same signal and it was clear then, so something aborted it in the final eight seconds of settling, after the result existed. Several platform mechanisms abort that one controller after a result: the advisory cap, the zombie reaper, a lock reclaim, a deploy drain. **Class:** "the signal is aborted" was read as "the change was stopped". | ✅ **F1**: `changeWasStopped`. The user's own stop is always a stop. Any other abort counts only when it ended the build before a successful result. The report does not name the abort's cause, so the fix covers every cause. |
| D2 | `runProof()` passes `stopped: abort.signal.aborted` the same way, so a post-result abort makes "the run is proven" false | ⏭️ sibling found, not changed | The same class, in the predicate the markup and the late-flip guards read. | 🟡 **Q-2767**: billing-adjacent, so it needs the admin's decision (CLAUDE.md: confirm before changing billing). |
| D3 | The fast lane stopped after 8 of 12 files because its remaining stages "could not finish inside its time budget" | 🔀 workaround (full-builder fallback) | Not established from the report whether the user's mid-build message or the fast lane's own budget ended it. | 🟡 **Q-2768**. |
| D4 | `ServicesSection.css` was imported and never written, so the app did not render for about 40 s | 🥵 struggle | The stopped fast lane left an import whose target was never generated, and the hand-off typecheck cannot see CSS imports. | 🟡 **Q-2768**: same row, same lane. |
| D5 | Missing `teamMembers` export | ✅ self-healed | Model. The builder fixed it. | ✅ No platform change. |
| D6 | JOURNEY_NOT_DERIVED: "fields have no name, id, placeholder, label or test id", while ACCESSIBILITY scored 100/100 with no unlabelled fields | ⏭️ possible contradiction between two scanners | Not established without the source (for example, `aria-label` is not in the journey's list). | 🟡 **Q-2769**. |
| D7 | The ETA was 4–10 min for an unsized app; the build took 2.2× | 🥵 | The sizer recognised nothing in the request. | 🟡 Existing **Q-1007** (evidence appended). |
| D8 | "28 files, 5 components" vs CHANGE_RECORDED 14 vs FE_BE 23 | ⏭️ | Different scopes, not labelled. | 🟡 Existing **Q-2753** (evidence appended). |
| D9 | 2 TODO-only turns and one EXPLORATION_WITHOUT_CHANGE nudge | 🥵 model | Existing hand-backs fired. | ✅ No change. |

## Proof

`tests/br2002Autopsy.test.ts` (5 tests). Reverting the helper to "any abort is a stop" fails the report-shape test. Reverting the route to the bare `abort.signal.aborted` fails the source guard. The existing change-engine and abort-cause suites (1229 tests) pass.
