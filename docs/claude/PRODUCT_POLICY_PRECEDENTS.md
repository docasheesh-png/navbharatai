# Product policies and autopsy precedents

> Moved verbatim out of `CLAUDE.md` on 2026-10-04 (admin: *"han"* to shrinking it — the file was 563 KB and was loaded into every message of every session). Read it before touching prompt triage, intent/build-confirmation, delivery verdicts, preview proof, or a client that reads a server body. Nothing here was reworded; the rules in it are as binding as they were in `CLAUDE.md`. `CLAUDE.md` keeps a short summary and a pointer to this file.

### 🚫 PORNOGRAPHY IS BANNED — and NavBharatAI enforces it, not the model (admin-mandated 2026-09-13)

Admin's ruling: **"पोर्नोग्राफी बैन है!"** The user-facing refusal is firm about the ban and says
nothing about the person:
> *"पोर्नोग्राफी बैन है। नवभारत AI एक भारतीय ऐप है और इस तरह का कोई ऐप नहीं बनाता — चाहे जैसे भी पूछा जाए।
> कुछ और बनाना हो तो बताइए, मैं तुरंत शुरू कर देता हूँ।"*

⚠️ **The first version was harsher** — it told the person NavBharatAI had *"no need of users like you"*
and invited them to log out. The admin read it back the same day and said *"yeh thoda jyada hi ho gaya"*.
**The ban did not change; the insult went.** Keep it that way: detection can still be wrong, and the cost
is asymmetric — a misclassified user shrugs off a firm refusal and screenshots a personal one. The ban's
force comes from the refusal being absolute, never from the tone.

**This REVERSES the rule written on 2026-09-12**, which classified adult content as *"NOT illegal —
lawful, governed by the creator's own +18 setting at PUBLISH"* and returned `flag`, letting the build
run. Report `03997004` is what that looked like: a request for a porn site with uploads, streaming and
anonymous chat consumed **171 seconds and eight model calls**, the platform read the refusals as a
capability failure and **retried on a stronger model**, and it closed by telling the user *"add credits
and I will complete it on the best engine"*. **We asked a person who wanted a porn site for money and
promised to build it.** Every model refused — the model's virtue, never our design.

- `ILLEGAL_RULES.ADULT_CONTENT` → `triagePrompt` returns **`block`**, before a sandbox or a token.
  One triage serves BOTH the build route and the chat route, so the ban covers both by construction.
  🔴 **CORRECTED 2026-09-21 — IT DID NOT SERVE THE IMAGE ROUTE.** `/api/image/generate` never called
  `triagePrompt`; the only thing between a pornographic prompt
  and a picture was whichever provider happened to refuse, and the free provider's anonymous door has
  safety OFF. A PR description (#3234) had stated the ban was enforced there "as before" — written from
  this paragraph, not from the route. Now all THREE surfaces run the same triage
  (`src/server/lib/imageSafety.ts`; surface `image` in the safety flags), before a link is minted or a
  provider is called. **"Both" in the line above means build and chat; a new surface that takes a
  prompt is not covered until it calls the triage itself — grep for `triagePrompt(` before claiming it.**
- **A refusal is a FINAL answer**: `shouldRetryEmptyBuild` never escalates one, and the free-tier
  upsell can never follow one (`looksLikeRefusal`). "Zero files" is not always a capability failure.
- ⚠️ **The message is blunt on purpose, so detection must stay PRECISION-FIRST.** The rule carries an
  `exempt` stand-down: a sexual-health clinic, a school safety curriculum, a harassment or trafficking
  reporting tool, a parental filter, a moderation dashboard and a legal-compliance page all contain
  both halves of the pair and must never see this message. **Missing a cleverly-worded request costs
  one model refusal, which already works; insulting a doctor loses a user forever.**
- The `adult` CONTENT CLASS is unchanged for the publish scanner (tagging still works); only the
  PROMPT verdict changed.
- 🔴 **PICTURES ARE A DIFFERENT SURFACE, AND THIS RULE DID NOT COVER THEM (Play rejection 2026-09-28).**
  `ADULT_CONTENT` waits for a porn noun AND "site / app / stream", so an IMAGE prompt has no second
  half to match: measured, `nude woman`, `naked girl on beach` and the bare word `porn` all returned
  **allow**. And "missing a request costs one model refusal" is **false for the image model — it does
  not refuse, it draws.** Google rejected the Android update with a screenshot of "Image Generator AI
  FREE" → "Photograph" showing a nude woman. Every prompt bound for Pollinations now passes
  `pollinationsGuard.ts` — a word ban (English, Hinglish, Devanagari, spaced/leet disguises, plus
  profanity) run INSIDE `pollinationsImageUrl`, so no path can build a link for a banned prompt — and
  every link carries `safe=true`, the provider's own NSFW filter, which is OFF unless asked for.
  ⚠️ **Scoped to Pollinations on purpose** (admin: *"sirf pollination ai ke liye"*): chat and build keep
  their precision-first triage. Do NOT widen the word list into chat — a sexual-health question must
  still get an answer. Test-locked and reversion-proven in `tests/theImageGeneratorDrawsNoNudity.test.ts`.
- 🔴 **UNTIL 2026-10-04 THE BAN COULD BE WALKED PAST IN HINDI (Q-102).** Every rule was ASCII, so "पोर्न
  साइट बनाओ" was allowed while "porn site banao" was refused. Each rule in `illegalContentRules.ts` now
  has a Devanagari half (its stand-down too), and both readers scan `normalizeScanText` (NFC, no
  zero-width characters). ⚠️ **JavaScript's `\b` cannot see a Devanagari word**: `/मत\b/` matches
  nothing. Use `(?<![\wऀ-ॿ])` / `(?![\wऀ-ॿ])`, or a consuming start in client
  code (Safari 14 has no lookbehind). `tests/aWordBoundaryCanSeeHindi.test.ts` fails on any new one.
  The other nine scripts (Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam, Urdu) are
  read too since 2026-10-04 (Q-321): one list per script per rule in `indicSafetyWords.ts`, written without
  a native reader of every script, so it is held to the strict side; add words there with a test.
  🛡️ **A child-protection or deepfake-detection app is not the offence (Q-320, admin chose (b) 2026-10-04).**
  The CSAM and NCII rules carry a `protective` stand-down (report, prevention, awareness, POCSO, helpline,
  detection, education…) that applies ONLY when no unambiguous word is present (porn, nude, naked, xxx,
  erotic, sexy, "sexual videos", "undress", "make a deepfake"); then the request is refused as before. One
  function, `protectiveStandDown`, read by the prompt triage AND the publish scanner. ⚠️ "sex"/"sexual"
  alone are deliberately NOT unambiguous ("report child sexual abuse" needs them). The other nine scripts
  stand down only on transliterated LOANWORDS (Q-344, admin "ok, go ahead" 2026-10-04): report, helpline,
  POCSO, detect, awareness; a native-only request stays strict until a native reader adds words.
  `tests/aProtectiveAppIsNotTheOffence.test.ts`.
  ⚠️ **NO LOOKBEHIND MAY REACH THE WEB BUNDLE (Q-322).** Safari before 16.4 (iOS 15) throws on one and
  takes its screen down — the Image Generator did not open there. A server file the client imports is
  client code too. `scripts/noLookbehindInBundle.mjs` (in `npm run test:bundle`) reads the built bundle.

### 🙋 READ THE MOOD FIRST — a question gets an answer, not an app (admin-mandated 2026-09-13)

> *"Simple question ka just simple answer dena chahiye — app banane ki yahan jarurat hi kahan hai.
> Direct app mat bana do! Yeh system control karo — pehle dekhu user ka mood kya hai, kya woh sirf
> answer chahta hai, ya app banwana chahta hai."*

**Before anything is built, decide what the user actually wants.** A build verb inside a QUESTION is the
object of that question, not an order: *"Can you generate images?"* asks what we can do. It cost a real
user **29 minutes and a failed app** (autopsy `5abad374`), and it was never one sentence — *"can I make
money from this?"*, *"what can you generate?"*, *"how do I make a login page?"* all hard-locked to
"build an app" too. **A pricing question built an app.**

The rule, in `IntentClassifier.ts`:
- A question naming **nothing to produce** ⇒ answer it (`chat`).
- A question that **does** name something ("can you build me a todo app?") keeps its build intent but
  **loses its HIGH confidence**, so the LLM intention-reader is finally consulted with project and
  conversation context. The intent is unchanged, so nothing regresses if that reader is slow or down.
- An **order** ("build a notes app", "ek billing app banao") is not a question — it stays HIGH and
  instant. The common path pays nothing.

🔴 **WIDENED BY THE ADMIN 2026-10-03 (Q-200, autopsy 3f959fde): "100% confirm nahi hai, to pahle text reply,
phir app banane ke bare me puchna hai."** A data question in Telugu with a sheet attached was built as a ₹272 app
because the reader answered "build". Now a `new_build` — or an "edit" of a chat that holds nothing of the user's —
goes ahead only when the MESSAGE confirms it (`buildConfirmation.ts`): a certain order, a complete-app or
start-over request, pasted source, or a non-question naming a whole product (app, website, game, tool…; a UI
part such as "table" is not enough). **A question that names an app is now answered and offered too** — this
replaces the bullet above that let it keep its build intent. The turn is recorded with lane `offer`; a short
"yes / haan / bana do" within 6 hours builds the OFFERED request (`prompt` becomes it; the chat history keeps
what was typed). Edits of an app the user really has are unchanged. `AGENTV3_CONFIRM_BUILD=off` reverts.

⚠️ **The asymmetry is the whole justification, and it must not be reversed.** Wrong toward chat costs
one message — and the chat reply already offers to build, so "haan" starts it. Wrong toward build costs
29 minutes, real money, and a user who asked for none of it.
⚠️ **An auxiliary opens an order as often as a question.** *"do it again"* is a retry; reading `do` as
interrogative re-opened the "please continue" amnesia this repo has already fixed once. An auxiliary
counts as interrogative only with a question mark, or when a second-person subject follows it.

### 📄 "ZERO FILES" IS NOT "NOTHING HAPPENED" — delivery is not measured in diffs (autopsy 697b38ee, 2026-09-14)

The prompt was *"Continue from where you left off and finish/fix the build so the app works end-to-end."*
The engine did precisely that: `tsc` clean, `npm run build` exit 0, dev server up, preview published,
opened in a real browser and seen rendering, the project's own Playwright suite installed and **passed**,
`PROD_BUILD_OK`, `GREEN_GUARD_SAVE`, release gate *"It runs and renders"*. It then told the user:
*"The build produced no files. Please try again"* and *"our engine is running slowly and your build could
not finish."* **Every clause was false, and the app on screen was working while it said so.**

- **A turn whose correct output is a VERDICT, not a diff, could not succeed by construction.** Delivery
  was measured by `writtenFiles.size`, so "continue", "is it working?", "fix the build" and "did you
  finish?" were all structurally incapable of passing however well they ran. `verifiedNoChangeSummary`
  is the other half of a concession `shouldRetryEmptyBuild` made in words two months earlier — *"the
  distinction is not 'did files change' but 'is there an app'"* — and had applied only to the RETRY.
  **It requires real browser evidence**: no proof still means an honest failure; "no files" must never
  become a way to pass.
- 🔴 **THE SAME SENTENCE HAD ALREADY BEEN ROOT-CAUSED, AND THE GUARD WAS CANCELLED SIX DAYS LATER.**
  `shouldRetryEmptyBuild`'s doc comment quotes this prompt **verbatim** as the Shiv Medical Store case
  that must not retry (2026-08-10). On 2026-08-16 a widening for build 5b4f9b63 added
  `userAskedToBuildAnApp = intent === 'new_build'` — and the keyword ladder matches the **noun** "build"
  in *"fix the build"*. The whole build re-ran on a second model: 6.2 finished minutes became 13.1.
  **Both suites stayed green because each was tested against the other's FLAG and neither against the
  SENTENCE.** A boolean derived from another subsystem's verdict is not a test of your own question —
  `userAskedForAnAppToBeBuilt` asks it directly, and `intent` (routing) is deliberately untouched.
- ⚠️ **A HAND-OFF THAT BECOMES AN OVERRIDE BREAKS THE THING IT WAS HELPING.** `withSandboxBrowsers`
  pinned `PLAYWRIGHT_BROWSERS_PATH` at the pre-baked path, pointing Playwright **away** from a chromium
  the agent had installed into the default cache 22 seconds earlier — so a suite that PASSED was
  re-reported as *"COULD NOT RUN — browsers are not installed"*, and the release gate then said the app
  *"has no test suite that could be run here"*. It is a **fallback** now: the project's own cache wins,
  ours is used only when it has none (the case the helper was written for). Playwright matches browser
  builds exactly, so a fresh install after a version bump makes the pre-baked copy wrong as well as unused.
- 🔎 **THE MISSING SUBSYSTEM, named so it is not re-discovered: there is no shared EVIDENCE LEDGER.**
  The agent's shell commands and the platform's gates keep private notions of what has been proven, and
  the gates trust only their own. That one report contains `RELEASE_GATE` saying *"the typecheck did not
  run"* after two clean `tsc` runs, `RUNTIME_UNCHECKED` after three successful console reads, and
  `CLAIM_UNSUPPORTED` (*"not one file was changed"*) two seconds before `Incremental: 2 changed, 2 new`.
  Every fact needed to contradict them was already recorded as `SANDBOX_CMD` lines in the same report.
  **Until one ledger exists that any actor writes a proven fact into and every verdict reads from, this
  class returns** — it is an OPEN root cause in `PROGRESS.md`, not a closed item.

### 🔴 A FACT ABOUT A PROVIDER CALL IS NEVER A FACT ABOUT THE APP — and the platform proves the preview ITSELF (autopsy 4efab9d7, 2026-09-15)

Admin, with the dashboard rendering on his phone beside "This build did not fully succeed, so it is
FREE": *"app ban jaye to 'app not build' dikha kar free (₹0) charge nahi karna hai! … app bani =
preview chala. agar preview chala gaya to ₹0 charge karoge to aise to mai barbad ho jaunga."*

- **What happened:** GLM was slow; a ~50-key pool timed out eight times at 60 s inside one 480 s turn
  (the in-run timeout bench was per KEY, so a pool could never reach two consecutive strikes; KIMI sat
  one rung away the whole time). The turn timeout was recorded as an unresolved provider ERROR labelled
  with the PLANNED model id (`claude-sonnet-4-6`, on a weak build that never called Claude).
  `shippingIssueCount` counted that ENGINE error as an APP blocker → release gate RED → verdict flipped
  to NOT ok → "working app or free" → ₹0. The user's build-health card printed the vendor id.
- 🔴 **THE SAME CLASS WAS ROOT-CAUSED TWO DAYS EARLIER (70115adf, 2026-09-13) for ONE error string** —
  budget-ended — and the timeout sibling was never hunted. The instance was fixed; the class was not.
- **Fixed at the class:** `isAppFinding` (`BuildDiagnostics.ts`) excludes every `provider`-phase issue
  BY PHASE from the release gate AND the user's health card (one predicate, both readers); the health
  card redacts every line by construction; the in-run timeout bench is keyed by provider FAMILY
  (`reportAs ?? name`) so two timeouts across ANY keys bench the pool for the run, independent of the
  env-tunable shared cooldown; a turn that times out with nothing received says "no provider answered"
  and keeps the planned id in the detail.
- 🔒 **DELIVERY PROOF (`deliveryProof.ts`):** every runtime proof is gated on a preview URL that only
  the AGENT used to publish. Now, after a build that was meant to produce an app, if no URL was ever
  published the platform starts the dev server itself (`npm run dev`, the revive path's own call),
  probes the port it knows (recipe → declared → framework default), judges the body with the same
  analyzer the health route uses, and PUBLISHES the URL — so the render rescue, the verify loop and
  the gate see the app exactly as they would an agent-published one. `PLATFORM_PREVIEW_UP` /
  `_NOT_UP` / `_SKIPPED` say what happened; kill switch `AGENTV3_PLATFORM_PREVIEW=off`.
- ⚠️ **Stated plainly, because the admin's rule cuts both ways:** the model wrote ZERO files in that
  build; the rendering app was the pre-seeded golden template. Under real-cost billing a rendered
  template costs the user what it cost us (about ₹11 there), and the honest "not built" notice still
  lists the features the prompt asked for and did not get. That is the admin's rule applied, not a
  loophole — and a zero-write turn that renders is billed by it.

### 📵 A SERVER BODY IS NOT THE ANSWER UNTIL IT IS CHECKED — `res.ok` AND the shape, at the entry (admin screenshot, iOS build 105, 2026-10-01)

App Mart on the phone showed *"SOMETHING WENT WRONG — undefined is not an object (evaluating 'c.missing.join')"*
and retrying did not help. `/api/nav-store/status` always sends `missing: [...]`; the screen stored WHATEVER
JSON came back (`if (data) setStatus(data as StoreStatus)`), so the first guard that answered the phone with
`{ error }` — the adaptive bot guard's 429, App Check's 401, the global 500 — became a status with no
`missing`, and the Publish tab crashed on it, every time.

- **The rule:** a fetched body becomes typed state only after `res.ok` AND a shape check at the ONE place it
  enters state (`readStoreStatus` in `appMart/storeStatus.ts` is the pattern: keep the real shape, turn every
  other answer into a sentence the screen shows). Never `set…(data as T)` on a bare body.
- **Locked by census:** `tests/anErrorBodyIsNotTheStoreStatus.test.ts` scans every client file for a
  `res.json().catch(() => null)` followed by a `set…(data as T)` cast with no `res.ok` / `res.status` /
  `in data` / type-guard between them. A new unchecked cast fails CI.
- **The trigger is shown, not swallowed:** when the status cannot be read, the Publish tab prints the server's
  own sentence. ⚠️ Which guard answered that phone is OPEN (Q-013) — a 429 there would mean the per-IP burst
  guard is hitting a CGNAT phone network, a second real defect.
