# BR1996 — a discounted build's green line did not add up: "Build price − Discount" was not "You pay", because the sandbox fee came after the discount

Scope: BR1996 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `81a1e0ff` (BR1995, #4272). Read only via the read-only failed-BR MCP tools (`list_build_reports`, `get_build_report`). No remote autopsy write, replay, deploy, provider call, or production read or write happened outside those tools. Routing, billing amounts, Router One and Pro Chain V2 admission were not touched.

## What the report holds (described generically; no request text, ids or timestamps)

- **The request:** a small one-line new-app request for a vite-react web tool on the free Weak tier. Surplus delivered every turn, with no Claude.
- **Outcome:** SUCCEEDED, gate YELLOW (dependency advisories). The app rendered in a real browser. One feature returns demo results, and the user was told so in the summary.
- **Billing:** charged ₹2.76 and debited from the wallet. The build discount (10%) took the price from ₹2.99 to ₹2.69, and the 2.5% sandbox service fee (about ₹0.07) was then added to that. The report's billing block shows this order (`preSandboxSubtotalUsd` plus `sandboxFeeUsd` equals `billedUsd`). No other cost is claimed here.
- **Truncation:** complete. **Deployed code:** the report predates BR1952 (#4124), BR1958 (#4132) and BR1961 (#4146). See E1–E3.

The order, in seconds after the report's start (rounded):

1. **About 0.6 s.** Workspace setup failed: E2B's concurrent-sandbox cap was reached. The raw reason went to admin `detail` only. The user was told the engine was unavailable, that files could not be created, and to try building again (E3).
2. **About 5–102 s.** The text-only fast lane ran anyway (E2). Its file plan **folded `package.json` into `tsconfig.json`**, "so they are still written" (E1). No `package.json` was written, the fast lane's typecheck failed on `Cannot find module 'react'`, and it handed over to the full builder.
3. **About 146–199 s.** The full builder found no `package.json`, wrote one, and installed. Typecheck errors were cleared.
4. **About 328 s.** First real-browser render (IN_BUILD_GREEN). End-of-build checks passed: a journey, mobile layout and the production build.
5. **About 664 s.** Settle. BUILD_DISCOUNT recorded "₹2.99 → ₹2.69". The fee was added afterwards. The bill was ₹2.76.

## Root causes

| # | Defect in this report | Root cause | Closed by | Lock |
|---|---|---|---|---|
| D1 | The user's green line (panel, and appended to the summary) reads, from these figures, "Build price ₹2.99 · Discount 10% (−₹0.30) · You pay ₹2.76". The first two figures make ₹2.69, not ₹2.76. | The settle applies the discount first and then adds the 2.5% sandbox service fee, in both the normal and the watchdog settles. `buildDiscountLine` and the panel's copy of it name only the price before the discount, the discount and the final amount, so the fee is missing between them. The fee has its own line elsewhere, but the green line does not reconcile on its own. | **F1 ✅ RESOLVED (display only).** When the breakdown carries a positive, finite `sandboxFeeInr`, the line now reads "… · Discount 10% (−₹0.30) · Sandbox service fee +₹0.07 · You pay ₹2.76". It is wired at both route call sites and in the panel. With no fee, a zero fee, an unusable fee or no discount, the line is byte-identical to main. No amount is computed, changed or charged: the figure is the breakdown's own `sandboxFeeInr`. | `tests/br1996Autopsy.test.ts` F1 (the report's shape, reconciled within one paisa of rounding; a larger bill; main's pinned line; eight unusable fees; no discount; a token-floor stop carrying no fee; the bill unchanged; white-label; both call sites and the panel's exact expression) |
| D2 | `package.json` folded into `tsconfig.json`, so no manifest was written and the fast lane failed on missing React types | The fold rule treated a config file as co-locatable | **✅ Already closed on main by BR1952 (#4124).** Only co-locatable source modules fold. Config and manifest files keep their own paths. | E1 |
| D3 | The text-only fast lane ran against a workspace whose setup had failed | No setup gate on the fast lane | **✅ Already closed on main by BR1952 (#4124)** (`FAST_LANE_SKIPPED_SANDBOX`, `fastLaneWouldRun = !sandboxUnavailable && …`) | E2 |
| D4 | "I can't create files right now … please try building again", followed by a build that delivered the app | Setup-failure wording | **✅ Already closed on main by BR1961 (#4146)** ("I'm still trying … You don't need to start the build again.") | E3 |
| D5 | TIME_TO_FIRST_CALL "0s … the first call itself then took 0s" for a pre-build admission call | A backfilled call against a 0 s window | **✅ Already closed on main by BR1958 (#4132)** (the window-mismatch line; pinned by BR1995 E2) | `tests/br1995Autopsy.test.ts` E2 |
| D6 | The full builder framed a new app as "fix and complete the app that was partially built", and the summary opened "I've successfully fixed …" | Model wording when a fast lane hands over a salvaged workspace with compile errors. No platform text says "fix" (`SIMPLE_BUILD_FALLBACK` says "switching to the full builder to finish it"). | **🟡 BLOCKED — Q-2710** | Not changed: steering every hand-over's framing changes builder prompts for all fast-lane fallbacks |
| D7 | The summary's dependency note counts "1 vulnerable dep (12 advisories)" via OSV, while the release gate says "2 known vulnerabilities (1 high, 1 moderate)" via npm audit | Two scanners count different units (affected packages and advisories vs npm's vulnerability entries). Each line names its own source. | Not changed: no false statement established | — |
| D8 | COMPLEXITY_ROUTING reads "COMPLEX (score 15, model)" | The decision comes from the model preflight. The number is the heuristic score. Admin only. | Not changed: admin only | — |

**BR1992 review residual:** AgentRunner takes `recordModel` once at `run()` start. Every turn here was Surplus and no fall-back happened, so it is **not** on this path. Not changed.

## Side-effect review (owner rule t311u)

| Change | Adjacent behaviour | Check | Decision |
|---|---|---|---|
| F1: name the fee inside the discount line | No discount: no line, as on main | The no-discount and zero-discount tests | Ship |
| F1 | A discount on a token-floor stop (no fee) | `proSandboxFee(0)` gives `sandboxFeeInr` 0, so the line is main's | Ship |
| F1 | The amount charged, the wallet debit, the discount floor and the fee | Untouched: the line reads `costBreakdown.sandboxFeeInr`, already computed. A test asserts the bill is unchanged. | Ship |
| F1 | The existing pinned line `Build price ₹156.60 · Discount 20% (−₹31.32) · You pay ₹125.28` | Called without a fee, still byte-identical (its own test passes unchanged) | Ship |
| F1 | Rounding: price, discount and fee are each rounded to the paisa | The sum is within ₹0.01 of "You pay" (asserted). The previous gap was the whole fee. | Ship |
| F1 | The summary already carries "Sandbox service fee (2.5% of subtotal): ₹X." | The fee is now named twice in the summary (once on its own line, once in the green line). Same figure, no contradiction. | Ship |
| Change the hand-over prompt so the builder does not call a new app a "fix" (D6) | Every fast-lane fallback's builder turn | — | **Not shipped** → Q-2710 |

## Queue

- **Q-2710 (BLOCKED):** after a fast-lane hand-over on a new app, the full builder describes its work as fixing a partially built app.

No row is closed.

Lessons carried:
- BR1983: no admin or provider text reaches users.
- BR1987: no amount, debit or Node path changed; nothing is newly charged.
- BR1989: no parser change.
- BR1990: the fee is named only on a positive, finite value; anything else keeps main.
