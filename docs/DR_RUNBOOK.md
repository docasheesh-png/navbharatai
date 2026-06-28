# Disaster Recovery Runbook (P2.4)

Operational runbook for **NavBharatAI's own production data** (Cloud Run service
`navbharat-ai-prod`, GCP project `gen-lang-client-0866594388`, Firestore database
`ai-studio-cc9cd998-d842-4462-9833-b44f49825878`).

> Scope: this covers NavBharatAI's **operational** Firestore (conversations, build jobs,
> usage costs, provider state, metrics). It does **not** cover end-user app databases —
> those run on the users' own credentials (Supabase/Firebase/etc.) and are the users' to back up.

---

## 1. Backups — scheduled Firestore export

Backups are point-in-time **managed exports** to a GCS bucket. They are triggered two ways:

### 1a. In-app admin trigger (manual / ad-hoc)
The server exposes an admin endpoint that calls the Firestore Admin `exportDocuments` API
using the Cloud Run service account's credentials:

```
POST https://navbharatai.com/api/admin/backup/firestore?admin=$ADMIN_PASSWORD
```
- Requires `FIRESTORE_BACKUP_BUCKET` to be set in the Cloud Run env (the target GCS bucket).
- Returns an honest JSON result: `{ ok, configured, operation, outputUriPrefix, error }`.
- If `FIRESTORE_BACKUP_BUCKET` is unset → `{ ok:false, configured:false, ... }` (no fake success).

### 1b. Scheduled (recommended — daily) via Cloud Scheduler
Create the bucket once, then schedule a daily export. Run from a gcloud-authenticated terminal:

```bash
# One-time: create a regional bucket for backups (same region as Firestore/Run).
gsutil mb -p gen-lang-client-0866594388 -l asia-southeast1 gs://navbharatai-firestore-backups

# One-time: allow the Firestore service agent to write exports to the bucket.
gsutil iam ch \
  serviceAccount:service-950841184325@gcp-sa-firestore.iam.gserviceaccount.com:roles/storage.admin \
  gs://navbharatai-firestore-backups

# One-time: set the env var on Cloud Run (enables the in-app trigger too).
gcloud run services update navbharat-ai-prod --region asia-southeast1 \
  --update-env-vars FIRESTORE_BACKUP_BUCKET=navbharatai-firestore-backups

# Daily scheduled export at 18:30 UTC (00:00 IST) via Cloud Scheduler → Firestore export API.
gcloud scheduler jobs create http firestore-daily-backup \
  --location asia-southeast1 \
  --schedule "30 18 * * *" \
  --uri "https://firestore.googleapis.com/v1/projects/gen-lang-client-0866594388/databases/ai-studio-cc9cd998-d842-4462-9833-b44f49825878:exportDocuments" \
  --http-method POST \
  --oauth-service-account-email <scheduler-sa>@gen-lang-client-0866594388.iam.gserviceaccount.com \
  --message-body '{"outputUriPrefix":"gs://navbharatai-firestore-backups/firestore-backups/scheduled"}'
```

Verify a backup landed:
```bash
gsutil ls gs://navbharatai-firestore-backups/firestore-backups/
```

---

## 2. Restore

Restore is a Firestore **managed import** from a previously-exported prefix. **Importing
overwrites documents with the same path** — restore into a staging database first if unsure.

```bash
# List available backups and pick the prefix to restore.
gsutil ls gs://navbharatai-firestore-backups/firestore-backups/

# Restore (import) the chosen export into the production database.
gcloud firestore import gs://navbharatai-firestore-backups/firestore-backups/<TIMESTAMP> \
  --project gen-lang-client-0866594388 \
  --database "ai-studio-cc9cd998-d842-4462-9833-b44f49825878"
```

Post-restore: redeploy/restart the Cloud Run revision if needed and confirm `/api/ready` is 200.

---

## 3. Health / readiness probes

The app exposes:
- `GET /api/live` — **liveness**: 200 whenever the process is alive.
- `GET /api/ready` — **readiness**: 503 until the server finishes initialization, then 200
  with a per-dependency report. (Dependency degradation is reported but does not 503, to
  avoid needlessly pulling a healthy instance out of rotation.)
- `GET /api/health` — legacy health summary (kept).

### Wire the probes into the Cloud Run service
Apply from a gcloud-authenticated terminal (verify the deploy succeeds before relying on it):

```bash
gcloud run services update navbharat-ai-prod --region asia-southeast1 \
  --startup-probe   httpGet.path=/api/ready,httpGet.port=8080,initialDelaySeconds=5,timeoutSeconds=3,periodSeconds=5,failureThreshold=12 \
  --liveness-probe  httpGet.path=/api/live,httpGet.port=8080,initialDelaySeconds=30,timeoutSeconds=3,periodSeconds=30,failureThreshold=3
```

> NOTE (safeguard #3): these probe flags are documented here for an operator who can
> watch the deploy succeed, rather than baked into `cloudbuild.yaml`'s auto-deploy — a
> wrong flag on the unattended deploy step would fail the deploy (the old revision keeps
> serving, but the update silently wouldn't apply). Apply once manually; thereafter the
> probe config persists across image-only deploys.

---

## 4. Recovery checklist (incident)
1. Confirm scope: app down vs. data loss/corruption.
2. App down → check `/api/live` & `/api/ready`, Cloud Run logs, recent deploy; roll back to the
   last good revision (`gcloud run services update-traffic navbharat-ai-prod --to-revisions <REV>=100`).
3. Data loss/corruption → identify the last good backup (§1b), restore (§2).
4. Verify `/api/ready` 200 + a smoke test of a real build, then resume traffic.
