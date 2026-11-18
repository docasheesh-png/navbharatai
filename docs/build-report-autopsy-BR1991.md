# BR1991 — a stopped build whose report is no longer retained

Scope: BR1991 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `a5e23403` (BR1990, #4265). Read only via the read-only failed-BR MCP tools (`list_build_reports`, `get_build_report`, `get_failed_build`, `get_failed_build_autopsy`, `list_scope_failures`) — no remote autopsy write, no replay, no deploy, no provider call, no production read or write outside those tools. Routing, billing, Router One and Pro Chain V2 admission were not touched. **No product code changed.**

## What the report holds

Nothing. The registry lists number 1991 with outcome **stopped**, `retained: false`, no build id and no report digest. `get_build_report`, `get_failed_build` and `get_failed_build_autopsy` all answer "not found in retained storage"; `list_scope_failures` for the workspace is empty (best-effort retention; absence proves nothing). The inventory taken when this audit started (BR1951) already showed 1991 as not retained, so the bytes were gone before the audit began. Its neighbours 1986–1995 are all retained. The request, the event sequence, the engine path and the bill cannot be read and are **not reconstructed**.

## Why the report is missing (established from source, not from the report)

| # | Fact | Evidence | Lock |
|---|---|---|---|
| E1 | A numbered report always had saved bytes | `commitDiagnosticsHistory` writes the registry row and the history document in one transaction; the registry backfill only numbers history/latest documents that exist | `tests/br1991Autopsy.test.ts` E1; `tests/buildReportRegistry.test.ts` |
| E2 | The one in-repo path that removes a **recent** report is the user deleting that build's chat | The conversation DELETE route runs the GA-1 cascade `purgeWorkspace`, which calls `deleteDiagnostics`: it deletes every history document of the workspace and its latest-report document, and does not touch the registry, so the number stays reserved and the list reports `retained: false` (by design: "the number stays reserved for it") | `tests/br1991Autopsy.test.ts` E2 |
| E3 | The other removal paths cannot explain it | History retention is 180 days on `savedAt` with a strict `< cutoff`; account erasure of workspace stores refuses every uid (`ownership-unverified`) and deletes nothing | `tests/br1991Autopsy.test.ts` E3 |
| E4 | The pattern fits a user's own deletions | In 1951..2105 four numbered reports are unretained (1991, 2000, 2011, 2026); all four belong to one account across three workspaces, and that account's later workspaces still have retained reports | Local evidence only (no ids in this repo) |

**Most likely cause:** the user deleted this build's chat, and the cascade correctly erased its diagnostics. This is expected, privacy-correct behaviour, not a defect. It is **not proven**: proving it needs a production read (whether the workspace's latest-report document is also gone, which is `deleteDiagnostics`'s signature), which this audit does not do. An out-of-band manual deletion would look the same.

## Root causes

| # | Defect in this report | Root cause | Closed by | Lock |
|---|---|---|---|---|
| D1 | The build's own defects (it ended **stopped**) | Not readable: the report is not retained | **🟡 BLOCKED — Q-2703** | Not guessed; no fix shipped without the report's DNA |
| D2 | The report is missing | Most likely the user's own chat deletion (E2, E4); not proven without a production read | **🟡 BLOCKED — Q-2703** (needs an admin read) | E1–E3 pinned so the explanation is revisited if any of them changes |

## Side-effect review (owner rule t311u)

| Candidate | Adjacent behaviour | Risk | Decision |
|---|---|---|---|
| Any builder or stop-path change "for" BR1991 | There is no evidence of what happened in this build; any change would be a guess and could regress working paths | High | **Not shipped** |
| Keep diagnostics when a chat is deleted, so autopsies can read them | Reverses a user's own deletion (GA-1); privacy regression | High | **Not shipped** |
| Also delete the registry row on chat deletion | Changes the admin list and numbering evidence ("gaps are reports that expired or were erased"); a privacy/retention policy decision for the owner, not an autopsy fix | Medium | **Not shipped**; noted for the owner |
| Show a reason on unretained rows (e.g. the workspace's latest-report document is also gone ⇒ purge signature) | Additive, admin-only; would let future autopsies tell a user deletion from a loss without a manual production read | Low | **Not shipped** (new feature, not this report's defect); candidate follow-up |
| Pin the facts the explanation rests on (E1–E3) | Tests only; no runtime change | Low | **Ship** |

## Queue

New row **Q-2703** (BLOCKED): BR1991's report is not retained; its build cannot be autopsied, and the most likely cause (the user's chat deletion) needs one admin production read to confirm. No row is closed.

Lessons carried: any parser or regex loosening is line-anchored, strictly validated and proven identical to main for normal input (BR1989). Any new refusal or discard rule is fail-safe: refuse only when positively certain, keep main for anything unclear, and probe realistic usable-but-unusual inputs first (BR1990). This PR adds no refusal, discard or parser change.
