# BR1994 — a large-app first build stopped by the 25-minute cap: "Out of time", then "I am continuing"; "about 22 min" after 25

Scope: BR1994 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `f631a04e` (BR1993, #4270). Read only via the read-only failed-BR MCP tools (`list_build_reports`, `get_build_report`). No remote autopsy write, replay, deploy, provider call, or production read or write happened outside those tools. Routing, billing, Router One and Pro Chain V2 admission were not touched.

## What the report holds (described generically; no request text, ids or timestamps)

- **The request:** a free Weak-tier **first** build of a large media-downloader app (APP_SCOPE LARGE, about 15 features; complexity 68).
- **Engine:** Surplus was admitted and delivered all 102 builder turns. The mega-app roadmap planned 6 steps.
- **Billing:** not charged; the bill was $0. Sandbox cost is recorded as the platform's own. No cost is invented here.
- **Truncation:** complete.

Times below are seconds after the report's start, and are rounded.

1. **Fast lane (about 205 s).** It wrote 17 files. One write was refused for a syntax error, and the typecheck failed on a wrong export name. It handed over to the full builder.
2. **Full builder.**
   - It fixed the type errors.
   - `npm install` exited 1 (ERESOLVE). `npm install --legacy-peer-deps` then exited 0, and a later plain `npm install` also exited 0.
   - The app first rendered in a real browser at **416 s** (IN_BUILD_GREEN).
   - The builder then added screens, with typecheck errors that it cleared.
3. **About 1446 s.** The model ended its turn claiming the app was built. The readiness check found two not-implemented placeholders. **Resume 1** followed (about 1452 s), with the notice "⏳ Not finished yet — … I am continuing. Please keep this open."
4. **About 1460 s.** The build's final budget stage was told to the user: "⏳ Out of time — saving your app and summarising what was done."
5. **About 1479 s.** The model answered the hand-back without changing anything. **Resume 2** followed, with the **same "I am continuing" notice**, 19 s after "Out of time".
6. **About 1500 s.** The 25-minute cap stopped the build. The resume-2 model call had been running for about 22 s and was stopped by our clock.
   - It is recorded under `claude-sonnet-4-6`, the BR1992 class (see D1).
   - The user's final line was "I stopped after about **22** min to avoid an endless loop …".
   - The report's own duration is 1506 s, about 25.1 min.

## Root causes

| # | Defect in this report | Root cause | Closed by | Lock |
|---|---|---|---|---|
| D1 | The call stopped by the cap is filed under `claude-sonnet-4-6` on a no-Claude Surplus build | The Surplus runner had no `plannedModel`, the BR1992 class | **✅ Already closed on main by BR1992 F1 (#4269)**, deployed after this report | `tests/br1992Autopsy.test.ts` F1 |
| D2 | "I am continuing. Please keep this open." came 19 s **after** "Out of time — saving your app and summarising what was done." | `handBackNotice` did not know the build had already said its final budget stage. The two lines come from separate modules. | **F1 ✅ RESOLVED.** When the build-wide final stage has been said (`events.budgetStagesSaid` has `'final'`), both hand-back kinds (unfinished, style) return no line. The resume itself is unchanged. Unknown or false keeps main's line. | `tests/br1994Autopsy.test.ts` F1 (pure table, AgentRunner run with and without the stage, all three call sites wired); two existing pins updated deliberately |
| D3 | "I stopped after about 22 min" after a build that ran about 25 min | The ending quoted the full builder's `maxBuildMs`, which is the generation budget remaining when that runner started (the cap, less the correction reserve, less the fast lane and setup), not the time the build had run | **F2 ✅ RESOLVED.** `buildClockMinutes` quotes the minutes elapsed since the event stream's start (the request's arrival) when that start is known and rounds to at least 1 min. With no cap the sentence names no number, as on main. With an unknown, zero or future start, or under half a minute, it keeps main's runner figure. Used at both wall-clock endings (abort and between-turn timeout). | F2 (helper table, the sentence, a runner started 25 min into the build, a runner started with the build, a user Stop) |
| D4 | Resume 2 started 21 s before the cap. Its prompt says "There is still build time left", and the call was cut off. | `decideUnfinishedResume` has no notion of the remaining clock | **🟡 BLOCKED — Q-2706** | Not changed: standing down changes the build's outcome classification and ending, and in other builds a last resume can still fix a placeholder |
| D5 | The release gate names "$ npm install → exit 1" as a build-breaking blocker although the same command later exited 0 | On a build that did not succeed, a failed command is only forgiven when the build is `ok: true` (`resolveRecoveredOnSuccess`). `shippingIssueCount('error')` counts it, and a RED gate is what makes a build free. | **🟡 BLOCKED — Q-2707** (money-adjacent) | Not changed: forgiving it on failed builds could turn a RED gate non-RED and newly charge a paid build (BR1987 rule) |
| D6 | The fast lane wrote a file with a stray `<<` and the wrong export name; react-native packages in a web app caused ERESOLVE; one `edit_file` miss | Model quality. The write guard refused the broken write, and the full builder recovered. | Not changed | — |
| D7 | The end-of-turn note says "I made your change, but I could not open your app" on a **new** app | Shared green-guard wording | Not changed: wording candidate only | — |

**BR1992 review residual:** AgentRunner takes `recordModel` once at `run()` start. This report shows no Surplus → Weak fail-open (every turn was Surplus), so it is **not** on this path. Not changed.

## Side-effect review (owner rule t311u)

| Change | Adjacent behaviour | Check | Decision |
|---|---|---|---|
| F1: silence the hand-back notice after "Out of time" | The resume still happens, so the model still gets its turn | The integration test runs the real AgentRunner. Before the final stage (`wrapping` only) the notice is emitted exactly as on main. | Ship |
| F1: a sub-agent's stream | **Corrected in BR1995:** a specialist's `childEvents` is `Object.create(parent)` (`SubAgent.ts`), so it reads the parent's build-wide `budgetStagesSaid`. Once the build has said "Out of time", a specialist's hand-back notice is silent too, which is the intended behaviour. Only a stream with no such set (or one without `'final'`) keeps main's line. | `=== true` only, so an absent set keeps main's line | Ship |
| F2: elapsed minutes in the wall-clock sentence | User Stop, futile and every other cause never quote minutes | A user-Stop test, plus `abortSummary` uses `minutes` only for `watchdog` | Ship |
| F2: a single runner that started with the build | Same sentence as main whenever elapsed and the runner budget round to the same minute (a runner started with the build, as in the neighbour test). A build that timed out after a slow start now quotes its longer real duration. | Neighbour test; no successful build is affected | Ship |
| Stop resuming in the final budget stage (D4) | Outcome changes from STOPPED-at-cap to a not-ready ending; may lose a last fix | — | **Not shipped** → Q-2706 |
| Forgive a superseded failed command on failed builds (D5) | Release gate colour and free/charged decision | Could newly charge | **Not shipped** → Q-2707 |

## Queue

- **Q-2706 (BLOCKED):** an unfinished-app resume in the final budget stage is told "There is still build time left" and is usually cut off by the cap.
- **Q-2707 (BLOCKED):** on a build that did not succeed, a failed command that later ran clean still counts as a build-breaking blocker on the release gate. This is money-adjacent.

No row is closed.

Lessons carried: BR1987 (nothing newly charged; D5 queued for exactly that reason), BR1989 (no parser change), BR1990 (both fixes act only on positive evidence: `outOfTime === true`, and a known, past build start).
