# Android security audit

**2026-08-28.** The security section of the Google Play 2027 work — the plan's own priority #1, and
the part Phase 2 left undone.

Scope: the Android shell and everything that reaches it. Secrets, the shipped bundle, the manifest,
exported components, network policy, deep links, and backup/restore.

---

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | GitHub OAuth token delivered via a custom URI scheme | 🔴 **HIGH** | **Needs an admin decision** |
| 2 | `allowBackup="true"` with no extraction rules | 🟡 MEDIUM | Tied to the Zero-Tap decision |
| 3 | Cleartext traffic not explicitly disabled | 🔵 LOW | **Deliberately not changed** — see why |
| 4 | Secrets in the shipped client bundle | ✅ **CLEAN** | verified |
| 5 | Exported components | ✅ CLEAN | verified |
| 6 | Open-redirect / token exfiltration on the web path | ✅ CLEAN | already well defended |

---

## 🔴 1. HIGH — the GitHub OAuth token is handed over on a hijackable channel

**Where.** `src/server/routes/githubAuth.ts:15,23`

```ts
const NATIVE_OAUTH_REDIRECT = 'com.navbharat.ai://github-callback';

export function nativeOauthReturn(state, accessToken) {
  if (state !== NATIVE_OAUTH_STATE) return null;
  return `${NATIVE_OAUTH_REDIRECT}#gh_token=${encodeURIComponent(accessToken)}`;
}
```

**What the token is.** `GITHUB_SCOPE = 'repo workflow read:user user:email'`. `repo` is **full read
and write on every one of the user's private repositories**; `workflow` can modify their GitHub
Actions. This is close to the most powerful token GitHub issues.

**The problem.** A **custom URI scheme is not exclusive on Android.** Any installed app may declare
`com.navbharat.ai` in its own manifest. When two apps claim a scheme the system shows a chooser — and
the user is mid-sign-in, expects to be returned to an app, and taps through. A malicious handler can
read the token from the fragment and immediately forward the user to the real app, so nothing looks
wrong. This is the risk RFC 8252 §8.1 exists to warn about.

**What makes this worth writing down carefully: the existing defence is real, and it defends
something else.** The code has clearly been security-reviewed — there is an origin allowlist, an
open-redirect guard, a fixed server-owned scheme constant that is deliberately *never* derived from
`state`, and a unit test pinning that invariant. All of it is correct. But every one of those protects
against **a crafted `state` redirecting the token somewhere else**. None of them protects against
**another app claiming the same scheme**, because that attack does not touch `state` at all. A good
mitigation for the wrong threat reads, at a glance, exactly like coverage.

### The proper fix — and why it is not mine to just ship

**The token should never be in the redirect.** The redirect should carry a short-lived, single-use
**handoff ticket**; the app then redeems it over HTTPS while authenticated with its Firebase ID token,
and the server returns the real token. An intercepting app receives a ticket it cannot redeem, because
it does not have the victim's Firebase session.

The pieces already exist in this repository — `src/server/lib/supabaseOAuth.ts` has exactly the right
idiom (HMAC over `userId.expiry.nonce`, constant-time compare, expiry checked *after* the signature so
a forgery cannot be distinguished from an expiry by timing), so this is composition, not invention.

**⚠️ But bundled mode makes the rollout the hard part.** `capacitor.config.ts` sets `webDir: 'dist'`
with no `server.url`, so the app runs from assets baked into the APK. **If the server simply switches
to sending a ticket, every already-installed app breaks GitHub sign-in** until its user updates — and
"never break the app" is the first absolute rule.

The safe sequence, and it takes two releases:

1. Ship an app version that sends `state = nbai-native-v2` and understands a ticket. The server keeps
   sending the raw token to `nbai-native` (old apps), unchanged.
2. Once adoption is high, retire the `nbai-native` branch.

### 🔴 The decision I need

| Option | What happens | Trade-off |
|---|---|---|
| **A. Ticket handoff** *(recommended)* | Two-release rollout as above | Fixes it properly for everyone. Real work, and the fix only lands for users who update. |
| **B. Android App Links** | Replace the custom scheme with a verified `https://navbharatai.com/...` link | Cryptographically unhijackable. **Needs the app's signing-certificate SHA-256 to publish `assetlinks.json` — that is in the admin's keystore and Play App Signing, so I cannot do it.** |
| **C. Reduce the scope** | Drop `repo` to something narrower | Shrinks the blast radius but does not fix the interception, and would break features that need repo write. |
| **D. Accept** | Document and move on | Defensible only if the threat model excludes a malicious app on the device. It should not. |

**My recommendation: A, then B.** A is buildable now and needs nothing I do not have; B is the
stronger long-term answer and can follow once the admin supplies the certificate fingerprint. They
compose — A makes the intercepted value useless, B stops the interception.

This is security architecture, so per the brief I have stopped here rather than shipping it.

---

## 🟡 2. MEDIUM — `allowBackup="true"` with no extraction rules

`AndroidManifest.xml:5` sets `android:allowBackup="true"`, and there is **no** `dataExtractionRules`
and no `fullBackupContent` (`res/xml/` contains only `config.xml` and `file_paths.xml`).

So Android backs up the app's **entire** data directory by default — including the WebView's
localStorage and IndexedDB, **which is where the Firebase Auth session is persisted.**

**Why this is more interesting than a checkbox.** It means a live session already travels to a new
device through cloud backup — an *uncontrolled, non-revocable* version of exactly what Zero-Tap
Sign-In is asking us to build *properly*. Today's behaviour is accidental rather than designed.

Android 12+ `dataExtractionRules` separates the two cases, and the distinction matters here:

- **`<cloud-backup>`** — restored possibly months later, possibly onto a device the original user no
  longer controls. A live session arguably should *not* travel this way.
- **`<device-transfer>`** — a cable, both phones in hand, user present. Much safer.

**Not changed in this pass**, deliberately: excluding the session from cloud backup would mean users
who today get restored-and-signed-in must sign in again. That is a real user-visible change, and it is
the *same question* as the Zero-Tap credential decision — how a session is allowed to reach a new
device. Deciding it twice, in two places, is how the two answers end up disagreeing.

**Recommend deciding it together with Zero-Tap**, and Google's own guidance agrees: the Restore
Credentials page says to pair the restore key with app-data backup via `dataExtractionRules`.

---

## 🔵 3. LOW — cleartext traffic, and why it is left alone

`usesCleartextTraffic` is not declared and there is no network-security config. On **API 28+** the
platform default is already "no cleartext", so this only affects **API 24–27** (`minSdkVersion = 24`).

Setting it to `false` looks like free hardening. It is not quite free: `APITester.tsx:245` issues a
**direct** `fetch` to a user-supplied URL, and users can point it at an `http://` endpoint — a
developer tool that works today on those old devices and would stop.

**None of NavBharatAI's own traffic uses cleartext** — every hit for `http://` in client code is
either a dummy URL-parsing base (`new URL(url, 'http://x')`) or a feature *warning the user* about
plaintext. So the security gain is close to zero, and the cost is removing a working capability on old
Android. **Not changed.** If a future policy raises `minSdkVersion` past 27 this becomes moot.

---

## ✅ 4. Secrets in the shipped client bundle — CLEAN, verified

Grepped the built `dist/assets/*.js` for key values and key names.

The only `AIza…` value present is the **Firebase Web API key**, which is public by design (it
identifies the project; it is not a credential) and is documented as such in `src/config/firebase.ts`.

Server-side key **names** appear, and every occurrence is UI text or a template, never a value:

| Name found | What it actually is |
|---|---|
| `E2B_API_KEY` | an honest empty-state: *"Admin: set `E2B_API_KEY` in the server environment"* |
| `GRAFANA_ADMIN_PASSWORD` | a monitoring-setup snippet in documentation UI |
| `CASHFREE_SECRET_KEY` | a template for the **user's own** generated app, next to the line *"It must stay on the server"* |

`SECRET_ENCRYPTION_KEY`, `GLM_API_KEY` and `GITHUB_CLIENT_SECRET` do not appear at all.

**And one real improvement already landed this week:** `server.cjs.map` — 16 MB of readable server
source — was being shipped inside the APK until PR #2700 removed it.

---

## ✅ 5. Exported components — CLEAN

One exported component, `MainActivity` (`exported="true"`), which is required for the LAUNCHER intent
filter. `FileProvider` is `exported="false"` with `grantUriPermissions`, which is correct. No exported
services, receivers or providers beyond these.

Permissions are conservative and each is justified in a manifest comment. `READ_SMS` / `RECEIVE_SMS`
are **deliberately absent** with a comment explaining that OTP auto-read uses the hash-scoped SMS
Retriever API — the right call, and one Play would otherwise reject.

---

## ✅ 6. The web OAuth path — CLEAN, and genuinely well built

`ALLOWED_RETURN_ORIGINS` is an explicit allowlist; `safeReturnUrl` compares parsed origins rather than
prefixes (so `https://navbharatai.com.evil.test` fails); the native scheme is a fixed server-owned
constant; values embedded in the inline callback page go through `jsLiteral`/`htmlEscape`. The
open-redirect class is properly closed.

Finding 1 is not a failure of this work — it is a threat this work does not cover.

---

## What needs a human

| # | Action | Why |
|---|---|---|
| 1 | **Decide finding 1** (A / B / C / D) | HIGH severity; option B additionally needs the signing-certificate SHA-256 from the keystore / Play App Signing, which no Claude session can read |
| 2 | Decide backup vs Zero-Tap together (finding 2) | Same underlying question; deciding twice produces two answers |
