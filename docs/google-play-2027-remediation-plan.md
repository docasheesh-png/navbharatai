# Remediation plan — Google Play 2027

**Phase 3, 2026-08-28.** Turns the `google-play-2027-audit.md` findings into ordered, sized work.

Deadlines: **February 2027** (memory, bitmap, DEX) and **April 2027** (Zero-Tap Sign-In). Failing a
threshold costs **visibility and publishing capability** — not removal from the store.

---

## Execution order, and why it is this order

Not the prompt's suggested order. Two things reshaped it:

1. **Zero-Tap is the only item that is definitely-applicable AND definitely-absent.** Memory and DEX
   are "unknown until Play Console is read"; Zero-Tap is knowable today, applies to every app with
   sign-in, and is the largest build. It also needs a security decision from the admin, so starting
   it late is how a hard deadline gets missed.
2. **The bundle/startup item mostly resolved itself.** PR #2699 (another session, 2026-08-27) split
   Firebase into its own chunk: the entry chunk went **634 KB → 355 KB gzipped**, with headroom now
   ~114 KB against the budget. What Phase 0 flagged as a startup concern has largely been done by
   someone else, so it drops down this list rather than up it.

| # | Item | Severity | Blocked on |
|---|---|---|---|
| 0 | Node server in the APK | P0 | ✅ **DONE** — PR #2700 |
| 1 | Attachment memory retention | P1 | nothing — proceed |
| 2 | Zero-Tap Sign-In | P1 | **admin decision** on credential shape |
| 3 | R8 / DEX optimization | P1 | **read our DEX size first** |
| 4 | Chat-surface unbounded appends | P2 | item 1 first (same files) |
| 5 | Bitmap / image lifecycle | P2 | Play Console figures |
| 6 | Bundle + startup | P3 | largely addressed by #2699 |

---

## P0-1 — Node server shipped inside the Android app ✅ DONE

**Was:** 62 MB of web assets, of which `server.cjs` (7.5 MB) could never execute in a WebView and
`server.cjs.map` (16 MB) put our readable server source on every user's device.
**Now:** 39 MB, enforced by a `capacitor:copy:after` hook that cannot be forgotten. PR #2700.

---

## P1-1 — Full-size base64 attachments retained in chat state

| | |
|---|---|
| **File** | `src/hooks/useChatEngine.ts:333-350` (and `src/components/sda/SDAChat.tsx`) |
| **Google requirement** | Memory usage (Anonymous RSS + Swap), Feb 2027 |
| **Impact** | ~5.5 MB retained per phone photo; ~55 MB after ten, for the whole session |

**Problem.** Every uploaded file is read with `readAsDataURL` and the **full** base64 string is stored
in the message object. Messages are never trimmed, so the heap grows monotonically with attachments
and returns to baseline only on reload — a rising P90 against a flat P50, which is exactly Google's
3.5×-ratio leak signal.

**Root cause — and it is not "we forgot to free it".** One value is doing two jobs. The same
`dataUrl` is used both to *display* the image in a chat bubble and to *be* the retained record of the
attachment. A 64×64 preview does not need 4 MB, but because it is the same string as the archive
copy, it is impossible to shrink one without appearing to discard the other.

**Why this is safe to fix, verified rather than assumed.** `useChatEngine.ts:472` already sends the
attachment to the backend **separately**:

```ts
fileAttachments: files.length > 0 ? await filesToBase64(files) : undefined
```

So `attachmentPreviews` is **purely for display**. Shrinking it changes nothing about what the AI
receives, and nothing about what the user's message *means* — which is what makes this compatible
with CLAUDE.md rule 12 (never silently discard user data). The file itself was never persisted
client-side; only a preview of it was.

**Solution — reuse the implementation this repo already has.** `AgentV3Panel.tsx:1362` (the main
builder chat) already does the right thing: it downscales images through a canvas before encoding,
skips small images entirely, revokes its object URL, and falls back to the raw read on any failure.
And it stores **no** attachment in message state at all, which is why the builder chat does not leak.

So this is not new code. It is: **extract that function into one shared helper, and use it in the two
places that hand-rolled a worse version.** Per CLAUDE.md rule 2, a third copy would be the actual
mistake — the repository already has one good implementation and one bad one, and the fix for a
drifted duplicate is to centralise, not to add.

Two sizes, because they are genuinely two jobs:

| Purpose | Size | Retained? |
|---|---|---|
| Sent to the vision model | 1568 px (today's `AgentV3Panel` value) | no |
| Kept in the chat bubble | **≤512 px** | yes — this is the one that must be small |

**Risk:** low. Display-only; a failed downscale falls back to today's behaviour.
**Testing:** unit tests on the pure sizing decision; assert the preview stored is bounded; assert the
sent payload is unchanged.

### 🔴 Doctor AI is deliberately NOT included, and that is a decision for the admin

`SDAChat.tsx` has the same one-value-two-jobs shape — its `preview` is both the API payload and the
retained record — but it downscales to **2400 px at quality 0.92**, not 1568/0.85, and the code says
why:

> *"At the old 1568px / JPEG 0.85 those thin lines smear: a 1mm ST shift or a small q wave can be
> compression artefact rather than signal, and the doctor may start treatment from that reading."*

That is a documented clinical decision, and the retained copy is what a doctor re-opens in the
lightbox to look at an X-ray or ECG again later in the consultation. **Shrinking the retained preview
there is not a free memory win — it degrades the thing a clinician zooms into.** So this change
leaves Doctor AI untouched.

The cost is real but smaller: ~1–2 MB per message rather than ~5.5 MB, accumulating per attached
image in a consultation.

**Admin decision, if the Play Console figures later show Doctor AI is a memory problem:** keep
full clinical quality and accept the memory, or keep full quality only for the most recent N images
and re-fetch older ones on demand. Not something to decide before there is evidence.

---

## P1-2 — Zero-Tap Sign-In / Restore Credentials

| | |
|---|---|
| **Google requirement** | Zero-Tap Sign-In, **April 2027** |
| **Applies to us?** | **Yes** — the rule covers any app supporting sign-in, optional or mandatory |
| **Current status** | Not implemented at all |

**What Google requires.** On a new Android device, first launch of the app must recognise the user
and sign them in with no extra taps, via the Android **Restore Credentials** API (part of Credential
Manager). A restore key is created silently after authentication and travels with Android backup or
device-to-device transfer.

**Why this is not a small task, stated plainly.** Our session is a **Firebase JS SDK session living
inside a WebView**, restored by the Firebase SDK from its own persistence. Restore Credentials is a
**native** Android API. Nothing today bridges the two, and the official documentation covers
passkeys, passwords and Sign in with Google — **not** Firebase custom tokens.

### 🔴 A decision only the admin can make

What does the restore key actually carry? The options differ in security, not just effort:

| Option | How it works | Trade-off |
|---|---|---|
| **A. Server-minted restore token** | On sign-in, our server mints a single-use, revocable token; the restore key holds only that. New device redeems it for a Firebase custom token. | **Most secure and most revocable** — logout/delete kills it server-side. Needs new server endpoints and a token store. |
| **B. Firebase refresh token in the restore key** | Store the SDK's refresh token directly. | Simplest. **A stolen restore key is a long-lived session.** Not recommended. |
| **C. Google-account-only** | Use the documented "Sign in with Google" path; other methods fall back to normal login. | Least work, officially supported. **Covers only our Google users** — phone-OTP and Apple users get no Zero-Tap. |

**My recommendation: A.** It is the only one that satisfies the requirement for *all* our sign-in
methods while keeping the credential revocable, and revocability is what makes device migration safe
rather than merely convenient. But it spends real effort, so the choice is the admin's.

**Non-negotiable regardless of choice** (CLAUDE.md rules 4 and 5): **the OTP/normal login fallback
must remain, and a failed restore must never lock anyone out.** `E2eeUnavailableException` — raised
when the user has no screen lock or no backup enabled — is a **normal outcome to handle**, not an
error to hide.

**Known limits, from the official page:** one account per app; first device profile only (no
work/personal crossover); mobile form factors only.

---

## P1-3 — R8 / DEX optimization

| | |
|---|---|
| **File** | `android/app/build.gradle` |
| **Current** | `minifyEnabled false` + an empty rules file ⇒ **0% / 0% / 0%** against 25% each |

### ⚠️ Read our DEX size before doing this work

Google enforces this *"only where you have non-negligible DEX sizes."* NavBharatAI is a Capacitor
app — most of it is JavaScript in `assets/`, and our DEX is Capacitor + 13 plugins + Firebase + Play
Services. **That may exempt us entirely.** Play Console → App Bundle Explorer answers it in a minute,
and the answer changes whether this is compliance work or optional quality work.

### The trap, and the real risk

`proguard-android.txt` — the file we reference — **explicitly disables optimization**. Setting
`minifyEnabled true` alone would raise shrinking and obfuscation and leave optimization at zero: a
fix that looks complete and satisfies two of three. The correct file is
**`proguard-android-optimize.txt`**.

**And R8 on a Capacitor app is not a flag flip.** Capacitor discovers plugins by **reflection**, and
the bridge exposes methods to JavaScript by **name** via `@JavascriptInterface`. Obfuscation renames
exactly those. The failure mode is a crash **in the release build only** — not in debug, not in CI,
not in any test — which is the worst possible place for it.

**Therefore this ships as its own PR, behind a real device check**, with minimal keep rules each
carrying a comment explaining why it exists. No blanket `-keep class ** { *; }`, which would satisfy
the flag and defeat the requirement.

---

## P2-1 — Unbounded appends on chat surfaces

30 sites match `setX(prev => [...prev, …])` with no nearby cap. **Most are correct** — a list scoped
to a panel the user opens and closes is bounded by that panel. The ones that matter are session-long
chat surfaces (`SDAChat.tsx` ×4, `App.tsx` ×3).

**And the count is the wrong thing to optimise.** A thousand text messages is a few MB; ten messages
with attachments is fifty. **P1-1 is most of this item's value** — do it first, re-measure, and only
then decide whether any cap is worth its cost in deleted user-visible history.

---

## P2-2 — Bitmap / image lifecycle

Threshold: 200 MB foreground/background, 400 MB cached, all devices. Object-URL hygiene is already
good (more revokes than creates). P1-1's downscale reduces decoded bitmap size directly.
**Blocked on Play Console figures** — without them any work here is guesswork.

---

## P3-1 — Bundle and startup

Largely handled by **#2699**: entry chunk **634 → 355 KB gzipped**, headroom ~114 KB. `src/App.tsx`
is 4,084 lines with 3 `React.lazy` imports, but ~40 chunks exist, so splitting happens elsewhere.

**Cold-start milliseconds are not measured** — this session has no Android SDK, emulator or device,
and an invented number is worse than none. **Requires a real device (RULE 10).**

---

## What the admin must do, in priority order

| # | Action | Where | Unblocks |
|---|---|---|---|
| 1 | **Decide the Zero-Tap credential shape** (A / B / C above) | — | The largest item, hard April deadline |
| 2 | **Read our DEX size** | Play Console → App Bundle Explorer | Whether P1-3 is required at all |
| 3 | Read memory P90 **and the P90:P50 ratio** | Play Console → Android vitals | Confirms whether P1-1 was the whole leak |
| 4 | Read bitmap P90 | Play Console → Android vitals | P2-2 |
| 5 | Decide on Monaco's 24 MB in the app bundle | — | App size; costs offline Code Studio |

Items 2–4 are minutes of reading. Item 1 is the one that gates real work.

---

## What I will do next, without waiting

**P1-1**, because it needs no decision, fixes a real leak that affects users today, and reuses an
implementation this repository already has.
