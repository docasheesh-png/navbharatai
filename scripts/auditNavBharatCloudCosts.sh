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

FAILURES=0
failed() {
  printf 'WARNING: %s; this part of the inventory is incomplete.\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

section() { printf '\n\n===== %s =====\n' "$1"; }
run() {
  printf '\n$'
  printf ' %q' "$@"
  printf '\n'
  "$@" || failed "command failed (exit $?): $*"
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
run gcloud --quiet projects describe "$P" --format='yaml(projectId,projectNumber,lifecycleState)'
run gcloud --quiet beta billing projects describe "$P" --format='yaml(projectId,billingAccountName,billingEnabled)'

section "2. Cloud Run services — scale and resource sizing"
run gcloud --quiet run services list --project "$P" --region "$R" \
  --format='table(metadata.name,status.url)'
echo
echo "Inspect each service's current limits, scaling and identity:"
if services="$(gcloud --quiet run services list --project "$P" --region "$R" --format='value(metadata.name)')"; then
  while IFS= read -r service; do
    [ -z "$service" ] && continue
    echo "--- $service ---"
    # gcloud run describes the Knative v1 resource. Scaling lives in annotations;
    # container resources, concurrency, timeout and identity live under template.spec.
    run gcloud --quiet run services describe "$service" --project "$P" --region "$R" \
      --format='yaml(metadata.annotations,spec.template.metadata.annotations,spec.template.spec.containers[0].resources,spec.template.spec.containerConcurrency,spec.template.spec.timeoutSeconds,spec.template.spec.serviceAccountName)'
  done <<< "$services"
else
  failed "Cloud Run service enumeration failed; not evidence of zero services"
fi

section "3. Recent Cloud Build activity (last 20)"
run gcloud --quiet builds list --project "$P" --region "$R" --limit=20 --sort-by='~createTime' \
  --format='table(id,status,createTime,duration,source.storageSource.bucket)'

section "4. Artifact Registry repositories"
run gcloud --quiet artifacts repositories list --project "$P" --location="$R" \
  --format='table(name,format,mode,cleanupPolicies)'

section "5. Compute Engine disks (review unattached disks; do not auto-delete)"
run gcloud --quiet compute disks list --project "$P" \
  --format='table(name,zone,sizeGb,type,status,users)'

section "6. Reserved external IP addresses"
run gcloud --quiet compute addresses list --project "$P" \
  --format='table(name,region,address,status,users)'

section "7. Snapshots"
run gcloud --quiet compute snapshots list --project "$P" \
  --format='table(name,diskSizeGb,storageBytes,status,creationTimestamp)'

section "8. Cloud Storage buckets and lifecycle configuration"
if buckets="$(gcloud --quiet storage buckets list --project "$P" --format='value(name)')"; then
  while IFS= read -r bucket; do
    [ -z "$bucket" ] && continue
    echo "--- $bucket ---"
    # Storage describe uses normalized snake_case fields, not JSON API camelCase.
    run gcloud --quiet storage buckets describe "gs://$bucket" \
      --format='yaml(location,default_storage_class,lifecycle_config,retention_policy,versioning_enabled,uniform_bucket_level_access)'
  done <<< "$buckets"
else
  failed "Cloud Storage bucket enumeration failed; not evidence of zero buckets"
fi

section "9. Billing-account-wide budget objects (not filtered to the apps project)"
echo "Budget filters may include other projects. Inspect each budgetFilter before attributing spend."
if billing_name="$(gcloud --quiet beta billing projects describe "$P" --format='value(billingAccountName)')"; then
  billing_account="${billing_name##*/}"
  if [ -n "$billing_account" ]; then
    run gcloud --quiet billing budgets list --billing-account="$billing_account" \
      --format='table(displayName,budgetFilter,amount.specifiedAmount,thresholdRules)'
  else
    failed "No billing account linkage returned; budget inventory skipped"
  fi
else
  failed "Billing account lookup failed; budget inventory skipped"
fi

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


if [ "$FAILURES" -gt 0 ]; then
  printf '\nInventory incomplete: %s failed section(s) or command(s). No resources were changed.\n' "$FAILURES" >&2
  exit 1
fi
