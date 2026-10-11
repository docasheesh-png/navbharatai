#!/usr/bin/env bash
# NavBharat Cloud — VERIFY THE CREDENTIAL-LESS BUILD on REAL Cloud Build (Q-706 gap a). Run in Google Cloud
# Shell, from a checkout of the repo, as an owner of the apps project. The Claude session has no gcloud, so
# this script IS the evidence the mode needs before `NAVBHARAT_APPS_CREDENTIALLESS_BUILD=on` may be set.
#
# It builds the isolation probe (infra/hosting-isolation-probe) with EXACTLY the steps the server sends in
# this mode (printed from containerBuild.ts), then reads what the probe saw from INSIDE `npm install`:
#   PASS  the build succeeded, the image was pushed by Cloud Build, and the install script got NO identity
#   FAIL  anything else — and the mode must stay off.
#
#   APPS_PROJECT=navbharatai-user-apps REGION=asia-south1 \
#   BUILD_SA=nbai-app-builder@navbharatai-user-apps.iam.gserviceaccount.com \
#   bash scripts/verifyCredentiallessBuild.sh
set -uo pipefail

P="${APPS_PROJECT:-navbharatai-user-apps}"
R="${REGION:-asia-south1}"
BUILD="${BUILD_SA:-nbai-app-builder@${P}.iam.gserviceaccount.com}"
REPO="${IMAGE_REPO:-nbai-apps}"
TAG="credless-$(date +%Y%m%d%H%M%S)"
IMAGE="${R}-docker.pkg.dev/${P}/${REPO}/nbai-isolation-probe:${TAG}"
CONFIG="$(mktemp --suffix=.json)"
FAIL=0
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAIL=1; }

echo "== 1. The build config is the server's own"
npx --yes tsx scripts/printCredentiallessBuild.ts "$IMAGE" "projects/${P}/serviceAccounts/${BUILD}" > "$CONFIG" \
  && pass "config printed from containerBuild.ts" || { fail "could not print the config"; exit 1; }

echo "== 2. The probe builds this way on real Cloud Build"
if gcloud builds submit infra/hosting-isolation-probe --project "$P" --region "$R" --config "$CONFIG" >/tmp/nbai-credless-build.log 2>&1; then
  pass "build succeeded"
else
  fail "build failed — see /tmp/nbai-credless-build.log"
fi
grep -q "NBAI: metadata route blocked for build containers" /tmp/nbai-credless-build.log \
  && pass "the block step ran" || fail "the block step did not report success"

echo "== 3. Cloud Build pushed the image (the trusted step)"
gcloud artifacts docker images describe "$IMAGE" --project "$P" >/dev/null 2>&1 \
  && pass "$IMAGE exists" || fail "$IMAGE was not pushed"

echo "== 4. From INSIDE npm install, no identity was reachable"
RESULT="$(docker run --rm --entrypoint cat "$IMAGE" /workspace/build-result.json 2>/dev/null || true)"
if [ -z "$RESULT" ]; then
  fail "could not read build-result.json from the image"
elif echo "$RESULT" | grep -Eq '"identity": *null'; then
  pass "the install script got no identity (metadata unreachable)"
else
  fail "the install script still reached an identity: $(echo "$RESULT" | grep -m1 '"identity"')"
fi

echo
if [ "$FAIL" = 0 ]; then
  echo "ALL PASS — the credential-less build works here. Set NAVBHARAT_APPS_CREDENTIALLESS_BUILD=on on the"
  echo "platform service, then send one real publish and check it deploys."
else
  echo "NOT VERIFIED — leave NAVBHARAT_APPS_CREDENTIALLESS_BUILD unset. Send the FAIL lines back to the session."
fi
exit "$FAIL"
