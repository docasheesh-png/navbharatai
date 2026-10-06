# Hosting architecture — NavBharat Cloud (engineering reference)

Written 2026-10-06 from a forensic read of the code. It answers an external "managed backend hosting foundation" spec **against what this repository already does**, under CLAUDE.md's external-suggestion rule: much of that spec already exists here, so this file maps every part of it to real code. Only the real gaps were built.

Economics and plans are in `HOSTING_ECONOMICS_ROADMAP.md`. The product plan is in ROADMAP §11. The env keys are in `docs/claude/ENV_REGISTRY.md`.

---

## 1. Control plane and data plane

| Plane | What runs there | Where |
|---|---|---|
| **Control plane** | Users, workspaces (apps), deployment registry, plans, quotas, wallet, billing sweeps, the deploy orchestration | The platform's Cloud Run service `navbharat-ai-prod` and Firestore, in GCP project `gen-lang-client-0866594388` |
| **Data plane: static** | Built frontends | Firebase Hosting channels (`Deployment.ts`). A bucket plus Cloudflare Worker path is written but not deployed (`bucketPublish.ts`, `infra/cloudflare/mitrify-apps-worker.js`) |
| **Data plane: servers** | User backends, one container each | Cloud Run in a **separate project**, `navbharatai-user-apps`, on a separate billing account (admin decision D4) |
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
