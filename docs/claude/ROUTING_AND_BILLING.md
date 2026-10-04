# Model routing, tiers, billing and the White-Label Law

> Moved verbatim out of `CLAUDE.md` on 2026-10-04 (admin: *"han"* to shrinking it — the file was 563 KB and was loaded into every message of every session). Read it before changing any model ladder, judge, tier, price, markup, wallet path, or any user-facing text that could name an AI vendor. Nothing here was reworded; the rules in it are as binding as they were in `CLAUDE.md`. `CLAUDE.md` keeps a short summary and a pointer to this file.

## NavBharatAI Pro v3.0 — Model Routing Policy (admin-CONFIRMED 2026-07-12) — ⚠️ CONFIRM WITH ADMIN BEFORE CHANGING

**This is the single source of truth for which AI model runs where in v3.0.** It was explicitly
designed and confirmed by the admin (aashishcpmt09) on 2026-07-12. **DO NOT change any part of this
routing — the ladders, the judge-per-mode, the co-agent mapping, or the "no Claude in free" rule —
without first confirming the exact change with the admin.** (Same discipline as the absolute rules.)
Model ids are env-tunable (defaults below); the STRUCTURE is the policy.

### 1) FREE user (the 50,000 gift-token / never-paid user) — cheapest first; Sonnet/Opus NEVER; Haiku = last resort (amended 2026-07-13)
A graduated ladder (start cheapest; only climb when the judge still finds a real mistake):
1. **`glm-4.7-flash`** / **cheapest Kimi** (flash rung — sasta)
2. **`glm-4.7`** / **`kimi-k2.5`** (cheap coders)
3. **flagship `glm-5.2` / `kimi-k2.7`** (only as the LAST model rung)
4. **Vertex** — after the flagship rung also fails (admin: "agar sab failed ho to vertex use bhi kar sakte hai, but last me").
5. **Claude HAIKU** — the ABSOLUTE last rung (HAIKU AMENDMENT, admin 2026-07-13: "weak module me claude haiku
   add kar de? to last me") — model-pinned by construction; see the 🔒 rule below.
- **Judge = Grok.** After a build, Grok judges → OK ⇒ done; "repair" ⇒ fix on the cheap coders
  (`glm-4.7`/`kimi-k2.5`) and re-judge; still failing ⇒ climb to the flagship rung; flagship fails ⇒ Vertex.
- **Sonnet/Opus NEVER run for a free user — anywhere** (amended: Claude **HAIKU** alone is authorized, and
  only as the final rung). This includes the post-build heal gates (integrity / preview / C9
  reviewer-autofix / runtime): on a free build they MUST run on the **non-flagship cheap coders
  (`glm-4.7` / `kimi-k2.5`)** — NOT flash (too weak to repair), NOT flagship, NOT Sonnet/Opus (the heal
  chains inherit the same Haiku-last backstop).
- **🔒 ABSOLUTE RULE — WEAK MODULE ⇒ NO SONNET/OPUS, EVER; HAIKU = the ONE authorized last resort
  (admin-mandated 2026-07-13, AMENDED by the admin the same day, unbreakable):** original rule: weak module
  never calls Claude. **HAIKU AMENDMENT (admin verbatim: "agar ham, weak module me claude haiku add kar de?
  to last me. par sart yeh hai, weak module me claude ka haiku ke alawa kuch aur nahi chalna chahiye, matlab
  sonnet ya opus never never!!!"):** the weak module may now use **Claude HAIKU as the absolute LAST rung**
  (after GLM/Kimi → Vertex/Gemini) — and ONLY Haiku; **Sonnet/Opus never run on weak, ever**. Enforced by
  construction at THREE layers, not convention: (1) `enforceNoClaude(chain, noClaude)` (`routes/agentv3.ts`)
  strips the `CLAUDE` (Sonnet/Opus) runner from the FINAL `buildTurnRunner` chain and keeps ONLY the
  model-pinned `CLAUDE_HAIKU` backstop, MOVED to the chain's END ("to last me") — the backstop is
  `forceModelRunner(…, haikuModel())`, so it physically cannot execute any non-Haiku model; (2) the
  `ClaudeClient.runTurn` no-Claude-zone chokepoint (`noClaudeZone.ts`) refuses any NON-HAIKU Claude id inside
  a weak build's async context — a raw/forgotten Sonnet path is refused before a token is spent; (3) the
  report's honesty detector (`claudeProviderDelivered`) flags a Sonnet/Opus-class delivery as
  `NO_CLAUDE_VIOLATION` while an authorized Haiku delivery is clean. `noClaude` is threaded from
  `powerSpecResolved.cheapOnly || freeTierBuildActive` into EVERY `buildTurnRunner` call site, and the weak
  chain is `GLM/Kimi → Vertex/Gemini → HAIKU (last)`. ROOT CAUSE the original rule closed (deep-test App #1):
  the "no Claude" guarantee was tied only to `cheapOnly`, so a weak build whose heal gate didn't thread that
  flag ran 4 Sonnet calls on a free build. The resolved `powerLevel` + `noClaude` appear in every build report
  (with the amendment, `noClaude: true` means "no unauthorized Sonnet/Opus ran"; Haiku may have). Do NOT
  weaken or bypass this guard — or extend weak beyond Haiku — without explicit admin sign-off.

### 2) PAID user (bought tokens with real ₹) — flagship first, Claude only as last resort
1. Every 1st build: **flagship `glm-5.2` / `kimi-k2.7`**.
2. **Judge** → no error ⇒ done; error ⇒ send back to **GLM/Kimi** to repair → re-judge.
3. Still error after that ⇒ **Claude fixes it itself** (Sonnet repair).
- **Judge = Grok OR Sonnet — either is fine** (admin: "koi na, dono chalne do, chalega").

### 3) The 5 selectable power tiers — TIER→MODEL redefined by the admin 2026-07-13 (supersedes the old "power = Opus at low/high/max")
**The user's selected tier is EXACTLY the model the backend calls — no substitution** (admin: "user ne
jo select kiya hai, wahi backend par provider call ho, koi aur nahi"). Enforced in code (Fix 59):
| Tier (UI) | Internal | Model | Notes |
|---|---|---|---|
| Weak | `weak` | GLM/Kimi → Vertex/Gemini → **HAIKU last resort ONLY** — **Sonnet/Opus NEVER, in any circumstance** (Haiku amendment 2026-07-13) | free tier; `enforceNoClaude` strips Sonnet/Opus from every chain, keeps the model-pinned Haiku backstop last |
| Normal | `off` | Sonnet (adaptive routing, unchanged) | today's behaviour stays |
| Strong | `mini` | **SONNET pinned 100%** (was Opus low) | never Opus anywhere on this tier — build, sub-agents, heal gates, plan (Grok), judge (paid), vision (cheap). Bills Sonnet-equivalent × 3 |
| Powerful | `medium` | **Opus, effort `medium`** (was high) | bills real Opus × 2 |
| Full Team | `max` | **Opus, effort `max` (ultracode)** | bills real Opus × 2 |
- On the two OPUS tiers: builder + repair/heal gates + **judge** + **plan phase** ⇒ **Opus** (`claude-opus-4-8`).
- Paid pinned tiers (`mini`/`medium`/`max`) never let the GLM/Kimi cheap floor lead and never take the
  fast lane — the pinned model leads 100%; Vertex/Gemini/Haiku remain error-only last-resort backstops
  (the "never break" insurance), used only after the pinned model itself has failed.

### Judge (reviewer) per mode — must become MODE-AWARE (today it is a single global setting)
| Mode | Judge |
|---|---|
| Free | **Grok** |
| Paid | **Grok or Sonnet** (either) |
| Power | **Opus** |

### Co-agents / other engines — the mapping (same spirit: cheap for free, strong for paid, Opus for power)
| Engine | Free | Paid | Power |
|---|---|---|---|
| Builder + frontend/backend sub-agents | flash → 4.7/kimi → flagship → Vertex | flagship → cheap-repair → Claude | Opus |
| Manifest / shared-contract planner | cheap (GLM/Kimi) | cheap-first, Claude backstop | Opus |
| **Judge / Reviewer** | **Grok** | **Grok or Sonnet** | **Opus** |
| Plan phase | Grok | Grok/Sonnet | **Opus** |
| Vision (image describe) | Gemini/Grok (cheap) | Gemini/Grok | Claude/Opus |
| Heal gates (integrity / preview / C9 / runtime) | **GRADUATED: cheap coder → FLAGSHIP LAST (`glm-4.7`→`glm-5.2`, `kimi-k2.5`→`kimi-k2.6`→`kimi-k2.7-code`). NEVER Sonnet/Opus.** Only the FLASH rung is skipped, and it is matched BY NAME, not by position — Kimi has no flash model, so `kimi-k2.5` is KEPT (this rule names it as a heal model). `AGENTV3_WEAK_FLAGSHIP_HEAL=on` restores the 2026-08-02 flagship-LED heal. ⚠️ Flash is still the FIRST rung of the main weak BUILD — it is dropped from the HEAL only. | Claude/Sonnet | Opus |

**SUPERSEDED, 2026-08-13 — the flagship no longer LEADS a weak heal.** The 2026-08-02 entry above put the
flagship FIRST in the heal ladder. The admin then said, three separate times, *"top module last me chalne,
starting me nahi"* and *"flagship use kar sakte hai, LAST me"* — i.e. "last" means last in the LADDER, not
merely last in the build's lifecycle (a heal already runs at the end of a build, which is how the earlier
reading justified itself). **The DEFAULT is now the graduated ladder: cheap coder → flagship LAST**, with the
flash rung dropped because a heal must not begin on the model that produced the failing app — matched BY
NAME, so Kimi's `kimi-k2.5` (which this file names as a heal model) is kept, and the main weak BUILD still
leads with flash exactly as before. Setting
`AGENTV3_WEAK_FLAGSHIP_HEAL=on` restores the flagship-led behaviour without a deploy if a real report ever
shows the graduated ladder looping. Test-locked in `tests/weakHealLadder.test.ts`, which asserts the real
MODEL ORDER out of the constructed chain rather than just the options object — and that the PAID ladder is
untouched, since dropping a rung there would silently downgrade paying users' repairs.

⚠️ **`AGENTV3_WEAK_FLAGSHIP_HEAL=off` WAS A COST TRAP (found and fixed 2026-08-13, while answering the
admin's "mera kharcha kam ho").** The `off` branch returned `{ claudeFirst: false, cheapOnly: true }` with
**no `allowCheapFloor`** — and that does NOT mean "cheap coders instead of the flagship". `buildTurnRunner`
only builds the GLM/Kimi floor when `allowCheapFloor` is set, and `cheapOnly` self-disables without one
(`cheapOnly && floorRunners.length > 0`), so the weak heal chain collapsed to **VERTEX → GEMINI → Haiku with
no GLM/Kimi in it at all**. On the tier NavBharatAI pays for ITSELF, that made the "cheaper-sounding" switch
the **most expensive** rung in the stack: gemini-pro **$10/MTok out** and Haiku **$5**, against flagship
glm-5.2's **$4.40** and kimi-k2.7's **$4.00** (`providerRates.ts`). The branch now carries
`allowCheapFloor: true, free: true`, so it does what its name says.

**COST CONCLUSION, FOR THE RECORD: on a weak heal the FLAGSHIP GLM/Kimi IS the cheap choice — turning it off
costs the admin MORE, not less.** Test-locked in `agentv3.test.ts`: BOTH branches must keep a real floor, so
no future edit can silently route a weak heal to Gemini/Haiku again.

### Env model-id defaults (tune the exact ids here — the code reads these, so no redeploy to change a rung)
- Free ladder (LIVE, Slice 3): flash-first — `AGENTV3_FREE_GLM_MODEL` (default `glm-4.7-flash,glm-4.7,glm-5.2`),
  `AGENTV3_FREE_KIMI_MODEL` (default `kimi-k2.5,kimi-k2.6,kimi-k2.7-code`), then Vertex/Gemini as the absolute
  last rung (never Claude). Separate from the paid `GLM_MODEL`/`KIMI_MODEL` so tuning free never touches paid.
  Dormant until the free-tier master (`AGENTV3_FREE_TIER_CHEAP` / `AGENTV3_COST_ROUTING`) is on.
- Paid/default ladder: `GLM_MODEL` (flagship-first, e.g. `glm-5.2,glm-4.7`), `KIMI_MODEL` (e.g. `kimi-k2.7,kimi-k2.6`).
- ⚠️ The exact Kimi rung ids (`kimi-k2.5` / `kimi-k2.6` / `kimi-k2.7` / `-code` suffix) are admin-tunable —
  cross-check them against the live Moonshot model list before flipping on.

**Implementation status (2026-07-12):** policy SAVED here; code changes ship slice-by-slice (per-tier free
ladder, mode-aware judge, free-tier heal-gate re-route to cheap coders, power-mode judge+plan→Opus), each
tested + gated + merged. Until a slice ships, the current behaviour (audited 2026-07-12) still applies.

### 🔴 THREE TIERS, THREE LADDERS, "100% USI MODE MEIN" (admin-mandated 2026-09-14) — SUPERSEDES the five-tier table and the boolean-assembled chain above

Admin, verbatim: *"abhi 5 type hai — week, normal, strong, power, full team. inko simple 3 me badlo, week,
normal, strong. bas."* and *"user ne agar teeno mode me se jo select kiya hai, aap 100% usi mode me bane."*
Everything above about 'medium' (Powerful) / 'max' (Full Team) and about `claudeFirst` / `allowCheapFloor`
/ `cheapOnly` / the Vertex-Gemini "last resort" describes the engine BEFORE this date. The source of truth
is now **`src/server/AgentV3/tierLadder.ts`**, and the build chain is built from it rung for rung.

| Tier (UI) | Internal | The ladder (first → last) | Escalation cap |
|---|---|---|---|
| Weak (free) | `weak` | GLM `glm-4.7-flashx` → KIMI `kimi-k2.7-code` → GLM `glm-5.3` → Claude **Haiku** | never escalates (NavBharatAI pays) |
| Normal (paid economy) | `off` | GLM `glm-4.7-flashx` → KIMI `kimi-k2.7-code-highspeed` → GLM `glm-5.3` → Claude Sonnet | Sonnet |
| Strong (paid premium) | `mini` | GLM `glm-5.3` → KIMI `kimi-k3` → Claude Sonnet → Claude **Opus** | Opus (its last rung) |

🧠 **A BIG APP DOES NOT OPEN ON THE CHEAPEST RUNG (admin 2026-09-17, verbatim: "kimi ko bade aur
complex task dedo, kabhi bhi — starting me bhi de sakte ho, beech me bhi! task chota/bada/mild/complex
hai code se pata na lage to gptnano se puchwa lo!!").** `AGENTV3_COMPLEX_TO_KIMI` — ⚠️ **NOT set, and
the code default is ON**; `off` restores the pre-change behaviour exactly (every build opens on rung 1)
and costs nothing while off. Read by `src/server/AgentV3/complexityRouting.ts`; applied through
`buildTurnRunner`'s new `complex` flag.

- **A `complex` verdict skips the cheap flash opener**, so on Weak and Normal the first engine to see
  the app is **KIMI**. Strong has no flash rung and is untouched. "Starting me bhi" is literal.
- **The line is 40 — `RequestAnalyser`'s OWN top tier boundary**, not a second invented threshold
  (`simple_app` ≤20 capped, `coding` 30, `debugging` 45, `complex_app` 58, `architecture` 80).
- 🔑 **THE HOOK WAS ALREADY THERE, UNUSED.** `analyzeRequest`'s docblock has said since the cost-ladder
  work that it "marks the genuinely ambiguous ones (`ambiguous: true`) so a caller MAY refine them with
  a cheap LLM analyser" — and nothing ever read that flag. This is that half, so no new scoring concept
  competes with the existing one.
- 💸 **A model is asked ONLY within ±3 of the line**, deliberately narrower than `ambiguous` itself
  (which marks BOTH the 20 and 40 boundaries, because it was written for a three-tier ladder). Only the
  40 line can flip this binary decision, so asking about a score of 18 would spend a call to move a
  verdict from `simple` to `simple`. **"Kharcha kam se kam" applies to the classifier too.**
- 🔒 **It cannot break, hang or mislead a build**: the call is raced at 6 s, and a throw, a timeout, an
  empty reply and an unparseable reply ALL fall back to the deterministic verdict — never to a guess.
  `simple` is the default on every doubt, including a NaN score.
- ⚠️ **What it costs, plainly:** on Weak (which NavBharatAI pays for itself) a complex build opens on
  `kimi-k2.7-code` ($0.95/$4.00) instead of `glm-4.7-flashx` ($0.07/$0.40) — ~13× the input price for
  THOSE builds. The bet is that a cheap rung which fails is paid twice, once in the wasted call and
  once in the heal. **Watch: the share of builds routed complex, and whether their heal count drops.**
- 📏 **A REQUEST THAT STATES NOTHING TO SIZE BUYS NO SECOND OPINION (autopsy 1be16985, 2026-10-01; no flag).**
  *"Make biology learning app"* — four words, no features — was read as `complex` by the classifier, opened
  on KIMI and skipped the fast lane. A request the scorer read but did not recognise now buys the call only
  when it STATES a scope (`statesAScope`: ≥ 2 named features via `countEnumeratedFeatures`, or
  `BIG_SOFTWARE_NOUN`); otherwise it is an admitted unknown and opens on the cheap rung. A script the scorer
  cannot read still buys the call. This also closes the "a bare question buys a call" cost item.
- 🧩 **A TESTED TEMPLATE OPENS ON THE FIRST RUNG (admin accepted 2026-09-27, autopsy 15151196).** A
  golden scaffold is seeded only for a starter chip's prompt VERBATIM, so the template already is the
  request and the job is verify-and-polish. The memory-match chip still scored 63 and opened on KIMI for
  21 calls that changed one line. `scaffoldedComplexityDecision` makes it `simple` (source `scaffold`)
  with no model call; the ladder still climbs if the first rung fails. No flag of its own —
  `AGENTV3_GOLDEN_SCAFFOLD=off` turns the scaffold, and so this, off.
  🔴 **FOR SIX HOURS ON 2026-10-01 NO TEMPLATE WAS SEEDED AT ALL (autopsy 31254f9a).** The pre-seed was
  guarded by "`src/` holds no file", and #3435 had just made setup write our starter into every fresh
  workspace (the image's `WORKDIR` means the folder always exists, so an EMPTY workspace takes the starter
  completion path). The calculator chip was built from scratch by the fast lane while this routing line
  said the template was seeded. The guard now asks `holdsOnlyOurStarter` ("is anything here somebody's
  work?" — our untouched starter and chip templates are not), a skipped seed says so
  (`GOLDEN_SCAFFOLD_SKIPPED`), and the rebuild guard asks the same of the saved files, so a retry after a
  Stop is not flipped to an EDIT of "your app". ⚠️ **Any check of the form "is the workspace empty?" now
  means "is it holding only our starter?" — ask `starterFragment.ts`, never count files.**
- 🗺️ **THE PLANNERS ARE THE ONE EXCEPTION (admin chose "A", 2026-09-26, autopsy 7d79254b).** The
  roadmap, blueprint and project-mode planners are plans, so they climb `planLadder` through
  `makePlanTextRunner` (#3334) instead of the complex build chain — which had cost a large app 76 s of
  Kimi reasoning before its first file, and a project decomposition 315 s and a timeout (autopsy
  eed79815). There is no separate kill switch. The build itself still opens on KIMI. ⚠️ On Weak, with
  `AGENTV3_NEMOTRON=weak`, the plan rung is Nemotron Ultra — also a reasoning model, speed unmeasured.
  🔴 **CORRECTED 2026-09-29 (admin: "B bana do") — IT IS NOT ANY MORE, and it was measured first.** On
  "Blue Berry" (autopsy 6a4a799f) both Ultra planner answers were unusable: the roadmap was unreadable
  after 120 s, the decomposition was cut off at the 300 s stream cap — 7 of 24 minutes. Weak is now in
  `PLAN_FORBIDDEN_TIERS` beside Strong, so its plan rung is `glm-4.7-flashx` (thinking disabled) whatever
  the flag says. **Only the plan moved: Weak's JUDGE stays on Nemotron** where the flag names it.
  🧭 **AND ON WEAK, HAIKU IS THE PLAN'S SECOND RUNG (admin 2026-09-30: *"planing ke liye haiku accha hai,
  to lagao"*, autopsy a2b9c802).** The Weak plan ladder is `flashx → Haiku → KIMI → glm-5.3 → Nemotron
  super`. With flashx benched for crawling, both JARVIS planners fell to `kimi-k2.7-code`, which always
  reasons: one plan was cut off after 240 s, the other spent 12,000 tokens thinking and returned nothing.
  Haiku answers directly at about KIMI's per-token price ($1/$5 against $0.95/$4). ⚠️ **PLAN ladder only**
  (`weakPlanHaikuEnabled` in `tierLadder.ts`): the Weak BUILD ladder still has Haiku LAST, Normal and
  Strong have no Haiku, and `enforceNoClaude` still strips every other Claude rung. **`AGENTV3_WEAK_PLAN_HAIKU`**
  — NOT set; default ON; `off` restores the old order with no deploy. ⚠️ Haiku's plan quality on this
  platform was unmeasured when this shipped. Watch planner outcomes (`MEGA_ROADMAP*`, `PROJECT_MODE*`)
  on Weak builds where flashx was benched. Test-locked in `tests/aPlanIsAnsweredNotThoughtAbout.test.ts`.
- 🔗 `healLadder` and this router share ONE definition of "the cheap opener"
  (`withoutCheapFlashLead`), applied by `buildTurnRunner` for `heal || complex`. They stay separate
  FLAGS — "this is a repair" and "this is a big app" are different questions with the same answer
  today — and a test asserts the two produce identical ladders so they cannot drift.
- ⏱️ **A COMPLEX build's fast lane gets room for its contract (admin-approved 2026-09-24, autopsy
  3ab93068). `AGENTV3_FASTLANE_COMPLEX_SECONDS` is NOT set; the code default of 480 s governs, clamped
  to 240–900, and an unreadable value falls back to 480, never to "no limit".** Opening a complex app on
  a reasoning rung made its plan call take 40 s. Its shared contract was then cut at 56 s by its share of
  the 240 s budget, and the missing contract cost 419 s of repair. So a complex lane gets the larger budget
  and is never talked out of its contract (`fastLaneBudgetMs`). An ordinary lane keeps 240 s, unchanged.
  The `FAST_LANE_PHASES` line now names the contract's own clock (`stopped at its own Ns cap`) instead of
  leaving *"build budget reached"* to be read as the whole build. **Watch: the repair share of complex
  builds in that line.**

🏗️ **`AGENTV3_PROJECT_MODE` — SOFTWARE PROJECT MODE. BUILT, WIRED, TESTED, AND ASLEEP SINCE
2026-07-04. ⚠️ Recorded here on 2026-09-17 because it was MISSING FROM THIS REGISTRY ENTIRELY** —
zero mentions in this file, eight in `PROGRESS.md`. That is precisely the drift this registry exists
to prevent, and it is why the capability is invisible: a session asked to build "milestone building"
would build a second copy of it, and the admin cannot decide on a feature nobody tells them exists.

**What it is** (`src/server/AgentV3/ProjectPlan.ts`, 592 lines + `ProjectPlanStore.ts`): for a build
too big for one conversation, the project is decomposed ONCE into modules carrying explicit
`dependsOn` edges and **frozen export contracts**, persisted durably, and then each turn builds ONE
module in a FRESH context holding only that module's spec plus the contracts of modules already
done — never the transcript. Context stays small however big the project is, so size is bounded by
the plan rather than by the window. It answers the five ceilings by name: context window, the
80-step cap, the 30–60 min clock, the budget cap, and small-app-tuned verification.

🔒 **The wiring is VERIFIED, not taken from the doc** (`routes/agentv3.ts` ~14272–14356 creates and
saves the plan and projects the todos, ~18571 marks each module done/failed after its turn, ~19591
auto-continues to the next buildable module). This is a live path behind a flag, not dead code —
unlike `EmbeddingSearch`, whose only reader is called from nowhere.

✅ **SET `on` IN CLOUD RUN BY THE ADMIN 2026-09-18** — the two-month-old pending decision above is
taken, and Software Project Mode is live for every user. ⚠️ **It had never run for a single real
build before that moment**, so the first real mega-prompts are its first evidence; treat it as new.

🔴 **AND THE SWITCH WAS MEASURED THE SAME HOUR: THE DOOR IT OPENS WAS BOLTED.** `megaProjectSignals`
counted `^- ` / `^1. ` LINES, so **not one of fourteen realistic prompts fired** — "school ERP with
students, teachers, attendance, fees, exams, timetable, library, transport" scored **zero**, while
`ProjectPlan.test.ts`'s own passing case is the same system written as a bulleted spec. **The gate was
built to read a DEVELOPER's spec; real users write one line with commas.** Identical class to the
scoring fix shipped hours earlier that day (`COMPLEX_APP_SIGNAL` listed the words a developer writes
and scored "hospital management system" 5 — the score of "hi"): the instance was fixed in the SIZER,
the two GATES were never hunted.
- Both now ask one shared counter, `src/server/AgentV3/enumeratedFeatures.ts`
  (`countEnumeratedFeatures`), which reads bullet lines AND inline `a, b, c` / `a aur b` runs.
- ⚠️ **`MEGA_BULLETS_WITH_NOUN` moved 8 → 6**, and 6 is not invented: `complexityFromPrompt` already
  floors a named complex app's `featureCount` at six. It is the weaker half of an AND (a big-software
  noun must be present too). Measured margin: every ordinary app prompt counts **0–2**, every real
  project prompt **5–8** — six sits in the gap, not on an edge.
- 🔎 **SIBLING FIXED IN THE SAME CHANGE (rule 3): `featureCount` in `lib/appScopeAnalyzer.ts`**, the
  gate behind `AGENTV3_MEGA_ROADMAP` (on by default), was blind the same way — it saw only bullet
  lines plus loose verbs, so eight comma-listed modules read as the single word "with", halved away.
  It takes the **MAX** of its old count and the shared one, never the sum: that gate spends a real
  planner call on every user's build, so it may only become more right, never more eager. Measured:
  **zero** ordinary prompts flipped to `analyze`.
- Test-locked and reversion-proven in all three halves in
  `tests/theGateReadsBulletsUsersWriteCommas.test.ts` (17 cases), whose ORDINARY corpus is the
  precision lock — a later widening that drags a todo app in fails CI.

⚠️ **What to watch on the first real builds:** the `PROJECT_MODE` report line, and whether a big
request's module plan appears and advances. A build that takes an extra planner call and then
decomposes is the feature working; a *small* app doing that is the precision lock having been broken.

🔴 **FIRST REAL EVIDENCE, 2026-09-30 (autopsy 6a5fb04b): IT DECOMPOSED A SMALL APP, AND ITS FIRST MODULE
COULD NOT PASS.** A one-screen voice assistant counted fourteen parts (two were style adjectives, three were
one feature per language) and became twelve modules. Module 1 (config) wrote its three files and typechecked,
then failed: the readiness gate's "entry is still the starter" blocker (2026-09-20) knows nothing about a
module that does not own `src/App.tsx`, two `UNFINISHED_BUILD_RESUMED` nudges pushed the model outside its
module's scope, and the user read *"Nothing has been built yet"*. The planner orders modules by dependency, so
the app shell is normally LAST — **so, by construction, a plan whose first module does not own the entry fails
at module 1**. The precision half is fixed (`enumeratedFeatures.ts`: style adjectives dropped, per-language
variants collapsed — that prompt now counts 10).
✅ **The module-turn half is FIXED the same day (admin: *"cause dhundo! fix karo!!"*).** A module turn now
knows which module assembles the app (`shellModuleFor` in `ProjectPlan.ts`). Until that module is built, the
turn is judged on its own files and the typecheck: the starter blocker stands down
(`dispatcher.setStarterExpected`), the platform starts no preview and a published one is not adopted
(`moduleAwaitsShell` — every later proof is gated on `lastPreviewUrl`), the reviewer waits for the assembled
app, and the model is told not to touch the entry. The shell turn is judged as a whole app, exactly as before,
and so is every turn of a plan in which no module owns the entry. The planner is now told that exactly one
module, the shell, owns `src/App.tsx`. A paused plan that built nothing is retired once a direct build proves
a working app (`retireUnbuiltPlan`), so a later "continue" cannot rebuild over it. Report codes
`PROJECT_MODULE_AWAITS_SHELL` / `REVIEW_DEFERRED_TO_SHELL` / `PROJECT_PLAN_RETIRED`. Tests:
`tests/aModuleIsNotTheWholeApp.test.ts`. ⚠️ Still unmeasured: no plan has yet run end to end in production,
and a module turn earns no markup (no preview proof), so each module is billed at real cost.

⚠️ **UNSET ⇒ OFF, and every build is byte-identical to today.** The flag takes `on` (everyone),
`off`/unset (the kill switch), or **anything else as an ALLOWLIST of uids/emails** — built
deliberately so the admin can enable it for their OWN account and run one real mega-prompt before
anyone else sees it. Detection (`detectMegaProject`) is HIGH-PRECISION on purpose: an explicit
"100+ files/pages/screens", or a big-software noun (ERP/CRM/HMS/SaaS platform/marketplace…) with ≥8
enumerated features, or ≥14 enumerated features. A false positive costs an ordinary app an extra
planner call; a false negative just builds exactly as it does today. Minimum 3 modules or it falls
straight back to the normal path.

🔴 **THE STATE IS A PENDING ADMIN DECISION, NOT AN UNFINISHED FEATURE.** `PROGRESS.md` (2026-07-04)
records it as *"fully built and dormant … ADMIN DECISION NEEDED (asked in chat, safeguard #3)"*,
with the exact action: set `AGENTV3_PROJECT_MODE=aashishcpmt09@gmail.com` on Cloud Run, send one
mega-prompt, watch the module plan appear and advance, then `on` for everyone once happy. **That
question has been open for over two months.** It is recorded here rather than acted on because the
key lives in a console no session can reach.

🔴 **CORRECTED 2026-09-30 (autopsy 8e124182) — EVERY MODULE BEFORE THE ONE THAT OWNS `src/App.tsx` WAS
JUDGED "NOTHING BUILT YET".** The end-of-turn readiness gate read the untouched starter entry as an unbuilt
app, so module 1 ("Core Types") failed (before 2026-09-26) or was told to keep going (after), and the model
built the whole app inside module 1 while the plan recorded 1 of 14 done. `starterEntryExpectedFor` now
tells the dispatcher that an entry-less module turn EXPECTS the starter. And the gate that opened it was
counting a prompt template's `# Steps` as features — `enumeratedFeatures.ts` now skips instruction sections
and the prose of a structured spec. (A module turn that over-builds is reconciled — see below.)
🔒 **SAME AUTOPSY: THE SHELL IS NO WAY AROUND THE GREEN FREEZE.** A model refused twice wrote the file with
`cat >`. The bash tool now asks the freeze about every file a command plainly writes (`shellWriteTargets`).
✅ **Closed the same day (admin: "baaki bhi fix karo"):** the vaccine's repair is now the allowlisted pass
`vaccine-repair` — its own snapshot, kept only if the suite then passes with the same command AND the app
still renders (`strictReverify`), undone otherwise, and it may write neither a `.env` nor a test file.
⚠️ **And a module turn that over-builds is now reconciled** (`reconcilePlanWithWrites`): every pending module
whose owned files this turn wrote is marked done, so no turn is queued to rebuild them.

⚠️ **Three honest gaps, from that same entry and still open:** an IMPORTED repo never creates a plan
(creation fires only on a fresh `new_build`); a reopened incomplete plan needs a typed "continue"
(restore does not re-emit resumable); and contract DRIFT — a module deviating from its own frozen
contract — is caught only by the whole-workspace `tsc` each turn, not by a dedicated contract check.

🔴 **THE LEAD RUNG CHANGED 2026-09-17 — `glm-5.3-flash` IS OFF EVERY LADDER** (admin, verbatim: *"glm
5.3 flash ko hata do!"*, with the FlashX price read off docs.z.ai on their own screen). It is replaced,
on Weak and Normal and as the PLAN rung of both, by **`glm-4.7-flashx` — $0.07 in / $0.40 out / $0.01
cached**, against 5.3-flash's $0.15 / $0.50 / $0.03. Strong is untouched (it never carried a flash rung).

**This REVERSES half of the 2026-09-14 decision, and the reversal is evidence-led rather than a change
of mind.** That decision picked 5.3-flash on the rule *"a $0 rung that fails costs more than a $0.15
rung that succeeds"* — the rule is still right; its premise was false. Three autopsies in three days:
- **`ee20478d` (09-15)** — 280 hard 400s in ONE build. Every tier opened on a rung that could not
  succeed, because 5.3-flash cannot be told to stop reasoning.
- **`b3a2c81e` (09-16)** — 68 GLM failures, 52 `OUTPUT_BUDGET_STARVED`: the model's mandatory thinking
  spent the whole authorised output ceiling before writing one character.
- **`dd1f5f60` (09-16)** — 8.65 tokens/second sustained; 29.5 of a 30.1-minute build inside one call.

🔑 **FLASHX IS NOT MERELY CHEAPER — THE FAILURE CLASS CANNOT OCCUR ON IT.** `glmCanDisableThinking`
(`glmThinking.ts`) is a NUMERIC family test: 5.3-and-newer always reason; 4.x can be told not to. FlashX
is 4.7, so the turn sends `thinking: disabled` and the entire output budget goes to code rather than to
reasoning nobody reads. Cheaper AND structurally immune — so this is not a trade between the two aims.

💸 **THE BILLING HALF HAD TO SHIP IN THE SAME COMMIT, and it is the third time this exact trap was set.**
`glm-4.7-flashx` contains "flash" (→ the FREE `glm-flash` line) and matches `/glm-?4/` (→ the $0.60
coder line). Either would have been wrong, and a $0 real cost bills the USER ₹0 while we pay Z.ai —
identical in shape to `kimi-k2.7-code-highspeed` and `glm-5.3-flash`, both caught on 09-16. It now has
its own row (`RATE_GLM47_FLASHX_IN` / `_OUT` / `_CACHE`) matched BEFORE both rules. **A model may not
join a ladder until its price is on the card.**

🔁 **A HEAL NOW DROPS THE LEAD RUNG AGAIN — a dormant rule woke up.** `healLadder`'s pattern matched
only `4.7-flash`, so between 09-14 and 09-17 (while 5.3-flash led) every heal restarted on the very
rung whose output needed repairing. FlashX matches it, so the 2026-08-13 rule (*"a repair must not begin
on the model that produced the failing app"*) applies again: a Weak/Normal heal opens on KIMI. It costs
more per heal ($0.95/$4.00 vs $0.07/$0.40) — intended, because a cheap repair that fails buys a second
one. The predicate is now the named `isCheapFlashRung`, so this can never again turn on a coincidence.

⚠️ **THE HONEST RISK, recorded rather than discovered later: FlashX's CODING quality is unmeasured here.**
Z.ai's "X" suffix is the faster, paid variant of a Flash model (GLM-4.5-X, -AirX are all dearer than
their base), and this file's own 09-14 entry calls the free `glm-4.7-flash` *"weak at coding"* — FlashX
may share that brain. What changed is the comparison, not the estimate: a model that reasons well and
delivers nothing is worse than a plainer one that answers. **Watch heal COUNT on the first real builds,
not cost.** 🔒 Revert with no deploy:
`AGENTV3_LADDER_WEAK=GLM:glm-5.3-flash,KIMI:kimi-k2.7-code,GLM:glm-5.3,HAIKU` (and `_NORMAL` likewise).

🔴 **KIMI RUNGS REVISED 2026-09-16** (admin, verbatim: *"free wale me kimi 2.6 ki jagah kimi code 2.7 kar
de! normal wale me kimi code 2.7 highspeed karo strong me kimi k3 bhi add karo"*): Weak's Kimi rung moved
k2.6 → k2.7-code (Moonshot's dedicated coder, same price, better quality, at no extra cost to the builds
NavBharatAI pays for itself); Normal's moved to k2.7-code-highspeed (same model, ~2x tokens/sec, exactly
2x the price — priced into what the paying user is billed); Strong gained a Kimi rung for the first time,
`kimi-k3`, at exactly Sonnet parity, as the second rung (a third independent vendor before climbing to
Claude). Adding the highspeed rung SURFACED a real under-billing defect: `providerRates.ts`'s Kimi matcher
had no branch for the `-highspeed` suffix and would have silently billed it at half its real price via the
plain k2.7-code fallback — fixed with a dedicated `'kimi-k2.7-highspeed'` rate row and matcher branch in
the same change, test-locked (and reversion-proofed by re-deleting the branch and confirming the new test
fails) in `providerRates.test.ts`.

🔴 **REVISED THE SAME DAY UNDER THE ADMIN'S FULL AUTHORITY GRANT** (verbatim: *"mujhe yeh chahiye: mera
kam se kam kharcha; user ko best se best app, ek hi baar me (build fail kam se kam). aapko puri authority
hai, aap kis ai ka kaha use karna chahte ho — i approved"*). The admin's first list (4.7-flash-led Weak,
Kimi-led Normal/Strong, gpt-5.4 last on Weak) was superseded once the real prices were known:
**glm-5.3-flash $0.15 / $0.50, glm-5.3 $1.40 / $4.40.** The one lever behind both aims is that the FIRST
rung must be strong enough that heals are rare — a $0 rung that fails costs more than a $0.15 rung that
succeeds. So 5.3-flash leads Weak and Normal; 5.3 is the strong rung under Sonnet everywhere and leads
Strong; Kimi stays as the second vendor on every tier (see the 2026-09-16 revision above — k3 joined
Strong that day); **glm-4.7-flash and gpt-5.4 are on no ladder** (weak-at-coding / no key + unknown
price). **Nothing to buy from OpenAI.** Haiku is again Weak's last rung. `healLadder` now drops a leading
rung only when it is the known-weak 4.7-flash.

- **The chain IS the ladder.** A build on a tier runs that tier's rungs, in that order, and nothing else —
  no Vertex/Gemini rung, no borrowed Sonnet when the floor is off, no live-health GLM↔KIMI lead swap. A
  keyless rung is SKIPPED; a tier with no keyed rung is refused before the stream (`ENGINE_UNAVAILABLE`;
  weak keeps `WEAK_ENGINE_UNAVAILABLE`) — never built on another tier's model. Test-locked in
  `tests/tierChainFidelity.test.ts` against the CONSTRUCTED chain's (name, model) sequence.
- **Escalation = higher up the same ladder** (`escalationPathForTier`, `ladderFrom`): a Normal build that
  fails its gate restarts at its Sonnet rung; Strong at Opus. "Opus sirf zarurat par" is literal: Opus is
  reached only when K3 and Sonnet failed, or the finished build failed its gate.
- **Heal = the ladder minus its leading flash rung** (the 2026-08-13 rule, now one function: `healLadder`).
- 🔒 **WEAK NEVER RUNS SONNET/OPUS — three nets:** the ladder never names them; `parseLadderOverride`
  REFUSES an `AGENTV3_LADDER_WEAK` that does; `enforceNoClaude` strips every `CLAUDE*` rung except
  `CLAUDE_HAIKU` from the FINAL chain. ⚠️ **It no longer moves Haiku to the end** — the 2026-07-13 "to
  last me" was for a boolean-assembled chain; the admin's own list puts GPT-5.4 AFTER Haiku, so the guard
  decides WHAT and the ladder decides WHERE.
- **Grok STAYS** (admin, same day: *"Grok ko hatao mat … reviewer app tode na"*) — judge (free+paid), free
  plan phase, Engineer AI primary. Gemini/Vertex stay for vision and the free-chat backstop. They are simply
  not BUILD rungs. An earlier plan in this session to retire them is withdrawn.
- **Strong is a LADDER now, not Sonnet-pinned.** This changes the 2026-07-13 fidelity rule's *meaning*, on
  the admin's explicit choice (asked as a question, answered "Ladder: K3/Sonnet lead, Opus sirf zarurat
  par"): fidelity is to the MODE, not to one model id. Billing is unchanged — `powerToTier('mini')` is not
  the Opus tier, so Strong bills real cost + tiered markup, and an Opus rung that ran is priced at its real
  Opus rate inside that. A stored 'medium'/'max' maps UP to 'mini' (never down to Normal).
- **🟢 NVIDIA NEMOTRON — `NEMOTRON_API_KEY` SET, and `AGENTV3_NEMOTRON` set by the admin 2026-09-20.**
  Recorded hand-to-hand per this registry's own rule. The key alone reaches only the **ladder rung**
  (Weak/Normal, in FRONT of the Claude backstop, keyed rather than flagged); the **judge** and **plan**
  roles need `AGENTV3_NEMOTRON` naming a tier — `weak` / `free` / `normal` / `strong`, comma-separated,
  or `on` for every tier. `off` is the hard kill for all three. Read by `src/server/AgentV3/nemotron.ts`.
  💰 **Why the judge is the prize:** by that module's own measurement the judge is **78% of a cheap-lead
  build's entire real provider cost** ($0.0915 of $0.1176) — the one slice the prompt cache cannot
  rescue, being a single call over the app rather than a 70-call loop over a stable prefix. Ultra does
  it at **$0.50/MTok in** against glm-5.3's $1.40 and Grok's $3.00, with **no tools exposed**, which is
  also why it is the safest place to try an unproven vendor.
  ✅ **THE LIVE VALUE IS `weak`, VERIFIED FROM THE CONSOLE 2026-09-20** — the admin sent a screenshot
  of the Cloud Run variable list (`AGENTV3_NEMOTRON = weak`, `NEMOTRON_BASE_URL` = the NVIDIA host), so
  the judge and the plan ARE on for that tier. ⚠️ **Since 2026-09-29 only the JUDGE is** — Weak joined
  Strong in `PLAN_FORBIDDEN_TIERS` after both Ultra plans on autopsy 6a4a799f came back unusable; the
  flag value was not changed and does not need to be.
  🔴 **CORRECTED 2026-09-30 (autopsy 466c260a) — THE JUDGE DOES NOT RUN ON A WEAK BUILD EITHER, AND NEVER
  HAS.** `judgeBuild` is called in exactly one place in `routes/agentv3.ts`: inside the escalation block,
  which is gated `!freeTierBuildActive && tierEscalationPath.length > 1` — and `escalationPathForTier('weak')`
  returns ONE element by design ("Weak never escalates"). So on the build engine `AGENTV3_NEMOTRON=weak`
  reaches no role at all today; only the keyed Super ladder rung is live. The report shows it: no
  `CHEAP_REVIEW` line of any kind on that weak build. ⚠️ **Wiring it is an admin decision, not a fix:** the
  judge acts only by driving an escalation repair, which Weak never takes, so a Weak judge would add cost
  and a verdict with nothing to act on it. The "judge = 78% of a cheap-lead build's cost" figure below was
  therefore measured on a build that escalates (Normal/Strong), not on Weak.
  🔴 **AND THIS ENTRY SAID OTHERWISE FOR HALF A DAY, WHICH IS THE PART WORTH KEEPING.** It read *"the
  admin reported setting `AGENTV3_NEMOTRON=week`… the judge and the plan stayed OFF"*, ending with the
  exact sentence **"this must be verified in the console, not assumed from this entry"** — and a
  session (mine) then read the paragraph, skipped its own warning, and told the admin as a live fact
  that their config was broken and to go and change it. The admin opened the console and it was already
  right. **A doc's claim about a value in a console no session can read is only as good as the last
  person who looked; repeating it does not make it truer.** Same shape as the idle-minutes default that
  said "NOT taken" eight days after it was taken, and the E2B rate whose derivation "could not fail".
  🔒 **The GUARD is untouched and stays**, because it was never about one typo: `nemotronConfigNote()`
  names an unreadable value and the accepted words **in the build report's `TIER_LADDER` line as a
  WARNING**, and once in the server log. The value is still deliberately **NOT** corrected toward the
  nearest word — guessing would make the config mean whatever it resembles, and the next typo would
  enable a tier nobody chose. Three real instances of the class remain (a trailing space in
  `BRAVE_API_KEY`, an `=` in `ALERT_EMAIL_FROM`, `20%` in `AGENTV3_FEATURE_HEAL_PCT`); a protection
  built for a class is not retired because one suspected instance turned out not to have happened.
  ⚠️ **NEVER the architect, sub-agents, reviewer or heal passes** — those are the cached 40–70-call
  tool loops where Nemotron is **6.2× DEARER** than flashx (its route does not honour prompt-cache
  markers). `nemotron.ts` makes every other role structurally unreachable; do not widen it.
- **Env keys (names only):** `AGENTV3_LADDER_WEAK` / `_NORMAL` / `_STRONG` (override one tier's ladder,
  `PROVIDER:model,…`, applied whole or refused with the reason in the `TIER_LADDER` report line);
  `OPENAI_API_KEY` (the admin **bought a key on 2026-09-15** and asked what to name it; whether it is
  yet set in Cloud Run is unconfirmed here. ⚠️ **On its own it still changes NO build** — no tier
  ladder names OPENAI, so the rung yields nothing. **READ THE `AGENTV3_FILE_EMBEDDINGS` ENTRY BELOW
  BEFORE SETTING IT**: until 2026-09-15 that key alone silently switched on an unmetered,
  never-read embedding spend on every build) and `OPENAI_BASE_URL`, `AGENTV3_OPENAI_TIMEOUT_MS`; `RATE_GLM53_FLASH_IN`
  / `_OUT` / `_CACHE` (**code default now the admin's real price, 2026-09-14: $0.15 / $0.50, cache
  $0.03** — corrected 2026-09-16 from the admin's own copy of docs.z.ai/pricing, now recorded verbatim
  in `providerRates.ts`. It had been $0.0375, a ≈25%-of-input CONVENTION rather than Z.ai's published
  number, and the same convention over-stated the other two GLM cache rates (glm-5.x $0.35 → **$0.26**,
  glm-4.x $0.15 → **$0.11**). All three moved DOWN, and a bill is the real cost × markup, so the
  convention had been over-stating the USER's bill too. An earlier placeholder had priced flash at the
  glm-5 line, ~10× too high, for a few hours, on no user's bill); non-flash **GLM-5.3 is $1.40 / $4.40 =
  the existing glm-5 line**, no new row — ⚠️ that row is the FAMILY CEILING, and Z.ai's real GLM-5 is
  cheaper ($1.00 / $3.20), which the rate card now says in place;
  `RATE_GPT_NANO_IN` / `_OUT` (**$0.20 / $1.25**, GPT-5.4 Nano — priced so it can never be billed at the
  full-GPT bound, but on NO ladder: the admin's own brief says Nano is for classification/extraction,
  never an app-generation engine); `RATE_GPT_IN` / `_OUT` / `_CACHE` for the FULL gpt-5.4 — ⚠️ **still
  unknown, still the Sonnet-line bound** until the admin has its price. `AGENTV3_CHEAP_FLOOR=off`
  is still the GLM/KIMI kill switch. **Now inert for the build chain:** `AGENTV3_BUILD_CLAUDE_FIRST`,
  `AGENTV3_BUILD_ALLOW_GEMINI`, `AGENTV3_VERTEX_PEER`, `AGENTV3_FLOOR_BALANCE`, `AGENTV3_FREE_KIMI_LEAD`,
  `AGENTV3_WEAK_FLAGSHIP_HEAL`, `GLM_MODEL` / `KIMI_MODEL` / `AGENTV3_FREE_*_MODEL` (the ladders name their
  models; those envs still feed the legacy `cheapBuildFloorRunners`, which only tests call now).
- **🔴 `AGENTV3_FILE_EMBEDDINGS` — the flag that stops a PROVIDER KEY being a FEATURE SWITCH (shipped
  2026-09-15). ⚠️ NOT set, and unset means exactly today's behaviour: zero calls, zero cost.**
  `EmbeddingSearch` (AgentV3's per-file vector index) used to have NO flag at all — its only gate was
  the PRESENCE of `OPENAI_API_KEY`. Found on the day the admin bought an OpenAI key and asked only
  what to name it, so nothing had been spent.
  **What the key alone would have started, none of it visible:** `ToolDispatcher` calls `addFile()` on
  EVERY write, EVERY batched file and EVERY edit (three call sites), so an ordinary build fires dozens
  of `text-embedding-ada-002` calls — on every tier, **free included**, on NavBharatAI's own account.
  They are made with the OpenAI SDK directly, so they never pass `captureTurnUsage`: **in no build
  ledger, in no rate card (`providerRates.ts` prices no embedding model), invisible to
  `AGENTV3_BUILD_COST_CEILING_USD`, and never billed to the user.** That is the money audit's own
  class — a paid call with no governance — reached through a credential rather than a ladder.
  🔴 **AND IT BOUGHT NOTHING: `search()` — the only reader of the index — is called from no live code
  path.** Embed, persist to Firestore, never read. Recorded as an **OPEN root cause** rather than
  quietly wired up, because "make semantic retrieval real" is a separate decision with its own cost
  (`ContextReranker.ts` has described the path as dormant all along).
  🔒 **BOTH are required now, flag FIRST:** `getClient()` returns null unless the flag is on AND a key
  exists, checked at call time so switching it off in Cloud Run bites without a deploy. An unreadable
  value means OFF, never ON. Test-locked in `tests/fileEmbeddingsAreOptIn.test.ts`, whose last case is
  a **reversion guard** asserting the ORDER out of the source (comments stripped) — proven to fail when
  the flag line is deleted, because the behavioural tests alone would not.
  ⚠️ **If it is ever turned on, price it first.** `text-embedding-3-small` is ~5× cheaper than ada-002
  and scores better; the swap is free TODAY only because nothing is stored yet — once vectors exist,
  changing the model silently mixes incompatible embeddings at the same 1536 dimensions, which
  `cosineSimilarity`'s length check cannot catch.
- ⚠️ **Not yet done, said plainly:** the OpenAI rung is untested against a real response; the
  chat router (`AIRouterManager`) has no OpenAI provider — that is slice 3, only if GPT should serve chat.
- 🔴 **`OPENAI_API_KEY` IS SET IN CLOUD RUN (admin, 2026-09-15) — AND IT WOKE A PATH OUTSIDE THIS POLICY.**
  The three ladders are unchanged (no tier names OPENAI, so no build routes to GPT). But
  `src/server/routes/build.ts:130` — the LEGACY `/api/build` chain, live at `server.ts:739` — carries
  `{ name: 'openai', run: () => callOpenAI(...) }` as **rung 6** (claude → grok → aiRouter → gemini →
  groq → **openai** → deepseek → openrouter). `callOpenAI` runs **`gpt-4o-mini`**, and
  `resolveApiKey('openai')` falls through to the generic `process.env['OPENAI_API_KEY']` branch
  (`aiClients.ts:67`). **That rung threw "OpenAI API Key not available" and fell through until the key
  was set; it is now a real billable call on NavBharatAI's account**, from a provider this policy never
  approved, costed by `estimateTokens` rather than the real-cost ledger. Rare (five rungs must fail
  first) and it does add genuine resilience — which is exactly why it is recorded as an ADMIN DECISION
  here rather than silently gated or silently left. ⚠️ Anyone auditing "what does this key switch on?"
  must check BOTH the ladders AND this legacy chain; reasoning that stops at `tierLadder.ts` misses it.
  ✅ **CLOSED 2026-09-25 — THE LEGACY CHAIN IS GONE.** The admin asked for unused code to be removed
  (*"jo jo kaam ka nahi hai, woh hata do"*): `POST /api/build` and `/api/build-stream` answer `410`, and
  the engine behind them (`src/server/EngineerAI/`, the `project/` pipeline, `pro/` orchestrator, and
  `callOpenAI`/`callGrok`/`callDeepSeek`/`callOpenRouter`) is deleted. No client had called either
  endpoint since July. So rung 6 no longer exists; `OPENAI_API_KEY` now powers only the free-chat
  `gpt-5-nano` rung (`OpenAiChatProvider.ts`). The paragraph above is kept as history.
- ⚠️ **FOUR COMMENTS SAID GPT WAS ON THE WEAK LADDER, AND THE ADMIN CAUGHT IT BY READING THE CODE
  (2026-09-15).** They were true of the admin's FIRST list on 2026-09-14 and stale within the same day.
  The table was updated; `providerRates.ts`, `routes/agentv3.test.ts` (×2) and `routes/agentv3.ts` were
  not. **`tsc` and `vitest` cannot read a comment**, so nothing failed. **THE RULE: do not restate
  another module's fact — point at the module that owns it.** `TIER_LADDERS` is the only place a rung
  exists. Pinned by `tests/ladderClaimsMatchTheTable.test.ts`, which DERIVES the invariant from the table
  (so adding GPT for real silences it automatically) and is proven by reversion. `routes/agentv3.ts` is
  listed in its `OWNED_BY_ANOTHER_PR` set because PR #2957 was live in that region — remove that entry
  once #2957 lands.

**THE AGENT × TIER TABLE (admin-approved 2026-09-14, aims verbatim: "user ki app best of best bane — 1 try
me" · "mera kharcha kam se kam ho").** Test-locked in `tests/agentRolesPerTier.test.ts`.

| Role | Weak | Normal | Strong | Note |
|---|---|---|---|---|
| Credits / abuse / free-clamp | code | code | code | ₹0 — never a model |
| Safety triage | code | code | code | `triagePrompt` is deterministic, precision-first |
| Intent doubt-reader | free chat router | free chat router | free chat router | glm-4.7-flash led, $0; one-word answer |
| **Plan** | glm-4.7-flashx → **Haiku** → rest of own ladder (2026-09-30) | glm-4.7-flashx → own ladder | glm-5.3 → own ladder | `PLAN_RUNG` / `planLadder`; input-heavy call on the cheapest rung that reasons well; **Grok no longer plans** |
| Builder + sub-agents + fast lane | tier ladder | tier ladder | tier ladder | above |
| Heals | ladder minus leading flash | same | same | `healLadder` |
| Lint / typecheck / build / preview / journey / fuzz / CVE | code | code | code | ₹0 |
| **Judge / Reviewer** | **none — Weak never escalates, and the judge runs only inside escalation (verified 2026-09-30)** | **glm-5.3** | **Grok** | a DIFFERENT model from the builder at the lowest input price that reasons well (glm-5.3 $1.40 in vs Grok $3); Strong builds on glm-5.3 so its judge is Grok, outside every ladder; `AGENTV3_REVIEWER=sonnet` forces Sonnet; no keys ⇒ Sonnet; **Opus is never the judge**. ⚠️ The user-facing review narration used to print the judge's vendor name ("🔎 Grok is reviewing…") — a White-Label breach, fixed |
| Vision (describe) | Gemini → Grok | Gemini → Grok | Claude(Haiku describe tier) → Gemini → Grok | `useClaude` follows `powerMode` |
| Escalation | never | own ladder from Sonnet | own ladder from Opus | `escalationPathForTier` |

Deliberate deviations from the admin's draft, each for the two aims: no model on guard/router/lint (code
already does it, ₹0); no Opus on plan or judge (input-heavy calls, and "Opus sirf zarurat par"); no
"context summarizer" (none exists — context is deterministic); "fallback builder" is the ladder's next
rung, not an agent; the explainer lives in chat, not the build. Two names in the draft are unverified
here — a non-flash **GLM-5.3** and **GPT-5 Nano** — and were not wired.

### Billing model — REAL-COST + tiered markup for every non-Opus tier (admin-CONFIRMED 2026-07-14, Fix 65) — ⚠️ CONFIRM WITH ADMIN BEFORE CHANGING

The admin verified the LIVE provider deductions on the GLM (Z.ai) + Kimi (Moonshot) dashboards and
redefined how NavBharatAI bills v3.0 builds. **This supersedes the old "Sonnet-equivalent × 1.2 / × 3"
billing for Weak/Normal/Strong** (which billed a cheap-led build ~21× its real cost — and once billed a
FAILED build ₹811). The Opus tiers are untouched.

- **Non-Opus tiers (Weak, Normal, Strong):** `bill = tieredMarkup( REAL provider cost )`.
  - REAL provider cost = the EXACT per-provider/model token spend × each provider's own real rate card
    (`src/server/AgentV3/providerRates.ts`), summed. The exact model that ran is captured via
    `TurnResult.model` (Claude/GLM/Kimi/Gemini runners all report it) → a `glm-4.7-flash` turn is FREE,
    a `glm-5.2` turn is the flagship rate. The unattributed aux remainder (plan/judge) is priced
    conservatively at Sonnet rates (margin-safe upper bound).
  - `tieredMarkup(C)`:  `C ≤ $1 → C × 4` ;  `C > $1 → $4 + (C − $1) × 3`  (first $1 at 4×, the excess at
    3× — big builds don't run away). Then × the live USD→INR rate (`UsdInrRate`).
- **Opus tiers (Powerful = medium, Full Team = max):** UNCHANGED — real Opus × 2 (`billedForTier 'opus'`).
- **Failed-build guard:** a build that was expected to produce an app but did NOT succeed (`!result.ok`)
  is NEVER charged — same "working app or free" law as the empty-build + unrendered-preview rules.
- **Kill switch:** `AGENTV3_REALCOST_BILLING=off` instantly reverts the non-Opus path to the legacy
  flat/per-tier billing WITHOUT a deploy (default = ON, this IS the billing model now). Rate cards are
  env-tunable (`RATE_GLM_IN`/`RATE_KIMI_OUT`/… ) and the markup curve too (`AGENTV3_MARKUP_SMALL` = 4,
  `AGENTV3_MARKUP_LARGE` = 3, `AGENTV3_MARKUP_THRESHOLD_USD` = 1) — track live prices without a deploy.
- HONESTY: cache-hit input tokens are not yet tracked separately, so cached input is priced at the full
  cache-miss rate → real cost is a slight OVER-estimate (margin-safe). A later slice can capture
  `cache_read` usage to bill even lower.

### THE ONE-WALLET LAW — every AI spends the SAME balance (admin-mandated 2026-08-01, shipped 2026-08-04)

**Admin verbatim: "user unhin 50,000 token se kharch kare, har jagah."** The gifted balance used to be
spent by v5 BUILDS only; the Professionals, Doctor AI and the AI-backed Other-AI tools were bounded by a
daily MESSAGE/ACTION COUNT instead. That is neither the same limit nor the same promise — ten cheap
questions and ten expensive ones cost the user the same while costing NavBharatAI completely different
amounts, and a user holding ₹600 of gifted credit could exhaust ten free messages and be told to buy a
Pass **while their balance sat untouched**.

**The rule now: anything that costs NavBharatAI money draws the ONE wallet down; anything that costs
nothing draws nothing. There are no per-feature quotas left to tune — the price of the thing IS the
limit.** (The deterministic tools — Minifier, Diff, Versioning, Test Runner, APK, CI/CD, SEO, … — cost
nothing to run and stay free and unmetered; metering them would be friction with no saving behind it.)

- **Master switch `AI_WALLET_SPEND`** (default OFF — set `on` in Cloud Run to make it real). While off,
  behaviour is byte-identical to before, with not even an extra Firestore read.
- **Cost comes from REAL reported tokens**, priced by the SAME rate card + tiered markup a build uses
  (`chatSpend.ts` → `providerRates.ts`) — one money model, nothing to keep in sync by hand.
- **🔒 NEVER INVENT A COST.** A provider that reports no usage ⇒ `measured: false` ⇒ **charge ZERO**.
  Estimating tokens from string length would produce a number that LOOKS like a measurement and would
  land on a real user's bill. We eat it. Keep `free-model` (measured, genuinely ₹0) and `unmeasured`
  (we do not know) as SEPARATE outcomes — only the second is costing us money silently.
- **Never charged:** an anonymous caller (no wallet), the admin free-list, and a **Professional Pass
  holder** (the Pass IS the payment — charging the wallet on top bills them twice for one thing).
- **Charge AFTER the answer, never awaited into the response.** A money-path failure must not cost the
  user their reply; charging first would risk billing a turn that then failed. A FAILED action is never
  charged (same "working result or free" law as builds).
- **Empty wallet ⇒ refused BEFORE any provider is called** (`walletTooEmptyForTurn`). A build may
  overdraw because the next pre-flight gate catches it; nothing catches a chat turn afterwards. A
  balance that cannot be READ is allowed through (fail-open, like the build gate).
- **Ledger rollup:** small charges group into ONE row per user per DAY (`computeRolledUpDebit`, label
  `NavBharatAI assistants` — never a vendor name). A row per turn would fill the 500-entry ledger in a
  fortnight and push the user's PURCHASE history off the end. The BALANCE still moves per charge; only
  the row accumulates. The bucket is dated on the SERVER clock (a device clock cannot move it).
- **Exact money:** the debit carries the sub-token remainder (`TOKEN_CARRY_FIELD`) instead of rounding
  up — see the exactness note below.
- **How a tool inherits billing:** `aiSpendZone.ts` (AsyncLocalStorage, same mechanism as
  `noClaudeZone`). The route opens a zone (`inAiSpendZone`), the shared routing layer records each model
  call, the route charges once beside its existing `burnToolAction`. A BATCHED tool is billed for ALL
  its calls, calls are SUMMED before the decision (so ten sub-token calls are one honest charge, and the
  markup applies to the request's real total), and a NEW tool is billed correctly for free. **Do not
  re-thread costs through call sites by hand — that is the fragility this replaced.**
- **Image generation stays on its quota cap**: its cost is per-image, not per-token, so there is nothing
  honest to price it with. An invented number would be worse than the cap.
  ⚠️ **AMENDED 2026-09-30:** images now carry the ADMIN's fixed price (5 free a day, then ₹1 each —
  `imageAllowance.ts`). That is a price, not an estimated cost, so the rule above still holds.

### Debit exactness — the remainder is CARRIED, never rounded up (shipped 2026-08-04)

`inrToDebitTokens` used to **ceil**. Two costs: the user was charged up to ₹0.01 more than the work
really cost on EVERY build, and — worse — the ceil went into `tokenBalance` while `remaining_balance`
moved by the paisa-rounded ₹, so the wallet's TWO views of one balance drifted further apart on every
single build. Now the charge is exact, the ₹ is DERIVED from the tokens actually debited (so the two can
never disagree), and the sub-token remainder is carried to the user's next charge — no margin is given
away, it is only deferred by at most ₹0.01. This is also what makes per-message charging honest: ceiling
a ₹0.002 chat turn would bill **5×** the real cost. `computeDebitedWallet` returns `applied` — a charge
under one whole token debits 0 tokens but still moves the carry, so `tokensDebited > 0` is NOT a safe
test for "did anything change".

## User-facing Billing + Provider Anonymization — the White-Label Law (admin-mandated 2026-07-15) — ⚠️ CONFIRM WITH ADMIN BEFORE CHANGING

**Two promises to every end user, always kept together:** (1) the bill and cost breakdown they see are
**100% REAL**, and (2) the AI that did the work is **always "NavBharatAI"** — the user must NEVER learn which
third-party model ran in the background. These are not in tension: anonymizing the *vendor* is white-labeling,
NOT dishonesty. We never fake the **result** or the **amount charged**; we only brand the **engine** as ours.
(This is exactly how Lovable/Bolt/v0/Cursor present themselves — the user buys "the product's AI", not a
reseller of someone else's API.)

### 1) The user sees a REAL bill + REAL cost breakdown (honest — rules 2 & 3 apply)
- Every user-facing bill / receipt / wallet entry reflects the user's **actual usage** and the **actual ₹
  charged** (per the REAL-COST + tiered-markup billing model above). **No fabricated, rounded-up, or
  placeholder numbers.** A build that did not succeed is **never** charged (the "working app or free" law).
- The user CAN see an **itemized breakdown** — but itemized by **USER-FACING categories only**: e.g. tokens
  used, the build / tier chosen, ₹ amount, date, and (optionally) which of THEIR builds/features consumed
  what. The breakdown must add up to the real total, so it survives scrutiny.
- The breakdown is **NEVER** itemized by underlying vendor/model. The user must never see a line like
  "GLM $0.02 + Claude $0.11 + Gemini $0.01" — that both leaks the providers AND confuses the buyer. Collapse
  all provider cost into NavBharatAI's own categories (e.g. "AI build — <tier> — ₹X").

### 2) Provider anonymization — ABSOLUTE, on EVERY user-facing surface
On anything a normal end user can see, the AI is **always "NavBharatAI"** (or "NavBharatAI's engine" / "our
AI"). The user must **NEVER** encounter any of:
- Vendor / brand names: **GLM / Z.ai, Kimi / Moonshot, Claude / Anthropic, Gemini / Vertex / Google, Grok /
  xAI, Bedrock / AWS, DeepSeek, OpenAI**, etc.
- **Model ids**: `glm-4.7`, `glm-5.2`, `kimi-k2*`, `claude-sonnet-*`, `claude-opus-*`, `gemini-*`, `grok-*`, …
- **Routing/fallback leakage**: "Provider GLM failed — falling back", "switching to Kimi", "429 from Z.ai",
  "Sonnet is repairing it", "the cheap floor", or any hint that more than one vendor exists. A user-facing
  error degrades to a NavBharatAI-branded line — e.g. *"NavBharatAI's engine hit a brief hiccup and retried"* —
  never the raw provider error. Provider fallback/retry/escalation is **invisible** to the user: they only ever
  see NavBharatAI working.
- Surfaces this covers (non-exhaustive): chat replies, **build progress / narration / status lines**, the
  Billing panel + receipts + wallet ledger, error toasts/messages, empty/"not available" states, exported or
  **shared** build reports, emails/notifications, and any AI that answers "who built this?" / "which AI are
  you?" → the honest, on-brand answer is **"NavBharatAI"**, never the underlying model. (Note: the model-identity
  rule for THIS Claude Code session is separate and internal — it never reaches an end user either.)

### 3) Where provider names ARE allowed — ADMIN-ONLY, never exposed to users
Provider/model identity is essential for ops and MUST stay available to the admin: the **admin dashboard**,
**build-diagnostics JSON**, **server logs**, the **`deliveredVia` / per-provider token telemetry**, cost
autopsies, and `PROGRESS.md`. These are internal/forensic. The hard rule: **no admin-only diagnostic
(especially the build-diagnostics report, which literally names "Provider GLM failed" / "kimi" / "claude-…")
may ever be surfaced to an end user** — not linked, not embedded in a shared report, not shown in a user's
build feed. If a build report is ever made user-shareable, it must pass through an anonymization pass first.

### 4) Enforcement (how we keep it true, not just aspirational)
- **Single choke point:** route every user-facing provider reference through ONE anonymizer
  (e.g. a `publicEngineName()` / `redactProviders(text)` helper) so a NavBharatAI label is applied by
  construction — never sprinkled ad-hoc per call site (same discipline as `enforceNoClaude` / the no-Claude zone).
- **Test the invariant:** a regression test asserts that user-facing streams (narration, `done` summaries,
  billing payloads, error bodies) contain **none** of the forbidden vendor/model tokens, for representative
  builds — so a new leak fails CI instead of reaching a user.
- **Audit before trusting "it's already hidden":** today provider names live in admin diagnostics
  (`buildDiag.record(... "Provider X failed ...")`) and `deliveredVia` telemetry — NOT in user narration — so
  the current default is compliant, but any NEW user-facing surface (a richer billing breakdown, a shared
  report, a "why did this cost so much?" explainer) MUST be built anonymized from the first commit.

**Bottom line:** to the user it is always **NavBharatAI** doing the work, and the bill they pay is always the
**real** one — honestly itemized in our own terms, never a vendor-by-vendor ledger. Real cost, real bill, one
brand.
### Fix 67 — real-cost billing on the watchdog/advisory path + USER-facing provider anonymity (admin 2026-07-15)

Two admin-mandated additions to the billing surface (both verified live: a real PaisaTrack build showed
₹250.67 via the old path while the true cost was ₹39 and the correct Fix 65 bill was ₹157):

- **Watchdog/advisory finalization now bills via Fix 65 too.** A build that overran its wall-clock or
  (post-success) advisory cap used to finalize through `finalizeOnDeadline`, which billed the OLD flat
  `billedAmountUsd` and SKIPPED `setProviderTokens`/`setBilling` — so long builds showed the wrong ₹ and
  their report was billing-null. The shared `decideBuildBilledUsd()` now drives BOTH the normal settle
  AND the finalizer (no drift); the finalizer also records per-provider tokens + billing into the report
  and debits the wallet with the SAME idempotent buildRef (`${workspaceId}_${buildStartedAt}`) the settle
  uses, so a race can never double-charge.
- **🔒 USER-FACING PROVIDER ANONYMITY (standing rule, never weaken without admin sign-off):** the user must
  NEVER see which backend AI did the work — to them, **NavBharatAI did everything**. The user-facing cost
  breakdown is now `userCostBreakdown()` (exported, test-locked in `tests/userCostBreakdown.test.ts`): it
  carries ONLY tokens + the real bill + the user's selected tier, branded `NavBharatAI Pro v3.0` — never a
  provider/model name (GLM/Kimi/Claude/Sonnet/Opus/Gemini/Grok/…), never our internal real cost or markup
  (those stay ADMIN-only in the diagnostics report). This also fixed a real crash: Fix 65's per-tier
  breakdown objects had mismatched shapes that made the client do `undefined.toFixed()`. ✅ **Fix 68 —
  DONE (verified against live code 2026-08-04; this line previously read "not yet done" and was STALE).**
  The build report is now gated: `GET /api/agentv3/diagnostics` resolves `showProviderDetail =
  isReportAdmin(<VERIFIED email>)` and **fails CLOSED** (no email / lookup failure ⇒ anonymized), then a
  non-admin gets `userFacingReport()` (`BuildDiagnostics.ts`) for the latest/session/by-id report and
  `redactProviderError()` (`lib/providerRedaction.ts`) over the history list's `summary`/`rootCause`.
  Test-locked in `providerRedaction.test.ts`, `BuildDiagnostics.test.ts` and `agentv3.test.ts`. Separately,
  the user no longer downloads a report at all (admin 2026-07-29): "Report" submits it server-side to the
  admin inbox and the user receives only `{ ok }`. The standing rule is unchanged and permanent: **do NOT
  surface provider names on any user-facing screen.**
