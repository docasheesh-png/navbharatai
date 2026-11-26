# Android builds — two providers: Native Cloud Build and GitHub Actions

*Written 2026-11-25, together with the code it describes. This file covers the user-app Android build
(an app made in NavBharatAI becomes an `.apk` or `.aab`). The runbook for NavBharatAI's OWN store app is
`MOBILE_PUBLISHING.md`; the step-by-step GitHub pipeline is `MOBILE_APK_PIPELINE.md`.*

The user presses **Build Android App** (App Information screen → the build card) and sees exactly two choices:

| | **Option 1 — NavBharatAI Native Cloud Build** | **Option 2 — GitHub Actions Build** |
|---|---|---|
| Who compiles | A disposable E2B machine per build, from NavBharatAI's own worker template | GitHub's runner, in the user's own repository |
| Needs GitHub | No | Yes (token with `repo` + `workflow`) |
| Recipe | The app's own generated GitHub workflow, translated step by step | That workflow |
| `.apk` signing | Android debug key (install and test; not for Play) | Same |
| `.aab` signing | The user's upload key, kept sealed by NavBharatAI with consent, used only in a separate network-less signing machine | The upload key as secrets in the user's repository |
| File kept | Private bucket, `MOBILE_NATIVE_BUILD_RETENTION_DAYS` (default 30) | GitHub artifact, 14 days |
| Status | Server job record (Firestore), real worker steps | GitHub run + step report |
| Repair | The failing step is named and classified by the same classifier; the user fixes and rebuilds | Automatic rules/AI repair and retry (existing) |
| Price | ₹`APK_CHARGE_INR` per successful build — the same shared charge | Same |
| Default | **Off** until the owner configures it | **On** |

Nothing ever switches provider for the user — not before a build, not after a failure.

---

## 1. Architecture (code map)

```
src/server/lib/mobileBuild/
  types.ts                 the shared vocabulary: providers, normalized states, job record, browser view
  providerRegistry.ts      which provider can run now, and why not (env-driven, read at call time)
  prepareMobileProject.ts  ONE preparation for both providers (moved verbatim out of /api/mobile-ship/setup)
  workflowScript.ts        GitHub workflow → native bash script (strict parser, census-tested)
  workerSandbox.ts         the only module that touches E2B: build machine (restricted egress), sign machine (no network)
  nativeSigning.ts         the fixed signing/validation script and its strict result parser
  nativeBuildStore.ts      Firestore: mobile_native_builds, mobile_signing_keys (sealed), mobile_signing_key_events
  nativeArtifactStore.ts   private bucket objects, md5-verified writes, streamed reads
  nativeBuildRunner.ts     start → advance (stateless, leased) → sign/validate → store → complete → charge
src/server/lib/mobileBuildCharge.ts  ONE build charge for both providers (moved out of /api/mobile-ship/artifacts)
src/server/routes/mobileBuilds.ts    /api/mobile-builds/* (below)
src/components/ide/AndroidBuildProviders.tsx  the button + the two-option sheet; GitHub renders StoreBuildPanel unchanged
src/components/ide/NativeBuildPanel.tsx       the native build screen
src/lib/mobileBuildClient.ts                  client types + shape guards for every server answer
infra/e2b/e2b-android-native.Dockerfile       the worker image
```

### Why the native build has no in-process build loop
The live service runs with `--min-instances 0` and no guaranteed CPU outside requests. So the build is
never "driven" by a promise in server memory:

1. `POST /api/mobile-builds` validates, records the job (`preparing`), runs the shared preparation (the same
   work the GitHub setup request does — up to a few minutes), translates the workflow, creates the build
   machine, writes the project, starts the script **detached** inside the machine, and returns (`building`).
2. The script writes its log and exit code to files inside the machine.
3. `advanceNativeBuild` moves a job one stage forward, from **any** instance, under a 3-minute lease taken in a
   single Firestore transaction. Every status request calls it; a sweeper on live instances calls it every 45 s.
4. On exit 0 the file is read, then a **fresh signing machine with no network** signs (AAB) and validates (both),
   the validated file is written to the private bucket and verified (size + md5), the job becomes `completed`,
   and only then is the build charged (idempotent on `native_<buildId>`).

A server restart therefore loses nothing; the next status request reattaches by sandbox id.

### States (both providers share the vocabulary)
`queued · preparing · building · signing · validating · uploading · completed · failed · cancelling · cancelled · expired`.
GitHub runs map through `normalizeGithubRun`. A state is shown only when a real event proves it.

---

## 2. Security and trust boundaries

| Boundary | Control |
|---|---|
| API server ↔ user code | The server never executes a user project. It writes files into a machine and reads one file back. |
| Build machine | One per build, killed after. No env var from the platform (not one), no credential, no signing key. Non-root `user`. Egress allow-list only: npm, Google Maven, Maven Central, Gradle plugin/distribution hosts (and the GitHub release storage Gradle distributions redirect to). Hard lifetime = build timeout + 20 min; the script itself runs under `timeout`. |
| Sign machine | Fresh, **no network**, runs only the fixed `SIGN_SCRIPT`. Receives the built file and (AAB) the key files; passwords travel as files (`-storepass:file`), never argv or env; an EXIT trap deletes the key files; the machine is killed after. No app code runs there — `jarsigner`, `apksigner`, `aapt2` and `bundletool` only read a zip. |
| Upload keys at rest | `mobile_signing_keys/{sk_<sha256(uid,appId)>}`: keystore and both passwords sealed with `secrets.ts` (AES-256-GCM, versioned keys, rotatable via the existing admin rotate path). Explicit consent recorded. Never returned to the browser (metadata only). Every import / create / use / replace / delete is an event in `mobile_signing_key_events`. |
| Tenant isolation | Every route verifies the Firebase identity first; ownership is read from the stored row; another user's build is answered exactly like a missing one (404). The browser view never carries sandbox ids, storage paths, key references or logs. |
| Input validation | Build ids `nb_<32 hex>`, request ids, application ids (Play rules), aliases (`[A-Za-z0-9._-]`), keystore ≤ 64 KB strict base64, project paths relative with no `..`. The browser never chooses a workflow, template, bucket, path or worker. |
| Logs | Last 300 lines, ANSI stripped, credential-shaped strings and private keys redacted, 400 chars per line. |
| Abuse | Per-account rate limit on start/import (10/min), one active build per user (`MOBILE_NATIVE_BUILD_MAX_ACTIVE_PER_USER`), system cap (`MOBILE_NATIVE_BUILD_MAX_ACTIVE`). |
| Firestore client access | The three collections fall under the rules' catch-all deny; only the admin SDK reads them. |

**Threats considered:** a malicious npm package or Gradle plugin (contained in the build machine: no
credentials, restricted egress, killed after); a build that forges a "signed" output (signing and validation
happen in a different machine, and the result is checked against the saved key's certificate, the expected
application id and versionCode); IDOR on build ids (owner checked from the row); replayed requests (idempotent
build id, idempotent charge); a crashed instance mid-build (stateless driver, leases, stale-driver and timeout
checks end it honestly and uncharged).

---

## 3. Signing and app identity

- **APK** — `assembleDebug`, signed with the Android debug key, exactly like the GitHub APK workflow. The UI and
  the build record say "Debug key — for installing and testing, not for Google Play".
- **AAB** — Gradle builds `bundleRelease` **unsigned** in the build machine; the sign machine signs it with
  `jarsigner -digestalg SHA-256` using the app's upload key, then `jarsigner -verify`, `bundletool validate`,
  manifest read (application id, versionCode, versionName, min/target SDK), and the certificate fingerprint is
  compared with the saved key's.
- **Never a silent new key.** An AAB build without a saved key is refused (`signing-key-required`). The user
  either **adds their existing key** (verified with a real `keytool` in a network-less machine before anything
  is saved — wrong store password, wrong alias, wrong key password and "not a keystore" are each named), or
  **creates a new one**, allowed only after confirming the app was never uploaded to Google Play; the new key is
  returned once for the user's own backup.
- **Coming from the GitHub option:** that flow handed the user `<repo>-upload.keystore` with its password and
  alias `upload` (PKCS12). Add exactly that file — the AAB then carries the same upload certificate Play knows.
- **Lost key:** the native option cannot recover it (nobody can). Under Play App Signing the developer asks Google
  for an **upload key reset** in Play Console and then imports the new key here.
- **versionCode:** minutes since the epoch at build creation. It only grows, needs no counter, and is far above any
  GitHub run number, so switching providers never goes backwards on Play.
- **Delete / rotate:** "Delete saved key" on the native screen (or `DELETE /api/mobile-builds/signing-key`);
  importing with `replace: true` rotates it (audited as `replaced`).

---

## 4. API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/mobile-builds/capabilities` | Both providers, availability, honest reason, price. Config names are never sent. |
| POST | `/api/mobile-builds` | `{ provider: 'native_cloud', kind, sessionId, appName, appId?, iconDataUrl?, backgroundColor?, powerLevel?, idempotencyKey }`. `github_actions` → 400 `use-github-flow` (that provider keeps `/api/mobile-ship/*`). Rate-limited. |
| GET | `/api/mobile-builds/history` | The caller's builds, newest first (retention applied on read). |
| GET | `/api/mobile-builds/:buildId` | Real status; also advances the build one stage. |
| GET | `/api/mobile-builds/:buildId/logs` | Sanitized log tail + failed step. |
| POST | `/api/mobile-builds/:buildId/cancel` | Queued → cancelled; running → cancelling → machine killed → cancelled. |
| GET | `/api/mobile-builds/:buildId/download` | Ownership-checked stream from the private bucket, `X-Checksum-SHA256`, no public URL. 410 when expired. |
| GET / DELETE | `/api/mobile-builds/signing-key?appId=` | Key metadata / delete. |
| POST | `/api/mobile-builds/signing-key/import` | `{ appId, keystoreBase64, alias, storePassword, keyPassword?, consent: true, replace? }` — verified before save. Rate-limited. |
| POST | `/api/mobile-builds/signing-key/generate` | `{ appId, appName, consent: true, confirmNeverPublished: true }`. Rate-limited. |

**Why the GitHub provider is not behind this API:** its flow is driven step by step from the panel (prepare →
dispatch → poll → repair → retry) and is long-hardened. Re-implementing it as a second server-side copy would
be duplicate code that drifts. Both providers share the preparation and the charge instead.

---

## 5. Billing (unchanged policy, one implementation)

`mobileBuildCharge.ts` is the single charge for both providers: `APK_CHARGE_INR` (default ₹1) per successful
build, `spends: 'paid-only'`, free-list and z-test accounts exempt, idempotent on the build ref. GitHub keeps
charging when its artifact appears (`apk_<owner>/<repo>#<artifactId>`); native charges after the validated file
is stored (`native_<buildId>`). A failed, cancelled, timed-out or expired native build is never charged. The
exemption is decided once from the verified identity at creation (no email is stored on the job).

⚠️ **Open business decision (not changed here):** like the GitHub lane, a native build whose paid balance cannot
cover the charge is still delivered (the debit is refused, the file is not withheld). The native provider *could*
withhold the download until paid, because it holds the file; doing so would be a pricing-policy change and needs
the admin's decision.

---

## 6. Deployment and configuration

All names below are environment variables on the Cloud Run service (names only — never put values in docs).

| Variable | Required | Meaning |
|---|---|---|
| `MOBILE_NATIVE_BUILD_ENABLED` | yes | `on` to offer Native Cloud Build. Default **off**. Turning it off never affects GitHub. |
| `MOBILE_NATIVE_BUILD_TEMPLATE` | yes | Alias of the published worker template (default name `navbharat-android-native`). |
| `E2B_API_KEY` | yes | Already set for the builder. |
| `MOBILE_BUILD_ARTIFACT_BUCKET` | yes* | Private bucket for native files. *Falls back to `FIREBASE_STORAGE_BUCKET`. |
| `SECRET_ENCRYPTION_KEY` / `SECRET_KEY_V<N>` | for AAB | Already set; seals upload keys. Without it only `.apk` is offered. |
| `MOBILE_GITHUB_BUILD_ENABLED` | no | Default **on**. `off` hides the GitHub option and refuses `/setup` and `/trigger` with 503. |
| `MOBILE_NATIVE_BUILD_MAX_ACTIVE_PER_USER` | no | Default 1 (1–5). |
| `MOBILE_NATIVE_BUILD_MAX_ACTIVE` | no | System-wide cap, default 4 (1–50). |
| `MOBILE_NATIVE_BUILD_TIMEOUT_MIN` | no | Default 25 (5–55). |
| `MOBILE_NATIVE_BUILD_RETENTION_DAYS` | no | Default 30 (1–365). |

**Owner steps, in order:**
1. **Build the worker template:** GitHub → Actions → "Build E2B Builder Template" → `template_kind: android-native`.
   Open the run summary for the alias. (Before production, pin `TEMURIN_17` / `TEMURIN_21` in the Dockerfile to
   `@sha256:` digests.)
2. **Bucket:** use a private bucket (no public access, uniform bucket-level access). Add a lifecycle rule deleting
   objects under `mobile-builds/` after `MOBILE_NATIVE_BUILD_RETENTION_DAYS` + 1 days (the app also deletes on
   expiry; the rule is the backstop). The Cloud Run service account needs `roles/storage.objectAdmin` on that
   bucket only.
3. **Set** `MOBILE_NATIVE_BUILD_TEMPLATE`, `MOBILE_BUILD_ARTIFACT_BUCKET` (Cloud Run → Edit & deploy new revision → Variables).
4. **Test** with `MOBILE_NATIVE_BUILD_ENABLED=on` on a test revision with no traffic (or briefly in production for an
   admin account): build an `.apk`, then an `.aab` with a created key; install the APK on a phone.
5. **Enable** for everyone by keeping `MOBILE_NATIVE_BUILD_ENABLED=on`.

**Rollback:** set `MOBILE_NATIVE_BUILD_ENABLED=off` — the option greys out with an honest reason, running native
builds still finish or time out on their own, files already built stay downloadable until they expire, and the
GitHub option is untouched. A code rollback is a normal revert of the PR; the GitHub routes' behaviour is unchanged
by it (they only gained the shared preparation, the shared charge and the optional kill switch).

**Monitoring:** the job rows (`mobile_native_builds`) carry state, error code, failed step, timings and the
template alias; key use is in `mobile_signing_key_events`; the server logs `[native-build] advance deferred` when a
machine could not be reached for one poll.

---

## 7. Verification record (2026-11-25)

Run in the development container with the same toolchain the image pins (JDK 21, Android SDK 35/36, build-tools
34/35/36, AGP 8.7.2, Gradle 8.11.1, bundletool 1.17.2):

- **Translated APK workflow → real Gradle:** `com.navbharat.chaitimer`, debug-signed, `apksigner verify` OK,
  minSdk 23, targetSdk 35 (2 min cold, ~1 min warm).
- **Translated AAB workflow → unsigned `bundleRelease` → signing script:** signed with an upload key from the
  existing generator; `jarsigner -verify` OK; `bundletool validate` OK; versionCode stamped; certificate equals the
  key's fingerprint; key files gone after.
- **Key verification:** good PKCS12 and JKS keys accepted with the right fingerprint; wrong store password, wrong
  alias, wrong key password (JKS) and a non-keystore each refused with their own code.
- **The whole orchestrator** (`tests/nativeCloudBuildRealGradle.test.ts`, opt-in): start → detached build → advance
  → sign/validate → store → completed → one charge, for both an APK and an AAB, with a replayed request starting
  nothing.

**Not yet verified, and why:** the worker image itself has not been built (no Docker daemon in the development
container) — the owner's template workflow is its first build. No E2B machine has been created from it, no
production bucket write has happened, no real-device install has been run. The GitHub provider was not re-run
end to end in this change (its code paths changed only by the shared preparation/charge refactor, covered by its
existing route and source tests).
