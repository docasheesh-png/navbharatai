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

## 0 · ⚙️ THE FLAGS — what is ON, and the four real choices left

> ## ⚠️ CORRECTED 2026-08-16 — this section was telling the admin to do work they had already done
>
> Until today this page listed eight flags as "turn these on", and **the admin had already turned seven
> of them on** — five on 2026-08-08, two more on 2026-08-14. §5 repeated the same stale instruction as a
> numbered to-do list, in priority order, as though none of it had happened.
>
> That is precisely the failure safeguard #1 exists for, and it has already cost this project real work
> (PR #1 and PR #4 were built blind on a stale picture of `main`). A roadmap that hands a session
> finished work is worse than no roadmap: it is confidently wrong, and it burns credit to discover it.
>
> **`CLAUDE.md`'s env registry is the authority on what is set in Cloud Run — not this file.** Claude
> cannot see Cloud Run, so that registry is maintained hand-to-hand with the admin. This table is a
> convenience view of it and goes stale the moment a switch is flipped. When the two disagree,
> **`CLAUDE.md` wins** and this table is the thing to fix.

### ✅ ON in Cloud Run — nothing to do, but know what changed

Dates are from `CLAUDE.md`'s registry. The audit verdicts that justified each are kept, because they are
what makes the flag *reviewable* if a real report ever turns against it.

| Flag | On since | What it changed | What to watch now that it is live |
|---|---|---|---|
| **`AGENTV3_PARALLEL_BUILD`** | 2026-08-08 | Frontend + backend built concurrently (#1790). ONE `parallelBuild` value drives the write-lock, the dispatch AND the architect prompt, so "parallel on, lock off" cannot exist; sub-agents share the same locked actuator. | **The speedup is still unmeasured.** It needs one real large multi-file build compared against a serial one. This is the only flag here that changes HOW a build runs — if anything looks wrong, this is the first to unset. |
| **`AGENTV3_WEAK_CHECKPOINT`** | 2026-08-08 | Deterministic readiness scan every 20 steps on a weak build; steers only on the two completeness-independent blockers. No LLM call, so no cost. Max 2 nudges from step 15. | Whether weak-tier builds converge in fewer steps. Cannot fail a build. |
| **`AGENTV3_VACCINE`** | 2026-08-08 | The platform RUNS the built app's own test suite and reports honest pass/fail — a green build whose tests fail can no longer be called verified. A shell command, not a model call. | ⚠️ Its **repair budget is now OPEN**, because `FEATURE_HEAL` went on 2026-08-13 (`vaxHealMax = featureHealEnabled ? 1 : 0`). On its own it was free; it is not any more, for the 20% cohort. |
| **`AGENTV3_DEPHEALTH_GATE`** | 2026-08-08 | CVE + copyleft advisory appended to an already-successful build. Cannot block or fail one. | Nothing. Advisory by construction. |
| **`AI_WALLET_SPEND`** | 2026-08-08 | The one-wallet law — every assistant and tool draws the SAME balance a build does. | Turned on only AFTER the audit found and fixed a real **overcharge** (#2175: tiered markup applied per call then summed — three $0.50 calls billed $6.00 instead of $5.50). Nobody was ever billed by it, because the flag had never been on. **That is the lesson worth keeping: a flag that has never been on has never been tested by reality.** |
| **`AGENTV3_FEATURE_HEAL`** + `_PCT=20` | 2026-08-13 | One bounded pass adds a control the user asked for that is missing from the live DOM, then re-probes the running app. Wrapped in `verifyAfterFix`, so a heal that breaks the render is REVERTED. | Costs an extra model pass on the builds it fires for. `_PCT=20` is a real canary keyed by workspaceId — compare per-build cost and duration for the 20% against the other 80%. ⚠️ An unset/malformed `_PCT` means **100%**, not 0. |
| **`AGENTV3_DESIGN_GATE`** | 2026-08-13 | The "1st page beautiful, andar ke page HTML feel dete hai" fix. Detection is deterministic and free; ON adds one bounded repair pass naming only the offending pages. Can never fail a build. | No PCT canary — it is all-or-nothing, so watch the first few builds. |
| **`AGENTV3_STREAMING_PREVIEW`** | 2026-08-14 | Files are persisted the instant they are ready, so the user sees their app 30–155s sooner instead of watching a spinner while a finished app sits on the server. | ⚠️ **Its first real users are recent — treat it as new, not settled.** Watch that the preview appears early *and correct*, not half-rendered. |
| **`AGENTV3_CACHE_PREFIX`** | 2026-08-14 | ~12 volatile blocks moved out of the static prompt HEAD so the ~46KB body becomes a stable cache prefix. The model sees identical content, only relocated. | Per-build cost should drop on repeat builds of the same workspace. ⚠️ **This entry previously said "🚫 Leave off — the benefit is unmeasurable." That was wrong and is corrected**: the mechanism is Anthropic's prefix matching, and a daily-changing head busts the cache for the entire static body. |
| `LINT_GATE` · `INTEGRITY_GATE` · `REQUIREMENT_AWARE` · `REVIEW_AUTOFIX_WARNINGS` · `AUTOFIX` · `RATE_PACER` · `COST_ROUTING` (canary) · `AUDIT_FIX` · `BILL_SANDBOX` | Jul–Aug | See `CLAUDE.md` for each. | — |

### ⬜ STILL OFF — the four genuine choices left on this page

| Flag | What turning it on gives you | The honest trade-off |
|---|---|---|
| `AGENTV3_OBSERVABILITY_INJECT` | Adds a `/health` route to an Express app that lacks one. | ✅ **SAFE.** Purely additive, build-end, never blocks. It does modify the user's app — the only thing to be aware of. |
| `AGENTV3_PRETTIER_GATE` | "N files need formatting" note on the summary. | ✅ Safe, advisory. **Lowest value on this page** — say no and lose nothing. |
| `AGENTV3_REDTEAM` | Really attacks the built app's inputs, then hardens them. | ⚠️ **SAFE but COSTS MONEY.** Correctly routed (weak stays on GLM/Kimi, never Sonnet/Opus), well bounded (successful builds only, 12-case cap, needs ≥120s budget, abortable). But it is an extra LLM pass on **every successful build** — a money decision, not a technical one. |
| `AGENTV3_REVIEW_FASTLANE` | Runs the reviewer on fast-lane builds that currently skip it. | ⚠️ **SAFE but COSTS MONEY** — same shape as `REDTEAM`. |
| `AGENTV3_ASK_USER` | The clarify card. | 👤 **Declined by the admin deliberately** — friction vs zero-UI. Not a task; do not re-propose. |
| `AGENTV3_INLINE_BABEL` | — | 🚫 **A REVERSE kill switch. OFF is correct.** See the box below; it must never appear on a "turn these on" list. |

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
**A flag that has never been on has never been tested by reality.**

**And the job this section forgot:** a flag that has been turned ON must be MOVED, in the same session
the admin says they flipped it. That is the maintenance this file skipped for eight days, and it is why
§0 and §5 spent that time instructing the admin to redo finished work. The registry in `CLAUDE.md` is
updated hand-to-hand when a switch is flipped; this table has to follow it, not drift behind it.

⚠️ **The flag surface is now large enough to be its own problem.** `STREAMING_PREVIEW` and
`CACHE_PREFIX` were made env vars only because they had never run in production and an env var is an
instant revert with no deploy. Once real builds prove them, their defaults belong in the CODE and the
two keys should RETIRE — that is what shrinks a list the admin has already objected to the size of.

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
4. **AWS / Azure / Railway deploy providers.** ⚠️ **GENUINELY ABSENT, but RE-PRIORITISED DOWN after
   counting what already ships (2026-08-16) — do not treat this as a top-five item.**
   Verified registry: **Firebase** (always available, zero setup — the platform service account),
   **Cloudflare**, **Vercel**, **Netlify** all call `registerDeployProvider`, plus **Render** for the
   separate backend. So a user already has four static hosts *and* a backend host, one of which needs no
   credentials at all.
   Each of the three named here needs the user to bring credentials for a cloud most indie makers do not
   have (AWS: IAM + bucket policy + CloudFront distribution; Azure Static Web Apps: fewer users still),
   and this file already records that **Railway's API could not be verified from a session**. Building
   them adds provider *count*, not user capability — and the AIM tie-breaker is what makes NavBharatAI
   best, not what makes its comparison table longest.
   **Build one only when a real user asks for that specific cloud.** GitHub Pages is the better next
   provider if one is ever wanted: it is named in `DeployProviders.ts`'s own header, needs no new
   credential (the user's GitHub OAuth token is already threaded through `DeployContext.githubToken`),
   and every user of the save-to-GitHub flow already has the account.
5. ~~**Visual template gallery.**~~ — ✅ **ALREADY BUILT AND WIRED (verified against live code
   2026-08-16). Every clause of the old entry was wrong**, and it is worth reading why, because this
   line carried the words "✅ VERIFIED GENUINELY OPEN" and was still the fifth false-open in this file.
   **It had audited the wrong file.** `TemplatesPanel.tsx` is the saved-template list; the starter
   library is `src/components/agentv3/starterTemplates.ts`, and it has:
   - **25** starters, not 14;
   - a real **`category`** field (Business / Social / Productivity / Commerce / Personal) plus
     `startersByCategory()`;
   - **tier gating** the old line never mentioned — `partitionStarters(powerUnlocked)` shows a FREE user
     only the `tier:'simple'` apps the weak tier reliably ships end-to-end, with a curated few `pro`
     apps as locked "⚡ Pro" showcases. That protects a free user's first build, which matters more than
     any thumbnail;
   - **visuals, and they are RENDERED** — `starterSketch.ts` + `StarterSketch.tsx`, mounted at
     `AgentV3Panel.tsx` ~3187.
   **On the "screenshots" the old line asked for: they were deliberately REFUSED, and the reasoning is
   in `starterSketch.ts`.** Photographing 26 generated apps yields images that go stale the day the
   engine improves, and drawing an attractive fake one is a picture of an app that does not exist, shown
   to the person deciding what to build — a rule-2 violation. So each template shows a *layout sketch*
   (list / dashboard / grid / feed / board / form / keypad / focus / landing), labelled a sketch and
   never "preview". **Do not "fix" this by adding screenshots without reading that file first.**
   The only genuinely absent piece is a `/api/templates` endpoint, and nothing needs one: the library is
   static data compiled into the client, which is faster and cannot fail.
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

### The Cloud Run switches — ✅ DONE, nothing here to flip

> **This was a numbered to-do list of six switches, and the admin had already flipped every one of
> them** (five on 2026-08-08, `STREAMING_PREVIEW` on 2026-08-14) — plus `FEATURE_HEAL`, `DESIGN_GATE`,
> `BILL_SANDBOX`, `AUDIT_FIX` and `CACHE_PREFIX`, which this list never mentioned at all. It sat here
> unmaintained for eight days telling the admin to redo finished work. **Corrected 2026-08-16.**

The live state now lives in **one** place — `CLAUDE.md`'s env registry — and is mirrored in §0 above.
There is no pending switch. The four genuinely-off flags are in §0's second table, and only two of them
are real decisions (`REDTEAM` and `REVIEW_FASTLANE`, both "better quality for one more LLM pass per
build" — a money call, not a technical one).

**The rule that keeps this true:** when the admin says they flipped a switch, the same session updates
`CLAUDE.md`'s registry **and** §0 here. A flag list that lags reality does not merely go stale — it
actively sends the next session to do work that is already done.
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

## 8 · 🟢🔵 THE CONTROL GAP — closing the 60-item Claude Code audit (added 2026-08-17)

Source: the capability audit run on 2026-08-17 against `main @ a599ea2`, by code search across
`src/server`, `src/components`, `src/hooks`. Admin asked for a roadmap covering **all 60** gaps, so all
60 are here — but they are ordered by **what the user gains**, not by the audit's numbering.

> ### The finding that shapes this whole section
>
> **v5 is not behind on intelligence. It is behind on CONTROL.** Almost every gap has the same shape:
> the engine can do the thing, the user cannot direct it, interrupt it, inspect it, or extend it. v5 was
> built as an *appliance* — state a wish, receive an app — which is right for someone who cannot code,
> and stops being right the moment their app gets real.
>
> **Two of the top items are already-built code behind a switch.** A1's steering exists and is gated to
> one tier; A2's shell exists and is mounted in a different screen. Neither is a feature to build. Check
> that before estimating anything here.

> ### ⚠️ Method caveat — carried from the audit, do not skip
>
> The audit's "absent" findings come from grep. **That method produced two false positives before
> publication**: `browser_action`/`screenshot` (dispatched with `if`, not `case`) and GitHub repo import
> (lives in `GithubApiTree.ts`). Both were corrected. Per this file's own §"How to use", **re-grep the
> DOMAIN NOUN before starting any item below** — never the feature name you expect.

**Verified PRESENT during the same scan — do NOT rebuild:** a real PTY shell (`ShellTerminal.tsx`),
sub-agents (`task`/`second_opinion`/`consensus`), plan approval + permission gates (`Approvals.ts`,
5 call sites), secret requests, browser control, GitHub repo import, vision (images + PDF), web search,
checkpoints + restore, Git panel, todo list, transcript compaction, deploy/preview/billing.

---

### 8A · CONTROL — do these first (🟢 all small, highest value per rupee)

| # | Item | Audit ref | Where | Notes |
|---|---|---|---|---|
| A1 | ✅ **DONE 2026-08-18 (#TBD)** — mid-build steering open to every tier | major 6 | `steerAllowedForBuild` + `canSteerMidBuild` | Ungated at BOTH ends via one predicate each, `STEER_QUEUE_MAX = 5` cap (the runner injects the whole queue in one turn, so unbounded queue = unbounded prompt), honest 429 over the cap. Team HQ card stays `'max'`-only — that is the real premium. Revert: `AGENTV3_STEER_ALL_TIERS=off`. |
| A2 | ✅ **DONE 2026-08-18 (#TBD)** — real shell in v5's Terminal | major 1, minor 21 | Tab SPLIT: build log on top, real PTY below (lazy — xterm must never reach first paint). 8F.1 answered by the admin: **free, 30 min/day**. `AgentV3/terminalQuota.ts` + `TerminalUsageStore.ts`; gate on `/shell/open`, accrual WHILE attached (metering only on close is bypassable by shutting the tab) with a final tick on disconnect. Quota events are WRITTEN INTO the terminal — a session that just stops is indistinguishable from a broken one. `AGENTV3_TERMINAL_DAILY_MINUTES` tunes it; an EMPTY value means unset, not 0. |
| A3 | ✅ **DONE 2026-08-18 (#TBD)** — `web_fetch` tool | major 7 | `AgentV3/webFetch.ts` + catalog + dispatcher | Reads ONE user-supplied URL. SSRF defence REUSES `lib/ssrfGuard.ts` (not a second copy): scheme check, hostname denylist, every resolved A/AAAA must be public, `redirect: 'error'`, 2 MB cap enforced while STREAMING (never from `content-length`), 15s timeout, 30k-char output cap that says when it truncated. Residual DNS-rebinding risk documented in the module, not papered over. |
| A4 | ✅ **DELIVERED BY A1 2026-08-18** — nothing left to build | minor 2 | same composer + `/steer` queue | A1 shipped the whole path: the composer stays live during a build on every tier, the message queues server-side (cap 5), and the runner injects it at the next step. Re-check before writing any code here — this row is why. |
| A5 | **Edit a past message and re-run from it** | minor 1 | `AgentV3Panel.tsx`; pattern exists in `ProfessionalChat.tsx:146` | Copy the existing rewind-the-transcript approach. Must refuse while a turn is in flight. |
| A6 | **Retry the last step only** | minor 9 | build loop | Needs a durable "last tool call" record. Cheaper than the full-rebuild users do today. |
| A7 | **Explicit "answer, don't build" control** | minor 10 | intent routing exists, is not user-facing | A visible toggle. Today a question can spend a build. |

**Ship gate for 8A:** each item is its own PR, verification gate, CI green, merge. A1 and A3 also need
an `AppKnowledgeBase.ts` entry (user-facing capability change).

---

### 8B · SEEING WHAT HAPPENED — debuggability (🟢)

| # | Item | Audit ref | Notes |
|---|---|---|---|
| B1 | ✅ **DONE 2026-08-18 (#TBD)** — "App Logs" tab | minor 22 | `AgentV3/runtimeLogs.ts` (pure) + `GET /api/agentv3/runtime-logs` + `hooks/useRuntimeLogs.ts`. Byte-offset POLLING, not SSE, and only while the tab is visible — the log is a file in a billed VM, so a held-open stream would spend money to watch a file. Detects restart (log shrank) and skipped bytes, and says so. Empty pane distinguishes never-built / dormant / running-but-silent. |
| B2 | ✅ **DONE 2026-08-18 (#TBD)** — running/not-running strip in App Logs | minor 26 | `AgentV3/portsPanel.ts` + `GET /api/agentv3/services` + `hooks/useAppServices.ts`. Joins serviceGraph's EXPECTED services with REALLY-listening ports. ⚠️ REUSES `PortDiscovery.LISTENING_PORTS_COMMAND` + `parseListeningPorts` — a first draft hand-rolled a second /proc parser and only a duplicate-identifier error caught it. `isInfraPort` exported from the same module so a listening 5432 reads as "your database", not a mystery. |
| B3 | Start / stop / restart one service | minor 25 | Today a stuck server needs a full rebuild. |
| B4 | Re-run only the failing test | minor 28 | `run_tests` exists; add a filter argument. |
| B5 | ✅ **DONE 2026-08-18 (#TBD)** — name a checkpoint | minor 15 | `lib/checkpointLabel.ts` (pure, SHARED by server + client — the client cannot import CheckpointStore, and two copies of the cap would drift) + `POST /api/agentv3/checkpoint/label` + inline rename in History. Label is OMITTED not undefined (Firestore rejects undefined and saveCheckpoint swallows errors — it would have silently stopped persisting history). Optimistic, but REVERTED with an honest message if the write did not land. |
| B6 | Diff two checkpoints | minor 14 | Diff machinery already exists for the build diff view. |
| B7 | Undo ONE edit without restoring a whole checkpoint | minor 13 | Needs per-edit granularity in the checkpoint store. |
| B8 | ✅ **DONE 2026-08-18 (#TBD)** — context meter above the composer | minor 7 | `AgentV3/contextUsage.ts` (pure) + a `context_usage` wire event + reducer + meter. Uses the PROVIDER-REPORTED input tokens, never an estimate — no count ⇒ says nothing. Window comes from `TokenEstimator.modelContextLimit` (extended with GLM/Kimi; leaving them on the 200k default would have over-stated room and warned too late). 🔒 Percentage + plain words only: the window size itself would leak which engine ran. Silent below 70%. |

---

### 8C · THE PROJECT'S OWN RULES (🟢)

| # | Item | Audit ref | Notes |
|---|---|---|---|
| C1 | ✅ **DONE 2026-08-18 (#TBD)** — per-project instruction file | minor 18 | `AgentV3/projectInstructions.ts` (pure) + read into the build prompt. Accepts `NAVBHARATAI.md` (ours, first) then `AGENTS.md` / `CLAUDE.md` / `.cursorrules`, so an IMPORTED repo's existing rules work with nothing to convert. ROOT ONLY (a `docs/AGENTS.md` is an article, not policy), capped at 8k with an honest truncation note, FENCED + attributed so a user file cannot read as a system directive. Injected into the per-turn USER message, never the static system prompt — that is the cached prefix, and a per-project block at its head would bust the cache for every workspace. The user is TOLD which file was used. |
| C2 | ✅ **DONE 2026-08-18 (#TBD)** — `.navbharataiignore` | minor 19 | `AgentV3/ignoreRules.ts` (pure) + a real GUARD in `ToolDispatcher.assertWritable` on write_file / write_files_batch / edit_file / codemod_move_file (both ends of a move). Armed for the architect, the PLAN runner AND sub-agents (via a thunk — the spawn is built before the file is read, so passing an array would have silently disarmed every child). Throws, so `dispatch` returns `is_error: true`: a returned string would read as SUCCESS. gitignore subset with last-match-wins negation. ⚠️ HONEST BOUNDARY: guards the AI's file tools, not the filesystem — a user's own terminal command still can, and the 193 direct `actuator.writeFile` call sites are a separate change. |
| C3 | ✅ **DONE 2026-08-18 (#TBD)** — `@file` scoping + picker | minor 6 | `AgentV3/fileMentions.ts` (server, resolved against the REAL tree) + `lib/fileMentionPicker.ts` (client rules, pure) + a dropdown in the composer. An AMBIGUOUS basename is left unresolved rather than guessed; an unfound mention is REPORTED, never silently dropped. The block says "start here", not "only these" — a hard fence would ship half-done changes. ⚠️ The picker claims only Arrow/Tab/Esc: Enter already carries send/steer/newline logic that differs by lane, tier and device. |
| C4 | Env editor + dev/staging/prod profiles | minor 31 (partial), 32 | Vault holds SECRETS; there is no plain env editor and one value set serves every environment. |
| C5 | Add / remove a dependency from the UI | minor 30 | |
| C6 | File tree: rename, move, multi-select | minor 11, 12 | |

---

### 8D · DATA &amp; VERSION CONTROL (🔵 multi-PR)

| # | Item | Audit ref | Notes |
|---|---|---|---|
| D1 | Database browser + read-only SQL runner | minor 23, 24 | ✅ **ALREADY BUILT — was just UNREACHABLE; wired 2026-08-19.** `DatabaseStudio.tsx` (ROADMAP #1 Phase 2.1–2.5) browses the user's OWN Supabase/Postgres tables + rows + columns + schema, runs READ-ONLY SQL (`/api/integrations/supabase/query` defaults to `readOnlyQuery`, write only on explicit `allowWrite` + a client confirm — Postgres-enforced via `sqlSafety.ts`, not text-parsing), edits rows only when a real primary key exists, and does CSV import/export. The ONE gap: nothing set `activeView='dbstudio'`, so the whole screen had no doorway (AppKnowledgeBase even claimed "Sidebar → Database Studio", which never existed). Fixed by adding the **Home → Developer Tools → Database Studio** tile. Another false-open of the exact kind this file's header warns about — the screen was done, only the nav was missing. |
| D2 | Git blame / file history, partial commit, revert one commit | minor 37, 38, 39 | `GitManager` exists; these are surfaces on it. |
| D3 | Open a PR, read CI, reply to review comments | minor 33, 34, 35 | Needs the GitHub App token path that already exists for storage. |
| D4 | Merge-conflict resolution | minor 36 | Hard. Blocks all real collaboration — do it only if 8E's team tier is actually pursued. |
| D5 | Two branches at once | minor 40 | Needs per-branch sandbox isolation. Expensive in E2B time — cost it before building. |

---

### 8E · PLATFORM &amp; TEAM — 🚨 MY RECOMMENDATION IS TO DEFER MOST OF THIS

> **Stated plainly, because the admin asked for all 60 and this is where I disagree with building them
> all.** Items E4–E9 are the extensibility cluster — hooks, skills, custom agents, MCP, per-tool
> permissions, a CLI. Together they are what makes Claude Code a *developer platform*. Chasing them
> turns NavBharatAI into a competitor to Cursor for an audience it does not have, while the real moat —
> Hindi, Cashfree, UPI, domain recipes, the App Store, mobile-first — goes unattended. They are listed
> in full because completeness was asked for. **The recommendation is: build 8A–8D, ship E1–E3, and
> treat E4–E15 as OPEN-but-not-scheduled** until a real user asks for one.

| # | Item | Audit ref | Verdict |
|---|---|---|---|
| E1 | Share a build with a read-only link | minor 42 | ✅ **Build it.** Cheapest trust win here — a user showing a client their app is organic marketing. ⚠️ Must pass the provider-anonymisation pass (White-Label Law) before any report is shareable. |
| E2 | Invite a teammate, roles, audit log | minor 41, 43, 44 | ✅ Build when the first agency asks. Not before. |
| E3 | Background tasks + scheduled runs | major 9, 10 | ✅ **Build it.** A build owning the whole screen is the most-felt limit that is not about code. |
| E4 | Custom commands / saved skills | major 4, minor 48 | 🟡 Defer. High retention value in theory; unproven for our audience. |
| E5 | Hooks | major 3, minor 47 | 🟡 Defer — developer-platform feature. |
| E6 | Per-tool allow / deny rules | major 5, minor 49 | 🟡 Defer. Gates already exist and are the safety-critical half. |
| E7 | User-defined sub-agents | major 8, minor 45 | 🟡 Defer. |
| E8 | MCP **client** | major 2, minor 46 | 🟡 Defer. Note: `McpServerGenerator.ts`'s header already records this decision and its reasoning — read it before re-proposing. |
| E9 | Use v5 from a terminal / editor / CI | minor 50 | 🚫 Near-non-goal. This is Cursor's product, not ours. |
| E10 | Search chat history · fork a conversation · export a transcript | minor 3, 4, 5 | 🟡 Search is the useful third; fork and export are rarely asked for. |
| E11 | Go-to-definition · inline errors (LSP) | minor 16, 17 | 🟡 Defer — large build, serves developers. |
| E12 | Two projects side by side | minor 20 | 🟡 Defer. |
| E13 | Test watch mode | minor 29 | 🟡 Defer. |
| E14 | Breakpoint debugger | minor 27 | 🚫 Very large. B1 (logs) covers most of the real need. |
| E15 | Response style / verbosity setting | minor 8 | 🟡 Small; do it alongside C1 if convenient. |

---

### 8F · 🔒 DECISIONS THE ADMIN MUST MAKE FIRST (not a session's call)

1. ✅ **A2's money decision — ANSWERED by the admin 2026-08-18: free, with a 30-minute daily cap.**
   (A user-facing shell holds a billed E2B VM, ~₹7/hr measured, and terminal time is absorbed by
   NavBharatAI.) Shipped as `AGENTV3_TERMINAL_DAILY_MINUTES`, default 30. The cap is what converts an
   unbounded liability — a tab open around the clock is ~₹5,000/month, a miner is worse — into a known
   small one, while keeping the terminal free to open.
2. **D1 write access.** Read-only browsing is safe. Letting a user run writes against their own
   production database needs an explicit confirmation design.
3. **E2 team pricing.** Multi-user changes the billing model; not a code decision.

### 8G · Sequencing

**Sprint 1 (control):** A1 → A2 (after 8F.1) → A3 → A4.
**Sprint 2 (visibility):** B1 → B5 → B2 → B8.
**Sprint 3 (project rules):** C1 → C3 → C2.
**Sprint 4 (trust):** E1 → E3.
**Then re-assess.** A1, A2, B1 and C1 alone close most of what a real user actually feels. If those four
land and users still ask for E4–E8, that is evidence — and evidence beats this document.

---

## 9 · 🔵 "CURSOR FOR INDIA, IN HINDI" — the graduation path (added 2026-08-17)

Admin, after reading §8E's recommendation to defer the extensibility cluster: *"to ham indians ke liye
bana rahe hai cursor aisa maan lo, hindi me 😂 kya yeh nahi ho sakta. agar sach me impossible hai…to
chor do. agar koi rasta ho…to isko bhi roadmap me add kar dena!"*

> ### The honest correction that produced this section
>
> §8E argued against the extensibility cluster on the grounds that it serves "an audience we do not
> have". **That reasoning was wrong, and the admin's push-back is what exposed it.** Nothing in §8E was
> a feasibility claim — every item there is buildable — and the audience objection does not survive
> contact with the actual number: India has millions of people who CAN code but read English slowly
> (engineering students, polytechnic/ITI, tier-2/3 developers). Nobody serves them, and Cursor never
> will, because it has no incentive to.
>
> **But the strongest argument is not the admin's either.** "Cursor but in Hindi" is a follower's
> framing — it competes on someone else's home turf. The compounding framing is better: **this is the
> next step for the user we ALREADY have.** Somebody who cannot code builds a shop app here; six months
> later it has real customers and they need to understand their own code. That is the same person,
> later. Today we lose them at exactly that moment.

### 9.0 · THE FINDING THAT CHANGES THE PLAN — the moat item was missing from §8 entirely

NavBharatAI's Indic-language work is genuinely strong: `IndicLanguage.ts` separates Marathi from Hindi
by real markers (ळ, आहे, नाही), catches romanized input ("mala ek dukanache app banvayche"), and is
deliberately timid because building someone's app in the wrong language is worse than building it in
English. `LanguageDetect.ts`, `narrationCatalogue.ts` and `AppRequirements.ts` carry the same care.

**All of it is about ONE thing: which language the GENERATED APP's UI is in.**

Nowhere does the platform do the other thing: **explain the user's own code, errors and concepts to
them in their language.** "Ye error kya keh raha hai?", "is function me kya ho raha hai?", "ye galat
kyun hai?" — none of that exists.

**That capability is the actual moat, and it was not on the §8 roadmap at all.** It is item 9.1, it is
the cheapest thing in this section, and it does not require the architecture decision below.

### 9.1 · 🟢 CODE LITERACY IN THE USER'S LANGUAGE — build this first, regardless of the fork

| # | Item | Notes |
|---|---|---|
| 9.1a | **"Explain this in my language"** on any file, error or diff | The engine already detects the user's language and already reads the code. This is a prompt + a surface, not new capability. Highest value-to-effort ratio in the entire audit. |
| 9.1b | **Errors explained, not just shown** | Every build error, runtime error and failed test gets a plain-language "what this means / what to change". Reuses the existing honest-error work. |
| 9.1c | **Hinglish register, not translated Hindi** | ⚠️ **The product risk in this whole section.** Developers say "variable", "function", "deploy" — nobody says "चर". Translating technical terms produces something patronising that a real developer closes immediately. The target register is Hinglish: English nouns, Hindi grammar. Needs a written style rule + tests, the same way the White-Label Law is enforced by a test. |
| 9.1d | Per-user language preference (not just per-request detection) | Detection is per-message today; a returning user should not have to re-signal. |
| 9.1e | Hindi/Hinglish code comments **on request only** | Default stays English per `CLAUDE.md`'s language standard — this is an explicit user opt-in for their OWN app, never for NavBharatAI's source. |

### 9.2 · 🔒 THE ARCHITECTURE FORK — the admin must choose before 9.3

**The real obstacle is not any feature. It is that Cursor runs on YOUR machine against YOUR repo, and
NavBharatAI is a browser talking to a cloud sandbox. A browser cannot read a local folder.** Three
honest options, and they are not combinable cheaply:

| Path | What it is | Cost | Honest read |
|---|---|---|---|
| **P1 · CLI** — `npx navbharatai` | A terminal client that talks to our engine, working on the user's real local repo | Medium build; new auth + transport surface | **The cheapest way to reach a real developer.** §8E called this a near-non-goal (item E9) — **that ranking was wrong if this section is the goal.** Also the natural home for 9.1. |
| **P2 · VS Code extension** | Lives where the developer already is | Larger; a second client to maintain forever | Highest adoption per user, highest ongoing cost. Do only after P1 proves demand. |
| **P3 · Stay in the browser** | Make the cloud IDE genuinely good (§8B + §8C + LSP) | Continuous | This is **Replit's** game, not Cursor's. Fine — but then stop calling it Cursor, because the comparison sets a bar we are not aiming at. |

**Recommendation: P1.** It is the only one that reaches someone with an existing codebase, it is the
smallest of the three, and it can carry 9.1 immediately. P3 items are worth doing anyway because §8B/§8C
serve BOTH audiences.

### 9.3 · 🔵 THE DEVELOPER SURFACE — re-ranked from §8E under this goal

These are the same items §8E deferred. Under the Cursor-for-India goal their ranking changes; the list
is unchanged so the two sections cannot drift.

| §8E ref | Item | Old verdict | New verdict under §9 |
|---|---|---|---|
| E9 | CLI / editor / CI surface | 🚫 near-non-goal | ✅ **P1 above — now the entry point** |
| E11 | LSP: go-to-definition, inline errors | 🟡 defer | ✅ Build — this is what "an editor" means to a developer. Biggest item here; scope to 2–3 languages first. |
| E4 | Custom commands / saved skills | 🟡 defer | ✅ Build — a developer's own repeated workflow is the retention hook. |
| E8 | MCP client | 🟡 defer | 🟡 Still defer, but for a NEW reason: it is how a developer plugs in their own tools, so it becomes right AFTER P1 has real users — not before. |
| E6 | Per-tool allow / deny | 🟡 defer | ✅ Build alongside P1. A CLI on a developer's real machine makes this safety-critical, not optional. |
| E5 | Hooks | 🟡 defer | 🟡 After E4. |
| E7 | User-defined sub-agents | 🟡 defer | 🟡 After E4. |
| E14 | Breakpoint debugger | 🚫 too large | 🚫 Unchanged. §8B's logs cover most of the real need. |
| E12, E13 | Multi-project, test watch | 🟡 defer | 🟡 Unchanged. |

### 9.4 · What I would still say no to, and why

**This does not replace §8A–§8C, and it must not be started before them.** Steering, a working shell,
runtime logs and a per-project instruction file serve BOTH audiences — the non-coder and the developer —
and every one of them is smaller than anything in §9.3. Starting here first would build a developer tool
on a foundation that still cannot be interrupted mid-build.

**The real cost is focus, and it should be accepted knowingly rather than discovered later.** An
app-builder for non-coders and a coding tool for coders are two products sharing one engine. Replit runs
both, so it is not fatal — but it doubles the surface that every future change has to be correct on.

### 9.5 · Sequencing

1. **9.1a + 9.1b + 9.1c** — code literacy in the user's language. Small, ships inside the existing
   product, needs no fork, and is the only genuinely un-copyable item in this document.
2. **Finish §8A–§8C.** Both audiences need them.
3. **Admin decides 9.2** (P1 / P2 / P3).
4. If P1: CLI + E6 (permissions) together, then 9.1 exposed through it.
5. Then E11 (LSP), then E4. Re-assess before E5/E7/E8.

**The measurable question that should govern step 3:** do users who built an app here come back asking
about their CODE? If yes, §9 is the graduation path and worth the focus cost. If they only ever ask for
more features in the app, it is not — and 9.1 alone was still worth building.

---

## 10 · 🔴 THE PUBLISH CEILING — every published app takes a Firebase channel (added 2026-08-21)

**Found while answering the admin's cost question, not from a failure.** Publishing works; it simply
does not scale, and the wall arrives sooner than anyone would guess.

### 10.1 · The ceiling, and the numbers behind it

Every published app becomes ONE Firebase Hosting **preview channel** on ONE site
(`gen-lang-client-0866594388`). Channels per site are capped — reports of "channel quota reached"
put it at roughly **50**, though I could NOT confirm that exact number in Google's published quota
page, so treat 50 as the working figure and verify before relying on it.

⚠️ **That cap is across ALL USERS, not per user.** Around the fiftieth published app on the platform,
the fifty-first publish fails for whoever happens to be next.

### 10.2 · The option that looks obvious and is WRONG

"Give every app its own site" (`deployToSite`, which already exists for custom domains) sounds like
the fix. It is not: Firebase documents a maximum of **36 sites per project** — a LOWER ceiling than
the one being escaped. Sites × channels (36 × ~50 ≈ 1,800) buys room at the price of a second axis to
manage, and still ends in a wall.

### 10.3 · The real answer: serve published apps from Cloud Storage, through the Worker we already run

The Cloudflare Worker is ALREADY the front door for every `*.mitrify.in` app. Point it at a Cloud
Storage bucket instead of Firebase Hosting and the ceiling disappears — object stores have no channel
concept and no per-site cap. It also removes Firebase's egress bill, which the Worker's edge cache
has already cut (2026-08-21).

Firebase Hosting stays exactly where it is genuinely better: `deployToSite` for a user's OWN custom
domain, where Firebase issues and renews the certificate for us. That is a handful of sites, nowhere
near 36.

**Sequencing (not started):**
1. Verify the real channel cap — publish into a scratch project until it refuses, or read it off the
   quota page if Google documents it. Guessing a number this load-bearing is not good enough.
2. Publish path writes the built files to the bucket under the channel-id key it already computes.
3. Worker serves from the bucket, falling back to Firebase for anything not yet migrated — so the
   switch is reversible and no existing link breaks.
4. Migrate existing channels lazily (on next publish), then reclaim them.

**Until it ships this is an OPEN root cause (rule 6), not a solved problem.** It is not urgent today —
the platform is far from 50 apps — but it must land before real users arrive, because the failure mode
is "publishing stops working for everybody" with no warning.

## How to use this file

1. **Re-grep before you start.** Every line here is a hint. Nine were wrong on 2026-08-07.
2. Root-cause fix + regression test + an `AppKnowledgeBase.ts` entry if it is user-facing.
3. Branch → verification gate → PR → CI green → merge. Merge is what deploys.
4. Append what shipped to `PROGRESS.md`, and **correct this file in the same PR** — that is the only
   thing that stops it drifting again.
5. **When the admin says they flipped a Cloud Run switch, update `CLAUDE.md`'s registry AND §0 here in
   that same session.** Added 2026-08-16, because this is the rule whose absence made §0 and §5 spend
   eight days instructing the admin to redo work they had already done. `CLAUDE.md` is the authority on
   what is set — Claude cannot see Cloud Run — and this file is only ever a mirror of it.

**The failure mode this document keeps having, stated plainly:** it goes stale in the direction of
*claiming work is still open*, and a session that trusts it rebuilds finished features. That has now
happened with a bucket provisioner (built twice, the duplicate deleted unmerged), an animation recipe, a
scaffold fallback, seven Cloud Run switches, and — the sharpest one — **the template gallery, which
carried the words "✅ VERIFIED GENUINELY OPEN" while being fully built and wired.** That entry failed
because its check read `TemplatesPanel.tsx`, a file with a similar name, instead of the module that
actually holds the feature. **Nothing here is evidence. The code and `CLAUDE.md` are evidence.**

**So the check that actually works, learned from the five misses:** grep for the DOMAIN NOUN across the
whole tree (`bucket`, `template`, `sketch`, `animation`), never for the file or feature name you expect —
every one of these was hiding in a module named something else. And confirm the feature is **rendered or
called**, not merely present: `starterSketch.ts` existing proves nothing; `AgentV3Panel.tsx` mounting
`<StarterSketch/>` is what proves it ships.
