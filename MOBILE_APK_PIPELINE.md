# The Capacitor APK Pipeline — every step, every check, every green tick

**Why this file exists (admin, 2026-08-27, verbatim):** *"github kisi app ka capacitor apk banata hai,
to woh jo jo step, jo jo green tick, jaha jahan check karta hai, sab ki list banao — ek highly detailed
list. uske bad har step ko pass karne ka skill navbharatai ko sikhao."* The admin reports that a large
share of user builds still fail somewhere in this pipeline. This document is the complete map of the
pipeline as it actually is in the code — every stage, every sub-check, what can fail at each one, and
exactly how NavBharatAI prevents or heals it. The companion coverage table at the end names, honestly,
what is still NOT covered.

**Ground truth, not prose:** everything here is read from the generating code —
`src/server/lib/mobileShipKit.ts` (the workflows GitHub actually runs), `src/server/routes/mobileSetup.ts`
and `src/server/routes/mobileShip.ts` (the server pipeline around them), `src/server/lib/mobileShipPreflight.ts`
(prevention) and `src/server/lib/mobileBuildRepair.ts` (repair). `tests/mobileApkPipelineDoc.test.ts` pins
this file against that code: every failure code the classifier can name and every step of the generated
workflow must appear here, so the document cannot silently rot.

The pipeline has **three phases**. GitHub's green ticks are only Phase B; half of what decides whether a
build survives happens before GitHub ever sees the app, and the recovery happens after.

---

## Phase A — inside NavBharatAI, BEFORE GitHub sees anything (`POST /api/mobile-ship/setup`)

The worst place to discover a problem is a GitHub runner: five minutes per attempt, a remote log, and a
repair loop that can only edit files by committing them. So the engine front-loads every check it can run
in-process.

| # | Check / action | What fails here without it | How it passes |
|---|---|---|---|
| A1 | **GitHub connection** — a token must be present | Nothing downstream can push or dispatch | 401 with a plain "connect GitHub" message |
| A2 | **Token identity** — `GET /user`, the owner comes from the token, never from the client | A token pointed at someone else's account | 401 on a dead token |
| A3 | **Load the app's text files** from the durable workspace store | An empty push | — |
| A4 | **COMPILE PREFLIGHT** (`mobileShipPreflight.ts`) — the same checks the runner's build would die on, run in seconds instead of minutes | `APP_CODE_BUILD_FAILED` five minutes later on the runner | Three checks, then healing |
| A4.1 | · **Syntax** — esbuild parse of every JS/TS file (the exact parser `vite build` runs first) | "Transform failed" on the runner | Problem list |
| A4.2 | · **Unresolved local imports** — `import x from './Missing'` via the shared resolver (extensions, index files, aliases); binary assets deliberately NOT claimed missing (the text store cannot see them) | Vite "Could not resolve …" — the single most common build death for generated apps | Problem list |
| A4.3 | · **Missing npm packages** — imported but not declared in package.json | npm/Vite "Cannot find package …" | Problem list |
| A4.4 | · **Tailwind setup** — the app USES Tailwind (`@tailwind` directives, a v4 `@import "tailwindcss"`, or a tailwind.config) but package.json does not carry a working v3 setup | The web build dies in PostCSS, or ships with zero styling | Problem list (added 2026-08-27) |
| A4.H | **Healing tiers**, each re-verified — Tier 0a: scaffold the shadcn/ui primitives the app imports but never wrote; Tier 0: add allowlisted missing packages at curated pinned ranges; Tier 0b: complete the Tailwind v3 setup deterministically (declare tailwindcss/postcss/autoprefixer, write missing configs, rewrite v4 import syntax to v3 directives); Tier 1: bounded AI repair (≤2 rounds), success judged ONLY by re-verification, never by the model's own claim. Heals merge back into the user's v5 workspace so the app inside NavBharatAI is fixed too | — | ok, or an honest 422 naming the exact file/line |
| A5 | **Screens gate** (`apkRefusalForProject`) — nine of the 24 supported frameworks build a JSON server with no screens; packaged, they produce an APK that installs and shows a blank page | A "successful" but useless APK on someone's phone (fake success, rule 2) | 422 `no-ui`, refused before any repo is created |
| A6 | **Capacitor major → JDK pin (G2)** — read from the app's own package.json; Capacitor 6 needs Java 17, 7/8 need 21 | Gradle/AGP "requires Java …" on the runner | The generated workflow pins the right JDK |
| A7 | **Generate the ship kit** — workflows come from ONE shared registry (`shipWorkflows.ts`), so a generated workflow is always dispatchable and vice versa | A workflow pushed that the server then refuses to start | — |
| A8 | **Load binary assets with a completeness flag** — images/fonts live in a separate durable store; the 2026-08-16 class was a pushed repo with `import logo from './logo.png'` and no logo.png | Vite "Could not resolve ./logo.png" | Assets travel with the push; a FAILED read is marked incomplete and never reported as "your app has no assets" |
| A9 | **Assemble the project** (`mobileProjectAssembler.ts`) — two real shapes: a BUILT app keeps its own build → `dist`; a STATIC app's files go to `www/` with an honest no-op build script. Also: capacitor.config with the detected webDir, sanitized appId, icon + background colour, node_modules/dist/.git filtered out | The old kit pushed workflows with no app and died at `npm run build` every time | — |
| A10 | **Missing-asset gate** (`findMissingImportedAssets`) — the 2026-08-25 class: a phone screenshot over the store's size cap was silently dropped, so the repo imported a picture it did not contain | "Could not load …png (imported by …)" on the runner | 422 naming the exact picture and the screen that uses it |
| A11 | **Create or reuse the GitHub repo** | Permission failures surfaced as a specific "reconnect with repo+workflow scopes" message | 403 path |
| A12 | **One commit with everything** — text + binary files | Partial pushes | — |
| A13 | **Dispatch** (`POST /api/mobile-ship/trigger`) — workflow name checked against the allow-list; the build is recorded durably (`AppBuildStore`) so a back-gesture cannot lose a finished app | — | GitHub takes over |

## Phase B — on the GitHub runner (the generated "Build Android APK (installable)" workflow)

This is the part the admin sees as green ticks. The job carries a **30-minute timeout** (a hung Gradle
daemon must not idle to GitHub's 6-hour default burning the user's minutes).

### Step B1 — `actions/checkout`
Clones the repo NavBharatAI pushed. Fails only on GitHub-side outage. Not our failure class.

### Step B2 — `actions/setup-node` (Node 22)
**Deliberately configured WITHOUT the npm cache.** NavBharatAI pushes source but never a
package-lock.json, and `cache: 'npm'` HARD-FAILS when no lock file exists — killing the run ~18 s in,
before one line of the app is built. Classifier code for old repos still carrying it: `NPM_LOCK_CACHE`.

### Step B3 — `actions/setup-java` (Temurin, version pinned per Capacitor major — G2)
Wrong JDK for the app's Capacitor major → Gradle dies later. Classifier: `JAVA_VERSION_TOO_OLD`; the
repair raises the pin to what the governed toolchain says THIS app needs.

### Step B4 — "Install the app's libraries"
`package-lock.json` present → `npm ci || npm install`; absent → `npm install || npm install
--legacy-peer-deps`. Everything that can die here, and its coverage:
- **Package does not exist** (registry 404) → `NPM_PACKAGE_NOT_FOUND`
- **Version does not exist** (npm ETARGET, "No matching version found for pkg@range" — the classic
  invented-version failure of generated package.json files) → `NPM_VERSION_NOT_FOUND` (added 2026-08-27):
  an allowlisted package is re-pinned to its curated known-good range; any other package falls back to
  its `latest` dist-tag, which by construction always resolves for a package that exists
- **Peer-dependency conflict** (ERESOLVE) → the workflow's own `--legacy-peer-deps` fallback; classifier `NPM_PEER_CONFLICT` for old repos
- **npm ci without a lock file** → prevented by the install branch; classifier `NPM_CI_NO_LOCK` for old repos
- **Private-registry auth demanded** → `NPM_REGISTRY_AUTH` (honest, not auto-fixable — the credentials are the user's)

### Step B5 — "Build the web app"
`NODE_OPTIONS: --max-old-space-size=4096` up front (a large app must not die on Node's default heap —
`NODE_OUT_OF_MEMORY`). Runs `npm run build`; if it fails and the log shows ONLY `error TS…` type findings
and Vite is present, it packages straight from the bundler — the preview never enforced the type gate, so
the packaging bar must not be silently stricter than the bar the app was verified against
(`TYPE_GATE_BLOCKED_PACKAGING`, the 2026-08-18 piano autopsy). A real compile error still fails —
`APP_CODE_BUILD_FAILED` — and Phase A4 exists precisely so that class is caught before GitHub.
`BUILD_SCRIPT_MISSING` covers a package.json with no build script at all.

### Step B6 — "Generate and sync the Android project" (the single biggest step: 14 sub-checks)
1. **G17** — read the ACTUAL configured `webDir` out of capacitor.config.{ts,js,json}
2. **G17b** — no index.html in that webDir? Scan what the build REALLY produced (`dist`, `build`, `out`,
   `www`, `dist/spa`, `.output/public` — deliberately never `public`, which in CRA is the un-built source
   template) and repoint the config at it (the 2026-08-22 mitrify class: both files are OURS, so a
   mismatch is our bug, not the user's)
3. **Honest fail** if still no index.html — stage reported as `capacitor`, never "your app did not
   compile" while GitHub's own summary says it compiled (two surfaces must not contradict)
4. `npx cap add android` if missing — NEVER `|| true`: swallowing a failed `cap add` made Gradle die three
   steps later at `chmod ./gradlew` pointing at the wrong thing entirely (2026-08-03 class, `ANDROID_PLATFORM_MISSING`)
5. `npx cap sync android`
6. **Gradle wrapper jar heal** — `./gradlew` merely EXECUTES `gradle-wrapper.jar`; a present-but-incomplete
   android/ sails past a script-only check and dies at Gradle ("Unable to access jarfile", 2026-08-04
   autopsy). Missing jar → fetch the EXACT pinned-version jar; still missing → re-scaffold android/ fresh;
   final guard verifies BOTH script and jar
7. **Icon set generation** — the user's uploaded icon becomes the real multi-density adaptive icon set
   (`@capacitor/assets`); degraded gracefully when the icon is too small
8. **Splash drawable heal** — Capacitor's launch theme references `@drawable/splash`, which a fresh cap
   add can omit → resource linking dies; a placeholder is written
9. **Launcher-foreground heal** — `mipmap-anydpi-v26` XML references `ic_launcher_foreground`, which a
   partial icon set can omit; healed from the user's own icon, else a visible placeholder
10. **G1** — a bare `&` in the app name ("Tom & Jerry") lands raw in strings.xml and breaks the XML;
    escaped idempotently
11. **G4** — adaptive icon background + round icon references healed (missing `ic_launcher_background`
    defined as a colour; missing `ic_launcher_round` repointed to the standard icon)
12. **G5** — a plugin declaring a higher `minSdkVersion` than the project's fails manifest-merge; the
    floor is raised to 23 (only ever RAISED, never lowered)
13. **Gradle JVM heap forced to 4 g** (dexing/R8 on a large app dies on Capacitor's lower default)
14. **Final guard** — gradlew script + wrapper jar both present, or an honest `capacitor`-stage failure

Post-hoc classifier for resource-linking failures on repos predating these heals: `ANDROID_RESOURCE_LINKING` → refresh to the current workflow.

### Step B7 — "Build the installable APK"
`chmod +x ./gradlew` (`GRADLEW_NOT_EXECUTABLE` for old repos), then `./gradlew assembleDebug --no-daemon`
with **up to 3 attempts, retried ONLY when the log matches a transient-network pattern** (G10) — a
deterministic compile failure exits immediately, never burning the user's Actions minutes on a bug.
`SDK_LICENSE_NOT_ACCEPTED` covers the runner image demanding license acceptance. The debug APK signs with
Android's universal debug key — zero secrets, which is what makes the whole flow one click. (The signed
`.aab` workflow adds: a fail-early check for the four signing secrets — `MISSING_SIGNING_SECRET`, the one
genuinely user-only failure — keystore restore + Gradle signing wiring — `SIGNING_CREDENTIALS_WRONG` —
and a unique `versionCode` stamped from the run number, because Play rejects a re-used one.)

### Step B8 — "Upload the .apk"
The artifact (`app-apk`, 14-day retention). GitHub holds it in the user's own repo.

### Step B9 — "Explain what stopped the build" (runs ONLY on failure)
Reads the runner's actual filesystem — did node_modules appear, did a build output appear, did android/
appear — and reports the failed STAGE as ground truth (`NBAI_FAILED_STAGE=install|webbuild|capacitor|android`)
plus a plain-language explanation. This line is what the server-side classifier reads first, instead of
pattern-matching a megabyte of log.

### Step B10 — "Summary"
Written with a **quoted heredoc, never echo** — prose containing parentheses once became unquoted shell
metacharacters, and because Summary runs LAST, every successful build was then reported as a failure
(2026-08-03 class; a regression test bash-parses every generated run block).

## Phase C — back in NavBharatAI: watch, repair, retry

| # | What | Detail |
|---|---|---|
| C1 | **Poll** `/api/mobile-ship/runs` | status queued/in_progress/completed + conclusion. On completion the outcome (and failure code, if red) is recorded durably — see "Measuring the failures" below |
| C2 | **Real progress** `/api/mobile-ship/run-steps` | The run's ACTUAL steps from GitHub, mapped to plain white-label language — never an invented % bar |
| C3 | **Auto-fix** `/api/mobile-ship/autofix` | Failed-job log → `normalizeLog` → `classifyBuildFailure` (most-specific-first — a broken build prints several plausible strings at once, and a generic match would send the repair at the wrong file) → deterministic `repairFiles` → one named commit in the user's own repo → re-dispatch. Boundaries that ARE the safety model: repairs only what NavBharatAI itself wrote; never rewrites the user's app source; never invents a signing key; never commits a no-change (that is what stops an endless fix/rebuild loop) |
| C4 | **Hand-off to v5** | `APP_CODE_BUILD_FAILED` and anything not auto-fixable produces a "Fix" report INTO Pro v5 — with the real log excerpt, because a summary alone would make v5 guess at the error the compiler already named exactly |
| C5 | **Deliver** | `/artifacts` + `/download` (the .apk), `/report` (honest bounded log excerpt), `/my-apps` (the durable record — "maine jo apk banayi thi, woh kahan gayi?") |

## The complete failure-code registry (what NavBharatAI can name from a log)

`NPM_LOCK_CACHE` · `NPM_CI_NO_LOCK` · `NPM_PEER_CONFLICT` · `NPM_PACKAGE_NOT_FOUND` ·
`NPM_VERSION_NOT_FOUND` · `STALE_WORKFLOW` · `BUILD_SCRIPT_MISSING` · `WEB_DIR_MISSING` ·
`ANDROID_PLATFORM_MISSING` · `GRADLEW_NOT_EXECUTABLE` · `SDK_LICENSE_NOT_ACCEPTED` ·
`JAVA_VERSION_TOO_OLD` · `ANDROID_RESOURCE_LINKING` · `NODE_OUT_OF_MEMORY` · `MISSING_SIGNING_SECRET` ·
`SIGNING_CREDENTIALS_WRONG` · `GOOGLE_SERVICES_MISSING` · `NPM_REGISTRY_AUTH` ·
`TYPE_GATE_BLOCKED_PACKAGING` · `APP_CODE_BUILD_FAILED` · `UNKNOWN`

`UNKNOWN` is a design decision, not a gap: the classifier only claims a failure it can name exactly —
an honest "I could not name this" beats a confident wrong commit into a user's repository.

## Coverage table — prevention vs heal vs repair, with the honest gaps

| Failure class | Prevented (Phase A) | Self-heals (Phase B) | Repaired (Phase C) |
|---|---|---|---|
| Syntax / compile error in app code | ✅ A4.1 + heal | TS-only → B5 fallback | v5 hand-off (C4) |
| Unresolved local import | ✅ A4.2 + scaffold/AI | — | v5 hand-off |
| Missing npm package | ✅ A4.3 + curated pins | — | — |
| Invented npm VERSION (ETARGET) | ❌ needs the registry — cannot be checked purely | — | ✅ `NPM_VERSION_NOT_FOUND` (2026-08-27) |
| Tailwind used but not set up | ✅ A4.4 + deterministic heal (2026-08-27) | — | — |
| Missing image the store dropped | ✅ A10 gate | — | — |
| Server-only app (no screens) | ✅ A5 gate | — | — |
| Peer conflict / no lock file / stale cache | install branch by construction | ✅ B4 fallbacks | ✅ 3 codes |
| Wrong webDir | assembler detects | ✅ G17/G17b | ✅ `WEB_DIR_MISSING` |
| Android project / wrapper incomplete | — | ✅ B6.4–6 | ✅ 2 codes |
| Resource linking (icon/splash/name/minSdk) | — | ✅ B6.7–12 | ✅ refresh |
| Memory (Node or Gradle) | — | ✅ B5/B6.13 forced heaps | ✅ `NODE_OUT_OF_MEMORY` |
| Transient network in Gradle | — | ✅ G10 bounded retry | — |
| Signing secrets absent/wrong | — | fail-early check | honest user instructions (user-only) |
| **Still uncovered — open root causes** | | | |
| CSS `@import './missing.css'` chains inside CSS files (preflight scans only JS/TS) | ❌ | — | v5 hand-off only |
| A PostCSS/Vite plugin config error beyond Tailwind (custom plugins) | ❌ | — | v5 hand-off only |
| Native plugin Gradle/Kotlin version conflicts (rare; app-specific) | ❌ | — | `UNKNOWN` → v5 hand-off |
| GitHub Actions platform outage | — | — | retry later; not ours |

## Measuring the failures — how "80% fail" becomes a number we can act on

Until 2026-08-27 the durable record (`AppBuildStore`) knew a build was STARTED but never how it ENDED —
so the failure rate and its distribution were guesses. Every completed run now records its outcome, and
every classified failure records its code. The next autopsy of this pipeline starts from that data:
which codes actually fire, in what proportion — and the fixes go where the numbers point, not where
intuition does. (Fifth absolute rule: fix the system's honesty too.)
