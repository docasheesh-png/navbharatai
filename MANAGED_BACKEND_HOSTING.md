> # ⛔ SHELVED — DO NOT MERGE (2026-08-13)
>
> **The work is complete and the tests are green.** This is not abandoned or half-built — it is
> finished code held back on purpose. Two reasons, and both must be cleared before merging.
>
> ### 1. Three service-account holes — security, must be fixed first
>
> Nothing here sets a service account, so every piece runs as GCP's **default** account, which
> carries the **Editor** role on the whole project. Any user's uploaded code can read the token from
> the metadata server and use it.
>
> | # | Where | What is missing |
> |---|---|---|
> | 1 | `cloudRunBackend.ts` → `cloudRunServiceBody` | No `serviceAccount` on the Cloud Run service — the user's **running app** gets Editor. |
> | 2 | `cloudRunBackend.ts` → `buildStartBuildRequest` | No `serviceAccount` on the Cloud Build — and the generated Dockerfile runs `npm ci` **without** `--ignore-scripts`, so a `postinstall` in the user's `package.json` executes arbitrary code **inside the build**. This one fires by design, before anything is even deployed. |
> | 3 | This document, "Admin setup" step 1 | It says the GCP project *"can be the platform's existing one"*. If an admin follows that literally, the two holes above point at `gen-lang-client-0866594388` — the project holding **every user's Firestore data, wallets, encrypted secrets, the App Store bucket and the production service**. |
>
> **The fix (roughly 40 minutes):** a dedicated runtime SA and a dedicated build SA, both with
> **zero roles**, made REQUIRED in the type so a future edit cannot omit them; deploy refuses
> honestly when they are unset; and this document must say the project MUST be separate.
> Do **not** reach for `--ignore-scripts` instead — `backendDeployConfig.ts` is shared with the BYO
> tier, and real apps (Prisma, native modules) need install scripts. A powerless token is the fix.
>
> ⚠️ The green test suite did **not** catch any of this: the tests assert the request shapes that
> ARE built, and cannot see a field that was never there. The fix must ship with tests that fail
> when a service account is absent.
>
> ### 2. Product decision — the cheaper path comes first
>
> Reviewed with the admin on 2026-08-13. The honest sizing: roughly **7–8 of every 10 apps need no
> separate backend at all** — a frontend plus Supabase (database + auth + storage + generated API)
> is a complete app. This tier serves the remaining 20–30%, and it turns NavBharatAI from a tool
> into a hosting provider, which brings a support pager, Indian IT-Rules intermediary duties, and an
> abuse surface on our own domain. None of those are undone by fixing the service accounts.
>
> So the agreed order is: **make the Supabase-first path the default** (shrinking the 20–30%), and
> **smooth the BYO Render flow** (its "go make an account and paste a key" step is the real drop-off).
> Both fix the same user pain with none of the above risk.
>
> ### Build this when all three are true
>
> 1. Real demand — 10+ users a month visibly stalling at the backend-deploy step.
> 2. The Supabase-first work has shipped, so whoever is left genuinely needs a server.
> 3. The admin accepts being a hosting provider: support, legal exposure, abuse handling.
>
> On 2026-08-13 none of the three were true. The branch is kept because the work is sound and this
> decision may reverse — re-read this block first, then fix the three holes, then merge.

# Managed Backend Hosting — "Deploy to NavBharatAI Cloud"

User backends (Node/Express + PostgreSQL) running on **NavBharatAI's own GCP account**, paid by the
user's wallet plan. This is the MANAGED tier; the BYO tier (user's own Render/Railway/Cloud Run
account via `renderDeploy.ts` / `backendDeployConfig.ts`) is unchanged and stays the free default.

```
user clicks Deploy
   │  POST /api/managed-backend/deploy {appId, files}
   ▼
plan gate (₹199/30d on the wallet)  →  Neon project (first deploy only)  →  DATABASE_URL
   ▼
tar.gz → GCS (MANAGED_BACKEND_BUILD_BUCKET) → Cloud Build (docker build+push) → Artifact Registry
   ▼                                             (client polls /apps/:id/status — the poll ADVANCES the deploy)
Cloud Run service  nb-{uid8}-{slug}  (Mumbai, plan limits: 1 vCPU / 512Mi / max 2 instances)
   ▼
https://{slug}-{uid8}.{MANAGED_BACKEND_APPS_DOMAIN}   (wildcard proxy in server.ts)
```

## Module map

| Piece | File |
|---|---|
| Deploy engine (GCS + Cloud Build + Cloud Run v2) | `src/server/lib/cloudRunBackend.ts` |
| Per-app database (Neon API) | `src/server/lib/neonProvision.ts` |
| Resource caps / spend ceiling | `src/server/lib/backendLimits.ts` |
| ₹199/30d plan on the wallet (debit, lazy renewal, grace) | `src/server/lib/backendHostingPlan.ts` |
| App registry (server-only Firestore collection `managed_backends`) | `src/server/lib/backendRegistry.ts` |
| Wildcard subdomain proxy (`*.apps domain` → Cloud Run) | `src/server/lib/backendSubdomainRouter.ts` |
| HTTP surface | `src/server/routes/managedBackend.ts` |
| Source tarball writer | `src/server/lib/tarGz.ts` |

## Admin setup (one-time)

1. **GCP project** (can be the platform's existing one). Enable APIs: Cloud Run Admin, Cloud Build,
   Artifact Registry, Cloud Storage.
2. **Artifact Registry**: create a Docker repo named `nb-user-apps` (or set `MANAGED_BACKEND_AR_REPO`)
   in the serving region (default `asia-south1`).
3. **GCS bucket** for build sources → set `MANAGED_BACKEND_BUILD_BUCKET`. A 7-day lifecycle-delete
   rule on `sources/` keeps it clean.
4. **Service account** (the one the NavBharatAI server runs as) needs:
   `roles/run.admin`, `roles/cloudbuild.builds.editor`, `roles/storage.objectAdmin` (on the bucket),
   `roles/artifactregistry.writer`, and `roles/iam.serviceAccountUser` on the Cloud Run runtime SA
   (deploys set the public-invoker policy).
5. **Neon**: create an API key (Neon console → Account → API keys) → `NEON_API_KEY`. Projects are
   created in `aws-ap-southeast-1` (Singapore — closest to Mumbai) unless
   `MANAGED_BACKEND_NEON_REGION` says otherwise. Watch the Neon plan's project quota; the Agent Plan
   is the scale path.
6. **Wildcard domain** (optional but what makes it feel first-party): DNS
   `*.apps.yourdomain.com → CNAME → the platform's Cloud Run host`, add the wildcard mapping in
   Cloud Run domain mappings (or the LB), then set `MANAGED_BACKEND_APPS_DOMAIN=apps.yourdomain.com`.
   Until it is set, deploys still work and return the app's own `*.run.app` URL.
7. Flip **`AGENTV3_MANAGED_BACKEND=on`**.

Every gate is honest before setup is complete: endpoints answer 503 naming exactly which env is
missing — nothing pretends to deploy.

## Money

- Plan: `managed_backend`, ₹`BACKEND_HOSTING_PLAN_PRICE_INR` (default 199) per 30 days, debited from
  the ONE wallet via the same pure `computeDebitedWallet` used everywhere (idempotent per period via
  ledger `buildRef`, no overdraft, lazy auto-renewal, 3-day grace after expiry).
- Lapse enforcement: past grace, the subdomain proxy answers **402** with an honest renew message
  and new deploys refuse. A store outage never takes a site down (`known:false` ⇒ serve).
- Spend ceiling per app = plan limits in `backendLimits.ts` (Cloud Run enforces them) + per-minute
  request cap at the proxy + `MAX_APPS_PER_USER` in the routes.

## Known v1 limitations (honest list, not hidden)

- **No WebSocket proxying** on the apps domain (plain HTTP only). Apps needing WS can be reached on
  their `*.run.app` URL.
- **No renewal reminder sweep** for this plan yet (the ₹99 domain plan has one) — lazy renewal +
  grace still work; reminders are the known follow-up.
- **No UI panel yet** — the API is complete and self-describing; the IDE panel is the next slice.
- Neon connection strings live in the server-only `managed_backends` collection (Firestore rules:
  `allow read, write: if false`) and in the app's Cloud Run env — never client-visible.
