# NavBharatAI — Model Routing & Cost Plan (admin-finalized 2026-07-11)

The single source of truth for **which AI model runs each surface**, how a free build stays 100%
Claude-free, and the order in which it ships. Finalized with the admin over 2026-07-10/11. Every part
lands **flag-gated + dormant** — nothing changes today's behavior until the admin flips the master
switch. Build slices wait for the bake-off; chat/vision slices do not.

---

## 0. The one rule that keeps builds from breaking

**Vertex/Gemini run ONLY where there is no agentic tool-loop — chat, vision, planning, utilities.
They NEVER lead the build tool-loop.** In this codebase Vertex/Gemini reliably hallucinate the build
loop (describe files, write ZERO) — a real, repeated incident. So:

- **Chat / vision / planning / aux text** → Vertex/Gemini are a great, near-free fit (GCP $300 credit).
- **Building an app** → Vertex is the ABSOLUTE last rung only, behind two safety nets (empty-build
  retry + readiness gate) so a 0-file "build" can never ship as success.

The GCP $300 credit is therefore spent where Vertex/Gemini are strong and safe, and kept out of the
one place they break things.

---

## 1. Routing table — which model runs each surface

| # | Surface | Engine ladder (in order) | Claude? | NavBharatAI cost |
|---|---------|--------------------------|---------|------------------|
| 1 | **Free Chat** (casual) | GLM-4.7-Flash (free) → GLM-4.7 → Vertex → Gemini | ❌ | ~₹0 |
| 2 | **Professional** (Doctor/Legal/etc.) | *unchanged for now* (GLM-first → Vertex → Gemini → Grok). Upgrade to a stronger provider WHEN Professional becomes paid. | last-resort only | ~₹0 |
| 3 | **Vision** (any image) | GLM-4.6V-Flash (free) → Vertex/Gemini ($300 credit) → Claude vision (last) | last-resort | ~₹0 |
| 4 | **Pro v3.0 — free build** (before payment) | GLM-4.7-Flash (free) → GLM-4.7 → Kimi → GLM-5.2 / Kimi-2.7 flagship → **Vertex (last)** | ❌ → upsell | mostly ₹0 |
| 5 | **Pro v3.0 — paid build** | **GLM-5.2 (flagship)** → Kimi → **Sonnet** (escalate on gate-fail OR judge finding a mistake) | ✅ Sonnet | cheap (~6× under Claude) |
| 6 | **Pro v3.0 — power mode (Only Opus)** | Opus 4.8 — **paid users only; non-paying = blocked** with an honest "power mode is for paid accounts" | ✅ Opus | paid |
| 7 | **Build aux** (planning, second-opinion, consensus, utilities) | Vertex/Gemini/Grok ($300 credit) | ❌ | ~₹0 |
| — | **Pro Chat** | **REMOVED** from the UI (see §5) | — | — |

Free-model notes (from Z.AI official pricing, 2026-07-11): **GLM-4.7-Flash** and **GLM-4.6V-Flash**
are fully free (input AND output). Paid coder `GLM-4.7` = $0.6/$2.2 per 1M; flagship `GLM-5.2` =
$1.4/$4.4. Free tiers carry rate limits → the paid `GLM-4.7` rung absorbs a 429 so the app never
dead-ends; and because a provider can change a free tier anytime, the paid rung is a permanent safety
fallback.

---

## 2. How ONE build stays 100% Claude-free for a free user

A single v3.0 build touches a provider in 7 places. A single **`freeTierBuild`** signal flows through
the whole build and every one of them respects it — so no component can leak a Claude token:

| Build component | Normal user | Free user | Status |
|-----------------|-------------|-----------|--------|
| Main engine (architect) | Claude-first / GLM floor | GLM-4.7-Flash → GLM-4.7 → Kimi (**cheap-only, no Claude**) | ✅ built (PR #1185) |
| Sub-agents (frontend/backend) | share the main client | same GLM client (automatic) | ✅ built |
| Planning / blueprint | Grok (cheap) | Grok (cheap, non-Claude) | ✅ already |
| Judge / test (review) | Grok **or Sonnet** | **Grok only** (never Sonnet); escalation off ⇒ judge-repair skipped | ⬜ to add |
| Vision (image) | GLM / Gemini | **GLM-4.6V-Flash (free)** | ⬜ to add |
| Second-opinion / consensus | free router (Vertex/Gemini/Grok) | same (non-Claude) | ✅ already |
| Escalation | GLM → Sonnet | **DISABLED** → upsell instead | ✅ built |
| Haiku backstop | present | **removed** (cheap-only chain) | ✅ built |

~60% is already live in the free-tier routing (PR #1185). The remaining two — **judge = Grok-only**
and **vision = GLM-4.6V-Flash** for free builds — land in slice D.

If the whole free ladder cannot deliver, the build is **not** shipped broken and is **not** rescued on
Claude — the user is invited to *"add credits and finish on the best engine"* (converts to paid).

---

## 3. Master flag (fewer switches = fewer config errors)

Instead of juggling 6 scattered flags (which already caused a real `AGENTV3_CHEAP_FLOOR=glm` vs `=on`
conflict), the cheap-routing regime is turned on by ONE master:

- **`AGENTV3_COST_ROUTING`** = `off` (default — today's exact behavior) | `on` (enables the whole
  regime: free-tier cheap builds, chat/vision on GLM-Flash, per-tier billing awareness).
- **`AGENTV3_COST_ROUTING_USERS`** = optional canary allowlist (uid/email). Empty = everyone; set to
  the 3 test accounts to trial before a full rollout (see §4).

Kept SEPARATE on purpose (different concerns, not folded into the master):
- `AGENTV3_CHEAP_FLOOR` — *which* cheap model (glm | kimi | on). Still picks the provider.
- `AGENTV3_PAID_PUBLIC` / `AGENTV3_CREDIT_GATE` — billing/charging gates (money, not routing).

So the admin manages ~4 clear switches, not 6+ overlapping ones. The old per-feature flags
(`AGENTV3_FREE_TIER_CHEAP`, `AGENTV3_PER_TIER_BILLING`) become sub-behaviors of the master.

---

## 4. Rollout — canary first, then widen

1. Set `AGENTV3_COST_ROUTING=on` + `AGENTV3_COST_ROUTING_USERS=<3 test emails>` → the regime runs for
   the test accounts only.
2. Watch the admin **usage-report** + **cost-telemetry** (already built, Billing Phase 3): per-provider
   tokens, gate-pass rate, delivered-via split, real margin. This is the live bake-off.
3. If GLM/Kimi produce real files and the gate-pass holds → clear `AGENTV3_COST_ROUTING_USERS` (widen
   to all). If a cheap model produces 0 files / gate-pass drops → keep it narrow or off (the paid
   fallback + escalation mean nothing breaks meanwhile).

The isolated `npm run bakeoff` script stays a useful fast pre-check; the canary is the real-world proof.
The bake-off must confirm BOTH GLM tiers that lead builds: **GLM-4.7(-Flash)** (free) and **GLM-5.2**
(paid).

---

## 5. Pro Chat removal

Pro Chat is an active UI surface (`ProChatPanel.tsx`) + a footer entry + a History "Pro" filter + the
backend `'pro'` router (Opus→Sonnet). Remove it safely, in order:
1. **UI first** — drop the footer/nav entry + History filter (100% safe; it just disappears from reach).
2. **Backend delete** — remove `ProChatPanel.tsx`, the `'pro'` route, and the `'pro'` router **only
   after** a dependency check proves nothing else imports them. If anything does, stop at UI-hide.
3. Gate: `tsc` + `vitest` + boot green before it ships (rule 1 — never break the app).

---

## 6. Build sequence (each slice: flag-gated, dormant, own PR, CI-green merge)

| Slice | What | Master/flag | Live when |
|-------|------|-------------|-----------|
| **A** | Welcome bonus 1,000 → **50,000** tokens | — | anytime |
| **B** | Free Chat → GLM-4.7-Flash lead (+ Vertex/Gemini) | COST_ROUTING | **early** (chat, no bake-off) |
| **C** | Vision → GLM-4.6V-Flash lead (+ Vertex) | COST_ROUTING | **early** |
| **D** | Pro v3.0 free-build ladder + judge=Grok-only + vision=GLM-Flash (no Claude, upsell) | COST_ROUTING | **after bake-off/canary** |
| **E** | Pro v3.0 paid → GLM-5.2 lead + Sonnet escalate | COST_ROUTING | **after bake-off/canary** |
| **F** | Power mode → paid-only block | — | anytime |
| **G** | Master flag consolidation (`AGENTV3_COST_ROUTING` + `_USERS`) | — | with B (foundation) |
| **H** | Pro Chat removal (UI → delete-if-safe) | — | anytime |

Chat/vision/power/Pro-Chat-removal (**B, C, F, H**) ship early — no tool-loop risk. The build slices
(**D, E**) wait for the bake-off/canary to prove GLM/Kimi drive the loop.

---

## 7. Why this never breaks (safety, restated)

- Every ladder has a reliable fallback (free → paid GLM → Sonnet → upsell) — no dead-ends.
- Vertex sits last in builds, behind the empty-build retry + readiness gate — a 0-file build can't ship.
- Everything is behind the master flag — `AGENTV3_COST_ROUTING=off` restores today's exact behavior
  instantly (no redeploy).

## 8. Open / future (honest)

- **Professional quality** is deliberately left on the cheap routing for now; upgrade to a stronger
  provider WHEN Professional becomes a paid tier (admin decision 2026-07-11).
- **Real GLM/Kimi rate cards** (exact per-provider cost) replace the Sonnet-equivalent baseline in the
  admin margin report when wired — until then the report is an honest upper bound.
- **Free-tier rate limits** — confirm Z.AI's free req/day; the paid `GLM-4.7` rung absorbs limits.
