# BR1974 — a Chess Squad welcome-screen edit that was handed WhatsApp/SMS plugins

Scope: BR1974 only, inside the frozen audit boundary 1951..2105. Branched from `01f2a9b8853c370d90f43e647edc8a9bd20ec478` (the #4164 squash-merge of exact BR1973 head `d4fb2ee54`, which is origin/main at branch creation). The parent reviews and merges this PR; BR1975 is not started. Nothing was replayed, deployed or reconfigured; no provider was called. `get_failed_build_autopsy` is a failed-build endpoint and returned "Failed report not found" for this succeeded report — read only, no remote autopsy write.

The optional #4164 review hardening is shipped here as a small extra fix (F2): the case-study lookbehind class now includes the en dash U+2013 and the em dash U+2014, so "case–study app" / "case—study app" no longer leak to `simple_app`. Tests and a mutation lock it.

## What the user asked

An *edit* of an existing Chess Squad app (PROJECT_MODE on; READY_BEFORE_END: "this turn ran as an edit of the files already in the project"): every visitor must see a welcome screen first (logo, nickname, WhatsApp mobile number, NEXT). The named owner (INDRA_NEXUS) gets unlimited points after entering both fields; other members start at 5 points; members with the same nickname are distinguished by mobile number; the dashboard must never open automatically; there must be a way back to the welcome screen to switch members. On reopen, show the welcome screen again.

The prompt is 1563 characters / 261 words. Full text is in the evidence file.

## What happened (IST, 2026-11-08)

1. **09:36:59.** FREE_BUILD_TIME_CAP 25 min. APP_SCOPE ordinary one-shot. TIER_LADDER Weak default. COMPLEXITY_ROUTING COMPLEX score 68 (source=model) — opens on the second rung. Surplus admitted (qwen3-coder). ETA ~13–20 min (midpoint ~16, blended, confidence 0.68, unevidenced) from the `complex_app` band.
2. **09:37:03.** NATIVE_CAPABILITY_BRIEF: the builder was given the exact phone plugins for **open-apps**. CHANGE_CLASSIFIED large (risk high, depth deep); also cross-cutting, bug, feature — the request is 261 words (above the 120-word large threshold) and names login/navigation, a fix, and show/display. PROJECT_MODE on; not a fresh build.
3. **09:37:59.** EXPLORATION_WITHOUT_CHANGE: 8 read-only turns.
4. **09:41:44.** First real-browser render at 285 s (19 files last-known-good).
5. **09:45:44–09:46:35.** READINESS_WARNING: no tests at all (e2e scaffold written later). RELEASE_GATE GREEN — shippable; a form was filled and submitted ("nothing was saved and reloaded" was not established). POST_GREEN_WRITES: 14 files after first render (build loop 11, e2e-scaffold 2, architecture-note 1). TODO_ONLY_TURNS: 2 (13.9 s; already Q-2375 / Q-1068). DEVICE_CAPABILITIES_TOLD: open-apps. Ended 09:46:35 (576663 ms / 9.61 min). ETA ratio 0.595, UNDER the band.

Charged false (weak / free tier; billedUsd 0). Sandbox cost $0.026471. Outcome **succeeded** (`ok=true`). Truncation complete (the report is whole). 0 problems recorded. counts.unresolved is 1 (the GREEN release-gate advisory). Accessibility 100/100; design consistency 100/100. Manifest 22 files including `src/components/WelcomeScreen.tsx`, `src/components/Dashboard.tsx`, `src/store.ts`.

The user-facing summary said the builder "Installed required Capacitor plugins (@capacitor/core and @capacitor/app-launcher)" and added "WhatsApp and SMS integration for contacting support" with "Works in the phone app" notes. The request never asked to open WhatsApp, send an SMS, or contact support. It asked for a *WhatsApp mobile number* as a login identifier.

## Root cause (F1)

`nativeCapabilities.ts` `open-apps.asks` contained a bare `whats\s*app`. "Enter Your WhatsApp Mobile Number" (and "WhatsApp number") matched it. Once open-apps fired, the builder brief's *label* is "calling, SMS and opening WhatsApp or other apps", so the model also added SMS/calling contact features and installed `@capacitor/app-launcher`. The same regex's `open\s+(?:the\s+)?(?:app|apps)` would also have matched "when I open the app, show the welcome screen" (this report used "opens the app" / "open CHESS SQUAD", which the old pattern happened not to hit).

This is the same stray-word class as the contacts row (never a "Contact us" page) and the location row (never an "Event location" field).

## Prevention classes in this PR

| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | A WhatsApp *number* / *id* is an identity field, not a request to open WhatsApp. "when I open the app" is launching this app, not opening another one. Same-class phrases (whatsapp khole, open WhatsApp, send a WhatsApp message, make a call, open other apps) still match. | `open-apps.asks` in `nativeCapabilities.ts` | `tests/aWhatsAppNumberIsNotAnOpenAppsRequest.test.ts` (report prompt, opposite-class number/id/launch phrases including Hinglish bypasses, same-class open/call phrases, Jarwis and Contact-us neighbours) |
| F2 | "case–study app" / "case—study app" (U+2013/U+2014) are not study apps. The #4164 reviewer noted the leak; shipped here as a small extra. | `PRACTICE_TOOL_SOURCE` lookbehind in `RequirementGapAnalyzer.ts` | `tests/theStudyAppWasNotAnLms.test.ts` (opposite-class corpus + dedicated en/em-dash `it`) |

## Side-effect review (owner rule t311u)

| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 tighten `whats\s*app` with a negative lookahead for (optional ka/ki/ke/your/my/the/wala/wali) + (optional mobile) + number/no/phone/id; replace `open the app` with `open other apps` / `open another app` / `open the apps` | Jarwis ("aur whatsapp khole") still gets `@capacitor/app-launcher@7.0.4`. "open WhatsApp", "send a WhatsApp message", "contact me on WhatsApp", "make a call", "call mummy", "app kholo" still match. Music player / todo / Contact-us still ask for nothing (`phoneFeaturesAreBuiltForReal`, `theMusicPlayerIsNotATwentyThreeModuleProject`). The bare `sms` alternative is unchanged. | A request that says only "WhatsApp" as the thing to open still matches (no number-word after it). "WhatsApp Business" without number/phone still matches — acceptable (they likely want to open or integrate WhatsApp). | Ship. Opposite-class corpus written before the edit, with own bypass attempts in both directions. |
| F2 add U+2013/U+2014 to `(?<!\bcase[\s\-/,]+)` | Showcase/lowercase/briefcase, "study  app", self-study, bible study and the report study-app prompt stay captured. Earlier case-study / craft-word / institution opposite-class phrases stay uncaptured. | `study[\s-]+` does not itself accept en/em dashes, so a "study–app" (en-dash, no space) would not newly become a study app. | Ship. Mutation: dropping the two dashes turns red. |
| Demote `dashboard` so a personal dashboard is not complex_app/68 | COMPLEX_APP_SIGNAL. | Would also demote admin dashboards / SaaS consoles. Weak preflight independently said model. | Leave Q-2647. |
| Tighten bare `sms` | Same `asks` regex. | "send an SMS" must keep open-apps. | Leave Q-2648. |
| Raise or lower the free cap; mark unfinished work finished | First render at 285 s; POST_GREEN_WRITES 14; READY_BEFORE_END not measured on edits. | Billing / unfinished-as-finished. | Do not ship. TODO_ONLY_TURNS already Q-2375 / Q-1068. |

## Queue

This commit **closes no row** and **opens Q-2647 and Q-2648**. Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068 and earlier blockers stay open.
