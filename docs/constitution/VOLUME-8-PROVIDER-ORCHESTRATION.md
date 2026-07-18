# NavBharatAI Build Engine — Constitution

## Volume 8 — Provider Orchestration Constitution

> **Status:** Binding law for how NavBharatAI selects, coordinates, evaluates, and
> manages AI providers. Inherits Volumes 0–7; may never contradict them.
> **Provider-neutral, present- and future-proof**, and **descriptive-first, code-anchored**
> with honest `[LIVE]`/`[ASPIRATIONAL]` tags. Most of this volume is `[LIVE]` — the
> provider fabric (Vol 3 §19) and the Provider Laws (Vol 1 Ch 13, PROV-01…15) already
> implement it; this volume binds them and adds the timeless orchestration principles.
>
> **Two honest reconciliations (external-suggestion rule).**
> 1. **"No single-provider dependency / no lock-in"** vs the engine's **permanent
>    backstop** (PROV-03) and the admin-confirmed **Model Routing Policy**. Resolution:
>    the *architecture* is provider-neutral by construction (any provider is a
>    swappable `NamedRunner` behind config/env; §19), so there is **no architectural
>    lock-in**. The chains *name* specific providers today only as **configuration**
>    (the Model Routing Policy), changeable without touching the architecture. The
>    permanent backstop is a deliberate **reliability guarantee** (never-break), not a
>    dependency to eliminate. Provider-neutrality is a property of the *architecture*,
>    not a ban on *choosing* providers.
> 2. **"Transparent provider reasoning"** vs the **White-Label Law** (PROV-01: the user
>    never sees a provider). Resolution: provider reasoning is **transparent to the
>    ADMIN** (diagnostics, `deliveredVia`, telemetry) and **opaque to the USER** (to
>    them it is always "NavBharatAI"). Transparency is owed to operations, never to the
>    end user.

---

# Part I — Core Philosophy

> **No provider is universally best. Every provider has different strengths, costs,
> latency, and reliability. Provider selection is evidence-driven, cost-proportional,
> and reliability-guaranteed — and never spends a larger/pricier model unless the task
> justifies it.**

This is Vol 0 §26 (Least-Power) + §28 (Economic responsibility) + §7 (Reliability)
applied to model choice: pick the **weakest sufficient** provider for the task, escalate
**up a quality ladder only on failure** (never a horizontal per-file relay — PLAN-02),
and keep a permanent backstop so no provider's failure ever breaks a build.

**The one orchestration invariant (binding):** *cheap-and-capable leads; stronger
follows only on proven failure; a guaranteed backstop always answers; the user only ever
sees NavBharatAI.*

---

# Part II — The 20 Chapters

*Compact: purpose · what is real today · anchor + law · status.*

### C1 — Provider Abstraction Philosophy · [LIVE]
"Run a model turn" is one call; fallback, benching, attribution, and anonymization are
invisible to everything above. Any provider is a swappable runner. *Anchor:*
`MultiProviderTurnRunner`, Vol 3 §19. *Laws:* PROV-01, ARCH-13.

### C2 — Capability-Based Provider Selection · [LIVE]
Which model runs where is chosen by capability + tier per the Model Routing Policy
(cheap coders lead, flagship/Claude for harder/power) — capability before popularity.
*Anchor:* Model Routing Policy. *Laws:* PROV-04/05/06.

### C3 — Task Classification · [LIVE]
The request is classified (intent, complexity, task type) — the input to routing.
*Anchor:* `RequestAnalyser`. *Laws:* PLAN-01.

### C4 — Complexity-Based Routing · [LIVE]
Tier + budget scale with complexity (Vol 5 Planning Budget); a simple task never draws a
power model. *Anchor:* complexity score → tier. *Laws:* PLAN-05, PROV-06.

### C5 — Cost-Aware Routing · [LIVE]
The cheap floor leads every build; stronger/pricier models run only on failure; the
cost-routing regime is master-switched + canary-scoped. *Anchor:* cheap-floor + escalation
+ `AGENTV3_COST_ROUTING`. *Laws:* PROV-05/07/12, §28.

### C6 — Latency-Aware Routing · [LIVE]/[ASPIRATIONAL]
Timeouts bound every call; a saturated (slow) provider is benched so latency does not
compound. Formal latency-optimising routing (prefer the fastest capable provider) is
`[ASPIRATIONAL]`. *Anchor:* per-turn timeout + cooldowns. *Laws:* ARCH-08, PERF-03/04.

### C7 — Reliability-Aware Routing · [LIVE]
When correctness is critical, reliability beats speed: the fallback chain + a permanent
backstop guarantee an answer. *Anchor:* fallback chain + backstop. *Laws:* PROV-03,
REL-06/10.

### C8 — Context Window Strategy · [LIVE]
The payload sent to a model is bounded (recent verbatim, old large results trimmed; the
full record untouched); a prompt too large for the whole fleet aborts honestly rather
than replaying a doomed request. *Anchor:* prompt diet + compaction + hopeless-oversize
abort. *Laws:* PERF-05, ARCH-08.

### C9 — Parallel Execution Strategy · [LIVE]
Independent work runs concurrency-capped in parallel; mutating/dependent work runs
serially first ("find in parallel, fix serially"). *Anchor:* dispatch scheduler. *Laws:*
PERF-08.

### C10 — Consensus Strategy · [ASPIRATIONAL]
Multiple providers voting on a critical answer (consensus/adversarial verification). Not
in the build engine today — the judge is a single independent reviewer (VERIFY-02). A
consensus mode for mission-critical decisions is a target. *Laws:* VERIFY-02.

### C11 — Tie-Breaking Rules · [LIVE]
When two routes are viable, break the tie by the Decision Hierarchy (never-break > truth
> real > … > cost > speed) and the routing policy. *Anchor:* Decision Hierarchy + policy.
*Laws:* Vol 0 §39, PROV-04.

### C12 — Provider Health Monitoring · [LIVE]
Health is tracked live: consecutive-failure streaks, per-key vs pool saturation, and
`deliveredVia`/failure telemetry (admin-only). *Anchor:* cooldown registry +
diagnostics. *Laws:* PROV-13/14, LOG-05.

### C13 — Retry Policy · [LIVE]
Transient failures fall through the chain; a **deterministic** failure (fatal auth, a
hopeless oversize) is **never** blindly retried; a documented tool failure self-heals
once. *Anchor:* fall-through + fatal-dead-for-run. *Laws:* PERF-02, RECOV-08.

### C14 — Circuit Breaker Policy · [LIVE]
A provider that fails repeatedly is **opened** (benched) rather than hammered; after a
cooldown it is probed again (half-open) and closed on success. This is a real circuit
breaker. *Anchor:* consecutive-strike bench + cooldown auto-expiry. *Laws:* PERF-03,
RECOV-06.

### C15 — Cooldown Strategy · [LIVE]
Saturation benches a provider for a bounded, self-expiring cooldown: **per-key** for a
quota limit (rotate to a sibling key), **pool-wide** for a service-level failure (bench
every key). Soft — a recovered provider returns automatically. *Anchor:* shared +
`pool:<provider>` cooldowns. *Laws:* PROV-14, PERF-03/04.

### C16 — Failure Escalation · [LIVE]
Insufficient quality escalates **vertically** — a stronger model retries the *same
coherent build* — never a horizontal vendor-per-file relay. *Anchor:* escalation
orchestrator + routing. *Laws:* PLAN-02, PROV-05.

### C17 — Fallback Strategy · [LIVE]
The chain tries cheap→…→backstop; the permanent backstop (weak tier: Haiku-only) always
answers, so no provider's failure breaks a build; the user only ever sees NavBharatAI.
*Anchor:* provider chain + forced-model backstop. *Laws:* PROV-03/05, TRUST-08.

### C18 — Model Benchmark Governance · [LIVE]/[ASPIRATIONAL]
A new model is adopted **deliberately** — a code-default bump after a bake-off proves it
drives the tool loop (0 files = disqualified) — never blind auto-latest. Continuous
automated benchmarking is `[ASPIRATIONAL]`. *Anchor:* bake-off discipline + Decision A.
*Laws:* PROV-10/11.

### C19 — Continuous Provider Evaluation · [LIVE]/[ASPIRATIONAL]
`deliveredVia` + per-provider token/failure telemetry measure real behavior per build; a
formal continuous-evaluation loop that re-ranks providers automatically is
`[ASPIRATIONAL]`. *Anchor:* cost + delivery telemetry. *Laws:* PROV-13, REL-13.

### C20 — Future Provider Integration · [LIVE]
A new provider enters as an additive `NamedRunner` behind env/config — no architecture
change, byte-for-byte identical when its flag is off. This is what keeps the fabric valid
even if today's providers vanish. *Anchor:* additive NamedRunner + `AGENTV3_*` config.
*Laws:* ARCH-05/06, PROV-09.

---

# Part III — Constitutional Laws

| Guarantee | Law |
|---|---|
| Provider-neutral architecture | C1/C20 — swappable runners behind config; §19 |
| Capability before popularity | PROV-04, C2 |
| Reliability before speed when correctness is critical | PROV-03, C7, Decision Hierarchy |
| Speed before depth when appropriate | Least-Power, C4/C6 (cheap-and-fast leads) |
| Cost proportional to task complexity | PLAN-05, PROV-06, §28, C4/C5 |
| Automatic degradation handling | PROV-14, PERF-03/04, C14/C15 |
| No infinite retry loops | PERF-02, ARCH-08, C13 |
| No provider lock-in | C1/C20 (architecture-neutral; policy is config) |
| Evidence-based provider selection | PROV-10/13, C18/C19 (bake-off + telemetry) |
| Transparent provider reasoning | admin-only (LOG-05, PROV-01) — never user-facing |

---

# Part IV — Failure Prevention (mapped to mechanisms)

| Failure | Prevention | Status |
|---|---|---|
| **Infinite retries** | deterministic failures never blindly retried; every loop bounded | `[LIVE]` (PERF-02, ARCH-08) |
| **Provider thrashing** | consecutive-strike bench + cooldown (circuit breaker) | `[LIVE]` (PROV-14, C14/C15) |
| **Cascading failures** | layered failure isolation — a provider fault is absorbed by the chain, never cascaded | `[LIVE]` (ARCH-10, REL-06) |
| **Cost explosions** | cheap floor leads; tier/budget cap; bounded prompts; one bounded repair pass | `[LIVE]` (§28, PERF-05) |
| **Low-quality model selection** | bake-off gate (0 files = disqualified); capability-based routing | `[LIVE]` (PROV-11) |
| **Single-provider dependency** | multi-provider chain + swappable runners (architecture-neutral; backstop is a reliability guarantee, not lock-in) | `[LIVE]` (C1/C20) |
| **Silent provider degradation** | health monitoring + `deliveredVia`/failure telemetry (admin) | `[LIVE]` (C12) |
| **Context truncation** | bound the model payload but never lose the full record; abort a fleet-hopeless prompt | `[LIVE]` (PERF-05) |
| **Incorrect fallback decisions** | truthful attribution (the model that actually answered) + per-key-vs-pool classification | `[LIVE]` (PROV-13/14) |

---

# Part V — Complexity Gating (reuses the Planning Budget + power tiers)

Orchestration depth scales with the task, using the existing objective signals — not a
new taxonomy:

| Task | Orchestration |
|---|---|
| **Small** (P-Light) | lightweight — the cheap floor + backstop; no escalation unless the gate fails `[LIVE]` |
| **Medium** (P-Moderate) | balanced — cheap floor → escalate on gate failure `[LIVE]` |
| **Large** (P-Deep) | deeper reasoning + same-workspace sub-agents; vertical escalation to a stronger model `[LIVE]`; multi-provider consensus `[ASPIRATIONAL]` |
| **Mission-critical / Power tier** | strongest model + independent verification before approval (the readiness/QA gates, VERIFY-02) `[LIVE]`; consensus voting `[ASPIRATIONAL]` |

**Binding rule (Least-Power, PLAN-06):** never use a larger or pricier model than the
task justifies. Escalation is *earned* by a failed gate, never applied by default.

---

# Closing

NavBharatAI orchestrates providers by evidence, not habit: the cheapest capable model
leads, a stronger one follows only on proven failure, a guaranteed backstop always
answers, saturated providers are benched and auto-recovered by a real circuit breaker,
and cost scales with the task. The architecture is provider-neutral — every model is a
swappable runner behind config — so the Constitution stays valid even if every provider
alive today is replaced tomorrow. To the user it is always, only, **NavBharatAI**; to the
admin the full provider reasoning is transparent.

Where a capability is `[ASPIRATIONAL]` (latency-optimising routing, multi-provider
consensus, continuous automated benchmarking/re-ranking), it is named honestly as a
target, and its absence is compensated by the existing chain + gates until it is `[LIVE]`.
The engine never claims an orchestration guarantee it has not built.

When a provider decision is unclear, resolve by the one invariant — cheap-capable leads,
stronger follows on failure, a backstop always answers; when a cost or reliability
trade-off is genuinely consequential, the Model Routing Policy (admin-confirmed) governs;
and in every tie, the Prime Law decides — **truth is the product, trust is the treasure.**

---

*Volume 8 of the NavBharatAI Build Engine Constitution. Provider-neutral and
future-proof; descriptive-first and code-anchored where marked `[LIVE]`; inherits Volumes
0–7; amendments follow the engine's own discipline (branch → PR → CI green → merge).*
