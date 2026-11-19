# Android 1.0.156 ANR investigation

Evidence review: 2026-11-18. Diagnostic candidate reconciled against main `7ed84508cadc587ac9e6ca2b815cdd88eb408dc2` on 2026-11-19.

## Status: cause unconfirmed; diagnostic-only candidate

Owner supplied Android 11, Xiaomi M2006C3MII and Vivo devices, two events/two users in one issue; 50% background. Dashboard total reportedly four events/four users across three issues. Selected event November 17 20:34:49 (timezone unknown). Main frames include nativePollOnce, ART ConditionVariable::WaitHoldingLocks/JNI and missing WebView Chromium frames. No complete all-thread event, input-dispatch reason, breadcrumbs or WebView package version is available here. The initial investigation had no connected Crashlytics tool; the evidence listed here is owner-supplied, not a fresh dashboard query.

An idle-looking sampled main thread does not identify the timed-out operation. Neither vendor, WebView nor Binder is established as the cause. Do not suppress this cluster, disable Crashlytics or label this change a permanent fix. Official guidance: https://developer.android.com/topic/performance/anrs/diagnose-and-fix-anrs

## Source audit

The audited native plugin files, MainActivity and Capacitor configuration are unchanged between the original investigation base and reconciliation base. These findings describe inspected source, not measured device behavior.

- MainActivity registers three native plugins before Capacitor bridge creation, then delegates lifecycle. No app-owned startup loop, blocking future/join/wait or synchronous HTTP found there.
- Capacitor config uses bundled dist, native authentication with skipNativeAuth and automatic splash dismissal. Authentication/cache/history/navigation must stay intact.
- DeviceIntegrity reads Settings.Secure (a provider/Binder operation), constructs integrity client and requests an asynchronous token. Capture actual calling thread and latency before moving any operation.
- MetaConsent reflects SDK initialization after consent. No measured stall or event correlation establishes it as culprit.
- PlayBilling lazily constructs a synchronized client and uses async setup/query/consume callbacks. Billing IPC/callback timing and lifecycle are investigation targets, not demonstrated causes of these ANRs.
- Native shell setup bounds imports and does not await splash hiding behind status bar. JS bridge saturation/long rendering still require device traces.
- Do not replace WebViewClient, globally pause timers, clear persisted state or force-restart the activity as a speculative mitigation.

## Changes

Debug-only StrictMode thread/VM detection logs violations without penaltyDeath. Debug-only balanced Trace sections surround bridge creation and start/resume/pause/stop/destroy, retaining every superclass call and propagating exceptions. Only constant event names are traced: no URL, token, user ID or prompt. Release Crashlytics configuration is not modified by this patch. The onCreate trace starts after plugin registration, so it does not measure registration cost. StrictMode can perturb timing and log paths or stack context; use synthetic accounts and redact exported logcat. This improves reproduction evidence; it is not an ANR fix and does not add production breadcrumbs.

## Required evidence and reproduction

1. Export each original event with ANR type/reason, timestamp/timezone, every thread/held monitor and breadcrumbs. Record device RAM/free storage, Android patch, WebView/Chrome package/version and battery restrictions. Preserve redaction of credentials and user content.
2. Reproduce release 156 and candidate on Android 11 Xiaomi/Vivo and API30 emulator. Compare bundled web build and signed variant. Emulator alone cannot establish OEM parity.
3. Collect Perfetto scheduler/Binder/WebView traces and debug StrictMode logcat during cold start, sign-in/return, 30 background/foreground cycles, keyboard/back/navigation, AI streaming and Pro preview. Capture hangs including blocked owners, not only final sampled idle stack.
4. Include rotation/activity recreation, process recreation, external auth callback, offline transitions and memory pressure. Confirm sessions remain and purchases never duplicate; use sandbox test billing only.
5. Device regression acceptance: bridge remains available after lifecycle cycles; all three product surfaces still function; no new StrictMode main-thread I/O attributable to app changes; record percentile startup/resume/input latency. A passing source test is not this acceptance.

## Validation and rollout

The included source-contract tests assert the debug guard, balanced finally blocks, plugin ordering and absence of cache/history/Crashlytics changes. They do NOT execute Android lifecycle or reproduce an ANR. No tests, native builds, provider calls or workflows were run or triggered during this reconciliation. Earlier test results are not validation of this reconciled tree. Required validation remains native compile, Android unit/instrumentation checks where available, relevant exact-head CI and device reproduction. A separately successful hosted release build does not compile or validate this unmerged diagnostic patch.

Do not merge or distribute an executable diagnostic build until native build, exact-tree required checks and independent review pass. First distribute debug diagnostic build internally with synthetic/test accounts. Once cause confirmed and fixed, staged Play rollout (small cohort then gradual increase), comparing ANR rate per active user by Android/WebView/device/version to baseline; halt expansion on regression. No signing, store upload, workflow dispatch or rollout was performed.
