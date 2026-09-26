# NavBharatAI — Mobile App Publishing Runbook (Play Store + App Store)

This is the end-to-end guide to ship NavBharatAI as a native mobile app to **Google Play** and the
**Apple App Store**. It is honest about what is already done in this repo and what only *you* can do
(store accounts cost money, and an iOS build **requires a Mac** — Apple's hard rule).

The app uses **Capacitor in BUNDLED MODE** (switched from hosted mode 2026-07-10): the native shell ships the
built web app INSIDE the APK/IPA (true native polish — splash screen, status bar, back-button handling) and
rewrites `/api/*` calls to `https://navbharatai.com` via the transport interceptor. Auth, payments, and every
API call work exactly as on the web. This is a genuine, store-installable app — not a bookmark.

---

## 0. What is already done in this repo ✅

- `capacitor.config.ts` — appId `com.navbharat.ai`, appName `NavBharatAI`, bundled mode, iOS + Android.
- `@capacitor/core`, `@capacitor/android`, `@capacitor/ios`, `@capacitor/cli` — all installed (v8.4.1).
- `android/` — the full native Android project is committed and ready to build.
- `public/manifest.json` + mobile meta tags — PWA basics in place.
- npm scripts: `mobile:sync`, `mobile:android`, `mobile:ios`.
- **The App Store payments blocker is closed** — the iPhone app can no longer open a web checkout
  (`purchaseRail()` returns `'none'` on iOS), Android is untouched. See §5.

## What only YOU can do (external, unavoidable) ⚠️

| Task | Why it's not automatable here |
|------|------|
| Google Play Console account (~$25 one-time) | Paid account tied to your identity |
| Apple Developer account ($99/year) | Paid; required for App Store + TestFlight |
| An Apple **App Store Connect API key** for the iOS build | Your Apple identity — created on the web (no Mac needed); the build itself runs on GitHub's cloud macOS runner (§4.0). A local Mac is optional (§4.1). |
| App signing keys (Android keystore, iOS certs) | Secrets that must live only with you |
| Uploading builds + store listings + review | Done in Play Console / App Store Connect under your account |

---

## 1. One-time prerequisites

**On your build machine (Mac strongly recommended — it can do BOTH Android and iOS):**
- Node 20+, `npm install` in this repo.
- **Android:** [Android Studio](https://developer.android.com/studio) (gives the SDK + `gradle` + emulator).
- **iOS (Mac only):** Xcode (from the Mac App Store) + `sudo gems install cocoapods` (or `brew install cocoapods`).

**Accounts:**
- Google Play Console: https://play.google.com/console (pay the one-time $25).
- Apple Developer Program: https://developer.apple.com/programs/ ($99/year).

---

## 2. App icons & splash (do this once, before first build)

Store review rejects low-res / wrong-shape icons. You need **one high-res square source**:
- `assets/icon.png` — **1024×1024**, no transparency (Apple rejects alpha on the store icon).
- `assets/splash.png` — **2732×2732**, your logo centered on a solid background (`#0d1117`).

Then generate every required size automatically (no repo dependency needed — runs via `npx`):

```bash
mkdir -p assets           # drop icon.png (1024) + splash.png (2732) here
npx @capacitor/assets generate --iconBackgroundColor '#0d1117' --splashBackgroundColor '#0d1117'
```

This writes all Android mipmaps + iOS AppIcon sets. (No 1024 source yet? Export one from the NavBharatAI
logo in Figma/Canva, or use https://icon.kitchen or https://www.appicon.co to build the set, then drop the
files into `android/app/src/main/res/` and the Xcode asset catalog.)

---

## 3. Ship to Google Play (Android)

### ⭐ 3.0 EASIEST — build the signed `.aab` in GitHub Actions (no Android Studio needed)
A ready workflow **`.github/workflows/android-aab.yml`** builds the **signed** `.aab` on GitHub's
runners, so you don't need Android Studio / the SDK on your own machine — you only supply your
keystore ONCE as repo secrets (it is never committed, never seen by anyone). One-time:

1. Create the keystore on any machine with Java (`keytool`), keep the `.jks` + passwords safe:
   ```bash
   keytool -genkeypair -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 \
     -validity 10000 -alias navbharatai
   ```
2. Base64-encode it: `base64 -w0 upload-keystore.jks > keystore.b64` (macOS: `base64 -i upload-keystore.jks -o keystore.b64`).
3. Repo → **Settings → Secrets and variables → Actions** → add 4 secrets:
   `ANDROID_KEYSTORE_BASE64` (the keystore.b64 contents), `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS` (=`navbharatai`), `ANDROID_KEY_PASSWORD`.
4. Repo → **Actions → "Build Android App Bundle (.aab, signed)" → Run workflow** (main).
5. Download the **navbharatai-release-aab** artifact → that's your `app-release.aab` → jump to §3.4.

`versionCode` auto-increments per run (Play requires it to increase every upload). Sections 3.1–3.3
below are the equivalent MANUAL path if you prefer building locally in Android Studio instead.

### 3.1 Create a signing keystore (once — keep it FOREVER; losing it means you can't update the app)
```bash
keytool -genkey -v -keystore navbharatai-release.keystore \
  -alias navbharatai -keyalg RSA -keysize 2048 -validity 10000
```
Store the keystore + passwords in a safe place (a password manager). Never commit it.

### 3.2 Wire the keystore into the Gradle release build
Create `android/keystore.properties` (git-ignored — see §7) with:
```
storeFile=/absolute/path/to/navbharatai-release.keystore
storePassword=********
keyAlias=navbharatai
keyPassword=********
```
Android Studio → open the `android/` folder → it reads `signingConfigs` from this file (or set it in
**Build → Generate Signed Bundle**).

### 3.3 Build the release AAB
```bash
npm run build            # produces dist/ (the webDir cap sync needs)
npx cap sync android     # copies web assets + plugins into the native project
cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```
(Or in Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle**.)

### 3.4 Upload to Play Console
1. Play Console → **Create app** → name "NavBharatAI", default language, "App", "Free".
2. **Production → Create new release** → upload `app-release.aab`.
3. Fill: **store listing** (title, short + full description, screenshots — see §6), **content rating**
   questionnaire, **Data safety** form, **Privacy Policy URL** (required — host one at
   `https://navbharatai.com/privacy`).
4. Enable **Play App Signing** when prompted (Google manages the upload key — recommended).
5. Submit for review. First review: a few days.

---

## 4. Ship to the App Store (iOS)

### ⭐ 4.0 EASIEST — build the signed `.ipa` in GitHub Actions (NO Mac needed)
You do **not** need to own a Mac. GitHub's **macOS runners are real Macs in the cloud**, and the ready
workflow **`.github/workflows/ios-ipa.yml`** does the entire iOS build + sign + upload there. The only
thing it needs from you is your Apple identity — supplied as an **App Store Connect API key** (a `.p8`
file you create on the web; no Mac, no Keychain, no manual certificates). With that one key, Xcode on the
runner auto-creates the distribution certificate + provisioning profile (`-allowProvisioningUpdates`).

One-time (all on the web):
1. **App Store Connect → Users and Access → Integrations → App Store Connect API** → generate a key with
   the **Admin** role (App Manager cannot create the distribution certificate for cloud signing). Download `AuthKey_XXXXXX.p8` (downloadable once — keep it safe). Note the
   **Key ID** and the **Issuer ID** (UUID at the top of the Keys page).
2. **Apple Developer → Membership** → copy your **Team ID** (10 chars).
3. **App Store Connect → My Apps → +** → New App → Bundle ID `com.navbharat.ai`, name "NavBharatAI".
4. Base64-encode the key: `base64 -w0 AuthKey_XXXXXX.p8` (macOS: `base64 -i AuthKey_XXXXXX.p8`).
5. Repo → **Settings → Secrets and variables → Actions** → add 4 secrets:
   `IOS_ASC_KEY_ID`, `IOS_ASC_ISSUER_ID`, `IOS_ASC_KEY_BASE64` (step 4 output), `IOS_TEAM_ID`.
6. Repo → **Actions → "Build iOS App (.ipa, signed)" → Run workflow** (main). Leave **upload** unchecked
   for a signing dry-run (download the `.ipa` artifact); check **upload** to send it to TestFlight.

> **iOS permissions are handled automatically (2026-07-15).** The app uses the microphone (Sonic voice) +
> camera + photo library — Apple review REJECTS a build that requests a permission without a purpose string
> in `Info.plist`. The CI workflow injects `NSMicrophoneUsageDescription`, `NSCameraUsageDescription`,
> `NSPhotoLibraryUsageDescription`, and `NSPhotoLibraryAddUsageDescription` into the freshly-generated
> `ios/App/App/Info.plist` before archiving, so you don't have to add them by hand. If you build MANUALLY on
> a Mac (§4.1), add the same four keys in Xcode (App target → Info) before archiving, or review will reject it.

Sections 4.1 below are the equivalent MANUAL path if you prefer building locally on your own Mac in Xcode.

### 4.1 Manual path (on a Mac)

The `ios/` native project is **not committed** (it's generated on the Mac where it's built). On your Mac:

```bash
npm install
npm run build
npx cap add ios          # generates the ios/ project (first time only)
npx cap sync ios
npx cap open ios         # opens ios/App/App.xcworkspace in Xcode
```

In Xcode:
1. Select the **App** target → **Signing & Capabilities** → check "Automatically manage signing" → pick
   your **Team** (your Apple Developer account). Bundle identifier = `com.navbharat.ai`.
2. Set the **App Icon** in `Assets.xcassets` (from §2), a version, and a build number.
3. **Product → Archive** → when it finishes, **Distribute App → App Store Connect → Upload**.
4. In https://appstoreconnect.apple.com → **My Apps → +** → create "NavBharatAI" with bundle id
   `com.navbharat.ai`. Attach the uploaded build.
5. Fill listing (screenshots for 6.7" + 6.1" iPhone are mandatory — see §6), privacy details, and submit.
6. Use **TestFlight** first to test on a real device before submitting for review.

---

## 4.5 Native sign-in on iOS (Google + Apple)

The app offers **Google**, **Apple**, and GitHub sign-in. On the installed iOS app, Google and Apple use
the device's **native** sheet (not a web popup). Here is exactly what is wired vs. what needs a one-time
console toggle.

**Google (already wired — just rebuild the `.ipa`):** the `ios-ipa.yml` workflow copies
`ios-config/GoogleService-Info.plist` into the generated project and adds its `REVERSED_CLIENT_ID` as a
URL scheme, so native Google Sign-In returns to the app. **If Google login "doesn't work" on your
installed iPhone app, you are almost certainly on an OLD TestFlight build — rebuild via Actions → "Build
iOS App (.ipa, signed)" and reinstall.** (Nothing in the repo blocks it.)

**Apple (needs 3 one-time toggles, then rebuild with the opt-in flag):**
1. **Apple Developer → Certificates, Identifiers & Profiles → Identifiers → `com.navbharat.ai` → tick
   "Sign In with Apple" → Save.** This enables the capability on the App ID so the provisioning profile
   can carry the `com.apple.developer.applesignin` entitlement. (One reliable checkbox — the build does
   NOT auto-enable this; `produce` can't authenticate with an App Store Connect API key.)
2. **Firebase Console → Authentication → Sign-in method → Apple → Enable.** (Without this, Apple login
   errors at runtime even with a perfect build — the app shows an honest "provider isn't enabled" message.)
3. **Rebuild with the flag on:** Actions → "Build iOS App (.ipa, signed)" → Run workflow → tick
   **"Enable native Sign in with Apple"**. That run injects the entitlement + points the App target at it,
   and `sigh force:true` regenerates a profile that includes it (step 1 is what makes that profile valid).
   Leave the flag OFF for a normal Google-only build (the default).

Apple's App Store guideline **4.8** *requires* "Sign in with Apple" wherever you offer a third-party login
like Google — so enabling it is also needed to pass review.

---

## 5. 🚨 Payments policy — DONE IN CODE. Read this before touching a purchase screen.

Apple and Google **require their own billing** for digital goods bought *inside* the app. NavBharatAI
sells **credits/wallet top-ups** — those are digital goods. Apple Guideline 3.1.1 is not a risk to
weigh, it is a **certain rejection**, and every App Store build is read by a human reviewer.

### 5.1 What the code does TODAY (shipped 2026-09-20, PR #3202)

🔴 **This section used to describe the v1 strategy as "already decided" and told the next reader to
`Capacitor.isNativePlatform()` and hide the buy buttons. It was decided in 2026-07 and NOT BUILT until
2026-09-20 — a grep of every `isNativeApp()` call site returned zero purchase gates for fourteen
months. It is built now, and it is built NARROWER than the old text said. Do not implement it again,
and do not widen it.**

`purchaseRail()` in `src/lib/storePurchase.ts` answers one question — *may this device buy?* — and
returns a third state, **`'none'`**:

| Where | Rail | What the user sees |
|---|---|---|
| **iPhone / iPad** (`platform === 'ios'`) | **`'none'`** | an honest "top-up is not available in this app" notice |
| **Android** | `'play-billing'` or `'web-gateway'` | unchanged — Play Billing where configured, the web rail otherwise |
| **Web browser** | `'web-gateway'` | unchanged |

⚠️ **THE GATE IS ON THE PLATFORM, NEVER ON `isNative`, and the difference is revenue.** Hiding top-up
on `isNativeApp()` — which is exactly what the old text above instructed — would also remove the
**working, revenue-earning Android top-up**. Android is a Play-billing problem with a Play-billing
answer (`STORE_BILLING`, §Google Play in-app purchases in `CLAUDE.md`); iOS is a *no rail exists yet*
problem. One predicate, `isApplePlatform(platform)`, checked BEFORE every other rung, because on iOS
there is nothing to fall back to: Play Billing does not exist there and the web gateway is the very
thing Apple rejects.

🔒 **It is a chokepoint, not four hidden buttons.** Four screens can start a top-up, so
`createBillingOrder` in `usePaymentEngine` **refuses on `'none'`** as well. A surface nobody remembered
to gate still cannot open a checkout.

### 5.2 ⛔ Do NOT add "you can top up on the website" anywhere in the app

The old text said the app "can *show* the balance and say **'add credits on the web'**" and "link out
to the website's *account* page". **That is anti-steering, and Apple forbids it** — pointing a user at
an external purchase path from inside the app is its own rejection, separate from 3.1.1. This account
has already taken one policy strike (the medical-features rejection), so the shipped notice
deliberately says only this, and stops:

> **Top-up is not available in this app**
> You cannot add credit from inside the iPhone app yet. Everything else is unchanged — your balance,
> your apps, and any credit you already have all work exactly as they do everywhere else.

No link, no price comparison, no hint that a cheaper path exists. `ProfilePage` was corrected for the
same reason: on iOS its row reads **"Wallet · Balance and history"**, never "Add Balance · Recharge via
UPI / Card" — a row naming a payment method it cannot open is the same broken promise one screen
earlier.

### 5.3 The real v2, when it is wanted

Selling credits inside the iPhone app needs **StoreKit** — Apple's own in-app purchase, with Apple's
cut, a product catalogue in App Store Connect and a server-side receipt check. That is the same shape
as the Play Billing rail already built (`storeBilling.ts` / `storeVerify.ts` /
`POST /api/payment/store/verify`), so the server half largely exists; what is missing is the Apple
plugin, the products, and the receipt verification against Apple. **It is a project, not a flag** — and
the app ships and earns on Android and the web meanwhile, which is why hiding the UI was the right
first move rather than a stopgap.

🔒 Test-locked in `tests/theIphoneCannotOpenACheckout.test.ts`, including a source-level guard that
every `purchaseRail(` call site in `src/` passes a platform, and an anti-steering guard over the
user-facing copy. Four reversions are proven to fail.

---

## 6. Store assets checklist (both stores)

- **App icon** — 1024×1024 (no alpha for iOS).
- **Screenshots** — Play: phone (min 2). App Store: 6.7" (1290×2796) **and** 6.1" (1179×2556), min 3 each.
- **Feature graphic** (Play) — 1024×500.
- **Short description** (Play, 80 chars) + **full description**.
- **Privacy Policy URL** — mandatory on both. Host at `https://navbharatai.com/privacy`.
- **Support URL / email**.
- **Content rating** (Play questionnaire) + **age rating** (App Store).
- **Data safety** (Play) / **App Privacy** (App Store) — declare what data the app collects. **Be
  accurate: a declaration that contradicts the published Privacy Policy is a violation, not a
  mismatch.** §6.1 below is a draft App Privacy answer sheet derived from the code, row by row.

### 6.1 App Privacy (App Store) — a DRAFT answer sheet, derived from the code

⚠️ **This is a draft for the admin to check and file, not a filed declaration** — only the admin can
open App Store Connect. Every row below names the code that makes it true, so each one can be
re-verified instead of trusted. **Re-grep before filing**: this sheet is dated, and `main` moves.

🔴 **Why it is written down at all.** On 2026-09-02 this project's own Privacy Policy said *"we never
share your data with advertisers"* while the Meta pixel was being built — caught before either
shipped. A store declaration that contradicts the policy is a **violation, not a mismatch**, in both
stores. So the declaration is derived from the code and the policy together, never from memory.

| Apple category | Answer for the **iOS** app | Why — the code that decides it |
|---|---|---|
| **Contact Info → Email** | Collected · linked to the user · App Functionality | Firebase Auth sign-in |
| **Identifiers → User ID** | Collected · linked · App Functionality | the account id every build and chat is stored under |
| **Identifiers → Device ID** | Collected · linked · App Functionality | the push token, `src/lib/pushNotifications.ts`, native only |
| **User Content** (prompts, files, built apps) | Collected · linked · App Functionality | the product itself; Policy §2.1/§2.2 |
| **Usage Data → Product Interaction** | Collected · linked · Analytics | `trackEvent` (`src/lib/analytics.ts`) sends `userId`, and is **consent-gated** by `hasAnalyticsConsent()` |
| **Purchases** | **NOT collected** | `purchaseRail()` returns `'none'` on iOS — the app cannot take a payment at all (§5.1) |
| **Health & Fitness** | **NOT collected** | Doctor AI / Pharmacist / First Aid / Maternity are hidden on every native shell — `medicalFeaturesHidden(isNativeApp())`, `src/lib/playCompliance.ts` |
| **Third-party advertising** | **NONE in the app** | the Meta pixel refuses to load on a native shell — `shouldLoadPixel(… isNative …)` returns false, wired at `src/main.tsx` |
| **Tracking (ATT prompt)** | **No** — so no `NSUserTrackingUsageDescription` and no ATT prompt | nothing on iOS links activity to third-party data; the pixel is web-only and the Meta **Android** SDK is Android-only |
| **Diagnostics / Crash data** | **NOT collected** | there is no crash reporter in the app; the Sentry references in this repo are code the BUILD ENGINE writes into *users'* apps, not ours |

**Server-side visit counting** (Policy §11.1) sets no cookie, downloads no script and stores nothing on
the device; the daily-rotating hash cannot be joined to an account. It is covered by the Usage Data row
above rather than needing one of its own.

### 6.2 What review will ask for besides the form

- **Privacy Policy URL** — `https://navbharatai.com/privacy`. It is server-rendered HTML with no JS and
  no auth, deliberately, because Apple and Meta fetch such links with tools that may not run
  JavaScript.
- **A working test account** in App Review Notes — a reviewer who cannot sign in rejects the build. Use
  an account that is **not** on `AGENTV3_FREE_LIST` if you want the reviewer to see what a real user
  sees, or one that is, if you would rather they never hit a balance wall. Either is defensible; an
  empty wallet with no way to top up (§5.1) is not.
- **Say in the notes that top-up is intentionally unavailable on iOS**, so the reviewer reads the
  notice as a deliberate design rather than a broken screen.

### 6.3 What the iPhone app deliberately does NOT do — the four iOS-only suppressions

A reviewer meeting any of these without explanation reads a broken screen. Each is a code decision
with a named predicate, so each can be re-verified rather than trusted, and each belongs in the App
Review Notes.

| Suppressed on iOS | The predicate that does it | Why |
|---|---|---|
| **Wallet top-up / any purchase** | `purchaseRail()` → `'none'` (`src/lib/storePurchase.ts`) | Guideline 3.1.1 — digital goods must go through StoreKit, which is not built (§5.1/§5.3). No external path is offered and no "cheaper on the web" copy exists anywhere (§5.2) |
| **The four medical AIs** (Doctor AI, Pharmacist, First Aid, Maternity) | `medicalFeaturesHidden(isNativeApp())` (`src/lib/playCompliance.ts`) | written for Play's organization-account rule, and it hides them on EVERY native shell, so the App Privacy answer *Health & Fitness: not collected* is true |
| **The Meta advertising pixel** | `shouldLoadPixel({ isNative })` → false (`src/lib/metaPixel.ts`) | no tracking on iOS ⇒ no ATT prompt and no `NSUserTrackingUsageDescription`, which is what makes *Tracking: No* honest |
| **App Mart's "Install on Android" half** | `androidInstallsHidden(nativePlatformName())` (`src/lib/appStoreCompliance.ts`) | an `.apk` cannot install on iOS, so a "Download .apk" button is a dead control — and an iOS app listing another platform's installable packages invites a Guideline 2.5.2 / 4.7 question for a capability nobody there can use |

🔴 **The fourth was added 2026-09-26 and was found by READING THE CODE while writing §4–§6 guidance,
exactly as the §5.1 payment blocker was on 2026-09-20.** Both had the same shape: a page that is
correct on Android, shipped unchanged to a platform where half of it cannot work. **When the next iOS
submission is prepared, the question to ask is not "does the app build?" — it is "which screens are
Android-shaped?"**

🔒 **The gate is the PLATFORM, never `isNativeApp()`** — the rule §5.1 already paid for. A gate on the
flag would hide Android apps from the **Android** app, which is the one place they install. And the
chokepoint is the LIST (`visibleAndroidApps`), not the section's visibility: five surfaces read that
list, and gating them one at a time is an inventory the sixth is missing from.

⚠️ **Three things it deliberately leaves alone**, so nobody widens it later: the instant-app half
(runs in the WebView, and is why the page is worth having on iOS), the **My apps** tab (a record of
the creator's own submissions — status text, no download, nothing distributed), and the Publish tab's
steps for building an Android app **of your own project** (a builder explaining how to produce an
artifact is not a store handing one out — that is NavBharatAI's actual product).

**For the App Review Notes**, one line covers all four:
> *On iOS this app intentionally does not offer in-app purchases, health-related assistants,
> advertising/tracking, or Android app downloads. Those sections are hidden by design on Apple
> devices; everything visible is fully functional.*

---

## 7. Avoid the "just a website" rejection (Apple Guideline 4.2 / Google minimum functionality)

A pure WebView wrapper *can* be rejected for "not enough native value". To be safe, add at least one real
native capability before the App Store submission (Android review is more lenient):
- ✅ **Push notifications** (`@capacitor-firebase/messaging`, admin 2026-07-26) — build-finished / low-balance
  alerts. Highest value. **DONE** — see §7.5 for the two remaining one-time console steps.
- **Native share** (`@capacitor/share`), **status bar** styling (`@capacitor/status-bar`), **splash
  screen** (`@capacitor/splash-screen`).

If the App Store reviewer pushes back with 4.2, push notifications (already wired) almost always resolves it.

### 7.5 Push notifications — what's built vs. the two one-time console steps left

**Built (code-complete, admin 2026-07-26):** `@capacitor-firebase/messaging` (same plugin family as the
already-shipped `@capacitor-firebase/authentication` — it bridges APNs↔FCM internally on iOS, so the
server only ever deals in FCM tokens on both platforms). Client requests permission + registers the FCM
token against the signed-in user (`src/lib/pushNotifications.ts`, wired from the auth listener in
`App.tsx`); server stores tokens per-user in Firestore (`src/server/lib/DeviceTokenStore.ts`) and sends via
`admin.messaging()` (`src/server/lib/PushNotificationService.ts`), using the SAME Firebase project the app
already authenticates against (`gen-lang-client-0866594388`) — no new infrastructure. Two real triggers are
wired: a build finishing (success or failure) and the wallet hitting ₹0.

**Android:** works as soon as this ships — `google-services.json` is already committed, and
`npx cap sync android` (already in `android-aab.yml`) auto-registers the plugin via manifest merge. Nothing
else to do.

**iOS: two one-time steps only YOU can do (then rebuild with the toggle on)** — the `ios-ipa.yml` workflow
has an `enable_push_notifications` input, **default OFF** until these are done (turning it on before they're
done would break the build's provisioning-profile step):
1. **Apple Developer → Certificates, Identifiers & Profiles → Identifiers → `com.navbharat.ai` → tick "Push
   Notifications" → Save.** (Same one-reliable-checkbox pattern as the Sign in with Apple capability in §4.5
   — the build can't enable this itself with an App Store Connect API key.)
2. **Firebase Console → Project Settings → Cloud Messaging → Apple app configuration (com.navbharat.ai) →
   upload an APNs Authentication Key** (a `.p8` you generate once in Apple Developer → Certificates → Keys →
   + → "Apple Push Notifications service (APNs)"). Without this, Firebase has no way to actually hand a
   push to Apple's servers — the app would register a token successfully but never receive anything.
3. **Rebuild with the flag on:** Actions → "Build iOS App (.ipa, signed)" → Run workflow → tick **"Include
   the push-notifications entitlement"**. That run injects `aps-environment` + forces the provisioning
   profile to regenerate (step 1 is what makes the regenerated profile valid). Leave OFF for a build without
   push (today's default — nothing changes for users until you do steps 1–2 and rebuild with the flag on).

---

## 7.6 Ad conversion measurement — running Facebook / Instagram ads for installs

**Why this section exists:** Meta can only optimise an ad campaign for an outcome it can OBSERVE.
With nothing reporting back, the only campaign type available is **Traffic**, which optimises for
link clicks — the budget goes to people who tap the ad, not to people who install, sign up or pay.
An **App Promotion / App Install** campaign cannot even be created for an app Meta has no signal
from. The code for both halves is already in the repo; each stays completely inert until you supply
its credential, so nothing below changes the app until you decide.

### Step 1 — create the Meta app (only you can do this)
1. developers.facebook.com → **My Apps → Create App** → choose a **Business** app.
2. Add the **Facebook Login for Business**-free product you need: under **App settings → Basic**,
   scroll to **Add platform → Android**. Enter package name `com.navbharat.ai` and the default
   activity class `com.navbharatai.app.MainActivity`.
   ⚠️ The package (`com.navbharat.ai`) and the internal namespace (`com.navbharatai.app`) genuinely
   differ in this project — that is deliberate and correct, see `android/app/build.gradle`.
3. From **App settings → Basic**, copy the **App ID** and the **Client Token**.

### Step 2 — turn on the ANDROID half (app installs)
Repo → Settings → Secrets and variables → Actions → add **both**:

| Secret | Value |
|---|---|
| `FACEBOOK_APP_ID` | the App ID from step 1 |
| `FACEBOOK_CLIENT_TOKEN` | the Client Token from step 1 |

Both are required together — an app id without a client token cannot initialise, and a
half-configured SDK is exactly the "built but not really working" state that must not ship.

Then run **Actions → Build Android App Bundle (.aab, signed)** on `main`. The run summary states, in
words, whether Meta app events are ON or off in that bundle, so a downloaded `.aab` is never
ambiguous. Upload it to Play as usual.

> 🚨 **Before you roll that bundle out, update Play Console → App content → Data safety.** A build
> with these secrets set collects the **advertising ID** and app events. Shipping that collection
> without declaring it is a policy violation, not a detail. With the secrets unset, the Facebook SDK
> is not in the bundle at all and nothing about your Data safety answers changes.

> The app runs in **bundled mode**, so this only reaches users through a **new `.aab`** — there is no
> way to enable it for already-installed copies from the server.

### Step 3 — turn on the WEB half (signups and purchases)
1. Meta **Events Manager → Connect data sources → Web → Pixel**, and copy the **Pixel ID**.
2. Cloud Run → the `navbharat-ai-prod` service → **Edit & deploy new revision → Variables** → add
   `META_PIXEL_ID` = that id. It takes effect on the next page load; no rebuild is needed.
   ⚠️ It must be `META_PIXEL_ID`, **not** `VITE_META_PIXEL_ID`. A `VITE_` variable is frozen when the
   Docker image is built, so setting that name in Cloud Run would silently do nothing.
3. Verify: open navbharatai.com, **accept** the consent banner, and check that a request to
   `connect.facebook.net` appears in the browser's Network tab. Meta's *Events Manager → Test events*
   then shows `PageView`, and `CompleteRegistration` when you create an account.

The pixel is gated on consent (GDPR / India DPDP) and never runs inside the native app — the Android
SDK reports the app's own events, and running both would count one person twice.

### What Meta will then be able to optimise for
| Signal | Fires when | Where from |
|---|---|---|
| App install / app open | a user installs or opens the Android app | Android SDK |
| `CompleteRegistration` | a NavBharatAI account is created (any sign-in method) | web pixel |
| `Purchase` | the SERVER confirms a wallet recharge or a Pass | web pixel |
| `AppBuilt` | a user's app is generated | web pixel |

A recharge reports the real rupee amount. A Professional Pass resolves with a duration rather than an
amount, so it is reported as a Purchase with **no value** — never an invented one.

---

## 8. Git-ignore these secrets (never commit)
Add to `.gitignore` (some may already be present):
```
android/keystore.properties
*.keystore
*.jks
ios/            # generated per-machine; contains signing config
assets/         # your source icon/splash — optional, your call
```

---

## 9. Quick reference — the whole Android flow in 4 commands
```bash
npm run build
npx cap sync android
cd android && ./gradlew bundleRelease     # signed AAB (after §3.2)
# upload android/app/build/outputs/bundle/release/app-release.aab to Play Console
```

## Quick reference — the whole iOS flow (on a Mac)
```bash
npm run build && npx cap add ios && npx cap sync ios && npx cap open ios
# then in Xcode: set Team → Product → Archive → Distribute → App Store Connect
```

---

### Honest bottom line
**Both apps can be built without owning a Mac** — the signed Android `.aab` (§3.0) and the signed iOS
`.ipa` (§4.0) are produced by the GitHub Actions workflows on GitHub's own Linux + macOS runners. You only
supply signing secrets once (Android keystore; Apple App Store Connect API key), plus *your* paid store
accounts + the store-review submission — the account/signing/submission actions only you can perform, listed
above step by step. A local Mac (§4.1) remains an optional alternative for iOS, not a requirement.

---

# 10. 🕓 ORGANIZATION DEVELOPER ACCOUNT (D-U-N-S) — the full guide. ⛔ **DEFERRED — do NOT start this now**

**Admin decision, 2026-08-26 (verbatim): _"yeh baad me karenge jab user badhenge — pura organization
account (D-U-N-S number) me registration guide bas save kar do, baad ke liye."_**

This whole section is a **map for later**, written while the research was fresh. Every step below was
verified against the live Play Console (the admin's own screenshots) and Google's official help page
*"Update developer identity details managed by a Google payments profile"*, so a future session does
not have to rediscover any of it.

**The rule for any future session: do not begin this on your own initiative.** The trigger is the
admin saying users have grown enough to need it. Until then, the correct action is to leave it alone.

---

## 🟢 STATUS: STARTED — the admin asked on 2026-09-07 ("DUNS account banwao")

The trigger above has fired, so this section is no longer a map for later. It is the live plan. What
follows is unchanged and still accurate; this block only records where the work stands and who is
holding each piece, so a session resuming mid-way does not restart it or wait for permission it
already has.

**The critical-path order, because the two tracks have very different lengths:**

| # | Step | Who | Time |
|---|---|---|---|
| 1 | Register the business entity (Private Limited recommended) | **admin / CA** | 7-15 days |
| 2 | Apply for the D-U-N-S number — free, start the moment #1 issues a certificate | **admin** | 5-30 days |
| 3 | Play Console → website → Save → **Send verification request** | **admin** | minutes |
| 4 | Serve the verification file Google names | **a Claude session** | one PR |
| 5 | Change account type → new payments profile → D-U-N-S → identity docs | **admin** | ~1 hour |
| 6 | Wait 72 hours. Do not schedule a release into it | — | 3 days |
| 7 | App content → **Health apps declaration** | **admin** | minutes |
| 8 | Remove the ids from `MEDICAL_PROFESSIONAL_IDS`, fresh `.aab` | **a Claude session** | one PR |

**Steps 1 and 3 can run on the same day** — Track A is free, takes an afternoon, and its only job is
to make the *Change account type* button clickable. Track B is the long pole and gates everything
after step 4, which is why it starts first.

⚠️ **Step 4 cannot be prepared in advance.** Google issues the verification filename only after step 3,
so a session has nothing to commit until the admin pastes it. (If the admin prefers the **DNS TXT**
route instead, no code is needed at all — the record goes straight into Cloudflare and step 4 is
skipped.)

🔒 **Steps 7 and 8 are in that order for a compliance reason, not a tidiness one** — see §10.5 step 9.

**Verified 2026-09-07, since §10.4 asserts it:** `public/` is Vite's default `publicDir` and is copied
into `dist/`, and BOTH serving paths use `dist/` — `express.static(path.join(process.cwd(), 'dist'))`
in `server.ts`, and `"public": "dist"` in `firebase.json`. Static files are matched BEFORE the SPA
fallback, and `public/preview-sandbox.html` is an existing `.html` file served this way, so an
`.html` verification file will be served as a file rather than swallowed by the SPA route. This was
re-checked against the code rather than trusted from the earlier write-up; it could NOT be confirmed
against the live site, because this environment's egress proxy refuses `navbharatai.com`.

---

## 10.1 Why this exists at all — the ONE thing it unlocks

`src/lib/playCompliance.ts` hides four medical-class AIs inside the Play-distributed app:
`sda_chat` (Doctor AI), `pharmacist_ai`, `firstaid_ai`, `maternity_ai`. Google rejected the update in
Aug 2024 because an app that DECLARES medical features may only be published by an **organization**
account, and the admin's is **personal**.

**An organization account is the ONLY thing that brings those four back to the mobile app.** Nothing
else does — not restricting who uses them, not changing their wording. (See §10.6: a doctor-only gate
is a separate, worthwhile idea that does NOT solve this.)

Everything else an org account buys — a business identity on both stores, the admin's HOME ADDRESS
coming off the public listing, team access, investor-readiness — is real but secondary.

## 10.2 The finding that makes this cheap: NO new account is needed

The obvious fear was "personal accounts cannot convert, so we need a new account and an app
transfer" — weeks of work and risk to the existing install base. **That fear is dead.** The live
console shows a **"Change account type"** control on `Developer account → About you`, greyed out with
the tooltip:

> *"To change your account type, provide and verify a website for your organisation below."*

So the existing account converts in place. App, users, reviews, ratings and install base all stay
exactly where they are. (`Settings → App transfers` exists as a fallback and is NOT needed.)

## 10.3 🚨 Four things that are easy to get wrong

1. **"Send verification request" is a SEPARATE button.** Entering the website and pressing Save does
   nothing on its own. Google's page says it outright: *"After entering and saving your website,
   remember to click Send verification request."* This is where people stall for days believing
   Google is broken.
2. **A NEW payments profile is mandatory.** Country, account type and D-U-N-S **cannot be edited on an
   existing payments profile**. The flow creates a new one, verifies it, then links it.
3. **This is a ONE-WAY DOOR.** *"You can't change the account type from an organization to an
   individual account."* Going back means a brand-new account plus an app transfer. Decide once.
4. **Wait 72 hours after the conversion before submitting ANY new app.** Google's own note: it avoids
   "redundant app rejections" while their systems finish processing the change. Do not schedule a
   release right after.

## 10.4 The two tracks — run them in parallel

Track A is free and can be done in an afternoon. Track B is the long pole. **Both must be finished
before the conversion can complete**, so start B first even though A is the one that unlocks the
button.

### 🅰️ Track A — verify the organization website (free, same day)

1. Play Console → **Developer account → About you** → the **Website** field → `https://navbharatai.com`
2. **Save**, then press **Send verification request** (see §10.3 #1).
3. Google will ask for one of the usual proofs. Either is easy here:
   - **HTML file or meta tag** → **a Claude session can do this end to end.** `server.ts` serves
     `dist/` via `express.static`, and Vite copies `public/` → `dist/`, so a file dropped in
     `public/` is live at `https://navbharatai.com/<name>` on the next merge. No admin work at all.
   - **DNS TXT record** → the admin pastes it into Cloudflare; a session can write the exact record.
4. Once verified, **Change account type** becomes clickable.

### 🅱️ Track B — business entity, then D-U-N-S (start FIRST; 3-5 weeks)

**Step 1 — a registered business entity.** D-U-N-S is issued to a business, not a person.

| Type | Cost | Time | Note |
|---|---|---|---|
| Sole Proprietorship | ~₹1-2k | 2-7 days | Cheapest; weakest for stores/investors |
| **Private Limited** | ~₹8-15k | 7-15 days | **Recommended** — also unlocks payment gateways, hiring, funding |
| LLP / OPC | ~₹6-10k | 7-15 days | Middle ground |

Registered through the MCA (https://www.mca.gov.in), or a CA does it in 2-3 days.

**Step 2 — D-U-N-S number (FREE).** A 9-digit business id from Dun & Bradstreet
(https://www.dnb.com; D&B India has its own site). Either request it inside Google's own org signup
flow, or apply to D&B directly.

🔑 **The single most common failure: the business NAME and ADDRESS must match EXACTLY** between the
D-U-N-S record and the Play payments profile. One extra comma fails verification.

**Time: 5-30 business days.** This is why Track B starts first.

## 10.5 The conversion itself (once A and B are both done)

Play Console → **Developer account → About you**:

1. **Change account type**
2. **Create or Select payments profile** → **Create new payments profile** → enter the **D-U-N-S**
3. **Organization details:** type (*Company/business*), size (*1-10*), organization phone
4. **Contact details** — two separate pairs, each verified by OTP:
   - one Google uses to reach you (private)
   - ⚠️ one **displayed publicly on every store listing**. Do NOT use a personal mobile number here;
     use a business email and a number that is fine to publish.
5. **Identity verification** — upload the incorporation certificate etc. when asked. Progress and any
   required action appear on the Account details page; the outcome arrives by email.
6. **Link your payments profile to your developer account** → **Confirm and save**
7. **Wait 72 hours.**
8. Play Console → **App content → Health apps declaration** → declare the clinical-decision-support
   features honestly, now that the account type finally permits it.
9. **Only then** may a session remove the ids from `MEDICAL_PROFESSIONAL_IDS` in
   `src/lib/playCompliance.ts`, bringing Doctor AI, Pharmacist, First Aid and Maternity back to the
   mobile app. Its header comment states the same order and must be honoured:
   **organization account FIRST, declarations updated, THEN the code change.** Doing it in the other
   order is a deceptive-behaviour violation that can ban the whole developer account, not merely
   reject one update.

## 10.6 Related but SEPARATE: gating Doctor AI to real doctors (HPR / ABDM)

Raised by the admin the same day and **also deferred**. Recorded here so the two ideas are never
confused again:

- **It does NOT unlock the mobile app.** The Play restriction is about the DEVELOPER ACCOUNT TYPE,
  not about who uses the feature. Only §10.5 fixes that.
- **It is still worth doing on its own merits.** Doctor AI ships weight-based dosing, emergency
  resuscitation doses, antibiotic stewardship and pregnancy drug categories — an unambiguous
  professional tool — and today **there is no verification of any kind**: anyone signed in can use it.
- **ABHA ≠ HPR.** Both sit under ABDM/NHA, but ABHA is the PATIENT registry and HPR the PROVIDER
  registry, with separate onboarding and approval. Getting one does not grant the other.
- **Recommended design — two modes, not a hard gate.** A hard gate loses every non-doctor user
  overnight. Instead: a **Public** mode (symptom explanation, red flags, "see a doctor" — no dosing,
  no protocols) and a **Verified Doctor** mode (today's full engine). Safety and the funnel both survive.
- **Phase 1 needs no ABDM at all and can ship any time:** NMC/state-council registration number plus a
  certificate upload, approved by the admin — the exact pattern App Mart review already uses. HPR
  later replaces only the manual approval step; the user-facing flow does not change.
- **Do NOT write HPR API code from memory.** The exact endpoints and auth flow must come from live NHA
  sandbox documentation. A verification gate built on a guessed endpoint either fails shut (nobody
  gets in) or fails open (everybody does) — and the second is worse than having no gate at all.

## 10.7 What it actually costs

| | Cost | Time |
|---|---|---|
| Private Limited registration | ~₹8-15k | 7-15 days |
| D-U-N-S number | **₹0** | 5-30 days |
| Play Console fee | already paid (existing account converts) | — |
| **Total** | **~₹8-15k** | **3-5 weeks**, mostly waiting |

One D-U-N-S serves **both stores**: Apple also requires it for an organization account, which would
move the App Store listing from the admin's personal name to the company's.
