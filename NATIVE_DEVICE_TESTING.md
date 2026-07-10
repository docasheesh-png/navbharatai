# NavBharatAI — Native Device Testing (Bundled Mode)

Testing the bundled native shell on real Android + iOS devices.

## Prerequisite: Build & Deploy

Before device testing, you must have built the app in bundled mode:

```bash
# Build the React frontend
npm run build

# Sync to native platforms (pulls bundled dist/ into WebView)
npx cap sync

# Android: Connect USB device + open in Android Studio
npx cap open android
# → Android Studio → ▶ Run (green button) → select device

# iOS: On a Mac with Xcode
npx cap open ios
# → Xcode → Product → Run → select device
```

---

## Test Plan (Bundled Mode — Post-PR3)

### Golden Path: Authentication

**Objective:** Verify login/logout work end-to-end on native shell.

**Steps:**

1. **App Launch**
   - Tap app icon on home screen → app opens
   - ✓ Splash screen displays app icon/brand (3 sec), then fades to app
   - ✓ Status bar is styled (light text on white background, or dark on dark, matching theme)

2. **First Load**
   - No logged-in user → app shows login screen
   - ✓ "Sign in with Google" button is visible
   - ✓ Tap button → native Google account picker (Android) or Safari sign-in (iOS) opens

3. **Login via Google**
   - Select account → Firebase auth completes
   - ✓ Redirect back to app (not stuck on sign-in)
   - ✓ Authenticated state: app loads user's build history, shows username, "Sign out" button visible
   - ✓ **No errors in console** (`console.log` silenced in prod, but check DevTools if available)

4. **Navigation & Back Button**
   - Navigate between pages (Home → Builds → Settings)
   - ✓ Android: Tap device back button → navigates back in history (not exit app)
   - ✓ iOS: Swipe back (edge gesture) → navigates back (or tap back in UI)
   - ✓ At root → back button closes app (normal behavior)

5. **API Calls (Bundled Rewrite)**
   - Build page loads → fetches build history
   - ✓ Network tab / Charles Proxy shows requests to `https://navbharatai.com/api/...` (NOT `localhost/api/`)
   - ✓ No "blocked by CORS" errors
   - ✓ Data loads successfully, no 404 or 403 on API calls

6. **Logout**
   - Settings → "Sign out"
   - ✓ Back to login screen
   - ✓ No session token in storage (localStorage/sessionStorage cleared)

### Edge Cases

**Slow Network**
- On throttled connection (Settings > Developer > Network throttling): app still loads, spinner visible, no timeout
- ✓ Splash screen hides after ~3 sec (don't wait forever)

**Offline → Online**
- Go offline (airplane mode), launch app
- ✓ App shows "offline" state or error message (honest about connectivity)
- Go online → retry button or auto-refresh works
- ✓ Builds data loads from server

**Long Session**
- Keep app open for 10 min, navigate around
- ✓ Auth token remains valid, no "session expired" errors
- ✓ Status bar doesn't flicker or disappear

---

## Haptic Feedback (PR2 Feature)

**Android Only** (iOS haptics require paid Apple Developer account)

**Steps:**
1. On an Android device, navigate to any interactive element (button, toggle)
2. Tap → ✓ Feel subtle vibration (haptic feedback)
3. ✓ No visual glitch, feedback is immediate

---

## Testing Checklist

- [ ] **App Launch**
  - [ ] Splash screen appears (3 sec)
  - [ ] Status bar is styled (not Android default blue)
  - [ ] No crash, app loads

- [ ] **Login**
  - [ ] Google sign-in button visible
  - [ ] Tap → native account picker (Android) / Safari (iOS)
  - [ ] Redirect back to app after auth
  - [ ] User is logged in (name visible, "Sign out" button)

- [ ] **API Calls**
  - [ ] Fetch build history → no CORS errors
  - [ ] All `/api/*` requests succeed
  - [ ] Spy on network: confirm requests to `https://navbharatai.com/api/...`

- [ ] **Navigation**
  - [ ] Navigate between pages (Home, Builds, Settings)
  - [ ] Android back button works (navigate back, don't exit)
  - [ ] iOS swipe-back works (edge gesture)

- [ ] **Logout**
  - [ ] Settings → Sign out
  - [ ] Back to login screen
  - [ ] Session cleared

- [ ] **Edge Cases (Optional)**
  - [ ] Slow network: app doesn't hang, splash hides after ~3 sec
  - [ ] Offline → online: app recovers, no stuck state
  - [ ] Long session (10 min): no session expiry, still logged in

---

## Debugging (If Issues Found)

### Android (via Android Studio)

1. Connect device via USB
2. Open Android Studio → Logcat (bottom panel)
3. Filter by app package: `com.navbharat.ai`
4. Look for errors: 
   - `CORS error` → check `src/server/lib/cors.ts` (server-side origin allowlist)
   - `API call failed` → check `src/lib/apiBase.ts` (URL rewrite logic)
   - `Native error` → check `src/lib/nativeShell.ts` (plugin initialization)

### iOS (via Xcode)

1. Connect device via USB
2. Xcode → Product → Scheme → Edit Scheme → Run → Console
3. Output shows app logs and native errors
4. Or use Safari Dev Tools: Safari → Develop → [Device] → NavBharatAI

### Network Inspection (Both Platforms)

Use **Charles Proxy** or **mitmproxy** to intercept HTTPS:
1. Configure device WiFi → HTTP Proxy → Charles machine + port
2. Watch all `https://navbharatai.com/api/...` requests
3. Verify request/response (should see 200 OK, not CORS errors)

---

## Known Limitations

- **iOS haptics:** Require paid Apple Developer account; skip on simulator
- **Offline storage:** App relies on server-side session; no offline-first support yet
- **Slow devices:** Splash screen might flicker on very slow Android devices; expected

---

## After Testing

If all tests pass:
1. Mark PR3 ready for merge
2. Deploy to production via Cloud Run (merge to `main`)
3. App will be live on Play Store / App Store (already built via CI)

If issues found:
1. Create a bug issue with reproduction steps
2. Reference the logs from Logcat (Android) or Xcode (iOS)
3. Fix in a follow-up PR
