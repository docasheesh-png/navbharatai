# Scalability & HA (P3.3)

How NavBharatAI stays responsive on Cloud Run while keeping costs down, and what it would
take to go multi-region.

---

## 1. Keep-warm (cold-start mitigation with `min-instances=0`)

Cloud Run runs `navbharat-ai-prod` with **`min-instances=0`** (no idle billing). The trade-off
is a cold start on the first request after the instance scales to zero — slow for the PRO and
SDA/professional universes, which lazily construct AI-provider clients, the clinical knowledge
base, the app-context index, and Firestore clients on first use.

### The mechanism: `GET /api/warm` + Cloud Scheduler
The app exposes **`GET /api/warm`** (`src/server/routes/warm.ts`). It pre-initializes the heavy
lazy singletons — **constructing client objects only, never making a real billed model call** —
and returns an honest per-step report (`{ warm, serverReady, steps:[{step,ok,ms}], okCount, failCount }`),
always `200`.

What it warms:
- All three AI router universes (`free` / `pro` / `professional`) + their env-only health checks.
- The SDA clinical knowledge base + the `sda_chat` app-context index.
- The Gemini SDK client singleton.
- The Firestore admin client (via lightweight reads on `UserCostStore`, `ProviderStateStore`,
  `LogStore`, `metrics`) — the first read pays the client init so real requests don't.

### Set up the scheduled ping (run from a gcloud-authenticated terminal)
```bash
# Ping every 5 minutes. While the schedule is active this keeps ONE instance warm, at a
# fraction of the cost of min-instances=1, and min-instances stays 0.
gcloud scheduler jobs create http navbharat-keep-warm \
  --location asia-southeast1 \
  --schedule "*/5 * * * *" \
  --uri "https://navbharatai.com/api/warm" \
  --http-method GET \
  --attempt-deadline 30s
```
Tune the cadence (or pause the job overnight) to balance warmth vs. cost.

### Why NOT an in-app self-ping
A `setInterval` self-ping inside the server is **wrong** with `min-instances=0`: it would keep an
instance alive 24/7 (defeating the budget) **and** still wouldn't help the genuinely-cold first
request after a scale-to-zero. An **external** scheduler hitting `/api/warm` is the correct tool —
its traffic is what prevents scale-to-zero during the window, and it warms the real hot paths.

---

## 2. Multi-region readiness (config only — no spend yet)

Assessed from code + config. The app is **substantially ready** to run the same stateless
container in a second region; nothing here provisions a second region (no spend).

**Ready already**
- The container is stateless and config-driven (region/project via env + `cloudbuild.yaml`).
- Cross-instance provider cooldowns already sync via `ProviderCooldownStore` (Firestore), so
  circuit-breaker state is shared across instances/regions.
- Durable state (conversations, jobs, costs, provider state, metrics) lives in Firestore, not
  on the instance.

**What a second region would need (when the time comes)**
- **In-memory per-instance maps** (e.g. live build/session maps, the tracer/error ring buffers,
  in-flight pools) are per-instance by design — they do not need cross-region sync, but any
  feature that assumes a single global instance must be reviewed before relying on it across
  regions. A global external load balancer with latency-based routing would front both regions.
- **Firestore location**: the database is single-region (`asia-southeast1`-aligned). For true
  multi-region durability, use a multi-region Firestore location or accept cross-region reads.
- **A second Cloud Run service** in the target region behind a global HTTPS load balancer +
  Serverless NEGs; replicate the env/secrets. (Deferred — no spend until needed.)

---

## 3. Related
- Health/readiness/liveness + DR backups: see `docs/DR_RUNBOOK.md`.
- Deploy pipeline: `cloudbuild.yaml` (region `asia-southeast1`, `min-instances=0`, `max-instances=10`, concurrency 100).
