// 💡 SUGGESTIONS FROM WHAT THE LAST BUILD ACTUALLY MEASURED (admin 2026-08-20: "us app ki memory ke
// hisab se suggestion ane chahiye, aise random nahi").
//
// This is the second half of linking the bulb to the app's memory. The first half reads what the user
// ASKED FOR (memoryLinkedSuggestions). This one reads what the build itself FOUND — the diagnostics
// report saved for this workspace: pages that came out plain, dependencies with known vulnerabilities,
// a test suite that failed, errors the app threw when it ran. Those are measured facts about THIS app,
// which is exactly what "not random" means.
//
// WHY A CURATED TABLE RATHER THAN THE ISSUE'S OWN MESSAGE. A diagnostic message is written for an
// engineer reading an autopsy — it names files, tools and sometimes providers. Surfacing it raw would
// be unreadable to the user AND a White-Label risk. So each code maps to a sentence written for the
// person who pressed the button, and a code with no entry produces NOTHING. That is deliberate: a
// finding we cannot phrase honestly and usefully is better left out than paraphrased by guesswork.
//
// WHAT IS DELIBERATELY EXCLUDED, and why each one would be a bug if included:
//   • autoResolved issues — the build already fixed them; suggesting a fix for a fixed thing is noise.
//   • observations — findings about the user's PRE-EXISTING code that our build did not cause.
//   • summary codes (RELEASE_GATE) — a roll-up of other findings; it would duplicate them.
//   • measurement-only codes (TIME_TO_FIRST_CALL, RUNTIME_UNCHECKED, TEST_SUITE_UNVERIFIED,
//     JOURNEY_NOT_DERIVED) — they record what WE could not verify, not something the user's app can
//     fix. Asking the user to "fix" our own missing measurement would be dishonest.
//
// 🔴 EVERY PROBLEM THE USER IS SHOWN NOW HAS TO BE CLASSIFIED (census 2026-10-04). Both this table and
// `PROCESS_ONLY_CODES` were hand-maintained, each gaining a name AFTER a defect had already reached a
// user. Counting them settled how bad that had become: **26 problem-severity codes were in no registry
// at all** — so `isAppFinding` said yes to all of them, every one appeared in the user's build-health
// card as a problem with THEIR app, each took 6 points off their app's health score, and none had a
// button to press. Eight were purely our own run (our cost ceiling, our loop breaker, our checks that
// could not look); thirteen were real app defects with no offer, including `DATABASE_RLS` — tables with
// no row-level security, which in a published app is a data breach, recorded at ERROR severity with
// nothing to press.
//
// So a problem-severity finding now has exactly three possible homes, and no fourth:
//   1. `PROCESS_ONLY_CODES` (BuildDiagnostics.ts) — our own process; never a mark against the app.
//   2. this table — a real app defect, with a one-tap fix written for the person who pressed the button.
//   3. `APP_FINDINGS_WITHOUT_AN_OFFER` below — a real app finding we deliberately do not offer, with
//      the reason stated.
// `tests/aProblemTheUserIsShownCanBeActedOn.test.ts` reads the real registries out of the real modules
// and FAILS CI when a new code appears outside all three. A name added to a hand-list is no longer
// something anyone has to remember. (A roll-up that restates an offered finding is offered through it —
// `OFFERED_THROUGH`, Q-381 batch three — so it is in the second home, not a fourth.)
//
// PURE: no I/O, no clock, no model. Never throws.

import type { NextSuggestion } from './nextBuildSuggestions';

/** The subset of a diagnostics issue this module needs — kept structural so the report type is free to grow. */
export interface FindingLike {
  code: string;
  autoResolved?: boolean;
  observation?: boolean;
  severity?: string;
  /** The finding's own sentence. An entry with `withEvidence` hands it to the fix, bounded. */
  message?: string;
}

/** How many build-finding suggestions may appear at once — the list has other layers to show. */
export const MAX_FINDING_SUGGESTIONS = 3;

/**
 * Code → what to offer the user. Ordered by how much the user would feel the difference.
 *
 * Every string here is user-facing: plain language, no tool names, no provider names, no file paths.
 */
export const FINDING_SUGGESTIONS: Array<{ code: string; title: string; detail: string; prompt: string; withEvidence?: boolean }> = [
  // ── AN APP THAT NEVER RAN OUTRANKS EVERYTHING (added 2026-10-04's census) ───────────────────────
  // These two were measured, recorded as warnings, shown in the user's build-health card — and had no
  // offer, so the one thing the user most wanted to press was the one thing missing.
  {
    code: 'PREVIEW_NEVER_CAME_UP',
    title: 'Get your app running',
    detail: 'The build finished but your app never came up, so nothing in it has been proven to work.',
    prompt: 'The build finished but the app never started, so nothing could be checked. Find out why it does not start — the entry file, the dev server, a missing dependency or a crash at load — fix the real cause, and confirm the app opens and renders.',
  },
  {
    code: 'PREVIEW_NOT_RENDERED',
    title: 'Fix the app that opens blank',
    detail: 'Your app was opened in a browser and nothing rendered.',
    prompt: 'When the app is opened in a browser it does not render — a blank screen or an error instead of the app. Find the real cause (the mount point, the entry script, an error thrown while loading) and fix it, then confirm the app renders.',
  },
  // ── Q-381 BATCH THREE (2026-10-11): app findings that were shown with nothing to press ──────────
  // Each was a warning about the user's app in their build-health card, with no button. Every one is
  // either the final state of its check or is answered when a later check passes (the HEAL_RESOLVES
  // map, or `resolveOnRecheck`), so an offer here never outlives the problem it names.
  {
    // A real browser opened the app and saw OUR starter page (stillTheStarterApp.ts, autopsy 3ab93068).
    // Answered by the route when a later look sees the app itself render.
    code: 'STARTER_STILL_SHOWING',
    title: 'Show your app instead of the starter page',
    detail: 'Your app opened, but what it showed was the starter page it began from — not the app that was built.',
    prompt: 'When the app opens in a browser it still shows the starter page it began from, not the app that was built. Make the entry file render the real app — its main screen and its navigation — so the starter page never appears, and confirm in the browser that the app itself shows.',
  },
  // ── Q-381 BATCH SIX (2026-10-12): the last app findings with nothing to press ─────────────────────
  {
    // The in-browser preview would not compile (PREVIEW_COMPILE_HEALED answers it when its heal works;
    // OUTCOME_PREVIEW_COMPILE, the line the build records when it does not, is offered through this one).
    code: 'PREVIEW_COMPILE_DIVERGENCE',
    title: 'Fix the preview that will not compile',
    detail: 'Your app\'s live preview could not compile, so it opens blank in the browser.',
    prompt: 'The app\'s live preview does not compile in the browser, so it opens blank there even if the project builds. Fix the cause named below — an import the browser cannot load, syntax the preview does not support, a missing file — and confirm the preview opens and renders.',
    withEvidence: true,
  },
  {
    // The live preview still did not render or run cleanly after the build's own repair attempts.
    code: 'OUTCOME_PREVIEW_FAILED',
    title: 'Fix what stops your app running',
    detail: 'Your app was opened in a browser and it still did not run cleanly after the repairs.',
    prompt: 'The app was opened in a real browser and it still does not render or run cleanly after the automatic repairs. Fix each problem listed below at its real cause — a crash while loading, an error thrown by a screen, a missing piece — and confirm the app renders and runs without errors.',
    withEvidence: true,
  },
  {
    // The final look at an app nothing had proven yet: it did not render, or could not tell.
    code: 'LAST_CHANCE_PROOF',
    title: 'Make sure your app opens',
    detail: 'Nothing has proven your app runs yet — the last check did not see it render.',
    prompt: 'Nothing has proven this app runs yet: the last check of the live preview did not see it render. Open the app, find what stops it rendering cleanly — the entry file, a crash at load, a missing piece — fix the real cause, and confirm in the browser that the app opens.',
  },
  {
    // The app's preview failed after the build, reported by the screen that showed it (the error is the
    // preview's own words, so it travels with the fix).
    code: 'PREVIEW_ERROR',
    title: 'Fix the error your preview hit',
    detail: 'When your app\'s preview opened, it failed with an error.',
    prompt: 'When the app\'s preview opened, it failed with the error below. Find its real cause — a file that does not compile, a value that is missing, a crash while loading — fix it, and confirm the preview opens cleanly.',
    withEvidence: true,
  },
  {
    // The build ran out of time and was stopped. Continuing is the obvious next move.
    code: 'BUILD_TIMEOUT',
    title: 'Finish building your app',
    detail: 'The last build ran out of time before it finished.',
    prompt: 'The last build ran out of time before it finished. Continue from where it stopped: finish the parts that are not done yet, keep everything that is already there and working, and confirm the app builds and opens.',
  },
  {
    // The syntax gate's finding when its repair could not clear it (SYNTAX_HEALED answers it otherwise).
    code: 'SYNTAX_ERROR_DETECTED',
    title: 'Fix the code that does not compile',
    detail: 'Some of your app\'s files have a mistake in them, so the app cannot be built.',
    prompt: 'Some files in this app do not parse, so the app cannot compile. Fix each mistake listed below at its real cause — a missing bracket, a duplicate declaration, a broken string — without rewriting what already works, and confirm the whole app builds and opens.',
    withEvidence: true,
  },
  {
    // Imports that resolve to nothing (MISSING_FILES_HEALED answers it when the creation pass works).
    code: 'MISSING_FILES_DETECTED',
    title: 'Add the parts of your app that are missing',
    detail: 'Your app refers to files that are not there, so parts of it would crash.',
    prompt: 'Some files in this app import other files that do not exist or point to the wrong place, so the app would crash when it reaches them. For each one listed below, correct the path if the file exists somewhere else, or create the missing file so it does what the files that import it expect. Then confirm the app builds and every screen opens.',
    withEvidence: true,
  },
  {
    // A name imported from a file that does not export it (MISSING_EXPORT_HEALED answers it otherwise).
    code: 'MISSING_EXPORT_DETECTED',
    title: 'Connect the parts that cannot find each other',
    detail: 'One part of your app asks another for something it does not provide, so the app cannot be built.',
    prompt: 'Some files in this app import a name that the other file does not export, so the build fails. For each one listed below, make the file export what the files importing it actually use (or correct the import if the name is wrong), keep the behaviour the same, and confirm the app builds and opens.',
    withEvidence: true,
  },
  {
    // A page that USED to render and now does not — the regression the route fingerprint catches.
    code: 'ROUTE_REGRESSION',
    title: 'Bring back the page that stopped working',
    detail: 'A page that worked before this change does not open any more.',
    prompt: 'A page that used to work has stopped opening after the last change. Find what broke it, fix that, and check that every page of the app opens again — including the ones that were already working.',
  },
  {
    // 🔐 A PUBLISHED APP WITH NO ROW-LEVEL SECURITY IS A DATA BREACH, not an advisory. The anon key
    // ships inside the published page by construction, so without RLS anyone who opens the app can
    // read and write every row in the table. It was recorded at ERROR severity with no offer at all.
    code: 'DATABASE_RLS',
    title: 'Lock down your database',
    detail: 'Your database tables are open — anyone who opens your app could read or change other people\'s data.',
    prompt: 'The database tables in this app have no row-level security, so anyone who opens the published app could read or change every row. Turn row-level security on for every table and add policies so each signed-in person can only read and write their OWN rows, with anything public explicitly marked read-only. Keep the app working after the change.',
  },
  {
    // Autopsy e52cebbf (Q-730): the app asked its visitors to paste an AI key, and sent it from the page.
    code: 'AI_KEY_IN_BROWSER',
    title: 'Take the AI key out of your app',
    detail: 'Your app calls an AI service straight from the page, so its key would be visible to everyone who opens it.',
    prompt: 'This app calls an AI provider directly from browser code, so the provider key has to live in the page where every visitor can read and spend it. Replace every TEXT call with NavBharatAI\'s built-in keyless AI helper (generateText / chat); for AI PICTURES, use the generate_image_ai recipe, which asks NavBharatAI through the owner\'s own image key saved in Keys & Secrets — pictures are never keyless. Remove any box or setting that asks for an AI key and any key read from storage or the environment in browser code, and keep the feature working. Save the user\'s own data first, then add the AI result when it arrives.',
  },
  {
    // Recorded only on an import turn, where the user asked for no file to change, so the credential-in-logs
    // redaction is reported instead of applied — and its own message says "ask me to fix them". This is that ask.
    code: 'COMPLIANCE_LOG_LEAK_FOUND',
    title: 'Stop your app printing secrets in its logs',
    detail: 'Some lines in your project write a password, key or token to the logs, where anyone who can read them could copy it.',
    prompt: 'Some logging lines in this project print a password, key or token. Change every one so the secret is never written to a log — log that the value is present, or a masked form, never the value itself — and change nothing else.',
  },
  {
    code: 'BOOT_KILLING_ENV_GUARD',
    title: 'Stop one missing key from killing the app',
    detail: 'If one setting is missing, the whole app refuses to start instead of just that one feature.',
    prompt: 'The app refuses to start when one configuration value is missing. Change it so a missing value disables only the feature that needs it — with an honest message in that part of the screen — while the rest of the app still loads and works.',
  },
  {
    // The "zombie server" (DbCoupledBootAnalysis.ts): never auto-written, and its message ends with the offer
    // "say 'fix the boot guard'". This is that ask as a button.
    code: 'DB_COUPLED_BOOT',
    title: 'Keep your pages up when the database is down',
    detail: 'Your app waits for its database before it serves any page, so if the database is down every page fails.',
    prompt: 'The server only starts serving pages after a database call succeeds, so when the database is slow or down every page fails while the server looks alive. Make the pages load regardless: guard the database call, start serving pages straight away, and show an honest message in the parts of the screen whose data could not load. Confirm the pages still open with the database unavailable.',
  },
  {
    // The app SHIPPED a chat whose replies are hardcoded text. The user is told in the summary; this
    // is the one-tap way out of it, and with the in-app AI gateway it needs no key from them.
    code: 'SCRIPTED_ASSISTANT_SHIPPED',
    title: 'Make the chat give real answers',
    detail: 'The chat in your app replies with fixed text that was written into it — it does not actually think.',
    prompt: 'The chat in this app answers with fixed text written into the code — it makes no AI call at all. Make it a real assistant: send what the person types to NavBharatAI\'s own AI through the app and show the real reply, with a loading state while it waits and an honest message if the answer cannot be fetched. Do not leave any canned replies behind.',
  },
  {
    // The app SHIPPED a login / payment / OTP / email that only pretends (fakeFeatureScan.ts, admin
    // 2026-10-04: "no fake button"). The user is told in the summary and on the app's own screen; the
    // closing ask card asks for the exact key; this is the one-tap way to have it wired in once a key exists.
    code: 'FAKE_FEATURE_SHIPPED',
    title: 'Make the demo feature real',
    detail: 'A login, payment, OTP or email in your app only pretends to work — it is not connected to a real service yet.',
    prompt: 'Some features in this app are demos: a login that checks a password written into the app, a "Continue with Google" button with nothing behind it, a payment that marks itself paid, or an OTP or email the page produces itself. Make each one real with a real provider using the keys I have saved (ask me with request_secrets for any key that is still missing), keep a clearly visible red demo notice on any screen whose key is still missing, and never fake the result.',
  },
  {
    // Setting up payment checking in the user's own database did not finish (supabasePayments.ts). Until it
    // does, an order cannot be confirmed as paid — the next move is to finish it, honestly.
    code: 'SERVERLESS_PAYMENT_NOT_SET_UP',
    title: 'Finish setting up payment checking',
    detail: 'Secure checking of your app\'s payments could not be set up, so a payment cannot be confirmed as real yet.',
    prompt: 'Setting up secure payment checking for this app did not finish, so a payment cannot yet be confirmed as real. Set it up again for every table that takes payments. If it needs something from me — a reconnected database, a payment key, or a plan that allows it — tell me exactly what. Until it works, never mark an order as paid on the page\'s own say-so.',
  },
  {
    // Made-up people or places shown as real (AuthenticityAnalysis.ts, autopsy f15a9bcc). The summary already
    // says so and offers to make it real; this is that offer as a button.
    code: 'SIMULATED_DATA_SHIPPED',
    title: 'Show real data instead of made-up data',
    detail: 'Part of your app shows made-up people or places instead of real ones.',
    prompt: 'Part of this app shows made-up data about other people or places — invented users, shops or listings written into the code. Replace it with real data kept in a shared online database that the app reads and writes (set one up, or ask me to connect one if none is connected yet), show an honest empty state until real entries exist, and never present invented people as real.',
  },
  {
    // Its sibling for a feature whose OUTPUT is invented (autopsy 33812996).
    code: 'SIMULATED_RESULT_SHIPPED',
    title: 'Make the demo results real',
    detail: 'A feature in your app gives made-up answers instead of real ones.',
    prompt: 'A feature in this app returns made-up results — picked at random or written into the code — instead of doing the real work. Make it real: use NavBharatAI\'s built-in AI where that fits, or a real service (ask me for any key it needs), show a loading state and an honest message when a result cannot be fetched, and never return an invented result.',
  },
  {
    code: 'FUZZ_ROBUSTNESS',
    title: 'Stop the app crashing on odd input',
    detail: 'Typing unusual values into your app\'s own forms made it break.',
    prompt: 'The app crashes or breaks when unusual values are typed into its forms — empty, very long, strange characters, or a letter where a number is expected. Validate every input, handle the bad cases with a clear message next to the field, and make sure nothing can crash the screen.',
  },
  {
    code: 'RUNTIME_ERRORS_REMAIN',
    title: 'Fix the errors your app showed',
    detail: 'When the app ran, it reported errors that are still there.',
    prompt: 'When the app runs it reports errors in the browser console. Find the cause of each one and fix it properly, then confirm the app runs clean.',
  },
  {
    // The reviewer looked AGAIN after its critical findings were repaired, and some are still there
    // (postFixReview.ts, Q-157). Real defects in the user's app, so they get a button — and the findings
    // themselves travel with it, so the next pass works on exactly what the second look saw.
    // Since Q-381 batch four the settle lines that carry the same findings (REVIEW_CRITICAL_UNVERIFIED,
    // OUTCOME_REVIEW_CRITICAL) are offered through this one, including when no second look ran — so the
    // words say "not confirmed fixed", which is true in every one of those cases.
    code: 'REVIEW_RECHECK_CRITICALS_REMAIN',
    title: 'Fix what the review still found',
    detail: 'NavBharatAI\'s review found serious problems in your app that are not confirmed fixed yet.',
    prompt: 'A review of this app found serious problems that are not confirmed fixed — a repair was tried, or there was no time for one. Fix each one listed below at its real cause, keep everything that already works, and confirm the app still builds and runs.',
    withEvidence: true,
  },
  {
    // The strongest tier delivered the app as a best-effort backstop and its final review did not pass. The
    // review's own reason travels with the fix, and the fix checks first, because a later pass may have
    // already dealt with part of it.
    code: 'BACKSTOP_GATE_FAIL',
    title: 'Fix what the final review flagged',
    detail: 'Your app was delivered, but its final quality review did not fully pass.',
    prompt: 'This app was delivered, but its final quality review did not fully pass (the reason is below). Check each point in the running app first; fix the ones that are really there at their cause, keep everything that already works, and confirm the app builds and runs.',
    withEvidence: true,
  },
  {
    // A file this build wrote breaks a rule the app was already built on (architectureInvariants). Since
    // batch six the route re-checks before the release gate and answers every one a later pass fixed.
    code: 'ARCHITECTURE_INVARIANT_VIOLATED',
    title: 'Keep your app built the way it was',
    detail: 'A change broke one of the patterns your app is built on, which can make the parts stop fitting together.',
    prompt: 'A recent change broke a pattern this app is built on (listed below) — for example how its parts import each other, where its state lives, or which library it uses for something. Bring each listed file back in line with the rest of the app without changing what it does, and confirm the app still builds and runs.',
    withEvidence: true,
  },
  {
    code: 'JOURNEY_FAILED',
    title: 'Make saving actually work',
    detail: 'Something added in the app did not survive a reload.',
    prompt: 'When I add something in the app and reload the page, it disappears. Make the data actually persist so it is still there after a reload.',
  },
  {
    // A control that broke the app when it was pressed (clickExplorer.ts) — the user sees which one in
    // their build card, so the offer names the class, not the button.
    code: 'EXPLORE_FAILED',
    title: 'Fix the button that breaks your app',
    detail: 'Pressing one of the buttons or links caused an error or a blank screen.',
    prompt: 'When I press some of the buttons or links in the app, it shows an error, goes blank, or opens a page that does not exist. Find each one, fix the real cause, and make sure every button and link works.',
  },
  {
    // A feature a real browser had SEEN WORKING on an earlier build and that THIS change removed
    // (changeEngine/appSpec.ts, FEATURE_REGRESSED — #3477). The user's app lost something it had, so
    // the offer is to put it back as it was; where AGENTV3_FEATURE_HEAL runs, the heal has already
    // tried once (FEATURE_REGRESSION_HEALED resolves this code). Classified while staging #3492 over #3477.
    code: 'FEATURE_REGRESSED',
    title: 'Restore the feature this change removed',
    detail: 'A control that worked in your app before this change is no longer on the screen.',
    prompt: 'A feature that worked in this app before the last change is missing now — its control is no longer anywhere in the running app. Find what the last change removed or broke, and restore that feature exactly as it was (same place, same behaviour) without redesigning it or touching anything else that works.',
  },
  {
    // Features the request named that the running app shows no control for (FeaturePresence.ts), recorded
    // after the feature heal. The probe has been wrong before (autopsy 56f0c645), so the fix checks first.
    code: 'FEATURE_COVERAGE',
    title: 'Add the features that are missing',
    detail: 'Some features you asked for have no visible control in the running app.',
    prompt: 'Some features I asked for have no visible control in the running app (they are listed below). For each one, check the running app first: if it really is missing, add it with a real control that works end to end; if it exists but cannot be found, make it visible where a person would look for it. Do not remove or redesign anything that already works.',
    withEvidence: true,
  },
  {
    // The build itself ADMITTED a control does nothing ("Cloud Sync … is a UI-only toggle for now",
    // autopsy 51ef24ad / #3488). A dead control is the user's app and the fix is the obvious one, so
    // it gets a button rather than a warning they can only read. Classified here by the finding
    // ratchet on its first real encounter — the code shipped with no registry entry.
    code: 'UI_ONLY_CONTROL',
    title: 'Make the control actually work',
    detail: 'A switch or button was added to the screen that does not do anything yet.',
    prompt: 'The build left one or more controls on the screen that look real but do nothing — a switch, button or toggle with no behaviour behind it. For each one, either implement what its label promises so it genuinely works end to end, or remove it. Do not leave a control that a user can press and that does nothing.',
  },
  {
    code: 'PAGE_RENDER_FAILED',
    title: 'Fix the page that did not load',
    detail: 'At least one page failed to open properly.',
    prompt: 'One of the pages does not load properly. Find out why and fix it, then check that every page opens.',
  },
  {
    // The app rendered, and its own screen says something failed (visibleAppError.ts, Q-362, autopsy
    // 981ce4cc: a PDF app was published while it showed "Failed to load PDF file"). The error text is the
    // app's, so fixing what it reports is the app's job and the user gets the button.
    code: 'APP_SHOWS_ERROR',
    title: 'Fix the error your app shows',
    detail: 'When the app was opened in a browser, its own screen showed an error message.',
    prompt: 'When the app opens in the browser, its own screen shows an error message (for example "Failed to load …" or "Something went wrong"). Find what the message is reporting — a file or library that does not load, a request that fails, a value that is missing — and fix the cause so the feature works and the message no longer appears on a normal start. Do not hide the message without fixing what it reports.',
  },
  {
    // The app rendered as raw HTML — its own stylesheet never reached the page (renderStyle.ts, admin
    // 2026-09-28: "sundar aur real cheez bane, fake/farzi nahi"). The commonest cause is a global
    // stylesheet that is empty or never imported, which is exactly what the prompt asks to be fixed.
    code: 'UNSTYLED_RENDER',
    title: 'Give your app its proper look',
    detail: 'When the app was opened in a browser, its styles had not loaded — it showed as plain HTML.',
    prompt: 'When the app opens in the browser it shows as plain, unstyled HTML — default fonts and default buttons. Make sure the global stylesheet is imported by the entry file and actually contains the styles for every class the screens use, then give every screen a polished, consistent, professional design: real layout, spacing, styled buttons and inputs, a colour theme and a proper font.',
  },
  {
    // The sibling of UNSTYLED_RENDER, read from the CODE rather than from the painted page: classes the
    // screens use that no stylesheet defines. The deterministic kit restore puts OUR kit's own rules
    // back (kitRestore.ts); a class the app invented for itself has no rule anywhere, and the user was
    // shown that as a warning with nothing to press.
    code: 'CSS_CLASSES_UNDEFINED',
    title: 'Write the missing styles',
    detail: 'Some screens use style names that nothing defines, so those parts show up unstyled.',
    prompt: 'Some class names used by the screens have no styles defined anywhere, so those parts render unstyled. Add the missing rules to the app\'s own stylesheet so every class a screen uses is really styled, and keep the look consistent with the rest of the app.',
  },
  {
    // A stylesheet imported by nothing (ProjectIntegrity). INTEGRITY_HEALED answers it when the heal runs.
    code: 'INTEGRITY_ORPHAN_STYLESHEET',
    title: 'Connect the styles your app is not using',
    detail: 'A stylesheet in your app is not connected to anything, so the look it holds never reaches the screen.',
    prompt: 'A stylesheet in this app is not imported or linked anywhere, so its styles never reach the screen. Connect it from the entry file (or merge its rules into the stylesheet that is used), make sure nothing it styles is left unstyled, and confirm the look in the browser.',
  },
  {
    // The game was PLAYED in a real browser and scored (gamePlaytest.ts, admin 2026-10-05). The measured
    // scorecard and its weakest dimension travel with the fix, so the repair knows exactly what to change.
    code: 'GAME_PLAYTEST_ISSUES',
    title: 'Make the game playable',
    detail: 'NavBharatAI played your game and found a weak spot — the controls, the phone, an error or the replay.',
    prompt: 'NavBharatAI played this game in a real browser (arrow keys/WASD, Space, a mouse drag, and a thumb on a phone-sized touch screen) and it is not fully playable yet. Fix the weakest area named below at its root, keep everything that already works, and make sure the player can move and act with the keyboard AND with on-screen touch controls.',
    withEvidence: true,
  },
  {
    // Measured at phone size (mobileLayoutCheck.ts, admin 2026-09-30: "mobile first"). Most users hold a
    // phone, so this is offered before the desktop-only design polish below.
    code: 'MOBILE_LAYOUT_ISSUES',
    title: 'Make it fit a phone',
    detail: 'On a phone-sized screen the page scrolls sideways or some buttons are too small to tap.',
    prompt: 'On a phone the app does not fit: the page scrolls sideways and/or some buttons and links are too small to tap with a thumb. Make every screen mobile-first — one column on a phone, nothing wider than the screen (no fixed widths, tables that scroll inside their own box, images max-width 100%), and every tappable control at least 44 by 44 pixels with space between them — while keeping the tablet and desktop layouts working.',
  },
  {
    code: 'DESIGN_PAGE_INCONSISTENT',
    title: 'Make the inside pages look as good as the first',
    detail: 'Some pages are plainer than the main screen.',
    prompt: 'Some inner pages look plain compared to the main screen. Give every page the same visual quality: proper headings, spacing, styled tables and lists, and a friendly empty state.',
  },
  {
    // The design linter's own grade (DesignLinter.ts) — too many one-off colours, too many fonts,
    // hardcoded colours instead of tokens. The off-grid half of it is now snapped deterministically
    // (spacingSnap.ts, autopsy 536c8189), so what survives to the user is genuinely a design decision.
    code: 'DESIGN_CONSISTENCY',
    title: 'Tidy up the colours and fonts',
    detail: 'The app uses many one-off colours or fonts instead of one small, consistent set.',
    prompt: 'The app\'s colours and fonts are scattered — many one-off values instead of one small set. Pick a palette of about five colours and at most two fonts, define them once as design tokens, and use those everywhere so every screen matches. Do not change the layout or how anything works.',
  },
  {
    // A frontend with no way to build it (uiWithoutBuildVerdict). Its own recording site says mid-way to
    // a frontend is a legitimate state, so the finding is advisory — but "finish wiring it up" is a real
    // next move, and it had none.
    code: 'UI_WITHOUT_BUILD',
    title: 'Finish wiring up the app',
    detail: 'There are screens in the project but no way to build and run them yet.',
    prompt: 'The project has screens but no working build setup, so they cannot be run or published. Add the build configuration and entry file the project needs, install what is missing, and confirm the app builds and opens.',
  },
  {
    // Source written for one framework, packages set up for another (checkFrameworkCoherence). Recorded at
    // plan time; since Q-381 batch four the route re-checks the project the build leaves and answers it when
    // the two agree, so this button is only ever about a mismatch that is still there.
    code: 'FRAMEWORK_SOURCE_MISMATCH',
    title: 'Settle your project on one framework',
    detail: 'Your project\'s files are written for one framework but set up to build with another, so it cannot build cleanly.',
    prompt: 'This project\'s source files are written for one framework while its package setup builds a different one, so it cannot build cleanly. Keep the framework the source files actually use, make the packages, build scripts and configuration match it (or convert the few files that do not), and confirm the app builds and opens.',
    withEvidence: true,
  },
  {
    code: 'DEPENDENCY_VULNERABILITIES',
    title: 'Update the unsafe libraries',
    detail: 'The app uses libraries with known security problems.',
    prompt: 'The app depends on libraries with known security vulnerabilities. Update them to safe versions without changing how the app behaves, and make sure it still builds and runs.',
  },
  {
    // A broken label is the one defect the user can SEE and cannot explain, so it is offered first-class
    // rather than left in the admin report (autopsy 3ce8459b — `label: 'জungle'` shipped to a Bengali
    // user past a 100/100 accessibility score and a PASS review).
    code: 'SCRIPT_INTEGRITY',
    title: 'Fix the broken words in your app',
    detail: 'Some text mixes two alphabets inside one word, so it reads as nonsense.',
    prompt: 'Some labels in the app contain a single word written half in one script and half in another '
      + '(for example a Bengali or Hindi word ending in English letters). Find every such label and rewrite '
      + 'it correctly, entirely in the language the rest of the interface uses. Change only the text.',
  },
  {
    code: 'ACCESSIBILITY',
    title: 'Make it usable for everyone',
    detail: 'Some buttons and inputs cannot be used with a screen reader.',
    prompt: 'Make the app accessible: give every icon-only button an accessible name, label every form input, and make sure everything can be reached and used with the keyboard.',
  },
  {
    code: 'INTEGRITY_FOCUS_CONFLICT',
    title: 'Let one field take focus when a page opens',
    detail: 'Several parts of a page try to grab the cursor when it opens, so it lands in an unexpected place.',
    prompt: 'More than one part of a page tries to take keyboard focus when it opens, so the cursor jumps to an unexpected place. Choose the one field that should have focus first, remove the automatic focus from the rest, and keep everything else as it is.',
  },
  {
    code: 'TEST_SUITE',
    title: 'Fix the failing tests',
    detail: "The app's own tests did not pass.",
    prompt: "The app's own test suite is failing. Find out why each test fails and fix the real cause in the app, then make the suite pass.",
  },
  {
    code: 'INTEGRITY_CIRCULAR_DEP',
    title: 'Untangle the circular imports',
    detail: 'Two files import each other, which can break the app at runtime.',
    prompt: 'There are circular imports between files. Restructure them so nothing imports in a circle, and confirm the app still builds and runs.',
  },
  {
    code: 'INTEGRITY_DUPLICATE_ENTRY',
    title: 'Remove the second start of your app',
    detail: 'Your app has more than one starting point, so the wrong version can be the one that opens.',
    prompt: 'This app starts itself from more than one file, so the preview can open one version while changes land in another. Keep the single starting file the app is actually served from, remove the extra ones (moving over anything they have that the real one lacks), and confirm the right app opens.',
  },
  {
    code: 'INTEGRITY_DUPLICATE_MODULE',
    title: 'Merge the duplicate copies',
    detail: 'The same part of your app exists in more than one place, and the copies are drifting apart.',
    prompt: 'The same component exists in more than one place in this app, and the copies have started to differ. Keep the copy the app actually uses, make every other copy point to it instead of holding its own version, and confirm the app still builds and works the same.',
  },
  {
    code: 'SPA_FALLBACK_MISSING',
    title: 'Stop the blank page on refresh',
    detail: 'Refreshing an inner page can show nothing.',
    prompt: 'Refreshing an inner page shows a blank page or a 404. Fix the routing fallback so any page can be opened or refreshed directly.',
  },
  // ── AN IMPORTED PROJECT THAT WOULD NOT START (added 2026-10-04's census) ───────────────────────
  // These three fire only on an IMPORT turn, about the user's OWN existing repository. They sat below
  // the general app offers because an import problem is specific to that one turn, but they are real
  // next moves and had none.
  {
    code: 'IMPORT_PREVIEW_BOOT_FAILED',
    title: 'Get your imported project running',
    detail: 'Your project was brought in, but it would not start here.',
    prompt: 'The project I imported does not start here. Work out what it needs — the right start command, the port it serves on, missing dependencies or configuration — fix it in the project, and confirm it boots and the preview opens.',
  },
  {
    code: 'IMPORT_PREVIEW_BOOT_CUT_OFF',
    title: 'Make your imported project start faster',
    detail: 'Your project was still starting when the time ran out, so it was never seen running.',
    prompt: 'The project I imported was still starting when the check ran out of time, so it was never confirmed running. Find what makes the start so slow — a long install, a blocking step at boot, a wait on something that is not there — fix it, and confirm the app comes up.',
  },
  {
    code: 'IMPORT_DB_MIGRATIONS_FAILED',
    title: 'Fix the database setup for your imported project',
    detail: 'Your project\'s database setup steps did not run, so parts of it may not work.',
    prompt: 'The database setup steps in the project I imported did not run. Find out why each one failed, fix the real cause, and confirm the database is set up and the app can read and write it.',
  },
  {
    // A database command reported success while its output proved the database was never reached
    // (BuildDiagnostics' silent-DB-failure check). The setup did not run, so this is the next move.
    code: 'DB_UNREACHABLE',
    title: 'Connect your app\'s database',
    detail: 'Your app\'s database could not be reached, so its setup never ran.',
    prompt: 'A database setup step reported success, but the database was never reached, so nothing was created. Check the database address and credentials the app uses, make sure the database is running and reachable from the app, run the setup again, and confirm the app can read and write its data.',
  },
  {
    // The boot log proved a table missing (Q-381 batch four). Answered when the migration retried after the
    // boot runs clean — HEAL_RESOLVES.IMPORT_DB_MIGRATIONS_APPLIED — which is what its own message says
    // the pages are waiting for. What is left open is a missing table nothing created.
    code: 'DB_SCHEMA_MISSING',
    title: 'Create the tables your app reads',
    detail: 'Your app\'s database is missing tables its pages read, so those pages will fail.',
    prompt: 'The app\'s database is missing tables that its pages read, so those pages fail even where the preview renders. Add (or fix) the project\'s migration so it creates every table the app uses, run it against the app\'s database, and confirm the pages can read and write their data.',
  },
  {
    // The user pasted their own one-file HTML app and it was kept as one file (pastedAppFormat.ts, admin
    // 2026-10-01). Not a defect — the one-tap way to a full project, for when they do want one. Last in
    // the table: anything actually wrong with the app comes first.
    code: 'PASTED_APP_KEPT_ONE_FILE',
    title: 'Upgrade to a full app project',
    detail: 'Your app was kept as one HTML file, the way you pasted it. A full project is easier to grow.',
    prompt: 'Turn my one-file HTML app into a full app project (React with Vite) that I can keep growing. Keep every screen, tab, button, field and colour it has now, keep everything it does working, and keep reading the same saved data (the same storage names), so nothing I have saved is lost.',
  },
];

/**
 * 🔒 APP FINDINGS WE DELIBERATELY DO NOT OFFER A BUTTON FOR — the third leg of the census below.
 *
 * Every problem-severity finding that reaches the user is either OUR OWN PROCESS (then it belongs in
 * `PROCESS_ONLY_CODES` and is never a mark against their app), or it has a one-tap offer in the table
 * above, or it is here with the reason. There is no fourth state, and
 * `tests/aProblemTheUserIsShownCanBeActedOn.test.ts` fails CI when a NEW code appears outside all three
 * — which is what stops this list going stale the way it did before 2026-10-04.
 *
 * ⚠️ These five are all ERROR severity, so moving any of them would change `shippingIssueCount('error')`
 * — the one count that can flip a build to free. That is a billing decision and not a session's to take;
 * they stay app findings. Whether the engine's own crash should count as the app's blocker was decided by
 * the admin on 2026-10-11 (Q-380, closed): leave it — a crashed build stays free and NavBharatAI absorbs it.
 */
export const APP_FINDINGS_WITHOUT_AN_OFFER = new Set([
  // The readiness gate's own blocker text IS the instruction, and it is different every time ("the entry
  // is still the starter", "1 unresolved import — the build will fail: …"). A single generic button would
  // be vaguer than the sentence the user already has.
  'READINESS_BLOCKER',
  // An error the build stream itself raised. Its message is whatever threw — sometimes the app's compiler,
  // sometimes our own engine — so no one prompt is honest for all of them.
  'BUILD_ERROR',
  'BUILD_EXCEPTION',
  // Roll-ups of other findings, the same reason `RELEASE_GATE` is excluded: the real finding is recorded
  // separately and already carries its own offer, so a second button would duplicate it.
  'OUTCOME_EMPTY_BUILD',
  'OUTCOME_TYPECHECK_FAILED',
  // The release gate's own "was RED, so the verdict was corrected" line — a roll-up of the blockers it
  // counted, each recorded on its own line with its own offer (Q-381 batch six).
  'OUTCOME_RELEASE_GATE_RED',
  // Counted against the build so it stays FREE, with nothing the user could press — Q-380's rule ("a crashed
  // build stays free and NavBharatAI absorbs it") applied to its two siblings (Q-381 batch six):
  //  • STUCK_TOOL — our own tool call hung until the build ended. When the build ran out of time, the
  //    BUILD_TIMEOUT offer ("Finish building your app") is the move; a button for our hang would be none.
  //  • PLATFORM_SOURCE_WORKSPACE — a refusal: the workspace holds NavBharatAI's own source, so there is no
  //    app to build and nothing to fix.
  'STUCK_TOOL',
  'PLATFORM_SOURCE_WORKSPACE',
]);

/**
 * 🔁 A ROLL-UP IS OFFERED THROUGH THE FINDING IT RESTATES (Q-381 batch three).
 *
 * Each key is recorded when a repair could not clear the finding on its right: "after one pass the files STILL
 * do not parse", "the heal did not clear every guard". It is the same defect, said again later — so it gets the
 * same button, never a second one, and never none. Two cases make a declared "no offer" wrong here: the final
 * syntax re-check records `OUTCOME_SYNTAX_ERROR` on its own when a LATE repair broke a file that the first check
 * passed, so the roll-up can be the only open finding; and when both are open, the roll-up's message is the
 * later, truer one, so it is the evidence the fix is handed.
 *
 * `tests/aProblemTheUserIsShownCanBeActedOn.test.ts` counts a key as offered only when its target really has an
 * offer above.
 */
export const OFFERED_THROUGH: Readonly<Record<string, string>> = {
  OUTCOME_SYNTAX_ERROR: 'SYNTAX_ERROR_DETECTED',
  OUTCOME_MISSING_FILES: 'MISSING_FILES_DETECTED',
  OUTCOME_MISSING_EXPORT: 'MISSING_EXPORT_DETECTED',
  BOOT_KILLING_ENV_GUARD_UNRESOLVED: 'BOOT_KILLING_ENV_GUARD',
  // Batch six. The preview-compile heal's failure line restates the divergence it could not clear.
  OUTCOME_PREVIEW_COMPILE: 'PREVIEW_COMPILE_DIVERGENCE',
  // A reviewer auto-fix that did not complete leaves the same findings the settle lines below carry. Listed
  // BEFORE them on purpose: the later lines list the findings, so their message is the evidence that wins.
  REVIEWER_AUTOFIX_INCOMPLETE: 'REVIEW_RECHECK_CRITICALS_REMAIN',
  // Q-381 batch four. The platform tried to start the app itself and nothing served: the app never came up,
  // and nothing later in the build can give it a preview (no preview is set after that proof).
  PLATFORM_PREVIEW_NOT_UP: 'PREVIEW_NEVER_CAME_UP',
  // The settle lines for review findings not confirmed fixed — on a rendered app, and on one that is not. They
  // carry the same findings the second look left (`reviewCriticalsUnresolved`), so they share its button.
  REVIEW_CRITICAL_UNVERIFIED: 'REVIEW_RECHECK_CRITICALS_REMAIN',
  OUTCOME_REVIEW_CRITICAL: 'REVIEW_RECHECK_CRITICALS_REMAIN',
};

/** Codes that must never become a suggestion — see the header for why each is excluded. */
const NEVER_SUGGEST = new Set([
  'BUILD_OFFER_ACCEPTED', 'ATTACHMENT_RECALLED',
  'GOLDEN_SCAFFOLD_SKIPPED', 'LLM_CALL_STOPPED', 'SIMPLE_BUILD_STOPPED', 'DOMAIN_KNOWLEDGE', 'DURABLE_HOLDS_ONLY_STARTER', // autopsy 31254f9a — engine facts
  'GAME_KIT_SEEDED', 'GAME_KIT_NOT_SEEDED', // whether OUR game-kit seed ran (gameKitSeed.ts, build 46e2d74b) — engine facts
  'PROJECT_MODULE_AWAITS_SHELL', 'PROJECT_MODULE_FILES_UNDELIVERED', 'PROJECT_PLAN_RETIRED', 'REVIEW_DEFERRED_TO_SHELL', 'BUILD_ASSETS_SAVED', 'MOBILE_LAYOUT_NOT_RUN', 'MOBILE_LAYOUT_OK',
  'CHECKPOINT_SIGNAL', // our checkpoint heuristic, never a finding (autopsy SignBridge, 2026-09-26)
  'REVIEW_SUGGESTIONS_NOT_READY', // a suggest-only review that ran out of time — nothing for the user to do
  'TIME_TO_FIRST_RENDER', 'POST_GREEN_WRITES', 'LADDER_DEPTH', 'STRICT_TRIAL', 'SAVED_SOURCE_DIVERGES', 'ATTACHMENTS_READ',
  'FREE_BUILD_TIME_CAP', 'FREE_BUILD_CHAIN_PAUSED', // our free-tier time policy (freeBuildTimeCap.ts)
  'STYLE_RULES_RESUMED', // our end-of-turn steer (stylePolishResume.ts), never a finding
  'STYLE_PASS_CAPPED', // our own time cap on that pass (stylePassCap.ts), never a finding
  'SPACING_SNAPPED', // our own deterministic 4px-grid snap (spacingSnap.ts, autopsy 536c8189) — already done
  'REPAIR_CLAIM_WITHHELD', // our repair pass claimed a change it never made (repairClaim.ts)
  'HANDBACK_IGNORED', // our end-of-turn hand-back answered with no change (repairClaim.ts, db07e0af)
  'REVIEW_NOT_RUN_REASONING_ENGINE', // our suggest-only review stopped before a reasoning engine (db07e0af)
  'REVIEW_FINDINGS_UNREAD', // our parser could not read the review's findings (autopsy d798ddd3)
  'UNSUPPORTED_STACK', // the user is told in the ready message already (unsupportedStack.ts)
  'UNKNOWN_NAME_IN_REQUEST', // a note to our builder (unknownName.ts), never a finding
  'REQUEST_SCOPE_NOTE', // a note to our builder (requestScope.ts), never a finding
  'SCRIPT_REQUEST_AS_WEB_APP', // a note to our builder and the user (scriptRequest.ts)
  'PYTHON_BACKEND_UP', // our own boot of the app's Python server (pythonBackendBoot.ts)
  'AUTH_EXPLORE_SIGNED_IN', 'AUTH_EXPLORE_NOT_RUN', // our sign-in instrument, never the app's defect
  'DESIGN_KIT_RESTORED', 'PLANNING_CONTEXT', 'DESIGN_KIT_KEPT', 'SHADOW_TWIN_REMOVED', 'DEAD_SALVAGE_REMOVED', 'DEAD_SALVAGE_KEPT', 'USER_FILE_KEPT', 'FILES_REMOVED_TOLD', 'DURABLE_READ_FAILED', 'LLM_CALL_HANDED_OFF', 'REPEATED_READS', 'WORKSPACE_SCAN_FAILED', 'EMPTY_BUILD_RETRY', // our own housekeeping (autopsy e725e002, 4d538ca3, d382b398, de3bb2bb)
  'RELEASE_GATE', 'TIME_TO_FIRST_CALL', 'RUNTIME_UNCHECKED', 'RUNTIME_VERIFIED', 'APP_RENDERED',
  'TEST_SUITE_UNVERIFIED', 'JOURNEY_NOT_DERIVED', 'JOURNEY_NOT_RUN', 'PAGE_RENDER_NOT_RUN',
  // The click explorer's "did not look" outcomes and its pass — nothing for the user to do.
  'EXPLORE_NOT_RUN', 'EXPLORE_NOTHING_TO_PRESS', 'EXPLORE_PASSED',
  // Our reviewer produced no verdict — nothing the user can act on, and never a mark against their app.
  'CHEAP_REVIEW_NOT_RUN',
  // The clean half of the styling measurement (renderStyle.ts) — the app IS styled; nothing to offer.
  'RENDER_STYLE',
  'BUILD_ORDER_READ_AS_EDIT', 'PORT_DIGEST', 'CLAIM_UNSUPPORTED', 'PREVIEW_UNVERIFIED',
  // A dropped backslash our own pass already put back — nothing left for the user to do.
  'SCRIPT_INTEGRITY_REPAIRED',
  // We left a turn as the answer the model gave — our own retry policy working, never a next move
  // for the user (autopsy e628efd4).
  'TURN_ANSWERED_A_QUESTION',
  // …and a refusal left standing as the answer (2026-09-26) — nothing for the user to fix.
  'TURN_DECLINED',
  // A device power a web app cannot have (autopsy 6bae5835) — "add a lock screen" is not a next move
  // anyone can make here, so it must never be offered as one.
  'DEVICE_CAPABILITIES_TOLD',
  'NATIVE_CAPABILITY_BRIEF',
  // Our own deterministic label repair — housekeeping, never a finding against the app.
  'LABELS_REPAIRED',
  // A measurement of our own write-time notes — never a finding against the app.
  'WRITE_TIME_QUALITY',
  // Our own lane's phase timings — a measurement, never a next move for the user.
  'FAST_LANE_PHASES',
  'FAST_LANE_SKIPPED_GAME',
  'FAST_LANE_SKIPPED_IMAGE_APP',
  // What our own failed provider calls cost — our routing's problem, never the user's next move.
  'PROVIDER_TIME_WASTED',
  // The user's own answer to the paid bug-hunt offer, and what our pass cost when they said yes. A
  // choice is not a defect and a cost is not a next move (Q-1042; #3728 left both off every registry).
  'BUG_HUNT_NOT_RUN',
  'BUG_HUNT_COST',
  'PREVIEW_SERVER_RESTARTED',
  // "₹X of engine work produced nothing and was not billed" is our own accounting, not something
  // the user could ever act on.
  'UNBILLED_BARREN_WORK',
  // Whether our own safety net saved a version is not a next move we can offer the user.
  'RESTORE_POINT',
  // A repair answer our guard refused to write (autopsy eed79815) — nothing for the user to do.
  'REPAIR_OUT_OF_SCOPE',
  'SUMMARY_ADDITIONS_SHOWN', 'SUMMARY_REPLY_NOT_FOUND', // how our closing line reached the screen
  'REVIEW_OFFER_FILE_GONE', // a finding about a file that no longer exists — nothing left to offer
  'SINGLE_FILE_KIT_INLINED', // our own finishing step on a one-file app — never a finding against it
]);

/**
 * Suggestions derived from the last build's own findings.
 *
 * Only UNRESOLVED, non-observation findings count: a problem the build already fixed, or one that was
 * never ours, is not something to offer the user as their next move.
 */
export function buildFindingSuggestions(
  findings: ReadonlyArray<FindingLike> | null | undefined,
  max: number = MAX_FINDING_SUGGESTIONS,
): NextSuggestion[] {
  const list = Array.isArray(findings) ? findings : [];
  if (list.length === 0) return [];

  const open = new Set<string>();
  const evidence = new Map<string, string>();
  for (const f of list) {
    const code = String(f?.code || '').trim();
    if (!code || NEVER_SUGGEST.has(code)) continue;
    if (f?.autoResolved === true) continue;   // the build already dealt with it
    if (f?.observation === true) continue;    // pre-existing user code, not something our build caused
    open.add(code);
    if (typeof f?.message === 'string' && f.message.trim() && !evidence.has(code)) evidence.set(code, f.message.trim().slice(0, 600));
  }
  if (open.size === 0) return [];
  for (const [rollUp, source] of Object.entries(OFFERED_THROUGH)) {
    if (!open.has(rollUp)) continue;
    open.add(source);
    const said = evidence.get(rollUp);
    if (said) evidence.set(source, said);
  }

  const out: NextSuggestion[] = [];
  // Table order, not report order: the table is ranked by how much the user would feel the difference.
  for (const entry of FINDING_SUGGESTIONS) {
    if (!open.has(entry.code)) continue;
    out.push({
      id: `found-${entry.code.toLowerCase().replace(/_/g, '-')}`,
      title: entry.title,
      detail: entry.detail,
      prompt: entry.withEvidence && evidence.has(entry.code) ? `${entry.prompt}\n\nWhat was measured: ${evidence.get(entry.code)}` : entry.prompt,
      kind: 'domain',   // specific to THIS app's measured state, never universal polish
    });
    if (out.length >= Math.max(1, max)) break;
  }
  return out;
}
