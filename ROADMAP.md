# NavBharatAI — The Roadmap

**One file. Everything that is genuinely left.** Consolidated 2026-08-07 from the five documents that
had been drifting apart — the old `ROADMAP.md`, `ROADMAP_REMAINING.md`, `ROADMAP_NO1.md`,
`FEATURE_ROADMAP.md` and `CAPABILITY_AUDIT.md`. Those files are **deleted**; everything real in them is
below, and everything that turned out to be already built was removed rather than carried forward.

> ## Why five files became one
>
> They disagreed with each other and with the code. A single sweep on 2026-08-07 found **nine items
> marked OPEN that were already shipped AND wired** — including "E2E auto-run by default", which the
> admin had personally asked for and which had already been delivered. `ROADMAP_NO1.md`'s entire Phase 2
> (the Data GUI, items 2.1–2.5) was complete while the file still listed all five as to-do.
> `CAPABILITY_AUDIT.md` had five ❌ rows for features that exist.
>
> A session picking work off any of them would have rebuilt working features — the exact waste
> safeguard #6 exists to prevent, and the exact way PR #1 and PR #4 were lost.
>
> **So: one file, and it is a HINT, never a fact.** Re-grep the live code before starting anything here.
> This document is stale the moment another session merges.

**Kept separate on purpose (these are NOT roadmaps — do not delete):**
`NAVBHARATAI_PRO_V3_DESIGN.md` (the AgentV3 architecture + the admin's billing decisions D2/D5/D6, which
`CLAUDE.md` points at directly) · `VAJRA_V4_DESIGN.md` (v4 blueprint) · `RUNBOOK.md` · `security_spec.md` ·
`MOBILE_PUBLISHING.md` · `PROGRESS.md` (the append-only record of what shipped — this file is the *plan*).

**Legend:** 🟢 code-tractable now · 🔵 larger, multi-PR but still code · 🔒 blocked on infra/keys/a decision
(do NOT attempt in a session) · ⚙️ built but switched off · 👤 needs the admin, not Claude.

---

## 0 · ⚙️ ALREADY BUILT, JUST SWITCHED OFF — the cheapest wins on this page

Nothing to build. These are finished, tested, merged features sitting behind a default-OFF flag. The
admin has already turned on four (`LINT_GATE`, `INTEGRITY_GATE`, `REQUIREMENT_AWARE`,
`REVIEW_AUTOFIX_WARNINGS`). These are the rest — **each one now audited against live code, not guessed
at from the shape of its `env` check** (see the correction box below for why that distinction matters).

| Flag | What turning it on gives you | Audit verdict (2026-08-07) |
|---|---|---|
| **`AGENTV3_PARALLEL_BUILD`** | Frontend and backend built at the same time (#1790). | ✅ **SAFE — audited by construction.** ONE `parallelBuild` value drives the write-lock, the dispatch decision AND the architect prompt (`agentv3.ts` ~5595), so "parallel on but lock off" cannot exist. Sub-agents get the SAME locked actuator (`makeSubAgentSpawn({ actuator })`); the other eight `buildActuator()` calls belong to unrelated routes, none inside the build stream. Same-path writes serialize, disjoint paths run concurrently. *The SPEEDUP itself is unmeasured — that needs a real large build.* |
| **`AGENTV3_DEPHEALTH_GATE`** | CVE + strong-copyleft advisory on a finished build. | ✅ **SAFE.** Advisory-only: appends to the summary of an already-`ok` build inside a `try/catch` (`AgentRunner.ts` ~662). Cannot block or fail a build. |
| `AGENTV3_OBSERVABILITY_INJECT` | Adds a `/health` route to an Express app that lacks one. | ✅ **SAFE.** Purely additive, build-end, never blocks. It does modify the user's app, which is the only thing to be aware of. |
| `AGENTV3_PRETTIER_GATE` | "N files need formatting" note on the summary. | ✅ Safe — same advisory shape. Lowest value on this page. |
| `AGENTV3_STREAMING_PREVIEW` | The preview appears tens of seconds sooner. | ⚠️ **REAL TRADE-OFF, not a pure win.** `SimpleBuilder.ts` ~845 hands files to the preview **before** the verify+repair loop, so a user can briefly see an app that is then repaired. How often that happens is unmeasured. Weigh it against "the user judges by what they SEE". |
| `AGENTV3_REDTEAM` | Really attacks the built app's inputs, then hardens them. | ⚠️ **SAFE but COSTS MONEY.** Correctly routed — inherits `healRunnerRoutingOpts` + `noClaude`, so a weak build stays on GLM/Kimi (never Sonnet/Opus). Well bounded: successful artifact builds only, 12-case hard cap, needs ≥120 s of budget left, abortable. But it is an extra LLM pass on **every successful build** — a money decision, not a technical one. |
| **`AI_WALLET_SPEND`** | The whole one-wallet law — every assistant and tool draws the SAME balance a build does. The admin's own 2026-08-01 mandate. | ✅ **NOW SAFE — because the audit found and fixed a real bug.** The tiered markup was applied PER CALL and then summed, so a multi-call request was systematically OVERCHARGED (three $0.50 calls billed $6.00 instead of $5.50; worst on the App Debugger, which fans out over file batches). Fixed + test-locked in #2175. Everything else verified clean: no double-charge path, failed actions never charged, unmeasured turns charge zero, empty wallet refused before any provider call, balance-unreadable fails open, server-clock rollup. **Turn on only once #2175 is live.** |
| **`AGENTV3_WEAK_CHECKPOINT`** | Mid-build course-correction on the weak tier. | ✅ **SAFE and FREE — the best remaining flag.** Runs the DETERMINISTIC readiness scan (no LLM call, so no cost) every 20 steps and steers only on the two blockers that are real regardless of how incomplete the app is: a server-only Node builtin in browser code, and a high-severity security finding. Mid-build false alarms ("unresolved import", "score below floor") are explicitly excluded — steering on those would burn the weak model's scarce steps. Bounded: not before step 15, max 2 nudges. A contract test runs the REAL `Readiness` producer so a wording change cannot silently disable the filter. It helps the tier that struggles most, at zero cost. |
| **`AGENTV3_VACCINE`** | After a successful build, the platform RUNS the app's own test suite itself and reports honest pass/fail. | ✅ **SAFE, and the cost is a shell command — NOT an LLM call.** `run_tests` is a tool the agent may simply skip; this makes it a system reflex, so *a green build whose own tests fail can never be reported as verified*. That is an honesty hole closed, not a feature added. No suite ⇒ honest no-op, never a fake pass. A failing suite is a WARNING finding, never a hard fail. Budget-gated (needs ≥90 s left) and abortable. **Repair only runs if `FEATURE_HEAL` is also on** (`vaxHealMax = featureHealEnabled ? 1 : 0`) — so on its own it costs no model tokens at all. |
| `AGENTV3_FEATURE_HEAL` | When the app rendered but a requested control is missing, one bounded pass adds it. | ⚠️ **SAFE but COSTS MONEY** — an extra LLM repair pass. Note it also unlocks the vaccine's repair budget, so turning it on changes two things, not one. Slice 1 already RECORDS the missing-feature finding without it. |
| `AGENTV3_REVIEW_FASTLANE` | Runs the reviewer on fast-lane builds that currently skip it. | ⚠️ **SAFE but COSTS MONEY** — same shape as `REDTEAM`: better quality, one extra LLM pass per fast-lane build. |
| `AGENTV3_CACHE_PREFIX` | Prompt-cache stable prefix. | 🚫 **Leave off.** Routing moat, and the benefit is unmeasurable without provider cache-hit telemetry. |
| `AGENTV3_ASK_USER` | The clarify card. | 👤 The admin declined this deliberately — friction vs zero-UI. Not a task. |

### ⚠️ How this table used to get things WRONG (corrected 2026-08-07)

The flag inventory was built by pattern-matching `env.X === 'on'`, and that method mislabelled things in
**both** directions. Recorded here so the next sweep does not repeat it — *read what a flag does; never
classify one by the shape of its condition.*

- **`AGENTV3_INLINE_BABEL` is not a dormant feature — it is a REVERSE kill switch, and OFF is the
  correct state.** Turning it on restores the old behaviour of inlining a 2.85 MB compiler into every
  preview load, which was deliberately removed. It exists only as an instant revert if the same-origin
  asset AND both CDNs fail. It should never appear on a "turn these on" list.
- **`AGENTV3_VACCINE_PCT` and `AGENTV3_FEATURE_HEAL_PCT` are not features — they are rollout dials.**
  `inFlagRollout(master, pct, key)` returns false whenever the MASTER is off, whatever the percentage
  says. "They sit at 0 = off" described the wrong thing entirely.
- **The masters themselves were MISSED.** `AGENTV3_FEATURE_HEAL` and `AGENTV3_VACCINE` are the actual
  opt-in features, and the scan never listed them because only their `_PCT` dials matched the pattern.
  Both are now audited in the table above — and `VACCINE` turned out to be one of the best flags on the
  page, so the scan's blind spot had been hiding a free win, not just a name.

**Claude's job here:** never recommend a flag ON without auditing it the way `AI_WALLET_SPEND` was on
2026-08-07 — that audit found a real overcharge precisely *because* the flag had never been on.
**A flag that has never been on has never been tested by reality.** Every flag in the table above has
now been audited against live code; there is no ⬜ left in this section.

---

## 1 · 🟢 WHAT ACTUALLY MATTERS MOST

> **⚠️ This section was called "THE SIX" and the six do not exist (verified 2026-08-08).** Two are DONE
> (production-DB migration shipped in #2177; zero-setup auth was already built). One is INFRA-BLOCKED and
> was mislabelled "large" (React Native). One is half-shipped (Render done, Railway's API unverifiable
> from here). One turned out to be half-built already (regional languages — the prompt side ships). Only
> the template gallery checked out as straightforwardly open, and even its headline feature — real
> screenshots — needs a capture pipeline that does not exist.
>
> Left as-is, this list would have sent a session to rebuild working features and to ship a framework
> button the sandbox cannot run. Verify every line against code before starting.

Ordered by what a user would actually feel.

1. **React Native / Expo — real native mobile apps.** 🔒 **RECLASSIFIED INFRA-BLOCKED (2026-08-08) —
   it was sitting here as "just large", and that mislabel is dangerous.** Verified: `react-native`/`expo`
   appear in NO framework registry (`frameworkOptions.ts` lists vite-react, nextjs, spring-boot …); the
   three files that mention react-native contain detection patterns, not capability; and the fullstack
   E2B image ships Node/Go/Mongo/JDK with **no Expo tooling and no Android SDK**.
   So registering the framework would create a build option the sandbox **cannot run** — the exact
   rule-2 failure already recorded for item 7 ("a 'Rust' build that 403s = a fake feature"). Left in §1,
   a session could spend a week on it and ship a button that 403s.
   **Real blocker:** rebuild + republish the E2B template with Expo (multi-GB) — admin infra, not a code
   session. Today's Capacitor wrapper ships a webview, which is a different product, honestly labelled.
2. ~~**Sandbox → production database migration.**~~ — ✅ **DONE (#2177, 2026-08-07).** After a successful
   publish the app's OWN migrations now run against the connected database (Prisma / Drizzle / Knex /
   TypeORM / Sequelize / Flyway / Alembic), gated by an allowlist of forward-only apply verbs that fails
   CLOSED — `prisma migrate deploy` is allowed, `migrate reset` can never be. Honest at every branch:
   non-Postgres says so, no migration tool is silent, a failure leaves the app published with a plain
   line saying it cannot save data yet.
3. ~~**Zero-setup auth.**~~ — ✅ **ALREADY BUILT (verified 2026-08-08 by reading the generated code, not
   the description).** `generate_auth` with `type: 'supabase'` IS this item — its own header says
   "ROADMAP #1 Phase 1.3: the ZERO-SETUP path … login works on the first build with no keys to paste".
   The whole chain connects: Supabase OAuth → one-tap creates a project in the USER's account and saves
   `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` → the vault→app pipe injects them into `.env` →
   the generated module reads those exact names via `import.meta.env`. It also fails LOUDLY when the
   keys are absent rather than shipping a login screen that silently never works.
4. **AWS / Azure / Railway deploy providers.** Render shipped (and its UI was wired 2026-08-07). Three
   more provider modules, same shape as `renderDeploy.ts`.
5. **Visual template gallery.** ✅ **VERIFIED GENUINELY OPEN (2026-08-08)** — the first §1 item this
   week that checked out as actually missing. `TemplatesPanel.tsx` has 14 starters, each carrying only
   `id`, `name`, a Lucide `icon` and a `prompt`; there is no screenshot, thumbnail or category field
   anywhere, and no `/api/templates` endpoint. (`savedTemplates` does exist, so the save-as-template
   half is partly there — check it before rebuilding that piece.) Screenshots + categories + "build
   this" kills cold-start and drops weak-tier cost toward zero.
6. **Regional languages** — ⚠️ **RE-SCOPED AGAIN 2026-08-11 by the admin, and the 2026-08-08 line above
   it was WRONG. It contradicted CLAUDE.md's own Language standard and cost a session's work.**

   THE RULE, from the admin, in two halves and no third:
   - **NavBharatAI's own text = professional ENGLISH.** Every button, label, settings screen, error
     toast — AND every status line the SERVER emits during a build ("🗄️ Provisioning a local
     PostgreSQL…"). Those are the PLATFORM speaking, not the AI, so they stay English.
   - **Every AI RESPONSE = the user's language.** Chat replies, build narration written BY the model,
     Doctor AI, every Professional. This is CLAUDE.md's stated single exception, and it is the only one.

   **What the old line got wrong:** it called the server's ~118 status strings "the jarring half" and
   told the next session to translate them FIRST. Translating them is precisely what CLAUDE.md forbids
   — they are platform UI. A session followed it (2026-08-09/10), shipped a Hindi catalogue for 23 of
   them, and the work had to be reverted. The mixed feed it was trying to fix is not a defect: the app
   speaking English beside an AI speaking Hindi is the intended design.

   **What is actually left is therefore SMALL, and on the AI side only:** make sure every AI surface
   carries the language rule. `LANGUAGE_RULE` covers build/plan/chat; `professionals/engine.ts` covers
   the Professionals. The one real gap found on 2026-08-11 was Doctor AI (`routes/sda.ts`), whose
   prompt said "LANGUAGE: Primarily English medical terminology" — the opposite of the rule, on the
   surface aimed at rural/junior doctors most likely to write in Hindi.

   **Do NOT install a translation service for this** (Google Translate or otherwise). The models are
   natively multilingual — that is what LANGUAGE_RULE uses. A translator would re-translate an
   already-correct reply, add latency to every message, cost per character, and mangle code blocks.

---

## 2 · 🟢 SMALLER, VERIFIED-MISSING (each checked against live code 2026-08-07)

- ~~**Animation / motion recipe**~~ — ✅ **ALREADY BUILT AND WIRED (verified against live code 2026-08-11).**
  `generate_animation` is in `ToolCatalog.ts` (twice — definition + the enabled list), has its dispatcher
  case in `ToolDispatcher.ts`, a pure generator + tests in `lib/MotionGenerator.ts`, an `AppKnowledgeBase`
  entry, AND motion guidance in `systemPrompt.ts`. Shipped 2026-08-08 — three days before this line was
  read as open. **This file has now sent a session at already-built work three times; verify before building.**
- ~~**MCP support**~~ — ✅ **SHIPPED 2026-08-11 (#2273)** as `generate_mcp_server`: the USER's app gets its own stdio MCP server (Claude Desktop / Cursor). Read-only by default, NEVER a delete tool, anon key only. Do not rebuild.

> **Verified genuinely ABSENT on 2026-08-11** (grepped against live code, so the next session need not repeat it):
> MCP · component tree panel · multi-element select · per-version preview URL · service-split generator ·
> design-to-code contract (AP-8) · community gallery/remix · scaling/load estimates · virus-scanning the apps
> we generate. Everything else in this section had already shipped.
- ~~**Component tree panel** and **multi-element select**~~ — ✅ **BOTH SHIPPED 2026-08-11** (#2269, #2272). Do not rebuild.
- ~~**Per-version preview URL**~~ — ✅ **SHIPPED 2026-08-13 (#2344)**: History tab → "Preview" opens that checkpoint running in a new tab while the current app stays untouched, so Restore becomes a decision made AFTER seeing. Runs as a `git worktree` + second port INSIDE the sandbox the user already has warm, so it adds NO E2B cost; `sandboxWarm` asks `getSandboxId` and never boots one. Four honest outcomes, and a URL only after a server really answered. Do not rebuild.
- ~~**One-click object storage provisioning**~~ — ✅ **SHIPPED 2026-08-11 (#2265)**, as `supabaseStorageBucket.ts`
  + `zeroSetupStorageFiles` in `StorageGenerator.ts`. `generate_storage` with provider `"supabase"` is the
  ZERO-SETUP path: the bucket and its RLS policies are created in the USER's own Supabase project, written as
  a migration the provisioning flow applies. No new OAuth scope was needed (a bucket is a row in
  `storage.buckets`, reachable through the Database grant) and **no service-role key is ever fetched** — the
  generated app uploads with the anon key and RLS decides what a user may do. `s3`/`cloudinary` remain the
  BYO-keys options. Do not rebuild.
  ⚠️ **THIS LINE IS WHY THE WARNING ABOVE EXISTS.** It stayed at "🟡 HALF BUILT — the open work is provisioning
  a bucket in the user's own account automatically" for two days AFTER #2265 shipped exactly that, and on
  2026-08-13 it sent a session (mine) to build a second, complete implementation — `storageProvision.ts` plus
  28 passing tests — before a wider grep found the real one and the duplicate was deleted unmerged. Nothing
  reached `main`, but the credit was spent. **The lesson is specific: grep the whole `src/server/lib` for the
  DOMAIN NOUN ("bucket"), not just the tool name, before believing any 🟡 in this file.**
- ~~**Service-split generator** + named paradigms~~ — ✅ **SHIPPED 2026-08-11 (#2273)**: `analyze_service_split` PRICES each seam from the import graph and often answers "keep it as one app"; `setup_architecture` scaffolds clean/ddd/mvc/hexagonal with ESLint-ENFORCED boundaries. It deliberately does NOT auto-rewrite an app into microservices. Do not rebuild. (The original line read: "coupling is already scored; nothing turns that score into a split." It does now.)
- ~~**Design-to-code intermediate contract** (AP-8)~~ — ✅ **SHIPPED 2026-08-13 (#2345)**: the same single vision call now also returns a typed contract (screens, sections top-to-bottom, verbatim labels), fed to the builder as requirements and VERIFIED against the written files afterwards — `DESIGN_CONTRACT_MET` / `_PARTIAL` (missing items by name) / `_ABSENT`. No extra model call. Evidence, never a gate. Do not rebuild.
- ~~**Template-free scaffold fallback**~~ — ✅ **ALREADY BUILT (verified 2026-08-08).** There is no separate module, which is why a name-based grep missed it: the fallthrough is a BRANCH, present in all three prompts that need it — `OneShotBuilder.oneShotUserPrompt` ("The project starts empty — create all files at the project root"), `ProjectPlan.projectPlanUserPrompt`, and the manifest prompt. It is reachable: `scaffold` comes from `listFiles(...).catch(() => [])`, so an empty workspace or a listing error takes it. The roadmap line itself said "verify before building" — this is that verification, and it says do not build.
- ~~**Community gallery / remix**~~ — ✅ **SHIPPED 2026-08-11 (#2275)**, later the same day the line above said it was deferred. Browse / publish / remix, behind `galleryPublishGate.ts`: `.env*`, dependencies, build output and binaries are EXCLUDED, and a real secret inside source REFUSES the publish naming the file and line. It REUSES `scanSecurity` / `scanEnvTemplateSecrets` — no fourth secret scanner was written. Publishing can only produce `pending`; only an admin (`NAV_STORE_ADMINS`) can approve, and a reject/remove DELETES the stored source. Do not rebuild.
- ~~**Scaling / load estimates with real numbers**~~ — ✅ **SHIPPED 2026-08-11 (#2270)** as `POST /api/workspace/scale-check`. Deliberately prints NO capacity figure. Do not rebuild.
- 🔴 **Upload virus-scanning for the apps we generate** — **BLOCKED ON A DECISION, and smaller than it sounds
  (analysed 2026-08-13). Do NOT just wire `malwareScan.ts` into workspace uploads.** Two honest reasons:
  1. **Licensing.** `malwareScan.ts` (VirusTotal) is used by ONE caller, `navStore.ts`. CLAUDE.md already
     records that VirusTotal's FREE API is, by their terms, not for use in a commercial product, and is capped
     at ~4 req/min and 500/day. Every workspace ZIP upload would blow that cap in a day AND deepen a licensing
     problem the admin has not yet resolved. Extending the dependency before the paid plan (or MetaDefender)
     is chosen would be knowingly making a known problem worse.
  2. **The threat models are NOT the same, and this is the part the original one-line item hid.** The App
     Store scans an APK **we distribute to strangers** — that is a real duty of care. A ZIP a user uploads
     into their OWN workspace is **their own code, which they are about to edit**; we are not distributing it
     to anyone. The path where a generated app actually reaches other people is publication — which goes
     through the App Store, and is **already scanned**. So the genuine remaining gap is narrow.
  **What to do instead, when the admin picks a scanner:** scan at the DISTRIBUTION boundary (publish/export),
  not on every workspace upload — same cost, real coverage, and it stays inside any rate cap.
- 👤 **Daily-spend quota gauge** (`/api/usage/tokens`) — the endpoint does not exist, but building it
  needs the admin to define what the quota IS first. A decision, then a small build.
- ⏳ **Cache TTL jitter** (admin-requested 2026-08-08: "kabhi to pad sakti hai, roadmap me likh do") —
  spread each cache entry's expiry by ±10–20% so many entries never expire in the same instant and
  stampede the source together. **Do NOT build it yet, and this is not laziness:** every TTL cache today
  (`PromptCache`, `WorkspaceMemory`, `WorkspaceRegistry`, `ProjectPlanStore`, `BuildQueueStore`,
  `ShareStore`, `hostingPlan`, `WorkspaceLock`, `IdempotencyGenerator`) is keyed per-user/per-workspace
  and each entry is born when that user acts, so expiries are already staggered by the users' own arrival
  times — jitter would buy nothing measurable and would cost determinism. (The RETRY side already has
  jitter where it genuinely matters: `ClaudeClient` backoff, `AIRouter` ±20% cooldown — the 429-storm path.)
  **BUILD IT THE DAY any of these is true:** (1) a SHARED/global cache appears (one entry served to all
  users); (2) a cache is warmed or rebuilt in BULK (startup pre-fill, cron refresh, post-deploy warm-up —
  every entry then born and dying in the same second); (3) a cross-instance cache lands (Redis/Memorystore),
  where one expiry storm hits every Cloud Run instance at once; or (4) real traffic shows periodic latency
  spikes on a TTL boundary. **Shape:** one shared `jitteredTtl(baseMs, spread)` helper used by every cache
  — never per call site — paired with single-flight (one refill per key, others wait). Single-flight is the
  stronger half: jitter spreads the herd, single-flight makes even a simultaneous herd cost ONE fetch.

---

## 3 · 🟢 UNREACHABLE ROUTES — triage before building anything

Found 2026-08-07 while root-causing the Render deploy, which turned out to be a real, working engine
with **no caller anywhere in the client**. The same question, asked repo-wide: of 313 `/api` routes, 74
are referenced by no file outside `src/server`.

**That number is a starting point, not a defect count.** Reading each route file's own header showed it
mixes three very different things:

- **(c) Intentional** — `observability.ts` (7 routes) is admin-password-gated diagnostics, consumed
  outside the client by design. Not a defect. The URL filter missed it because the gate is a password,
  not an `/admin` path. **Any future sweep must read intent, not just count references.**
- **(a) Dead duplicate** — `professionals.ts`'s list route; the client renders its own
  `professionalConfigs.ts`. Two sources of truth that can drift. (The *chat* route IS called.)
- **(b) Real candidates** — `design.ts` (4), `docs.ts`, `convention.ts`, `testgen.ts`, `openapi.ts`,
  `appmaker.ts` (3), `pro.ts` (3). A phase of "pure compute" endpoints that never got a UI.

**Before building a UI for any (b): check whether it duplicates a builder TOOL that already exists**
(`generate_dev_guide`, `generate_integration_tests`, `generate_graphql` are all wired). If it does, it is
a drifted duplicate to DELETE — the class rule 4 names — and putting a UI over a stale copy would be
worse than leaving it hidden.

An allowlist-based CI guard is worth adding only *after* triage; today it would be ~48 lines of noise.

---

## 4 · 🟡 HALF-DONE — the big part shipped, a tail remains

Each of these is genuinely useful today; the remainder is usually infra-shaped.

| Item | Shipped | Remaining |
|---|---|---|
| **GA-2 Runtime supervisor** | in-process reaper | 🔒 out-of-process supervisor + durable job queue (Cloud Run Jobs) |
| **GA-4 Incremental builds** | `computeBuildPlan` computes the delta | 🔒 needs E2B volume control to cache across cold sandboxes |
| **GA-16 Performance** | real built-dist bundle size + optimisation tool | 🔒 runtime profiler / leak detector needs a live-execution harness |
| **B5 Network capture** | console errors, runtime classifier, HTTP 5xx | richer per-request capture (method/timing/body) — daemon work |
| **T1-watchdog** | zombie-build sweeper | 🔒 force-killing the orphaned E2B VM (needs GA-2) |
| **Codemod scale** | relevance-scoped, 2000-file cap, honest truncation | auto-loop when the shortlist itself exceeds 2000 files (rare) |
| **AP-5 Prompt cache** | stable-prefix structure built | per-provider cache markers — ⚠️ **moat, do not change autonomously** |
| **AP-7 Edit mode** | works | ✅ **VERIFIED 2026-08-11 — no gap found; do not build from this line.** The aspiration ("make edits as smart as builds") is not a defect, and the code contradicts it: the post-build quality gates (integrity heal, design gate, lint, runtime autofix, reviewer) are **not** `!isEditMode`-guarded — they run on edits too. The only build-only paths are ones that make no sense on an edit (palette preset, requirement-gap analysis, deep-pipeline blueprint, ask-user). And the edit path is in places **more** careful than a build: it scans the STORED workspace merged with this turn's writes, so a boot-killer sitting in an untouched file is caught — a fresh build skips that read because it cannot apply. `editModePrefix` already enforces locate-first (grep/glob/architecture_map), read-before-write, surgical `edit_file`, minimum changes, blast-radius via `code_graph`, and prove-it-still-works. **A real improvement here needs a real build report showing a specific edit that went wrong** — the same rule already recorded for AP-9. |
| **AP-9 Requirement coverage** | works; root-caused TWICE already (`Registration.tsx` not matching `/register/`; `components/admin/` dropped by basename-only matching) and now matches full paths + component names + routes | ⚠️ **NEEDS EVIDENCE, not more guessing (2026-08-08).** The "false positives" line has no reproduction behind it. The one gap visible in the code is deliberate — the surface is paths and names, never file CONTENTS — and loosening that would trade false positives for FALSE NEGATIVES (reporting a feature as built because the word appears in a comment), which is strictly worse. Do not touch this without a real build report showing a specific feature wrongly flagged; then fix that case. |
| **GA-5 / GA-6 / GA-7 / GA-8 / GA-10 / GA-12 / GA-13 / GA-14 / GA-15** | main engine in each | narrow tails; **verify each against live code before starting** — several neighbours in this list turned out to be finished |

---

## 5 · 👤 WHAT ONLY THE ADMIN CAN DO

Claude cannot reach any of these. Ordered by urgency.

### The Cloud Run switches, in the order to flip them

1. **`AGENTV3_PARALLEL_BUILD=on` — flip this first.** Audited by construction (see §0): one value drives
   the lock, the dispatch and the prompt, and sub-agents share the locked actuator, so there is no path
   where parallel writers run unlocked. Nothing to wait for. Then watch one large build: if it is not
   faster, unset it — the flag is a clean revert with no state to undo.
2. **`AGENTV3_WEAK_CHECKPOINT=on`** — the best free win on this page. Costs nothing (the scan is
   deterministic, not an LLM call) and helps the free tier, which struggles most. See §0 for why its
   false-alarm filter is trustworthy.
3. **`AGENTV3_VACCINE=on`** — the platform runs the built app's OWN test suite and reports honest
   pass/fail, so a green build whose tests fail can no longer be called verified. On its own it spends
   no model tokens (the repair budget only opens if `FEATURE_HEAL` is on too), and with no suite it is
   a silent no-op.
4. **`AGENTV3_DEPHEALTH_GATE=on`** — free safety information (CVE + copyleft on the finished app),
   advisory-only, cannot block a build. `AGENTV3_OBSERVABILITY_INJECT=on` is the same shape if you want
   built apps to carry a `/health` route.
5. **`AI_WALLET_SPEND=on` — but only after the current deploy lands.** The 2026-08-07 audit found the
   tiered markup was applied per model-call and then summed, which **overcharged** users on any
   multi-call action (three $0.50 calls billed $6.00 instead of $5.50; worst on the App Debugger).
   Fixed and test-locked in #2175, merged 2026-08-07 → Cloud Run auto-deploys it. Turn the flag on after
   that build shows green in Cloud Build, so the first version real users meet is the corrected one.
   Nobody was ever billed by the bug — the flag had never been on, which is exactly why it survived.
6. **Judgement calls, not recommendations:** `AGENTV3_STREAMING_PREVIEW` buys tens of seconds of
   perceived speed but can briefly show an app before it is verified; `AGENTV3_REDTEAM` really hardens
   the app's inputs but adds an LLM pass to every successful build. Both are safe; both are trade-offs
   only you can price.
### Everything else on the admin's plate

- **VirusTotal licensing** — the free API is, by their terms, not for commercial products, and
  NavBharatAI is one. Fine for testing; needs a paid plan or another scanner (MetaDefender) before the
  Nav App Store carries real traffic.
- **Widen the cost-routing canary** — `AGENTV3_COST_ROUTING_USERS` is still scoped to one account.
  Clear it once the `deliveredVia` telemetry looks right.
- **Define the spend quota** so the daily gauge in §2 can be built. This is a product decision, and the
  endpoint cannot be designed sensibly until it is made.
- **E2B template rebuild** — the fullstack image ships Node/Python/Java/Go only. Rust, Ruby, PHP and
  C/C++ frameworks cannot be offered until the multi-GB template is rebuilt and republished; adding the
  registry entries first would create build options the sandbox cannot run (a fake feature, rule 2).
- **A GitHub Actions look** — CI produced no run at all for 8.5 hours on 2026-08-06/07. It recovered on
  a PR close/reopen, so it was a dropped webhook rather than a spending limit, but it is worth a glance
  at the Actions billing page. Separately, six Dependabot PRs are open; four of them bump the Actions
  that are currently emitting the "Node 20 is deprecated" warning in every CI log.

**Explicitly declined by the admin (not tasks):** `AGENTV3_ASK_USER` · `.exe` / `.dmg` desktop signing ·
Redis / Terraform / Cloud Armor / SIEM · Pro tier-gating.

---

## 6 · 🔒 BLOCKED — real infra, not a session's work

The code half is done where one exists; only the infrastructure remains.

- **Signed native binaries** beyond APK/AAB/IPA (`.exe`, `.dmg`) — needs electron-builder on a matching OS runner.
- **Lighthouse / Web-Vitals / axe over the LIVE preview** — needs headless Chrome or a prod E2B key in CI.
  *This is the app's weakest measured category; unblock it when infra allows.*
- **Multi-service orchestration & preview · bigger E2B VM · warm pool · Firebase Emulator in sandbox.**
- **Embeddings (V4-5 "Smriti")** — needs an embeddings key; BM25 already grounds retrieval.
- **WebContainers (V4-6)** — commercial StackBlitz licence. BrowserBox is held by design.
- **Cloud KMS / Secret Manager · Cloud Monitoring SLO alerting · canary / blue-green / cross-region.**

---

## 7 · 🚫 NON-GOALS — do not build, do not re-propose

- **BYOK (a user's own Anthropic key)** — removed deliberately by the admin 2026-06-25. v3.0 always runs
  on NavBharatAI's own account, billed via the markup. *(Bring-your-own-DATABASE is a different thing and
  is kept.)*
- **A local `nbai` CLI.** The SDK/MCP half is fine; a user-facing local CLI is not the product.
- **Anything that shows a user a provider name.** The white-label law is absolute — see `CLAUDE.md`.
- **Touching the moat autonomously:** multi-provider routing, billing honesty, the coherence
  architecture. Confirm with the admin first, every time.

---

## How to use this file

1. **Re-grep before you start.** Every line here is a hint. Nine were wrong on 2026-08-07.
2. Root-cause fix + regression test + an `AppKnowledgeBase.ts` entry if it is user-facing.
3. Branch → verification gate → PR → CI green → merge. Merge is what deploys.
4. Append what shipped to `PROGRESS.md`, and **correct this file in the same PR** — that is the only
   thing that stops it drifting again.
