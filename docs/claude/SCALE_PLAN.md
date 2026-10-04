# Scale plan for millions of users — DO NOT BUILD NOW

> Moved verbatim out of `CLAUDE.md` on 2026-10-04 (admin: *"han"* to shrinking it — the file was 563 KB and was loaded into every message of every session). Read it only when one of its written triggers has fired. Nothing here was reworded; the rules in it are as binding as they were in `CLAUDE.md`. `CLAUDE.md` keeps a short summary and a pointer to this file.

## 🕓 SCALE PLAN — for MILLIONS of users. ⛔ **DO NOT BUILD ANY OF THIS NOW** (admin-mandated 2026-08-23)

**Read this whole heading before touching anything below it.** The admin asked, on 2026-08-23, what
happens when millions of users arrive and the server slows down or hangs — and asked for the plan to be
**written down and deliberately postponed** until NavBharatAI has the revenue to pay for it. So this is a
**map for later**, not a task list. Every item here costs real money every month, forever, whether or not
anyone is using the platform.

**The rule for any future session: do not start a single item in this section on your own initiative.**
Each one has a written TRIGGER — a real, observable condition. If the trigger has not fired, the correct
action is to do nothing and say so. Building capacity nobody needs yet is how a small product acquires a
big product's bills.

### The honest starting point: Cloud Run already scales, so "the server hangs" is NOT what breaks first

This matters, because the intuitive fear points at the wrong thing. Cloud Run **already** starts more
instances under load — that half is solved and costs nothing to keep. What does not scale is everything
that assumes there is only ONE of us. Those are listed below **in the order they will actually bite**,
which is not the order they look scary.

### 1 · 🔴 Firestore hot documents — the first thing that will break, and partly our own doing

Firestore allows roughly **one sustained write per second to a single document**. Past that, writes queue
and then fail with contention errors. Anywhere the platform writes ONE document on behalf of ALL users is
a wall with a specific, low number on it.

**We built one of these on 2026-08-23 and it should be named honestly here rather than discovered later:**
`metricsTimeline` writes every instance's counters into ONE document per 5-minute bucket. At today's
traffic that is a few writes a minute and completely fine — the flush is batched to once per minute per
instance, which is exactly what keeps it under the limit. But at **60+ concurrent instances** the same
design becomes a contention point, and the failure would be silent: the flush swallows its error and
retries, so the Monitor would quietly under-count instead of breaking.

Same shape, same risk, for `monitor_alert_state` (one document, transactional) — lower volume, so it bites
much later.

**The fix when the trigger fires (sharded counters):** write to `bucket_<t>_shard_<0..N>` chosen at random
per instance, and SUM the shards on read. This is the standard Firestore answer, needs no new
infrastructure and no monthly cost — which is why it is the *first* thing to do here and not a
"when we have money" item at all.

**TRIGGER:** sustained concurrent instances above ~30, OR any Firestore contention error in the logs.

### 2 · 🟡 Per-instance memory that pretends to be global

✅ **THE BUILD LOCK HALF OF THIS TRIGGER FIRED AND IS BUILT (autopsy eed79815, 2026-09-26) — without
Redis.** A user's retry after a dropped connection reached another Cloud Run instance, which knew
nothing of the running build and started a second one in the same workspace, then a third: fourteen
minutes of two builds overwriting each other's files and running npm into one `node_modules` at once.
The fix is a **Firestore lease per workspace** (`AgentV3/workspaceBuildLease.ts`, the `jobLease.ts`
pattern): claimed in a transaction before the stream opens, renewed every 20 s, released when the build
ends, stale after 90 s, and **fail-open** on a store error. A Stop pressed on any instance reaches the
build through the lease. Kill switch **`AGENTV3_WORKSPACE_LEASE=off`** (NOT set; default ON). The
table below is otherwise unchanged — rate limiters and the other rows are still per-instance.
🔴 **AND A STOP FREES THE APP ONLY WHEN THE BUILD HAS LEFT (autopsy 1219c639, 2026-10-01) — the same-instance
half #3331 never hunted.** `/stop` used to free the memory lock and the lease the instant it was pressed; the stopped
build was inside a ten-minute key wait that ignored Stop, so a "Continue building" started a second build beside it,
and the first woke later and ran `npm install` into the second's app. Now every wait for the user goes through the
route's `waitForUser` (signal-aware `awaitApprovalOutcome` — never call `awaitApproval` bare in the route; a test
counts), no tool runs after Stop, and `stopRegisteredBuild` keeps the key and lease until the build's `finally`
(`markBuildExited`). A new build in that workspace waits ≤ 15 s, then is refused with `BUILD_STILL_STOPPING`, and only a
body stuck ≥ 3 min is reclaimed (`stoppingBuild.ts`). Cleanup releases only the key it owns (`releaseBuildLock`). No env key.

Several things live in one instance's RAM and are therefore wrong the moment there are several:

| What | Today's consequence | Why it is survivable now |
|---|---|---|
| `MetricsRegistry` (since-boot totals) | each instance reports its own | the Monitor's timeline is Firestore-backed and correct; the registry is labelled "since this server started" |
| `E2BActuator._activeBuilds` | the idle reaper only sees its own instance's builds | the reaper reads the DURABLE record for the cross-instance decision |
| Rate limiters | a user gets N requests **per instance**, not overall | the real spend gate is the wallet, which is in Firestore |
| `serverLoad` | one instance's CPU/memory | the panel says so, in words, on the panel |

**This is the "unified memory" the admin asked about.** The real answer is a **shared cache/state layer
(Redis / Cloud Memorystore)** so every instance reads one truth.

⚠️ **Redis was EXPLICITLY DECLINED by the admin previously** (`ROADMAP.md` §5 lists it under "explicitly
declined: Redis / Terraform / Cloud Armor / SIEM"). This entry does **not** reopen that decision. It
records what would change if it were ever revisited, and the honest cost: Memorystore's smallest instance
is a standing **monthly** bill regardless of traffic, plus a new dependency that can itself fail and take
the platform with it — a single point of failure where today there is none.

**TRIGGER:** a real user-visible problem caused by per-instance state — most likely a rate limiter that
lets through N× the intended traffic, or duplicated work across instances. **Not before.**

### 3 · 🟡 The publish ceiling — already known, already has a plan

Every published app takes one Firebase Hosting channel, and channels are finite per site. `ROADMAP.md`
§10.3 holds the full plan (serve published apps from Cloud Storage through the Cloudflare Worker we
already run). **This one has a real trigger that may fire long before "millions":** the admin's Publish
Capacity panel reaching *warn*. It is in this section only so the scale picture is complete — its plan
lives in the roadmap, not here.

### 4 · 🟢 E2B sandbox concurrency — a COST wall, not a server wall

Builds do not run on our server; they run on E2B VMs. So a flood of builds does not hang Cloud Run — it
produces a bill and, past the account's concurrency limit, a queue. The idle reaper and the 5-minute idle
default are what keep this bounded, and they already work.

**TRIGGER:** users waiting in a build queue, or the E2B bill rising faster than revenue. The response is
commercial (a bigger plan, a warm pool) rather than architectural.

### 5 · 🟢 Provider rate limits — already handled, do not rebuild

The 429-storm path already has a proactive pacer, adaptive concurrency, a circuit breaker, key-pool
rotation and a graduated model ladder. At scale this needs more KEYS, not more code.

### What "strong servers + multiple servers" would actually mean, in order

1. **Shard the hot Firestore documents** (free, no new infrastructure) ← the only item here worth doing early
2. **Raise Cloud Run's max instances and set min-instances above 0** (a settings change; min-instances costs money continuously, and buys away cold starts)
3. **Move the per-instance state that genuinely needs to be shared** into a shared layer — and only the parts that need it, not everything
4. **Split the workload** so a slow build path cannot starve fast chat requests (separate Cloud Run services, one image, different concurrency settings)
5. **A read replica / caching layer for Firestore reads**, if reads rather than writes become the wall

Steps 1 and 2 are cheap and reversible. Steps 3–5 are the ones that cost money every month, and the
honest advice is that **NavBharatAI does not need them until users are actually waiting.**

### The measurement that decides all of it — and it already exists

The Monitor's **Server load** panel (waiting time, CPU, memory against the container's real limit,
requests in flight) is what tells the admin any of these triggers has fired. **The correct posture until
one does is to watch that panel and build nothing.** A session that proposes work from this section
without naming which trigger fired is proposing a bill, not an improvement.
