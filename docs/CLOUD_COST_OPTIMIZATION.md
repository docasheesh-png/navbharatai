# NavBharatAI Cloud cost optimization — safe operating plan

## Current known baseline

The hosting architecture already has several important cost controls:

- User backends run on Cloud Run in the separate `navbharatai-user-apps` project.
- `HOSTING_CAPS` currently sets minimum instances to 0, maximum instances to 3, 1 vCPU, 512 MiB, concurrency 80 and a 300-second request timeout.
- Minimum instances at zero means ordinary idle services can scale to zero. Do not raise this globally.
- Static hosting is Firebase Hosting. The Cloudflare bucket/Worker path is documented as not deployed.
- User databases are primarily customer-owned Supabase; the platform Firestore is used for limited NavData functionality.
- The code's per-app maximum and source/build limits are guardrails, not proof of actual monthly cost.

## What is safe to optimize in code now

1. Keep Cloud Run scale-to-zero and hard instance caps as defaults.
2. Keep per-workspace deployment idempotency and deterministic service names; duplicate services are duplicate cost.
3. Keep source-size and build-time caps; they bound build duration and artifact size.
4. Use the existing hosting billing sweep and usage records as the basis for customer-level charging. Do not enable public hosting until metering and isolation gates are independently verified.
5. Run `scripts/auditNavBharatCloudCosts.sh` before making infrastructure changes. It is read-only and inventories Cloud Run, builds, Artifact Registry, disks, IPs, snapshots and buckets.

## Recommendations that are deliberately NOT automated

- **Rightsizing:** Do not reduce all apps to less than 1 vCPU or 512 MiB based on an arbitrary CPU percentage. Use at least 7–14 days of per-service CPU, memory, latency, startup and OOM metrics; change a canary first.
- **Committed-use discounts:** Do not buy CUDs for variable Cloud Run usage. Revisit only after 30–60 days of stable eligible baseline spend and confirm the exact eligible SKU and commitment flexibility.
- **Spot VMs:** Not a direct substitute for Cloud Run. Consider only for separately designed retryable batch jobs.
- **Cleanup:** Inventory candidates first. Never delete a disk, IP, snapshot, revision or image solely because it looks old; check ownership, active references, rollback and retention.
- **Storage lifecycle:** Apply only to temporary build/log buckets or explicitly temporary prefixes. Do not transition live app assets, Firestore data, customer uploads or backups without checking access pattern, minimum storage duration and retrieval charges.
- **Autoscaling:** Keep Cloud Run min instances at zero for ordinary plans and enforce max instances. Raising concurrency or lowering CPU/RAM must be validated with load tests.

## Required billing evidence

The inventory script does not calculate a bill. Use Cloud Billing export to BigQuery (or the Billing Reports SKU view) to obtain actual cost by project, service, SKU, region and day. Reconcile:

- Cloud Run CPU, memory, requests and network egress
- Cloud Build build-minutes
- Artifact Registry storage and network
- Cloud Storage bytes and operations
- Firestore reads, writes, storage and backups
- Firebase Hosting storage, transfer and requests
- Logging ingestion and retention

Do not claim savings until the before/after billing periods are comparable.

## Operator run

In Cloud Shell, use the project that hosts customer apps:

```bash
APPS_PROJECT=navbharatai-user-apps REGION=asia-south1 \
  bash scripts/auditNavBharatCloudCosts.sh
```

The script is read-only. It does not change project configuration or delete resources.

## Rollout gates

1. Fix and retain the Cloud Build credentialless-probe evidence.
2. Verify runtime egress and cross-tenant isolation.
3. Verify actual billing metering and configured rates.
4. Run the cost inventory and reconcile it against Billing export.
5. Only then consider opening customer-facing backend hosting.

## Owner actions

- Run the inventory script and share its output (redact project/account identifiers if sharing outside the team).
- Enable Cloud Billing export to BigQuery if it is not already enabled.
- Review any reported unattached disks, reserved IPs, snapshots and old images manually.
- Do not set `NAVBHARAT_CLOUD_PUBLIC` or `NAVBHARAT_APPS_CREDENTIALLESS_BUILD` to on until their respective gates pass.
