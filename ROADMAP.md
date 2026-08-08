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

Nothing to build. These are finished, tested, merged features sitting behind a default-OFF flag. Of the
217 flags in the server, 21 are opt-in; the admin has already turned on four (`LINT_GATE`,
`INTEGRITY_GATE`, `REQUIREMENT_AWARE`, `REVIEW_AUTOFIX_WARNINGS`). These are the rest.

| Flag | What turning it on gives you | Note |
|---|---|---|
| **`AI_WALLET_SPEND`** | The whole one-wallet law — every assistant and tool draws the SAME balance a build does. The admin's own 2026-08-01 mandate. | ⚠️ Wait for the 2026-08-07 markup fix to reach production first — see §5. |
| **`AGENTV3_PARALLEL_BUILD`** | Frontend and backend built at the same time (#1790). | Roadmap always said "flip it and measure". Measure on the admin account first. |
| `AGENTV3_STREAMING_PREVIEW` | Preview appears while the build is still running. | User-visible speed. |
| `AGENTV3_REVIEW_FASTLANE` | Faster reviewer pass. | |
| `AGENTV3_DEPHEALTH_GATE` | Dependency-health gate on a finished build. | |
| `AGENTV3_PRETTIER_GATE` | Formatting gate. | Cosmetic; lowest value. |
| `AGENTV3_OBSERVABILITY_INJECT` | Auto-inject error handler + request logger + `/health` into built apps. | |
| `AGENTV3_REDTEAM` | Adversarial self-review pass. | Costs an extra LLM pass. |
| `AGENTV3_WEAK_CHECKPOINT` | Mid-build checkpoints on the weak tier. | |
| `AGENTV3_VACCINE_PCT`, `AGENTV3_FEATURE_HEAL_PCT` | Both sit at 0 = off. | Percentages, not on/off. |
| `AGENTV3_CACHE_PREFIX` | Prompt-cache stable prefix. | Benefit unmeasurable without provider cache telemetry — leave off. |
| `AGENTV3_INLINE_BABEL` | | Verify what it does before touching. |
| `AGENTV3_ASK_USER` | The clarify card. | 👤 The admin declined this deliberately — friction vs zero-UI. Not a task. |

**Claude's job here:** before recommending any of these ON, audit it the way `AI_WALLET_SPEND` was
audited on 2026-08-07 — that audit found a real overcharge bug that had never run. A flag that has never
been on has never been tested by reality.

---

## 1 · 🟢 THE SIX THAT MATTER MOST

Ordered by what a user would actually feel.

1. **React Native / Expo — real native mobile apps.** The single biggest capability gap against Bolt.
   Today's Capacitor wrapper ships a webview, which is not the same product. 🔵 Large.
2. **Sandbox → production database migration.** The dev sandbox's Postgres dies when the app is
   published, so a user's LIVE app still needs them to create a durable database by hand. Everything
   before this step (provisioning, connecting, Studio) is built — this is the last gap in the chain.
3. **Zero-setup auth.** One click, no keys: signup / login / session / reset on top of the database we
   already provision. Replit's headline feature.
4. **AWS / Azure / Railway deploy providers.** Render shipped (and its UI was wired 2026-08-07). Three
   more provider modules, same shape as `renderDeploy.ts`.
5. **Visual template gallery.** Sixteen starters exist but as *text only*. Screenshots + categories +
   "build this" kills cold-start and drops weak-tier cost toward zero.
6. **Regional languages** — Tamil, Telugu, Bangla, Marathi, Gujarati, Kannada. The one ❌ in the India
   section, and the India-first moat is the whole differentiator against Lovable/Bolt/v0.

---

## 2 · 🟢 SMALLER, VERIFIED-MISSING (each checked against live code 2026-08-07)

- **Animation / motion recipe** — no `generate_animation`; micro-interactions are what make an app feel alive.
- **MCP support** — nothing imports `@modelcontextprotocol`.
- **Component tree panel** and **multi-element select** in the editor.
- **Per-version preview URL** — v0 has it.
- **One-click object storage provisioning** — Replit has it.
- **Service-split generator** + named paradigms (Clean/DDD/MVC/Hexagonal). Coupling is already *scored*;
  nothing turns that score into a split.
- **Design-to-code intermediate contract** (AP-8) — the vision pipeline exists; the
  image → layout-contract → build step does not.
- **Template-free scaffold fallback** — no such module found; verify before building.
- **Community gallery / remix** — both Lovable and v0 have it.
- **Scaling / load estimates with real numbers** — today's critique is qualitative only.
- **Upload virus-scanning for the apps we generate** — the Nav App Store has it; generated apps do not.
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
| **AP-7 Edit mode** | works | 80% of user time is *after* the first build; make edits as smart as builds |
| **AP-9 Requirement coverage** | works | false positives ("login not found" when it was) |
| **GA-5 / GA-6 / GA-7 / GA-8 / GA-10 / GA-12 / GA-13 / GA-14 / GA-15** | main engine in each | narrow tails; **verify each against live code before starting** — several neighbours in this list turned out to be finished |

---

## 5 · 👤 WHAT ONLY THE ADMIN CAN DO

Claude cannot reach any of these. Ordered by urgency.

1. **Do NOT switch `AI_WALLET_SPEND` on yet.** The 2026-08-07 audit found the tiered markup was being
   applied per model-call instead of once per request, which **overcharged** users on any multi-call
   action (worst on the App Debugger). Fixed, tested, and heading to production. Turn the flag on only
   after that deploy is live — otherwise the first version real users meet is the one that overcharges.
2. **VirusTotal licensing** — the free API is, by their terms, not for commercial products, and
   NavBharatAI is one. Fine for testing; needs a paid plan or another scanner (MetaDefender) before the
   Nav App Store carries real traffic.
3. **Widen the cost-routing canary** — `AGENTV3_COST_ROUTING_USERS` is still scoped to one account.
   Clear it once the `deliveredVia` telemetry looks right.
4. **Define the spend quota** so the daily gauge in §2 can be built.
5. **E2B template rebuild** — the fullstack image ships Node/Python/Java/Go only. Rust, Ruby, PHP and
   C/C++ frameworks cannot be offered until the multi-GB template is rebuilt and republished; adding the
   registry entries first would create build options the sandbox cannot run (a fake feature, rule 2).
6. **A GitHub Actions look** — CI produced no run at all for 8.5 hours on 2026-08-06/07. It recovered on
   a PR close/reopen, so it was a dropped webhook rather than a spending limit, but it is worth a glance
   at the Actions billing page.

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
