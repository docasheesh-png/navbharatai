#!/usr/bin/env bash
# NavBharat Cloud — VERIFY the multi-tenant isolation against the REAL project (read-only).
#
# Run in Google Cloud Shell as a project owner. It changes nothing; it prints what Google says and a
# PASS/FAIL per rule. The Claude session cannot run this (no gcloud), so this script IS the integration
# check for the IAM half of docs/HOSTING_ARCHITECTURE.md §11. The probe app (infra/hosting-isolation-probe)
# is the other half: it tests from INSIDE the build and the runtime.
#
#   APPS_PROJECT=navbharatai-user-apps REGION=asia-south1 \
#   RUNTIME_SA=nbai-app-runtime@navbharatai-user-apps.iam.gserviceaccount.com \
#   BUILD_SA=nbai-app-builder@navbharatai-user-apps.iam.gserviceaccount.com \
#   bash scripts/verifyHostingIsolation.sh
set -uo pipefail

P="${APPS_PROJECT:-navbharatai-user-apps}"
R="${REGION:-asia-south1}"
RUNTIME="${RUNTIME_SA:-nbai-app-runtime@${P}.iam.gserviceaccount.com}"
BUILD="${BUILD_SA:-nbai-app-builder@${P}.iam.gserviceaccount.com}"
REPO="${IMAGE_REPO:-nbai-apps}"
BUCKET="${BUILD_BUCKET:-${P}_cloudbuild}"
PNUM="$(gcloud projects describe "$P" --format='value(projectNumber)')"
DEFAULT_SA="${PNUM}-compute@developer.gserviceaccount.com"
FAIL=0
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAIL=1; }

roles_of() { # project-level roles held by $1
  gcloud projects get-iam-policy "$P" --flatten='bindings[].members' \
    --filter="bindings.members:serviceAccount:$1" --format='value(bindings.role)' 2>/dev/null | sort -u
}

echo "== 1. The runtime identity holds NO project roles"
gcloud iam service-accounts describe "$RUNTIME" --project "$P" >/dev/null 2>&1 && pass "$RUNTIME exists" || fail "$RUNTIME does not exist"
RR="$(roles_of "$RUNTIME")"
[ -z "$RR" ] && pass "no project roles" || fail "project roles: $RR"

echo "== 2. The build identity holds only log writing at project level"
gcloud iam service-accounts describe "$BUILD" --project "$P" >/dev/null 2>&1 && pass "$BUILD exists" || fail "$BUILD does not exist"
BR="$(roles_of "$BUILD" | grep -v '^roles/logging.logWriter$' || true)"
[ -z "$BR" ] && pass "project roles limited to roles/logging.logWriter" || fail "extra project roles: $BR"

echo "== 3. The build identity's resource-level grants are the narrow ones"
gcloud artifacts repositories get-iam-policy "$REPO" --location "$R" --project "$P" --format=json 2>/dev/null \
  | grep -q "serviceAccount:$BUILD" && pass "builder is bound on repository $REPO" || fail "builder has no binding on $REPO (builds will fail)"
gcloud storage buckets get-iam-policy "gs://$BUCKET" --format=json 2>/dev/null \
  | grep -q "serviceAccount:$BUILD" && pass "builder is bound on gs://$BUCKET" || fail "builder has no binding on gs://$BUCKET (builds will fail)"
gcloud artifacts repositories get-iam-policy "$REPO" --location "$R" --project "$P" --format=json 2>/dev/null \
  | grep -q "serviceAccount:$RUNTIME" && fail "the RUNTIME identity is bound on $REPO" || pass "runtime identity not bound on $REPO"

echo "== 4. The default compute account is not a project Editor/Owner"
DR="$(roles_of "$DEFAULT_SA")"
echo "$DR" | grep -Eq '^roles/(editor|owner)$' && fail "$DEFAULT_SA holds: $(echo $DR)" || pass "$DEFAULT_SA holds no Editor/Owner (roles: ${DR:-none})"

echo "== 5. No running service uses a default account; every one uses the runtime identity"
while read -r name sa; do
  [ -z "$name" ] && continue
  if [ "$sa" = "$RUNTIME" ]; then pass "$name runs as the runtime identity"; else fail "$name runs as ${sa:-<default compute>}"; fi
done < <(gcloud run services list --project "$P" --region "$R" --format='value(metadata.name,spec.template.spec.serviceAccountName)' 2>/dev/null)

echo "== 6. Images cannot be overwritten"
IMM="$(gcloud artifacts repositories describe "$REPO" --location "$R" --project "$P" --format='value(dockerConfig.immutableTags)' 2>/dev/null)"
[ "$IMM" = "True" ] && pass "immutable tags ON" || fail "immutable tags OFF (gcloud artifacts repositories update $REPO --location $R --immutable-tags)"

echo "== 7. The staging bucket uses uniform access (no per-object ACL side doors)"
UBLA="$(gcloud storage buckets describe "gs://$BUCKET" --format='value(uniform_bucket_level_access)' 2>/dev/null)"
[ "$UBLA" = "True" ] && pass "uniform bucket-level access ON" || fail "uniform bucket-level access OFF"

echo "== 8. No user-managed keys exist for either identity (keys would be exfiltratable)"
for sa in "$RUNTIME" "$BUILD"; do
  K="$(gcloud iam service-accounts keys list --iam-account "$sa" --managed-by=user --format='value(name)' 2>/dev/null)"
  [ -z "$K" ] && pass "$sa has no user-managed keys" || fail "$sa has keys: $K"
done

echo
[ "$FAIL" = 0 ] && echo "RESULT: IAM half PASSED — now publish infra/hosting-isolation-probe and read / and /build" \
                || echo "RESULT: FAILED — fix every FAIL above before any user app is hosted"
exit "$FAIL"
