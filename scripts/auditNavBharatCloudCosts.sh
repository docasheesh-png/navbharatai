#!/usr/bin/env bash
# NavBharatAI — read-only Cloud cost inventory.
#
# This script NEVER deletes, updates, stops, or resizes resources. It inventories the
# separate user-apps project so an operator can compare candidates with Cloud Billing
# before making any cost-changing decision.
#
# Usage:
#   APPS_PROJECT=navbharatai-user-apps REGION=asia-south1 \
#     bash scripts/auditNavBharatCloudCosts.sh
#
set -uo pipefail

P="${APPS_PROJECT:-navbharatai-user-apps}"
R="${REGION:-asia-south1}"

section() { printf '\n\n===== %s =====\n' "$1"; }
run() {
  printf '\n$'
  printf ' %q' "$@"
  printf '\n'
  "$@" || printf 'NOTE: command unavailable, permission denied, or no matching resources (exit %s).\n' "$?"
}

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI is required. Run this in Google Cloud Shell."
  exit 2
fi

echo "NavBharatAI Cloud cost inventory (READ ONLY)"
echo "Apps project: $P"
echo "Region:       $R"
echo "No resources will be modified or deleted."

section "1. Project and billing linkage"
run gcloud projects describe "$P" --format='yaml(projectId,projectNumber,lifecycleState)'
run gcloud beta billing projects describe "$P" --format='yaml(projectId,billingAccountName,billingEnabled)'

section "2. Cloud Run services — scale and resource sizing"
run gcloud run services list --project "$P" --region "$R" \
  --format='table(metadata.name,metadata.region,status.url)'
echo
echo "Inspect each service's current limits, scaling and identity:"
while IFS= read -r service; do
  [ -z "$service" ] && continue
  echo "--- $service ---"
  gcloud run services describe "$service" --project "$P" --region "$R" \
    --format='yaml(spec.template.scaling,spec.template.containers[0].resources,spec.template.containerConcurrency,spec.template.timeout,spec.template.serviceAccountName)' \
    || echo "NOTE: unable to describe $service"
done < <(gcloud run services list --project "$P" --region "$R" --format='value(metadata.name)' 2>/dev/null)

section "3. Recent Cloud Build activity (last 20)"
run gcloud builds list --project "$P" --region "$R" --limit=20 --sort-by='~createTime' \
  --format='table(id,status,createTime,duration,source.storageSource.bucket)'

section "4. Artifact Registry repositories"
run gcloud artifacts repositories list --project "$P" --location="$R" \
  --format='table(name,format,mode,cleanupPolicies)'

section "5. Compute Engine disks (review unattached disks; do not auto-delete)"
run gcloud compute disks list --project "$P" \
  --format='table(name,zone,sizeGb,type,status,users)'

section "6. Reserved external IP addresses"
run gcloud compute addresses list --project "$P" \
  --format='table(name,region,address,status,users)'

section "7. Snapshots"
run gcloud compute snapshots list --project "$P" \
  --format='table(name,diskSizeGb,storageBytes,status,creationTimestamp)'

section "8. Cloud Storage buckets and lifecycle configuration"
while IFS= read -r bucket; do
  [ -z "$bucket" ] && continue
  echo "--- $bucket ---"
  gcloud storage buckets describe "gs://$bucket" \
    --format='yaml(location,storageClass,lifecycleConfig,retentionPolicy,versioning,uniformBucketLevelAccess)' \
    || echo "NOTE: unable to describe gs://$bucket"
done < <(gcloud storage buckets list --project "$P" --format='value(name)' 2>/dev/null)

section "9. Budget objects"
run gcloud billing budgets list --billing-account="$(gcloud beta billing projects describe "$P" --format='value(billingAccountName)' 2>/dev/null | sed 's#.*/##')" \
  --format='table(displayName,amount.specifiedAmount,currencyCode,thresholdRules)'

cat <<'EOF'

===== NEXT ACTIONS (MANUAL; NO AUTOMATIC DELETION) =====
1. Export Cloud Billing cost data to BigQuery and compare actual SKU costs by service/project.
2. Check Cloud Run CPU/memory/request metrics before changing per-app resources.
3. Confirm any unattached disk, reserved IP, snapshot or image is not needed for recovery.
4. Apply storage lifecycle only to explicitly temporary buckets/prefixes after retention review.
5. Do not buy CUDs until at least 30–60 days of stable eligible usage is visible.
6. Keep Cloud Run min instances at zero for ordinary plans; do not use Spot VMs as a direct Cloud Run replacement.

This inventory is not a bill and does not estimate savings. Cloud Billing export is the source of truth.
EOF
