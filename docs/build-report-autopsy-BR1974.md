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
| Capture Play Store / go-to / link / redirect / kholo / launch store opens | Independent reviews found a new false-positive class each round versus origin/main (version of our game, developer page, agreement, review guidelines, data safety form, promo campaign, Connect dashboard, developer account, plus earlier publish-only / launch-to / listing / deep-link / Hinglish daal-kar classes). | Leave Q-2649. |
| Raise or lower the free cap; mark unfinished work finished | First render at 285 s; POST_GREEN_WRITES 14; READY_BEFORE_END not measured on edits. | Billing / unfinished-as-finished. | Do not ship. TODO_ONLY_TURNS already Q-2375 / Q-1068. |

## Review follow-up (#4165)

F1 at `aba7e765` over-narrowed `open\s+` to only `other apps` / `another app` / `the apps`, so "open apps like YouTube", "please open apps" and "open the app store" missed the brief. The follow-up:

- Matches plural `open apps` (no article) and keeps `open the apps` / `open other apps` / `open another app`.
- Matches the frozen compounds `app store` / `play store` / `app drawer`.
- Keeps singular launch-this-app language uncaptured: "open the app", "when I open the app", "when the app opens", "open the app to see…", "opening the app".
- Decision: "open the app settings" stays uncaptured — that is this application's settings screen (in-app navigation), the same class as "open the app to see…". "app store" and "app drawer" are frozen compounds for OS surfaces that acquire or launch other apps, not "the app" plus a trailing noun.
- Decision: "open the app drawer" matches, because the drawer is the launcher surface for installed apps.
- "open WhatsApp chat with this number" still matches (a later "number" after "chat" is not a WhatsApp-number identity field).

The first follow-up at `060b32b0b` treated bare `app store` / `play store` as matches. That was rejected: a prompt that only says it will publish to the store must not pick up `@capacitor/app-launcher` (owner rule t311u — fix A must not create X). The reviewer asked for "open the app store", not a bare store mention.

Second follow-up:

- `app store` / `play store` match only with an open, launch, redirect, or link verb: "open the app store", "Open the Play Store", "button to open Play Store", "redirect to app store", "link to play store page", "launch the app store".
- Must not match: "publish to App Store", "upload to Play Store", "Play Store listing", "App Store screenshots", "ready for app store release", Hinglish "play store pe daalna hai".
- Decision: a bare "app drawer" is the same risk — builders ask for a navigation/hamburger drawer in THIS app ("add an app drawer"). Require the same verb, so "open the app drawer" still matches and "add an app drawer" / "navigation app drawer" / "hamburger app drawer" do not.
- Ordinary merge of `origin/main` at `c072e0eb96ee3390d90e07b91d55f06bc54e6108` (#4166). No rebase.

Third follow-up (`5fb218c75` reviewer FAIL):

- `launch` only counts as "launch the app store" (optional the/a/an/our/my). `launch to/on/in` the store is a publish idiom: "we will launch to the Play Store next week", "launch to the App Store", "launch on Play Store" stay uncaptured.
- A store name followed by listing/developer/account/console/release/screenshots/"page for my …" is this app's store presence: "open a Play Store developer account", "open our Play Store console", "launch our play store listing" stay uncaptured.
- Decision: "link to play store page for my own app listing" does **not** match. A get-it-on / rate-us button pointing at this app's listing is not a request to open other apps via `@capacitor/app-launcher`. Ambiguous + names "listing" → do not capture. "link to play store page" without listing language still matches.
- "deep link" is not the `link` verb (`(?<!deep\s)link`); "hyperlink" never was (no word boundary). "deep link to the Play Store" stays uncaptured.
- False negatives restored without a bare store alternative: "play store kholo", "app store kholo", "play store kholna hai", "play store khol ke dekho", "app store mein kholo" (post-nominal Hinglish `khol`, optional mein/me/ko/par/pe/se), and "go to the play store". "play store pe daalna hai" and a bare "Play Store listing" stay unmatched.

Fourth follow-up (`e71c4bd44` reviewer FAIL — stop patching literal phrases):

- Store/link matching moved out of one mega-regex into `openAppsAsked` clause-level rules. `requestedCapabilities` routes the `open-apps` row through that function. Named sources (`OPEN_APPS_*`) are exported so mutations edit the actual logic.
- Deep-link guard is a prefix test equivalent to `(?<!deep(?:ly)?[\s-]*)` and does not itself use a lookbehind (server-only file; `src/main.tsx` / `src/App.tsx` do not import it). "deep link", "deep  link", "Deep  Link", "deep-link", "deeplink", and "deeply link" never count as the link verb. `\blink` still keeps "hyperlink to the play store" out.
- Own-listing exclusion is clause-level: if the same sentence/clause (split on `.!?`;` and newlines, not commas) as the store mention contains listing / developer account / console / release / screenshots / publish / upload / submit / daal(na) anywhere, do not capture via the store alternative. "link to play store page for our/the/this/my app listing" and "open the play store page of my app listing" stay out; "open play store page" and "link to play store page" still match.
- Hinglish: any store+khol phrase in a clause that also has daal/publish/upload (including "play store pe khol ke daal dena") does not match. "play store pe khol ke dekho" and "play store kholo" still do.
- `khol do` is excluded only when the same clause both names a store and has listing language, so "khol do play store listing" is out and plain "khol do" / "khol do play store" stay in.
- Self-found residuals (conservative FNs of the requested clause rule, not new false positives): a genuine "open the play store" in the same clause as unrelated "console" / "release" / "screenshots" / "submit" / "publish" / Hinglish "daal" (lentils); commas are not clause boundaries so "open the play store, then edit the listing" is also excluded. Word boundaries on the store token and on open/go/launch verbs also stop "play storefront" and "undergo the Play Store review".

Fifth follow-up (`9d51b7ba0` reviewer FAIL — bare tokens were a regression vs origin/main):

- Clause-level exclusion stays, but it now binds to store-publish *idioms* only: submit/publish/upload to/on the store; Play Console / developer console / developer account; store listing / listing page / app listing; store screenshots / screenshots for the store; store release / release on the store; Hinglish daalna/daalo/daal dena/daal do after a store + pe/par/me/mein particle. Bare submit/screenshots/release/console/listing and the word "published" do not exclude.
- Genuine opens that origin/main captured, and the listed App Store / Play Store equivalents, match again (submit a review, screenshots carousel, after we release, admin console, new release, apps we published, music console, daal makhani).
- A hard regression gate snapshots open-apps.asks at origin/main `c072e0eb9` and asserts every genuine open in the corpus that matched there still matches at this head.
- Same-clause pairing: a publish idiom wins over a genuine open (do not capture via the store alternative). Justification: that clause is typically about this app's store presence; splitting across sentences still matches the open. Bare tokens in those pairs still match.
- Self-found residuals (tight idioms, not queued): "play store ko khol ke daal do" (ko is not pe/par/me); "play store pe khol ke publish/upload karna" (not daalna and not publish/upload to/on the store); "publish our app to the Play Store" / "submitted to" / "released on" with a genuine open in the same clause (extra words or tense beyond the listed idiom).

Sixth follow-up (close residuals at `1956cdd90` before review):

- Hinglish publish particles include `ko` and `se`, so "play store ko khol ke daal do" and "play store se khol ke daal do" stay out. Plain "play store ko kholo" / "play store se kholo" still match.
- Hinglish `publish`/`upload`/`submit` + `karna`/`karo`/`kardo`/`kar do`/`kar dena`/`kar de` after a store + particle is a publish idiom.
- English publish verbs accept tense (`submitted`, `published`+to/on, `released`, `uploaded`, `publishing`) and a few intervening object words before `to`/`on` + store. Conjunctions and open-verbs are not objects, so "publish this then go to the Play Store" still matches. Bare "published" / "After we release" / "submit a review" still match.
- Remaining residuals (not queued): "open the play store and submit karna" without a store particle; "released in the Play Store" (`in` is not to/on).

Seventh follow-up (reviewer FAIL at `0911ab617` — 8-word publish idiom + idiom-wins dropped origin/main App Store opens):

- Switch to precedence that cannot regress versus main. Rule A: an explicit open of the store itself always matches, whatever publish language is in the clause. Explicit = open/launch followed directly by (the) App/Play Store, or store + optional pe/par/me/mein/ko/se + khol. The only exclusion is a store-presence object immediately after that store name (listing, developer account, console, page for/of my|our|the|this app listing, screenshots, release). Hinglish khol followed by daal/publish/upload/submit + kar* in the same short phrase is not explicit.
- Rule B: link/redirect/go keep clause-level publish idioms, plus publish-family language at the end of the clause (`go to the play store and publish my app`, and the parallel upload/submit-my-app/submit-karna forms).
- The six lost origin/main repros match again, along with "released in the Play Store" and "open the play store and submit karna" (documented as an acceptable explicit open).
- Strengthened regression gate: the whole corpus is run through origin/main's regex; any prompt main matched that is not on an explicit reviewed must-not-match list must still match.
- Remaining residuals (not queued): "open the google play store" and "open up the App Store" (an extra word sits between open and the store, so they are not Rule A; origin/main also missed them).

## Queue

This commit **closes no row**. It opened Q-2647 and Q-2648, and now opens **Q-2649** (Play Store / go-to / link / redirect / kholo / launch store opens). Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068 and earlier blockers stay open.

Eighth follow-up (reviewer FAIL at `a9973b7cc` — Rule A's open-ended tail created Play Store false positives versus origin/main):

- Store phrases behave like origin/main `c072e0eb9`, with only one change: the reviewed App Store presence tails (`open the App Store listing` / `screenshots` / `release` / `release notes` / `listing page`) may stay unmatched.
- App Store forms that main matched via `open the app` still match (`open the app store`, the six lost repros, `open the App Store version of our game`). Store forms that main did not match stay unmatched: Play Store opens, `go to the play store`, link/redirect to the store, `play store kholo`, `launch the app store`, and the review FPs (version of our game, developer page, agreement, review guidelines, data safety form, promo campaign, Connect dashboard, for my developer account).
- Rule A/Rule B new captures and the idiom machinery that only existed to gate them are removed. `khol do play store listing` matches again (main captured it via `khol do`; it is not an App Store presence-tail form).
- Actual BR1974 fixes stay: WhatsApp number/id field exclusion (including Hinglish); singular `open the app` / `open the app settings` unmatched; plural `open apps` / `open apps like YouTube` matched; `open WhatsApp chat with this number` matched; explicit `open the app store` and `open the app drawer` so dropping singular `open the app` does not lose those main captures.
- Two-sided regression gate over the whole corpus, review repros included: (a) every prompt main matched still matches, except the small reviewed must-not-match list (WhatsApp fields, singular open-the-app, App Store presence tails); (b) every prompt main missed still does not match, except the small reviewed must-match list (plural open-apps phrases and `open WhatsApp chat with this number`, which main already captured).
