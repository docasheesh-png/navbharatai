# Play Store and App Store releases

> Moved verbatim out of `CLAUDE.md` on 2026-10-04 (admin: *"han"* to shrinking it — the file was 563 KB and was loaded into every message of every session). Read it before building or describing an `.aab` / `.ipa`. Nothing here was reworded; the rules in it are as binding as they were in `CLAUDE.md`. `CLAUDE.md` keeps a short summary and a pointer to this file.

## Play Store release — build a signed `.aab` on every roadmap/checkpoint completion (mandatory, admin-mandated 2026-07-10)

**NavBharatAI is now LIVE on the Google Play Store** (Android app package `com.navbharat.ai`,
a Capacitor shell). ⚠️ **BUNDLED MODE, not a remote wrapper** (corrected 2026-08-11 — this line
previously said "loads the hosted web app", which has been WRONG since the 2026-07-10 switch and would
mislead any session into thinking frontend fixes reach app users automatically). `capacitor.config.ts`
sets `webDir: 'dist'` with **no `server.url`**, so the app boots from its own bundled assets.
**What this means in practice:** a SERVER/backend change reaches installed app users immediately (API
calls are rewritten to the production origin by `src/lib/apiBase.ts`), but a FRONTEND change does NOT —
it is baked into `dist/` and needs a fresh signed `.aab`/`.ipa`. Locked by
`tests/nativeShellInvariants.test.ts`.

**⚠️ CORRECTION 2026-09-07 (admin, verbatim: "jab mai bolu tab ipa,aab banana hai") — this SUPERSEDES
the "on every milestone/phase" trigger that used to stand here.** A store build is now made **ONLY**
when the admin explicitly asks — never automatically on a roadmap phase completing, a checkpoint
shipping, or any other milestone. Do NOT build one on your own initiative for any reason; the
admin's word is the ONLY trigger.

**The trigger, and only the trigger:**
- 🔴 **SUPERSEDED 2026-10-04 — THE iOS BUILD NEEDS ITS OWN PERMISSION (admin, verbatim: "ios build mere
  bina permission karni hi nahi hai. bas aab banao!").** A request for a store build means the Android
  `.aab` ONLY (`android-aab.yml`, ref `main`). `ios-ipa.yml` is dispatched ONLY when the admin names iOS /
  `.ipa` / TestFlight in that request — never as a companion to an `.aab`, never on a session's own
  reading of "build the app". Why it matters: the iOS job runs on macOS runners, which GitHub bills at
  10× the minute rate, and on 2026-10-04 GitHub stopped starting every CI job ("recent account payments
  have failed or your spending limit needs to be increased", a $24 bill) on the same day both were built
  together.
- ~~**STANDING INSTRUCTION (admin 2026-08-24, verbatim: "jab jab mai bolu to aab aur ipa bana
  dena"): whenever the admin asks, build BOTH — the Android `.aab` AND the iOS `.ipa`, together.**~~
  Kept as history; the line above replaces it. Whatever is built is still polled to green in the
  background and its run URL reported back.
  ⚠️ Build from **`main`**, after the work is merged — an `.aab` cut from a feature branch is not
  the app anyone is shipping. And per the BUNDLED-MODE note above, a FRONTEND change reaches
  installed users ONLY through a fresh bundle, which is precisely why this instruction exists.
- ❌ A roadmap phase completing, a checkpoint shipping, or any other milestone is **NOT** a trigger
  on its own anymore — only the admin explicitly asking is. Each `.aab` run consumes CI and burns a
  Play `versionCode` (it auto-increments per run), which is exactly the cost this correction avoids
  paying on every merge.

**How to build it (the pipeline is real and already working — last green run: #4 on `main`):**
- The signed bundle is produced by **`.github/workflows/android-aab.yml`** (`workflow_dispatch`).
  It runs `npm ci` → `npm run build` → `npx cap sync android` → `./gradlew bundleRelease`, signs
  with the release keystore from repo secrets, auto-increments `versionCode` (= run number), and
  uploads the **`navbharatai-release-aab`** artifact (`app-release.aab`).
- **Trigger it after the checkpoint merges to `main`:** GitHub → Actions → "Build Android App
  Bundle (.aab, signed)" → Run workflow (branch `main`); or from a Claude session via the GitHub
  MCP `actions_run_trigger` on `android-aab.yml`, ref `main`. Then poll the run to green (same
  discipline as CI) and report the run URL to the admin.

**Honest boundaries (rule 6 — what Claude CAN and CANNOT do here):**
- Claude CAN trigger the workflow and confirm it goes green.
- 🟢 **ORGANIZATION DEVELOPER ACCOUNT (D-U-N-S) — STARTED. The admin asked for it on 2026-09-07
  ("DUNS account banwao"), which lifts the earlier deferral** (admin 2026-08-26: "yeh baad me karenge jab
  user badhenge"). The old ⛔ "do NOT start it" line stood here until that moment; it is replaced rather
  than deleted so the change of instruction is legible, and so no session stalls on an order that has
  been withdrawn. The full, verified conversion guide is `MOBILE_PUBLISHING.md` §10 — including the
  finding that the EXISTING account converts in place (no new account, no app transfer), the four
  easy-to-miss traps, and the fact that this is the ONLY thing that brings Doctor AI, Pharmacist, First
  Aid and Maternity back to the Play app.
  **What a session may do, and where the line is.** Almost all of this is admin work a session cannot
  touch: registering a company, applying to Dun & Bradstreet, and every click in Play Console. A session
  CAN do exactly one piece end to end — Track A's **HTML-file website verification**, because `public/`
  is copied into `dist/` and both serving paths serve `dist/`, so a file committed there is live at
  `https://navbharatai.com/<name>` on the next merge. Google issues that filename only AFTER the admin
  presses *Send verification request*, so a session waits for the admin to hand it over; it cannot be
  prepared in advance.
  🔒 **THE ORDER IS A COMPLIANCE REQUIREMENT, NOT A PREFERENCE.** `MEDICAL_PROFESSIONAL_IDS` in
  `src/lib/playCompliance.ts` may be touched ONLY after the org account is live AND the Health-apps
  declaration is filed. Reversing that order is a deceptive-behaviour violation that can ban the whole
  developer account — a far worse outcome than the rejected update it would be trying to fix.
  ⚠️ **AND IT IS A ONE-WAY DOOR:** Google does not convert an organization account back to an individual
  one. Going back would mean a brand-new account plus an app transfer.
  §10.6 records the separate HPR/ABDM doctor-verification plan, which **remains deferred** — it is a
  different thing that does NOT unlock the mobile app, and it must not be started without its own ask.
- Claude CANNOT set/rotate the signing keystore secrets (`ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) — that is a one-time
  admin setup (documented in the workflow header); the keystore is the app's permanent identity
  and must live only with the admin. If a secret is missing the workflow FAILS EARLY with an
  honest message — **never** hand back or fake an unsigned bundle (Play would reject it anyway).
- Claude CANNOT download the artifact or upload to Play Console, and CANNOT set the service-account
  secret. What happens after a green run depends on ONE repo secret:
  ✅ **AUTO-UPLOAD ALREADY EXISTS — do not build it, and do not tell the admin it is missing.**
  `android-aab.yml` has carried a **`upload_to_play`** workflow input and a real
  `r0adkll/upload-google-play` step since before 2026-09-14. Ticked, the freshly-signed bundle goes
  straight to Play's **INTERNAL testing track** (`track: internal`, `status: completed`); the admin
  still promotes it to production themselves, so the API can never publish to production on its own.
  Unticked (the default) the run just produces the downloadable artifact — byte-identical to before.
  🔴 **THE ONLY THING MISSING IS `PLAY_SERVICE_ACCOUNT_JSON`** (a GitHub REPO secret — the whole
  service-account JSON key). Without it the admin downloads `app-release.aab` and uploads by hand.
  Ticking the box WITHOUT the secret fails the run EARLY with a message naming the secret — it can
  never silently skip the upload and report success.
  ⚠️ It is NOT the same as `GOOGLE_PLAY_SA_JSON`, which is a CLOUD RUN env for verifying in-app
  purchases. Same JSON file may serve both if the account holds both permission sets, but they are
  two different places and each must be set separately.
  ⚠️ **CORRECTED 2026-09-14 — this bullet said automating the upload "is a future infra item" and
  that was FALSE for an unknown length of time**, so a session reading it would propose building a
  feature that already shipped, or tell the admin to upload by hand when one secret would have done
  it. **And it named the action as `r0adz0/upload-google-play` — a slug that does not exist.** The
  workflow's own comment records that exact typo as a real incident: GitHub resolves every `uses:`
  up front regardless of the `if:` guard, so the bad slug broke even artifact-only runs. A doc that
  propagates a typo already paid for is worse than a doc that says nothing.
- The iOS counterpart is `.github/workflows/ios-ipa.yml` (App Store `.ipa` → TestFlight); the same
  discipline applies. Trigger it via the GitHub MCP `actions_run_trigger` on `ios-ipa.yml`, ref `main`,
  with input `upload: true` to ship straight to TestFlight (leave it off for a signing dry-run artifact).

### iOS release — durable facts (admin-verified 2026-07-21, so no session re-litigates them)
- 🍎 **FOUR THINGS ARE HIDDEN ON iOS ON PURPOSE, and each has a named predicate — do NOT "restore"
  any of them.** `purchaseRail()` → `'none'` (no purchase at all: Guideline 3.1.1) ·
  `medicalFeaturesHidden(isNativeApp())` (the four medical AIs) · `shouldLoadPixel({ isNative })` →
  false (no Meta pixel ⇒ no ATT prompt) · `androidInstallsHidden(nativePlatformName())` (App Mart's
  **"Install on Android"** half — an `.apk` cannot install on an iPhone, so a `Download .apk` button
  there is a dead control, and listing another platform's app packages invites a Guideline 2.5.2 / 4.7
  question). The full table, with the reasoning and the App Review Notes line that covers all four, is
  `MOBILE_PUBLISHING.md` **§6.3**.
  🔴 **TWO OF THE FOUR WERE FOUND BY READING THE CODE WHILE WRITING SUBMISSION GUIDANCE — six days
  apart (2026-09-20 and 2026-09-26) — not by a test and not by a review.** Both were the same shape: a
  screen that is correct on Android, shipped unchanged to a platform where half of it cannot work.
  **So before any App Store submission the question is not "does the app build?" — it is "which screens
  are Android-shaped?"** Neither `tsc` nor a unit test can ask that.
  ⚠️ **Every one of these gates is on the PLATFORM, never on `isNativeApp()`.** A gate on the flag
  hides the feature from the ANDROID app too — which for purchases would delete real revenue and for
  App Mart would hide Android apps from the one device they install on. `isApplePlatform` in
  `storePurchase.ts` is the single owner of "is this iOS?"; import it, never re-match the string.
- **The persistent distribution cert IS set up and ACTIVE.** The admin has configured the repo secrets
  `IOS_DIST_CERT_P12_BASE64` + `IOS_DIST_CERT_PASSWORD` (verified 2026-07-21). So the Fastfile takes the
  `import_certificate` path (reuses ONE cert every run) — NOT `cert()` per run. **Apple's 2-distribution-
  cert cap is permanently solved; do NOT tell the admin to "activate the p12" or revoke certs before a
  build — it's already done.** (Confirm from a build log: the fastlane summary shows `import_certificate`,
  not `cert`.) The cert inside that p12 must never be revoked on the Apple portal or the p12 breaks.
- **Build number auto-increments** = `CFBundleVersion` stamped with `GITHUB_RUN_NUMBER` (Apple rejects a
  re-used build number). **Export compliance** is pre-answered (`ITSAppUsesNonExemptEncryption=false` in
  Info.plist) so no per-upload popup. Both are in the workflow — don't re-add them.
- **"Uploaded" ≠ "available in TestFlight".** The upload now WAITS for Apple to finish processing
  (`skip_waiting_for_build_processing: false`), so a green run means the build genuinely reached
  TestFlight (a processing failure now fails loudly instead of a silent green). **INTERNAL testers**
  (App Store Connect users, incl. the account owner) get every processed build automatically — no group
  or review. **EXTERNAL testers** need the build assigned to a group + Beta App Review: set the repo
  secret `IOS_TESTFLIGHT_GROUPS` (comma-separated external group names) and the Fastfile auto-submits +
  notifies them. The `changelog` workflow input sets the "What to Test" note (defaults to the build #).
  Root cause of a past "build succeeded but no update showed" report: the old `skip_waiting:true`
  reported success before processing, hiding failures.
- Claude CANNOT see App Store Connect. If a build uploaded green but a tester sees no update, the real
  diagnostic is the build's status in App Store Connect → TestFlight (Processing / Ready to Test /
  Missing Compliance / errored) — that check is the admin's (rule 6).
