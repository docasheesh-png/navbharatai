# NavBharatAI — Mobile App Publishing Runbook (Play Store + App Store)

This is the end-to-end guide to ship NavBharatAI as a native mobile app to **Google Play** and the
**Apple App Store**. It is honest about what is already done in this repo and what only *you* can do
(store accounts cost money, and an iOS build **requires a Mac** — Apple's hard rule).

The app uses **Capacitor in HOSTED MODE**: the native shell is a real APK/IPA that loads the live site
`https://navbharatai.com` inside a native WebView. Auth, payments, and every API call work exactly as on
the web. This is a genuine, store-installable app — not a bookmark.

---

## 0. What is already done in this repo ✅

- `capacitor.config.ts` — appId `com.navbharatai.app`, appName `NavBharatAI`, hosted mode, iOS + Android.
- `@capacitor/core`, `@capacitor/android`, `@capacitor/ios`, `@capacitor/cli` — all installed (v8.4.1).
- `android/` — the full native Android project is committed and ready to build.
- `public/manifest.json` + mobile meta tags — PWA basics in place.
- npm scripts: `mobile:sync`, `mobile:android`, `mobile:ios`.

## What only YOU can do (external, unavoidable) ⚠️

| Task | Why it's not automatable here |
|------|------|
| Google Play Console account (~$25 one-time) | Paid account tied to your identity |
| Apple Developer account ($99/year) | Paid; required for App Store + TestFlight |
| **A Mac with Xcode** for the iOS build | iOS apps **cannot** be built on Linux/Windows — Apple requirement |
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

## 4. Ship to the App Store (iOS — on a Mac)

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
   your **Team** (your Apple Developer account). Bundle identifier = `com.navbharatai.app`.
2. Set the **App Icon** in `Assets.xcassets` (from §2), a version, and a build number.
3. **Product → Archive** → when it finishes, **Distribute App → App Store Connect → Upload**.
4. In https://appstoreconnect.apple.com → **My Apps → +** → create "NavBharatAI" with bundle id
   `com.navbharatai.app`. Attach the uploaded build.
5. Fill listing (screenshots for 6.7" + 6.1" iPhone are mandatory — see §6), privacy details, and submit.
6. Use **TestFlight** first to test on a real device before submitting for review.

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

The hosted WebView already respects this as long as the site hides the purchase UI when opened from the
app. Detect the app via the Capacitor user-agent / `Capacitor.isNativePlatform()` and hide the buy buttons.

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
- **Push notifications** (`@capacitor/push-notifications`) — build-finished / credit alerts. Highest value.
- **Native share** (`@capacitor/share`), **status bar** styling (`@capacitor/status-bar`), **splash
  screen** (`@capacitor/splash-screen`).

If the App Store reviewer pushes back with 4.2, adding push notifications almost always resolves it.
(Choosing "Pehle native features add karo" in the panel builds these — ask and I'll wire them.)

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
The **Android app is essentially ready** — build the signed AAB and upload it; that can happen today on any
machine with Android Studio. The **iOS app needs a Mac** (Apple's requirement) and both stores need *your*
paid accounts + review. This repo now carries everything on the code side for both; the remaining steps are
the account/signing/submission actions only you can perform, listed above step by step.
