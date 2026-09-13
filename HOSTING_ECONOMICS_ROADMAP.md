# Hosting economics — the plan, the numbers, and the work

**Decided with the admin on 2026-09-13.** This file is the single place that records *what the
hosting plans are*, *what they cost us*, and *what must be built before they are sold to anyone*.

---

## ⚠️ READ THIS FIRST — every rupee below is an ESTIMATE

The six `NAVBHARAT_RATE_*` keys are **unset**. `hostingCost.ts` has no default rates on purpose:

> *"A hardcoded number would be a placeholder, and this file's inherited law is that a placeholder is
> never charged to a real person."*

So **nothing in this document has been measured.** Every figure comes from public list prices
(≈ ₹13/GB frontend egress, ≈ ₹10/GB Cloud Run egress, ≈ ₹9/GiB-month image storage, ₹87/$).

**This is exactly how `E2B_USD_PER_HOUR` came to charge half the real rate for a month while looking
deliberately configured.** Do not repeat it. **Set the rates, read a real invoice, then re-do this
maths** — and correct this file in place, quoting the old numbers rather than deleting them.

---

## 1 · The plans

| Plan | Price | Apps | Backend apps | Backend traffic | Frontend traffic |
|---|---|---|---|---|---|
| **Free** | ₹0 | 3 | 0 | — | 5 GB |
| **Starter** | **₹299/mo** | 10 | 10 | 5 GB (all apps) | 15 GB |
| **Growth** | **₹599/mo** | 30 | 30 | 12 GB (all apps) | 50 GB |

Overage past the included traffic: **₹20/GB** from the wallet.
**Wallet credit on Growth: ₹0** (admin, 2026-09-13 — it was ₹150 and was the single largest cost
line in that plan, larger than the servers and the traffic).

### 🔒 Rules that are not negotiable without the admin

1. **A free user's wallet is NEVER debited for traffic.** Limit reached ⇒ the app pauses. A free user
   holds gifted credit, and silently eating it would make the word "free" untrue.
2. **Existing plan holders keep the terms they bought.** A ₹149 Starter holder was sold 5 GB in an
   agreement they ticked before paying. New terms apply to new purchases only — the legacy ₹99 plan
   is already handled this way in `hostingBillingSweep.ts` and is the precedent.
3. **The limits must appear in the purchase agreement.** Nobody has to *write* them: the agreement
   text is generated from the same catalogue the meter bills from, so a screen cannot quote a limit
   the meter does not enforce. Change the numbers in the catalogue and the agreement follows.
4. **Backend apps and frontend apps are metered SEPARATELY**, and the agreement must say so — the two
   numbers are not one allowance.

---

## 2 · Why backend went to Cloud Run instead of Render

Render charges a **flat monthly fee per service** whether or not anyone visits. Cloud Run charges
**only while a request is being served** and costs ₹0 when idle.

| | Render | Cloud Run |
|---|---|---|
| 1 backend app | ≈ ₹600/mo | ≈ ₹10–80/mo |
| 30 backend apps, mostly idle | ≈ ₹18,000/mo | ≈ ₹0 for the idle ones |

**This is what makes "30 backend apps for ₹599" possible at all**, and no competitor pricing off
per-service fees can match it. It is the plan's real moat.

🔴 **The Render fallback is still open and is a genuine leak.** `resolveRenderKey` prefers the user's
own key and falls back to **ours** — uncapped, unmetered, unbilled. Either require the user's own key
or meter it. Recorded here because it is the one uncapped path to our wallet in the whole picture.

---

## 3 · The economics

### Per user, per month

| | Typical use | Used the whole allowance | Went viral (1,000 GB) |
|---|---|---|---|
| **Starter ₹299** | 🟢 +₹209 | 🟡 −₹221 | see below |
| **Growth ₹599** | 🟢 +₹359 | 🟡 −₹406 | 🟢 **+₹6,324** |

### 🔑 The single most important number in this file

One viral app (1,000 GB in a month), under three conditions:

| Condition | Result |
|---|---|
| 🔴 **No frontend meter (today)** | **−₹12,636** |
| 🟡 Meter + the owner's wallet is empty | **−₹51** (app pauses) |
| 🟢 Meter + the owner has balance | **+₹6,324** |

**A ₹19,000 swing on one app, decided entirely by whether a meter exists.** Overage is ₹20/GB against
a ≈₹13/GB cost, so past the included allowance a popular app is our best customer — and without the
meter it is our worst.

### At scale (70% Starter / 30% Growth, typical usage)

| Users | Cost | Revenue | Margin |
|---|---|---|---|
| 100 | ≈ ₹20,000 | ₹38,900 | 🟢 ≈ ₹19,000 |
| 1,000 | ≈ ₹2,15,000 | ₹3,89,000 | 🟢 ≈ ₹1,74,000 |

Cost grows **with** revenue, not faster than it. Light users subsidise heavy ones — which is how every
subscription business works, and the goal is **not** to make every individual user profitable. A heavy
user's loss must simply be small enough for the rest to absorb: −₹406 qualifies, −₹1,356 did not.

---

## 4 · What is ALREADY safe (do not rebuild)

Verified in `cloudRunHosting.ts` — `HOSTING_CAPS`:

| Cap | Value |
|---|---|
| Instances per app | **3** — the ceiling on one app's bill |
| Memory | 512 MiB |
| CPU | 1 |
| Idle instances | **0** — an idle app costs nothing |
| Request timeout | 300 s |
| Concurrency | 80 |

**The backend side is well bounded.** The exposure is the frontend, and it is unmetered.

---

## 5 · The work, in priority order

### 🥇 P1 — Frontend traffic meter 🔴 **Nothing else works without it**

The meter reads `run.googleapis.com/container/network/sent_bytes_count` — **Cloud Run only**. A
frontend-only app is on Firebase Hosting, has no Cloud Run service, and is therefore **never counted
and never billable**. Every frontend GB figure in the plans is decoration until this exists.

Worth: the ₹19,000 swing above.

### 🥈 P2 — Image cleanup 🔴 The only cost that never goes down

Nothing deletes container images. Every build adds ~500 MB and **no code removes any of it** — not on
rebuild, not on unpublish, not on delete.

| Users | Image storage | And it grows every month |
|---|---|---|
| 100 | ≈ ₹7,000/mo | ↑ |
| 1,000 | ≈ ₹70,000/mo | ↑ |

Keep the last 2 images per app; delete an app's images when it is deleted.
**This is the only line that is not covered by traffic overage** — no revenue ever offsets it.

### 🥉 P3 — Per-file size cap (25 MB)

One 500 MB video in an app means 500 MB of egress **per visitor**. A 25 MB cap cannot affect a normal
app (images, CSS and JS are far smaller) and removes the worst tail case outright.

### P4 — Usage warnings at 50% / 80% / 100%

Overage only earns money if the owner is not ambushed by it. At 100%: ask whether to keep serving
(and charge) or pause. **A viral app must arrive as good news, not as a bill.**

### P5 — Catalogue changes

Growth wallet credit ₹150 → **₹0**; the traffic numbers in §1; the agreement wording for §1 rule 4.

### P6 — Cloudflare Worker (file is written, not deployed)

`infra/cloudflare/mitrify-apps-worker.js` — removes the ~50-channels-per-site publish ceiling, gives
clean `<app>.mitrify.in` links, and serves repeat visits from Cloudflare's free bandwidth.

⚠️ **Its saving applies only to apps WITHOUT a custom domain.** A user's own domain attaches
**directly to Firebase** (`firebaseCustomDomain.ts`) and bypasses Cloudflare entirely — so paying
users, who are exactly the ones who connect a domain, get no traffic saving from it. The Worker's real
value is **removing the publish ceiling**, not saving money.

### P7 — Bot blocking (a Cloudflare setting, after P6)

Typically 30–50% of "traffic" is crawlers, not people.

---

## 6 · What only the admin can do

| Task | Why a session cannot |
|---|---|
| **Set the 6 `NAVBHARAT_RATE_*` keys** | Cloud Run console |
| **Deploy the Worker** (4 steps) | Cloudflare dashboard |
| **Confirm `mitrify.in` is in our Cloudflare** | Cloudflare dashboard |
| **Decide the Render fallback** | A product decision with a real cost |

### How to read the 6 rates off a real bill

Billing → Reports → project **`navbharatai-user-apps`** → group by **SKU**, show Usage *and* Cost.

| SKU to find | Env key | Unit |
|---|---|---|
| CPU Allocation Time | `NAVBHARAT_RATE_CPU_SECOND` | $ / vCPU-second |
| Memory Allocation Time | `NAVBHARAT_RATE_MEMORY_GIB_SECOND` | $ / GiB-second |
| Requests | `NAVBHARAT_RATE_MILLION_REQUESTS` | $ / million |
| Network egress | `NAVBHARAT_RATE_EGRESS_GIB` | $ / GiB |
| Cloud Build minutes | `NAVBHARAT_RATE_BUILD_MINUTE` | $ / minute |
| Artifact Registry storage | `NAVBHARAT_RATE_STORAGE_GIB_MONTH` | $ / GiB-month |

**Rate = Cost ÷ Usage**, and every value is in **USD**. A rupee figure here would over-charge by ~87×.

⚠️ The apps project is admin-only today, so its bill may be near-empty. Run two test apps for a few
days and read a real invoice rather than pasting list prices — see the warning at the top.

---

## 7 · The gate on going public

🔒 **`NAVBHARAT_CLOUD_PUBLIC` stays unset until P1 and P2 ship and a few days of real usage have been
read.** Opening hosting without metering puts every hosted app's bill on NavBharatAI with nothing
recording it — that absence is load-bearing, not an oversight.

---

## 8 · Open questions — deliberately not guessed

- **The Cloudflare-for-SaaS custom-domain path is half-built.** `createCustomHostname`,
  `getCustomHostname`, `POST /api/domains/connect`, `GET /api/domains/status` and the
  `custom_domains` mapping all exist and are registered in `server.ts`. **Nothing reads that mapping
  to serve a request** — the comment says "so the serving layer can route this domain" and there is no
  such serving layer. Finishing it would make paying users' traffic free too, but it is not worth
  deciding before P1 gives real numbers.
- **Migrating existing custom domains** from Firebase to Cloudflare would mean changing their DNS and
  a period of downtime. Leave existing domains on Firebase; only new ones would take a new path.
- **The Render fallback** (§2) — require the user's key, or meter it.
