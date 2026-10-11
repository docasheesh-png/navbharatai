#!/usr/bin/env bash
# NavBharat Cloud — Phase 2 BRING-UP of the least-privilege hosting identities (docs/HOSTING_ARCHITECTURE.md §11).
#
# Run in Google Cloud Shell as an OWNER of the apps project. ADDITIVE ONLY: it never removes a role, never
# deletes a resource, never touches Editor, a service agent, or a legacy service. Every phase stops on the
# first surprise. It prints no secret and writes none.
#
#   bash scripts/navbharatCloudBringUp.sh snapshot   # read-only: records the current state (rollback record)
#   bash scripts/navbharatCloudBringUp.sh validate   # read-only: every permission below exists and is allowed in a custom role
#   bash scripts/navbharatCloudBringUp.sh apply      # snapshot + validate, then creates/binds (asks YES first)
#   bash scripts/navbharatCloudBringUp.sh verify     # read-only: the IAM half of the isolation check
#   bash scripts/navbharatCloudBringUp.sh wire       # sets the two identity env vars on the control plane (asks YES)
#
# What it creates is exactly the C-3 design: two service accounts (runtime with NO roles), one staging bucket,
# five custom roles in the APPS project, resource-level bindings, immutable tags. Re-running is safe: an
# existing resource is checked against the design and the run STOPS if it differs, rather than "fixing" it.
set -euo pipefail

P="${APPS_PROJECT:-navbharatai-user-apps}"
R="${REGION:-asia-south1}"
REPO="${IMAGE_REPO:-nbai-apps}"
BUCKET="${BUILD_BUCKET:-${P}_cloudbuild}"
PLATFORM_PROJECT="${PLATFORM_PROJECT:-gen-lang-client-0866594388}"
PLATFORM_SVC="${PLATFORM_SERVICE:-navbharat-ai-prod}"
PLATFORM_REGION="${PLATFORM_REGION:-asia-southeast1}"
PLATFORM_SA="${PLATFORM_SA:-950841184325-compute@developer.gserviceaccount.com}"
RUNTIME="nbai-app-runtime@${P}.iam.gserviceaccount.com"
BUILD="nbai-app-builder@${P}.iam.gserviceaccount.com"
HERE="$(cd "$(dirname "$0")" && pwd)"

# role-id | title | permissions (comma separated). The ONLY place the design is written down in this script.
ROLES=(
  "nbaiPlatformRun|NavBharat platform - Cloud Run|run.services.create,run.services.get,run.services.list,run.services.update,run.services.delete,run.services.setIamPolicy,run.revisions.list"
  "nbaiPlatformBuild|NavBharat platform - Cloud Build|cloudbuild.builds.create,cloudbuild.builds.get,cloudbuild.builds.list"
  "nbaiPlatformRegistry|NavBharat platform - image registry|artifactregistry.repositories.get,artifactregistry.tags.get,artifactregistry.tags.delete,artifactregistry.dockerimages.list,artifactregistry.versions.delete"
  "nbaiPlatformStaging|NavBharat platform - source staging|storage.objects.create,storage.objects.delete,storage.objects.list"
  "nbaiBuildSourceReader|NavBharat build source reader|storage.objects.get"
)

die() { echo "STOP: $*" >&2; exit 1; }
ok() { echo "  OK    $*"; }
ask() { local a; read -r -p "$1 Type YES to continue: " a; [ "$a" = "YES" ] || die "not confirmed — nothing further was changed"; }
all_permissions() { local r; for r in "${ROLES[@]}"; do echo "${r##*|}" | tr ',' '\n'; done | sort -u; }

snapshot() {
  local d; d="nbai-bringup-snapshot-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$d"
  echo "== snapshot → $d"
  gcloud config list --format='value(core.account)' > "$d/operator.txt"
  gcloud projects get-iam-policy "$P" --format=json > "$d/apps-project-iam.json"
  gcloud iam service-accounts list --project "$P" --format='value(email,disabled)' > "$d/apps-service-accounts.txt"
  gcloud iam roles list --project "$P" --format='value(name)' > "$d/apps-custom-roles.txt" 2>&1 || true
  gcloud artifacts repositories describe "$REPO" --location "$R" --project "$P" --format=json > "$d/repo.json" 2>&1 || true
  gcloud artifacts repositories get-iam-policy "$REPO" --location "$R" --project "$P" --format=json > "$d/repo-iam.json" 2>&1 || true
  gcloud storage buckets list --project "$P" --format='value(name,location)' > "$d/apps-buckets.txt" 2>&1 || true
  gcloud storage buckets describe "gs://$BUCKET" --format=json > "$d/staging-bucket.json" 2>&1 || true
  gcloud run services list --project "$P" --region "$R" --format='value(metadata.name,spec.template.spec.serviceAccountName)' > "$d/apps-run-services.txt" 2>&1 || true
  # The control plane's env var NAMES only — never values.
  gcloud run services describe "$PLATFORM_SVC" --project "$PLATFORM_PROJECT" --region "$PLATFORM_REGION" \
    --format='value(spec.template.spec.containers[0].env[].name)' | tr ';' '\n' > "$d/control-plane-env-names.txt" 2>&1 || true
  ok "saved. Keep this folder: it is the record a rollback is made from."
}

validate() {
  echo "== validate every permission against the live IAM catalogue of $P"
  local cat missing=0 p level
  cat="$(gcloud iam list-testable-permissions "//cloudresourcemanager.googleapis.com/projects/$P" --format='csv[no-heading](name,customRolesSupportLevel)')"
  while read -r p; do
    level="$(printf '%s\n' "$cat" | awk -F, -v n="$p" '$1==n {print ($2==""?"SUPPORTED":$2); f=1} END {if(!f) print "ABSENT"}')"
    # SUPPORTED is the enum's default, so the API may OMIT it — an empty level means supported.
    case "$level" in
      SUPPORTED) ok "$p" ;;
      *) echo "  FAIL  $p → $level"; missing=1 ;;
    esac
  done < <(all_permissions)
  [ "$missing" = 0 ] || die "a permission above cannot go in a custom role — report it; do not substitute a broad role"
  gcloud artifacts repositories describe "$REPO" --location "$R" --project "$P" --format='value(format)' | grep -qx DOCKER \
    || die "repository $REPO in $R is missing or not DOCKER"
  ok "repository $REPO is DOCKER"
}

ensure_role() { # id title perms
  local id="$1" title="$2" want="$3" have
  if have="$(gcloud iam roles describe "$id" --project "$P" --format='value(includedPermissions)' 2>/dev/null)"; then
    [ "$(echo "$have" | tr ';' '\n' | sort | paste -sd, -)" = "$(echo "$want" | tr ',' '\n' | sort | paste -sd, -)" ] \
      || die "custom role $id exists with DIFFERENT permissions ($have) — not overwritten"
    ok "role $id already exists with the designed permissions"
  else
    gcloud iam roles create "$id" --project "$P" --title="$title" --permissions="$want" --stage=GA >/dev/null
    ok "role $id created"
  fi
}

apply() {
  snapshot
  validate
  ask "This ADDS two service accounts, one bucket, five custom roles and resource-level bindings in $P. Nothing is removed."

  echo "== service accounts (no roles)"
  gcloud iam service-accounts describe "$RUNTIME" --project "$P" >/dev/null 2>&1 \
    || gcloud iam service-accounts create nbai-app-runtime --project "$P" --display-name="NavBharat Cloud - user app runtime (NO roles)" >/dev/null
  ok "$RUNTIME"
  gcloud iam service-accounts describe "$BUILD" --project "$P" >/dev/null 2>&1 \
    || gcloud iam service-accounts create nbai-app-builder --project "$P" --display-name="NavBharat Cloud - user app builds (narrow)" >/dev/null
  ok "$BUILD"

  echo "== staging bucket gs://$BUCKET"
  if gcloud storage buckets describe "gs://$BUCKET" --format=json >/dev/null 2>&1; then
    local d; d="$(gcloud storage buckets describe "gs://$BUCKET" --format='value(location,uniform_bucket_level_access,public_access_prevention)')"
    echo "$d" | grep -qi "^${R}" || die "bucket exists in another location ($d) — not changed"
    echo "$d" | grep -q True || die "bucket exists without uniform access ($d) — not changed"
    ok "bucket already exists ($d); its lifecycle is left as the owner set it"
  else
    gcloud storage buckets create "gs://$BUCKET" --project="$P" --location="$R" --uniform-bucket-level-access --public-access-prevention >/dev/null
    local lc; lc="$(mktemp)"
    printf '%s\n' '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1,"matchesPrefix":["nbai-source/"]}}]}' > "$lc"
    gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="$lc" >/dev/null
    rm -f "$lc"
    ok "bucket created: $R, uniform access, public access prevented, nbai-source/ deleted after 1 day"
  fi

  echo "== custom roles (in $P — a project's custom role binds only inside it)"
  local r
  for r in "${ROLES[@]}"; do IFS='|' read -r id title perms <<< "$r"; ensure_role "$id" "$title" "$perms"; done

  echo "== platform bindings (added beside its current roles)"
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$PLATFORM_SA" --role="projects/$P/roles/nbaiPlatformRun" --condition=None >/dev/null
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$PLATFORM_SA" --role="projects/$P/roles/nbaiPlatformBuild" --condition=None >/dev/null
  gcloud artifacts repositories add-iam-policy-binding "$REPO" --location "$R" --project "$P" --member="serviceAccount:$PLATFORM_SA" --role="projects/$P/roles/nbaiPlatformRegistry" >/dev/null
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$PLATFORM_SA" --role="projects/$P/roles/nbaiPlatformStaging" >/dev/null
  gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" --project "$P" --member="serviceAccount:$PLATFORM_SA" --role=roles/iam.serviceAccountUser >/dev/null
  gcloud iam service-accounts add-iam-policy-binding "$BUILD" --project "$P" --member="serviceAccount:$PLATFORM_SA" --role=roles/iam.serviceAccountUser >/dev/null
  ok "platform: run + build (project), registry (repo), staging (bucket), actAs on the two accounts only"

  echo "== builder bindings"
  gcloud artifacts repositories add-iam-policy-binding "$REPO" --location "$R" --project "$P" --member="serviceAccount:$BUILD" --role=roles/artifactregistry.writer >/dev/null
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$BUILD" --role="projects/$P/roles/nbaiBuildSourceReader" >/dev/null
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$BUILD" --role=roles/logging.logWriter --condition=None >/dev/null
  ok "builder: push (repo), read staged source (bucket), write logs (project)"

  echo "== immutable tags on $REPO"
  gcloud artifacts repositories update "$REPO" --location "$R" --project "$P" --immutable-tags >/dev/null
  ok "immutable tags ON"

  verify
}

verify() {
  echo "== verify (read-only). Check 4 FAILS by design in this phase: Editor on the default account is not removed yet."
  APPS_PROJECT="$P" REGION="$R" RUNTIME_SA="$RUNTIME" BUILD_SA="$BUILD" IMAGE_REPO="$REPO" BUILD_BUCKET="$BUCKET" \
    bash "$HERE/verifyHostingIsolation.sh" || true
  echo "-- the platform account's grants on the two identities (expect serviceAccountUser only):"
  gcloud iam service-accounts get-iam-policy "$RUNTIME" --project "$P" --format='value(bindings.role,bindings.members)'
  gcloud iam service-accounts get-iam-policy "$BUILD" --project "$P" --format='value(bindings.role,bindings.members)'
}

wire() {
  gcloud iam service-accounts describe "$RUNTIME" --project "$P" >/dev/null 2>&1 || die "$RUNTIME does not exist — run apply first"
  gcloud iam service-accounts describe "$BUILD" --project "$P" >/dev/null 2>&1 || die "$BUILD does not exist — run apply first"
  ask "This sets NAVBHARAT_APPS_RUNTIME_SA and NAVBHARAT_APPS_BUILD_SA on $PLATFORM_SVC (other variables are kept; a new revision rolls out)."
  gcloud run services update "$PLATFORM_SVC" --project "$PLATFORM_PROJECT" --region "$PLATFORM_REGION" \
    --update-env-vars "NAVBHARAT_APPS_RUNTIME_SA=$RUNTIME,NAVBHARAT_APPS_BUILD_SA=$BUILD" >/dev/null
  ok "wired. Next, in NavBharatAI as admin: Admin → hosting preflight must read READY (it now checks the bucket too)."
}

case "${1:-}" in
  snapshot) snapshot ;;
  validate) validate ;;
  apply) apply ;;
  verify) verify ;;
  wire) wire ;;
  *) echo "usage: $0 snapshot|validate|apply|verify|wire"; exit 2 ;;
esac
