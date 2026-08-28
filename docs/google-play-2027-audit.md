# Forensic audit — memory, leaks, and what actually threatens the 2027 thresholds

**Phase 2, 2026-08-28.** Companion to `google-play-2027-requirements.md`.

The target is Google's memory metric: **Anonymous RSS + Swap, P90 over 28 days**, with a
**P90 : P50 ratio above 3.5×** flagged as a likely leak. That ratio is the useful shape — it means
*long sessions grow*. So this audit is organised around one question:

> **What in NavBharatAI grows during a long session and is never released?**

---

## ⚠️ A correction to Phase 0, first

Phase 0 reported **"79 unbalanced `addEventListener` calls"** and called it the strongest leak signal.

**That number was wrong, and the method that produced it was wrong.** It came from `grep -c` across
`src/`, which cannot tell three different things apart:

1. listeners in **our** client code (real),
2. listeners we **write into other applications** — preview iframes and generated apps — as text
   inside template literals (never run in our process),
3. listeners inside **plain string data**, e.g. a library-catalog entry whose `scriptTag` field
   happens to contain `document.addEventListener("DOMContentLoaded", …)`.

NavBharatAI is an app *builder*: writing JavaScript into other apps is its main job, so category 2 is
large and a raw grep is structurally misleading here in a way it would not be in an ordinary codebase.

Re-measured with template literals stripped and `src/server/**` excluded:

| Measure | Phase 0 (naive grep) | Actual |
|---|---|---|
| Files with an unexplained listener gap | 23 | **3** |
| Unexplained listeners | 79 → 68 | **10** |
| Of those, genuine leaks | — | **0** |

**All ten are correct.** `src/main.tsx` (8) registers app-lifetime handlers once at startup — stale-chunk
recovery, service-worker updates, error reporting, web-vitals. A listener that must live as long as the
app is not a leak. `offlineQueue.ts` (1) is `installOfflineQueueFlush()`, documented "call once at app
startup". `ComponentLibrary.tsx` (1) is the string-data case above. `initWebVitals()` — the only one
registered inside a function — is guarded by a `webVitalsStarted` flag and uses `{ once: true }`.

**The timer audit is clean by the same method:** one `setInterval` without a `clearInterval`
(`main.tsx:127`), which is the service-worker update poll and must run for the app's lifetime.

Recording this because the wrong number would have sent Phase 4 hunting 79 non-existent bugs, and
because it is the more useful lesson: **in this repository, any text-search metric must strip template
literals before it means anything.** `tests/deadEndpointSweep.test.ts` already had a
`stripMultilineTemplates` helper for exactly this reason — the precedent existed and Phase 0 missed it.

---

## 🔴 P1 — Full-size base64 attachments are retained in chat state for the whole session

**This is the real finding, and it is precisely the shape Google's metric detects.**

`src/hooks/useChatEngine.ts:333-350`:

```ts
// Build attachment previews (data URLs) so the image shows in chat
const attachmentPreviews = await Promise.all(
  files.map(f => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: f.name, type: f.type, dataUrl: reader.result as string });
    reader.readAsDataURL(f);          // ← FULL file, base64, as a JS string
  }))
);

const userMessage: Message = {
  …,
  ...(attachmentPreviews.length > 0 ? { attachments: attachmentPreviews } : {}),
};

setMessagesForTab((prev) => [...prev, userMessage]);   // ← never trimmed
```

**What this costs.** Base64 inflates by ~1.37×, and the result is an ordinary JS string — anonymous
memory, exactly what the metric counts:

| User action | File bytes | Retained in heap |
|---|---|---|
| 1 phone photo | ~4 MB | ~5.5 MB |
| 10 photos over a session | ~40 MB | **~55 MB** |
| A 20 MB PDF | 20 MB | **~27 MB** |

It is never released, because nothing trims the messages array. So heap grows monotonically with
attachments across a session and returns to baseline only on reload — a **rising P90 against a flat
P50**, which is the 3.5× signal.

**The half-measure already present, and why it does not help.** Line 466 caps what is *sent*:

```ts
history: historyForAPI.slice(-40).map(…)
```

That bounds the **request**, not the **heap**. The 41st-oldest message stops being transmitted and
keeps its 5 MB data URL in memory forever. A cap that looks like a memory bound and is only a payload
bound is worse than none, because it reads as already handled.

**Fix direction (decided in Phase 3, not here).** Keep a small downscaled thumbnail for the chat
bubble and release the full data URL once the message has been sent. ⚠️ Constrained by CLAUDE.md
rule 12 — **never silently discard user data**: whatever ships must not make a previously-visible
attachment vanish from history. A blob URL with an explicit lifecycle is the other candidate.

---

## 🟡 P2 — 30 unbounded appends to state arrays

Measured with the corrected method (template literals stripped): 30 sites matching
`setX(prev => [...prev, …])` with no cap within ±6 lines.

| File | Count | Session-long? |
|---|---|---|
| `components/ide/GitPanel.tsx` | 6 | no — panel-scoped |
| `components/sda/SDAChat.tsx` | 4 | **yes — a chat** |
| `App.tsx` | 3 | needs review |
| `components/ide/BotBuildHelp.tsx` | 3 | no |
| `hooks/useZipImport.ts` | 3 | no — per-import |
| `components/ide/BotBuilder.tsx` | 2 | no |
| 9 others (Toast, CodeStudio, CICDPipeline, TestPanel, ExtensionMarket, SEOOptimizer, LiveCollaboration, AIChat, useChatEngine) | 1 each | mixed |

**Most of these are fine and must not be "fixed".** A list that lives as long as a panel the user
opens and closes is bounded by the panel's lifetime; capping it would delete visible results for no
memory benefit. The ones that matter are those living for the whole session — the chat surfaces —
and there the retained object size matters far more than the count. A thousand text messages is a few
MB; **ten messages with attachments is fifty.**

---

## 🔴 P1 — R8 is entirely off, and one detail would survive a naive fix

`android/app/build.gradle`:

```gradle
release {
    minifyEnabled false                                           // shrinking + obfuscation OFF
    proguardFiles getDefaultProguardFile('proguard-android.txt'),  // ← optimization OFF *by this file*
                  'proguard-rules.pro'                             // ← empty
}
```

Our three rates are **0% / 0% / 0%** against a 25%-each requirement.

**The detail:** `proguard-android.txt` explicitly *disables* optimization. Setting `minifyEnabled true`
alone would raise shrinking and obfuscation and leave optimization at zero — a fix that looks complete
and fails one third of the requirement. The correct file is **`proguard-android-optimize.txt`**
(✅ verified on `developer.android.com`). `shrinkResources` is a separate switch, also off.

**Before spending effort here, read our real DEX size** (Play Console → App Bundle Explorer). Google
enforces this *"only where you have non-negligible DEX sizes"*, and as a Capacitor app most of
NavBharatAI is JavaScript in `assets/`. That would exempt us from the requirement, not the benefit.

⚠️ **R8 on a Capacitor app is not a flag flip.** Capacitor discovers plugins by reflection and the
bridge exposes `@JavascriptInterface` methods by name — both are exactly what obfuscation breaks, and
the failure is a runtime crash in the release build only, which no test catches. Keep rules must be
added deliberately, minimally, and each with a comment saying why.

---

## ✅ RESOLVED THIS PHASE — the Node server was shipping inside the app

Measured with a real `cap copy android`: **62 MB → 39 MB**. `server.cjs` (7.5 MB) could never execute
in a WebView, and `server.cjs.map` (16 MB) put our readable server source on every user's device.
Fixed by a `capacitor:copy:after` hook so it cannot recur. See PR #2700.

---

## Startup path (ANR / cold start)

`src/main.tsx` is 260 lines and does its work **conditionally and after paint**: web-vitals only in
PROD with consent, service worker only in PROD, offline queue after mount. Nothing heavy is
synchronous before `createRoot`.

`src/App.tsx` is **4,084 lines with only 3 `React.lazy` imports** — but the built output has ~40
separate chunks, so route-level splitting is happening elsewhere. The eager entry chunk is
**634 KB gzipped / 2.3 MB raw**, which is the number that matters for cold start on a low-RAM device.
Worth attention in Phase 6; not a leak.

**Not measured here:** actual cold-start milliseconds. This session has no Android SDK, emulator or
device, so any figure would be invented. **Requires a real device (RULE 10).**

---

## What this audit could NOT determine

| Question | Why not | Who |
|---|---|---|
| Our real memory P90 / P50 ratio | Production telemetry | Admin — Play Console |
| Bitmap memory P90 | Production telemetry | Admin — Play Console |
| Our DEX size | Needs the uploaded bundle | Admin — App Bundle Explorer |
| Cold/warm/hot start times | No Android SDK or device in this session | Admin — real device |
| Whether heap returns to baseline after navigation | Needs a profiler on a device | Admin — Phase 10 |

---

## Summary

| Area | Verdict |
|---|---|
| Event-listener leaks | ✅ **Clean** — Phase 0's "79" was a measurement error |
| Timer leaks | ✅ **Clean** — 1 gap, correctly app-lifetime |
| Object-URL leaks | ✅ Clean — more revokes than creates |
| **Base64 attachments retained in chat state** | 🔴 **P1 — the real leak** |
| Unbounded state appends | 🟡 P2 — 30 sites, most legitimately panel-scoped |
| **R8 / DEX optimization** | 🔴 **P1 — 0/0/0**, and a trap in the default rules file |
| Node server in the APK | ✅ Fixed (PR #2700) |
| Startup work before paint | ✅ Clean; entry chunk size is a separate concern |
| Zero-Tap Sign-In | 🔴 **Not implemented** (Phase 8) |

The honest headline: **the codebase is in better shape than Phase 0's numbers suggested.** The listener
and timer hygiene is genuinely good. Two real problems remain — one that grows memory during exactly
the session Google measures, and one that is a compliance gap rather than a defect.
