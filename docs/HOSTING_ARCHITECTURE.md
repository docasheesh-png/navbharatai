# Hosting architecture — NavBharat Cloud (engineering reference)

Written 2026-10-06 from a forensic read of the code. It answers an external "managed backend hosting foundation" spec **against what this repository already does**, under CLAUDE.md's external-suggestion rule: much of that spec already exists here, so this file maps every part of it to real code. Only the real gaps were built.

Economics and plans are in `HOSTING_ECONOMICS_ROADMAP.md`. The product plan is in ROADMAP §11. The env keys are in `docs/claude/ENV_REGISTRY.md`.

---

## 1. Control plane and data plane

| Plane | What runs there | Where |
|---|---|---|
| **Control plane** | Users, workspaces (apps), deployment registry, plans, quotas, wallet, billing sweeps, the deploy orchestration | The platform's Cloud Run service `navbharat-ai-prod` and Firestore, in GCP project `gen-lang-client-0866594388` |
| **Data plane: static** | Built frontends | Firebase Hosting channels (`Deployment.ts`). A bucket plus Cloudflare Worker path is written but not deployed (`bucketPublish.ts`, `infra/cloudflare/mitrify-apps-worker.js`) |
| **Data plane: servers** | User backends, one container each | Cloud Run in a **separate project**, `navbharatai-user-apps`, on a separate billing account (admin decision D4). Each container runs as the dedicated **role-less** runtime identity `NAVBHARAT_APPS_RUNTIME_SA` — never the default account (§11) |
| **Data plane: data** | User databases, auth, files | The **user's own** Supabase project, created through OAuth (`supabaseProvision.ts`). The only exception is `window.NavData`: small quota-bound rows on our Firestore (`navStoreWebData.ts`) |
| **Build / preview** | Untrusted generated code while it is being built | E2B sandboxes (`sandbox/EngineerAI/actuators/E2BActuator.ts`). Container images are built by Cloud Build **in the apps project** (`containerBuild.ts`) |

🔒 **User code never runs in the control-plane process.**
- `appsProject()` refuses to host when `NAVBHARAT_APPS_PROJECT` is unset or names the platform project. There is deliberately no fallback.
- Builds run in Cloud Build in the apps project. Previews run in E2B.

---

## 2. Identity and tenancy

| Entity | Stable id | Where it lives |
|---|---|---|
| User | Firebase uid | Firebase Auth |
| App ("project" and "application" are one thing here) | `workspaceId`, immutable, derived from the uid and a session (`workspaceIdFor`) | `agentv3_conversations/{workspaceId}` |
| Live deployment | One per app, keyed by `workspaceId` | `agentv3_deployments/{workspaceId}` (`DeploymentStore.ts`) |
| Deploy attempt | `deploymentId` (`dep_<time>_<random>`) | `hosted_deploy_attempts/{deploymentId}` (`hostedDeployments.ts`, new) |
| Runtime | Cloud Run service `<slug>-<tag>`; `tag` is a hash of the `workspaceId`, so it survives renames | Recorded as `DeploymentRecord.service` |
| Database | Supabase project ref, in the user's own account | Encrypted vault rows `user_secrets`, scoped per workspace (`secretScope.ts`) |
| Domain | Hostname | `custom_domains`, plus Firebase links (`firebaseDomainLink.ts`) |

No display name is ever an identity:
- A service is matched to its app by the rename-proof tag (`serviceBelongsTo`).
- A redeploy reuses the **recorded** service name (`hostedServiceName`, new — see §6).

---

## 3. Authorization (protection against IDOR)

Every route that touches an app runs the same chain, in this order:

1. **Verified identity.** Use `verifyFirebaseIdentity` / `requireVerifiedForMoney`. Never the body's `userId` or `email` for anything paid or admin. The server-publish path keys the plan, the cap and the attempt on the **verified** uid (`hostOwnerUid`, 2026-10-06).
2. **Ownership.** `assertVerifiedWorkspaceOwner(req, workspaceId)` checks the token's uid against the workspace. A claimed uid is never enough to write to a public host.
3. **Resource scope:**
   - secrets are scoped to the workspace;
   - `planBackendEnv` sends a server only the env names its own code reads, never a platform-control key;
   - a Supabase wake is limited to refs that one of the caller's own apps uses (`/supabase/wake`).
4. **Admin actions** use `verifyAdminToken`, and need a written reason for every removal (`readAdminReason`, takedown ledger).

---

## 4. Resource model and safe defaults

- **Plans:** one catalogue, `src/lib/hostingTiers.ts`, read by `hostingPlan.ts` and `HostingQuota.ts`.
  - It holds app counts, **server-app counts** (`backendApps`) and included traffic.
  - Prices come from the catalogue, never from code.
- **Per-service caps** (`HOSTING_CAPS` in `cloudRunHosting.ts`):
  - `minInstanceCount: 0` (idle costs nothing), `maxInstanceCount: 3`;
  - 1 vCPU, 512 MiB, 80 concurrency, 300 s request timeout.

  These go on every service and are never unlimited.
- **Source cap:** 40 MB packed (`NAVBHARAT_MAX_SOURCE_MB`). **Build cap:** 900 s (`BUILD_TIMEOUT_SECONDS`).
- **Runtime user:** Google buildpacks run the app as the non-root `cnb` user. There is no Dockerfile from the user.
- **Runtime identity:** a dedicated role-less service account. **Build identity:** a separate narrow one. Both are validated, and hosting is off without them (§11).
- **Server-app cap:** `serverAppLimit`. Since 2026-10-06 it is enforced on the one server-publish path (§6).
- **Not yet configurable per plan:** egress network restrictions, and a per-app request rate. See §9.

---

## 5. Lifecycle

### 5a. App status (registry) — `DeploymentStatus`

`active` · `held` (waiting on review) · `taken_down` (ban, permanent) · `unpublished` (the owner or an admin took it down; it can be republished) · `plan_paused` (plan lapsed or debt; the files are kept and it comes back on publish).

🔒 **Going offline has exactly one implementation:** `takeAppOffline` in `hostedAppLifecycle.ts`. It removes the static channel, then **every** Cloud Run service carrying the workspace tag, and **only then** writes the status. If either removal is not confirmed, it throws and marks nothing.
- It is used by the admin ban, the admin unpublish and both plan-pause sweeps.
- The owner's unpublish uses the same `removeHostedServers` before it writes `unpublished`.
- Censuses in `tests/aServerAppHasOneLifecycle.test.ts` fail if a new path writes an offline status directly.

🔒 **A banned or held app is never re-hosted:** `hostedRepublishRefusal` runs inside `hostAppOnNavBharatCloud`, before anything is packed or built.

### 5b. Deploy attempt (new) — `hostedDeployments.ts`

```
queued ──► building ──► deploying ──► live
   │           │            │
   └───────────┴────────────┴──► failed        (a category: blocked | unavailable | no-source |
   │           │            │                    too-large | unpackable | build-failed | deploy-failed | internal)
   └───────────┴────────────┴──► abandoned     (lease went stale: an instance died mid-deploy)
```

- The legal moves live in **one table**, `HOSTED_DEPLOY_TRANSITIONS`. `nextDeployState` throws on anything else, and `TrackedDeploy` logs and refuses rather than writing an illegal state.
- `live` carries `ready`, which is Cloud Run's own word that a revision is serving, never inferred from a 200.

### 5c. Deletion safety

| Action | Effect | Reversible? |
|---|---|---|
| **Owner unpublish** | Removes the channel and the servers | The durable files stay; Publish brings the app back |
| **Admin ban** | Removes everything; status `taken_down` | Restore lifts the block; the owner must republish |
| **Workspace delete** | Keeps a live app online, marked `orphaned`, so a shared link does not die and the admin can still take it down (`markOrphaned`) | — |

Nothing deletes the user's source files or their Supabase data.

---

## 6. Idempotency and failure handling

- **One deploy at a time per app:** a per-workspace lease (`hosted_deploy_leases/{workspaceId}`), claimed in a Firestore transaction.
  - A second press while a deploy runs gets `409 deploy-in-progress` with the running `deploymentId`, and **no second Cloud Build**.
  - A lease older than the longest possible deploy (build cap + 10 min) is stale and claimable, and its attempt is recorded as `abandoned`.
  - It fails open on an unreadable store, the same as `workspaceBuildLease.ts`.
- **Redeploy = update:**
  - The service name is deterministic and the recorded name is reused (`hostedServiceName`), so a rename can no longer create a second service.
  - Create returns 409 for an existing service, which then becomes a PATCH.
- **Partial success is refused, never reported as success** (`hostApp.ts`):
  - a partial archive is refused;
  - a build that timed out is a failure;
  - a deployed service that cannot be made public is a failure;
  - a service without a readable URL is a failure.
- **Reconciliation:**
  - `hostedServiceInventory.ts` classifies every Cloud Run service against the registry as live, stale, orphan or indeterminate. An *incomplete* registry is never grounds for deletion.
  - `removeWorkspaceServers` deletes by listing what **exists**, not what was recorded.

---

## 7. Observability

- **Deploy events.** Each transition writes a `[hosting-event] {"event":"DEPLOY_BUILDING","deploymentId":…,"workspaceId":…,"userId":…,"category":…}` line.
  - The attempt document keeps the last 20 events.
  - Neither ever carries a message body, a secret or provider text. The provider's build log goes only to the admin log line (`logDetail`).
- **App logs:** `runtimeLogs.ts`, read from Cloud Logging. It is admin-only until hosting opens (ROADMAP 2.8).
- **Uptime:** `siteUptimeSweep.ts`, every 15 minutes, for connected domains.
- **Usage:** `hostingUsage.ts` reads Cloud Run metrics, and `hosting-daily-bill` measures every hosted app daily.
- **Audit:** `audit()` lines for every admin removal, plus the 180-day takedown ledger.

---

## 8. Cost protection

| Layer | Mechanism |
|---|---|
| Per service | `HOSTING_CAPS` (3 instances, scale to zero) |
| Per owner | `serverAppLimit` (`backendApps` from the plan); `publishedAppCap` |
| Per publish | 40 MB source cap, 900 s build cap, one deploy at a time (the lease) |
| Per project | 1,000-service ceiling, watched by `hostedServiceInventory` / Publish Capacity |
| Money | `hosting-daily-bill` (traffic over the plan at ₹20/GB, once `NAVBHARAT_BILL_HOSTING` is set); debt → reminder → `takeAppOffline` after the grace period |
| Blast radius | Separate apps project and separate billing account (D4) |
| Gate | `NAVBHARAT_CLOUD_PUBLIC` stays unset until metering is proven (HOSTING_ECONOMICS_ROADMAP §7) |

---

## 9. Known gaps (honest)

| Gap | Needs | Owner |
|---|---|---|
| Rates unknown (`NAVBHARAT_RATE_*` unset) and frontend traffic metered only by the browser | Admin sets the rates; Cloudflare Worker deployed (P6) | Admin |
| Starter database on our own Supabase org (D2) | Admin decision. Note: a Supabase project does not scale to zero | Admin |
| Custom domain → Cloud Run (slice 3) | The Worker | Admin |
| Cron for user apps (2.7) | Cloud Scheduler in the apps project | Admin |
| Egress restrictions / per-app rate limit | A design decision (VPC egress or a proxy). Not built | — |
| Backups | User data lives in the user's Supabase; Supabase's own backups apply. No NavBharatAI-side backup | — |
| Deployment history **screen** | The attempts are recorded; no client screen reads them yet (a route nobody calls is not allowed — Q-162) | Next step |
| `held` removes nothing (static **or** server): the rescan hold only marks the app | A decision (BUILD_REPORT_QUEUE Q-703) | Admin |
| Rollback of a server app to its previous revision | Cloud Run keeps revisions; no traffic-split call is wired. The static path has `publishRollback.ts` | Next step |

---

## 10. Scaling path

- **Up to the 1,000-service ceiling:** one region, one apps project. Inventory and reclaim keep dead services from eating the cap.
- **Beyond it:** shard by apps project. `appsProject()` is the single resolver, so a second project is a routing change in one place, keyed by a stable function of the `workspaceId`.
- **Always-on:** a paid tier with `minInstanceCount: 1` (ROADMAP §11 slice 7), never the default.

---

## 11. Trust boundaries and multi-tenant isolation (P0, 2026-10-06)

### 11a. What was found (forensic, from the code)

| Stage | Identity it ran as | What user code could take |
|---|---|---|
| Build (`containerBuild.ts`, Cloud Build) | **No `serviceAccount` given.** On a 2026 project, Cloud Build's default is the project's **default compute account** `219549203609-compute@developer.gserviceaccount.com` | `npm install` runs the app's own `preinstall` / `postinstall` scripts inside the build. Any of them can mint that account's token from the metadata server |
| Runtime (`cloudRunHosting.ts`, Cloud Run) | **No `template.serviceAccount`.** So: the **same default compute account** | Any request handler can mint that token. The metadata server is always reachable from inside Cloud Run and cannot be firewalled |
| Image | Deployed **by tag** | Anything holding push rights could move a tag |
| Staged source | Left in the shared bucket until the daily sweep | Every app's source sat readable by the build account for up to a day |

**Blast radius.** The runtime and the build shared one identity. So whatever a build needs — push to the shared repository `nbai-apps`, read the shared staging bucket — **every running user app held too**: every other app's images and source code. Worse: if the default account still held the **Editor** role (Google grants it unless an org policy forbids it, and this session cannot read the project's IAM), any app could also:
- read every other app's environment, which means their secrets;
- rewrite or delete every other app's service;
- start builds on our bill.

**Root cause.** Untrusted code ran under an identity chosen by default, not by design. Nothing named the identity, so nothing could restrict it.

### 11b. The boundary now

```
CONTROL PLANE  (gen-lang-client-0866594388, identity 950841184325-compute@…)
  orchestrates: uploads the source, starts the build AS the builder, deploys the service AS the runtime,
  pins the digest, deletes the staged source.  User code NEVER runs here.
        │  (iam.serviceAccountUser on both accounts — "actAs", nothing more)
        ▼
DATA PLANE  (navbharatai-user-apps)
  ┌ BUILD  — NAVBHARAT_APPS_BUILD_SA  (narrow, shared by builds)
  │   roles: Artifact Registry Writer on repo `nbai-apps` ONLY · Storage Object Viewer on the staging bucket ONLY
  │          · Logs Writer at project level.  No Cloud Run, no Secret Manager, no IAM, no platform project.
  └ RUNTIME — NAVBHARAT_APPS_RUNTIME_SA (ROLE-LESS, shared by every app)
      roles: NONE, anywhere.  Its token opens nothing: not another app's service, image, source or secrets,
      not the control plane.
```

**Why ONE role-less runtime account instead of one per app.**
- A token with no permissions grants nothing. Sharing it across apps therefore shares nothing, and App A's compromise cannot reach App B.
- An app's data lives in the user's **own** Supabase project, with credentials scoped to that one app (`secretScope.ts`).
- An app's secrets are its own environment variables. Nothing in Google is granted to the app.
- Per-app accounts would only matter if apps held per-app Google resources. They would also collide with the per-project service-account quota (100 by default) far below the 1,000-service ceiling.
- **If per-app Google resources are ever added** (a bucket, a secret), they go through a **control-plane broker**: it authenticates the caller and returns a short-lived grant scoped to that one app. The runtime identity is never granted anything.

**Enforced in code** (`appsIdentity.ts`, locked by `tests/userCodeNeverRunsAsTheDefaultIdentity.test.ts`):
- Both accounts must be user-managed accounts **of the apps project**. Google default accounts are refused, and runtime ≠ build.
- Without both, `hostingAvailability` and `hostAppOnNavBharatCloud` refuse. This **fails closed, for the admin too**.
- The service spec carries `template.serviceAccount`; the build carries `serviceAccount` plus `CLOUD_LOGGING_ONLY`.
- The deploy runs `image@sha256:…`, read from the tag right after the build. An unidentifiable image is never deployed.
- The staged source is deleted as soon as its build ends. The daily sweep is the backstop.
- Censuses: no other file builds a Cloud Run service template or a Cloud Build build.

### 11c. Per-resource answers (threat model: App A is fully compromised)

| A tries to… | Result, by design | Enforced by |
|---|---|---|
| Read/modify/delete B's Cloud Run service, or read B's env (secrets) | 403 | Runtime account has no `run.*` permissions |
| Invoke B's service | Allowed. **Every hosted app is a public website** (`allUsers` invoker). This is not a privilege; it is what any visitor can do | — |
| Read B's source (staging bucket) / pull or overwrite B's image | Runtime: 403. Build: see the residual risk below | Runtime account has no role; immutable tags + digest deploys |
| Read Secret Manager | 403 (no secrets exist; the account has no role) | Runtime account has no role |
| Reach the control plane (platform Firestore, Cloud Run, IAM) | 403 | Neither account has any role in the platform project |
| Mint a token from the metadata server | Succeeds, **and the token opens nothing** | The account is role-less (the metadata server itself cannot be blocked) |
| Reach B's database | Only with B's credentials, which only B's environment holds | `secretScope.ts`, `planBackendEnv` |
| User A → User B logs / deployment / env / usage via our API | 403 | `assertVerifiedWorkspaceOwner` on every route, verified identity only |

### 11d. Residual risk — honest

- **Builds share one narrow identity.** During its own build, a malicious app's install script can use the builder's token to:
  - **pull** other apps' images, i.e. read their built code;
  - **read** any staged source that exists at that moment — only concurrent builds, because sources are now deleted right after each build.

  It **cannot** overwrite a deployed image: tags are immutable, and deploys pin the digest.

  **The fix:** a credential-less build step. The install and build run with **no** token (the metadata route is blocked from the build container); only a separate trusted step holds the push right. That needs a real Cloud Build prototype, verified against Google, before it can be claimed. **Until it exists, this stays an OPEN P1 before public launch.**
- **Network egress is unrestricted.** Mining, spam and outbound attacks are bounded by `HOSTING_CAPS` (3 instances, 1 vCPU), the plan's server cap, takedown, and the outbound Web Risk re-scan. There is no egress allow-list.
- **Verification of real IAM is not possible from the session.** The session has no gcloud, and the platform identity cannot read IAM policy. See 11f.

### 11e. Migration of the existing apps — no breakage

Hosting is admin-only today (`NAVBHARAT_CLOUD_PUBLIC` unset), so the only hosted services are the admin's test apps. In order:
1. Create both accounts and grant only the roles in 11b. Set `NAVBHARAT_APPS_RUNTIME_SA` and `NAVBHARAT_APPS_BUILD_SA` in the platform's Cloud Run, and turn on immutable tags on `nbai-apps`.
   - **Until this is done, hosting refuses** (fail closed). Already-running services keep serving as they are.
2. Publish each existing hosted app again. It is rebuilt as the builder and redeployed as the runtime account, on the same service, by digest.
3. Run `scripts/verifyHostingIsolation.sh`: every service must show the runtime account. Publish `infra/hosting-isolation-probe` and read `/` and `/build`.
4. Only then **remove Editor from the default compute account** (`gcloud projects remove-iam-policy-binding … --role=roles/editor`).
   - Do it *after* step 3, so a forgotten old service is found by the script, not by an outage.
   - Never leave both the old broad access and the new identities in place indefinitely.

### 11f. Verification (what counts as evidence)

| Evidence | Covers | Who |
|---|---|---|
| `tests/userCodeNeverRunsAsTheDefaultIdentity.test.ts` (12 tests; 3 reversions proven) | The code always names the right identity, fails closed, and deploys by digest | CI |
| `scripts/verifyHostingIsolation.sh` | The REAL IAM: role-less runtime, narrow builder, no Editor on the default account, every service on the runtime account, immutable tags, uniform bucket access, no keys | Admin, in Cloud Shell |
| `infra/hosting-isolation-probe` (published like a user app) | From INSIDE the runtime and the build: every cross-tenant and control-plane call must be denied; `testIamPermissions` must return nothing on either project | Admin publishes; anyone reads `/` and `/build` |

**Isolation counts as verified only when all three pass.**


### 11g. Bring-up — creating the identities, bucket and roles (2026-10-07)

`scripts/navbharatCloudBringUp.sh` is the one command an OWNER runs in Cloud Shell. It is **additive only**: nothing is removed, Editor and the service agents are untouched, and a resource that already exists but differs from the design stops the run instead of being changed.

| Step | What it does |
|---|---|
| `snapshot` | Read-only record of IAM, accounts, roles, repo, buckets, services, control-plane env NAMES |
| `validate` | Every permission below exists in the live catalogue and may go in a custom role (an omitted level means `SUPPORTED`, the enum default) |
| `apply` | snapshot → validate → YES → two accounts, staging bucket (asia-south1, uniform access, public access prevented, `nbai-source/` deleted after 1 day), five custom roles, resource-level bindings, immutable tags → verify |
| `wire` | Sets `NAVBHARAT_APPS_RUNTIME_SA` / `NAVBHARAT_APPS_BUILD_SA` on `navbharat-ai-prod` (asks YES) |

| Principal | Role | Scope | Purpose |
|---|---|---|---|
| platform | `nbaiPlatformRun` (run.services create/get/list/update/delete/setIamPolicy, run.revisions.list) | project | deploy, readiness wait, public access, takedown, retention |
| platform | `nbaiPlatformBuild` (cloudbuild.builds create/get/list) | project | start and follow builds |
| platform | `nbaiPlatformRegistry` (repositories.get, tags.get, tags.delete, dockerimages.list, versions.delete) | repo `nbai-apps` | digest pin, retention |
| platform | `nbaiPlatformStaging` (objects create/delete/list) | staging bucket | upload, delete, sweep, preflight |
| platform | `roles/iam.serviceAccountUser` | ON each of the two accounts | actAs only them |
| builder | `roles/artifactregistry.writer` | repo `nbai-apps` | `pack --publish` |
| builder | `nbaiBuildSourceReader` (objects.get) | staging bucket | fetch its staged source |
| builder | `roles/logging.logWriter` | project | `CLOUD_LOGGING_ONLY` |
| runtime | — | — | nothing, ever |

`tests/theBringUpScriptIsAdditiveAndNarrow.test.ts` locks this table to the script. The broad project roles the platform already holds stay until the probe reads ISOLATED and a real app deploys; they are removed later, one at a time, project-level `serviceAccountUser` first.

**Readiness (same date).** A deploy now waits (bounded, 240 s) until the service stops reconciling. Readiness is read from the v2 `terminalCondition`. Before this, the code read it from `conditions`, which in v2 never carries `Ready`. A server that does not start fails the publish and is never made public. On a first deploy the service is deleted; on an update the serving version is left alone. The preflight also checks the staging bucket now; before, it could report `ready` without one.
