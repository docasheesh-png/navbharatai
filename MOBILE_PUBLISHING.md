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

## 5. 🚨 Payments policy — read this or the app WILL be rejected

Apple and Google **require their own billing** for digital goods bought *inside* the app (Apple takes 30%,
Google Play Billing similar). NavBharatAI sells **credits/wallet top-ups** — those are digital goods.

**v1 strategy (already decided — "in-app purchases hidden in v1"):** do **not** show a "Buy credits" flow
inside the native app. Users top up **on the web** (`navbharatai.com` in a browser). The app can *show* the
balance and say "add credits on the web", but must not open a purchase/checkout screen in-app.

- ✅ Allowed: show balance, let users build/use existing credits, link out to the website's *account* page.
- ❌ Rejected: an in-app "Buy ₹X credits" button that charges via Razorpay/Stripe. That bypasses store
  billing → instant rejection (Apple 3.1.1, Google Payments policy).
- Later (v2), if you want in-app purchases: integrate `@capacitor/in-app-purchases` (StoreKit / Play
  Billing) and let the store take its cut — a separate project.

The bundled WebView already respects this as long as the app hides the purchase UI when running natively.
Detect the app via the Capacitor user-agent / `Capacitor.isNativePlatform()` and hide the buy buttons.

---

## 6. Store assets checklist (both stores)

- **App icon** — 1024×1024 (no alpha for iOS).
- **Screenshots** — Play: phone (min 2). App Store: 6.7" (1290×2796) **and** 6.1" (1179×2556), min 3 each.
- **Feature graphic** (Play) — 1024×500.
- **Short description** (Play, 80 chars) + **full description**.
- **Privacy Policy URL** — mandatory on both. Host at `https://navbharatai.com/privacy`.
- **Support URL / email**.
- **Content rating** (Play questionnaire) + **age rating** (App Store).
- **Data safety** (Play) / **App Privacy** (App Store) — declare what data the app collects (auth email,
  usage). Be accurate.

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
