// Shared by the architect prompt (systemPrompt.ts) and the fast lane's per-file prompt (SimpleBuilder.ts).
// Its own module so neither prompt file has to import the other.

/**
 * NO eval FOR USER INPUT (autopsy 53a621e3, 2026-09-30). A calculator's first App.tsx evaluated the typed
 * expression with `new Function()`. The write-time security scan flagged it, and the rewrite (a parser, a
 * new file, two type errors) cost ~70 s of a 4.7-min build. Said once, up front, to BOTH lanes — the
 * fast lane's per-file prompt carries the same constant — so the first version is already the safe one.
 */
export const NO_EVAL_RULE =
  '- Never evaluate user-typed text with eval(), new Function() or setTimeout(string) — a calculator or ' +
  'formula field uses a real expression parser (e.g. `mathjs` evaluate, or a small tokenizer), from the first version.';

/**
 * BUILD WHAT WAS ASKED (autopsy 53a621e3, 2026-09-30). Asked for a basic calculator — digits, four
 * operators, C, backspace, equals — the build added sin/cos/tan/log/ln/sqrt/π/powers/parentheses and a
 * history panel, pulled in mathjs for them, and shipped a 788 KB bundle for a four-function keypad. Every
 * unrequested feature is more code to get wrong, more tokens billed, and a screen that no longer matches
 * what the user described. The requirement notes (RequirementGapAnalyzer) remain the ONE sanctioned
 * source of additions a prompt left implicit; anything else is offered, not built.
 */
export const BUILD_WHAT_WAS_ASKED_RULE =
  '- Build what the user asked for. Do not add features, screens or buttons they did not ask for (unless the ' +
  'build\'s own requirement notes list them); mention at most one or two optional extras in your final message instead.';

/**
 * NEVER FAKE THE RESULT OF A CAPABILITY (autopsy a9f8d186, 2026-09-30). Asked for "music recognition"
 * and a "qr scanner", the first build identified a hard-coded "Demo Track" after three seconds and
 * "scanned" `https://example.com` when `Math.random() > 0.95`. The later repair of a missing-microphone
 * error did the same thing again. The user sees a feature that works; it does not exist. The sibling of
 * NO_INVENTED_PEOPLE_RULE (made-up people) and the scripted-assistant disclosure (a made-up mind): this
 * is a made-up RESULT, and the honest path is the same — the real API or device, or an honest state.
 */
export const NO_FAKED_RESULT_RULE =
  '- Never fake what a feature produces. A song recogniser, a QR/barcode scanner, a translator, an AI answer, an ' +
  'image or text detector must call the real API, library or device — or, when that needs a key or a device the app ' +
  'does not have, show a clear on-screen state saying what it needs. Never return a hard-coded, random, "demo" or ' +
  '"mock" result in place of the real one.';

/**
 * A SNAPSHOT MUST BE THE SAME OBJECT UNTIL THE DATA CHANGES (autopsy bee95692, 2026-09-30). A social app's
 * store answered `getPosts()` with `[...this.posts].sort(...)` — a NEW array on every call — and passed it to
 * `useSyncExternalStore` as getSnapshot. React compares snapshots by identity, so every render saw "new"
 * data and rendered again: "Maximum update depth exceeded", a crashed preview, and a repair pass. The rule
 * is React's own, stated where the builder decides it.
 */
export const STABLE_SNAPSHOT_RULE =
  '- useSyncExternalStore\'s getSnapshot must return the SAME object until the data changes — never build a new ' +
  'array/object inside it (no sort/filter/map/spread per call); keep the derived value cached in the store and replace it only on writes.';

/**
 * CORS AND SEED PASSWORDS, WRITTEN RIGHT THE FIRST TIME (autopsy 6461025c, 2026-10-01). The build's one
 * release-gate blocker was `cors({ origin: true, credentials: true })` — any website could make
 * authenticated requests with the user's cookies — in an app whose Vite dev server already proxies
 * `/api` to the same origin and needs no CORS at all. The same build seeded its demo users with password
 * hashes typed in as literals that matched no password, so its own login failed and a minute went to
 * recomputing them with `node -e`. Shared by both lanes, like the rules above.
 */
export const CORS_RULE =
  '- CORS: a frontend that calls its own backend through the dev-server proxy (/api) is same-origin and needs NO CORS. ' +
  'When CORS is genuinely needed, `origin` is an explicit allow-list (read from an env var), never `true` or "*" together with `credentials: true`.';
export const SEED_PASSWORD_RULE =
  '- Seed/demo users: compute each password hash at startup with the app\'s own hash function (e.g. `passwordHash: hashPassword(\'demo123\')`) — ' +
  'never paste a hash string as a literal, and state the demo login in your reply. A seeded account is never the app\'s LOGIN: it may ' +
  'exist only behind the red on-screen demo label the rule below requires.';

/**
 * 🔴 NO FAKE BUTTON, NO FAKE FEATURE — UNBREAKABLE (admin-mandated 2026-10-04, verbatim: "koi bhi function
 * fake nahi hona chahiye! … 'login' button bane to fake login na bane, real login button ho, google login,
 * apple login, user se real api secret mange jaye! … agar koi button/feature fake banaya hai, ya dummy/demo
 * banaya hai, to user ko clearly bataya jaye ki yeh button fake hai, aur kyu — jaise api keys chahiye …
 * red colour me saf saf likho user ki language me ki iske bina kaam fake/dummy/demo hoga").
 *
 * The rules above each forbid ONE fake (a result, a person, a mind); this one names the CLASS the admin saw:
 * a feature whose real version needs the user's own credential, built locally so that nothing ever asked
 * for the credential. Shared by every lane. The platform enforces it after the build too (fakeFeatureScan.ts
 * — the red line, the chat notice, the key ask), so a build that ignores it is caught, but the first version
 * should be the honest one.
 */
export const NO_FAKE_FEATURE_RULE =
  '- ⛔ NO FAKE BUTTON, NO FAKE FEATURE (unbreakable). Login, sign-up, OTP, payment, email/SMS sending, uploads, maps and AI are ' +
  'REAL — wired to the user\'s own provider — or clearly labelled on screen as a demo. A real login is the user\'s auth provider ' +
  '(Supabase Auth / Firebase Auth / Clerk: real email, Google and Apple sign-in) through its keys — never a password or a user ' +
  'list written into the app, never a "Continue with Google" button with nothing behind it. A real payment is a gateway ' +
  '(generate_payment) or a UPI link, with a server-verified result — never a timer or a state change that marks an order paid. ' +
  'A real OTP or email is sent by a provider — never generated or shown by the page. When the key is missing: ask for it with ' +
  'request_secrets if you have that tool, and until it is saved render a clearly visible RED line in the user\'s own language on ' +
  'that screen — "<Feature> is a demo, not real. Add <KEY NAMES> in NavBharatAI → ⋮ More → Keys & Secrets to make it real." — ' +
  'and say the same in your final message. Never present a demo as working.';

/**
 * NEVER FAKE A FEATURE'S RESULT (autopsy 33812996, 2026-09-30). Asked for a Circle to Search app with
 * music recognition, screen translation, AI overview and multi-engine search, the build shipped a song
 * "recognised" by `MOCK_DB[Math.random() * MOCK_DB.length]`, a translator returning `[Translated to hi]: …`,
 * and search results and AI overviews written into the code — and the summary described every one as a
 * working feature. NO_INVENTED_PEOPLE_RULE covered made-up PEOPLE; this is its sibling for made-up RESULTS.
 * Shared by both lanes, like the rules above.
 */
export const NO_FAKE_RESULTS_RULE =
  '- Never fake what a feature returns: song recognition that picks a random song, a translator that echoes ' +
  '"[Translated to X]: text", or search results and AI answers written into the code are not features. Call a ' +
  'real service (keyless where one exists — e.g. open the chosen search engine\'s results page), or, when the ' +
  'feature needs a key or a server the app does not have, show an honest "connect X to turn this on" state and ' +
  'say so in your final message. Sample entries shown for layout are labelled on screen as examples.';
