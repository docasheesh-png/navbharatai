# BR1995 — "Fix with AI" under our own reconnect refusal: the next build's request was our infrastructure sentence

Scope: BR1995 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `d167b888` (BR1994, #4271). Read only via the read-only failed-BR MCP tools (`list_build_reports`, `get_build_report`). No remote autopsy write, replay, deploy, provider call, or production read or write happened outside those tools. Routing, billing, Router One and Pro Chain V2 admission were not touched.

## What the report holds (described generically; no request text, ids or timestamps)

- **The request:** the "Fix with AI" button's own template wrapped around our own first reconnect-refusal sentence ("Your workspace could not be safely reconnected. Please retry shortly."). No user words are in it.
- **The workspace:** the same workspace as BR1993. That build had ended with the same refusal about 2 minutes before this one started. `priorFailedBuilds` is 1.
- **Engine:** a free Weak build. Surplus was admitted. One Surplus call ran, the scope-admission classifier (about 2.5 s), and it ran **before** the diagnostics timer started (a pre-build call, recorded later).
- **Billing:** not charged. The report has no charge record, so no cost is claimed.
- **Truncation:** complete.

The order, in seconds after the report's start (rounded):

1. **0 s.** The free 25-min window, scope (ordinary one-shot), the Weak ladder, complexity (debugging, score 45) and Surplus admission were all recorded. TIME_TO_FIRST_CALL said "0s of preparation … the first call itself then took 0s".
2. **About 5.3 s.** The rough ETA "~6–10 min" was shown, then "Setting up your workspace…". SETUP_TIMING timed the whole stretch before it as one window: "Routing and ETA in 5.3s", with no step breakdown.
3. **About 5.6 s.** SANDBOX_RECOVERY_UNAVAILABLE was raised again, with the **first**-refusal wording ("Please retry shortly") and no admin reason. Then OUTCOME_SANDBOX_UNAVAILABLE. The build failed after about 5.6 s.

## Root causes

| # | Defect in this report | Root cause | Closed by | Lock |
|---|---|---|---|---|
| D1 | The user pressed "Fix with AI" under our own reconnect refusal. The next build's request was that sentence: it was scored as a debugging turn and shown a debugging ETA. If the workspace had reconnected, a builder turn would have run on our own infrastructure notice. | `errorCanBeFixedByEditingTheApp` hides the button only for refusals raised **before** the stream opened (autopsy fdd59ef8). The reconnect refusal comes **out of** the stream, so the button was offered, although no edit to the app can reconnect a workspace. | **F1 ✅ RESOLVED.** The two refusal sentences moved, byte-identical, to `src/lib/sandboxRecoveryMessages.ts`. The server re-exports them, and `isSandboxRecoveryRefusalMessage` matches only the exact sentence (trimmed). The predicate now returns false for that exact sentence. Any other text, including a sentence that only contains it or a different case, keeps today's button. | `tests/br1995Autopsy.test.ts` F1 (both sentences; whitespace; seven neighbours including Hindi and an app error that quotes the sentence; main's answers; bytes pinned; admin reason absent; old-client wrapped prompt still recognised as platform-composed; panel wiring; no server import in the client module) |
| D2 | A second refusal on the same workspace, about 2 min after the first, still said "Please retry shortly" and showed an opening ETA | The deployed code predates BR1984. The refusal carries no admin reason, which BR1983 (#4251) added. | **✅ Already closed on main by BR1984 (#4254).** A settled prior refusal makes the next one a repeat: it is not retryable, uses "try again in a few minutes", and holds back the opening ETA. | E1 (a settled prior refusal is a repeat; an in-progress row is skipped; a later success is not a repeat) |
| D3 | "0s of preparation … the first call itself then took 0s" for a 2.5 s call | A pre-build admission call is recorded after the timer starts. Deployed before BR1958's window-mismatch rule. | **✅ Already closed on main (BR1958).** A call longer than the timing window gives the "cannot be separated" line, not a zero. | E2 (the report's shape: 2.461 s recorded 5 ms into the timer) |
| D4 | An ETA was shown before setup refused | The ETA runs before setup on a first attempt, by design | **🟡 Already queued — Q-2705** (BR1993). On a repeat, BR1984 holds it back (D2). | — |
| D5 | "Routing and ETA in 5.3s" has no breakdown. The only model call ran before the window, so the 5.3 s is not explained by model time. | The window is timed as a whole (`closeSetupWindow`), with no named steps | **🟡 BLOCKED — Q-2708** (missing information) | Not changed: no step inside the window is identified by this report |
| D6 | Other in-stream platform endings (for example "The build sandbox could not be set up — the build cannot create files.") may still offer "Fix with AI" | Same class as D1, but this report does not show those sentences reaching the button | **🟡 BLOCKED — Q-2709** | Not changed: F1 is limited to the two sentences this report proves. A neighbour test pins that the setup sentence keeps today's button. |
| D7 | `requestAnalysis.startTier` reads "sonnet" on a Weak, no-Claude build | An admin-only analysis label; the ladder row and the call show the real engines | Not changed: admin only, no user surface | — |

**BR1992 review residual:** AgentRunner takes `recordModel` once at `run()` start. No AgentRunner run started in this report, so it is **not** on this path. Not changed.

**BR1994 doc correction (reviewer note):** the BR1994 side-effect table said a specialist with a separate stream has no `'final'`. That was wrong. `SubAgent.ts` builds `childEvents` with `Object.create(deps.events)`, so a specialist reads the parent's build-wide `budgetStagesSaid`. After "Out of time", its hand-back notice is silent too, which is the intended behaviour. The BR1994 doc line is corrected in this PR, and a test pins both the inheritance and the `Object.create` source line.

## Side-effect review (owner rule t311u)

| Change | Adjacent behaviour | Check | Decision |
|---|---|---|---|
| F1: hide "Fix with AI" under the exact reconnect-refusal sentences | Every other stream error keeps the button | Seven neighbour messages keep `true`. Main's pre-start and empty answers are unchanged. Mutations M2 (substring match) and M5 (case-insensitive match) are caught. | Ship |
| F1: move the two sentences to `src/lib` | The server's error message and its repeat detection | The bytes are pinned. `new SandboxRecoveryUnavailableError(...)`.message is unchanged, and the repeat flag and `retryable: false` are unchanged. Repeat detection uses issue codes and its own regex, untouched. | Ship |
| F1: the user loses the button under this refusal | The refusal sentence itself says when to retry. The composer stays available. | No new button, no auto-retry, no extra call | Ship |
| Widen to every in-stream infrastructure ending (D6) | Could hide the button on a real app error that resembles one | — | **Not shipped** → Q-2709 |
| Add step timings inside "Routing and ETA" (D5) | Observation only, but the steps are not identified | — | **Not shipped** → Q-2708 |

## Queue

- **Q-2708 (BLOCKED, missing information):** a "Routing and ETA" window of about 5.3 s with no named step, on a turn whose only model call ran before the window.
- **Q-2709 (BLOCKED):** other in-stream platform infrastructure endings may still offer "Fix with AI".

No row is closed. Q-2705 is referenced, not duplicated.

Lessons carried:
- BR1983: no admin reason reaches the matched sentence.
- BR1985/86: the neighbours include Hindi, and the opposite class is tested.
- BR1987: nothing is newly charged, and no Node path changed.
- BR1989: an exact match only, no regex loosening.
- BR1990: the stand-down acts only on a positive exact match; anything unclear keeps main.
