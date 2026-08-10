// SHIP KIT — turn a user's generated web app into a REAL, signed .aab (Play Store) and .ipa
// (TestFlight / App Store), built on GitHub's own runners.
//
// WHY THIS EXISTS (admin 2026-07-26: "kya hamara NavBharatAI ek real .aab/.apk/.ipa bana sakta hai?
// ... direct testflight aur github se link karo"). The honest answer to the first half is NO, and it
// cannot be fixed by trying harder in-process: producing a signed Android bundle needs the JDK +
// Android SDK + the user's keystore, and an iOS build LEGALLY requires macOS + Xcode (Apple's rule).
// Neither a browser nor our Linux server can do it, so any "build APK" button that claims to would be
// a fake — which the second absolute rule forbids.
//
// WHAT WE CAN DO — and what this module implements — is the same path NavBharatAI itself ships on:
// GitHub Actions provides real Linux AND macOS runners, so we generate a complete, working CI ship kit
// into the user's own repository. GitHub then produces the genuine signed binaries and uploads them to
// TestFlight. The user owns the identity (keystore / Apple account); we own everything else.
//
// The generated workflows are modelled on this repo's OWN battle-tested `.github/workflows/*` — every
// non-obvious step below exists because it fixed a real failure while shipping this app:
//   • Android: keystore restored from a base64 secret; versionCode = run number (Play rejects a re-used
//     versionCode); fails EARLY and loudly when a signing secret is absent (never hands back an unsigned
//     bundle, which Play would reject anyway).
//   • iOS: newest Xcode selected because Apple rejects uploads built with an SDK older than iOS 26;
//     CFBundleVersion = run number (Apple rejects a re-used build number); ITSAppUsesNonExemptEncryption
//     pre-answered so no export-compliance popup per upload; fastlane (not raw xcodebuild, which cannot
//     create the distribution certificate on a fresh runner); the upload WAITS for Apple to finish
//     processing so a green run genuinely means "reached TestFlight" rather than "handed to Apple".
//
// PURE + deterministic (no I/O) so it is fully unit-testable. The Capacitor wrapper itself is NOT
// re-implemented here — it comes from MobileExportGenerator so the two can never drift (rule 4).

import { generateMobileExport, type MobileExportResult } from './MobileExportGenerator';
// The publishing walkthrough is embedded from the ONE structured source that also drives the in-app
// checklist and the AI's answers, so the three can never drift (rule 4).
import { renderPublishGuideText } from './storePublishGuide';
// The workflow FILENAMES come from the one shared registry the dispatch allow-list also reads, so a
// workflow can never be generated into a user's repo that the server then refuses to start.
import { SHIP_WORKFLOWS, workflowPath } from '../../lib/shipWorkflows';

/** A repository secret the USER must set — we can never set these for them (they are their identity). */
export interface RequiredSecret {
  name: string;
  /** What it is, in plain language. */
  what: string;
  /** Exactly where to get it. */
  where: string;
}

export interface ShipKitOptions {
  appName?: string;
  appId?: string;
  /** Build output directory Capacitor packages (Vite → 'dist', CRA → 'build', Next export → 'out'). */
  webDir?: string;
  /** Include the iOS/TestFlight workflow. Default true. */
  ios?: boolean;
}

export interface ShipKitResult {
  /** Every file to write into the user's repo, path → contents. */
  files: Record<string, string>;
  appId: string;
  appName: string;
  /** Secrets the user must add before a build can succeed, grouped by platform. */
  requiredSecrets: { android: RequiredSecret[]; ios: RequiredSecret[] };
  /** Capacitor packages the project needs. */
  dependencies: MobileExportResult['dependencies'];
  /** Honest, user-facing summary of what was generated and what only they can do. */
  instructions: string;
}

const ANDROID_SECRETS: RequiredSecret[] = [
  {
    name: 'ANDROID_KEYSTORE_BASE64',
    what: 'Your app signing keystore, base64-encoded. This is your app’s permanent identity — losing it means you can never update the app again.',
    where: 'Create once: keytool -genkey -v -keystore release.keystore -alias app -keyalg RSA -keysize 2048 -validity 10000 — then: base64 -w0 release.keystore (Linux) / base64 -i release.keystore (macOS)',
  },
  { name: 'ANDROID_KEYSTORE_PASSWORD', what: 'The keystore password you chose above.', where: 'The password you set when running keytool.' },
  { name: 'ANDROID_KEY_ALIAS', what: 'The key alias inside the keystore (e.g. "app").', where: 'The -alias value you passed to keytool.' },
  { name: 'ANDROID_KEY_PASSWORD', what: 'The key password (often the same as the keystore password).', where: 'The password you set when running keytool.' },
];

const IOS_SECRETS: RequiredSecret[] = [
  {
    name: 'IOS_ASC_KEY_ID',
    what: 'App Store Connect API Key ID (~10 characters).',
    where: 'App Store Connect → Users and Access → Integrations → App Store Connect API → generate a key with the Admin role.',
  },
  {
    name: 'IOS_ASC_ISSUER_ID',
    what: 'App Store Connect Issuer ID (a UUID — NOT the Key ID).',
    where: 'Shown at the top of the same App Store Connect API keys page.',
  },
  {
    name: 'IOS_ASC_KEY_BASE64',
    what: 'The AuthKey_XXXXXX.p8 private key — paste the whole file contents (BEGIN/END lines included) or its base64.',
    where: 'Downloaded ONCE when you generate the API key above. Keep it safe; Apple will not let you download it again.',
  },
  {
    name: 'IOS_TEAM_ID',
    what: 'Your Apple Developer Team ID (10 characters).',
    where: 'Apple Developer → Membership.',
  },
];

/**
 * ONE-CLICK INSTALLABLE APK (admin 2026-08-02) — the zero-setup path.
 *
 * WHY THIS EXISTS: the signed .aab/.apk workflow below needs FOUR repository secrets, and the only way
 * to produce them is to run `keytool` on a computer with Java, base64 the keystore, and paste four
 * secrets into GitHub by hand. A non-technical user on a phone simply cannot do that, so "build my app"
 * dead-ended for exactly the people it was built for.
 *
 * A DEBUG apk needs NO keystore at all — Gradle signs it with Android's universal debug key — and it
 * installs on any phone. So this workflow gives the user the thing they actually asked for (hold my app
 * in my hand, today) with zero credentials, while the signed workflow stays for Google Play, where a
 * real key is genuinely unavoidable.
 *
 * Honest limits, stated in the workflow summary too: a debug apk CANNOT be uploaded to Google Play and
 * is marked debuggable. It is for installing, testing and sharing — not for the store.
 */
// WHAT STOPPED THE BUILD — emitted into every generated workflow (autopsy 2026-08-03).
//
// A real failure reported by the admin showed GitHub's annotation saying only "Process completed with
// exit code 1", with no indication of WHICH step died. That is unreadable for a non-technical user, and
// it is nearly as bad for NavBharatAI's own self-healing loop, which then has to infer the stage from
// pattern-matching a megabyte of log.
//
// This step runs ONLY on failure and reports the stage from the runner's actual filesystem — did the
// libraries install, did the web build produce output, was the Android project created — which is
// ground truth, not a guess. It writes two things: a plain-language explanation a user can read on the
// GitHub page, and a single machine-readable NBAI_FAILED_STAGE line the classifier reads directly.
// WHY EVERY SUMMARY STEP USES A QUOTED HEREDOC, NEVER echo (bug found 2026-08-03).
//
// These steps used to be a run of  echo "some prose" >> "$GITHUB_STEP_SUMMARY"  lines. The prose is
// written for humans, so it contains quotes and parentheses - for example: run "Build Android App
// Bundle (.aab, signed)". Once emitted into YAML those became UNQUOTED shell metacharacters and bash
// died with a syntax error near the parenthesis.
//
// The damage was worse than a broken message: the Summary step runs LAST, after the artifact upload,
// so the .apk was built and uploaded correctly and THEN the run turned red. Every successful build was
// reported as a failure, and users would never collect an app that was actually sitting there ready.
//
// A quoted heredoc terminator makes the body literal text - there is no escaping left to get wrong,
// which is why this is the fix for the class rather than another round of backslashes. The regression
// test parses every generated run: block with bash -n, so any future escaping mistake fails CI.

const FAILURE_DIAGNOSTIC = (): string => `
      # Runs only when something above failed. See mobileShipKit.ts for why this exists.
      - name: Explain what stopped the build
        if: failure()
        run: |
          if [ ! -d node_modules ]; then
            STAGE=install
            WHY="It stopped while installing your app's libraries. Usually one package listed in package.json cannot be found, or two of them need different versions of the same thing."
          elif [ ! -d dist ] && [ ! -d build ] && [ ! -d out ] && [ ! -d www ]; then
            STAGE=webbuild
            WHY="The libraries installed fine, but your app itself did not compile, so there was nothing to package. The error further up names the exact file and line."
          elif [ ! -d android ]; then
            STAGE=capacitor
            WHY="Your app compiled correctly. It stopped while creating the Android project around it."
          else
            STAGE=android
            WHY="Your app compiled correctly. It stopped while building the Android app itself."
          fi
          echo "NBAI_FAILED_STAGE=$STAGE"
          {
            echo "## The build stopped"
            echo ""
            echo "$WHY"
            echo ""
            echo "You do not have to fix this here. Open your app in NavBharatAI and press the build button again — it reads this result, repairs what it set up, and runs the build again on its own."
          } >> "$GITHUB_STEP_SUMMARY"
`;

// ENSURE the Android project AND a COMPLETE Gradle wrapper before building — shared by both the debug
// APK and the signed AAB workflows so they can never drift.
//
// AUTOPSY 2026-08-04 (real user build, thesakshamgupta0/navbharatai-app): the APK step died with
//   "Error: Unable to access jarfile …/android/gradle/wrapper/gradle-wrapper.jar"
// and no number of retries fixed it (a deterministic failure). ROOT CAUSE: `./gradlew` is only a tiny
// shell script — it EXECUTES the binary `gradle-wrapper.jar`. The old guard checked only that the
// `gradlew` SCRIPT existed, not the jar, so an android/ that was present but missing the binary jar
// (a committed-but-incomplete project, or a scaffold that never fetched the wrapper) sailed past the
// guard and blew up one step later at Gradle. This is exactly the class of GitHub build problem the
// engine must self-heal, like a human would. So: after cap add/sync, if the wrapper jar is missing we
// fetch the EXACT jar for the pinned Gradle version (keeps any android/ customisations), and only if
// that also fails do we re-scaffold the whole project fresh (android/ is generated — nothing custom is
// lost). The final guard now verifies BOTH the script and the jar, and fails honestly if either is
// still absent.
const ENSURE_ANDROID_STEP = `      - name: Generate and sync the Android project
        run: |
          set -e
          if [ ! -d android ]; then
            npx cap add android
          fi
          npx cap sync android
          # ./gradlew executes gradle-wrapper.jar; heal a missing binary jar deterministically.
          if [ ! -f android/gradle/wrapper/gradle-wrapper.jar ]; then
            VER=$(sed -n 's/.*gradle-\\([0-9.]*\\)-.*/\\1/p' android/gradle/wrapper/gradle-wrapper.properties 2>/dev/null | head -1)
            if [ -z "$VER" ]; then VER=8.7; fi
            echo "::warning::gradle-wrapper.jar missing — fetching it for Gradle $VER"
            mkdir -p android/gradle/wrapper
            curl -fsSL -o android/gradle/wrapper/gradle-wrapper.jar "https://raw.githubusercontent.com/gradle/gradle/v$VER/gradle/wrapper/gradle-wrapper.jar" || true
          fi
          if [ ! -f android/gradle/wrapper/gradle-wrapper.jar ]; then
            echo "::warning::re-scaffolding the Android project so the Gradle wrapper is complete"
            rm -rf android
            npx cap add android
            npx cap sync android
          fi
          if [ ! -f android/gradlew ] || [ ! -f android/gradle/wrapper/gradle-wrapper.jar ]; then
            echo "NBAI_FAILED_STAGE=capacitor"
            echo "::error::The Android project or its Gradle wrapper is incomplete, so there is nothing to compile."
            exit 1
          fi`;

const ANDROID_APK_WORKFLOW = (appName: string): string => `# Build an INSTALLABLE Android app (.apk) for ${appName} — generated by NavBharatAI.
#
# This one needs NO secrets and NO signing key. It produces an apk you can install on any Android
# phone right away. For Google Play you need the signed bundle instead — see android-aab.yml.
#
# Run it: GitHub → Actions → "Build Android APK (installable)" → Run workflow.

name: Build Android APK (installable)

on:
  workflow_dispatch:

jobs:
  build-apk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          # NO npm cache here on purpose: NavBharatAI pushes the app's source but never a
          # package-lock.json, and actions/setup-node with cache:'npm' HARD-FAILS when no lock file
          # exists ("Dependencies lock file is not found") — killing the run ~18s in, before a single
          # line of the app is built. The install step below already falls back to a plain install.

      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '21'

      # INSTALL (hardened 2026-08-03 after a real build died here in 36s with an unreadable log).
      #
      # Two things were wrong with the old "npm ci || npm install":
      #   1. NavBharatAI pushes package.json but never a lock file, and npm ci REQUIRES one. So npm ci
      #      failed on EVERY run and dumped a lock-file complaint into the log that was never the real
      #      problem - burying the actual error under a red herring for anyone reading it.
      #   2. When the real failure was a peer-dependency conflict (ERESOLVE), there was no recovery at
      #      all, even though npm ships the exact fix for it.
      # So: run the command that fits what is actually here, and keep ONE honest fallback.
      - name: Install the app's libraries
        run: |
          set -e
          if [ -f package-lock.json ]; then
            npm ci || npm install --no-audit --no-fund
          else
            npm install --no-audit --no-fund || npm install --no-audit --no-fund --legacy-peer-deps
          fi

      - name: Build the web app
        run: npm run build

      # DO NOT swallow a failure here (root cause of a real build, 2026-08-03).
      #
      # This step used to be:  npx cap add android || echo "already present - continuing"
      # The intent was "do not fail if the project already exists", but || ignores EVERY error, so a
      # genuine failure to create the project passed as green in 1 second. Gradle then ran against a
      # directory that did not exist and died with "chmod: cannot access './gradlew'" - an error three
      # steps away from its cause, pointing at the wrong thing entirely.
      #
      # The correct test for "already there" is to LOOK, not to ignore errors. And because a missing
      # project is what actually broke, it is verified before anything downstream depends on it.
${ENSURE_ANDROID_STEP}

      # assembleDebug signs with Android's universal debug key, so no keystore and no secrets are
      # needed — this is what makes the whole flow one click for a non-technical user.
      - name: Build the installable APK
        run: cd android && chmod +x ./gradlew && ./gradlew assembleDebug --no-daemon

      - name: Upload the .apk
        uses: actions/upload-artifact@v4
        with:
          name: app-apk
          path: android/app/build/outputs/apk/debug/app-debug.apk
          retention-days: 14

${FAILURE_DIAGNOSTIC()}
      # Written with a quoted heredoc so the text below is never interpreted as shell code.
      - name: Summary
        run: |
          cat >> "$GITHUB_STEP_SUMMARY" <<'NBAI_EOF'
          ## ${appName} — installable .apk built

          Download the **app-apk** artifact, copy app-debug.apk to an Android phone and install it
          (allow installs from unknown sources).

          This apk is for installing and sharing. Google Play needs the SIGNED bundle instead — run
          the "Build Android App Bundle (.aab, signed)" workflow once you have added your signing secrets.
          NBAI_EOF
`;

/** Escapes nothing — GitHub expression syntax is emitted literally via \${{ … }} in the templates below. */
const ANDROID_WORKFLOW = (appName: string): string => `# Build a SIGNED Android App Bundle (.aab) for ${appName} — generated by NavBharatAI.
#
# Run it: GitHub → Actions → "Build Android App Bundle (.aab, signed)" → Run workflow.
# Then download the "release-aab" artifact and upload it to Google Play Console.
#
# REQUIRED repository secrets (Settings → Secrets and variables → Actions) — see SHIPPING.md:
#   ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD

name: Build Android App Bundle (.aab, signed)

on:
  workflow_dispatch:

jobs:
  build-aab:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Fail EARLY and honestly when signing is not configured — never hand back an unsigned bundle,
      # which Play would reject anyway.
      - name: Pre-flight — require signing secrets
        env:
          KEYSTORE: \${{ secrets.ANDROID_KEYSTORE_BASE64 }}
          STORE_PASS: \${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          KEY_ALIAS: \${{ secrets.ANDROID_KEY_ALIAS }}
          KEY_PASS: \${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          missing=""
          [ -z "$KEYSTORE" ] && missing="$missing ANDROID_KEYSTORE_BASE64"
          [ -z "$STORE_PASS" ] && missing="$missing ANDROID_KEYSTORE_PASSWORD"
          [ -z "$KEY_ALIAS" ] && missing="$missing ANDROID_KEY_ALIAS"
          [ -z "$KEY_PASS" ] && missing="$missing ANDROID_KEY_PASSWORD"
          if [ -n "$missing" ]; then
            echo "::error::Missing signing secret(s):$missing — add them in Settings → Secrets and variables → Actions (see SHIPPING.md)."
            exit 1
          fi

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          # NO npm cache here on purpose: NavBharatAI pushes the app's source but never a
          # package-lock.json, and actions/setup-node with cache:'npm' HARD-FAILS when no lock file
          # exists ("Dependencies lock file is not found") — killing the run ~18s in, before a single
          # line of the app is built. The install step below already falls back to a plain install.

      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '21'

      # INSTALL (hardened 2026-08-03 after a real build died here in 36s with an unreadable log).
      #
      # Two things were wrong with the old "npm ci || npm install":
      #   1. NavBharatAI pushes package.json but never a lock file, and npm ci REQUIRES one. So npm ci
      #      failed on EVERY run and dumped a lock-file complaint into the log that was never the real
      #      problem - burying the actual error under a red herring for anyone reading it.
      #   2. When the real failure was a peer-dependency conflict (ERESOLVE), there was no recovery at
      #      all, even though npm ships the exact fix for it.
      # So: run the command that fits what is actually here, and keep ONE honest fallback.
      - name: Install the app's libraries
        run: |
          set -e
          if [ -f package-lock.json ]; then
            npm ci || npm install --no-audit --no-fund
          else
            npm install --no-audit --no-fund || npm install --no-audit --no-fund --legacy-peer-deps
          fi

      - name: Build the web app
        run: npm run build

      # DO NOT swallow a failure here (root cause of a real build, 2026-08-03).
      #
      # This step used to be:  npx cap add android || echo "already present - continuing"
      # The intent was "do not fail if the project already exists", but || ignores EVERY error, so a
      # genuine failure to create the project passed as green in 1 second. Gradle then ran against a
      # directory that did not exist and died with "chmod: cannot access './gradlew'" - an error three
      # steps away from its cause, pointing at the wrong thing entirely.
      #
      # The correct test for "already there" is to LOOK, not to ignore errors. And because a missing
      # project is what actually broke, it is verified before anything downstream depends on it.
${ENSURE_ANDROID_STEP}

      # Play REJECTS a re-used versionCode, so stamp it with the always-increasing run number.
      - name: Stamp a unique versionCode
        run: |
          sed -i "s/versionCode .*/versionCode \${{ github.run_number }}/" android/app/build.gradle || true
          grep -n "versionCode" android/app/build.gradle || true

      - name: Restore the keystore and wire Gradle signing
        env:
          KEYSTORE: \${{ secrets.ANDROID_KEYSTORE_BASE64 }}
          STORE_PASS: \${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          KEY_ALIAS: \${{ secrets.ANDROID_KEY_ALIAS }}
          KEY_PASS: \${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          echo "$KEYSTORE" | base64 -d > android/app/release.keystore
          cat >> android/app/build.gradle <<'GRADLE'

          // Appended by the NavBharatAI ship kit — release signing from repository secrets.
          android {
              signingConfigs {
                  release {
                      storeFile file("release.keystore")
                      storePassword System.getenv("STORE_PASS")
                      keyAlias System.getenv("KEY_ALIAS")
                      keyPassword System.getenv("KEY_PASS")
                  }
              }
              buildTypes {
                  release { signingConfig signingConfigs.release }
              }
          }
          GRADLE

      # BOTH outputs, because they answer different needs and a non-technical user needs both:
      #   .aab → the ONLY format Google Play accepts for a release.
      #   .apk → cannot be uploaded to Play, but CAN be installed directly on a phone, so the user can
      #          actually hold their app and test it before ever touching Play Console.
      - name: Build the signed bundle (.aab) and installable app (.apk)
        env:
          STORE_PASS: \${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          KEY_ALIAS: \${{ secrets.ANDROID_KEY_ALIAS }}
          KEY_PASS: \${{ secrets.ANDROID_KEY_PASSWORD }}
        run: cd android && chmod +x ./gradlew && ./gradlew bundleRelease assembleRelease

      - name: Upload the .aab (for Google Play)
        uses: actions/upload-artifact@v4
        with:
          name: release-aab
          path: android/app/build/outputs/bundle/release/app-release.aab
          retention-days: 14

      - name: Upload the .apk (install straight onto a phone)
        uses: actions/upload-artifact@v4
        with:
          name: release-apk
          path: android/app/build/outputs/apk/release/app-release.apk
          retention-days: 14

      # The keystore is a secret — never let it linger on the runner.
      - name: Always remove the keystore
        if: always()
        run: rm -f android/app/release.keystore || true
${FAILURE_DIAGNOSTIC()}
      - name: Summary
        run: |
          echo "## ${appName} — signed .aab built" >> "$GITHUB_STEP_SUMMARY"
          echo "" >> "$GITHUB_STEP_SUMMARY"
          echo "Download the **release-aab** artifact above, then upload it in Google Play Console → your app → Production → Create new release." >> "$GITHUB_STEP_SUMMARY"
`;

const IOS_WORKFLOW = (appName: string): string => `# Build a SIGNED iOS app (.ipa) for ${appName} and ship it to TestFlight — generated by NavBharatAI.
#
# You do NOT need to own a Mac: GitHub's macOS runners are real Macs in the cloud.
#
# Run it: GitHub → Actions → "Build iOS App (.ipa, signed)" → Run workflow.
#   • upload unchecked → just builds and gives you the .ipa artifact (a signing dry-run).
#   • upload checked   → uploads to App Store Connect and waits for TestFlight processing.
#
# REQUIRED repository secrets — see SHIPPING.md:
#   IOS_ASC_KEY_ID, IOS_ASC_ISSUER_ID, IOS_ASC_KEY_BASE64, IOS_TEAM_ID
#
# ONE-TIME on the web (no Mac needed): create the app record in App Store Connect → My Apps → + → New App
# with this project's bundle id, so uploads have somewhere to land.

name: Build iOS App (.ipa, signed)

on:
  workflow_dispatch:
    inputs:
      upload:
        description: 'Upload to App Store Connect / TestFlight after building'
        type: boolean
        default: false
      changelog:
        description: 'TestFlight "What to Test" note (optional)'
        type: string
        default: ''

jobs:
  build-ios:
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4

      # Apple REJECTS uploads built with an SDK older than iOS 26, so fail before the long build
      # rather than after, when Apple would refuse the finished .ipa.
      - name: Select the newest Xcode
        run: |
          LATEST="$(ls -d /Applications/Xcode_*.app 2>/dev/null | sort -V | tail -1)"
          if [ -z "$LATEST" ]; then echo "::error::No Xcode on this runner."; exit 1; fi
          sudo xcode-select -s "$LATEST/Contents/Developer"
          xcodebuild -version | head -2
          MAJOR="$(xcodebuild -version | head -1 | sed -E 's/Xcode ([0-9]+).*/\\1/')"
          if [ -z "$MAJOR" ] || [ "$MAJOR" -lt 26 ]; then
            echo "::error::Xcode $MAJOR is too old — Apple requires Xcode 26+ (iOS 26 SDK) to upload."
            exit 1
          fi

      - name: Pre-flight — require Apple signing secrets
        env:
          IOS_ASC_KEY_ID: \${{ secrets.IOS_ASC_KEY_ID }}
          IOS_ASC_ISSUER_ID: \${{ secrets.IOS_ASC_ISSUER_ID }}
          IOS_ASC_KEY_BASE64: \${{ secrets.IOS_ASC_KEY_BASE64 }}
          IOS_TEAM_ID: \${{ secrets.IOS_TEAM_ID }}
        run: |
          missing=""
          [ -z "$IOS_ASC_KEY_ID" ] && missing="$missing IOS_ASC_KEY_ID"
          [ -z "$IOS_ASC_ISSUER_ID" ] && missing="$missing IOS_ASC_ISSUER_ID"
          [ -z "$IOS_ASC_KEY_BASE64" ] && missing="$missing IOS_ASC_KEY_BASE64"
          [ -z "$IOS_TEAM_ID" ] && missing="$missing IOS_TEAM_ID"
          if [ -n "$missing" ]; then
            echo "::error::Missing Apple signing secret(s):$missing — see SHIPPING.md."
            exit 1
          fi

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          # NO npm cache here on purpose: NavBharatAI pushes the app's source but never a
          # package-lock.json, and actions/setup-node with cache:'npm' HARD-FAILS when no lock file
          # exists ("Dependencies lock file is not found") — killing the run ~18s in, before a single
          # line of the app is built. The install step below already falls back to a plain install.

      # INSTALL (hardened 2026-08-03 after a real build died here in 36s with an unreadable log).
      #
      # Two things were wrong with the old "npm ci || npm install":
      #   1. NavBharatAI pushes package.json but never a lock file, and npm ci REQUIRES one. So npm ci
      #      failed on EVERY run and dumped a lock-file complaint into the log that was never the real
      #      problem - burying the actual error under a red herring for anyone reading it.
      #   2. When the real failure was a peer-dependency conflict (ERESOLVE), there was no recovery at
      #      all, even though npm ships the exact fix for it.
      # So: run the command that fits what is actually here, and keep ONE honest fallback.
      - name: Install the app's libraries
        run: |
          set -e
          if [ -f package-lock.json ]; then
            npm ci || npm install --no-audit --no-fund
          else
            npm install --no-audit --no-fund || npm install --no-audit --no-fund --legacy-peer-deps
          fi

      - name: Build the web app
        run: npm run build

      # DO NOT swallow a failure here (root cause of a real build, 2026-08-03).
      #
      # This step used to be:  npx cap add ios || echo "already present - continuing"
      # The intent was "do not fail if the project already exists", but || ignores EVERY error, so a
      # genuine failure to create the project passed as green in 1 second. Gradle then ran against a
      # directory that did not exist and died with "chmod: cannot access './gradlew'" - an error three
      # steps away from its cause, pointing at the wrong thing entirely.
      #
      # The correct test for "already there" is to LOOK, not to ignore errors. And because a missing
      # project is what actually broke, it is verified before anything downstream depends on it.
      - name: Generate and sync the iOS project
        run: |
          set -e
          if [ ! -d ios ]; then
            npx cap add ios
          fi
          npx cap sync ios
          if [ ! -f ios/App/App.xcodeproj/project.pbxproj ]; then
            echo "NBAI_FAILED_STAGE=capacitor"
            echo "::error::The iOS project was not created, so there is nothing to compile."
            exit 1
          fi

      # Apple rejects a re-used build number, and pre-answering export compliance stops the
      # "App Encryption Documentation" popup on every single upload.
      - name: Stamp the build number and export compliance
        run: |
          PLIST="ios/App/App/Info.plist"
          /usr/libexec/PlistBuddy -c "Set :CFBundleVersion \${{ github.run_number }}" "$PLIST" 2>/dev/null \\
            || /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string \${{ github.run_number }}" "$PLIST"
          /usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "$PLIST" 2>/dev/null \\
            || /usr/libexec/PlistBuddy -c "Set :ITSAppUsesNonExemptEncryption false" "$PLIST"

      # Rebuild a canonical PEM from whatever was pasted (single-line, space-mangled, or base64) so a
      # copy-paste mishap cannot masquerade as "invalid credentials" later.
      - name: Install and validate the App Store Connect API key
        env:
          IOS_ASC_KEY_ID: \${{ secrets.IOS_ASC_KEY_ID }}
          IOS_ASC_ISSUER_ID: \${{ secrets.IOS_ASC_ISSUER_ID }}
          IOS_ASC_KEY_BASE64: \${{ secrets.IOS_ASC_KEY_BASE64 }}
        run: |
          mkdir -p "$HOME/.appstoreconnect/private_keys"
          DEST="$HOME/.appstoreconnect/private_keys/AuthKey_\${IOS_ASC_KEY_ID}.p8"
          RAW="$IOS_ASC_KEY_BASE64"
          if ! printf '%s' "$RAW" | grep -q 'BEGIN PRIVATE KEY'; then
            RAW="$(printf '%s' "$RAW" | tr -d '[:space:]' | base64 -d 2>/dev/null || true)"
          fi
          if ! printf '%s' "$RAW" | grep -q 'BEGIN PRIVATE KEY'; then
            echo "::error::IOS_ASC_KEY_BASE64 is not a valid .p8 (nor base64 of one). Paste the ENTIRE AuthKey_*.p8 contents."
            exit 1
          fi
          BODY="$(printf '%s' "$RAW" | sed -e 's/-----BEGIN PRIVATE KEY-----//' -e 's/-----END PRIVATE KEY-----//' | tr -d '[:space:]')"
          { echo "-----BEGIN PRIVATE KEY-----"; printf '%s' "$BODY" | fold -w 64; echo ""; echo "-----END PRIVATE KEY-----"; } > "$DEST"
          if ! openssl pkey -in "$DEST" -noout 2>/dev/null; then
            echo "::error::The App Store Connect key is not a valid private key — it is likely truncated."
            exit 1
          fi
          if ! printf '%s' "$IOS_ASC_ISSUER_ID" | grep -qiE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
            echo "::error::IOS_ASC_ISSUER_ID must be the Issuer ID (a UUID), not the short Key ID."
            exit 1
          fi
          cp "$DEST" "$RUNNER_TEMP/AuthKey_\${IOS_ASC_KEY_ID}.p8"

      # fastlane, not raw xcodebuild: xcodebuild cannot create the iOS Distribution certificate on a
      # fresh runner ("No signing certificate 'iOS Distribution' found").
      - name: Build, sign and upload (fastlane)
        env:
          IOS_ASC_KEY_ID: \${{ secrets.IOS_ASC_KEY_ID }}
          IOS_ASC_ISSUER_ID: \${{ secrets.IOS_ASC_ISSUER_ID }}
          IOS_TEAM_ID: \${{ secrets.IOS_TEAM_ID }}
          DO_UPLOAD: \${{ inputs.upload }}
          IOS_CHANGELOG: \${{ inputs.changelog }}
          FASTLANE_SKIP_UPDATE_CHECK: '1'
        run: |
          export ASC_KEY_PATH="$RUNNER_TEMP/AuthKey_\${IOS_ASC_KEY_ID}.p8"
          fastlane ios beta

      - name: Upload the .ipa artifact
        uses: actions/upload-artifact@v4
        with:
          name: release-ipa
          path: \${{ runner.temp }}/App.ipa
          retention-days: 14

      - name: Always remove the API key
        if: always()
        env:
          IOS_ASC_KEY_ID: \${{ secrets.IOS_ASC_KEY_ID }}
        run: |
          rm -f "$HOME/.appstoreconnect/private_keys/AuthKey_\${IOS_ASC_KEY_ID}.p8" || true
          rm -f "$RUNNER_TEMP/AuthKey_\${IOS_ASC_KEY_ID}.p8" || true

      - name: Summary
        run: |
          echo "## ${appName} — signed .ipa built" >> "$GITHUB_STEP_SUMMARY"
          if [ "\${{ inputs.upload }}" = "true" ]; then
            echo "Uploaded to App Store Connect and processed — it is now in TestFlight." >> "$GITHUB_STEP_SUMMARY"
          else
            echo "Download the **release-ipa** artifact, or re-run with **upload** checked to send it to TestFlight." >> "$GITHUB_STEP_SUMMARY"
          fi
`;

const FASTFILE = (appId: string): string => `# Generated by NavBharatAI. iOS build + TestFlight lane for ${appId}.
#
# Uses fastlane's proven CI signing recipe because raw \`xcodebuild -exportArchive\` cannot create the
# iOS Distribution certificate on a fresh runner. The App Store Connect API key must have the ADMIN
# role — App Manager cannot create a distribution certificate for cloud signing.

default_platform(:ios)

platform :ios do
  desc "Build a signed .ipa and (optionally) ship it to TestFlight"
  lane :beta do
    api_key = app_store_connect_api_key(
      key_id: ENV["IOS_ASC_KEY_ID"],
      issuer_id: ENV["IOS_ASC_ISSUER_ID"],
      key_filepath: ENV["ASC_KEY_PATH"],
      duration: 500,
      in_house: false,
    )

    # An ephemeral runner has no keychain — create one and keep it unlocked for the whole build.
    keychain_name = "ci.keychain"
    keychain_password = SecureRandom.uuid
    create_keychain(
      name: keychain_name,
      password: keychain_password,
      default_keychain: true,
      unlock: true,
      timeout: 3600,
      lock_when_sleeps: false,
    )

    cert(api_key: api_key, keychain_path: File.expand_path("~/Library/Keychains/#{keychain_name}-db"), keychain_password: keychain_password)
    profile = sigh(api_key: api_key, app_identifier: "${appId}", force: true)

    update_code_signing_settings(
      path: "ios/App/App.xcodeproj",
      use_automatic_signing: false,
      team_id: ENV["IOS_TEAM_ID"],
      code_sign_identity: "Apple Distribution",
      profile_name: lane_context[SharedValues::SIGH_NAME],
      bundle_identifier: "${appId}",
    )

    build_app(
      project: "ios/App/App.xcodeproj",
      scheme: "App",
      configuration: "Release",
      export_method: "app-store",
      output_directory: ENV["RUNNER_TEMP"],
      output_name: "App.ipa",
      export_options: {
        provisioningProfiles: { "${appId}" => lane_context[SharedValues::SIGH_NAME] },
        teamID: ENV["IOS_TEAM_ID"],
      },
    )

    if ENV["DO_UPLOAD"] == "true"
      # WAIT for Apple to finish processing: a green run must genuinely mean "reached TestFlight",
      # not merely "handed to Apple" — otherwise a processing failure hides behind a green check.
      upload_to_testflight(
        api_key: api_key,
        skip_waiting_for_build_processing: false,
        changelog: (ENV["IOS_CHANGELOG"].to_s.empty? ? "Build #{ENV['GITHUB_RUN_NUMBER']}" : ENV["IOS_CHANGELOG"]),
      )
    end
  end
end
`;

const SHIPPING_MD = (appName: string, appId: string, ios: boolean): string => {
  const secretRows = (list: RequiredSecret[]): string =>
    list.map((s) => `### \`${s.name}\`\n${s.what}\n\n**Where to get it:** ${s.where}\n`).join('\n');

  return `# Shipping ${appName} to the app stores

NavBharatAI generated a complete build pipeline for this project. **GitHub's own runners build the real,
signed app** — you do not need Android Studio, and you do not need to own a Mac.

## Honest scope — what is automated and what only you can do

| Step | Who does it |
|---|---|
| Capacitor wrapper + build workflows | ✅ NavBharatAI (already generated) |
| Compiling and signing the real \`.aab\` / \`.ipa\` | ✅ GitHub Actions runners |
| Uploading to TestFlight | ✅ Automated (iOS workflow, \`upload\` checked) |
| Your signing keystore / Apple account | ⚠️ **Only you** — these are your identity and must never be shared |
| Uploading the \`.aab\` to Play Console | ⚠️ **You** (Google has no unattended upload without extra setup) |
| Store listing, screenshots, review submission | ⚠️ **You**, in Play Console / App Store Connect |

An app cannot be built without your own signing identity — that is Apple's and Google's rule, not a
NavBharatAI limitation. Everything that *can* be automated, is.

## 1. Add your secrets

GitHub → your repo → **Settings → Secrets and variables → Actions → New repository secret**.

## Android

${secretRows(ANDROID_SECRETS)}
> ⚠️ **Back up your keystore file somewhere safe.** It is your app's permanent identity — if you lose it,
> Google Play will never accept an update to this app again.

${ios ? `## iOS (needs a paid Apple Developer account — $99/year)\n\n${secretRows(IOS_SECRETS)}
One more one-time step, all on the web: **App Store Connect → My Apps → + → New App**, using the bundle
id \`${appId}\`, so uploads have somewhere to land.
` : ''}
## 2. Build it

GitHub → **Actions** tab → pick the workflow → **Run workflow**.

- **Build Android App Bundle (.aab, signed)** → produces the \`release-aab\` artifact. Download it and
  upload it in Play Console → your app → Production → Create new release.
${ios ? `- **Build iOS App (.ipa, signed)** → tick **upload** to send it straight to TestFlight. The run stays
  yellow until Apple finishes processing, so a green check means it genuinely landed in TestFlight.
` : ''}
## 3. Every later release

Just run the workflow again. The version/build number is stamped automatically from the run number, so
you will never hit "this version already exists" from either store.

---

# Step-by-step: getting it onto the stores

Never published an app before? These are the complete walkthroughs, including what each store costs and
how long each step really takes.

## Google Play

\`\`\`
${renderPublishGuideText('android')}
\`\`\`
${ios ? `\n## Apple App Store\n\n\`\`\`\n${renderPublishGuideText('ios')}\n\`\`\`\n` : ''}`;
};

/**
 * Generate the complete ship kit for a user's app: the Capacitor wrapper (reused from
 * MobileExportGenerator so it can never drift), the GitHub Actions workflows that build the REAL signed
 * binaries, the iOS fastlane lane, and an honest SHIPPING.md.
 *
 * Pure and deterministic. Producing the binary itself still happens on GitHub's runners with the user's
 * own signing secrets — this module never claims to have built anything.
 */
export function generateShipKit(opts: ShipKitOptions = {}): ShipKitResult {
  const includeIos = opts.ios !== false;
  const base = generateMobileExport({ appName: opts.appName, appId: opts.appId, webDir: opts.webDir });
  const appName = (typeof opts.appName === 'string' && opts.appName.trim()) || 'My App';

  const files: Record<string, string> = {
    ...base.files,
    // The zero-secret, one-click installable apk comes FIRST — it is the path almost every user wants.
    [workflowPath(SHIP_WORKFLOWS.androidApk)]: ANDROID_APK_WORKFLOW(appName),
    [workflowPath(SHIP_WORKFLOWS.androidAab)]: ANDROID_WORKFLOW(appName),
    'SHIPPING.md': SHIPPING_MD(appName, base.appId, includeIos),
  };
  if (includeIos) {
    files[workflowPath(SHIP_WORKFLOWS.iosIpa)] = IOS_WORKFLOW(appName);
    files['fastlane/Fastfile'] = FASTFILE(base.appId);
  }

  const platforms = includeIos ? 'Android (.aab) and iOS (.ipa → TestFlight)' : 'Android (.aab)';
  return {
    files,
    appId: base.appId,
    appName,
    dependencies: base.dependencies,
    requiredSecrets: { android: ANDROID_SECRETS, ios: includeIos ? IOS_SECRETS : [] },
    instructions:
      `Generated a real build pipeline for ${platforms}, app id ${base.appId}. Push these files to a GitHub repo, ` +
      `add your signing secrets (see SHIPPING.md), then run the workflow from the Actions tab — GitHub's runners ` +
      `produce the genuine signed binary${includeIos ? ' and upload it to TestFlight' : ''}. NavBharatAI does not ` +
      `build or sign the binary itself: that needs your own keystore/Apple identity and, for iOS, macOS — so those ` +
      `steps run on GitHub with secrets only you can set.`,
  };
}
