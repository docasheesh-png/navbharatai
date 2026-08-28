# Google Play 2027 technical quality requirements — what they actually say

**Written 2026-08-28.** Trigger: the Play Console notice *"Introducing new quality requirements to
optimize app memory and secure device migration"* (27 Aug 2026), which the admin forwarded.

## How to read this document

Every row below is marked with how it was established:

| Mark | Meaning |
|---|---|
| ✅ **VERIFIED** | Read from an official Google page (`developer.android.com`) in this session |
| 🟡 **OFFICIAL, VIA SEARCH** | Google's own wording, reached through search rather than the page itself |
| 🔴 **NOT VERIFIABLE HERE** | Lives behind a source this session cannot reach — the admin must read it |

**Why the third category exists, and why it is not a shortcut.** Two of Google's own hosts are blocked
by this session's network egress: `support.google.com` (the Play Console Help page carrying the full
threshold table) and `android-developers.googleblog.com` (the announcement). `developer.android.com`
IS reachable and is the source of every ✅ below. Guessing the blocked numbers would produce a document
that looks authoritative and could send real engineering work in the wrong direction, so the gaps are
marked instead of filled.

---

## THE HEADLINE, because it is the thing most likely to be misremembered

🟡 **The consequence of failing these thresholds is *reduced app visibility and publishing
capabilities* — NOT removal from Google Play.** The app is not deleted, users do not lose it, and
existing installs keep working. What degrades is discovery in the Play Store and the ability to ship
new releases.

Dates: **February 2027** for memory, bitmap and DEX. **April 2027** for Zero-Tap Sign-In. As of
writing that is roughly five and seven months away.

---

## 1. Memory usage (Anonymous RSS + Swap)

**Enforcement: February 2027. Applies to: apps AND games (different thresholds for each).**

✅ **VERIFIED — what the metric actually counts** (`developer.android.com/topic/performance/vitals/memory-usage`):
total memory pages **not backed by file storage**, specifically:

- the Java/Kotlin heap
- unmanaged **native** heap allocations
- thread execution stacks
- memory preserved in swap / zRAM

✅ **VERIFIED — the leak signal Google itself names:** a **P90 : P50 ratio above 3.5×** indicates a
likely memory leak during extended sessions. This is the single most useful number in the whole
document for us, because it is a *shape*, not a threshold — it can be reasoned about before we ever
see our own numbers, and it is exactly what a long AI chat session would produce if we leak.

🟡 **OFFICIAL, VIA SEARCH — thresholds vary by three axes:** device RAM tier × process state ×
app-vs-game. Confirmed data points:

| Device RAM tier | State | Apps | Games |
|---|---|---|---|
| 4 GB | Foreground | **2 GB** | 2.25 GB |
| 8 GB | Foreground | **2.25 GB** | — |
| 8 GB | User-perceived service | **1.5 GB** | — |
| 8 GB | Background | **1.5 GB** | — |

🔴 **NOT VERIFIABLE HERE — the complete table.** Rows exist for other tiers (2 GB, 3 GB, 6 GB, …) and
the remaining state/app-type combinations. **Admin action:** Play Console → Android vitals → Memory
usage, which shows the thresholds alongside our real numbers.

**How NavBharatAI is affected.** We are a **Capacitor WebView app**, so the WebView's memory is part of
our process and counts. The realistic pressure points are long AI conversations held in React state,
the Monaco editor, and image/PDF handling. **Our actual figures are unknown until Play Console vitals
are read** — this is telemetry, not something a repository can answer.

**Status: UNKNOWN — requires Play Console verification.**

---

## 2. Bitmap memory usage

**Enforcement: February 2027.**

🟡 **OFFICIAL, VIA SEARCH — thresholds (P90):**

| State | Threshold |
|---|---|
| Foreground / user-perceived service | **> 200 MB** is bad behaviour |
| Background | **> 200 MB** is bad behaviour |
| Cached | **> 400 MB** is bad behaviour |

Unlike memory usage, these are stated as applying to **all devices** — no RAM-tier split.

**How NavBharatAI is affected.** Every decoded image in the WebView counts. Our surfaces: app logos,
AI-generated images, user uploads, App Mart icons, PDF page rendering. 200 MB is a lot of bitmap, so
this is unlikely to bite unless something *retains* decoded images — which is exactly what an unbounded
gallery or an un-revoked object URL does.

**Status: UNKNOWN — requires Play Console verification.**

---

## 3. DEX code optimization

**Enforcement: February 2027.**

🟡 **OFFICIAL, VIA SEARCH — the requirement:** a minimum of **25% each** for **optimization**,
**obfuscation** and **shrinking**, measured on App Bundles uploaded to Play Console. Any shrinker may
be used; R8 is the default one.

🟡 **Applies to apps AND games** — with one important qualification in Google's own wording: it is
**"only enforced where you have non-negligible DEX sizes."**

🔴 **NOT VERIFIABLE HERE — what counts as "non-negligible".** One widely-repeated figure is 50 MB of
DEX, but that appeared in game-focused coverage and **must not be treated as the app threshold**.
**Admin action:** Play Console → App Bundle Explorer shows our real DEX size.

**How NavBharatAI is affected — and this one is not unknown.**

Our release build currently has **no optimization of any kind**:

```gradle
// android/app/build.gradle
release {
    minifyEnabled false                                          // ← shrinking, obfuscation,
    proguardFiles getDefaultProguardFile('proguard-android.txt'), // ← optimization: all OFF
                  'proguard-rules.pro'                            // ← and this file is empty
}
```

So our three rates are **0%, 0%, 0%**. If the rule reaches us, we fail it outright.

Two specifics worth recording now, both from ✅ **VERIFIED** Google guidance
(`developer.android.com/topic/performance/app-optimization/enable-app-optimization`):

1. `minifyEnabled true` alone is not the whole fix. **`proguard-android.txt` explicitly disables
   optimization** — the correct default file is **`proguard-android-optimize.txt`**. We currently
   reference the wrong one, so even flipping the flag would leave one of the three rates at zero.
2. Resource shrinking (`shrinkResources`) is a separate switch and is also off.

**A hopeful note that must not become an excuse.** As a Capacitor app, most of NavBharatAI is
JavaScript in `assets/`, not DEX. Our DEX is Capacitor + 13 plugins + Firebase + Play Services +
Credential Manager, which may well be small enough to be "negligible". **That would exempt us from the
requirement, not from the benefit** — R8 is still worth enabling for size and startup. But it changes
the priority, so the App Bundle Explorer number should be read before large effort goes here.

**Status: FAIL if applicable — needs the real DEX size to know.**

---

## 4. Zero-Tap Sign-In / Restore Credentials

**Enforcement: April 2027.**

🟡 **OFFICIAL, VIA SEARCH — the requirement:** **any app supporting user sign-in, optional or
mandatory**, must automatically restore the user's signed-in state when they move to a new Android
device, using the **Android Restore Credentials API**. The user should be recognised and securely
signed in on first launch of the new device, with no extra taps.

✅ **VERIFIED — how the API works** (`developer.android.com/identity/sign-in/restore-credentials`):

- It is part of **Credential Manager**. A "restore key" is created **silently** after the user
  authenticates, and Android's backup service stores it locally and (subject to the user's settings)
  in cloud backup.
- Cloud backup of the key requires all three: the user signed in to a Google Account, Android data
  backup enabled, and a screen lock set (pattern/PIN/password/biometric). When these are not met the
  API raises `E2eeUnavailableException` — **a normal outcome to handle, not an error to hide**.
- Restore happens either from cloud backup or **device-to-device (D2D) transfer**, silently during
  device setup.
- Documented mechanisms: **passkeys, passwords, and Sign in with Google**.
- **One account per app.** Multiple signed-in accounts are not restorable simultaneously — pick the
  primary or most recently used.
- Only available to the **first profile** set up on a device; does not cross work/personal profiles.
- **Mobile form factors only**; does not carry across form factors.

**How NavBharatAI is affected — this is our biggest genuine gap.**

We support sign-in (Google, Apple, GitHub, phone OTP), so **the requirement applies to us**, and we
have **no Restore Credentials integration at all** today. Unlike memory and DEX, this is not a
"depends on telemetry" item: it is absent, and absence is knowable from the repository.

🔴 **NOT VERIFIABLE HERE — how it composes with Firebase Authentication.** The official page does not
cover Firebase or custom-token sign-in, and NavBharatAI's session is a Firebase JS SDK session inside a
WebView, restored by the Firebase SDK from its own persistence. Whether the restore key should carry a
Firebase custom token, a refresh token, or something else is a **security-architecture decision** and
is deliberately left open here rather than guessed. See Phase 8.

**Status: NOT IMPLEMENTED.**

---

## 5. How Google measures all of it

🟡 **P90 over the preceding 28 days.** A P90 means 90% of measured values fell at or below that level —
so a single bad session cannot fail us, and a persistent leak on a minority of devices can.

✅ Android vitals in Play Console is the reporting surface, filterable by **App State** (Foreground,
User-perceived service, Background, Cached) and **Device RAM tier**.

**What this implies for our work, and it is the useful part:** because the metric is a trailing
28-day P90 of *real user devices*, a fix merged today does not show up for weeks, and nothing we
measure locally is the metric. Local profiling tells us whether we improved; only Play Console tells us
whether we pass.

---

## What must be verified by a human, and where

Recorded per RULE 10 — these cannot be answered from a repository or from this session.

| # | Question | Where | Why it matters |
|---|---|---|---|
| 1 | Our real memory P90 per RAM tier and state | Play Console → Android vitals → Memory usage | The only way to know if we pass |
| 2 | Our P90:P50 ratio — is it above **3.5×**? | Same screen | Google's own leak signal |
| 3 | Our bitmap memory P90 | Play Console → Android vitals | |
| 4 | Our **DEX size** | Play Console → App Bundle Explorer | Decides whether §3 applies to us at all |
| 5 | The complete threshold table | Play Console → Android vitals | `support.google.com` is unreachable from this session |

---

## Sources

- ✅ [Memory usage (anonymous RSS + swap) — Android Developers](https://developer.android.com/topic/performance/vitals/memory-usage)
- ✅ [Enable app optimization with R8 — Android Developers](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization)
- ✅ [Restore Credentials — Android Developers](https://developer.android.com/identity/sign-in/restore-credentials)
- ✅ [Manage your app's memory — Android Developers](https://developer.android.com/topic/performance/memory-overview)
- 🔴 [Play Console technical quality requirements — Play Console Help](https://support.google.com/googleplay/android-developer/answer/17492799) — **blocked from this session; the full threshold table lives here**
- 🔴 [Elevating app quality: Reducing memory usage and improving device migration — Android Developers Blog](https://android-developers.googleblog.com/2026/08/app-quality-memory-optimization-secure-onboarding.html) — **blocked from this session**

---

## Summary

| Requirement | Date | Applies to us? | Our status |
|---|---|---|---|
| Memory (Anon RSS + Swap) | Feb 2027 | Yes | **UNKNOWN** — needs Play Console |
| Bitmap memory | Feb 2027 | Yes | **UNKNOWN** — needs Play Console |
| DEX optimization | Feb 2027 | Only if DEX is non-negligible | **FAIL (0/0/0)** if applicable |
| Zero-Tap Sign-In | Apr 2027 | **Yes** — we support sign-in | **NOT IMPLEMENTED** |

Two of the four cannot be graded without production telemetry. The two that can be graded from the
repository both come back negative, and one of them — Zero-Tap — is the larger piece of work.
