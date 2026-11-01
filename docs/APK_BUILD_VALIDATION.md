# APK build reliability: validation

Started 2026-11-01. Branch: `fix/apk-build-reliability-20261101`.

## Implementation

| Area | Changes |
| --- | --- |
| Generated workflows (`mobileShipKit.ts`) | Real Gradle exit codes; bounded network retries; correct Gradle tags; validated/atomic wrapper repair; stale output removal; required artifact uploads |
| Android artifact verification | APK archive CRC, manifest, executable code, bundled page, actual signature and launcher; release AAB archive and JAR signature |
| GitHub API (`githubBuildApi.ts`, `mobileShip.ts`) | Bounded read requests; dispatch retries only on explicit rejection; request/branch correlation; pinned run lookup; older workflows remain compatible |
| Artifact transport (`buildArtifact.ts`, `navStore.ts`) | Shared CRC-checked ZIP extraction; invalid/empty mobile file rejection; safe filenames; bounded download reads; expired artifact handling |
| Browser (`mobileBuildWatch.ts`, `StoreBuildPanel.tsx`, `MyBuiltApps.tsx`) | Bounded response/body reads; artifact collection retry; cancellation/stale response guards; correct APK/AAB/IPA filenames; visible download failures; saved-app rechecks |

No fallback dummy APK is generated and no signing identity is silently replaced. A lost dispatch
response is not replayed: GitHub may already have accepted the build. Generated workflows now verify
outputs before uploading them, and the UI reserves completion for a usable artifact.

The zero-secret APK lane uses the runner's generated debug key. Stable update signing across fresh
runners requires the signed-release lane and preservation of its signing key.

## Base and previous failures

The branch incorporates `origin/main` at `a8f568c15`. Upstream change #4057 resolves all seven failures
from the first full run (recording census, route callers, chat headroom, transport census and audit).
All five formerly failing suites and related admission/catalog checks passed: **108 tests / 11 files**.
The obsolete best-effort cancellation exception was also removed; its focused suite passed 9/9.
No headroom, test or coverage threshold was weakened.

## Toolchain

- Node **22.23.4** and npm **11.18.0**, matching CI.
- SHA256-verified full **Temurin JDK 21.0.9+10**, including `jar` and `jarsigner`. CI selects Temurin
  major version 21 without a patch pin; the local patch is explicitly pinned.
- The host initially had an OpenJDK JRE rather than a full JDK. Final checks use the full Temurin JDK.

## Validation

| Check | Result |
| --- | --- |
| New APK regression cases | **139 focused cases passed** across workflow, API, artifact, browser monitoring and saved-app behavior |
| Workflow focused suites | 278 passed / 6 files, including real JDK wrapper and self-signed/unsigned bundle checks |
| Browser focused suites | 88 passed / 6 files; final frontend typecheck passed |
| Artifact and route focused suites | 111 passed / 5 files; pipeline/artifact/store integration 61 passed / 3 files |
| Full CI coverage command | **Passed: 48,218 tests, zero failures, 85 skipped; 3,179/3,179 files passed; 1,103.97 seconds** |
| Final CI static/build/security/database checks | **All blocking checks passed**, including fresh Temurin Firestore drills (21/13/8/78) |
| Informational package-signature check | TUF metadata request returns HTTP 403; not counted as passed |

The final run uses the unchanged CI workflow and coverage thresholds. Functional/test snapshot hashes
and full logs are retained at `/tmp/navbharat-ci-merge/`. Coverage thresholds passed without changes:
statements **75.52%**, branches **71.43%**, functions **78.10%**, lines **77.44%**.
Final bundle budgets passed: **509.8 KB** first paint (560 KB limit), **1641.2 KB** JS (1720 KB limit).

## Merge status

The user explicitly authorized merge. Git fetch works, but GitHub API calls return **403 Forbidden**
for `api.github.com`; the configured runtime policy does not include that host. A valid API connection
and allowed host are needed to create/read the PR and perform the required green-CI merge. The
supported configuration draft save also returned `draft_not_editable`; persistence was not confirmed,
and the re-read still returned the same draft. The proposed additive host change is preserved at
`/tmp/navbharat-api-network-proposal.json`. No merge is claimed while API access remains blocked.
No environment configuration was changed or published.

## Limits

No actual user APK was compiled on a live GitHub runner and no Android phone installation was
performed. SDK verification commands have executed shell fixtures; real JDK `jar` and `jarsigner`
operations were exercised. Firestore emulator drills are database tests, not Android device tests.
Credentials, outages, quotas and invalid app source still limit availability; this validation does not
establish a universal 100% build guarantee.
