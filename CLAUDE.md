# NavBharatAI — Session Constitution

This file is auto-loaded at the start of every Claude Code session in this
repo. It exists because **more than one Claude account/session works on this
project — and, since 2026-09-13, SEVERAL AT THE SAME TIME, deliberately.**
These rules exist to stop that from breaking the app or wasting work. They
rarely change; the living, constantly-updated status (current phase, exact
resume point, what's done) lives in `PROGRESS.md`, not here.

🔴 **CORRECTED 2026-09-13 — this paragraph said "sequentially (never at the
same time)" and that is FALSE.** The admin confirmed, asked directly, that the
concurrent sessions are intentional. The old wording was not a stale detail: it
was the PREMISE the 7 safeguards were written on, so a session reading it would
reason that `main` only moves BETWEEN its turns and that nothing else is being
built right now. Both are wrong, and both produce exactly the duplicated work
safeguard #6 exists to prevent. See **"Working alongside other live sessions"**
below for what actually changes.

## THE AIM (admin-mandated, 2026-07-17)

**AIM: Make NavBharatAI the WORLD'S BEST AI app builder.** Every decision, every
line of code, every law, and every document exists to move the app toward that one
goal — the strongest, most reliable, most trusted, error-proof app maker on Earth,
better than every competitor (Lovable, Bolt, v0, Replit, Cursor, …). When choosing
between options, the tie-breaker is always: *which one makes NavBharatAI the world's
best?* This aim sits above everything except the absolute rules, which are how the
aim is protected.

## The external-suggestion rule (admin-mandated, 2026-07-17)

**Laws, specs, blueprints, or ideas suggested from OUTSIDE (e.g. ChatGPT, other
tools, generic templates) do NOT know this app and MUST NEVER be transcribed
blindly.** They are raw material, not commands. For every external suggestion:
**adapt it to NavBharatAI's real, code-anchored requirements — modify, add, or delete
freely** so that it *improves* the app and never harms it. A suggestion that
contradicts what actually makes the engine stronger (e.g. a 30-independent-agent
relay that our coherence architecture rejects) is corrected, not obeyed. The test is
always the AIM, the absolute rules, and the real codebase — never the prestige of the
source. Honest adaptation over blind obedience (this is the third absolute rule, no
sycophancy, applied to external input).

## The one absolute rule

**The app must never break — no matter how much time or credit it takes.**
Goal: make NavBharatAI the world's best AI app maker. Every rule below exists
to protect that one rule.

## The second absolute rule: Real features only — no exceptions, no matter how long it takes

**Every feature, button, or capability added to NavBharatAI must be real, fully wired,
and working end-to-end before it ships. No half-done work. Ever.**

This means:
- A button MUST do what it says — "Deploy" must actually deploy, "Save" must actually save.
- A form MUST send real data to a real backend — no `console.log()` placeholder wiring.
- A feature visible in the UI MUST have its server API wired and returning real data.
- A status indicator MUST reflect real state — never hardcoded, never faked.
- A feature that "looks done" but does nothing is NOT done — do not commit, do not merge.

If the real implementation needs infrastructure not yet available (no API key, no sandbox,
no third-party service), the feature MUST NOT ship until that infrastructure exists — OR it
must show an honest, clear "not available" state with a real message. Never fake the result.

**There are only two valid states: (a) fully working, or (b) not built yet.**
"Built but not really working" does not exist in NavBharatAI.

This rule has no exceptions. No time pressure, no credit pressure, nothing overrides it.

## The third absolute rule: Be honest with the admin — never agree just to please (no sycophancy)

**Do not just say yes to whatever the admin says. No flattery, no "yes-man" answers.**
Give honest, correct advice that genuinely makes the app better — even when it
disagrees with what the admin proposed. If the admin's idea is wrong, risky, or there
is a better approach, say so directly and explain why, then recommend the right path.
Agreeing with a bad idea to sound agreeable hurts the app and breaks the first two
absolute rules. The admin wants the truth and the best technical judgement, not
approval — disagreement delivered with clear reasoning is more valuable than empty
"yes".

## The fourth absolute rule: Root-cause fixes only — never surface patches (admin-mandated, 2026-07-03)

**Whenever the task is an edit, a bug fix, or an error fix — of ANY size — do not just make
the visible symptom go away. Go deep, find the true origin, and eliminate the problem at its
root, professionally.** A patch that hides the symptom while the cause survives is not a fix;
it is a scheduled repeat of the same failure. This rule applies to every "fix this", "edit
this", "yeh error aa raha hai" request, no matter how small it looks.

**The mandatory root-cause method (every fix follows all six steps):**

1. **Investigate before touching code.** Read the actual failing code path end-to-end and
   reproduce/trace the failure from real evidence (logs, diagnostics reports, stack traces,
   git history). Identify the EXACT line/design decision where the problem originates — do
   not fix from guesses, symptom descriptions, or assumptions. If the evidence contradicts
   the reported theory, follow the evidence.

2. **Ask "why does this class of bug exist?" — fix the class, not the instance.** If the
   root cause is duplicated code that drifted, CENTRALIZE it (one shared, tested
   implementation). If it is a stale hardcoded value, make it a single source of truth with
   an override. If it is a missing invariant, enforce the invariant where the data enters —
   not at one call site. (Real examples from this repo: 4 drifted copies of `safeRelPath` →
   one shared `workspacePath.ts`; retired AI model ids hardcoded in 5 files → one
   `visionModels.ts`.)

3. **Hunt the siblings.** The same root cause almost always lives in more than one place.
   After finding it once, grep the whole repo for every other occurrence of the pattern and
   fix them ALL in the same change — an IDOR found on one route means auditing every route;
   a stale model id in one file means sweeping every file.

4. **Lock it with regression tests.** Every root-cause fix ships with tests that encode the
   exact failure case (the real input/scenario that broke) plus the boundary cases, so the
   bug class can never silently return. A fix without a test is a fix on borrowed time.

5. **Fix the system's honesty too.** If the bug produced a wrong verdict (fake success,
   working-thing-reported-as-failed, misleading error message), fixing the code is not
   enough — fix the reporting so the system tells the truth about that state forever after.

6. **Say honestly when the root is out of reach.** If the true root cause lives in
   infrastructure that cannot be changed right now (a third-party service, a missing env,
   admin-only console), do NOT quietly ship a cosmetic patch as if it were the fix. Ship the
   best honest mitigation, state clearly what the real root cause is and what is needed to
   kill it, and record it in `PROGRESS.md` as an open root cause.

**Forbidden as "fixes":** silencing an error without understanding it; try/catching a
symptom away; special-casing one input while the general case stays broken; retry loops
around code that deterministically fails; changing a test to match broken behavior; "it
works now" without knowing WHY it broke. Time pressure never justifies a surface patch —
a surface patch is future breakage on the one absolute rule.

## The fifth absolute rule: Every build report is a forensic autopsy — mine it to zero, then harden v3.0 at the DNA level (admin-mandated, 2026-07-05)

**Whenever the admin sends a build report, diagnostics report, or any real run output from
NavBharatAI Pro v3.0 (AgentV3) — that report is the single highest-signal evidence we will
ever get about where the engine actually struggles on a real app. It is NOT a status glance
to skim and reply "looks good". It is a mandatory, exhaustive forensic autopsy whose end
state is a hardened, measurably-more-error-proof v3.0.** The admin's standing goal is an
**error-free / error-proof v3.0**: the same mistake never recurs, even large and complex apps
struggle minimally, and whatever v3.0 does, it does perfectly. Every autopsy moves the engine
toward that bar; an autopsy that ends without root-cause fixes (or honestly-recorded open root
causes) is incomplete.

This rule is the OPERATING ENGINE for the fourth absolute rule (root-cause only): the fourth
rule says *how* to fix; this fifth rule says *every real report is the trigger and the source
of what to fix*. Both are non-negotiable and reinforce the one absolute rule (never break the
app). Run all four mandatory steps, in order, every time:

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

⚠️ **The asymmetry is the whole justification, and it must not be reversed.** Wrong toward chat costs
one message — and the chat reply already offers to build, so "haan" starts it. Wrong toward build costs
29 minutes, real money, and a user who asked for none of it.
⚠️ **An auxiliary opens an order as often as a question.** *"do it again"* is a retry; reading `do` as
interrogative re-opened the "please continue" amnesia this repo has already fixed once. An auxiliary
counts as interrogative only with a question mark, or when a second-person subject follows it.

### 🫰 THE BAR EVERY AUTOPSY IS MEASURED AGAINST (admin-mandated 2026-09-13, verbatim)

> *"NavBharatAI koi bhi app — kitni bhi badi aur complex — bina kisi struggle ke, minutes me bana de.
> Aisa lage ki yeh app banana to baaye haath ka kaam hai, chutkiyon 🫰 ka kaam hai!
> Jo jo problem aayi hai, unka root cause dhoond ke DNA 🧬 level par problem jad se khatam karni hai."*

**So "the build succeeded" is NOT the bar. The bar is that it looked EFFORTLESS** — big or small, simple
or complex, the app arrives in minutes and nothing about the run reads as a struggle. Judge every report
against that, not against whether it eventually produced something:

- **A retry, a fallback, a heal, a long silence — each is a visible struggle even when it ends in success.**
  A build that self-heals three times has not met this bar; it has hidden a failure behind a green tick.
  Count them, and kill the reason each one existed.
- **Complexity must not cost struggle.** If a big app struggles more than a small one, that gap IS the
  defect — name it and remove it. "It was a complex app" is an explanation, never an excuse.
- **Minutes, and the minutes must be WORKING minutes.** Time spent waiting on a stalled call, on an
  abandoned lane, or on a gate nobody reads is time the user is watching a spinner. Every such minute is
  a ledger item in its own right, whatever the build's final verdict.
- **DNA level, not the instance.** Fix the CONDITION that let the problem exist, then make the wrong
  branch impossible (the 50/50 law below). A fix that only stops today's occurrence is half a fix.

⚠️ **The real cost of stopping at "it works": autopsy `a38c6fef` (2026-09-13).** The exact same
zombie-write bug had been root-caused in July, fixed in ONE of the two lanes that carry it, and the
sibling was never hunted — because that lane kept a private copy of the shared helper, so no search
reached it. Two months later it failed a 28-minute build whose app had already rendered perfectly, and
told the user their app was not ready. **The instance was fixed; the class was not. That is what this
bar forbids.**

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

**Step 1 — Read the WHOLE report and build an itemized ledger (every flaw, however small).**
Read the report end to end — never a truncated tail. Enumerate EVERY issue, imperfection,
warning, retry, and rough edge, no matter how tiny, and classify each into exactly one bucket,
with a running count and a concrete one-line description per item:
- ✅ **Self-healed** — v3.0 detected and genuinely fixed it itself. (Count + list. A self-heal
  is NOT "free": in Step 3 you still ask why the bug could occur at all and prevent it upstream
  so the engine never has to heal it.)
- 🔀 **Worked around / alternative used** — v3.0 substituted or routed around the real problem
  instead of fixing it (fell back to a different model/tool/path, stubbed, degraded). (Count +
  list. Every workaround is a DEFERRED root cause — flag it as debt, never as a win.)
- ⏭️ **Skipped / ignored** — v3.0 saw it (or should have) and took no action. (Count + list.)
- ❌ **Still broken / shipped imperfect** — the flaw survived into the delivered app or result.
  (Count + list. These are the most urgent.)
- 🥵 **Struggle points** — where v3.0 looped, retried, burned many steps, backtracked, or nearly
  failed even if it eventually succeeded. (Count + list, with EXACTLY where in the run.)
Report these five buckets back to the admin as a clear tally ("v3.0 ne X self-heal kiye, Y
workaround, Z skip, W abhi bache, and struggled at …") — honest numbers, no inflation.

**Step 2 — Diagnose the MISSING subsystem (level up the platform, not just this one app).**
Step back from the individual items and ask the systemic question the admin explicitly wants
answered: *reading the whole report, what SYSTEM / ENGINE / SETTING is missing from our AI that
would have prevented this entire class of struggle?* Name it concretely — e.g. a missing
dependency auto-sync, a missing real port/health detector, a missing DB-migration runner, a
missing pre-flight env/secret check, a missing self-review pass, a missing capability tier.
This is how v3.0 gets structurally better instead of patching one app at a time.

**Step 3 — DNA-level root-cause fix for EVERY ledger item (all five buckets, not just ❌).**
Apply the fourth absolute rule's six-step method to eliminate the CLASS behind each item:
- A 🔀 workaround → build the real fix so the workaround is never needed again (or, if it truly
  can't be built now, record it as an open root cause per rule 6 — never leave it silent).
- A ⏭️ skip → becomes a caught-and-handled case with an honest outcome.
- A ❌ still-broken → root-caused and killed, with a regression test encoding the exact failure.
- A 🥵 struggle → becomes a smooth path (fewer steps, no loop, faster convergence).
- A ✅ self-heal → trace why the bug class exists and prevent it upstream so v3.0 never has to
  heal it in the first place.
Then finish the fourth-rule discipline every time: hunt the siblings across the whole repo
(rule-3), lock each fix with regression tests (rule-4), and fix the system's honesty so the
report tells the truth about that state forever after (rule-5). Ship through the normal cycle
(branch → verification gate → PR → CI green → merge); update `AppKnowledgeBase.ts` for any new
user-facing capability and append the autopsy + fixes to `PROGRESS.md`.

**Step 4 — The bar is error-free v3.0.** The same mistake must never come back, big complex
apps must struggle as little as small ones, and every capability v3.0 exposes must work
perfectly. If some root cause is genuinely infra-blocked right now, say so plainly and record
it in `PROGRESS.md` as an open root cause (rule 6) — never ship a cosmetic patch as if it were
the fix. Time and credit pressure never shrink this autopsy; a skipped autopsy is a guaranteed
repeat failure on the one absolute rule.

**Step 5 — THE 50/50 LAW: fixing the root cause is only HALF the work; the other half is "why did
the problem arise AT ALL?" (admin-mandated 2026-07-22).** DNA-level root-causing the reported failure
is 50%. The other 50% is going one level DEEPER and killing the CONDITION that let the problem exist —
so the app is built RIGHT the first time and the failure can never recur. Apply this to every bucket,
especially the ones that look "harmless":
- **✅ Self-heal is NOT a success — it is a RED FLAG.** For every self-healed item ask: *why did the
  builder not produce this correctly in the FIRST attempt? Why did a heal need to run at all?* The
  goal is **100% correct in ONE pass, with ZERO heals needed.** Fix the upstream cause (the prompt/
  contract/scaffold/plan that let the bug be generated) so the heal becomes DEAD CODE that never fires.
  A heal that keeps firing is an unfixed root cause wearing a green checkmark.
- **THEN, and only as the last line of defence:** IF a problem still somehow slips through, the
  self-heal must be **100% reliable** (a real, deterministic fix that always works — never a partial or
  best-effort patch). Two layers: (1) prevent it upstream so it never happens; (2) if it still happens,
  heal it completely.
- **🔀 workaround / ⏭️ skip must be ARCHITECTURALLY IMPOSSIBLE.** These are not acceptable outcomes to
  record and move on from — they are design failures. The engine must be built so that routing around a
  problem or skipping it CANNOT happen: the correct path is the only path. When a report shows a
  workaround or a skip, the fix is not "handle it better" — it is "re-architect so this branch cannot
  exist." Until that architecture exists, it stays an OPEN root cause (rule 6), never a closed item.

An autopsy that only patches the reported symptom (the first 50%) and leaves the "why did it arise / why
was a heal needed / why was a workaround possible" half undone is an INCOMPLETE autopsy — it guarantees
the sibling failure returns. Both halves, every time.

**Step 6 — THE WORLD-BEST PROACTIVE LAYER: every report ALSO gets Claude's own forward-looking suggestions,
not only the reactive fix (admin-mandated 2026-07-31).** Steps 1–5 are REACTIVE — they mine what already
broke. That is necessary hygiene, but ALONE it is a treadmill (mopping the floor while the tap runs) that
never reaches THE AIM (the world's best AI app builder). So with EVERY build report — ON TOP of the full
5-bucket autopsy — Claude must ALSO step back and give the admin its OWN proactive, senior-engineer
suggestions toward world-best, in simple language (the admin is non-technical and wants Claude's judgement,
not a checklist). Every report reply carries BOTH: the OLD autopsy tally AND this proactive layer. Every time:

- **PREVENT, don't heal — the single biggest lever.** For every ❌ / 🥵 AND every ✅ self-heal, ask the
  harder question: *how do we make the FIRST build correct so this never needs fixing?* Propose the UPSTREAM
  change (prompt / scaffold / shared contract / plan) that stops the whole class from being generated at
  all. A build that never creates the bug beats a build that heals it — this is where world-best is actually
  won (most "continue / fix the error" builds are the engine cleaning up its OWN mistakes; kill them at the
  source).
- **Name the big systemic ceiling HONESTLY (rule 3, no sycophancy).** If a recurring pattern is capping the
  DEFAULT quality — e.g. the GLM / cheap-tier 429 storm and weak-model flailing — say it plainly to the
  admin even though it "self-heals", instead of hiding a ceiling behind a green checkmark. A self-heal that
  fires on every build IS the ceiling. Propose the real fix, or record it as a STRATEGIC open item (rule 6).
- **Guard the EXPERIENCE the user actually feels.** Flag anything a world-best builder would never ship —
  an unreliable preview, a slow build, a first-try app that looks or works poorly — and propose the
  improvement. Trust is the product; the user judges by what they SEE, not by our internal metrics.
- **Lean into the real MOAT, don't clone.** Where relevant, suggest deepening what the competitors
  (Lovable / Bolt / v0 / Cursor / Replit) do NOT do — NavBharatAI's India-first edge (Hindi, Cashfree,
  domain recipes, the App Store, mobile-first). Copying makes a follower; the moat makes a leader.
- **DRIVE it — decide, don't wait.** The admin is non-technical and explicitly wants Claude to CHOOSE what
  matters most. So Claude PROPOSES and PRIORITIZES these proactively (best-for-the-app default + the
  60-second rule), announces the ONE highest-value lever, and pursues it — it does not wait to be asked.
  Reserve real questions for the genuinely consequential fork.

An autopsy that ends at "fixed the reported bug" WITHOUT this forward-looking layer is INCOMPLETE toward THE
AIM. The reactive five steps keep the app from breaking; this sixth, proactive step is how it becomes the
best. Both layers — reactive autopsy AND proactive world-best suggestions — with every single report.

## Working alongside other live sessions (admin-confirmed 2026-09-13)

**Several Claude sessions run on this repo at the same time, on purpose.** On the day this was
written, five were live within one hour — PRs #2886, #2887, #2888, #2889, #2890 and #2891, from four
different sessions, all touching the build engine. That is the normal condition now, not an incident.

**What it changes, concretely. Four things, and none of them is optional.**

1. **`git log` is not the state of the work — OPEN PRs are.** A session's work in progress is
   invisible in `main` until it merges, so a redundant-work check (safeguard #6) that reads only the
   committed tree is answering a question nobody asked. **Before starting anything, list the open
   PRs and read their titles and their "still open / open root cause" sections.** That takes one call
   and is the only place another session's in-flight work exists.

2. **🔴 ANOTHER SESSION'S "OPEN ROOT CAUSE" IS A CLAIM ON THAT WORK — treat it as taken.** This is
   the new half of safeguard #2's phase lock, and it was learned the same day: I announced in-flight
   provider-call cancellation as my next task, then found PR #2889 already carried it, in its own
   words — *"the real fix threads the lane's remaining budget down into the provider chain… is the
   next thing to take."* Building it would have been PR #1 and PR #4 a third time. If a PR names a
   root cause as its next step, it owns it; pick something else or say so and ask.

3. **A merge conflict is expected, not a mistake.** `main` moves DURING a change now, not only
   before it. So safeguard #1's fresh-state check is no longer a once-at-startup ritual: re-fetch
   before opening a PR and again before merging. When `main` has moved, merge it in and **re-run the
   FULL gate on the merged state** — this is why safeguard #5 insists the gate runs last, on the
   final state; with concurrent sessions a gate run before the merge proves nothing at all.

4. **Do not "fix" another session's file while it is mid-flight.** Two sessions editing the same
   region produce a conflict whoever is right. If their change is wrong, say so to the admin rather
   than racing them to the file.

⚠️ **What has NOT changed:** everything else in this file. The absolute rules, the verification gate
and the branch → PR → CI green → merge cycle are what make concurrency survivable in the first place
— a green CI on a merged state is the only thing standing between five parallel sessions and a
broken `main`. Concurrency is a reason to hold those tighter, never looser.

## The 7 safeguards (mandatory, every session)

1. **Fresh-state check before trusting any doc.** At the start of every
   session: `git fetch origin main` + `git log --oneline -10` (and check open
   PRs) BEFORE believing what `PROGRESS.md` claims is done. `PROGRESS.md` can
   go stale the moment another session pushes after it was written — this
   happened for real (PR #1 and PR #4 were redundant work built blind on a
   stale picture of `main`). Treat the actual git state as ground truth;
   treat the doc as a hint.

2. **Phase-level lock + exact resume point.** ⚠️ Since 2026-09-13 "another
   session" usually means one running RIGHT NOW, not one that finished — so the
   lock signal is an OPEN PR as much as a `PROGRESS.md` entry (see "Working
   alongside other live sessions" above). Don't start, redo, or
   "improve" a phase another session is actively working on or has already
   completed — find the exact next un-done item and continue from there, not
   from a clean slate. A lock is only released when a phase is marked
   **DONE** in `PROGRESS.md`, or by explicit admin (user) override. If it's
   unclear whether a phase is locked/owned, ask the admin rather than
   guessing or duplicating.

3. **0.01% doubt → stop and ask the admin.** If there is ANY doubt — even
   minimal — that a change risks breaking the app, conflicts with the other
   session's in-flight work, or touches architecture you're not fully sure
   about: STOP. Do not push, do not commit, do not guess. Ask the admin
   directly: state the exact risk and the options. Never silently take the
   "probably fine" path on anything with breakage risk.

4. **Commit small, commit often — never bet on a graceful save.** Don't wait
   to commit until "right before credits run out" — credit cutoffs are often
   abrupt, not graceful, and that bet loses work. Commit after every
   meaningful sub-step within a phase (not just at the end of the whole
   phase), so the maximum possible loss window is small.

5. **Mandatory verification gate before every push — never skipped.**
   `npx tsc --noEmit` (frontend) + `npx tsc -p tsconfig.server.json` (server,
   if touched) + `npx vitest run` (read the actual pass/fail line, don't
   trust a truncated `tail`) + a manual/boot smoke check for server changes.
   This gate is non-negotiable, even under time or credit pressure.

   ⚠️ **THE GATE ABOVE IS NARROWER THAN CI, AND THAT GAP HAS COST A RED BUILD
   (2026-09-10).** A session ran tsc and the full 20,000-test suite, got green
   on both, pushed — and CI failed in 87 seconds on `scripts/noUnusedImports.mjs`
   over a single import left behind by a refactor. Neither tsc nor vitest can
   see an unused import, so a gate made only of those two is structurally
   incapable of catching that class at all. **`.github/workflows/ci.yml` is the
   real gate; the list above is a subset of it.** Before a push, run the steps
   CI runs that the list omits:
   `npm run typecheck` · `node scripts/noUnusedImports.mjs` ·
   `npm run typecheck:server` · `npm run build` · `npm run test:bundle` ·
   `npm run boot:check` (and `npm run audit:gate` / `license:gate` when
   dependencies changed). They take about two minutes together — far less than
   a red CI round trip, and they catch what the two-command gate cannot.
   **Re-read the workflow rather than trusting this list**: CI gains steps, and
   a list in a doc goes stale exactly the way this one did.

   🔴 **RUN IT AT THE END, ON THE FINAL STATE OF THE CHANGE — NEVER MID-WAY.**
   A gate run before the last file was written proves nothing about what is
   being pushed, and it is worse than no gate at all, because it produces a
   green result you will honestly report and honestly believe.

   **The real incident (2026-09-08, PR #2778).** I ran `tsc --noEmit`, it passed,
   and I then ADDED a test file and ran only `vitest`. CI failed with ~60 type
   errors in `serverDb.ts`, `logStore.ts`, `Deployment.ts` — files the change
   never touched — and my first three theories (another session broke `main`, a
   dependency drifted, the lockfile changed) were all wrong. `main` was green;
   the new test file was the cause. **Both typechecks and the suite go last, in
   one pass, after the final edit.** Re-running a check you already ran costs a
   minute; a wrong green costs a red CI and a false diagnosis.

   ⚠️ **`vitest` exiting 0 does NOT mean the suite passed.** A run can print
   `Tests 1 failed | 19736 passed` and still exit 0 (seen 2026-09-07). Read the
   `Tests` line itself, and when capturing to a file, `tee` the whole log and
   grep it for `FAIL` — a `tail -7` shows the summary but hides which test broke.

6. **Redundant-work check before starting anything new.** Before building a
   new feature or fix, grep/search the current `main` to confirm it doesn't
   already exist. This is not optional housekeeping — it is what would have
   prevented PR #1 and PR #4 from being built at all.

   ⚠️ **AND SEARCHING `main` IS NO LONGER ENOUGH (2026-09-13).** With sessions
   running concurrently, the work most likely to be duplicated is the work that
   has not merged yet — it is in an OPEN PR and therefore in no tree you can
   grep. **List the open PRs first**, and read their "still open / open root
   cause" sections: a root cause another PR names as its next step is taken. See
   "Working alongside other live sessions" above.

   🔴 **"MY SEARCH FOUND NOTHING" IS NOT "IT DOES NOT EXIST." IT USUALLY MEANS
   I GUESSED THE WRONG WORD.** This is the single most expensive mistake in this
   repo's history, and it is nearly always a vocabulary failure rather than a
   missing feature.

   **Four real incidents, three of them in ONE session (2026-09-07/08):**
   - Searched `mentionFile`, `contextPicker`, `attachFile` → concluded @-mentions
     did not exist. The real name was **`parseFileMentions`**. I then **overwrote
     `fileMentions.ts`, destroying a working, tested, wired feature.** Only a
     TypeScript error on a stale import revealed it. Restored, nothing lost — by
     luck, not by process.
   - Searched `acceptHunk`, `diffReview`, `approveChange` → reported "no diff
     review at all" to the admin. **`DiffViewer.tsx`** had existed all along, 538
     lines, wired to the Diff tab.
   - Searched `runMonitorAlertSweep` under `src/` → told the admin the whole
     alerting path was dead code. It is wired in **`server.ts`**, which sits at
     the repo ROOT, not under `src/`.
   - Told the admin the published-app count needed building. The **Publish
     Capacity** card had shown it on the admin Overview since 2026-08-21.

   **THE METHOD, and all four steps are required:**
   1. **Search by FILENAME first** — `find src -iname "*mention*"` finds what a
      content grep for the wrong verb never will. Do this BEFORE concluding.
   2. **Use at least three different names** for the concept: what a user calls
      it, what a developer would call it, and what this repo's existing
      vocabulary would call it.
   3. **Search the WHOLE repo, not just `src/`.** `server.ts`, `scripts/`,
      `infra/` and the workflow files are all live code. A scoped search answers
      a scoped question.
   4. **Treat "Write" reporting `updated` rather than `created` as a STOP.**
      That one word is the last warning before a working file is destroyed, and
      it is the warning I missed.

   And when the search really does come back empty, say **"I could not find it"**
   to the admin — never "it does not exist". The two are different claims and
   only one of them is verified.

7. **If you find lost/uncommitted work from a previous session: audit, don't
   restart.** When resuming after an interruption (e.g. a credit cutoff that
   left work uncommitted), do NOT blindly restart the whole phase from 0.
   First audit the actual committed + verified state (`git log`, `tsc`,
   tests, manual check). Identify ONLY the genuine gap between "what's
   committed and verified" and "what PROGRESS.md claims" — redo just that
   gap. Touching/redoing already-working committed code wastes credit and
   risks reintroducing bugs into code that was already correct.

## Where things live

- **`CLAUDE.md`** (this file) — rules that rarely change. Auto-loaded.
- **`PROGRESS.md`** — living state: current phase, exact resume point, what's
  done, what's next. Changes constantly. Must be read explicitly (not
  auto-loaded) — see safeguard #1, read it but verify it against real git
  state first.
- Never push directly to `main`. Every change goes: branch → commit → push →
  PR. Even documentation-only changes follow this.

## Deployment — how the live site updates (Cloud Run auto-deploy)

The live app runs on **Google Cloud Run** and deploys **automatically on every
merge to `main`** — no manual command needed.

**How it works (simple):** GitHub and Google Cloud Build are connected. When
`main` gets a new commit (e.g. a PR merge), GitHub sends a push webhook to
Cloud Build; the trigger then runs `cloudbuild.yaml` (Docker build → push →
`gcloud run deploy`) and the new code goes live. Expect a **1–2 min delay**
before the build appears in Cloud Build history, then ~3–5 min to finish.

**Deploy facts (for reference):**
- GCP project: `gen-lang-client-0866594388`
- Cloud Build trigger: `75443609-def7-4c9a-92e7-805931f5bf8f` (location `global`),
  fires on **push to `main`**.
- Cloud Run service: `navbharat-ai-prod`, region `asia-southeast1`.
- Pipeline config: `cloudbuild.yaml`. Hosting config: `firebase.json` (Firebase
  project `navbharatai-3395f`).

**So to ship: get the change merged to `main` (branch → PR → green CI → merge).**
The trigger handles the deploy. No `gcloud` access from the Claude session.

**If a merge does NOT deploy (trigger didn't fire):**
1. It's usually just the 1–2 min webhook delay — wait and re-check Cloud Build history.
2. Manual run (from a gcloud-authenticated terminal):
   `gcloud builds triggers run 75443609-def7-4c9a-92e7-805931f5bf8f --branch=main --region=global --project=gen-lang-client-0866594388`
3. Or in console: Cloud Build → Triggers → that trigger → **Run** (branch `main`).
4. If it stopped firing entirely: check the trigger is **Enabled**, event = **Push to a branch** `^main$`, and the **GitHub connection** is live (may need Reconnect).
- A backup `.github/workflows/deploy.yml` exists; it only deploys if repo secrets
  `GCP_PROJECT_ID` + `GCP_SA_KEY` are set (currently NOT set → it skips cleanly).

## Configured Cloud Run environment keys — NAMES ONLY (maintained registry, admin-mandated 2026-07-11)

**Why this exists:** the admin sets env keys in Cloud Run; Claude cannot see Cloud Run. This is the
running record of which key NAMES are configured, so both sides know what exists and never create a
duplicate. **VALUES ARE NEVER WRITTEN HERE — names only** (a value would be a secret leak). **Rule:
whenever the admin says they added a key in Cloud Run, Claude appends its name to the right group
below in that same session** (hand-to-hand, so nothing drifts). Every name below was verified against
the code (it is actually read somewhere) on 2026-07-11.

- **Core / infra:** `NODE_ENV`, `GOOGLE_CLOUD_PROJECT` (GCP/Firestore project = `gen-lang-client-0866594388`),
  `FIREBASE_PROJECT_ID` (the AUTH project `verifyIdToken` checks tokens against — this MUST equal the
  CLIENT's `firebaseConfig.projectId` in `src/config/firebase.ts` = **`gen-lang-client-0866594388`**, the
  SAME value as `GOOGLE_CLOUD_PROJECT` here. ⚠️ `navbharatai-3395f` is ONLY the Firebase **Hosting/CLI**
  project in `.firebaserc` — do NOT put it here; a wrong project makes `verifyIdToken` reject every real
  token → every user silently becomes 'anon' → login broken. Verified against the client config 2026-07-11),
  `FIRESTORE_DATABASE_ID`, `SECRET_ENCRYPTION_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- **AI providers:** `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROK_API_KEY` (code also accepts `XAI_API_KEY`
  — same thing, set only one), `GLM_API_KEY`, `GLM_MODEL`, `KIMI_API_KEY`, `KIMI_MODEL`
  (⚡ KEY POOL, 2026-07-13: `GLM_API_KEY` and `KIMI_API_KEY` now accept a COMMA-separated LIST of keys —
  `GLM_API_KEY=key1,key2,key3` — for 429-rotation. A 429 on one key fails over to the same model on the
  next key before dropping quality. A single key = today's behaviour. Buy the extra keys, then just set the
  comma list — no redeploy logic needed. See ROADMAP Tier-4 "GLM KEY POOL".
  ✅ **LIVE 2026-07-21: the admin SET the GLM comma-pool in Cloud Run** (multiple Z.ai keys) as part of the
  GLM-429-storm response — key rotation is now genuinely active in prod.)
- **Sandbox (E2B):** `E2B_API_KEY`, `E2B_TEMPLATE_ID`, `FULLSTACK_E2B_TEMPLATE_ID`, `E2B_PREVIEW_DOMAIN`
  (⚠️ CORRECTION 2026-08-02: the admin verified in the live Cloud Run console that `E2B_PREVIEW_DOMAIN`
  is **NOT set** — so v5.0 previews use the raw `*.e2b.app` host by code default (`PreviewDomain.ts`
  `DEFAULT_PREVIEW_DOMAIN = 'e2b.app'`), which always resolves. The `mitrify.xyz` branded-preview proxy
  VM `e2b-custom-domain-proxy` (Compute Engine, us-west1-a) was **DELETED for cost** the same day
  (~₹1,350/mo saved). To re-enable branded previews later, set `E2B_PREVIEW_DOMAIN=<wildcard-domain>`
  AND re-provision an E2B custom-domain route for it — do NOT just set the env with no proxy, or preview
  URLs will point at an unresolvable host. This key's earlier listing meant only "the code reads it",
  not "it is set in Cloud Run".)
- **GitHub storage:** `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
  `GITHUB_ORG`, `GITHUB_STORAGE_ENABLED`, `GITHUB_PR_MODE`
- **Payments:** `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` (code also accepts the `CASHFREE_CLIENT_ID` /
  `CASHFREE_CLIENT_SECRET` pair — use ONE pair, not both), `CASHFREE_WEBHOOK_SECRET`
  (✅ **SET in Cloud Run by the admin 2026-08-10** — the third delivery path for a payment is now live;
  see the Payment-recovery entry below, whose "NOT set" warning this supersedes. NOTE for whoever sets
  it next: Cashfree PG has **no separate webhook secret** — the signature is an HMAC-SHA256 over
  `timestamp + rawBody` keyed by the merchant's **Client Secret**, so this value is the SAME string as
  `CASHFREE_SECRET_KEY`. The endpoint itself was already registered at
  `https://navbharatai.com/api/payment/webhook`, webhook version `2023-08-01`, events
  success/failed/refund. To verify it end-to-end, use the Cashfree dashboard's per-endpoint **Test**
  button and read the **Logs** tab: 400 = secret not configured, 401 = wrong value, 200 = working.)
- **Deploy / CDN providers:** `VERCEL_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_ACCOUNT_ID`,
  ⚠️ AUTO-DNS (2026-08-06): `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` now ALSO power the
  managed-DNS zones path (`cloudflareManagedDns.ts` — nameserver delegation, "DNS hum set kar dein").
  For zone creation the token additionally needs **Zone:Edit + DNS:Edit** account-level permissions;
  kill switch `AGENTV3_MANAGED_DNS=off`. Custom-domain master flag: `AGENTV3_FIREBASE_CUSTOM_DOMAINS`
  (admin set it `on` in Cloud Run before 2026-08-06 — the connect flow passed its gate in live use;
  recorded here because it was missing from this registry).
  `RENDER_API_KEY` (admin SET in Cloud Run 2026-08-02 — the separate-BACKEND deploy: NavBharatAI triggers a
  real deploy of the user's Node/Express backend to Render via the Render API, `rnd_…` key. Read by
  `src/server/AgentV3/renderDeploy.ts`. BYO-account model: deploys to the account that owns this key; without
  it the backend-deploy path honestly reports "set RENDER_API_KEY", never a fake deploy.)
- **User-account provisioning (ROADMAP #1 Phase 1 — zero-setup DB/Auth):** `SUPABASE_OAUTH_CLIENT_ID`,
  `SUPABASE_OAUTH_CLIENT_SECRET` (admin SET in Cloud Run 2026-08-04. A **published Supabase OAuth app**
  — `docasheesh-png's Org` → Settings → OAuth Apps → "Publish OAuth app". This is NOT a database
  credential: it is NavBharatAI's platform identity, used ONCE per user to ask *their* Supabase account
  for permission, so we can create a project **inside the user's own account**. That keeps the standing
  rule intact — user apps run on the USER's account and bill, never NavBharatAI's. Callback:
  `https://navbharatai.com/api/integrations/supabase/callback`. Granted scopes: Projects (read+write —
  creates the project), Organizations (read — needs `org_id` to create in), Secrets (read — reads the new
  project's anon key to wire the app), Auth (read+write — Phase 1.3 one-click login), Database (read+write
  — migrations + schema types). Everything else deliberately left at **No access** (smaller consent screen
  = more user trust); Storage can be added when Phase 1.4 needs it. ⚠️ Supabase FREE plan allows only
  **2 projects per org** — a user already at the cap must get an honest "no room in your Supabase account"
  message, never a silent failure.)
- **One-wallet AI spending (shipped 2026-08-04):** `AI_WALLET_SPEND` (`on` makes every
  assistant/tool spend the SAME wallet as a build — see THE ONE-WALLET LAW). Related tunables:
  `AI_TOOL_FREE_DAILY_LIMIT`, `AI_IMAGE_FREE_DAILY_LIMIT`, `AI_IMAGE_PASS_DAILY_LIMIT`.
  ✅ **SET `on` in Cloud Run by the admin 2026-08-08 — the wallet now really moves for Professionals,
  Doctor AI and the Other-AI tools.** Turned on only AFTER the pre-launch audit found and fixed a real
  OVERCHARGE (#2175): the tiered markup was applied PER CALL and then summed, so a multi-call request
  paid the cheap-rate first dollar N times — three $0.50 calls billed $6.00 instead of $5.50, worst on
  the App Debugger, which fans out over file batches. Verified live on `main` before the flag went on.
  Everything else the audit checked was already clean: no double-charge path (zone-billed routes and
  explicitly-billed routes are disjoint), a FAILED action is never charged, an unmeasured provider
  charges ZERO rather than an invented number, an empty wallet is refused BEFORE any provider call, an
  unreadable balance fails OPEN, and the daily rollup is dated on the server clock.
  (Re-confirmed `on` by the admin 2026-08-10.)
- **E2B sandbox cost control (shipped 2026-08-04):** `AGENTV3_SANDBOX_IDLE_MINUTES` (**code default is
  now 5** — see the ⚠️ correction below; it was 15, and before that a hardcoded 45, where a 5-minute build
  was followed by 45 idle billed minutes), `AGENTV3_SANDBOX_TOUCH_MINUTES`
  (default 5 — how often a LIVE build refreshes its durable stamp so the cross-instance orphan reaper can
  tell it apart from an abandoned VM). The reaper reads the DURABLE record, so a sandbox orphaned by a
  Cloud Run instance recycle (i.e. by every deploy) is finally pausable; its cut-off is held a whole
  `AGENTV3_MAX_BUILD_SECONDS` + 10 min past last activity so it can never reach a running build.
- **Sandbox LIFETIME heartbeat — the permanent orphan-window fix (shipped 2026-09-11):**
  `AGENTV3_SANDBOX_LIFETIME_MINUTES` (**code default 6**, clamped 2–60 — how long E2B keeps a sandbox
  RUNNING after the last extension). Read by `src/server/AgentV3/sandboxLifetime.ts`; applied in
  `E2BActuator` (`_opts.timeoutMs`, `_extendLifetime`, `_heartbeatLifetimes`).
  **WHAT CHANGED, in one line: E2B's own per-sandbox timer is now the dead-man switch.** It used to be a
  one-hour constant refreshed on every operation — a backstop nobody expected to fire — so every
  deploy-orphaned machine billed for the full 20-minute reaper window (`reapAfterMs`), and that window
  had to be twenty because the reaper's signal (a stamp refreshed only by SANDBOX OPERATIONS) cannot
  tell a build inside a long model call from an abandoned VM. Now the lifetime is SIX minutes,
  extended by every operation and viewer ping (throttled to one call a minute) and by a TIMER-driven
  heartbeat (every 2 min) while a build flag or an operation is in flight. When nothing extends it,
  E2B pauses the machine itself — whichever instance created it, and even if the service is down.
  The heartbeat dies WITH the instance that owned the build, which is exactly when the machine should
  stop. The durable orphan sweep stays as a second net, unchanged.
  🔒 **WHY A MISSED HEARTBEAT IS SAFE:** the expiry action is `pause` (#2782), never `kill`; a paused
  handle fails with a shape `isDeadSandboxError` already matches (`sandbox … paused`), the corpse is
  dropped and `getSandbox` reconnects by durable id, which resumes the machine with its files. Slower,
  never lost. Do NOT set the lifetime below the idle limit (5 min) without a reason: at 6 the healthy
  path is byte-identical to before (our sweep still pauses first); the change bites only where the
  sweeps could not reach.
  📏 **MEASURE FIRST (shipped 2026-09-11, PR D — adapted from a forwarded external plan, per the
  external-suggestion rule: adopted what the code confirmed, rejected what it contradicted).** Three
  instruments, no behaviour change: (1) **where the minutes go** — every sandbox SESSION now records
  wall-clock, time INSIDE our operations, time idle, op count, what started it and what ended it
  (`sandboxSessions.ts`; on the durable record as `session`; in the build report as `SANDBOX_SESSION`);
  (2) **why machines start** — one Express zone per `/api/agentv3` request names the cause (build /
  preview-door / preview-diagnose / preview-health / publish / files / exec / version-preview /
  visual-edit / other; `unattributed` only outside any request) and every create or resume increments
  that day's counter in `agentv3_sandbox_starts` (`sandboxSessionZone.ts`; the build report's
  SETUP_TIMING line now carries `started-by=`); (3) **peak memory** — read from the machine's own cgroup
  (`memory.peak` v2, else v1, else honestly "not available") LAST in the post-build sequence so the
  browser gates are included, as `SANDBOX_PEAK_MEMORY` beside the template's 4 GB. The admin card
  *Where does a sandbox's billed time go?* shows "Where the minutes go" and "Why machines started".
  🔒 **THE RULE THIS ENFORCES: no RAM change to the template until SANDBOX_PEAK_MEMORY says it fits,
  and no vCPU reduction at all without a measured speed ratio** — RAM is billed per WALL-CLOCK hour, so
  a slower build is a dearer one (break-even ≈ 1.44× slower for halving cores). `infra/e2b/e2b.toml`
  now carries the per-hour price of each size beside its numbers, and matches `build.mjs` (2 vCPU / 4 GB).
  From the same forwarded plan, **rejected with reasons**: "route finished apps through
  `renderPreview.ts`" (PR B already frames the REAL `dist/`, strictly more faithful than a babel
  re-render, and the in-browser tab is that renderer for apps without a copy); "target 1,110 → ~300
  starts" (a guess dressed as a target — the instrument above is what turns it into a number);
  "PR #2818 is done" (it was OPEN and conflicting with `main` at the time — verified, not assumed).
  💵 The plan also reports the admin **set `E2B_USD_PER_HOUR=0.166` in Cloud Run on 2026-09-11** (the
  corrected rate; 0.166 vs the derived 0.1656 is within the 25% mismatch tolerance, so the Monitor's
  amber warning clears). Recorded from the forwarded plan, not from a direct message — re-confirm on the
  Monitor tile before relying on it.
  ➕ **`AGENTV3_SNAPSHOT_IDLE_MINUTES` (shipped 2026-09-11, PR B — code default 3, floor 3, never above
  the ordinary idle limit).** The idle window the sweep applies to a workspace whose SAVED COPY IS
  CURRENT. The dist-copy pipeline already existed (`previewSnapshot.ts`: a green build's real `dist/`
  on its own Hosting channel; `snapshotServeDecision.ts`: the health poll stops touching the machine
  and frames the copy) — what PR B added is (1) the build stream's `snapshot` event, so the surface
  frames the copy the moment the build settles instead of on the next 150 s poll, and (2) a per-
  workspace idle window (`idleLimitFor` in `sandboxLifetime.ts`) that lets such a machine sleep at
  3 min instead of 5. The flag is raised by the route when the copy is saved and CLEARED by the
  actuator on every write (text, binary, restore) and when a build starts — so a heal pass that
  changes a file after the copy can never leave a stale copy counted as current. Floor 3 min because
  the frame must have left the machine before it is paused: one poll (150 s) plus a sweep tick. This
  is the "user ko live e2b nahi, bas copy" decision; the UI consolidation (one pane, Live on demand)
  is a separate, later change — the two tabs still exist.
  📏 **THE MEASUREMENT IS NOW VISIBLE:** every sweep pause writes `pausedBy` on the durable record
  (`idle-sweep` / `orphan-sweep`); the admin Reports → *Where does a sandbox's billed time go?* card
  shows "Who stopped them", with `provider / unknown` for machines we never stamped (E2B's own timer).
  A rising provider share after this date is the six-minute lifetime doing the reaping — the number
  the 20-minute window was only ever assumed from. Expected bill effect: ~29 → ~15 min per sandbox
  (~$88 → ~$46/month at today's volume); re-measure on the E2B dashboard before quoting it.
  🖼️ **ONE PREVIEW PANE + the copy's identity by CONTENT (shipped 2026-09-11, PR C).** The two preview
  tabs are gone: `previewSource.ts` picks the best FREE source (the saved copy of the last green build
  when it is current and no build runs → else the instant in-browser render) and the paid live server is
  only ever an explicit press. **The fact that made it possible, and the bug it exposed:** the build's
  FINAL durable save runs AFTER `saveSnapshot` and rewrites `savedAt`, so every clock rule of the form
  "no write since the copy" was FALSE for the very build that produced the copy — the door's
  show-the-copy-while-waking path (2026-09-08) had never fired. `snapshotIdentity.ts` records the hash of
  the source the copy was built from (`snapshotFilesHash` on the sandbox record), the final save compares
  it with what was PERSISTED and re-stamps the copy to after the save on a match, and ONE helper
  (`currentSnapshotFor` in `routes/agentv3.ts`) answers the health probe and the in-browser preview alike.
  ⚠️ Do not add a second "is the copy current?" rule anywhere — ask that helper. And do not move the
  `snapshot` stream event back to save time: it belongs after the confirmation, or a stale copy gets
  announced as the app.
- **📊 WHAT E2B ACTUALLY COSTS — measured, not estimated (admin's own dashboard, 2026-08-11).** The
  knobs above are worth real money, so here is the money. Billing window Jul 14 – Aug 13 2026 (30 days),
  read off the E2B usage dashboard: **1,260 sandboxes started/resumed · 2,078.29 vCPU-hours ·
  4,156.57 RAM-hours · $172.08 total**.
  - **A running sandbox costs ~$0.083/hour (~₹7).** Derived: $172.08 ÷ 2,078.29 vCPU-hours. RAM-hours ÷
    vCPU-hours is **exactly 2.0**, so every sandbox is **1 vCPU + 2 GB**, and $0.083 matches E2B's
    published per-vCPU + per-GB rates almost to the cent — which is what makes this a measurement rather
    than a guess.
  - 🔴 **CORRECTION 2026-09-11 — THAT PARAGRAPH IS WRONG, AND THE WRONG STEP IS THE ONE THAT SOUNDS
    MOST RIGOROUS.** `$172.08 ÷ 2,078.29 vCPU-hours` is a price per **vCPU**-hour. The leap to "so every
    sandbox is 1 vCPU + 2 GB" does not follow: a RAM-to-vCPU ratio of 2.0 pins a sandbox's **shape**, not
    its **size**, and is equally true of **2 vCPU + 4 GB** — which is what `infra/e2b/build.mjs` actually
    builds (`cpuCount: 2, memoryMB: 4096`) and what every row of the admin's own Sandboxes console reads
    ("2 Core / 4.0 GB"). ⚠️ `infra/e2b/e2b.toml` says 4 vCPU and is **LEGACY, read by nothing** — v2
    builds from `build.mjs`.
    **THE REAL NUMBER: a running sandbox costs $0.1656/hour (~₹14), not $0.083.** Verified the way the
    original never was — E2B's published per-resource prices reproduce BOTH billing windows to the cent:
    `2,078.29 × $0.0504 + 4,156.57 × $0.0162 = $172.08` and `1,064.36 × $0.0504 + 2,128.72 × $0.0162 =
    $88.13`. Two windows, zero cents of error, same two constants.
    **What follows from it, all of it half of what this file used to say:** August was **1,039 wall-hours,
    ~49.5 min per sandbox** (not 1.65 h); Aug 12 – Sep 11 was **532 wall-hours, ~28.8 min per sandbox**.
    The per-sandbox time genuinely halved — the idle 15 → 5 change worked — but every wall-clock figure
    above is 2× too long and every hour-rate 2× too cheap.
    🔒 **THE LESSON, and it is not "check your arithmetic": "not invented" is a weaker standard than
    "checked".** The original derivation was honestly sourced from a real dashboard and still wrong,
    because it contained a step that could not fail. A derivation is only verified once it predicts
    something it could have got wrong — which is why the constants now live in
    `src/server/AgentV3/sandboxRate.ts` as named per-resource prices reconciled against two invoices,
    rather than as one blended number that nothing can contradict.
  - Per sandbox: **~$0.137** (they average 1.65 hours each). Whole-clock burn: **~$0.24/hour**, i.e.
    ~$5.70/day, ~$172/month (**~₹15,000/month** at ~₹87/$).
  - **🔑 THE BILL IS RUNNING TIME, NOT BUILDS.** A build that finishes in 5 minutes and then leaves the
    VM warm is charged for the warm minutes too. That is why `AGENTV3_SANDBOX_IDLE_MINUTES` is the
    single biggest cost lever in this file, and why the 45 → 15 change was not a tidy-up: at 1,260
    sandboxes, 45 idle minutes each is 945 billed hours (**~$78/month**) versus 315 hours (**~$26**) at
    15. That one default is saving roughly **₹4,500/month**.
    ⚠️ **THE CURRENT DEFAULT IS 5, NOT 15 — see the correction immediately below.** The 45/15 figures
    here are the HISTORY of the lever, not its present setting, and this line says so because reading
    only this paragraph is exactly how a session (mine, 2026-08-22) came away believing the file was
    stale when the very next bullet already had it right. At 5 minutes the idle total is ~105 hours
    (**~$8.70/month**), i.e. the lever is now spent.
  - ⚠️ **CORRECTION 2026-08-21 — THIS LEVER WAS TAKEN, AND THIS FILE DID NOT SAY SO FOR EIGHT DAYS.**
    The lines above used to read "Remaining lever, NOT taken (admin's call): 15 → 5 idle minutes would
    save a further ~$17/month (~₹1,500)". A session took it on **2026-08-13** with admin approval —
    `idleLimitMs()` in `sandboxReaper.ts` now defaults to **5 minutes**, saving that ~₹1,500/month — and
    updated the code comment but not this registry. **Why the drift was dangerous rather than untidy:** a
    later session reading "NOT taken, admin's call" would either re-propose a change already shipped, or
    "restore" the default to 15 believing 5 was a slip — quietly putting ₹1,500/month back on the bill
    with nothing failing to show it.
    **WHAT MAKES 5 MINUTES SAFE, and the thing not to break:** idle is measured from the last SANDBOX
    operation, and a long model call is not one — while the AI thinks, nothing touches the sandbox, so at
    five minutes that silence would look exactly like an abandoned session. The sweep is BUILD-AWARE: it
    skips workspaces with a build in flight (`E2BActuator.setBuildActive`), so it can only ever pause a
    sandbox nobody is building in. **Do not lower this further without first confirming that hold still
    exists.** The accepted trade: a user returning after six minutes meets a PAUSED sandbox and waits
    through a resume — slower, never lost, since it resumes by id with its files.
    General lesson, since this is the second doc-vs-code drift found this month: **anything this file
    asserts about a DEFAULT must be re-grepped against current `main` before being acted on.**
  - ⚠️ **This is ONE 30-day snapshot, not a forecast.** Cost scales with concurrent build hours, so it
    moves with usage. To recompute: E2B dashboard → Billing → Usage; per-hour = cost ÷ vCPU-hours.
    Re-measure before quoting these numbers as current.
- **Sandbox-time billing — NOW LIVE (admin SET both in Cloud Run 2026-08-13):** `AGENTV3_BILL_SANDBOX` and
  `E2B_USD_PER_HOUR`. ✅ **`AGENTV3_BILL_SANDBOX=on`** + ✅ **`E2B_USD_PER_HOUR=0.083`** together turn on
  charging the user for the REAL E2B VM time their build actually held — the *measured* sandbox seconds ×
  the admin's *real* rate.
  🔴 **THE VALUE IS HALF THE TRUTH AND MUST BE CHANGED: set `E2B_USD_PER_HOUR=0.1656`** (see the
  CORRECTION 2026-09-11 above). `0.083` is the price of a **vCPU**-hour and the builder template is
  **2 vCPU**, so a wall-clock hour costs twice that. **Nobody was over-charged — the error runs the
  safe way**: paid builds recovered only ~50% of their VM cost and NavBharatAI absorbed the rest, so
  there is nothing to refund. What it did break is the admin's own cost dashboard, which showed **half
  the real rupees** on the exact panel used to judge E2B spend. Since 2026-09-11 the code no longer
  prices silently: `sandboxRate.ts` derives the rate from the template's real size, and a configured
  rate that contradicts the machine raises an amber warning on the Monitor and in the admin build
  report naming both numbers and the value to set. ⚠️ **An env value still beats the code**, so the
  warning is all the code can do — the fix itself is this one Cloud Run value.
  (Historical note: the old text called $0.083 "exactly the measured rate from the E2B cost analysis
  above", which is why it went unquestioned for a month.)
  included in the build's real cost BEFORE markup (`sandboxCost.ts` → `sandboxBillableUsd`). This is honest
  by construction — a clock times a stated price, never an estimate. ⚠️ **BOTH are required together:**
  with `AGENTV3_BILL_SANDBOX=on` but `E2B_USD_PER_HOUR` unset, the code bills **ZERO** (it refuses to charge
  the $0.10 placeholder — inventing a cost is exactly what the billing law forbids); with the rate set but
  the flag off, the sandbox cost is absorbed by NavBharatAI and only shown in the ADMIN report. So a build
  now recovers its VM cost, closing the old loss where a low-token build that held a VM for 40 min was pure
  loss. (Values noted because they are non-secret config, not credentials — same as the other toggles here.)
- **Auto-fix vulnerable dependencies — NOW LIVE (admin SET in Cloud Run 2026-08-13):** ✅
  **`AGENTV3_AUDIT_FIX=on`** runs `npm audit fix` during a build to apply npm's COMPATIBLE security fixes to
  vulnerable dependencies (`npmAuditFix.ts`) — it does NOT upgrade across a major version, so it cannot
  change how the app behaves. This directly addresses the "1 vulnerable dep(s)" advisory seen on real game
  builds. When OFF (default), a build that ships with high/critical vulns says so honestly and points at
  this flag; when ON, the compatible fixes are applied automatically before ship. Never blocks a build.
- **Adversarial robustness testing — NOW LIVE (admin SET in Cloud Run 2026-09-07):** ✅
  **`AGENTV3_REDTEAM=on`** turns on the RED-TEAM pass (`FuzzProbe.ts`; Immune System Phase 3 / GA-17).
  After a build renders, it drives a real browser to type HOSTILE values into the app's OWN inputs —
  empty, oversized, injection-shaped, malformed numbers — and watches for a CRASH (uncaught error,
  React error boundary, unhandled rejection), recorded as a `FUZZ_ROBUSTNESS` finding.
  **WHY IT WAS WORTH TURNING ON: the happy-path preview check only ever proves the app renders on GOOD
  input.** A crash on hostile input is a real bug that reaches the user and that no other gate looks
  for. The rest of the post-build suite reads code or checks that the app loads; this is the only one
  that tries to break it.
  **It costs no model call.** The fuzzing is browser automation, so a clean build pays nothing extra —
  which is why it was the one flag recommended while the admin was asking to REDUCE spend, and why
  `AGENTV3_REVIEW_FASTLANE` was recommended AGAINST in the same breath (that one adds 3-6 model calls
  and 30-90s to every simple build, for a reviewer that already runs on the complex ones where it earns
  its keep). Bounded by construction: **12 cases max, 90-second wall clock**, abortable, and skipped
  entirely unless ≥2 minutes of build budget remain. It can never block, fail or hang a build.
  ⚠️ **REPAIR IS A SEPARATE, ALREADY-ON SWITCH.** The red-team only RECORDS findings on its own; the
  bounded repair pass that hardens them rides `AGENTV3_FEATURE_HEAL`, which is `on` at
  `AGENTV3_FEATURE_HEAL_PCT=20`. So today ~20% of builds get the fix and the rest get an honest
  finding. Widening the heal percentage therefore widens this too — one number, two behaviours, same
  as the vaccine repair budget noted in that flag's own entry.
  **What to watch:** `FUZZ_ROBUSTNESS` findings in the admin build report. A build that suddenly takes
  ~90s longer at the very end is this pass; unset the key to revert instantly.
- **Payment recovery (shipped 2026-08-04):** `PAYMENT_RECONCILE_MIN_AGE_MINUTES` (2),
  `PAYMENT_RECONCILE_MAX_AGE_DAYS` (7), `PAYMENT_RECONCILE_MAX_ORDERS` (5). On sign-in the server settles
  the user's own unfinished orders against Cashfree. ⚠️ CORRECTION 2026-08-10: this entry used to say
  `CASHFREE_WEBHOOK_SECRET` is **NOT** set — **the admin SET it in Cloud Run on 2026-08-10**, so all
  THREE delivery paths (webhook → redirect → reconcile-on-sign-in) are now live. Do not reason from the
  old "webhooks are all rejected" premise. This reconcile path stays the safety net and must NOT be
  removed now that the webhook works: the webhook is a *speed* upgrade (credit in seconds instead of on
  the user's next visit), while reconcile is what guarantees a UPI payer who never returns to the app is
  still credited — three independent paths to a user's money is the point, not redundancy to prune.
- **Flipped ON by the admin 2026-08-08 (all four audited against live code first — see `ROADMAP.md` §0):**
  `AGENTV3_PARALLEL_BUILD` (frontend + backend build concurrently; ONE `parallelBuild` value drives the
  per-path write lock, the dispatch decision AND the architect prompt, so "parallel on, lock off" cannot
  exist, and sub-agents share the same locked actuator) · `AGENTV3_WEAK_CHECKPOINT` (every 20 steps on a
  weak build, the DETERMINISTIC readiness scan steers only on the two completeness-independent blockers;
  no LLM call, so no cost; max 2 nudges from step 15) · `AGENTV3_VACCINE` (after a successful build the
  platform RUNS the app's own test suite and reports honest pass/fail, so a green build whose tests fail
  can never be called verified; a shell command, NOT a model call — its repair budget only opens if
  `AGENTV3_FEATURE_HEAL` is also on, ⚠️ **which it now IS: the admin set `AGENTV3_FEATURE_HEAL=on` with
  `AGENTV3_FEATURE_HEAL_PCT=20` on 2026-08-13, so the vaccine's repair budget is OPEN for that same 20%
  cohort** — see the entry below) · `AGENTV3_DEPHEALTH_GATE` (CVE + copyleft advisory
  appended to an already-successful build; cannot block or fail one).
  ⚠️ **What to watch on the first real builds:** parallel build is the only one that changes HOW a build
  runs — its speedup is unmeasured and needs a real large multi-file build to judge. The other three are
  advisory or deterministic and cannot fail a build. Any of them reverts instantly by unsetting it.
- **Flipped ON by the admin 2026-08-13 (audited against live code the same session):**
  `AGENTV3_FEATURE_HEAL` = `on` with `AGENTV3_FEATURE_HEAL_PCT` = `20`, and `AGENTV3_DESIGN_GATE` = `on`.
  - **`AGENTV3_FEATURE_HEAL` — the closed loop on "the app renders but the control the user asked for is
    not there".** Slice 1 only RECORDED a `FEATURE_COVERAGE` finding; `on` runs ONE bounded heal pass that
    adds the missing UI and then RE-OPENS the running app to re-probe, so only a control genuinely in the
    live DOM counts as fixed. It spends an EXTRA model pass (real cost, billed on a paid build), which is
    exactly why it was opt-in. It can never block or fail a build, and `verifyAfterFix` wraps it: a heal
    that adds the control but breaks the render is REVERTED to the green snapshot rather than shipped.
    If the control still is not there afterwards, the honest pre-heal warning stands.
  - **`AGENTV3_FEATURE_HEAL_PCT=20` is a real canary and is wired correctly.** All THREE call sites
    (`routes/agentv3.ts` ~10931 feature heal, ~11369 the vaccine repair budget, ~11557) pass `workspaceId`
    as the rollout key, so a workspace is entirely IN or entirely OUT — never healed on one pass and not
    another. ⚠️ Note the middle one: turning this flag on is ALSO what opens `AGENTV3_VACCINE`'s repair
    budget (`vaxHealMax = featureHealEnabled(workspaceId) ? 1 : 0`), for the same 20%. That is a second
    behaviour change riding one flag, and it is intended — just not obvious from the flag's name.
    ⚠️ **CLEARING the PCT key still means 100%, not 0** — a flag that is `on` with no percentage is a
    full rollout, exactly like every other flag here. So **deleting the key to "pause" the canary would
    ramp it to EVERYONE instead.** To pause it, set `AGENTV3_FEATURE_HEAL_PCT=0` (a real, supported
    value), or unset the master flag `AGENTV3_FEATURE_HEAL`.
    ✅ **FIXED 2026-08-21 — a MALFORMED value no longer means 100%.** It used to: `Number('20%')` is
    NaN, so a trailing percent sign — the single most likely thing to type into a field called PCT —
    silently rolled the feature out to every build and billed an extra model pass on each one. Now
    `parseRolloutPercent` accepts the forms an operator actually types (`20%`, ` 20 `, `20.0`), and
    anything still unreadable is treated as **0% with a loud server log** rather than as everyone —
    the reasoning being that someone who wanted 100% would leave it blank, so a value that is present
    and unreadable can never have meant 100%. Same fix covers `AGENTV3_ESCALATION_PCT` and
    `AGENTV3_VACCINE_PCT` (one shared parser).
  - **`AGENTV3_DESIGN_GATE`** — see its own entry below. Detection was already running and free; `on`
    adds ONE bounded repair pass naming only the offending pages, and reports `DESIGN_HEALED` or,
    honestly, `DESIGN_PARTIALLY_HEALED`. It can never fail a build.
  - **What to watch:** both new flags spend an extra model pass on the builds they fire for, so the thing
    to compare is per-build cost and duration for the 20% cohort against the other 80% — the same
    in-vs-out comparison `escalationCohort` exists for. Either reverts instantly by unsetting it.
- **Android update notice (added 2026-08-11, admin sets after each Play upload):**
  `ANDROID_LATEST_VERSION_CODE` (the versionCode of the build now live on Play — the android-aab
  workflow stamps each build with the CI run number, so this is that number), `ANDROID_LATEST_VERSION_NAME`
  (optional, shown in the message), `ANDROID_MIN_VERSION_CODE` (⚠️ FORCES an update for builds below it —
  deliberately a SEPARATE key from the release number, because blocking someone out of an app they already
  installed must be a decision, never a side effect of shipping; leave UNSET on a routine release),
  `ANDROID_STORE_URL` (optional override of the Play listing).
  **UNSET is safe by construction:** `/api/app-version` then returns a null versionCode and the client
  treats an unknown as "no update", so a misconfiguration shows NOTHING rather than a false prompt.
  Automating this needs a Play Developer service account, which this project does not have — until then
  one number is set by hand after each upload, and that is stated plainly rather than pretended away.
  ✅ **UPDATED by the admin 2026-09-26: `ANDROID_LATEST_VERSION_CODE = 134`** — the live referral preflight
  read the env back as **134** (the admin said "133" in chat; the running server's value is the ground
  truth). Set as part of turning the referral ladder on; the preflight compares this against
  `FIRST_RELEASE_WITH_DEVICE_PLUGIN = 117` to confirm the live app can device-attest — 134 ≥ 117 ✓, so the
  release row is green either way. Recorded hand-to-hand the same session.
  ✅ **SET by the admin 2026-08-25: `ANDROID_LATEST_VERSION_CODE = 91`** — the first PRODUCTION release.
  Verified against the pipeline rather than taken on trust: `android-aab.yml` sets
  `ANDROID_VERSION_CODE: ${{ github.run_number }}`, the run was **#91**, and Play displayed
  `91 (1.0.91)`. Three independent statements of the same number.
  ⚠️ **SET WHILE THE RELEASE IS STILL IN GOOGLE'S REVIEW**, which is safe here for a reason worth
  recording rather than re-deriving: production was **Inactive** — NavBharatAI has never had an Android
  build on any public track — so there is no installed base to prompt. `shouldPromptUpdate` needs the
  RUNNING build's own versionCode to compare against, and only a native shell has one; a web user is
  never prompted at all. The number therefore reaches nobody until the review passes and someone
  installs 91, by which point it is exactly right.
  🔴 **THE RULE THIS ESTABLISHES, for every LATER release:** setting this key BEFORE the new build is
  actually downloadable on Play would point real users at a store page still showing the version they
  already have — the precise false-positive `appUpdate.ts` names as the way this feature becomes
  hated. From release #2 onward: **upload → wait for Play to say live → then set the number.** The
  first release is the only one where the order does not matter.
- **AgentV3 controls:** `AGENTV3_ENABLED`, `AGENTV3_PAID_PUBLIC`, `AGENTV3_CREDIT_GATE`, `AGENTV3_CHEAP_FLOOR`,
  `AGENTV3_ESCALATION`, `AGENTV3_ESCALATION_PCT`, `AGENTV3_BLUEPRINT`, `AGENTV3_SANDBOX_RESUME`,
  `AGENTV3_MAX_BUILD_SECONDS`, `AGENTV3_FREE_LIST` (the 3 test/admin emails kept free),
  `AGENTV3_LINT_GATE` (set `on` by the admin 2026-07-11 — a build fails on real ESLint **errors**;
  warnings/formatting never block. Set to `off`/unset to disable if it ever over-blocks a working app.),
  `AGENTV3_COST_ROUTING` + `AGENTV3_COST_ROUTING_USERS` (set `on`, canary → `aashishcpmt09@gmail.com`, by the
  admin 2026-07-12 — the free-tier cheap-routing master switch, live for the admin's account only for now),
  `AGENTV3_INTEGRITY_GATE` (`on`, canary — see the values section below),
  `AGENTV3_AUTOFIX` (set `on` by the admin 2026-07-19 — turns on the post-build **runtime-error auto-fix
  loop**: after a build that renders, captured browser console errors feed a bounded repair pass (default
  **1** attempt, `AGENTV3_AUTOFIX_ATTEMPTS` caps at 3). It runs an EXTRA LLM pass, so it only fires when
  runtime errors are actually detected — a clean build costs nothing extra. Model follows the routing
  policy: free/weak = GLM/Kimi cheap coders, **no Sonnet/Opus**; paid = Claude-first (Sonnet); Opus tiers
  = Opus. Paid builds bill the extra pass to the user. Never blocks a build; records an honest
  RUNTIME_VERIFIED / RUNTIME_UNCHECKED / RUNTIME_ERRORS_REMAIN verdict (#1596). Set `off`/unset to disable.),
  `AGENTV3_REQUIREMENT_AWARE` (set `on` by the admin 2026-07-20 — turns on **requirement-aware building**:
  on a FRESH build of an ambiguous DOMAIN prompt, the engine proactively INCLUDES the features that domain
  almost always needs but the prompt left implicit (RBAC/audit/EMR for a hospital, menu/KOT/GST for a
  restaurant, …), so a rich request never yields a shallow app. FRICTION-FREE — NO clarifying round-trip
  (honours the "text reply > build app" rule). Only fires for a new build (never an edit) of a detected
  domain with genuine gaps; the analyzer covers healthcare/ecommerce/social/saas/booking/education/logistics/
  restaurant. The same analysis is also recorded in the admin build report (code `REQUIREMENT_GAPS`, #1692).
  Flag off ⇒ build prompt byte-identical to today. Pure decision in `RequirementGapAnalyzer.ts`; PRs #1692/
  #1695/#1697. Set `off`/unset to disable.),
  `AGENTV3_RATE_PACER` (set `on` by the admin 2026-07-21, GLM-429-storm response — wakes the PROACTIVE
  per-provider token-bucket + AIMD adaptive-concurrency pacer (`RateLimitPacer.ts`, built 2026-07-18 but
  default-OFF until now): calls are paced UNDER each provider's rate so most 429s never happen, and a
  429/timeout HALVES concurrency (recovers, then ramps back). Tunables: `AGENTV3_PACER_RATE_PER_SEC` (8),
  `AGENTV3_PACER_BURST` (8), `AGENTV3_PACER_MIN_CONCURRENCY` (2), `AGENTV3_PACER_MAX_CONCURRENCY` (8).
  Set `off`/unset to disable. Works WITH the reactive stack: escalating 429 re-probe bench (#1801),
  GLM↔KIMI floor balance (#1802, kill switch `AGENTV3_FLOOR_BALANCE=off`), circuit breaker
  (`AGENTV3_CIRCUIT_BREAKER`, default on), and the GLM key-pool.)
- **🟩 NVIDIA Nemotron 3 — judge, plan and ONE backstop rung (built 2026-09-19).** ✅ **LIVE: the admin
  SET `NEMOTRON_API_KEY` and `AGENTV3_NEMOTRON=weak` in Cloud Run on 2026-09-19**, the same day it
  merged — so the WEAK tier's judge and plan are the first Nemotron calls this platform has ever made,
  and Normal/Strong are untouched until that flag names them.
  ✅ **THE HOST IS SET: `NEMOTRON_BASE_URL = https://integrate.api.nvidia.com/v1`** (admin, 2026-09-19,
  same day). The key was bought at **`build.nvidia.com`** — NVIDIA's OWN endpoint, not OpenRouter — so
  the code default (`https://openrouter.ai/api/v1`) was wrong for it and the judge was silently off for
  the hour between the key being set and this value being added. The model ids need NO override:
  NVIDIA spells them `nvidia/nemotron-3-ultra-550b-a55b` too, which is already the code default.
  ⚠️ **FOR WHOEVER CHANGES HOST LATER:** Together AI is `https://api.together.xyz/v1`, OpenRouter is
  the unset default. A wrong host does not error anywhere the operator can see — the judge call throws
  and is swallowed — so **verify POSITIVELY by finding `NEMOTRON` in a Weak build's per-call log,
  never by the absence of an error.**
  🔴 **THE MODEL ID IS AN OPEN CONTRADICTION INSIDE THIS REPO, AND IT IS THE FIRST THING TO CHECK IF
  NEMOTRON "DOES NOT WORK" (admin 2026-09-20: *"nvidia nahi chal rah hai … kya problem hai? kaha?"*).**
  The line above says NVIDIA spells the ids the same as OpenRouter, so no override is needed.
  **`nemotron.ts`'s own docblock says the opposite, in as many words:** *"a Nemotron id is spelled
  DIFFERENTLY by each host that serves it (OpenRouter and Together use the `nvidia/…` form, **Bedrock
  and NVIDIA's own endpoint do not**)"*. Both cannot be true, and the key was bought at
  `build.nvidia.com` — NVIDIA's own endpoint. If the code's comment is the right one, every judge and
  plan call is a **404 on a model name**, silently. ⚠️ **Nobody has verified it against the live
  endpoint**: a Claude session cannot (outbound to `integrate.api.nvidia.com` is refused by the
  execution environment's egress policy — tried 2026-09-20, `connect_rejected`), and the admin's
  console is the only place that can. **`NEMOTRON_ULTRA_MODEL` / `NEMOTRON_SUPER_MODEL` are the
  no-deploy correction** the moment NVIDIA's own model list gives the real spelling.
  ⚠️ **AND THE SECOND CANDIDATE COSTS CREDITS WHILE LOOKING IDENTICAL:** Nemotron 3 is a REASONING
  model and the judge is called with `maxTokens: 1500`. This repo has already been bitten twice by
  exactly that (`glm-5.3`, `kimi-k2.7-code` — both in `MEASURED_ALWAYS_REASONS`): the thinking
  consumes the whole output allowance and the content comes back EMPTY. A 404 spends nothing; an
  empty answer spends the call. **NVIDIA's own usage dashboard separates the two in one glance** —
  requests arriving and succeeding ⇒ the empty-answer case; arriving and erroring ⇒ the id or the
  key; none arriving ⇒ our own gating.
  ✅ **WHAT WAS FIXED 2026-09-20 (PR after this note): the platform can now SAY which.** Until then it
  structurally could not — see the judge-chain entry below.
  💳 **IT IS A TRIAL POOL, NOT A PLAN — 1,000 free credits (5,000 with a business email), 40 req/min.**
  The admin was told and chose it deliberately (*"abhi free wali/low cost wali use karoge"*). Those
  credits WILL run out — "when", not "if" — and **how many builds they buy is genuinely unknown**:
  NVIDIA does not publish per-request credit cost, and Ultra is a large model. Do not estimate it.
  ⚠️ **CORRECTED 2026-09-20 — THE SENTENCE HERE CLAIMED A VISIBILITY THAT DID NOT EXIST.** It read
  *"Since 2026-09-19 the day it happens is VISIBLE (`CHEAP_REVIEW_NOT_RUN` in the build report)"*.
  **There has never been a `CHEAP_REVIEW_NOT_RUN` code anywhere in this repo** — a grep of `src/`
  returns the doc line and nothing else. The day the credits ran out would have appeared as a *passing
  review*, which is precisely what that sentence promised it would not. The lesson is this file's own:
  **a doc's claim about the code must be re-grepped, never trusted** — and an aspirational sentence
  written in the past tense is the most dangerous shape it can take.
  ✅ **AND THE FAIL-OPEN IS NOW CLOSED (2026-09-20).** That entry recorded it as an open root cause and
  said *"the honest fix is a THIRD outcome"* — which is exactly what shipped: `JudgeVerdict.reviewed`
  plus `describeJudgeVerdict`, so a judge that could not run is recorded as **`NOT RUN`, at WARNING
  severity, with its own explanation attached** — inside the existing `CHEAP_REVIEW` line, not as a new
  code. It is not a Nemotron problem and never was: `glm-5.3`, Grok and Sonnet all had it. Build
  behaviour is unchanged — a judge outage still never blocks a build; only the record stopped lying.
  `NEMOTRON_API_KEY` (the plan's token — **nothing runs without it**), `AGENTV3_NEMOTRON` (the
  role/tier gate — ⚠️ **unset means the judge and plan are OFF even with a key**; takes `off` as a HARD
  kill that removes the ladder rung too, `on` for every tier, or a comma list of tiers: `weak` / `free`,
  `normal` / `economy`, `strong` / `premium`), `NEMOTRON_BASE_URL` (default OpenRouter),
  `NEMOTRON_ULTRA_MODEL` / `NEMOTRON_SUPER_MODEL` (the ids — **each host spells them differently**, so
  set these to match whichever plan is bought), and the rate lines `RATE_NEMOTRON_ULTRA_IN` / `_OUT` /
  `RATE_NEMOTRON_SUPER_IN` / `_OUT`. Read by `src/server/AgentV3/nemotron.ts`.
  🔴 **WHY IT IS NOT A BUILD RUNG, AND THIS INVERTS THE STICKER PRICE.** Super ($0.085/$0.40) looks
  cheaper than the lead rung `glm-4.7-flashx` ($0.07/$0.40) and **for us it is not**: the route does not
  honour prompt-cache markers (OpenRouter → DeepInfra, ~0.2% global cache-hit rate), while our builds are
  **91–94% cache-read** (measured: 1,427,968 of 1,520,722 input tokens on build b6f88a72). FlashX charges
  $0.01/MTok for that share; Nemotron charges full input rate. On the architect slice that is $0.0083 vs
  $0.0426 — **6.2× DEARER**. Never put it on a cached tool loop.
  🔑 **WHERE IT PAYS, and the same arithmetic found it: the JUDGE is 78% of a cheap-lead build's real
  cost** ($0.0915 of $0.1176) because it is the one slice the cache cannot rescue. Ultra does it at
  $0.50/MTok in against glm-5.3's $1.40. The judge runner sends system + messages and reads back TEXT —
  **no tools** — so it is also the safest slot for a vendor whose tool-calling is unmeasured here.
  🔒 **Super sits IN FRONT of the Claude backstop on Weak/Normal, never in place of it** (Haiku still
  last on Weak, Sonnet on Normal); **Strong is untouched**; Nemotron is the lead rung of no tier.
  🔴 **STRONG NEVER TAKES THE PLAN RUNG, whatever the flag says** (admin 2026-09-19). `on` reaches
  Strong's JUDGE but not its PLAN: a judge delivers a verdict on a finished app, a plan decides the
  app's whole shape before a line is written, and Strong is the tier somebody paid premium for. It is
  a FLOOR (`PLAN_FORBIDDEN_TIERS`), not a default — no env value lifts it.
  📋 **What a key alone does, which is almost nothing:** with `NEMOTRON_API_KEY` set and the flag
  unset, ONLY the Super backstop rung on Weak/Normal activates — reached solely when the three rungs
  above it have failed. Judge and plan stay exactly as they are (`glm-5.3` / `glm-4.7-flashx`).
  ⛔ **NOT for free chat, Professional/Doctor AI or the image generator today** (asked 2026-09-19).
  The image generator is impossible at any price — Nemotron 3 is text-only. Free chat is affordable
  (`allowedOnFreeTier` clears both sizes: Super index 1.85, Ultra 6.20, ceiling 11.60) and would add
  the independent fourth vendor that ladder lacks, but there is no Nemotron provider in
  `src/server/AI/Router/providers/`, so it is a build, not config — and it should wait until the
  build-engine judge has produced real evidence. Professional on a **`:free` endpoint is refused on
  privacy**, not cost: those terms allow training, and that surface carries symptoms.
  ⛔ **Deliberately NOWHERE:** architect, sub-agents, reviewer, heals (cached tool loops); **vision**
  (Nemotron 3 is text-only); the **guards** (deterministic code at ₹0); the cheap intent classifier
  (free today) — so **Nemotron 3 Nano is on no list at all**.
  ⚠️ **Rate defaults are the DEARER readings on purpose** (Super at Bedrock's $0.15/$0.65, and **no cache
  line**, which is the truth for this route). An over-stated rate inflates only our own report; an
  under-stated one eats margin silently on every build.
  ⚠️ **NOT ONE CALL has been made against a real endpoint**, and **judge QUALITY is unmeasured** — a weak
  judge passes a broken app quietly and no cost panel shows it. Rollout: set `AGENTV3_NEMOTRON=weak`
  first (the tier NavBharatAI pays for itself), read the verdicts on the first builds, then widen.
  **What to watch:** `NEMOTRON` in the admin build report's per-call log, and whether judged builds still
  fail their gate as often as before.
- **🆓 THE FREE CHAT LADDER — three vendors, cheapest-first (admin-decided 2026-09-15):**
  `GLM glm-4.7-flash (₹0)` → `Vertex gemini-2.5-flash-lite` → `OpenAI gpt-5-nano` → `Vertex
  gemini-2.5-flash`. The Gemini-DIRECT door and the `glm-4.7` last rung were removed. **The gain is
  VENDOR COUNT:** the old ladder spent six registrations on TWO vendors, so the fallback was mostly
  Google falling back to itself, and its one non-Google rung shared a KEY with the free leader (so it
  died in the same 429 storm). Env keys: **`OPENAI_CHAT_MODEL`** (overrides the pinned id — the
  default `gpt-5-nano` could not be verified against the account, and a wrong id 404s and falls
  through SILENTLY, so this is the no-deploy correction; a non-nano value warns, because the ceiling
  was cleared on the nano price) and `OPENAI_CHAT_TIMEOUT_MS` (20 s, same reasoning as the GLM leader).
  ⚠️ **Provider `src/server/AI/Router/providers/OpenAiChatProvider.ts` is NEW** — before it this repo
  had no OpenAI chat provider at all, which is why "add Nano" was a build and not a config change.
  It is TEXT-ONLY and defers image turns to the next rung; free chat's own image/PDF path
  (`runVisionChain`) is separate and untouched.
  🔴 **THE ADMIN APPROVED Nano AT POSITION 1 AND IT SHIPPED AT 2 — recorded, not silently changed.**
  They chose Nano-before-lite while the rate card still mis-priced flash-lite at the FLASH line
  (index 4.90); the invoice fix below drops it to **1.20**, cheaper than Nano (2.85). Shipping the
  approved order would have contradicted their own "kharcha kam se kam" instruction AND required
  weakening `freeChainCost.test.ts`, which enforces cheapest-first. Swapping priorities 1 and 2 is
  the entire edit if they want it back.
  🔒 **EVERY RUNG MUST BE A STRING LITERAL.** `freeChainCost.test.ts` parses these registrations out
  of the source to price them, and a shape it cannot read is — in its own words — *"silently exempt
  from the ceiling"*. The first draft of the Nano rung passed a function call and was invisible to it.
- **💸 `gemini-2.5-flash-lite` IS NOT PRICED LIKE `gemini-2.5-flash` (corrected 2026-09-15 from the
  admin's own invoice).** Both used to resolve to the single `'gemini'` rate line, so every flash-lite
  turn was reported at **3× its real cost** on the exact panel used to judge Google spend — margin-safe
  (we over-stated our own spend, never a user's bill) and wrong all the same, the same shape as the
  `E2B_USD_PER_HOUR` drift. **The input half is INVOICE-VERIFIED:** that month's SKUs read `Flash GA
  Text Input 6,116,640 → ₹175.32` and `Flash Lite Text Input 5,237,016 → ₹50.04` = ₹2.866e-5 vs
  ₹9.555e-6 per unit = **exactly 3.0×**, reproducing $0.30 → $0.10. ⚠️ The OUTPUT half is **not**
  invoice-verified (no flash-lite output SKU appeared in that report); `$0.40` is the published
  pair-mate of the confirmed input. Keys: `RATE_GEMINI_LITE_IN` / `RATE_GEMINI_LITE_OUT`.
- **🔴 CHAT GROUNDING — CORRECT AND CURRENT BEATS FAST (admin-mandated 2026-09-12, standing rule).**
  Admin, verbatim: *"latest information aur correct information jyada important hai, time se jyada.
  Chahe to time jyada lage par information sahi aur latest ho!"* So on the chat path, **never trade
  accuracy for latency.** Two changes were REVERSED on this rule the day after they shipped, and the
  reversal is the precedent: the page-read budget had been cut 4 s → 2.5 s "to save time", which
  silently dropped exactly the heavy, content-rich pages worth reading, and only ONE result was read.
  Now `liveSearchContext` reads the **top 2 results CONCURRENTLY at 4 s** (`readPages`, default 2,
  clamped 1–3) — a second source costs no extra wall-clock because the wait is the slower fetch, not
  the sum, which is the one kind of trade this rule allows.
  ⚠️ **Do not "optimise" chat by fetching less.** The honest speed levers are the ones that cost no
  accuracy: the grounding STATUS shown while the lookup runs (#2826, so the wait is visible rather
  than blank), and **`BRAVE_API_KEY`**, ✅ **SET in Cloud Run by the admin 2026-09-12** — `WebSearch`
  no longer has to scrape DuckDuckGo HTML (slower, weaker) for a paying user's live question.
- **Brave Search — the chat's grounding source (admin taking the plan 2026-09-12):** `BRAVE_API_KEY`
  (the Search plan's subscription token) and `BRAVE_SEARCH_CACHE` (kill switch — **default ON**; `off`
  sends every search straight to Brave exactly as before the cache existed). Read by
  `src/server/lib/braveSearch.ts`, the ONE client both `AgentV3/WebSearch.ts` and
  `EngineerAI/WebSearchClient.ts` now call.
  🔴 **TAKE THE `Search` PLAN, NOT `Answers`, AND NOT `Spellcheck & Suggest`.** Verified against the
  code, not assumed: the only endpoint this repo ever calls is
  `https://api.search.brave.com/res/v1/web/search`. `Answers` would be a paid product with **no code
  path at all**, it would hand the WRITING of the answer to a third party (the White-Label Law says
  the answer is NavBharatAI's), and its capacity is **2 requests/second** against Search's 50 — a
  ceiling that would queue real users.
  💵 **$5.00 per 1,000 requests (~₹0.44 each), with $5 of credit applied FREE every month** — so the
  first ~1,000 searches of each month cost nothing. Billing is per REQUEST, not per result, which is
  why `count` is raised freely and repeats are not.
  🔒 **IT CANNOT BECOME A SURPRISE BILL, AND IT CANNOT BREAK CHAT.** The plan is PREPAID (no credits ⇒
  nothing to overspend), and on ANY Brave failure — exhausted credit, 429, network — both callers
  already fall back to the key-free DuckDuckGo path (`WebSearch.ts` / `WebSearchClient.ts`, one
  `.catch(...)` each, test-locked in `tests/braveSearch.test.ts`). Worst case is today's behaviour, not
  an outage. The authoritative ceiling is Brave's own dashboard **Usage limits**, which is the one
  place a cap cannot drift; the code's job is to need it less often.
  🔴 **HOW TO SET IT, AND THE ONE MISTAKE THAT WOULD BE INVISIBLE.** Cloud Run → the service → *Edit &
  deploy new revision* → Variables & Secrets → the name is exactly **`BRAVE_API_KEY`** (never a `VITE_`
  prefix — that is frozen at image build and would change nothing, silently), set ONCE (a duplicate
  wins by being last, per the 2026-08-20 audit), value = Brave's subscription token, nothing else.
  ⚠️ **A trailing space or newline used to be fatal AND silent** — the value goes straight into the
  `X-Subscription-Token` header, Brave rejects it, and both callers fall back to DuckDuckGo with no
  error anywhere: the console shows it configured and the paid engine simply never runs. Since
  2026-09-12 `braveApiKey()` TRIMS it and treats whitespace-only as unset, and a rejected call logs
  ONE admin-only line naming the status (`[BRAVE] search rejected — HTTP 403 … check BRAVE_API_KEY`)
  instead of degrading in silence. **That log line is how to verify the key is really working** —
  no line after real traffic means Brave is answering.
  🔀 **FREE FIRST WHERE IT IS SAFE, PAID FIRST WHERE IT MATTERS (admin asked 2026-09-12: "dono ko mila
  kar… jahan brave ki need na ho wahan duckduckgo").** `searchOrder(intent, hasKey, cheap)` is that
  rule. Note what it is NOT: merging both engines on every query would pay Brave EVERY time and cost
  strictly MORE than today — so the saving comes from asking the FREE engine first wherever its answer
  suffices.
  • **`reference`** (the DEFAULT — AgentV3 build lookups and Engineer AI: package versions, framework
  docs, error meanings) ⇒ **DuckDuckGo first, Brave only if DuckDuckGo finds nothing.** Not a downgrade
  of anything: DuckDuckGo-only IS production's behaviour today, so this is today PLUS a paid rescue, and
  nobody watches a spinner during a build. • **`live`** (only `liveSearchContext`, the chat's grounding)
  ⇒ **Brave first, DuckDuckGo as the free rescue** — freshness and result quality are exactly what the
  fee buys, and a real user is waiting. Both orders end in a second engine, so neither engine being down
  can leave a caller with nothing. A THROW and an EMPTY result are treated identically (both mean "this
  one did not answer"), which is what makes the rescue fire on a 429 as well as on a blocked scrape.
  ⚠️ Adding a caller? It defaults to `reference` on purpose — a caller that has not thought about intent
  is by definition not a user-facing live question, so the safe default is the one that costs nothing.
  🔒 **`cheap` — the third lever, for a caller who is not PAYING at all (admin-mandated 2026-09-12,
  verbatim: "free chat me brave api ka istemal bahut hi kanjusi se karna hai. minimal use. jyadatar
  duckduckgo hi use ho").** The `reference`/`live` split above is about the QUESTION; `cheap` is about
  the CALLER — even a `live` chat question gets DuckDuckGo-first when the asker is not a paying user, and
  Brave is spent only as the last-resort rescue on a genuinely empty DuckDuckGo result. Wired at all
  three `liveSearchContext()` call sites from each surface's OWN existing free/paid signal (no new
  concept invented): `routes/chat.ts` → `cheap: isFree` (the `navbharat` tier), `professionals/engine.ts`
  → `cheap: tier === 'free'`, `routes/agentv3.ts`'s plain-chat-turn lane →
  `cheap: freeTierBuildActive || powerSpecResolved.cheapOnly`. Defaults to `false` in both
  `AgentV3/WebSearch.ts` and `EngineerAI/WebSearchClient.ts`, so a caller that does not pass it keeps
  exactly today's paid behaviour. Deliberately NOT extended to the AgentV3/Engineer AI build-time
  web-search TOOL call (`makeWebSearch()` / `EngineerAgentLoop.ts`) — that is a `reference`-intent
  lookup already DuckDuckGo-first regardless of tier, and the admin's instruction was about "free chat",
  not app builds. Regression-locked in `tests/braveSearch.test.ts` (`searchOrder` itself) and
  `tests/agentV3WebSearchCheap.test.ts` / `liveSearchContext.test.ts` (the wiring).
  📉 **What keeps the bill down, and what it deliberately does NOT trade.** Identical calls already in
  flight share one request (zero staleness — it is the same live response); a repeat question inside a
  short window reuses the result (**60 s** for tick-by-tick things — scores, live matches, market
  prices — and **10 min** for everything else); and case/spacing are normalised because Brave does not
  distinguish them either. Nothing here shortens a fetch budget or reads fewer sources: under the
  standing CHAT GROUNDING rule, cost may never buy staleness a user can feel. An EMPTY or FAILED
  response is never cached, so one blocked minute cannot become ten.
  ⚠️ **`braveMeter()` is PER-INSTANCE and says so** — it reports this process's calls/hits/free-served/rescues since
  boot, not the account's. The account's real number is on Brave's dashboard; do not quote the meter as spend.

- **Live daily-life data for the chat AIs (added 2026-08-25):** `RAPIDAPI_KEY` (✅ **SET in Cloud Run by
  the admin 2026-08-25** — ONE RapidAPI key covering the subscribed marketplace APIs: IRCTC
  (`irctc1.p.rapidapi.com`, live train running status + PNR) and AeroDataBox (flight status); the admin
  also subscribed an IMDb API the same day, whose exact host is pending a screenshot before it is wired —
  do NOT guess the host, several APIs share the name. Read by `src/server/lib/transitLive.ts`; without the
  key every path honestly degrades to web search, never an invented "live" answer). `TMDB_API_KEY` — NOT
  set yet: movies-now-playing source in `lib/liveDataSources.ts`, may be superseded by the admin's IMDb
  API once its host is known. Key-free live sources (weather/AQI/currency/PIN codes) need no env at all.
  ⚠️ Open licensing item recorded in PROGRESS.md 2026-08-25: the no-key weather source (Open-Meteo) is
  licensed non-commercial — license or swap it before heavy real traffic.
  ✅ **THE AQI HALF IS CLOSED (2026-09-20, admin: "use karo!!") — `DATA_GOV_IN_API_KEY`.** Air quality
  moved off that source to the **Central Pollution Control Board's** real-time feed on data.gov.in,
  published under the **Government Open Data License – India**, which permits commercial use in terms.
  A free key from data.gov.in's own registration is all it needs. Read by
  `src/server/lib/cpcbAirQuality.ts`.
  ⛔ **PARKED 2026-09-20, THE SAME DAY — THE KEY COULD NOT BE OBTAINED, AND THAT IS NOT THE ADMIN'S
  TODO ANY MORE.** They registered on data.gov.in, reached `Dashboard → MyAccount`, and the portal's
  own account verification would not complete (verbatim: *"yeh nahi mil sakti — government website
  hai, nahi chal rahi, verification nahi ho raha hai"*). **Do NOT put "set `DATA_GOV_IN_API_KEY`" back
  on their queue** — it was tried, it failed on the other side's side, and re-issuing the instruction
  is the same wasted-instruction class #3196 was written about. AQI questions are answered by web
  search today and the app is whole; this is a MISSING UPGRADE, never a breakage. Re-open it only if
  the admin says the portal worked, or if someone finds another AQI source whose licence genuinely
  covers a commercial product — and that search has to end in the LICENCE, since the two obvious
  free candidates (waqi.info's free token, and the no-key provider this change moved AQI off) are
  both non-commercial tiers, and swapping one grey source for another is not a fix.
  ✅ **RE-OPENED AS A *FUTURE* ITEM BY THE ADMIN 2026-09-21, AND THE PARKING ABOVE STAYS AS WRITTEN**
  (verbatim: *"DATA_GOV_IN_API_KEY — future me lena hai, aisa mujhe baad me yad dilwana"*). This is the
  re-open condition the parking itself named, exercised by the admin rather than by a session: they DO
  want the key, later, and they asked to be reminded. **Nothing about today changes** — the key is still
  unset, `cpcbAirQuality.ts` is untouched, AQI still falls through to web search, and it is still NOT an
  instruction sitting on their queue. What changed is the STATUS: a deliberate future item, not a dead end.
  ⏰ **THE REMINDER IS SCHEDULED, not a sentence in a file** — Routine `trig_0171RbmfL7S5hYbmY6wJ2Wyn`,
  one-shot, **2026-10-21, 11:00 IST**, push + email. It does no work: it re-reads THIS block first and
  stands down if a later session has recorded the key as obtained. **To move or cancel it use that id**
  (`update_trigger` / `delete_trigger`) — never create a second reminder for the same thing.
  ⚠️ **THE DATE IS A GUESS AND IS LABELLED AS ONE.** Nobody can predict when a government portal's
  verification starts working, so the horizon is evidence of nothing; a month was picked as long enough
  not to nag and short enough to still matter. **The real triggers are these three, and a session that meets
  one should raise the key WITHOUT waiting for the Routine:** the admin asks what is still pending in
  Cloud Run; a report shows an AQI question falling through to web search; or the Open-Meteo commercial
  plan is bought — at that moment the whole live-data licence question is already open on their desk, and
  these two belong in one decision rather than two.
  ⚠️ **UNSET ⇒ AQI questions fall through to web search, and NEVER back to the old source** — a
  silent fallback would re-open the exposure with nothing on any screen saying so.
  ⚠️ **IT IS ON ITS OWN GATE, NOT `LIVE_WEATHER_SOURCE`**, deliberately: that switch exists to pause
  ONE provider's licence exposure, and pausing the problem must not also pause the fix. So
  `LIVE_WEATHER_SOURCE=off` now stops the WEATHER only — AQI keeps working.
  🔴 **`LIVE_WEATHER_SOURCE` NOW DEFAULTS TO *OFF*, AND IT IS AN ENABLE SWITCH (admin 2026-09-20:
  "free me jo ho woh").** Only the explicit value **`on`** starts the restricted weather source;
  unset, blank or mistyped leaves it silent — the safe direction for a legal exposure, and the
  mirror image of the `AGENTV3_FEATURE_HEAL_PCT` trap where a bad value silently meant "everyone".
  So a fresh deployment now runs **zero** restricted sources, where it used to run one.
  ⚠️ **Nothing broke:** weather questions fall through to web search, which already answers them.
  The honest fix is still a purchase — Open-Meteo's commercial plan (**$29/month**, verified on their
  pricing page 2026-09-20) — and the day it is bought, **`LIVE_WEATHER_SOURCE=on`** turns it back on
  with no deploy.
  ⚠️ **A free replacement was looked for and NOT found, which is why the switch is the answer.**
  MET Norway's forecast data is free and commercially licensed (CC BY 4.0) — but it needs latitude
  and longitude, and every free GEOCODER checked is either the same restricted provider or
  (Nominatim) explicitly discourages business use. Swapping one grey source for another grey source
  is not a fix. **The panel's row was
  reworded in the same change** so it no longer claims to power AQI — it is the one screen the admin
  judges a legal exposure from, and overstating it there would be its own kind of dishonesty. (`BRAVE_API_KEY` is now SET —
  see the "Brave Search — the chat's grounding source" entry above, which is the canonical record.)
- **Sonic Chat (Amazon Nova Sonic voice — EXPERIMENTAL, route `/sonic`, admin 2026-07-13):**
  `SONIC_CHAT_ENABLED`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (= `us-east-1`),
  plus optional `SONIC_MODEL_ID` / `SONIC_VOICE_ID`. All set in Cloud Run 2026-07-13. The feature is
  OFF unless `SONIC_CHAT_ENABLED=true` AND both AWS keys are present. FULLY ISOLATED — code lives only
  in `src/server/sonic/` + `src/components/sonic/` + a `/sonic` branch in `src/main.tsx`; deleting those
  removes it entirely. NOTE: the AWS keys belong to a dedicated IAM user (`navbharatai-sonic`, Bedrock
  scope) and are NOT the AWS Activate/Free-tier billing account — this is a separate, revocable credential.
- **Nav App Store (user-published Android apps, admin 2026-07-27):** `NAV_STORE_BUCKET`
  (= `navbharatai-appstore-1`, a Cloud Storage bucket in `gen-lang-client-0866594388` — the APK BYTES
  live here because an app is 5–50 MB and a Firestore doc caps at 1 MB; the store also falls back to
  `FIREBASE_STORAGE_BUCKET` if this is unset), `VIRUSTOTAL_API_KEY` (malware scanning, ~70 engines),
  `NAV_STORE_ADMINS` (= `aashishcpmt09@gmail.com`; comma-separated. Falls back to `AGENTV3_FREE_LIST`
  when unset, so the admin was already a reviewer before this was set). All three set in Cloud Run
  2026-07-27.
  ⚠️ **THE STORE'S SAFETY MODEL IS CODE, NOT CONFIG — do not weaken it without admin sign-off.** Every
  upload is inspected (must be a genuinely SIGNED apk), scanned, and lands as `pending`. NOTHING in
  the codebase can reach `approved` except an admin explicitly approving it, because malware built for
  one campaign is routinely unknown to every engine on the day it ships. **No scan ⇒ no publication**:
  a missing key, a rate limit, an oversized file or a timeout all BLOCK, and must never fall back to
  publishing unscanned. Rejecting or removing an app DELETES its bytes, so a takedown is real.
  ⚠️ **OPEN LICENSING ITEM (raised with the admin 2026-07-27):** VirusTotal's FREE/public API is, by
  their terms, not for use in a commercial product — and NavBharatAI is one. The free tier is also
  capped (~4 req/min, 500/day). Fine for testing and the first users; before the store carries real
  traffic this needs either a VirusTotal paid plan or another scanner (e.g. MetaDefender). Recorded
  here as an open item rather than left silent.

- **Ad conversion measurement — Meta / Facebook + Instagram (added 2026-08-31, admin asked to run
  "Download NavBharatAI" ads):** `META_PIXEL_ID` — the WEB pixel id. ✅ **SET in Cloud Run by the admin
  2026-09-03: `1836196930883481`** (the "navbharatai web" dataset in Events Manager — do not confuse
  it with the separate Meta **App ID** `860811063666554` recorded above, which is the Android SDK's
  id, a different credential entirely). Served to the
  browser at runtime by `GET /api/public-config` (`routes/health.ts`) and consumed by
  `src/lib/metaPixel.ts`. UNSET ⇒ the route answers `null` and the pixel never loads; a MALFORMED
  value is treated exactly like unset, so a typo disables measurement honestly instead of injecting
  junk into every page.
  ⚠️ **DO NOT make this a `VITE_` variable, and do not "fix" it into one.** `import.meta.env.VITE_*`
  is frozen when the Docker image is built (cloudbuild.yaml passes such values as `--build-arg` from
  a trigger substitution), so a `VITE_META_PIXEL_ID` set in Cloud Run would change **nothing, with no
  error to reveal it** — the same silent doc-vs-reality drift this file records for
  `AGENTV3_SANDBOX_IDLE_MINUTES`. It is a runtime route precisely so the admin can set one Cloud Run
  key and have it live on the next page load.
  A pixel id is public by construction (it is visible in the page source of every site running one),
  so serving it unauthenticated discloses nothing — but **no secret may ever be added to that route's
  response**.
  🔒 **CONSENT GATES IT.** The pixel is third-party advertising measurement, so it loads only after
  the user accepts the consent banner (GDPR / India DPDP) — the same gate `trackEvent()` and the
  web-vitals observers already pass. The banner copy now NAMES Meta, because consent obtained under
  the old "privacy-friendly analytics" wording would have been consent on a false description. The
  white-label law forbids naming the AI PROVIDERS behind a build; it does not licence hiding who
  receives a user's data.
- **Google Play in-app purchases — the Android token top-up rail (built 2026-09-06, NOT live yet):**
  `STORE_BILLING` (the master switch — **unset today, and unset means today's behaviour exactly**),
  `GOOGLE_PLAY_SA_JSON` (the WHOLE service-account JSON as one string — a Google Cloud service
  account with the Play Developer API enabled and granted access in Play Console → Setup → API
  access), `GOOGLE_PLAY_PACKAGE_NAME` (= `com.navbharat.ai`). Optional: `STORE_FEE_PCT` (default 15
  — Google's commission on the first $1M/yr; retune it the day the first real payout report shows
  the true rate, GST included) and `STORE_PACKS` (JSON override of the catalogue).
  **WHY THIS EXISTS:** Google Play policy requires digital goods consumed inside a Play-distributed
  app to be sold through Play's own billing. NavBharatAI's wallet top-up is exactly that, and the
  Android app currently sells it through the Cashfree web rail — a real, standing policy exposure
  that this rail closes.
  🔒 **THE FLAG IS THE MIGRATION, AND IT FAILS SAFE BY CONSTRUCTION.** With `STORE_BILLING` unset,
  `purchaseRail()` returns `web-gateway` on every device and the app is byte-identical to today.
  Turning it on switches ONLY the native Android shell to Play packs — and only when the server also
  confirms Google is configured AND the installed build carries the native plugin. A user on an
  older `.aab`, or a device with no Play Store, silently keeps the working web rail rather than
  losing the ability to top up. Test-locked in `tests/storePurchase.test.ts`.
  ⚠️ **BEFORE FLIPPING IT ON, four things must be true or a user will hit a dead button:**
  (1) the four products exist and are **ACTIVE** in Play Console → Monetise → In-app products with
  the EXACT ids `nbai.tokens.99` / `.249` / `.499` / `.999` and prices **₹119 / ₹299 / ₹599 /
  ₹1199** (they must match `DEFAULT_STORE_PACKS` in `storeBilling.ts` exactly — Google is the
  authority on price, our catalogue on credit); (2) both env keys above are set in Cloud Run;
  (3) a build carrying `PlayBillingPlugin` is LIVE on Play (the plugin shipped in this change, so
  release 103 and earlier do NOT have it); (4) Play Console → Monetisation setup has a payments
  profile. The plugin names a missing/inactive product explicitly in its failure message, so the
  first real tap says which of these is wrong instead of "failed".
  💰 **WHAT IT COSTS THE USER, AND WHY THAT IS SHOWN.** A pack is priced above the credit it gives so
  our net after Google's cut is unchanged (₹119 → ₹99 of credit). The admin's instruction was
  "google ka charge add kar ke clear dikhao", so each pack card shows the split — `₹99 + ₹20 fee`
  beside the ₹119 total. It is labelled **"fee"/"Play Store fee", never "Google's fee"**: Google's
  actual commission on ₹119 is ₹17.85, and the rest is rounding to a price point Play's tier table
  carries — printing "Google's fee: ₹20" would be a number no payout report will ever match, which
  the billing law above forbids even when it flatters us. The internal split stays admin-only; the
  server records `storeFeePct` and `storeNetInr` on every store transaction for reconciliation.
  ⚠️ **ANTI-STEERING — do NOT add "cheaper on the web" copy to the app.** Google's Payments policy
  restricts steering users to an external purchase path from inside the app, and this account has
  already taken one policy strike (the medical-features rejection). The pack card explains the fee
  factually and stops there, deliberately.
- **`FACEBOOK_APP_ID` + `FACEBOOK_CLIENT_TOKEN` — GitHub REPO SECRETS, *not* Cloud Run keys.** Recorded
  here anyway so nobody searches Cloud Run for them and concludes they are missing. They are read at
  **build** time by `android/app/build.gradle` (via `.github/workflows/android-aab.yml`) and are what
  make a Meta **App Install** campaign possible at all — Meta can only optimise for an Android install
  it can observe, through this SDK or a paid MMP.
  **Neither set ⇒ the `facebook-core` dependency is not added at all**, the manifest's
  `com.facebook.sdk.*` meta-data are inert strings, no advertising-ID permission is merged, and the
  app behaves exactly as it does today. BOTH are required together — an app id with no client token
  cannot initialise, and "half-configured" is the built-but-not-working state that must not exist.
  ⚠️ **SETTING THEM CHANGES A PLAY OBLIGATION, not just a build.** A bundle built with them collects
  the advertising ID and app events, which MUST be declared in Play Console → App content → **Data
  safety** before that build is rolled out. The workflow's run summary states which of the two states
  a given `.aab` is in, so a downloaded bundle is never ambiguous.
  Reaching installed users needs a **fresh `.aab`** — the app is BUNDLED mode, so a frontend change
  never reaches them on its own.
  📌 **THE LIVE Meta app is App ID `860811063666554`** (admin, 2026-09-02). Recorded because three
  identically-named `NavBharatAI` apps were created during setup and the other two were DELETED — a
  later session reading only "create a Meta app" would otherwise make a fourth, or configure a dead
  one. An App ID is public by construction (it ships inside the app binary and appears in ad code),
  so it is safe here; the **Client Token is not** and must only ever go into the repo secret.
  App name `NavBharatAI`, use case *Create & manage app ads with Meta Ads Manager*, mode
  **Development** as of this date — it must be switched to **Live** before App Install ads can run.
  Android platform values to enter in App settings → Basic: package `com.navbharat.ai`, class
  `com.navbharatai.app.MainActivity`, Google Play package `com.navbharat.ai`.
  ⚠️ **CORRECTION 2026-09-02, SAME DAY: the line that stood here was WRONG.** It read "NavBharatAI
  has no privacy-policy page of its own — verified by grep". There has been a full one since
  2026-08-08 (`src/content/legal/privacyPolicy.ts`, 186 lines, plus Terms, DPA, Security and NDA),
  reachable in Settings → Legal & Trust. The claim came from a grep whose output was TRUNCATED at
  20 lines; the legal files sat below the cut, and "no hits shown" was read as "does not exist".
  **The lesson is the one this file already teaches about `main` drifting, applied to a search: a
  conclusion drawn from a capped result set is not a verified fact.** Cap the noise, not the answer —
  and for an existence question, search by FILENAME as well as content.
  🔴 **WHAT WAS ACTUALLY WRONG — and it was worse.** The policy said, in three places, that we do
  NOT do the thing PR #2729 had just built: "we do not show third-party advertising", "We never
  share your data with advertisers or data brokers", "We do not use third-party advertising
  cookies". Shipping the pixel with `META_PIXEL_ID` set, or that `.aab`, would have put the live
  site in breach of its own published policy — and a Play Data-safety declaration that contradicts
  the policy is a violation, not a mismatch. Caught before either was switched on; nothing was ever
  collected under the old wording. Fixed in PR #2732: the three statements corrected, a new
  **Section 3.1** stating exactly which events reach Meta, and public **`/privacy`** and
  **`/terms`** URLs (server-rendered HTML, no JS, no auth — Meta and Play check those links with
  tools that may not run JavaScript).
  🔒 **THE GUARD THAT MATTERS MORE THAN THE WORDING:** `tests/privacyPolicyTruth.test.ts` asserts
  the pixel's allowlist against what Section 3.1 discloses, so **adding an event to
  `pixelEventFor` fails CI until the policy is updated too** (verified to bite). Do not weaken it;
  it exists because the first drift produced no failure of any kind.

- **🌐 `IMAGE_GEN_CLIENT_FETCH` — a FREE image is fetched by the USER'S BROWSER, not by this server
  (admin-mandated 2026-09-21: *"free wale me user ki ip, paid me hamari"*). ⚠️ NOT set, and the code
  default is ON**; `off` is the instant, no-deploy revert to the previous behaviour exactly. Read by
  `src/server/lib/imageTicket.ts`; applied in the free Pollinations branch of `routes/imageGen.ts`.
  🔑 **THE PROBLEM IS A RATE LIMIT, NOT A BILL.** The free provider allows **one request every 15
  seconds PER IP ADDRESS**, and this server is ONE address — so every free user on the platform
  shared a single bucket. Ceiling: ~5,760 images/day for the whole product, and only if perfectly
  spread. Worse, a throttled request was read as a FAILURE and fell through to the **paid** Gemini
  rung — so at scale the "free" tier quietly became a paid one, at a price this repo has never
  measured (there is still no image rate in `providerRates.ts`). From the browser each user has
  their own address.
  ⚠️ **CGNAT MEANS THIS IS AN IMPROVEMENT, NOT A FIX.** Indian carriers put many phones behind one
  public address, so a busy tower still shares a bucket. The admin asked for that to be fixed and it
  cannot be — the only techniques are rotating proxies, i.e. deliberately evading a free provider's
  rate limit, which would get NavBharatAI blocked outright. What absorbs the remainder is the
  browser's retry, bounded by the admin's own budget (*"1 min baad bhi mile chalega"*).
  🔴 **THE RELAY IS AN SSRF SURFACE AND HAS TWO LOCKS.** `POST /api/image/relay` exists so Add text,
  Crop, Copy and Download keep working when a browser may not read another site's pixels — it takes
  a URL **from the client**. Locks: (1) `isAllowedImageHost` — an EXACT host allowlist, because a
  substring check passes `image.pollinations.ai.evil.com`; (2) our HMAC over that exact URL, because
  an allowed host with a free path is a way to fetch a prompt our safety triage never saw. Neither
  is relied on alone. A forged and an expired ticket return the SAME words, so a prober cannot tell
  which lock they tripped.
  🔒 **THE TRIAGE DID NOT MOVE.** The pornography ban, the craft layer and the India-map directive
  all still run on this server before a link is minted; the link carries a FINISHED prompt.
  ⚠️ **And the provider's own `safe` parameter is NOT a substitute** — their docs say safety is OFF
  unless asked for, and it is documented on their NEW keyed endpoint, not the keyless one this uses.
  ⚠️ **An EDIT of the user's own photo is never handed to the browser** (`!editing`): it carries
  their photograph, and those bytes must not end up in a URL anybody could hold.
  **What to watch on the first real days:** whether the countdown appears often (the shared-address
  case), and whether pictures still open in "Add text" — if a browser cannot read them the relay
  covers it, but a rise in relay calls means we are paying the address cost after all.

- **Charging for NavBharat Cloud hosting (built 2026-09-12, ROADMAP §11 slice 2.1 — NOT live yet):**
  `NAVBHARAT_BILL_HOSTING` (⚠️ **UNSET.** Unset means the daily job still MEASURES every hosted app and
  writes an admin line, and charges **₹0** — NavBharatAI absorbs it, exactly as slice 2's admin route
  already reported), `NAVBHARAT_HOSTING_MARKUP_PCT` (default **20**, admin decision D5), and the six
  per-unit rates `NAVBHARAT_RATE_CPU_SECOND` · `_MEMORY_GIB_SECOND` · `_MILLION_REQUESTS` ·
  `_EGRESS_GIB` · `_BUILD_MINUTE` · `_STORAGE_GIB_MONTH`.
  🔴 **THERE ARE DELIBERATELY NO DEFAULT RATES, and this is the same law `sandboxCost.ts` obeys: a rate
  that is not set bills ZERO for that line and the line is NAMED as unbilled.** Partial configuration
  therefore UNDER-bills — the safe direction — and can never over-bill. The alternative (a plausible
  placeholder) is precisely how `E2B_USD_PER_HOUR` came to charge half the real rate for a month while
  looking deliberately configured.
  ⚠️ **D5's condition is that all FOUR cost lines are metered, not just compute.** An app serving images
  or video can have EGRESS dwarf its compute, so metering compute alone and adding 20% makes every
  bandwidth-heavy app a LOSS. A later change that drops a line does not simplify the pricing; it
  re-introduces the loss D5 was written to prevent.
  🔒 **D3 — THE FREE ALLOWANCE IS THE WALLET, and that is the decision rather than an omission.** There
  is no separate hosting pot: THE ONE-WALLET LAW says a user has one balance, and the gifted welcome
  balance is already the free allowance for everything else. A hosting-only second currency would be
  one more thing to explain, top up and keep in sync.
  🔴 **CORRECTED 2026-09-13, BEFORE IT EVER CHARGED ANYBODY — D5 IS NOT WHAT THE USER AGREED TO PAY.**
  The job priced every hosted app at "our cost + 20%" and knew nothing about hosting plans. But a ₹149
  Starter holder has already been SOLD 5 GB of traffic, in the agreement they tick before paying, so
  billing them from the first byte would have taken money for something they had already bought. The
  admin found it by asking the plain question: *"to hum ₹149 ke plan me user ko kya de rahe hai?"*
  **What the wallet is charged now is exactly the ticked terms:** ONE meter — visitor traffic, summed
  across ALL of the owner's hosted sites — the plan's included GB free (Starter 5 GB, Growth 20 GB),
  and **₹20 per GB above it** (`HOSTING_OVERAGE_INR_PER_GB`). D5 survives as the ADMIN's own view:
  `hostingCost.ts` still computes what an app really costs US, and that number answers the only
  question it was ever for — is ₹20/GB above our own cost or below it? The rates below are what make
  that comparison possible; they no longer decide anybody's bill.
  🔒 **A LEGACY ₹99 PLAN IS NEVER CHARGED OVERAGE** — those records carry no `agreedAt` because the
  overage terms did not exist when they were sold. **NO PLAN ⇒ NO SERVER HOSTING AT ALL**
  (`hostingAvailability` now takes `hasPlan`, and an UNKNOWN answer counts as no plan — an unreadable
  lookup must never open a paid path). Free publishing is untouched: five static apps, free link, badge.
  ⚠️ **AND THE AGREEMENT'S CENTRAL PROMISE WAS CHANGED IN THE SAME COMMIT, deliberately.** It read
  *"your apps KEEP RUNNING — nothing is switched off"*, unconditionally, which made unpaid overage free
  for ever and made enforcing it a broken promise. It now reads: keep running **while your wallet has
  balance**; a reminder first; offline only if it stays unpaid; **nothing deleted**, back on publish.
  `decideDebtAction` enforces exactly that — and a user who owes NOTHING is never touched whatever
  their balance is, because an empty wallet is not a debt. Unreadable balance ⇒ never offline.
  📅 The job is `hosting-daily-bill` (04:00 UTC, **exclusive**), and it bills the last COMPLETE UTC day —
  never a partial one, because a partial day would be re-billed on the next run. Idempotency is a
  Firestore **`create`** on `hosting_billing/<workspaceId>_<YYYY-MM-DD>`, written BEFORE the wallet
  moves: a claim that lands with a debit that fails means we absorbed one app-day (visible in
  `absorbed()`), which is the only direction the billing law permits being wrong in.
  ⚠️ **It does NOT pause an app whose owner runs out of credit.** `plan_paused` exists and would be the
  mechanism, but taking a live site off the internet over a balance is a product decision with a real
  person on the other end — the admin's to make. Today the balance simply goes down, as a build's does.
  🔒 **THIS JOB IS THE GATE ON `NAVBHARAT_CLOUD_PUBLIC`.** That key is unset because hosting without
  metering puts every hosted app's Cloud Run bill on NavBharatAI with nothing recording it. This is the
  metering. Opening hosting still needs the rates above to be set and a few real days of the admin
  report read first — the switch is not a consequence of this code existing.
- **AI inside a PUBLISHED app — the gateway (built 2026-09-12, ROADMAP §13 item 3.1, NOT live yet):**
  `APP_AI_GATEWAY` (the master switch — ⚠️ **UNSET, and unset means today's behaviour exactly**: no token
  is minted, no page is stamped, and the endpoint refuses everything). Tunables, all with working code
  defaults: `APP_AI_DAILY_CAP_INR` (**₹20** — what ONE APP's assistant may spend in a day) and
  `APP_AI_VISITOR_CAP_INR` (**₹2** — what one VISITOR may spend of it). Read by
  `src/server/lib/appAiGateway.ts`; the endpoint is `POST /api/app-ai/ask` (`routes/appAi.ts`).
  **WHAT IT REMOVES:** a generated chatbot used to end with "now paste your OpenAI key", which is where
  most people stop — every competitor has the same wall. With this on, the published app calls US, the
  answer is routed on the ordinary Professional chain (GLM-flash led, so a typical answer is genuinely
  free to us), and the cost lands on the owner's EXISTING wallet under THE ONE-WALLET LAW.
  🔴 **THE TOKEN IN THE PAGE IS PUBLIC, AND THE WHOLE DESIGN IS BUILT ON SAYING SO.** It ships inside
  published client code, so anyone can read it: it is an app IDENTIFIER ("which app is spending?"),
  never an authorisation ("is this caller allowed?"). What follows, and what must not be undone:
  the app id is SIGNED (a token lifted from app A cannot spend app B's budget); **the CAP is the real
  defence**, which is why the per-app and per-visitor ceilings are both enforced and neither is
  optional; there is **no expiry** (an expiring token would break a working app on a random Tuesday),
  so rotation is by REPUBLISH — a new nonce, with the previous one honoured for exactly ONE generation
  so a deploy cannot break a page a visitor already has open; and revocation is the live-deployment
  check, so unpublishing or a takedown switches the assistant off without reaching into files already
  in somebody's browser.
  🔒 **WHITE-LABEL LAW, APPLIED TO SOMEBODY ELSE'S VISITORS.** A stranger on a user's website must never
  learn which vendor answered, so every refusal and error is branded text with no provider name — and
  `app-cap` and `owner-empty` deliberately say the SAME words, because a visitor is not entitled to know
  that the site owner's balance ran out. Test-locked in `appAiGateway.test.ts` and
  `appAiGatewayWiring.test.ts`.
  ⚠️ **A Professional Pass does NOT make an app's public traffic free**, and neither does the free list.
  The Pass pays for the HOLDER's own assistant use; treating it as a licence for an unlimited number of
  strangers would quietly resize a product that was already sold.
  🔒 **ONLY AN APP THAT ASKED FOR IT IS EVER STAMPED (admin 2026-09-13).** The first version put the
  helper into EVERY published page, including apps that never requested AI — and the admin's objection
  was exactly right in the half that matters: *"user ko lagega ham spy daal rahe hai user ki app me"*.
  Nothing is displayed and no app data is read, but uninvited code in somebody's page is not ours to
  put there. `appUsesGateway(files)` now gates both the stamp AND the registry row: an app whose own
  code never references `window.NavAI` gets nothing at all, not even an identity record. Conservative
  by design — in doubt it stamps nothing, because a false negative is a republish away while a false
  positive is the thing being corrected.
  ⚠️ **BEFORE FLIPPING IT ON:** the switch changes what a PUBLISH does, not what an existing app does —
  apps published before it was set carry no token and are unaffected until they are published again.
  The per-app cap is the platform default for every app; there is deliberately **no owner-facing
  override yet**, because nothing in the product can set one and a field with no screen behind it is a
  promise. Reverting is one key: unset it and new publishes stamp nothing, while apps already carrying
  a token get an honest "not available" from the endpoint.
- **🧮 `AI_IMAGE_FREE_PAID_DAILY_CAP` — the PLATFORM-WIDE daily ceiling on images the FREE tier gets
  from a PAID engine (built 2026-09-21; the number PR #3234 left open). ⚠️ NOT set, and the code default
  is **300 a day across the whole platform**.** Read by `src/server/lib/imageFreePaidBudget.ts`; its
  single reader is `allowPaidRung()` in `routes/imageGen.ts`. `0` ⇒ the free tier never touches a paid engine (the free provider or nothing); an unreadable
  value ⇒ the default, **never unlimited** (the `AGENTV3_FEATURE_HEAL_PCT` lesson); only the explicit
  word `off` lifts it.
  🔴 **WHY:** the free tier costs ₹0 while the free provider serves; its paid rungs (Gemini, Grok) and an
  EDIT of the user's own picture are paid by NavBharatAI. The only bound was PER USER
  (`AI_IMAGE_FREE_DAILY_LIMIT`, default 3) — at 10,000 users a bad hour at the free provider was 30,000
  paid images with nothing to stop it, at a price `providerRates.ts` still does not carry. **A COUNT, not
  a rupee figure**, because THE ONE-WALLET LAW forbids inventing a cost and no image model is on the rate
  card; a count is a number that is true.
  🔒 **FAILS CLOSED** (like `webRiskBudget.ts`, unlike the wallet gate): a counter that cannot be read
  refuses the paid rungs — one user re-presses in a minute (the free provider is still tried first, every
  time), whereas opening paid rungs on a counter nobody can read is the unbounded bill itself. The count
  moves on DELIVERY only, never on a failed attempt; free-listed accounts (the admin's own) are neither
  counted nor refused, because they are how the paid rungs get verified at all.
  **What to watch:** `[IMAGE_GEN] free-tier PAID image cap reached` in the server log (once per process
  per day) — the number that says whether 300 is right, and how often the free provider is really failing.

- **📱 THE PHONE-BUILD REPAIR LOOP — "loop theek karo, model nahi" (admin 2026-09-22; built the same
  day, two PRs).** Three keys, none set, all with working code defaults. `MOBILE_SHIP_REAL_BUILD`
  (**default ON**; `off` reverts) — before a repository is prepared, the app's own `npm run build` is
  run in the sandbox it is already living in, so a compile error is met in seconds here rather than
  five minutes into a GitHub run that costs one of the user's three attempts. It NEVER starts a machine
  (`hasLiveSandbox`, an in-memory lookup), is bounded by `MOBILE_SHIP_REAL_BUILD_MS` (**180 s**, floor
  10 s, cap 600 s; malformed ⇒ default, never "no limit"), and is not stricter than the runner (a
  type-only failure is rescued there by the workflow's bundler fallback, judged by the SAME classifier).
  Read by `src/server/lib/mobileShipRealBuild.ts`. ⚠️ Recorded here a PR late — #3249 shipped it and
  this registry did not say so, the drift this registry exists to prevent.
  `MOBILE_AUTOFIX_AI_ROUNDS` (**default 4**, clamped 1–8; malformed ⇒ 4) — how many model calls one
  AI repair may spend. Read by `aiRepairMaxRounds` in `mobileBuildAiRepair.ts`.
  🔴 **WHY THE LOOP AND NOT THE MODEL.** The admin's own `.aab` built through Claude works every time;
  a user's APK *"80% baar fail hoti hai aur theek nahi hoti."* The difference was never which model
  answers. The AI repair was a ONE-SHOT blind patch: one prompt over whichever files the log happened to
  name, one reply, COMMITTED without being run, and a GitHub run to learn whether it worked — while
  `mobileShipPreflight` re-verified every one of its own rounds and called an unverified fix a MISS.
  `runAiRepairLoop` is Claude Code's loop, bounded: (1) the model may **ask for a file** with
  `{"needFiles": [...]}`, chosen ONLY from a listing we supplied (`listRepoTree`), so the allowlist is
  not loosened — it picks from a menu, it never invents a path; (2) every candidate is **run through the
  app's own sandbox build** (`makeRepairVerifier`) before it is committed, and a change the build
  rejected is NEVER committed on any round; (3) a verified failure is **fed back in the build's own
  words**, with the candidate still in view, so the next round corrects the previous change.
  🔒 **WHAT DID NOT CHANGE:** the allowlisted paths, the forbidden secrets/keystore/lockfile paths,
  full-content-not-diff, the size caps, no delete / no new file / no shell, the named revertable commit,
  the White-Label sentences, and the weak tier's chain (GLM→Kimi, never Sonnet/Opus) — the model
  chain is untouched by design.
  ⚠️ **THE SANDBOX CAN JUDGE ONLY THE APP'S OWN BUILD** (`sandboxCanJudge`: the `install` and
  `webbuild` stages, or an unmarked log read as the app not compiling). A Gradle, Xcode or Capacitor
  failure gets the old one-shot behaviour, now LABELLED `verified: false` in the response and counted as
  `unverified-fix` on the admin's Phone-build-outcomes card — so the ratio of verified to unverified is
  the number that says whether the verifier is reaching real builds. The repair MAY wake a paused
  sandbox (a resume, seconds, a few paise) and seeds an empty one from the durable store: it holds a
  real failure and a real five-minute cost to avoid, unlike the ship-time check above. The sandbox is
  the user's workspace, BORROWED: every file written is snapshotted and put back — on failure, timeout,
  throw AND success — except the app's own source on success, which the route also merges into the
  durable workspace (the pre-flight's own rule, applied from the other end). Repository-only files
  (the workflow, the assembled package.json, capacitor.config.ts) are never left in the workspace.
  🔴 **`build()` SAYS SUCCESS FOR A MACHINE WITH NO package.json** ("no build step — static project"),
  so an empty or paused sandbox would have PASSED the ship-time check without building anything.
  `sandboxHoldsApp` reads the marker back first on both paths; a read that fails is "could not tell",
  never a pass. Found while writing the verifier, in code merged that morning.
  🔴 **EVERY REPAIR USED TO START TWO GITHUB RUNS.** The route dispatched the workflow after its commit,
  and the panel dispatched again at the top of its next attempt — both billed against the user's
  Actions minutes, the panel watching whichever appeared first. The panel has owned the dispatch since
  the loop was written and an old bundled Android client will keep dispatching whatever the server
  does, so the server stopped: `fixed: true` means "committed — build again", one run per repair for
  every client. Also: a comment-only rewrite is no longer a `fixed: true` (`isMeaningfulChange`), the
  four credential classes (`cureFamily === 'user-credentials'`) end the request before a model or an
  attempt is spent, and the panel's last sentence says whether anything was really repaired instead of
  claiming a repair on every exhausted cycle.
  💸 **WHAT IT COSTS, plainly:** up to 4 model calls per autofix instead of 1, on the weak tier paid by
  NavBharatAI, plus a sandbox resume per verification. The bet is the same as `AGENTV3_COMPLEX_TO_KIMI`'s:
  a blind fix that fails is paid twice, once in the call and once in the five-minute run it triggers.
  **Watch:** `fixed` vs `unverified-fix` vs `gave-up` on the card, and whether the failure rate moves.
  🏗️ **THE APP IS BUILT HERE; GITHUB ONLY PACKAGES IT (same day, third PR — admin: *"aapne 5 point
  bataye hai, sab karo … toote hi na wala banao"*).** Two more keys, neither set, both with working code
  defaults: `MOBILE_SHIP_PREBUILT` (**default ON**; `off` reverts to the source ship for every app) and
  `MOBILE_SHIP_PREBUILT_MS` (**240 s**, floor 30 s, cap 600 s; malformed ⇒ default). Read by
  `src/server/lib/mobileShipPrebuilt.ts`. Before a repository is prepared, the app's own PRODUCTION build
  runs in its sandbox, the output is read with the ONE reader the platform already has (`downloadDistFiles`,
  which strips the preview bridge) and ships as `www/` with the static no-op build script — so the runner
  compiles NOTHING, and the step most phone builds died in does not exist for that repository.
  `www/.nbai-prebuilt` is the stamp; the pushed package.json keeps only Capacitor and the plugins the
  MACHINE named (read from `node_modules`, `null` ⇒ nothing trimmed), so the runner's install is seconds.
  ⚠️ **CORRECTION TO THE SENTENCE ABOVE — "It NEVER starts a machine" is true of `runRealBuildCheck` and
  of nothing else on this path any more.** The prebuild MAY wake a paused sandbox and seed an empty one
  (`ensureWorkspaceFilesInSandbox`), deliberately: that rule was written for an OPPORTUNISTIC check beside
  a ship that would proceed either way; this IS the ship's build, and a resume (seconds, paise) against
  a failed five-minute run is the trade the admin chose. The check now runs only where the prebuild
  never STARTED a build — a build that ran here (shipped, timed out, or unreadable) is its answer, and a
  second one in the same machine would double the cost. Presence of `hasLiveSandbox` is what marks a
  sandbox-backed actuator; the local one has none, so a test never builds on disk.
  🔒 **Every stand-down is a fall-through to the source ship, exactly as before; the ONE refusal is a
  build that failed here in a way the runner would fail too** — the same 422 `real-build-failed`.
  `www/` is OWNED by the push: what an earlier push left there and this one does not carry is removed in
  the same commit (`commitFiles(..., removePaths)`, `listRepoPathsUnder`), or a hashed bundle from last
  week is packaged into the phone app for ever.
  📏 **Measured from here on:** `ships.prebuilt / source` and `prebuildSkips.<reason>` on the day rollup,
  shown on the admin's Phone-build-outcomes card as "How the app reached GitHub" — the number that says
  whether the runner still compiles apps at all, and which fallback fires when it does.
  🔁 **The rest of the same PR, no keys:** the generated workflows cache `~/.npm` (keyed on
  `package.json`, the one manifest that IS pushed — NEVER setup-node's `cache: npm`, which hard-fails
  without a lock file) and, on Android, `~/.gradle/{caches,wrapper}` (keyed on the Java pin), saved
  `if: always()` so the retry after a repair does not pay for the first run's downloads; the panel
  carries an attempt HISTORY to each autofix (`mobileRepairHistory.ts`: the same failure back after a
  rules refresh skips the rules, after an AI change tells the model its own change failed, after
  NOTHING ends the cycle honestly), every autofix answer carries the tool's own last words
  (`failureLine`) so a repeat is recognisable, and the panel says which of THREE things a repair was —
  built and checked here first, a packaging step the sandbox cannot judge (`judgeable: false`), or one
  it could not check on this request. And a class fixed on the way: the verifier and the workspace heal
  took a REPOSITORY path as a WORKSPACE path, so a static repo's `www/index.html` was "nothing to test"
  and a root `index.html` / `vite.config.ts` was never app source — `workspacePathForRepoPath` +
  `detectRepoLayout` (assembler) and `REPO_ONLY_PATH` (`isAppSourcePath`) now decide both.
  🔴 **THE REVIEW'S CRITICAL CATCH, recorded because it is true of EVERY static ship before this
  date: Capacitor's CLI reads `capacitor.config.ts` with the PROJECT's TypeScript** (`@capacitor/cli`
  config.js fatals *"Could not find installation of TypeScript"*), and a package.json assembled for a
  hand-written static app declared only `@capacitor/cli`. `buildPackageJson` now declares `typescript`
  for every kind (never overriding the app's own range), and `TYPESCRIPT_MISSING` is a classifier class
  with a rules repair for old repositories. Also from the review: a refusal needs a POSITIVE app fault
  (`APP_FAULT_CODES` — `UNKNOWN` falls through to the source ship), nothing is ever deleted from the
  machine (a stale MARKER replaces the first draft's `rm -rf`), only `www/` paths RECORDED in
  `www/.nbai-shipped` are ever removed from a repository, and the prebuild stands down beside a build
  in flight (`isBuildActive` / `isGreenLatched` ⇒ `build-in-flight`).
  ⚠️ **NOT done, said plainly:** a verified AI fix to the REPOSITORY's package.json (a dependency
  version) is still never merged into the workspace — the assembled file carries Capacitor deps and the
  sentinel script, so copying it back would break the app's own build — and the next ship regenerates
  it from the workspace. A dependency-only merge is a separate change.
- **📦 `STATIC_PRECOMPRESSED` — the web bundle is compressed ONCE at build time (built 2026-09-24).
  ⚠️ NOT set, and the code default is ON**; `off` is the no-deploy revert to per-request compression.
  `scripts/precompress.mjs` runs in the **Dockerfile only** and writes brotli-11 and gzip-9 copies beside
  every asset under `assets/`, `monaco/` and `vendor/`: measured, 31.7 MB raw → 5.8 MB brotli, and
  the JS/CSS bundle is **14% smaller** than the quality-4 brotli the per-request middleware sends,
  at **zero CPU per request**. It adds about 18 s to the image build.
  `lib/precompressedStatic.ts` serves the copies before `express.static`, and falls through whenever
  there is no copy. 🔒 **Never add it to `npm run build`**: Capacitor copies `dist/` into the phone
  apps, which load from their own disk, so the copies would only make the download bigger. A test
  enforces this. Same change: `/monaco/` and `/vendor/` are not content-hashed, so they get a one-day
  cache (`UNHASHED_ASSET_CACHE`) instead of one year `immutable`. ⚠️ `firebase.json` was NOT given the
  same rule: the main app is served by Cloud Run, and Firebase's precedence for overlapping header
  globs was not verified.
- **🗜️ `AGENTV3_COMPACT_STORAGE` — stored data is compressed instead of dropped (built 2026-09-24, admin:
  *"jo hamari navbharatai ko world class banaye woh build karo"*). ⚠️ NOT set, and the code default is
  ON**; `off` is the no-deploy revert (never compress; the old byte-measured drop). Helper:
  `src/server/lib/compactStore.ts` (brotli q5, tagged `br1`, sizes in UTF-8 BYTES). Used by three stores:
  the **Time Machine** (`BuildHistoryStore` — an app that does not fit as plain text is stored packed,
  whatever still does not fit is counted in `omittedFileCount` and told to the user on restore), the
  **admin build-report session** (`AdminBuildReportStore` — fitted by its PACKED size, so "N older builds
  omitted" becomes rare), and **transcript turns over 600 KB** (`FirestoreConversationStore`).
  🔒 **Small payloads are stored byte-for-byte as before**, so a rollback of the code still reads them.
  Only data that USED to be dropped is written packed. Readers accept both forms forever, and an
  undecodable payload reads as omitted, never as an empty app (an empty version would wipe a workspace
  on restore).
  ⚠️ **Why not zstd:** in Node 22, which is our runtime image, `zlib.zstd*` is still EXPERIMENTAL, and this
  format must stay readable for the life of every stored version. The tag leaves room for `zs1` later.
- **🧾 THE MARKUP IS EARNED BY A PREVIEW THAT RAN (admin-mandated 2026-09-18).** `AGENTV3_MARKUP_NEEDS_PREVIEW`
  — ⚠️ **NOT set, and the code default is ON**; `off` is the instant, no-deploy revert to the
  pre-2026-09-18 behaviour exactly. Read by `src/server/AgentV3/previewEarnsMarkup.ts`; applied at BOTH
  billing paths in `routes/agentv3.ts` (the settle and the Fix-67 deadline finalizer).
  **Admin, verbatim:** *"app बनी = preview चला — aur paise tabhi charge hone chahiye, jab preview chale"*,
  and choosing between three options for the case where it did not: *"(c) सिर्फ़ असली लागत लें, बिना markup"*.
  🔴 **WHY: autopsy `1a7f4a58` billed a FREE-tier user ₹613.08 for a build whose `RELEASE_GATE` was
  `UNKNOWN`, whose preview served `Cannot GET /`, and which ended in a rollback.** Nothing in the money
  path was broken — every guard did what it says: `zeroBillForUnrenderedPreview` needs
  `previewVerifiedFailed` (*we looked and it failed*), `zeroBillForFailedBuild` needs `!result.ok`. That
  build was **neither**. We never managed to look, and the build reported success.
  🔑 **The distinction is one this codebase already makes everywhere else and had never applied to
  money.** `previewProvenBroken` exists precisely because *"we looked and it was broken"* and *"we could
  not look"* are different facts. The guards covered the first; this covers the second — the commonest
  of the three. The proof read is `buildObs.previewRendered`, whose only producer is `markAppRendered`
  (one fact, one write), never *"the build said ok"*.
  ⚠️ **IT IS NOT ₹0, AND THAT WAS THE ADMIN'S CHOICE.** They were offered ₹0 and refused it, for the
  reason autopsy `4efab9d7` already records — free-when-unproven hands away every build whose app works
  but whose proof WE failed to collect. So the user pays what the build genuinely cost us (tokens + the
  VM, the same two numbers the bill already used) and not one paisa of margin.
  🔒 **It can only ever REDUCE** (`min(decided, real)`), it runs BEFORE every zeroing rule so those still
  take precedence, and a turn with no app expected (chat/survey/import) is untouched — the same carve-out
  `zeroBillForUnrenderedPreview` already makes. Report code `MARKUP_WAIVED_NO_PREVIEW`; the user is told
  in branded words. Test-locked and reversion-proven in `tests/paisaTabhiJabPreviewChale.test.ts`.
  **What to watch:** how often `MARKUP_WAIVED_NO_PREVIEW` appears. A high rate is not a billing problem —
  it is the engine failing to prove its own work, and the number that says so.

- **🎓 PROFESSIONALS: 10 FREE MESSAGES A DAY, THEN PAID — and Exam mode's 5 free QUESTIONS (built
  2026-09-23; admin, verbatim: *"professional ai me din ke 10 message free honge, fir paid hoga. aapne
  sabke liye sab free kar diya. teacher ai ka exam mode me only 5 questions per day free ho"*). Three
  keys, NONE set, all with working code defaults: `PROFESSIONAL_FREE_QUOTA` (**default ON**; `off` is the
  no-deploy revert to the previous behaviour exactly), `PROFESSIONAL_FREE_DAILY_LIMIT` (**default now 10**
  — it had drifted to 50 in code), `PROFESSIONAL_EXAM_FREE_QUESTIONS` (**default 5**). Read by
  `src/server/professionals/professionalPaid.ts`; decided in `passGate.ts` (`gateProfessionalTurn`,
  `gateProfessionalExam`).
  🔴 **WHY "SAB FREE" WAS TRUE:** the allowance rode on `PROFESSIONAL_PAID_ENABLED` — the switch for
  SELLING a Pass, which was retired and never set — so nothing was ever counted; and even switched on,
  nothing told the charge that a counted free message was free. Counting now has its own switch, and
  `billableFraction` on the charge context (`aiTurnCharge.ts`) carries "this one is free" to the wallet:
  `0` ⇒ reason `free-allowance`, never a debit.
  🔒 **THE ORDER:** free messages first (free chain, never charged, **never refused for an empty
  wallet**); the 11th and every later answer is ALLOWED on the paid chain and charged its real cost +
  markup from the one wallet, refused only when that wallet is empty (with the free-used reason named).
  Doctor AI shares the same 10. Free-list and a Pass holder stay unlimited. **A guest must now sign in**
  — an anonymous allowance cannot be counted, so guests who used Teacher AI etc. without limit now see
  the sign-in card (which gained a real Sign in button). Without `AI_WALLET_SPEND=on`, "then paid"
  cannot be charged, so past the allowance is the honest block, never a silent free answer.
  🎓 **EXAM:** its own counter (`professional_exam_usage`), in QUESTIONS — a paper is SPLIT (2 free left
  + 10 asked = 2 free, 8 paid, charged `8/10` of the paper's real cost), priced on what was DELIVERED.
  An unusable paper is now charged NOTHING (the charge used to run before that check).
  ⚠️ **SAID PLAINLY, because the admin chose it knowing:** "paid" = real cost + markup, and the
  professionals' leader model is the free GLM-flash rung for BOTH tiers, so many paid answers still
  cost ₹0. That is the admin's "Asli kharcha + markup" decision, not a bug.

- **📚 EXAM MODE IS SET FROM PREVIOUS-YEAR QUESTIONS — 40 / 30 / 30 (admin 2026-09-24).**
  `PROFESSIONAL_EXAM_PYQ` — ⚠️ **NOT set, and the code default is ON**; `off` is the instant,
  no-deploy revert and leaves the paper prompt byte-identical to what it built before. Read by
  `examPyqEnabled()` in `src/server/professionals/examMode.ts`.
  Admin: *"exam mode me jo questions puche jaye woh PYQ (previous year question) hone chahiye …
  40% pyq / 30% pyq se milte julte / 30% new but, exam me ane ki puri sambhavna"*. `examBlend`
  splits the paper by largest remainder so the three counts sum to EXACTLY what was asked (5 → 2/2/1;
  `Math.round` per share gives 2/2/2, a sixth question nobody ordered).
  🔴 **COMPOSITION IS ASKED FOR; PROVENANCE IS FORBIDDEN, and that is the admin's own correction.**
  I objected that we cannot PROVE a question is a genuine PYQ; they answered *"hame yeh sabit hi nahi
  karna hai ki yeh pyq hai, hame bs question dene hai. user khud, samajh jayega."* So the prompt tells
  the generator where to draw each question from and, in the same paragraph, **never to write a year,
  a paper name or a kind onto any question** — a "(UPSC 2019)" in the question text is an unverifiable
  claim reaching a student through the one field the surface prints verbatim, i.e. the fake badge the
  second absolute rule forbids. A better-composed paper is not a badge.
  ⚠️ **ONLY WITH AN EXAM SELECTED** (`examTargetBrief` non-empty — the SAME answer the prompt already
  uses, never a second rule that can disagree with it): "previous year" has no referent on a plain
  "Trigonometry, 10 questions", and demanding 40% of one there would be asking the generator to invent
  the provenance this design refuses to print.
  💸 **It costs NOT ONE extra call and no web search.** The composition is an instruction inside the
  SAME single model call that already writes the paper — test-locked, because "scan the internet for
  PYQ" is the reading of the request that would have added a search per paper.
  Test-locked and **reversion-proven four ways** in `tests/theExamAsksWhatTheExamAsks.test.ts`.
- **The MID-BUILD cost stop (shipped 2026-09-13):** `AGENTV3_BUILD_COST_CEILING_USD` — ⚠️ **NOT set,
  and the code default is what governs today.** The ceiling on ONE build's REAL provider cost, in USD.
  **Default $5**, capped at $50, read by `src/server/AgentV3/buildCostCeiling.ts` and evaluated inside
  `captureTurnUsage` in `routes/agentv3.ts` — the one point every build turn and every heal turn passes
  through.
  🔴 **WHY IT EXISTS, AND WHAT THE WALLET FLOOR DOES NOT DO.** The floor (`WALLET_OVERDRAFT_FLOOR_INR`)
  bounds what the USER is billed; it cannot un-spend what the model already cost us. Every START gate
  was already correct — a new build is refused at a balance of 0 or less — but nothing looked at the
  cost of the build ALREADY RUNNING, so one legitimately allowed to begin could spend for its whole
  wall clock and present the invoice at the end. This is the other half.
  🔒 **IT IS A STOP, NOT A KILL, which is why it can ship on by default.** `AgentRunner` ends BETWEEN
  turns, the files written so far are already persisted, and the user is told their work is saved and
  one message resumes it (`abortSummary('cost-cap')`). No work is lost — the build pauses.
  📌 **THE NUMBER WAS REUSED, NOT INVENTED.** $5 is this repo's own existing answer to a runaway build
  (`sessionCostCapUsd()`, since the "$26 todo app"). It sits under its OWN key because extending
  `SESSION_COST_CAP_USD` would silently re-purpose a value an admin may have set for the empty-build
  retry budget. For scale, real builds here cost **$0.4–$1.0** (the ₹566.96 Shiv Medical Store build;
  PaisaTrack's real ₹39 ≈ $0.45), so $5 is five to ten times a heavy normal build.
  ⚠️ **THE LIVE FIGURE IS AN UNDER-ESTIMATE, DELIBERATELY.** The ledger sees the architect, its
  sub-agents and every heal runner, but NOT the aux calls (blueprint/plan/judge), which reconcile into
  'other' only at settle. So the stop fires LATER than a complete number would justify — never earlier.
  A malformed value falls back to $5, **never to "no ceiling"**; only an explicit `0` disables it.
  Report code: `COST_CEILING_REACHED` (admin-only). Test-locked in `tests/buildCostCeiling.test.ts`.
  🔴 **STILL OPEN:** an abandoned provider call is not cancelled by this stop — the loop ends between
  turns, so a call already in flight runs to completion on the provider's side and is paid for.

- **🐢 THE SLOW-PROVIDER FIX — streamed build calls (built 2026-09-16; ✅ **SET `on` in Cloud Run by the
  admin the SAME DAY**):** `AGENTV3_STREAM_BUILD_CALLS` = `on`, so streamed reading is LIVE on every
  GLM/Kimi build call. ⚠️ **It had never run against a live provider when it was switched on** — the
  flag exists precisely so it reverts with no deploy, and the first real builds are its first evidence.
  Unsetting it restores today's pre-change behaviour to the byte: one non-streaming request, the total
  clock, the existing ceiling. The two tunables were deliberately **left UNSET** (admin, same message),
  so their code defaults govern: `AGENTV3_STREAM_IDLE_MS` (**60 s** — silence after which a provider
  counts as stalled) and `AGENTV3_STREAM_HARD_CAP_MS` (**300 s** — the absolute ceiling on one streamed
  call).
  Read by `src/server/AgentV3/providers/openAiStream.ts`; applied in `OpenAiToolRunner` and in
  `openAiCompatRunners` (`routes/agentv3.ts`).
  **WHY (admin 2026-09-16: "kimi aur glm slow hai, time out ho jata hai").** The GLM/Kimi rung sends ONE
  opaque request bounded by a TOTAL wall clock (`floorBudget.ts`: 5 s + 30 ms × tokens, capped 150 s).
  A total clock cannot tell a HUNG provider from a merely SLOW one and kills both — **and when it
  fires, nothing comes back**: the files that answer had already written are lost with it. The output
  ceiling is sized from the same clock (~4,800 tokens), so a big file needs more turns, each of which
  can be killed the same way.
  🔑 **THE CHANGE: the bound becomes SILENCE, not duration.** A provider emitting tokens is not hung
  however slow it is. So a streamed turn is killed only after `AGENTV3_STREAM_IDLE_MS` of total quiet —
  and a stall **keeps what already arrived**, returned as a TRUNCATED turn, which is the one shape the
  engine already recovers from (the adapter salvages the cut file's path, the truncation guard names
  it, the next turn rewrites it). "One file short" instead of "no app".
  ⚠️ **TWO THINGS RIDE THIS ONE FLAG, and the second is not obvious from its name.** (1) The SDK client
  is constructed with the stream's hard cap instead of the floor bound — otherwise the SDK would abort
  a healthy stream at 150 s and defeat the whole change. (2) `reconcileFloorBudget` sizes the token ask
  from whatever clock bounds the call, so a 300 s ceiling authorises ~9,800 output tokens instead of
  ~4,800 — **fewer turns per file**, which is the second half of the speed win. That is coherent rather
  than incidental: the clamp exists because a timeout used to lose everything, and under streaming it
  no longer does.
  🔴 **THE ONE HONEST COST, stated rather than discovered later: a stream carries NO token usage unless
  the provider honours `stream_options.include_usage`.** The request asks for it; whether Z.ai and
  Moonshot answer it is a fact only a real call can settle. If they do not, `usage` is **zero** — never
  an invented number (THE ONE-WALLET LAW forbids estimating tokens from text length), so the USER is
  never over-billed, but OUR cost report under-states itself. **What to watch on the first real builds:
  streamed turns showing 0 input/0 output tokens in the admin build report.** If they do, unset the
  flag and the honest-but-unmeasured path goes away with it.
  🔒 Nothing else changes: the lane deadline still wins whenever it is nearer (`turnDeadline` remains
  the authority on the budget), our clock ending still reads as OUR budget and never benches a
  provider, a stall with only reasoning and no answer is still a rung FAILURE (the chain falls to the
  next vendor), and an abandoned read is aborted so a call nobody will read stops generating and stops
  billing. Test-locked in `openAiStream.test.ts` (the accumulator, pure) and `openAiStreamRunner.test.ts`
  (the behaviour), both proven by reversion.
- **🧠 THE FORCED-REASONING UNCLAMP — our own ceiling was the total loss, not the clock (built
  2026-09-17, autopsy f5351721). ⚠️ NOT set, and the code default is ON**; `AGENTV3_REASONING_UNCLAMP=off`
  is the instant, no-deploy revert to the pre-2026-09-17 behaviour exactly. Read by
  `src/server/AgentV3/floorBudget.ts`; the capability question is answered by `modelAlwaysReasons` in
  `providers/glmThinking.ts` and asked once in `OpenAiToolRunner`.
  🔴 **WHY: `floorBudget.ts` clamps a turn's token ask to what the clock can carry, and justifies it on
  one asymmetry — a ceiling hit returns the files written so far, a clock kill returns nothing. For a
  model that ALWAYS REASONS both halves are false, in opposite directions.** Its thinking is billed to
  the same `max_tokens` and emitted BEFORE any content, so running out of CEILING is the total loss
  (`turnStarvedItsBudget` — no text, no tool call), while running out of CLOCK under streaming keeps
  whatever arrived. The clamp was trading the recoverable outcome for the unrecoverable one.
  **The evidence (Strong tier, `glm-5.3`, 30 calls): 3 returned reasoning and nothing else, each
  authorised exactly 9,833 tokens, and the first finished 131 seconds into a 300-second clock — out of
  ceiling with 58% of its time unused.** The calls that survived used 8,651 / 9,199 / 9,746 tokens
  against that 9,833 ceiling, so every first turn was a coin flip decided by how long it happened to think.
  ⚠️ **THE FIX IS NOT A FASTER RATE CONSTANT — that was measured and REJECTED, and the measurement is
  the reason this entry exists.** Across 73 real calls in the reports to hand,
  `FLOOR_MS_PER_OUTPUT_TOKEN_DEFAULT` is well calibrated: kimi-k2.6 aggregates to **30.5 ms/token**
  against our 30, fleet median 25.1, p90 48.1. Lowering it to suit the one fast model would under-bound
  every slow one and re-open the class `floorBudget.ts` was written for. The rate is right; applying it
  to tokens that are not the answer is what was wrong. **Do not "simplify" this by retuning the
  constant** — a test asserts it stayed at 30.
  🔒 **IT CANNOT MAKE THE WORST CASE WORSE, which is what made it shippable without touching the
  admin-mandated ladder.** The clock still bounds the call: a slow forced-reasoning rung is cut at the
  same moment it is cut today, still with no answer, and still throws to the next rung. Only the case
  where the answer WOULD have fitted changes. Cost is unchanged on a normal turn — authorising tokens
  does not spend them.
  ⚠️ **`modelAlwaysReasons` IS A POSITIVE TEST, NOT `!glmCanDisableThinking`, and the difference is a
  real bug avoided.** That helper denies on anything it does not recognise, because sending an
  unsupported field is a hard 400 — denial-on-unknown is right THERE. Negating it would assert
  "kimi-k2.7-code always reasons" purely because the id failed a `startsWith('glm-')` check, handing an
  unbounded budget to a vendor nobody has measured. So the new predicate is FALSE for every non-GLM
  vendor, which keeps today's clamp for them exactly.
  ✅ **THE KIMI SIBLING IS CLOSED — corrected 2026-09-18, because this paragraph still said it was
  open and sent a session to rebuild what already exists.** It read: *"STILL OPEN (rule 6): the Kimi
  sibling … this repo holds no capability fact for Moonshot's models, and inventing one would be a
  guess. The honest generic fix (remember a rung that starved and unclamp its NEXT call) needs
  cross-turn state the per-rung runner construction does not currently carry."* **Both halves now
  exist**, verified against `main` rather than taken from this file:
  • **The capability fact is MEASURED, not guessed** — `MEASURED_ALWAYS_REASONS = ['kimi-k2.7-code']`
    in `providers/glmThinking.ts`, derived from two independent admin reports (`58fe8254`, four
    starvations; `d98dae01`, two more) and matching `-highspeed` by prefix because it is the same model
    served faster. `kimi-k3` is deliberately NOT in it — nobody has measured it.
  • **The cross-turn state exists** — `rememberStarvedWhileClamped` / `modelStarvedWhileClamped`
    (`providers/OpenAiToolRunner.ts`), a per-process memory fed from the starvation throw and read at
    `reconcileFloorBudget`'s `alwaysReasons`, so a model that starves ONCE while clamped is never
    clamped again in that process.
  ⚠️ **The lesson is safeguard #6 applied to this file itself: a "STILL OPEN" note is a claim with a
  date on it, and the code moves under it.** Re-grep before acting on one — an open item that is
  actually closed costs a session the same investigation twice, and this one nearly did.
  🔒 **Honesty half:** a rung that starves with the clamp ALREADY LIFTED must not be reported as "our
  own ceiling" — that sentence would send the next autopsy to fix arithmetic that is already correct.
  `isUnclampedStarvation` splits the two wordings in `BuildDiagnostics`. Test-locked and proven by
  reversion in `tests/reasoningBudgetUnclamp.test.ts` (19 cases).

- **🐌 THE THROUGHPUT BENCH — the other half of the entry above (built 2026-09-16, autopsy dd1f5f60).
  ⚠️ NOT set, and the code defaults govern: the feature is ON.** `AGENTV3_SLOW_RUNG_BENCH` (`off` is
  the instant, no-deploy revert to the pre-2026-09-16 behaviour exactly), `AGENTV3_SLOW_RUNG_RATIO`
  (**2.5**) and `AGENTV3_SLOW_RUNG_MIN_CALLS` (**3**). Read by `src/server/AgentV3/slowRungBench.ts`;
  applied in the SUCCESS path of `MultiProviderTurnRunner`.
  🔴 **WHY, in one sentence: a free-tier build ran 30 minutes, wrote 2 files, never produced a preview
  — and every single one of its 11 model calls SUCCEEDED.** GLM delivered 15,330 output tokens in
  1,771 s = **8.65 tokens/second**, against the ~33 tok/s that `floorBudget.ts` already calls the point
  past which a provider is *"one we would rather fall past than sit behind"*. 29.5 of the 30.1 minutes
  were inside a provider call; **our own engine's total work was 7.9 seconds.**
  🔑 **THE CLASS, named so it is recognised again: EVERY escalation path in `MultiProviderTurnRunner`
  — timeout bench, 429 bench, shared cooldown, dead-rung memory, rung advance — lives inside a
  `catch`.** A provider that is merely SLOW throws nothing, so it reached none of them: the ladder
  never left rung 1 and KIMI sat one step away for twenty-nine minutes. And the 30 ms/token constant
  that defines "too slow to wait for" was read by **no file except the one that defines it** — it
  sized requests and judged nothing.
  ⚠️ **STREAMING WIDENED THIS, and that is not an argument against streaming.** Bounding a call by
  SILENCE assumed two kinds of provider, healthy and stalled. A **steadily slow** one is a third: it
  never goes quiet (so the 60 s idle bound never fires) and it always has an answer (so hitting the
  300 s ceiling returns a truncated SUCCESS, not a failure). The ceiling a single slow rung can hold
  also doubled, 150 s → 300 s, the same day. Do not reason about streamed calls from the two-case
  model — there are three.
  🔒 **FOUR PROPERTIES NOT TO "TIDY UP".** (1) It can ONLY move a build to the next rung — never fail
  one, never shorten a call, never change what a provider is asked. (2) **It never benches the last
  engine** (`canBenchAnother`): every other bench retires a rung that CANNOT answer, this one retires
  a rung that CAN, and a slow app beats no app — when the last one is judged slow the report says so
  once, explicitly. (3) An **unmeasured** turn is discarded, never guessed: a stream without
  `include_usage` reports 0 tokens, and counting that would score a 300 s call at 60× and retire a
  healthy vendor on a number nobody measured. (4) A ratio **≤ 1 is REFUSED** and falls back to 2.5 —
  at 1.0 it would retire every provider on earth including the backstop, so here the dangerous
  direction is a SMALLER value, not a larger one.
  📌 Keyed by **FAMILY + MODEL**: family so a 50-key pool accumulates one verdict, model so
  `glm-5.3-flash` being slow never retires `glm-5.3` — a LATER rung of the same weak ladder. The
  verdict is **latched in the state** because on the real data it flickers (3.43× → **2.46×** → 3.5×);
  the runner happened to latch it in a `Set`, which hid the defect. Test-locked and reversion-proven
  in both halves in `tests/slowRungBench.test.ts`.
  ✅ **AND THIS REPORT SETTLED THE STREAMING ENTRY'S ONE OPEN QUESTION: Z.ai DOES honour
  `stream_options.include_usage`** — real per-call input/output/cache token counts came back on every
  streamed call. The "0 in / 0 out" risk that entry warns to watch for did not materialise.
- **The referral welcome gift — four earned steps (built 2026-09-15, NOT live yet):**
  `REFERRAL_REWARDS` (the master switch — ⚠️ **UNSET, and unset means today's behaviour exactly**:
  no code is minted, no money moves, and not one document is written). Tunables, all with working
  code defaults: `REFERRAL_STEP_TOKENS` (**₹100** per step for the new user), `REFERRER_STEP_TOKENS`
  (**₹25** per verification for the referrer) and `REFERRER_LIFETIME_CAP_TOKENS` (**₹1,500**, the
  most one referrer may EVER earn — admin-mandated). Read by `src/server/lib/referralRewards.ts`;
  the routes are `GET/POST /api/referral/...` (`routes/referral.ts`).
  **THE PLAN, and the totals are the point:** a new user earns ₹100 each for applying a referral
  code, verifying email, verifying mobile and connecting GitHub (**₹400**); the referrer earns ₹25
  for each of that friend's THREE verifications (**₹75**). One referred user costs **₹475** —
  *below* today's flat ₹500 welcome gift — and an organic app user with no code costs ₹300. This
  REPLACES `giftPlan.ts`'s flat grant for accounts on it; the two must never both pay, which is what
  the master switch is for.
  🔒 **WEBSITE: ₹0, AND THAT IS THE WHOLE DESIGN** (admin: *"websites par kuch bhi nahi dena"*).
  Every rupee is claimed inside the Android app behind a device check. A free mailbox and a free
  GitHub account cost nothing and take three minutes, so ₹200 reachable from a laptop would be an
  unlimited, scriptable printer that never meets the device check. **Half a gate is no gate.** A code
  can still be SHARED from the website — only claiming is Android-only.
  🔒 **THE REFERRER IS PAID FOR VERIFICATIONS, NEVER FOR A REDEMPTION, and nothing releases until the
  friend's MOBILE is verified.** Paying on redemption is what would make a CHAIN — one "mother"
  account farming a throwaway per cycle, earnings concentrating in one usable wallet. A device id
  resets on a factory reset (~18 minutes, ₹0 cash); a phone number does not. The device bounds how
  many accounts exist at once; only the phone bounds how often the same person returns.
  ⚠️ **A MALFORMED tunable falls back to its default, and a BLANK one means UNSET — not zero.**
  `Number('')` is **0**, not NaN, so without that check a key present-but-empty in Cloud Run (a
  cleared field, a dropped paste) would have read as a deliberate zero. On the lifetime cap that is
  "no referrer ever earns anything, for ever", with the console showing the key as configured and
  nothing failing anywhere. An explicit `0` is still honoured — nobody types a zero by accident.
  🔎 **HOW TO CHECK IT WITHOUT GUESSING (added 2026-09-19):** admin → Reports → Referral cost →
  **"Check referral setup"** (`GET /api/admin/referral/preflight`, `src/server/lib/referralPreflight.ts`).
  It asks Google with the real credential and the real package and names the missing step — a 400 on
  the probe is the GOOD answer. Two links it cannot see are listed as hand work: the repo secret at
  build time, and Play → Data safety. ⚠️ **Since #3030 (2026-09-17) the flat welcome gift is RETIRED
  by the admin's own ruling, so with this flag unset a new account receives ₹0 — that is the ruling
  landing, not a regression** (admin report 2026-09-19).
  🔴 **A CLAIM IS A REQUEST, NOT A FACT.** The first version of the claim route proved WHO was asking
  (the device) and WHETHER anything was owed (the paid-steps list) and never asked whether the step
  had been DONE — so any caller on a genuine Android phone could POST all four and collect ₹400 per
  device. `stepIsProven` now reads Firebase's own account record (emailVerified, a verified phone,
  `github.com` among the linked providers) and our store for the referrer, never the request body.
  **Do not add a step without a proof rule**; `stepIsProven` is deliberately total rather than
  defaulting, so a fifth step is unpayable until someone decides how it is proven.
- **🎁 THE REFERRAL LADDER IS THE ONLY WELCOME CREDIT — the ₹250 welcome backfill is DELETED (admin
  2026-09-26: *"ab isko har jagah se hata do, bas referral wala chhor do, 100*4 chhorna hai"*).** The
  backfill (built 2026-09-20 for accounts opened while no welcome credit existed, already switched off
  with `WELCOME_BACKFILL=off` the same morning) is removed from the code: `welcomeBackfill.ts`, the
  `/api/admin/welcome-backfill` routes, the admin card and its test. **`WELCOME_BACKFILL`,
  `WELCOME_BACKFILL_TOKENS` and `WELCOME_BACKFILL_SINCE` are now read by nothing** and may be deleted
  from Cloud Run. Any `payment_transactions/welcome_backfill_<uid>` records and ledger rows it wrote stay
  as history — a paid credit is never taken back. Do not rebuild it: the 4 × ₹100 referral ladder below
  is the plan.
  🔴 **AND EVERY OTHER WELCOME GRANT IS DELETED TOO, the same day (admin: *"100*4 ko chor ke sab hata
  do"*).** Gone from the code, not switched off: the legacy flat bonus (`welcomeBonus.ts`), the ₹250/₹500
  v2 plan and its phone-bonus claim (`giftPlan.ts`, `POST /api/wallet/:uid/claim-phone-bonus`,
  `PhoneBonusCard`), the weekly top-up ladder (`weeklyTopUp.ts`), the ₹50 interim credit
  (`interimWelcomeGift.ts`), `welcomeGiftExclusion.ts`, and the wallet screen's `FreeGiftBanner`. **A new
  wallet opens at ₹0** (`newWallet.ts`), and the wallet response no longer carries a `freeGift` field.
  **`WALLET_GIFT_V2`, `GIFT_UNVERIFIED_TOKENS`, `GIFT_VERIFIED_TOTAL_TOKENS`, `WEEKLY_TOPUP_TOKENS`,
  `INTERIM_WELCOME_TOKENS` and `GIFT_ID_PEPPER` are now read by nothing** and may be deleted from Cloud
  Run. ⚠️ **`WELCOME_BONUS_TOKENS` is the one exception — keep it if it is set:** `accountMerge.ts` still
  reads it to tell how much of an OLD wallet's `totalTokensPurchased` was a past welcome gift rather than
  money paid. ⚠️ **What this makes true, said plainly:** with `REFERRAL_REWARDS` off, a new account
  receives nothing at all — the ₹50 interim credit existed because a Play reviewer on a ₹0 account hit
  a paid image rung and Google rejected a release (2026-09-22). The ladder is on today, so that is not
  the live state; switching it off would re-create that condition. Test-locked in
  `tests/theReferralLadderIsTheOnlyGift.test.ts`, which also asserts the ladder itself survived.
  📌 **STANDING DECISION (admin 2026-09-20): the referral code system starts when the new app is LIVE
  on the Play Store — not before. Do NOT set `REFERRAL_REWARDS` until then.**
  ✅ **THE CONDITION IS MET AND THE ADMIN SET IT ON — `REFERRAL_REWARDS = on` in Cloud Run (admin,
  2026-09-26), with build `134` now live on Play (preflight-verified).** Recorded hand-to-hand the same session, per this
  registry's rule. Turning it on ALSO stands down every other welcome grant by construction — the flat
  gift and the weekly ladder are already hardcoded off (`giftPolicy.ts`), and the legacy bonus, the v2
  plan and the interim gift all read `flatWelcomeGiftSuppressed` (= `referralRewardsEnabled`), so the
  4×₹100 ladder becomes the SOLE payer with no other key touched. ⚠️ **Enabled ≠ paying:** the device
  check FAILS CLOSED, so a claim still pays ₹0 unless the Play Integrity chain is right. The admin ran
  the switch-on before the preflight; verify against **admin → Reports → Referral cost → "Check referral
  setup"** (`referralPreflight.ts`) rather than assuming it pays. Two links the preflight cannot see stay
  the admin's to confirm: the `PLAY_INTEGRITY_CLOUD_PROJECT` repo secret at build time, and Play → Data
  safety.
  ✅ **PREFLIGHT RAN 2026-09-26 → "READY TO PAY", all six rows green** (admin screenshot): package
  `com.navbharat.ai`, service account configured, SA can mint a Play Integrity token, Play Integrity API
  refused the probe token as intended, release 134 carries the device check, `REFERRAL_REWARDS` on. The
  two `manual` links above were STILL outstanding at that moment (the release row is green only "provided
  the repo secret was set when it was built" — the preflight cannot see that), so a real-phone claim can
  still pay ₹0 until the admin confirms both. Counters read ₹0 / 0 referred, as expected before anyone
  completes a step.
  ✅ **REPO-SECRET LINK CONFIRMED 2026-09-26 — the admin verified `PLAY_INTEGRITY_CLOUD_PROJECT` was set
  BEFORE build 134 was built**, so the project number is baked into that `.aab` and build 134 genuinely
  device-attests on a real phone (a claim pays the real ₹, not ₹0). This closes the first of the two
  hand links; **the second, Play Console → App content → Data safety declaring the device identifier,
  remains outstanding** — it is a Play-policy compliance item (Privacy Policy §3.2 already discloses the
  identifier), NOT a payment blocker: the device check works regardless, but a Data-safety declaration
  that contradicts the policy is a violation. So referral is live and paying end-to-end; only the Play
  declaration is left, and it does not gate a rupee.
  ✅ **DATA-SAFETY LINK CONFIRMED 2026-09-26 — the admin verified the live public store listing already
  declares "Device or other IDs" under Data safety** (`play.google.com/store/apps/details?id=com.navbharat.ai`),
  matching Privacy Policy §3.2. Both hand-verified links are now closed: the referral welcome ladder is
  live, paying real rupees on a real phone, AND policy-compliant. Nothing about the referral switch-on
  remains outstanding.
- **Play Integrity — the device check (built 2026-09-15). ⚠️ NOT a Cloud Run key:**
  **`PLAY_INTEGRITY_CLOUD_PROJECT`** is a **GitHub REPO SECRET** read at BUILD time by
  `android/app/build.gradle`, because it is baked into the `.aab`. It is the Google Cloud project
  **NUMBER** that owns the Play Integrity API — ⚠️ **the digits, not the project id**
  (`gen-lang-client-0866594388` is the id; the number is beside it on the console home). A
  non-numeric value parses to 0 and reads as "not configured", which is the safe direction.
  Recorded here anyway so nobody searches Cloud Run for it and concludes it is missing.
  **Three things must ALL be true before a bonus can be paid**, and each failure is honest and
  visible rather than silent: (1) the **Play Integrity API is ENABLED** in
  `gen-lang-client-0866594388`; (2) the SAME service account already used for Play billing
  (`GOOGLE_PLAY_SA_JSON`, a Cloud Run key) also holds the **`playintegrity`** scope — one account,
  two scopes, and a token minted for a scope the account lacks is issued happily and then refused at
  the call; (3) a `.aab` carrying `DeviceIntegrityPlugin` is live on Play (release 91 and earlier do
  NOT have it). Until then every check is `unavailable`, which pays **₹0** — the gate FAILS CLOSED,
  deliberately unlike `jobLease.ts` and the web-risk budget, because there is no later gate to catch
  a wrong "yes".
  ⚠️ `buildFeatures { buildConfig true }` is required alongside it: AGP has generated `BuildConfig`
  only on request since 8.0 and this project is on 8.13, so without that line the failure is a
  missing-symbol compile error naming nothing useful.
  🔒 **Play Data safety must be updated before the next rollout.** Privacy Policy **§3.2** already
  discloses the device identifier (`tests/privacyPolicyTruth.test.ts` guards the policy), but a Play
  declaration that contradicts the policy is a violation, not a mismatch — and this is the same shape
  as the 2026-09-02 incident where the policy said "we never share your data with advertisers" while
  the Meta pixel was being built.
- **🔗 ANDROID APP LINKS — a navbharatai.com link opens the APP, not a browser (built 2026-09-19).
  ✅ `ANDROID_CERT_SHA256` IS SET, WITH BOTH CERTIFICATES (admin, 2026-09-22)** — recorded hand-to-hand
  the same session, per this registry's own rule. Verified rather than taken on trust: both hosts were
  fetched and returned IDENTICAL JSON carrying TWO well-formed fingerprints, the app signing key and
  the upload key, and `package_name` `com.navbharat.ai` — which matches `capacitor.config.ts`'s
  `appId` and `build.gradle`'s `applicationId`. The values are not written here (names only), but note
  that a fingerprint is public by construction: it is published at that URL by every app on earth with
  App Links on. **The keystore is the secret; the fingerprint is its public identity.**
  ⚠️ **THE SERVER HALF IS DONE; THE APP HALF IS NOT, AND THAT IS THE THING TO CHECK FIRST if links
  still open a browser.** The manifest claim landed on 2026-09-19 (`23e81dc9`), and the build LIVE on
  Play at that moment was **116, built 2026-09-15** — verified by reading its manifest at that commit,
  not inferred from the date: it carries **no `autoVerify` intent filter at all**. So on 116 the app
  never asks Android for those links and no server-side fix can change that. It takes a build from
  2026-09-19 or later to test any of this.
  ⚠️ **The old wording of this entry said the key was NOT set, and unset meant** — the
  `/.well-known/assetlinks.json` route answers 404, Android's verification fails, and every link keeps
  going to the browser. Read by `src/server/lib/assetLinks.ts`; the route is mounted in
  `server.ts` BESIDE the Apple one and for the same reason (`express.static`'s `dotfiles` default is
  `ignore`, so a `.well-known` path never reaches it).
  🔴 **THE VALUE IS NOT A SECRET, which is why it may be discussed here at all.** It is the SHA-256
  fingerprint of the app's signing certificate, and it is PUBLISHED at that public URL by every app on
  earth that has App Links on. The **keystore** is the secret; the fingerprint is its public identity.
  The admin reads it from **Play Console → Setup → App signing**. No session can read it — the keystore
  lives only with the admin (`ANDROID_KEYSTORE_*` are repo secrets Claude cannot see).
  ⚠️ **SET BOTH CERTIFICATES, comma-separated.** Under Play App Signing an app has two — the **upload**
  key the admin signs with and the **app signing** key Google re-signs with — and which one reaches a
  phone depends on how the app was installed. Listing one makes the other fail with nothing to see.
  🔒 **A MALFORMED ENTRY IS DROPPED, NOT PASSED THROUGH.** Android rejects the WHOLE statement file if
  any entry is malformed, so one typo would silently disable link handling for the good fingerprint
  beside it — the same shape as the trailing space in `BRAVE_API_KEY` and the `=` in
  `ALERT_EMAIL_FROM`. The route logs one admin line naming how many entries were unreadable, never the
  value.
  🔒 **THE CLAIMED PATHS ARE AN ALLOWLIST, AND THE MANIFEST CANNOT DRIFT FROM THE CODE.** `/`, `/admin`,
  `/store`, `/store/app/*` — exactly what `src/lib/deepLinkRoute.ts` can resolve, asserted against
  `AndroidManifest.xml` in both directions by `tests/aLinkOpensTheApp.test.ts`. **`/privacy` and
  `/terms` are deliberately NOT claimed**: Play and Meta fetch them with tools that may not run
  JavaScript, and a person who taps a privacy link asked for that page. Claiming a URL the app cannot
  serve is WORSE than not claiming it — the app opens, lands on Home, and the link is eaten.
  **How to verify it after setting it:** open `https://navbharatai.com/.well-known/assetlinks.json` in a
  browser (JSON back ⇒ configured; 404 ⇒ unset or every entry malformed), then reinstall the app and
  tap a navbharatai.com link. Android re-checks the file on install and periodically, so an app already
  installed may take a while — a reinstall settles it immediately.
  🔴 **THE `www` HALF COULD NEVER VERIFY UNTIL 2026-09-22, WHATEVER THE FINGERPRINT (Play Console:
  "2 domains not verified · 8 links not working", every row "Failed domain checks").** The manifest
  claims BOTH `navbharatai.com` and `www.navbharatai.com`, Android verifies each by fetching ITS OWN
  `/.well-known/assetlinks.json`, and the Digital Asset Links verifier does NOT follow redirects — yet
  the `CANONICAL_HOST` middleware (mounted first) 308'd every `www` path to the apex, the statement
  file included. `isWellKnownPath` in `canonicalHost.ts` now exempts the whole `/.well-known/` prefix
  (Apple's `apple-app-site-association` is the same class); the app itself keeps one canonical origin.
  **Two things must both be true for the Play "Deep links" page to go green: `ANDROID_CERT_SHA256`
  set (both certificates), AND the file answering 200 on BOTH hosts without a redirect.** ⚠️ And say
  it plainly when asked: a red Deep-links page is ADVISORY — it never blocks a release. An update that
  "will not publish" has its reason on Publishing overview or the release page, not here.
- **🛡️ APP CHECK — "is this the real NavBharatAI app?" on the routes that spend money (built 2026-09-26,
  admin: *"App Check shuru karo"*). Slice 1 = WEBSITE + server monitor.** Two keys, NEITHER set:
  `APP_CHECK_SITE_KEY` (a **reCAPTCHA Enterprise site key** — public by construction, served by
  `/api/public-config`; unset or malformed ⇒ the website starts no App Check at all) and `APP_CHECK_MODE`
  (`monitor` default · `enforce` · `off`; an unreadable value means `monitor`, never `enforce`). Read by
  `src/server/lib/appCheck.ts` + `src/lib/appCheckClient.ts`; the guarded list is ONE file both sides read,
  `src/lib/appCheckRoutes.ts` (build, chat, image, Professionals/Exam, Repo Analyst, send-otp — POST only).
  🔒 **SCOPED TO MONEY ROUTES ON PURPOSE:** navigations (OAuth callbacks, preview iframe, share pages)
  cannot carry a header, and outside servers call the payment webhook, bot webhooks and the Developer API
  (`/api/chat/completions`, API-key auth) by design. 🔒 **A verifier that cannot run FAILS OPEN even in
  enforce** — our outage must never become every user's refusal. 🔒 **The client can never stop a
  request**: no key / blocked reCAPTCHA / slow token (1.5 s cap) ⇒ sent without the header.
  ⛔ **DO NOT SET `APP_CHECK_MODE=enforce` YET.** The phone apps do not send tokens until slice 2 (a native
  Play Integrity / App Attest plugin ⇒ a fresh `.aab`/`.ipa`), so enforce would refuse every installed
  Android/iOS build on its next build or chat. Read `GET /api/admin/app-check` first — it counts
  valid/missing/invalid/unverifiable **per web and per native**, per instance since boot.
  ⛔ **AND DO NOT turn on App Check ENFORCEMENT in the Firebase console for Firestore/Auth** — the phone
  apps talk to Firestore directly and would lose it. Registering the web app with the site key is safe;
  the console's *Enforce* buttons are not, until slice 2 ships and the numbers say so.
  **Admin setup (web):** Google Cloud → Security → reCAPTCHA Enterprise → create a *Website* key for
  `navbharatai.com` and `www.navbharatai.com` (no localhost) → Firebase console → App Check → register the
  web app with that key → set `APP_CHECK_SITE_KEY` in Cloud Run. The privacy policy (§3.3, §7) already
  discloses reCAPTCHA; `tests/appCheck.test.ts` holds that and the shared route list.
- **Visitor analytics for published apps (shipped 2026-09-10, ROADMAP §13 item 1.1):**
  `AGENTV3_SITE_ANALYTICS` (kill switch — **default ON**; `off` stops the beacon being stamped at
  publish and the hit route recording; apps already published keep their script until republished,
  which is harmless because the route then discards hits), `SITE_ANALYTICS_SALT` (optional — the HMAC
  secret behind the daily-rotating visitor hash; **falls back to `SECRET_ENCRYPTION_KEY`**, which is
  set, so nothing needs adding; a per-process random salt is the last resort and dedups uniques per
  instance only, logged once), `SITE_ANALYTICS_SHARDS` (default 8, clamped 1–64 — documents per
  app-day; §SCALE-PLAN item 1 applied on day one), `SITE_ANALYTICS_FLUSH_SECONDS` (default 20,
  clamped 5–300). Read by `src/server/lib/siteAnalytics.ts` / `siteAnalyticsStore.ts`. The beacon
  posts to `PUBLIC_BASE_URL` when set, else `https://navbharatai.com`. 🔒 What it collects is stated
  in the Privacy Policy §12 and pinned by `tests/privacyPolicyTruth.test.ts` — adding a field to the
  beacon fails CI until the policy discloses it.

- **Outbound alert email — NOW LIVE (admin SET in Cloud Run 2026-09-10):** ✅ **`ALERT_EMAIL_API_KEY`**
  (a Resend key) and ✅ **`ALERT_EMAIL_FROM`** = `alerts@send.navbharatai.com`. Read by
  `src/server/lib/alertEmail.ts`; the endpoint defaults to Resend's (`ALERT_EMAIL_ENDPOINT` overrides it
  for a provider with a compatible shape). **This is what finally turns email on for BOTH alert paths**
  — the admin Monitor's own alerts (`monitorAlerts.ts`) and, more importantly, the per-user "your site
  is down" mail from the uptime sweep, which until today could only ring the in-app bell.
  **`ALERT_EMAIL_TO` is deliberately NOT set** — it falls back to the admin list, and user alerts pass an
  explicit recipient (the owner's own verified address) anyway, so setting it would only risk sending a
  user's outage mail to the admin list.
  📌 **The sender lives on a SUBDOMAIN, `send.navbharatai.com`, and that was the point.** Verifying the
  root domain would have put Resend's records beside the live site's own DNS; the subdomain keeps every
  record under `send.` so `navbharatai.com` itself was never touched (verified during setup: the root A
  records still answered with Google's IPs throughout). DNS is at **Hostinger**, sending region Tokyo
  (`ap-northeast-1`). The FROM address is recorded here because it is public by construction — it appears
  in the header of every mail we send — unlike the key, which is not written down anywhere.
  ⚠️ **A MALFORMED sender used to read as CONFIGURED, and it nearly shipped that way.** During this very
  setup `ALERT_EMAIL_FROM` was first entered as `NavBharatAI = alerts@send.…` (an `=` where `<` and `>`
  belong); `resolveEmailConfig` only checked that the value was non-empty, so the Monitor would have
  shown a green "Alerts reach you by app and email" while the provider rejected every send. Fixed the
  same day — the sender's SHAPE is now validated (`senderAddress`, both `a@b.c` and `Name <a@b.c>`
  accepted) and anything else is refused by name. Test-locked in `alertEmail.test.ts`.
- **🔴 ALERT NOISE — ONE MAIL PER EPISODE, TWO AT MOST, THE SECOND 48 h LATER (admin-mandated
  2026-09-12).** The admin's inbox showed `ALERT → Resolved → Warning → ALERT → Resolved` for ONE
  condition inside two hours, and said plainly: *"yeh alert to user ko bhaga dega… ek information ke
  liye bas 1 mail only. agar jyada jaruri hai, to maximum 2 — woh bhi 48hr baad."* Two independent
  bugs produced it, and both are fixed in `monitorAlerts.ts` / `metricsAlerts.ts`:
  **(1) Resolving DELETED the alert's state, so the cooldown was bypassed by the very thing it existed
  to survive.** A metric hovering at its threshold resolved, forgot it had ever fired, and the next
  crossing was a BRAND NEW alert that announced itself immediately — two mails per wobble, no quiet
  period at any point. A condition that stops firing now enters a COOLING period
  (`MONITOR_ALERT_RESOLVE_AFTER_MINUTES`, default **120** — twice the one-hour metric window, so a
  wobble inside one window cannot end an episode); re-firing inside it is the SAME episode and says
  **nothing at all**. `0` is refused and falls back to the default, because zero is precisely the bug.
  **(2) `SLOW_BUILD_MIN_SAMPLE` was 3.** Three builds is not a sample: with a 30-minute build ceiling
  ONE slow build among three drags the hour's mean over the 10-minute line by itself, and the next
  hour drops it back. Raised to `ALERT_MIN_SAMPLE` (**10**) — this file's own existing answer to "how
  many points before a mean is worth waking someone for", not a new invention.
  **The budget is now hard:** `MAX_NOTIFICATIONS_PER_EPISODE = 2`, and `MONITOR_ALERT_COOLDOWN_MINUTES`
  defaults to **48 h** (was 6 h; the ceiling rose 24 h → 7 days so 48 can actually be set). ⚠️ An
  ESCALATION (warning → critical) now SPENDS the second slot instead of being exempt — "maximum 2" is
  the instruction, and an exemption is how a cap quietly becomes a suggestion. A condition nobody fixes
  therefore costs exactly two mails, ever. `MONITOR_ALERT_RESOLVED=off` drops the all-clear mails too.
  🔎 **THE SIBLING, FIXED IN THE SAME CHANGE (rule 3):** the per-user "your site is down" mail had the
  IDENTICAL root cause. Recovery set `alerted = false`, and the next outage then took the
  `!prev.alerted` branch — **which never consults the cooldown** — so a flapping host mailed its owner
  on every single transition. `SUCCESSES_BEFORE_CLEAR = 2` now makes a recovery hold for two good
  probes, symmetrically with the two bad ones that raise the alarm. A genuine outage after a genuine
  recovery still alerts at once, which is why the fix is a confirmed recovery rather than a longer
  cooldown.
  ⚠️ **OPEN, AND DELIBERATELY NOT GUESSED: the 10-minute threshold itself.** Whether 10 min is actually
  abnormal for this engine needs the real distribution of build durations, which nobody has measured
  (`maxBuildSeconds` alone defaults to 30 min, so it may simply be set below normal). Replacing a noisy
  alert with a quiet one that is wrong would be worse — so the sample was fixed and the threshold is
  recorded here as an open question.
- **Site uptime alerts for connected domains (shipped 2026-09-10, ROADMAP §13 item 1.8):**
  `SITE_UPTIME_SWEEP` (kill switch — **default ON**; `off` stops the 15-minute probe of every connected
  custom domain), `SITE_UPTIME_COOLDOWN_HOURS` (default 6, clamped 1–72 — one "down" message per outage,
  then quiet while it stays down), `SITE_UPTIME_MAX_DOMAINS` (default 500, clamped ≤ 5000 — domains per
  sweep). Read by `src/server/lib/siteUptime.ts` / `siteUptimeSweep.ts`; registered in `server.ts` as the
  `site-uptime` scheduled job, **exclusive** (one instance probes). Email to the OWNER rides the existing
  `ALERT_EMAIL_*` mailer — ✅ **configured since 2026-09-10, so the email really sends now**; unconfigured
  ⇒ the in-app bell only, never a silent nothing. A probe that could
  not complete from our side is "unknown" and never counts as the user's site being down.

- **Secret-vault device lock (shipped 2026-09-12):** `VAULT_LOCK_ORIGINS` — ⚠️ **NOT set, and it should
  stay unset.** A comma-separated list of the origins a WebAuthn assertion may come from; UNSET uses the
  built-in defaults (`https://navbharatai.com`, `https://www.navbharatai.com`, plus localhost for the
  Capacitor shell and dev), which is what production needs. Setting it **replaces** the defaults, so a
  value that omits the live origin would refuse every device unlock — only set it to ADD a staging host,
  and include the production origins in the same list. A malformed entry is dropped rather than widening
  the set (test-locked), so a typo cannot turn into "any origin".
  🔒 **There is no secret to add for this feature.** The unlock challenge and ticket are signed with the
  `SECRET_ENCRYPTION_KEY` that already encrypts the vault, which is why tickets verify across every Cloud
  Run instance; with it unset the code falls back to a per-process RANDOM value (never a constant in
  source, which would let anyone with the repo forge an unlock) and a user would simply be asked to
  unlock again whenever the load balancer moved them.
  **What it protects, stated precisely:** `POST /api/secrets/:userId/reveal` (the ONLY route that returns
  a decrypted key) and `DELETE /api/secrets/:userId/:secretId` (now a REAL document delete, not a
  `deleted: true` flag) refuse without a ticket minted seconds earlier from either a verified WebAuthn
  platform-authenticator assertion or a genuinely fresh Firebase re-auth (`auth_time` within 5 min). The
  old `GET /api/secrets/:userId` is unchanged and still returns names only.
  ⚠️ **ON THE NATIVE SHELL — and the first version of this line named the WRONG REASON, corrected the
  same day.** It said the device lock fails because "WebAuthn in a WebView needs app-to-site association
  (assetlinks / associated domains) that is NOT set up". That is not what decides it here, and a later
  session acting on it would go and build an `assetlinks.json` that changes nothing. The verified facts:
  - **Android: the origin is `https://localhost`** — Capacitor 8.5.0 defaults `androidScheme` to the
    https scheme with hostname `localhost` (`node_modules/@capacitor/android/.../CapConfig.java:38-39`,
    read rather than assumed; `capacitor.config.ts` does not override it). That is a secure context and
    `https://localhost` is ALREADY in this feature's origin allow-list, so **the origin is not the
    blocker**. What is genuinely uncertain is whether the Android **WebView** exposes WebAuthn platform
    authenticators at all — that varies by WebView version, and it cannot be verified from a Claude
    session. So: **unknown, not broken.**
  - **iOS: the origin is `capacitor://localhost`** — a custom scheme, which cannot be a WebAuthn rpId.
    The device lock genuinely cannot work there, and the account-password door is the real path.
  🔒 **Either way nothing breaks, which is why this was safe to ship without a device.**
  `deviceLockAvailable()` asks the browser at runtime (`isUserVerifyingPlatformAuthenticatorAvailable`)
  and a `false` silently offers the account-password door instead — so a WebView without WebAuthn is a
  different SCREEN, never a failure. **To settle it, open Settings → Secrets & API Keys in the Android
  app: whatever it asks for IS the answer.**
  ⚠️ Note what the Android path implies if it does work: the credential is scoped to rpId `localhost`,
  which is shared by every Capacitor app on that device. It is still safe — an assertion is useless
  without our server's challenge, the matching credential id, and a live session — but do not widen
  `VAULT_LOCK_ORIGINS` casually on that reasoning.
  Do not "fix" any of this by accepting a client-side biometric boolean: a plugin's yes/no is
  unverifiable and would make the lock theatre.

- **Outbound abuse check for published apps (shipped 2026-09-10, NavBharat Cloud slice 4):**
  `NAVBHARAT_WEB_RISK` (⚠️ **NOT set yet** — `on` turns on BOTH halves together: the publish-time
  lookup of the outside hosts an app's code points at, and the daily `outbound-rescan` job that
  re-asks about them and can **hold** a live app whose host became listed. Held is reversible from
  the existing restore route; the sweep never takes an app down and never acts on anything but a
  real listing.) `NAVBHARAT_WEB_RISK_MAX_LOOKUPS` (the monthly spend ceiling — **default 100,000**,
  which is exactly Google's free allowance, so the feature costs ₹0 unless this is raised; an
  explicit `0` records origins but asks Google nothing; an UNREADABLE value falls back to the free
  tier, never to unlimited). Read by `src/server/AgentV3/webRisk.ts` / `webRiskBudget.ts`.
  🔴 **THE API IS `uris:search` (Lookup API) — NOT `hashes.search` (Update API), and the difference
  is 100×.** The console's Product-details page lists both, with SearchHashes selected FIRST: the
  admin read ₹4,777.25/1K off that row on 2026-09-10 and reasonably concluded the feature was
  unaffordable. That is the Update API, which we never call. Ours is **free to 100,000 calls/month,
  then ₹47.77/1K** — and spend scales with DISTINCT HOSTS, not publishes, because the process cache
  collapses the same `api.stripe.com` across every app into one lookup. Anyone re-checking this
  price must click the **SearchUris** row.
  ⚠️ **The key alone does nothing until the Web Risk API is ENABLED in `gen-lang-client-0866594388`**
  (console → APIs & Services → Library → "Web Risk API"; **not** "Safe Browsing API", which is free
  but non-commercial-only and so unusable by a commercial product). Auth is the Cloud Run service
  account via ADC — **there is no API key to create or paste**. Until the API is on, every verdict is
  honestly `unknown`, nothing is flagged and nothing is held.
  🔒 **THE BUDGET FAILS CLOSED, WHICH IS THE OPPOSITE OF `jobLease.ts` AND DELIBERATE.** A lease it
  cannot read runs the job anyway (a purge that never runs is worse than one that runs twice); a
  budget it cannot read spends NOTHING, because not looking up costs zero and changes no outcome —
  an unchecked origin is `unknown`, and nothing in the system acts on an `unknown`. Exhausting the
  budget is never silent: it says so in the same `outboundNote` the admin already reads.

- **NavBharat Cloud — the SEPARATE project user apps run in (admin did the five GCP steps 2026-09-12,
  hand-to-hand with a session, so this entry is the record of what was actually created):**
  ✅ **`NAVBHARAT_APPS_PROJECT` = `navbharatai-user-apps`** and ✅ **`NAVBHARAT_CLOUD` = `on`**, both set
  in the PLATFORM's Cloud Run (`navbharat-ai-prod`). Together these unblock ROADMAP Phase 0.1, which
  every item in Phase 2 was waiting on.
  🔴 **THE PROJECT ID IS `navbharatai-user-apps`, NOT `navbharat-apps-prod`.** The roadmap's §11 step 1
  says "suggested id `navbharat-apps-prod`" and a later reader will take that for the real one — it is
  not. Project number `219549203609`; the ADMIN console shows it as `navbharatai-user-apps` in both the
  name and the id.
  🔒 **`NAVBHARAT_CLOUD_PUBLIC` IS DELIBERATELY UNSET, and must stay unset until metering ships.** With
  the master flag on and this one off, hosting works for the ADMIN ONLY. Setting it opens hosting to
  every user — and ROADMAP 2.1 (the wallet debit for hosting) does not exist yet, so every hosted app's
  Cloud Run bill would land on NavBharatAI with nothing recording it. This is the one key in this whole
  section whose absence is load-bearing.
  **What else was created, none of which is an env var and all of which a publish needs:**
  - **Billing: a SEPARATE billing account** (`NavBharatAI User Apps`, organisation `doc-asheesh-org`),
    NOT the platform's. The apps project is linked to it alone; the platform's three projects were left
    on the old account untouched. The point is blast radius: an abuse complaint or a billing suspension
    on somebody's hosted app cannot take NavBharatAI down with it.
  - **Cross-project IAM** — the platform's runtime identity
    `950841184325-compute@developer.gserviceaccount.com` (the DEFAULT compute service account of
    `gen-lang-client-0866594388`) holds, **in the apps project only**: Cloud Run Admin, Cloud Build
    Editor, Service Account User, Artifact Registry Writer, Storage Admin, Monitoring Viewer. The first
    three are §11's list; the last three are what `hostingPreflight.ts` actually exercises — an image
    push, the build's staging bucket, and the usage read.
  - ⚠️ **FOUR APIs, not three.** §11 names Cloud Run, Cloud Build and Artifact Registry. `hostingPreflight`
    also calls **Cloud Monitoring**, and without it the "Usage metering" check fails. All four are enabled.
  - ⚠️ **An Artifact Registry repository must EXIST — nothing creates it.** A **DOCKER** repo named
    **`nbai-apps`** in **`asia-south1`**, matching `appsImageRepo()` and `appsRegion()`. `containerBuild.ts`
    pushes to it and never creates it; the preflight's one 404 remedy names exactly this.
  - **The other four env keys in §11's table were NOT set, on purpose.** `NAVBHARAT_APPS_REGION`
    (`asia-south1`), `NAVBHARAT_APPS_IMAGE_REPO` (`nbai-apps`) and `NAVBHARAT_APPS_BUILD_BUCKET`
    (`<project>_cloudbuild`, which Cloud Build creates itself) already have exactly those code defaults,
    so setting them would only add three more values to keep in sync. Verified against
    `cloudRunHosting.ts` and `containerBuild.ts` rather than taken from the doc.
  **How to check it without guessing:** admin panel → home → **"Check app hosting setup"**
  (`LoadBoard.tsx` → `GET /api/admin/hosting/preflight`). It makes the SAME Google calls a real publish
  makes, and a check that could not run reports as skipped rather than ok.
- ✅ **`NAVBHARAT_WEB_RISK` — the API is now ENABLED (admin 2026-09-12).** The key was set on 2026-09-10;
  the Web Risk API itself was switched on in `gen-lang-client-0866594388` today, so outbound verdicts are
  real instead of `unknown`. **Confirmed the same day: the console display name `navBharat ai real` IS
  project `gen-lang-client-0866594388`** — the billing console's project list shows both side by side.
  Recorded because a display name that looks nothing like the id is exactly how an API gets enabled in
  the wrong project and nobody can tell.

- ✅ **THE ADMIN'S OWN QUEUE, CLEARED (admin said so 2026-09-12, verbatim: "mere karne ke liye aap jo
  5 step bata rahe woh kar diya hai, sbhi").** Recorded hand-to-hand per this registry's own rule, the
  same day it was said. Six items had been put to them; they replied "5 … sabhi". **The count is not
  reconciled and this entry deliberately does not pretend it is** — so each line below carries the ONE
  signal that settles it without anybody taking this record on trust:

  | Item | How to confirm it WITHOUT trusting this entry |
  |---|---|
  | **`GRIEVANCE_OFFICER_NAME`** (+ optional `_EMAIL` / `_PHONE` / `_ADDRESS`) — read by `src/server/lib/grievanceOfficer.ts`; the public page is `/grievance` | Admin Monitor: the amber "Grievance Officer not named" warning is GONE. It is driven by `officerIsNamed`, so it cannot be green while the key is missing |
  | **`NAVBHARAT_WEB_RISK=on`** | An admin build report's `outboundNote` stops saying `unknown` for every origin |
  | **`E2B_USD_PER_HOUR` = `0.1656`** (was the half-true `0.083`) | The Monitor's amber rate-mismatch tile clears — `sandboxRate.ts` raises it by comparing the configured rate against the template's REAL size, so a wrong value cannot look right |
  | ✅ **The six DUPLICATE keys** (`AGENTV3_ESCALATION` ×3, `CHEAP_FLOOR`, `ENABLED`, `PAID_PUBLIC`, `CREDIT_GATE`, `STREAMING_PREVIEW`) — see the 2026-08-20 audit below | **DELETED — the admin said so directly on 2026-09-20 ("maine delete kar diye hai, 10-12 din pahle hi"), i.e. around 2026-09-08/10.** This was the one row with NO self-verifying signal: nothing in the code can detect a duplicate, because the process sees one value and cannot know a second row existed. So the admin's word IS the record here, and it is written down the day it was said — exactly what this registry's hand-to-hand rule is for |
  | ✅ **Android developer verification — package registration** (deadline 30 Sep 2026) | **DONE, verified from a screenshot 2026-09-20.** BOTH rows read `Registered`: `com.navbharat.ai` (the real `applicationId`, the app on Play) and `com.navbharatai.app` (only the Java `namespace` — not a distributed app; its friendly name was typed as "DELETE" and leaving it registered is harmless). ⚠️ This screen covers PACKAGE REGISTRATION only — whether a separate identity/verification section is still outstanding was not visible in that capture and is Play Console's to answer |
  | **The approved Play update published**, then `ANDROID_LATEST_VERSION_CODE` set to that run number | Play Console shows the release live; the number must be set AFTER it is downloadable, never before (see that key's own entry) |

  🔴 **WHY THE UNRECONCILED COUNT IS WRITTEN DOWN RATHER THAN ROUNDED AWAY.** This file already records
  two costly drifts of exactly this shape — an idle-minutes default that said "NOT taken" eight days
  after it was taken, and an E2B rate whose derivation "could not fail". A later session reading a clean
  "all six done" would reason from it as fact and, for the duplicate keys, would have no way to notice.
  Five of the six can be re-checked from a screen in seconds; the sixth cannot, so it stays open here
  until someone reads the console.

- **🔴 THE OVERDRAFT FLOOR — how far a wallet may go negative (admin-mandated 2026-09-13):**
  `WALLET_OVERDRAFT_FLOOR_INR` — ⚠️ **NOT set; the code default is ₹50 and that is the intended value.**
  Read by `src/server/lib/walletFloor.ts`, applied inside BOTH `computeDebitedWallet` and
  `computeRolledUpDebit`.
  **WHY IT EXISTS:** the admin found two live accounts at **−₹506.03** and **−₹1,198.41**, both with
  **0 apps built** — *"aise -500₹ har user ko diye to ham barbaad ho jayenge!!!"* Every START gate was
  already correct (`decideAffordability` refuses a new build at a balance ≤ 0; a chat turn is refused
  on an empty wallet). What had **no bound at all** was the SETTLEMENT: a build legitimately allowed to
  begin at ₹1 ran its full wall-clock and then debited whatever it had cost, in one go. The design said
  so in writing — *"the debt is recorded honestly; the NEXT pre-flight gate then blocks"* — which is
  exactly right about the next build and silent about the size of this one. `SESSION_COST_CAP_USD` ($5)
  is not that limit either: it only decides whether an EMPTY build may retry.
  🔒 **THE FLOOR LIVES AT THE DEBIT, NOT IN A GATE.** Nine paths take money out of a wallet; a limit
  written into the callers is a limit the tenth caller never gets. Inside the two functions every debit
  passes through, it is true by construction — including for callers nobody has written yet. A caller
  that omits it gets the built-in floor rather than unlimited debt: "unset" must never be the single
  input that restores the bug.
  ⚠️ **THE SETTING ITSELF IS CAPPED at ₹500** (`MAX_OVERDRAFT_FLOOR_INR`), and a MALFORMED value falls
  back to ₹50 rather than to "no limit" — the same reasoning `parseRolloutPercent` already uses. A typo
  of `5000` would otherwise silently reproduce the −₹1,198 account.
  💸 **WHAT IT DOES NOT DO, stated plainly:** clamping the debit bounds the USER'S BILL; it does not
  un-spend what the model already cost us. The excess is **absorbed** by NavBharatAI and RECORDED as
  `absorbedInr` on the ledger row, surfaced on the admin's account panel as *"NavBharatAI absorbed ₹X"*
  — because a clamp that quietly shrank the number would hide our own bleeding on the exact screen used
  to judge it. **The real saving is a mid-build stop, which does NOT exist yet — see `PROGRESS.md`
  2026-09-13 as an OPEN root cause.**

### 💴 FULL MONEY AUDIT — every paying code path read end to end (admin-asked 2026-09-12)

The admin asked for a microscopic audit of every money path: *"kahi koi money leak to nahi hai."* 53
money-touching modules were mapped and walked. **Seven real leaks were found, all verified from code
rather than reasoned about, and all fixed in the same change.** The rest of the money surface held up —
the Cashfree credit is transactional and derives tokens from the VERIFIED paid amount; the coupon table
is server-side with an ATOMIC one-time claim; the weekly gift is transactional with its lifetime cap
written in the same transaction as the credit; a failed build is never charged; an unmeasured provider
charges zero rather than an invented number.

**🔴 1. A FREE user's paid fallback was the DEAREST model on the card.** `buildFree` in
`AIRouterManager.ts` registered `gemini-2.5-pro` (**$10/MTok out**) as the FIRST fallback after the free
GLM-flash leader, with `gemini-2.5-flash` (**$2.50**) sitting BELOW it. So every time the free leader
rate-limited — the 429 storm this file already documents — a free chat turn cost **4× the rung beneath
it**, and free chat is NOT wallet-charged, so all of it was ours.
🔒 **The policy already existed, one function away.** `buildProfessionalFreeFallback` states it verbatim:
*"Vertex (cheap Gemini on Google), NEVER Grok / direct Gemini / Claude … so a free user can never trigger
the pricier paid providers."* The professional free tier obeyed it; the twin universe every ordinary user
hits did not. The bug was a rule applied in one place and not its sibling — not a missing rule.
**Fixed:** one price-ordered ladder across both Google doors — flash-lite → flash (Vertex) → flash-lite →
flash (Gemini) → **pro last of the Geminis** → grok ($15, dearest in the card) as the final resort.
**Nothing was removed**, so resilience is identical; the rungs are climbed cheapest-first instead of
dearest-first. Test-locked in `tests/freeChainCost.test.ts`, which reads the ORDER out of the source and
prices it with `providerRates` — so it fails if an order OR a price ever puts an expensive model first.

**🔴 2. The coupon redemption credited the wallet OUTSIDE a transaction, and moved only the ₹ view.**
The redemption CLAIM was already atomic (a code cannot be redeemed twice — that guard is untouched), but
the CREDIT was a read-modify-write: a build settling between the read and the write had its debit
**erased** by a balance computed before it landed. Free spend, timed rather than hacked. It was the one
credit path in the repo not using a transaction, while `computeCreditedWallet` carries a comment
explaining exactly why the purchase path does.

**🔴 3. The admin token adjustment ASSIGNED the ₹ view instead of moving it.** It wrote
`remaining_balance = tokenBalance / TOKENS_PER_RUPEE` — an assignment, not a delta. The 2026-08-03 fix it
replaced was right about the symptom (a gifted wallet showing ₹0 could not build) and wrong about the
cure: an assignment silently rewrites a balance whenever the two views legitimately differ — **and they
always differ for a Pass buyer**, because `remaining_balance += netPaid` while
`creditableVishwakarmaTokens` subtracts the Pass price from the token figure first. A "+1 token"
adjustment on such an account would have wiped ₹(pass price) the user really paid; on a wallet credited
in ₹ only (leak 2), the same line MINTED balance. It was also non-transactional.

**🔴 4. A store purchase could credit TWICE under a concurrent retry.** The receipt check on
`/api/payment/store/verify` sat OUTSIDE the transaction, and the transaction read only the WALLET. Two
concurrent deliveries of the SAME purchase token — the store re-delivering on relaunch and the app
retrying on a flaky network, both named in that route's own comments as NORMAL — could both pass the
outside check; Firestore saw the clash on the wallet alone, retried the loser, and the retry re-read the
already-credited balance and credited the same purchase again. The receipt is now read IN-transaction
(before the wallet), which puts it in the conflict set. **The sibling Cashfree path was checked and was
already right** — it claims the PENDING→SUCCESS flip inside a transaction and only the winner credits,
which is exactly the pattern the store path was missing.

**🔴 5. IMAGE GENERATION HAD LEAK 1'S SHAPE, IN A SECOND PLACE — which is what makes it a CLASS.**
`/api/image/generate` is a free-first ladder too: Pollinations (₹0) → Gemini (paid) → Grok (paid). Its
allowance gate ran only `if (!pollinationsEnabled())` — the reasoning being "free provider on ⇒ the image
is free". That holds only while the free provider SUCCEEDS, and the paid rungs exist precisely for when
it does not; the route's own log line says *"trying paid fallbacks"*. So a bad minute at Pollinations
(down, timeout, rate-limited — and a caller can provoke the last one) delivered a PAID image with **no
allowance checked and nothing metered**. Now the allowance is resolved LAZILY, the first time the ladder
is about to touch a paid provider and BEFORE that provider is called, and only a PAID delivery burns it —
a free image still passes with no gate lookup, so the ordinary path is unchanged.

**🔴 1b. THE SECOND BUG INSIDE LEAK 1 — and it HID the first, so re-ordering alone would have been
decoration (found 2026-09-12 while answering "gemini se sasta koi ho sakta hai?").** `slot()` is how ONE
provider serves as several ladder rungs at several prices — it pins a model per rung. But `executeStream`
had **no model parameter at all**, and `VertexProvider.executeStream` hardcoded `this.modelPro`. **Chat
STREAMS.** So on the path that carries the actual traffic, EVERY Vertex rung ran `gemini-2.5-pro`
regardless of which rung won, and the ladder's order was cosmetic. The model now rides the stream
(`executeStream(prompt, systemPrompt, onChunk, model?)`, every provider honouring it, `slot()` passing
it); without that, the ceiling below would be decoration too. ⚠️ **I reported leak 1 as fixed by the
re-order before finding this — the re-order alone fixed only the non-streaming path.** Test-locked:
`tests/freeChainCost.test.ts` asserts the pin reaches `executeStream` on all five providers.

**🔴 1c. THE ADMIN'S PRICE CEILING (mandated 2026-09-12).** Shown the whole rate card, the admin drew a
line under `kimi-k2.7` — *"bas yahi tak rakho"*. So **`gemini-2.5-pro` ($10/MTok out) and grok ($15) are
REMOVED from the free ladder, not demoted**, and Claude was never there. The rule is stated in MONEY, not
as a list of ids (`src/server/AI/freeTierCostCeiling.ts`): nothing whose chat cost exceeds `kimi-k2.7`'s
may serve a free turn, whatever it is called — so a rung added later at any price above the line fails CI
rather than reaching a bill. The ceiling is DERIVED from the rate card, so a repriced kimi moves it.
⚠️ **THE INDEX IS INPUT-WEIGHTED, AND ORDERING BY THE OUTPUT COLUMN ALONE IS WRONG FOR CHAT.** A grounded
turn sends a large system prompt, the history and two fetched pages, and returns a few hundred tokens —
it is input-heavy. `glm-4.7` ($0.60 in / $2.20 out) looks cheaper than `gemini-flash` ($0.30 / $2.50) on
the output column and is DEARER for chat; they break even exactly when output equals input, which chat
never does. `CHAT_INPUT_WEIGHT = 8` is an ASSUMPTION, labelled as one — retune that single constant when
the chat route's token logs give a real ratio.
🔒 **WHAT THE CEILING COSTS, STATED PLAINLY:** with the last resorts gone, a free chat turn where GLM and
BOTH Google doors are failing at once now returns an honest "busy" instead of an answer. That is the trade
the admin chose, and it is the SAME trade `buildProfessionalFreeFallback` already makes in writing. **PRO
and PROFESSIONAL keep every rung** — the ceiling is the FREE ladder's alone, and a test asserts that.
⚠️ The final rung, `glm-4.7`, shares ONE key with the flash leader: when the leader failed because that
KEY was rate-limited, this rung usually fails too. It earns its place on a model-specific failure, not on
a 429 storm, and it is NOT a substitute for a genuinely independent provider — **Kimi has no chat provider
in this repo** (only the build engine has one), so adding it is a build, not a config change.

**🔴 6. THE BIGGEST ONE, AND IT REFRAMES LEAK 1 ENTIRELY: A STREAMED TURN RACED **TWO** PROVIDERS, AND
BOTH WERE BILLED (found 2026-09-12, admin said "fix karo").** `AIRouter.routeStream` starts the top TWO
providers CONCURRENTLY and serves whichever speaks first. The loser's answer is discarded — **its
invoice is not**. So on the FREE universe, whose leader is `glm-flash` at ₹0 and whose second rung was
`gemini-2.5-pro` at $10/MTok out, **every single chat turn also paid for a gemini-2.5-pro call.** Not on
fallback. Not when the leader failed. **Always.** Leak 1 as first reported ("the fallback is 4× dearer")
described a fraction of it.
🔒 **THE RULE: A RACE IS A PURCHASE OF SPEED, SO IT BELONGS WHERE SOMEONE IS PAYING** (`streamRacePolicy.ts`).
PRO and PROFESSIONAL keep racing — those users bought the product. **FREE walks its ladder
SEQUENTIALLY**: the ₹0 leader alone, and the next rung only when that one genuinely fails. An
UNRECOGNISED universe does not race either, because the safe side is the one that cannot silently double
a bill for a caller nobody has classified. Reversible without a deploy: `AI_STREAM_RACE=all` restores
racing everywhere, `=off` stops it everywhere.
⚠️ **WHAT IT COSTS THE FREE USER, PLAINLY:** when the free leader is SLOW (not failing — slow), nothing
runs beside it to overtake it, so the reply starts later than it used to. That is the trade, it is real,
and the admin chose it on being shown the duplicate bill. The grounding status (#2826) is what keeps
that wait visible rather than blank.

**🔴 7. THE STREAMING CHAT TURN WROTE NO USAGE LOG AT ALL.** `ai_usage_logs` — the collection the admin
dashboard is built on — was written only in the NON-streaming branch of `chat.ts`, and **chat streams**.
So the provider, model and outcome of real chat traffic were invisible, and after the free ladder's
last-resort rungs were removed there would have been no way to see whether free chat had begun failing
or which rung was serving. `routeStream` returned `Promise<void>` — it reported nothing — so this was
not an oversight at one call site but a missing return value. It now returns a `StreamOutcome`
(provider, pinned model, latency, `raced`, honest failure reason) and the streamed turn writes the same
row shape the other branch does, with `usageMeasured: false` because a stream does not surface token
counts today — "we do not know" is never written as a zero.

🔴 **THREE BUGS OF ONE SHAPE IN ONE DAY: THE STREAMING PATH IN THIS REPO GETS FORGOTTEN.** `slot()`
could not pin a model on it (1b); `VertexProvider.executeStream` hardcoded `pro`; `ai_usage_logs` was
never written from it. **Any change to routing, cost or telemetry must be checked against
`routeStream` explicitly — the non-streaming branch is the minority path, and reasoning that stops at
`routeDetailed` has now been wrong three times.**

🔒 **THE CLASS, NAMED SO IT IS RECOGNISED NEXT TIME: A FREE-FIRST LADDER WHOSE PAID RUNGS ARE UNGOVERNED.**
Leaks 1 and 5 are the same mistake in two features — the cheap/free leader is reasoned about as if it
were the whole ladder, and the fallback nobody expects to fire is left dearest-first (1) or unmetered
(5). **Whenever a free or cheap provider leads, two questions must be answered about the rungs BELOW it:
in what ORDER are they climbed (cheapest first?), and WHO PAYS when one of them serves?**

🔒 **THE ROOT CAUSE BEHIND BOTH 2 AND 3, AND THE RULE THAT NOW PREVENTS THE CLASS:** the wallet holds ONE
balance in TWO fields, and every bug here came from a writer that moved one of them. `walletMirror.ts`
takes the delta ONCE and derives both fields from it — **there is no way to call it and move one view
without the other**, and it never assigns (a deduction floors both views from the same clamped token
figure, so one can never end at zero while the other goes negative). Both writers now use it, inside a
transaction. ⚠️ **Any NEW wallet writer must go through it** — a direct `updateDoc` on a balance field is
how this class comes back. Test-locked in `tests/walletMirror.test.ts`, including the Pass-buyer case
that the old assignment got wrong.

### 🔎 FULL CLOUD RUN AUDIT — 84 keys read off the live console (admin screenshots, 2026-08-20)

The admin sent the complete list of env-var NAMES from the live Cloud Run service, and every one was
cross-checked against the code. This is the first time the registry above has been reconciled against
the actual deployment rather than maintained hand-to-hand, and it found four things.

**🔴 1. SIX KEYS ARE SET TWICE. This is the urgent one.**

| Key | Positions in the console |
|---|---|
| `AGENTV3_ESCALATION` | #33, #37, #44 — **three times** |
| `AGENTV3_CHEAP_FLOOR` | #26, #34 |
| `AGENTV3_ENABLED` | #15, #41 |
| `AGENTV3_PAID_PUBLIC` | #42, #48 |
| `AGENTV3_CREDIT_GATE` | #43, #49 |
| `AGENTV3_STREAMING_PREVIEW` | #60, #80 |

**A duplicate is not cosmetic: the LAST entry wins.** So a correct value can sit in the console, be
visible to whoever set it, and never reach the process. `AGENTV3_CHEAP_FLOOR` is the sharpest example —
this file already records that an ENV value ALWAYS beats the code default, so one stale or empty
duplicate silently switches the whole GLM/Kimi floor off while the console still shows the good value
a few rows up. `AGENTV3_ENABLED` and `AGENTV3_PAID_PUBLIC` carry the same risk for the feature gate and
for billing. **Compare each pair's VALUES and delete the wrong one — do not assume they match.**

**🟡 2. `PUBLISHED_APP_DOMAIN` — CORRECTED WITHIN THE HOUR, and the correction is the useful part.**
The audit first reported it as DEAD CONFIG: set in Cloud Run, read nowhere. That was true of the code I
had, and **false of `main`** — another session had just landed `publishedAppUrl()` in `Deployment.ts`
plus a Cloudflare Worker (`infra/cloudflare/mitrify-apps-worker.js`). The rebase conflict is what
surfaced it; the audit alone would have shipped a wrong claim and had the admin delete a live key.

**The lesson is safeguard #1, hitting an audit rather than a roadmap:** a cross-check is only true as of
the commit it ran against, and `main` moves under you. Anything this file asserts about the CODE must be
re-grepped against current `main`, not against a session's working tree.

What it actually does: with the env UNSET a published app is served at `https://<site>--<channel>.web.app`
— already on the Public Suffix List, which is why it is the safe default. With it SET (e.g. `mitrify.in`)
the URL becomes `https://<channel>.<domain>`, and that is a **pure string change** — it only becomes real
once the Cloudflare Worker routes `*.<domain>` to the matching Firebase channel. ⚠️ **Leave it unset until
that Worker is live**, or every published URL points at a host that does not resolve. And branded
subdomains are NOT cookie-isolated from each other until `<domain>` is on the PSL (a separate,
weeks-long registration) — localStorage/IndexedDB are per-origin from day one, cookies are not.

**🟢 3. Four keys were missing from this registry** — now recorded:
- **`PROFESSIONAL_PAID_ENABLED`** — the Professionals paid gate (`professionals/professionalPaid.ts`).
  Reads exactly `'true'`; anything else is off.
- **`PUBLIC_BASE_URL`** — the public origin used to build bot/webhook URLs (`routes/bots.ts`).
- **`SEMANTIC_MEMORY`** — master switch for semantic memory. Companion tunables
  `SEMANTIC_MEMORY_MAX_CHUNKS` (60) and `SEMANTIC_MEMORY_TOP_K` (5) are code-defaulted.
- **`PUBLISHED_APP_DOMAIN`** — the branded published-app host; see item 2 for why it must stay
  unset until the Cloudflare Worker is live.

- **Published-app hosting — the THREE keys that together remove the publish ceiling (added 2026-09-07):**
  `PUBLISHED_APPS_BUCKET` (the public Cloud Storage bucket published apps are mirrored into —
  ⚠️ **NEVER `NAV_STORE_BUCKET`**, which holds unreviewed APKs and must never be public; the code
  refuses that fallback deliberately and a test locks it), `PUBLISHED_APPS_MIRROR` (kill switch, `off`
  disables the mirror while leaving the bucket configured), and **`PUBLISHED_APPS_BUCKET_ONLY`** —
  `on` makes a publish skip Firebase Hosting **entirely**, which is the only thing that actually removes
  the ~50-channels-per-site ceiling (ROADMAP §10.3 step 4).
  🔴 **THE BUCKET ALONE DOES NOT RAISE THE CEILING, and believing it does is the exact mistake this
  entry exists to prevent — I made it, in writing, to the admin, and corrected it the same session.**
  The mirror runs AFTER the channel is created and released, so a mirrored publish still consumes a
  channel; the bucket made publishing cheaper and faster to serve, never roomier. Only
  `PUBLISHED_APPS_BUCKET_ONLY=on` stops a channel being created at all.
  ⚠️ **ORDER OF ACTIVATION MATTERS, and getting it wrong hands users dead links.** All THREE of
  `PUBLISHED_APPS_BUCKET`, `PUBLISHED_APP_DOMAIN` and `PUBLISHED_APPS_BUCKET_ONLY=on` must hold, and
  the code ANDs them rather than warning: with no branded domain there is NO working URL to return,
  because the default `<site>--<sub>.web.app` host resolves only *because* the channel exists. So the
  sequence is **bucket public-readable → Worker's `APPS_BUCKET` set and deployed → `PUBLISHED_APP_DOMAIN`
  set and a test app confirmed loading → only then `PUBLISHED_APPS_BUCKET_ONLY=on`.** Missing any
  precondition disables the path silently and correctly (today's behaviour, byte-identical).
  ✅ **LIVE AND VERIFIED ON A REAL APP, 2026-09-17.** All three are SET and a published app (TaskLite)
  opens at `https://a-e3638646f0794cd0da543c9d.mitrify.in` with no Firebase channel consumed — the
  ~50-channel publish ceiling is GONE in production. ⚠️ **The last blocker was not any of these keys and
  not the code: the Cloudflare ZONE for `mitrify.in` sat at `Pending Nameservers`, and a Worker route
  does not run on a pending zone.** The registrar held `hasslo`+`teagan` while the zone that owns the
  route had been assigned `houston`+`naya` — two real Cloudflare pairs, neither matching — so every
  request bypassed the Worker and got Firebase's "Site Not Found". Two further misconfigurations were
  corrected the same night: `*.mitrify.in` A records pointed at **Cloudflare's own anycast IPs** (a
  resolved IP pasted back as an origin; now the documented placeholder `A * → 192.0.2.1`, Proxied), and
  the Worker running at the edge was an older paste than the repo file.
  🔎 **BEFORE DEBUGGING THIS PATH AGAIN, OPEN `https://<app>.<domain>/__nbai`** (PR #2980). It returns
  the Worker's `version`, the `appsBucket` it is reading from and the exact object URL it looks an app's
  `index.html` up at — the one fact that could not be observed from outside, and whose absence turned a
  one-screen fix into an hour of elimination. JSON back ⇒ that code is live; Firebase's page back ⇒ an
  older Worker is. `WORKER_VERSION` is CI-pinned against a hash of the file, so a Worker change that
  forgets to bump it fails the build rather than reporting a version that lies.
  🔴 **STILL OPEN (rule 6):** the Worker is deployed by PASTING it into the Cloudflare dashboard, so
  nothing links the repo to the edge and CI cannot prove what is live. The complete fix is a Wrangler
  deploy from CI, which needs `CLOUDFLARE_API_TOKEN` as a GitHub REPO secret (the token already exists
  in Cloud Run). Until then the version endpoint makes the drift VISIBLE; it does not make it impossible.
  **Reverting is one key.** Unset `PUBLISHED_APPS_BUCKET_ONLY` and new publishes go back to Firebase
  immediately. Apps ALREADY published bucket-only keep working (the Worker serves them) and stay
  removable — takedown deletes their bucket objects unconditionally, not behind the flag, precisely so
  turning the flag off can never strand an app nobody can unpublish.

**🔵 4. `FIREBASE_DEPLOY_PROJECT` is NOT set — and that CLOSES a live hypothesis.** While diagnosing the
2026-08-19 publish 404 I proposed that the deploy might be pointing at the wrong project, since that env
overrides `FIREBASE_PROJECT` and this file records the exact `navbharatai-3395f` / `gen-lang-client-…`
confusion. It is absent from all 84, so the code default `gen-lang-client-0866594388` is in use — which
matches the project whose Hosting console the admin checked. **That theory is dead; the 404 is
elsewhere**, and the per-call diagnostics added the same day will name it.

**The other direction was checked too and is fine.** 331 env names the code reads are unset — that is by
design, not drift: nearly all are optional tunables whose absence means "today's behaviour", exactly as
the flag entries above promise.

**Known valid VALUES (from the code, for the admin to cross-check):**
- `AGENTV3_CHEAP_FLOOR` accepts exactly: `off` | `glm` (GLM only) | `kimi` (Kimi only) | `on`/`both`
  (GLM + Kimi together) | `bedrock`. It must hold ONE value.
  **CODE DEFAULT is now `on`** (admin 2026-07-12, "1st call claude nahi chahiye — jaisa CLAUDE.md me
  save hai"): per the Model Routing Policy the FIRST build call must be the flagship cheap coder
  (GLM `glm-5.2` / Kimi), not Claude — Claude only backstops. So when `AGENTV3_CHEAP_FLOOR` is UNSET,
  the floor now LEADS with GLM+Kimi (Claude/Haiku still backstop). ⚠️ An ENV value ALWAYS wins over the
  code default — so if Cloud Run pins `AGENTV3_CHEAP_FLOOR=off`, that `off` wins and Claude leads again;
  REMOVE it (or set `on`/`glm`) for GLM/Kimi to lead. Also requires a valid `GLM_API_KEY`/`KIMI_API_KEY`
  (a keyless rung is skipped → falls to Claude). `off` stays the instant, env-authoritative kill switch.
- `GLM_MODEL` / `KIMI_MODEL` — **DECISION "A" (admin 2026-07-12): keep these EMPTY in Cloud Run on purpose.**
  The model ids live in the CODE defaults (`cheapBuildFloorRunners` in `routes/agentv3.ts`), maintained by Claude.
  Rationale: env-pinning = the admin edits Cloud Run on every model release (churn); blind "auto-latest" is unsafe
  (a new/preview model can be worse at the agentic tool-loop, pricier, or break a build). New models are adopted
  DELIBERATELY — bump the code default in a PR (after a quick bake-off) when GLM/Kimi ship a better stable coder.
  The comma ladder + Claude/Vertex backstop means a RETIRED id auto-falls-through, so the app never breaks even if
  these stay empty forever. (Setting a value still works — it OVERRIDES the code default — but that reintroduces the
  per-release churn Decision A avoids.)
  Comma newest→older ladder (1st = try first, rest = error-fallback). **EMPTY/unset
  is SAFE** — `parseModelLadder` falls back to the code default. Confirmed exact ids (admin screenshots 2026-07-12):
  - **GLM_MODEL** default `glm-5.2,glm-4.7` (flagship coder → 1-step-back). GLM ids: `glm-5.2` (flagship),
    `glm-4.7` (cheap coder), `glm-4.7-flash` (cheapest, free-tier only).
  - **KIMI_MODEL** default `kimi-k3,kimi-k2.7-code,kimi-k2.6` (admin 2026-07-28: K3 PREPENDED, never a
    replacement — if `kimi-k3` is not a live id the call errors and the ladder falls through to k2.7-code
    exactly as before, so adopting it cannot break a build even if the model does not exist. The FREE
    ladder was deliberately left UNCHANGED — it is cheapest-first with the flagship LAST, so a newer
    flagship in front would invert the free tier's cost model). ✅ **DONE 2026-09-16 — K3's price is published and is now in the rate
    card: $3.00 in / $15.00 out, cache-hit $0.30, i.e. EXACTLY Sonnet's price.** The old default mirrored
    k2.7 ($0.95/$4.00) because the price was "not verifiable here", which under-stated our real cost by
    3.2× on input and 3.75× on output. K3 is on no ladder today, but that row is the family CEILING for
    any unrecognised Kimi id, so the placeholder mattered. ⚠️ **And `kimi-k2.5` was DISCONTINUED by
    Moonshot on 2026-08-31** — already off every ladder since 2026-09-04 (it 404'd on this account), its
    rate row kept only so old telemetry can still be priced. **`kimi-k2.6` is NOT cheap**: Moonshot
    prices it at $0.95/$4.00, the same as k2.7-code, and it had been sharing k2.5's $0.60/$2.50 line —
    under-stating the cost of every WEAK build, which NavBharatAI pays for itself. Kimi ids (from platform.kimi.ai/docs/models):
    `kimi-k2.7-code` (strongest coder, 256k), `kimi-k2.7-code-highspeed`, `kimi-k2.6`, `kimi-k2.5` (older/cheaper).
  - Per the Model Routing Policy above, this is the flagship-first PAID/default ladder; the FREE-tier flash-first
    ladder is a SEPARATE (Slice-3) env, not `GLM_MODEL`/`KIMI_MODEL`. (Supersedes the old "flagship stays OUT of
    the floor" note — the admin confirmed flagship leads the paid ladder on 2026-07-12.)
- `AGENTV3_ENABLED` → `true`. `AGENTV3_PAID_PUBLIC` → set to `true` by the admin 2026-07-11 (billing LIVE:
  real wallet debit + affordability gate + ₹0-balance block now active for every non-free-list user).
  `AGENTV3_CREDIT_GATE` → also `true` (redundant once paid-public is on — paid-public is the superset — but
  harmless). ✅ **Both VERIFIED = `true` in the live Cloud Run env (admin screenshot 2026-07-12, Names 49+50)**
  — so the affordability gate is genuinely active, which is what makes the ₹0-balance block (Fix 51) actually
  bite (a 0-balance non-free-list user is now REFUSED, instead of the old bug where the −₹20 overdraft floor let
  them build on the full engine for free). ⚠️ With these ON, a ₹0/negative-balance user is REFUSED new builds,
  so the recharge flow (Cashfree) MUST work end-to-end or such users get stranded; keep the 3 test/admin emails
  in `AGENTV3_FREE_LIST` so admin testing stays free.
- `AGENTV3_CHEAP_FLOOR_MAX_PROMPT_CHARS` → **default is now `0` = NO size skip** (Fix 51, admin "kimi/glm se
  limit hata do — 1st try for every file"): GLM/Kimi lead EVERY prompt regardless of size; Claude backstops any
  real timeout. Set a POSITIVE value (e.g. `45000`) ONLY if you want to re-impose the old "skip huge prompts
  straight to Claude" behaviour. The prompt-diet block-trim (`perBlockCap` 6000) always applies either way.

**Available AgentV3 flags (state below is the live Cloud Run config; leave unset = today's behavior):**
- **`AGENTV3_COST_ROUTING`** (= `on`) — the ONE master switch for the whole cheap-routing regime
  (free-tier cheap-only builds + per-tier billing). ✅ **SET to `on` by the admin 2026-07-12, CANARY-scoped via
  `AGENTV3_COST_ROUTING_USERS` = `aashishcpmt09@gmail.com`** — so it is live for the admin's own account ONLY
  right now (everyone else stays on today's Claude path). Watch the `deliveredVia` telemetry on the admin's
  builds, then CLEAR `AGENTV3_COST_ROUTING_USERS` to widen to all users once GLM/Kimi are proven. NOTE: the
  free-tier cheap-only path also needs a real cheap floor configured (`AGENTV3_CHEAP_FLOOR` naming a provider
  with its key present); with the floor off it stays inert even for the canary user.
- Legacy per-feature overrides (normally NOT needed — the master covers both): `AGENTV3_FREE_TIER_CHEAP`,
  `AGENTV3_PER_TIER_BILLING`. `WELCOME_BONUS_TOKENS` no longer grants anything (2026-09-26 — a new wallet
  opens at ₹0); it is read only by `accountMerge.ts` to recognise past welcome gifts.
- **`AGENTV3_INTEGRITY_GATE`** (= `on`) — **SET to `on` by the admin 2026-07-11 (canary).** After a build,
  auto-fix two deterministic defect classes the analyzer suite missed: multiple mount-focus owners (broke
  "auto-focus") and a stylesheet imported by 2+ modules. Default OFF only RECORDS the findings honestly;
  `on` runs a bounded LLM self-heal (never blocks/fails a build). Applies to ALL builds when on (no per-user
  scoping yet — fine in test mode; add scoping before wide public exposure).
- **`AGENTV3_REVIEW_AUTOFIX_WARNINGS`** (= `on`) — canary extension of the C9 reviewer auto-fix: also repair
  the reviewer's **functional** `[WARNING]` findings (e.g. "sort ignores edits", "isAtLimit blocks Add"), not
  just `[CRITICAL]`. Cosmetic/a11y/style warnings are always excluded (`selectAutoFixableWarnings`). Rides the
  SAME single bounded C9 repair pass — no new cost path. Default OFF; flip on after a canary proves it clean.
  (The C9 critical auto-fix itself stays default-ON; kill switch `AGENTV3_REVIEWER_AUTOFIX=off`.)
  ⛔ **DO NOT propose turning this OFF to make long builds shorter — it cannot help, and it costs real
  quality (recorded 2026-08-10 because a session, mine, recommended exactly that from memory instead of
  from the code, and the admin nearly acted on it).** Two code facts settle it: (1) it adds NO pass —
  `reviewerWarningAutoFixEnabled()` only widens what the SINGLE C9 pass repairs (`AutoFix.ts`); and (2)
  ALL post-build work is already hard-capped by `ADVISORY_CAP_MS = 120_000` in `routes/agentv3.ts`, i.e.
  2 minutes total once the app is built and durably saved. A 20-minute build therefore spent that time
  in the BUILD LOOP, inside `maxBuildSeconds()` (default **1800s = 30 min**) — post-build gates are not
  even a candidate. Meanwhile OFF means real functional bugs ship: the Notes-report defects
  ("auto-focus broke", "sort ignores edits", "isAtLimit blocks Add") were all WARNINGS, which is exactly
  why C9 alone missed them. When a build feels too long, investigate the loop; never disable a
  correctness gate for a time saving that does not exist.
- **`AGENTV3_DESIGN_GATE`** (✅ **SET `on` in Cloud Run by the admin 2026-08-13**; built 2026-08-11) — the fix for the admin's
  report *"1st page beautiful, andar ke page bas HTML feel dete hai"*. `DesignCoverage.ts` judges EVERY
  page/screen file on its own (not the app as a whole) for four mechanical defects: bare markup, no
  heading, a raw `<table>`, and a list with no empty state. **Detection is deterministic — zero LLM cost
  on a clean build**, and the findings are recorded as honest `DESIGN_PAGE_INCONSISTENT` warnings whether
  the flag is on or off. Flag ON additionally runs ONE bounded repair pass naming the exact offending
  pages (never touching pages that were fine), and reports `DESIGN_HEALED` or, honestly,
  `DESIGN_PARTIALLY_HEALED`. It can NEVER fail or block a build — a working app with a plain page still
  ships. Precision-first: skips Tailwind/CSS-module/styled-components/UI-library pages, leaf components,
  and anything under 6 elements, so it cannot nag a good app. The upstream half (a five-point per-page
  contract in the architect prompt, so the FIRST build is right) is always on and needs no flag.
  ⚠️ **TWO THINGS A LATER SESSION MUST NOT RE-DERIVE.** (1) The repair runs INSIDE the post-answer
  integrity pass (`routes/agentv3.ts` ~10462), which is BEFORE the green latch is set (~10773) — so
  Green Freeze is not what governs it on the normal path, and reasoning "the freeze will refuse it" is
  wrong (I made exactly that mistake, from checking the allowlist and the freeze default but not the
  ORDERING). It is on the allowlist anyway so a RESUMED already-green session behaves identically
  instead of silently doing nothing on one path. (2) Because it runs before the app is verified, it
  CANNOT use `verifyAfterFix` — there is no green snapshot and no preview URL yet. Its net is
  `designHealGuard.ts` instead: a page the repair leaves UNPARSEABLE is restored to its pre-repair
  content (sandbox + durable store) while the pages it improved stand, and a file that was already
  unparseable is deliberately NOT reverted. Narrower on purpose, and the diagnostics say so — a repair
  that parses but breaks the app at RUNTIME is caught later by the preview check and reported, NOT
  reverted. There is no PCT canary for this flag: it is all-or-nothing, so watch the first few builds.
- **`AGENTV3_FEATURE_HEAL`** (✅ **SET `on` with `AGENTV3_FEATURE_HEAL_PCT=20` by the admin 2026-08-13**)
  — the app renders but a control the user EXPLICITLY asked for is absent from the live DOM, so ONE
  bounded repair pass adds it and the app is re-opened and re-probed (only a control genuinely in the
  DOM now counts). ⚠️ `_PCT` is a SIEVE, not a switch — `inFlagRollout` returns false immediately when
  the master flag is off, so `_PCT` alone does nothing. Keyed by workspaceId, so a given app is
  consistently in or out. Safe by construction: it is on the Green-Freeze ALLOWED list on purpose (the
  user's own request is the job, not the engine's opinion) and wrapped in `verifyAfterFix`, so a heal
  that adds the control but breaks the render is REVERTED to the exact green snapshot. Costs one extra
  repair pass, and only when a control is genuinely missing — a complete build costs nothing extra.
  Detection is `checkFeaturePresence(prompt, html)` against the RUNNING app, which is a strictly
  stronger signal than RequirementCoverage's file-name/body matching (that one feeds the honest
  "not built" notice in the user's summary instead).
- **`AGENTV3_STREAMING_PREVIEW`** + **`AGENTV3_CACHE_PREFIX`** (✅ **BOTH SET `on` in Cloud Run by the
  admin 2026-08-14**, after the dormant-flag audit below). Both had shipped gated OFF in July and had
  **never run for a single real user** until this date — so the first real builds after this are the
  first evidence either has ever produced. Treat them as new, not as settled.
  - **`AGENTV3_STREAMING_PREVIEW` — the user sees their app 30–155 s sooner.** On the fast lane the
    generated files are final long before the verify+repair loop and the dev-server install/boot
    finish; for that whole window the user watches a spinner while their finished app sits on the
    server. On, the files are persisted the instant they are ready and a `file_changed` event fires per
    file, which the preview already debounces into one reload. Safe by construction, and now by test
    (`streamingFirstPaint.test.ts`, PR #2366): the durable write is an UPSERT of only that batch, so an
    early write cannot clobber a file the build has not produced yet; a rejected write is swallowed
    because this is a HEAD START, never the build's save path; and OFF returns **no callback at all**
    rather than a no-op, since the builder branches on the callback existing. ⚠️ Logic lives in
    `src/server/AgentV3/streamingFirstPaint.ts` — it was extracted OUT of the 12k-line route precisely
    so it could be tested; do not inline it back.
  - **`AGENTV3_CACHE_PREFIX` — every build gets cheaper.** ~12 volatile context blocks (today's date,
    user prefs, ADRs, grounding) were prepended to the HEAD of the ~46KB static architect prompt, and
    Anthropic's cache matches by PREFIX — so a head that changes daily busted the cache for the entire
    static body on every build. On, that prefix moves into the per-turn USER message and the static body
    becomes a stable cache prefix (cache reads ≈ 0.1× input). The model sees identical content, only
    relocated, so quality is unchanged. `splitCachedSystem` no-ops on an unrecognised prompt shape, so it
    can only ever preserve content.
    ⚠️ **THE ONE THING A LATER SESSION MUST NOT BREAK:** the split is only half the move — the route
    RE-APPLIES the preamble to `buildPrompt` (`if (cachePrefixPreamble) buildPrompt = …`). If that line is
    ever dropped, **nothing fails**: no error, no failing build, the model just silently stops receiving
    the date, preferences, ADRs and grounding on every build and answers quietly get worse. Pinned by
    `tests/cachePrefixWiring.test.ts`.
  - **Why env vars and not code defaults:** for a path that has never run in production, an env var is
    the safer switch — instant revert with no deploy. Once real builds prove them, the defaults move
    into the code and these two keys RETIRE (which is also what shrinks the flag surface the admin
    objected to). **What to watch:** the preview appearing early and correct (not a half-rendered app),
    and per-build cost dropping on repeat builds of the same workspace.
- **`AGENTV3_WRITE_TYPECHECK`** (default ON, set `off` to disable — added 2026-09-17, autopsy e706e068) —
  **write → typecheck → next.** After every TypeScript write/edit (`write_file`, `write_files_batch`,
  `edit_file`, `replace_symbol`) the dispatcher runs the SAME incremental `tsc --noEmit` the endgame
  and the `typecheck` tool use (one shared `/tmp/agentv3.tsbuildinfo` cache, so a run after the first
  is well under a second) and appends the written file's own errors to the tool result, while the model
  still holds the file. Errors elsewhere are counted and named briefly, never dumped. The School ERP
  build wrote 20 files before its first `tsc`, then ground 21 errors for seven minutes — every one of
  them visible the moment its file was written. Never blocks a write, never fails a build, never
  fakes a pass (a JS project, a missing compiler or a timeout ⇒ no note); two consecutive 30 s
  timeouts stand it down for the build. Runs coalesce per build (a parallel burst costs at most two
  compiles) and each run reaches the release gate's typecheck evidence through `onCommand`. Report
  line `WRITE_TIME_TYPECHECK`. Logic in `writeTimeTypecheck.ts`; test-locked in
  `tests/writeTimeTypecheck.test.ts`.
  🔴 **IT WATCHES ONE LANE, AND ITS REPORT LINE USED TO DENY THE OTHER (corrected 2026-09-22).** All
  four call sites are in `ToolDispatcher`, so the check sees the ARCHITECT's writes; the FAST LANE
  writes through `deps.writeFiles` and verifies once with a `tsc` of its own — by design, since its
  files are generated concurrently and a per-file compile would quote errors from files not yet
  written. So a successful fast-lane build leaves the counters untouched, which is correct, and the
  summary read that silence as **"no TypeScript source was written this build (0 write(s) skipped as
  not TypeScript)"** — about a build that had just written a whole app. ⚠️ **`sharedWriteTypecheckStats`
  had ALREADY named the all-zero state as the tell** (*"that object was never touched, not that
  nothing happened"*, autopsy 3ce8459b) for the SUB-AGENT cause of it; that instance was fixed by
  sharing the object and the fast-lane sibling was never hunted — the headline class again, and the
  third time this one sentence has been wrong. **Fixed with EVIDENCE, not wording:** the route passes
  `modelAuthoredPaths(writtenFiles).filter(shouldTypecheckWrite).length` — `writtenFiles` being the
  one set every lane feeds — so "no TypeScript source was written" is said only when a real count
  says so, `null` means *not supplied* and never zero, and `writeTypecheckUntouched` makes the
  silence unrepresentable as a fact about the build. Test-locked and reversion-proven four ways in
  `tests/theCounterWatchedOneLaneOfTwo.test.ts`.
- **`AGENTV3_ARCH_INVARIANTS`** (default ON, set `off` to disable) — before EDITING an existing app, the
  engine reads that app's OWN rules out of its code (styling system, import style, where network calls
  go, where pages live) and hands them to the builder before it writes a line; after the build it checks
  the changed files against the rules derived from the project as it was BEFORE the build. Costs no file
  reads (it uses the already-warm graph) and no model call. Purely advisory — it can never fail a build.
  Report codes: `ARCHITECTURE_INVARIANTS_HELD` (clean) / `ARCHITECTURE_INVARIANT_VIOLATED`.
- **`AGENTV3_PREVIEW_DOOR`** (default ON, set `off` to disable — added 2026-08-22) — the live-preview
  iframe points at OUR OWN workspace-stable route (`/api/agentv3/preview-door`, HMAC-tokened) instead of
  a stored sandbox URL; the route resolves "which machine, which port" at REQUEST time (proven recipe
  port first, then a verified port sweep) and 302s ONLY to a port it just saw serving. A dead machine
  shows a NavBharatAI-branded auto-retrying page, never the vendor's error — this ended the day of
  "Sandbox Not Found"/"Closed Port Error" screenshots. ⚠️ TWO THINGS NOT TO BREAK: (1) the waiting
  page's self-retry is CAPPED (~2 min) because a door hit RESUMES a paused sandbox — uncapped, an
  abandoned open tab would fight the idle reaper forever at real E2B cost; (2) `off` stops both minting
  and answering, and the client falls back to the old stored-URL behaviour byte-identically.
- **`TIME_TO_FIRST_RENDER` / `POST_GREEN_WRITES` — the measurement that decides the next protection
  (added 2026-09-18; no flag, always on, zero cost).** After Option A, before anything stronger: when did
  the app first render in a real browser, and WHO wrote to it afterwards, and did it survive?
  `postGreenWrites.ts` (pure) + a second observer at the freeze's own chokepoint
  (`greenFreeze.setWriteObserver`, fired on every ALLOWED `assertWriteAllowed`, so tool writes, heals,
  restores and sub-agents are all seen once; infra paths never). The `POST_GREEN_WRITES` line's SEVERITY
  is the finding: nothing wrote → info; wrote and still rendered → info; **wrote and ended PROVEN BROKEN
  → warning naming the writers** — the evidence the two candidate protections (verify-and-revert per
  post-green write; the freeze armed before the gate stretch) are waiting for. ⚠️ **Do not build either
  of those until this line has produced warnings on real builds** — as of this date no report shows a
  pass breaking a green app, and #3084 shipped `READY_BEFORE_END` first for the same reason. Both codes
  are `PROCESS_ONLY_CODES` and `NEVER_SUGGEST`. Test-locked in `tests/whoWroteAfterTheAppWasGreen.test.ts`.
- **`AGENTV3_IN_BUILD_GREEN`** (default ON, set `off` to disable — added 2026-09-18, admin: *"navbharatai
  dwara app banne ke baad tutni nahi chahiye!!!!!"*) — **a working app is never lost to later edits in the
  SAME build.** GreenGuard (2026-08-09, the admin's identical sentence then) restores a PREVIOUS build's
  green snapshot when a turn ends proven-broken — so on a first build, where the app rendered at minute 2
  and a later step broke it, there was nothing to restore from. Now the build's OWN first proven render
  (real browser, same judge and same three refusals as the late check: never curl, never inconclusive,
  never server-down) is saved as the last known good **to the same key GreenGuard reads**, so the
  end-of-build restore path covers the case the admin described with no second store and no second rule.
  Logic in `inBuildGreen.ts` (pure); the I/O half runs BESIDE the loop in `routes/agentv3.ts`
  (`attemptInBuildGreen`), fire-and-forget on a `preview`/`tool_result` event, one browser open per
  attempt bounded by `MIN_ATTEMPT_GAP_MS` (15 s), zero model calls, every failure swallowed.
  ⚠️ **It does NOT freeze writes and does NOT stop the build** — a rendering app is not a finished app;
  only the worst case changes (the version that rendered comes back, with an honest note). 🔒 **The
  snapshot must be of the tree that RENDERED:** a write counter is compared before the browser opens and
  after the files are collected; a change discards the attempt (`IN_BUILD_GREEN_RACED`) and a later
  trigger retries. ⚠️ **Semantics, stated plainly:** the last known good is now the LATEST PROVEN
  RENDER, which on an edit turn may be a mid-edit state that renders — GreenGuard's own rule ("green now
  → save it"), applied inside the turn. Report codes `IN_BUILD_GREEN` / `_RACED` / `_NOT_YET` /
  `_UNCHECKED`; the restore's reason and the user's summary correction say "earlier in this build"
  instead of "your change was not kept" when the snapshot is this build's own (`turnStartedAt`,
  `fromThisBuild`). Test-locked and reversion-proven four ways in
  `tests/aWorkingAppIsNeverLostToItsOwnBuild.test.ts`. **What to watch:** `IN_BUILD_GREEN` appearing
  a minute or two into builds, and `GREEN_GUARD_RESTORED` on FIRST builds — which was impossible before.
- **`AGENTV3_GREEN_FUNCTIONAL_REPAIR`** (default ON, `off` restores suggest-only exactly — added
  2026-09-23, autopsy ac41a924, admin: *"han to fix karo"*) — **a real bug in a working app gets ONE
  verified repair.** Green Stop made every reviewer finding on a green app a suggestion. That is right
  for the engine's opinions, but it shipped a news site whose articles all rendered as ONE paragraph and
  whose footer linked into "page not found". The reviewer found both, and was allowed only to suggest.
  Now `selectGreenRepairable` (`ReviewerAgent.ts`) picks the findings that name BROKEN behaviour.
  Criticals as well as warnings qualify, but only when the text is functional, so *"move keys to a
  vault"* stays an offer. One pass fixes them in pass `reviewer-functional-repair`, wrapped in
  `verifyAfterFix`.
  🔒 **FOUR RESTRAINTS NO OTHER ALLOWED PASS CARRIES, because it is the one with a history of harm (the
  2026-08-12 `.env` erasure).**
  • An unproven result is UNDONE, not kept.
  • A repair that does not finish inside its budget is stopped and undone.
  • The pass may never write a `.env*` file (`SECRET_FILE_DENIED_PASSES` in `greenFreeze.ts`).
  • It never runs without a snapshot it took itself.
  ⚠️ **The budget is the BUILD's clock, not the advisory cap's.** That cap (120 s) is armed before the
  reviewer runs, so it routinely has ~30 s left. `greenRepairPlan` sizes the repair from the wall clock
  (max 150 s) and re-arms the cap ONCE, to repair + 40 s check + 20 s settle — still a finite bound.
  Report codes: `REVIEW_FUNCTIONAL_REPAIRED` / `_UNDONE` / `_SKIPPED`. Whatever it does not fix is still
  offered, exactly as before.
  🔴 **SIBLING FIXED IN THE SAME CHANGE: a reverted heal used to be SAVED AGAIN.** Every `verifyAfterFix`
  revert wrote the snapshot back through the actuator, which the captured-writes map never saw. The
  end-of-build save lets that map win, so the broken change the sandbox had just undone went back into
  the durable store. The next restore brought it back. All three revert sites now share
  `revertToGreenSnapshot`, which calls `reconcileCapturedWrites` (`GreenGuard.ts`). It also refuses an
  EMPTY snapshot, because `restorePlan({}, cur)` would delete the whole workspace. Test-locked and
  reversion-proven in `tests/aRealBugInAWorkingAppGetsOneVerifiedRepair.test.ts`.
- **`AGENTV3_FASTLANE_REASONING_GATE`** (default ON, `off` reverts — added 2026-09-23, autopsy ac41a924,
  PR #3278). The fast lane is skipped when the build opens on a model that ALWAYS reasons
  (`modelAlwaysReasons`). Its single plan call is capped at 90 s, a cap sized for a rung that answers
  directly, so on `kimi-k2.7-code` it spent the whole cap thinking and handed over nothing.
  `fastLaneRungDecision` in `fastLaneRung.ts`; report code `FAST_LANE_SKIPPED_REASONING_RUNG`.
- **`AGENTV3_GREEN_REVIEW_LEAN`** (default ON, set `off` to disable — added 2026-09-18, autopsy b6f88a72) —
  **a suggestion costs a suggestion's price.** `reviewerShouldWrite` (Green Stop) already makes the
  post-build reviewer suggest-only on a proven-green app — no repair, nothing it says can fail the
  build — yet it ran at full budget and the full 40-step sub-agent cap: on the Gita build **40 calls,
  `src/App.tsx` read six times, 523,374 input tokens = 34% of the build's LLM spend, zero characters
  back.** Now `greenReviewPlan` (`greenReviewPolicy.ts`) is that SAME write rule reused — never a
  second "is it green?" question — and exactly when the review can only suggest it is also lean: a
  hard step cap (`GREEN_REVIEW_MAX_STEPS` = 12, a second `makeSubAgentSpawn` from the hoisted
  `subAgentDeps`), a 45 s budget (`GREEN_REVIEW_BUDGET_MS`, the existing floor, via
  `reviewerBudgetMs(…, { previewGreen })`), and an instruction that says so (`reviewBuild({ mode:
  'suggest' })`, built by the now-pure `reviewerInstruction`). ⚠️ **Where the reviewer can WRITE —
  not green AND (build failed OR proven broken) — nothing changes: full budget, full steps.** The cut
  is in TOKENS, never in strictness. ⚠️ "Could not look" (not green, not proven broken, build ok) is
  ALSO lean, on purpose: Green Stop already made it suggest-only (*ignorance is not a licence to
  edit*, 2026-08-23), so an offer costs an offer's price there too. Report code `REVIEW_LEAN`.
  Test-locked and reversion-proven four ways in `tests/aSuggestionCostsASuggestionsPrice.test.ts`.
  **What to watch:** reviewer token share on green builds (34% → single digits expected), and that
  the reviewer's findings on NOT-green builds are as complete as before.
- **`AGENTV3_JOURNEY_CHECK`** (default ON, set `off` to disable) — after a successful build with a live
  preview, derives a real user journey from the app's OWN markup and runs it in the sandbox's pre-baked
  browser: fill the form, submit, **reload, and check the item is still there**. That last step is the
  only thing that separates an app which really saves data from one that only looks like it does. Every
  selector is read out of the source, never guessed; a form it cannot address honestly yields NO journey.
  A journey against a USER-OWNED database is downgraded to a non-writing submit — we do not put test rows
  in somebody's real Supabase. Evidence, never a gate. Codes: `JOURNEY_PASSED` / `JOURNEY_FAILED` /
  `JOURNEY_NOT_DERIVED` / **`JOURNEY_NOT_RUN`**.
  🔴 **IT HAD NEVER ONCE LAUNCHED A BROWSER, from the day it shipped until 2026-09-17 — so do NOT read
  the paragraph above as a description of evidence this engine has been collecting.** `journeyScript`
  built its own run line and omitted `PLAYWRIGHT_BROWSERS_PATH`; Chromium exists ONLY under
  `/home/user/.e-tools/.browsers` (both the image build and `_kickoffPlaywright` install it with that
  variable set, and it is never a persistent `ENV`), so `chromium.launch()` threw before the first
  journey of every build. Its sibling `pageCheckScript` set the variable, and fourteen other Playwright
  invocations in this repo set it; this one did not — the drifted-copy class, and a repeat of the
  `browseUrl` bug whose own comment records it being root-caused once already.
  ⚠️ **AND THE SAME LINE MADE IT UNOBSERVABLE, which is the half worth remembering:**
  `… 2>&1 | grep '^NBAI_JOURNEY ' || true` folds stderr into stdout, discards every line that is not a
  result, and swallows the exit code — so a script that died at line 1 and one that ran perfectly and
  found nothing return the IDENTICAL empty string. Both run lines now come from ONE builder
  (`sandboxBrowserScript.ts`) that carries the path by construction and, when a run yields no result,
  prints a bounded tail of what the script really said under `NBAI_DIAG:`.
  🔒 **`summarizeJourneys` returns `ran` as well as `ok`, and the route reads it.** Zero results used to
  be `{ ok: true }`, which the route mapped to `JOURNEY_PASSED` at severity `info` with
  `autoResolved: true` — so throughout the outage every build recorded a PASSING journey code whose own
  message read *"No user journey was run."* The message was honest; the code was not, and the code is
  what a reader scanning a report sees. `JOURNEY_NOT_RUN` is neither a pass nor a failure, and is
  registered in `PROCESS_ONLY_CODES` and `NEVER_SUGGEST` so it can never count against the user's app.
  ⚠️ **What to watch on the first real builds: `JOURNEY_PASSED` / `JOURNEY_FAILED` appearing at all.**
  Until now the only journey outcomes a report could carry were `JOURNEY_NOT_DERIVED` and the
  mislabelled empty pass. A sudden crop of `JOURNEY_FAILED` is not a regression — it is the check
  working for the first time, and each one is a real app that looks like it saves data and does not.

- **`AGENTV3_CONTRACT_FILE`** (default ON, set `off` to disable — added 2026-09-17, autopsy 57875eb3) —
  the fast lane's SHARED CONTRACT (the enums / interfaces / types every per-file call is handed) is now
  written as a REAL file, `src/types.ts` (or `types.ts` when the app has no `src/`), BEFORE any other file,
  and every per-file and repair prompt names it with the exact relative import specifier for that file.
  **Why:** the contract used to be a paragraph with no home — the manifest planned no file for it — so
  eleven isolated calls each invented one (`../types/game`, `../types/note`, `./types/game`, `./App`),
  `tsc` failed on file one, and the repair pass that followed is where a 29-minute build died. Bodiless
  util SIGNATURES stay in the prose block (valid in a declaration, a compile error in a module) and are
  implemented by the file the manifest names. A planned types file at that exact path is superseded by
  the contract rather than generated twice. No file is written for a contract with nothing exportable,
  nor for a framework the module cannot load in (Python, Rails, …) — today's behaviour exactly. Logic in
  `SimpleBuilder.ts` (`contractModule`, `contractFilePath`, `contractImportSpecifier`); test-locked in
  `tests/theContractIsAFileNotAParagraph.test.ts`. **What to watch:** the repair-attempt count on Weak
  fast-lane builds — with the symbols homed, the errors that remain should be the mechanical ones the
  deterministic pass already fixes for free.

- **`AGENTV3_SNAPSHOT_BUCKET`** (default ON wherever bucket-only publishing is on; `off` reverts
  snapshots alone — added 2026-09-18, admin Monitor capture) — a build SNAPSHOT is now served from the
  same Cloud Storage bucket as a published app, on its own `s-<hash>` subdomain, instead of taking a
  Firebase Hosting channel.
  🔴 **WHY, AND IT CORRECTS A CLAIM THIS FILE MADE THE DAY BEFORE.** The 2026-09-17 entry above says
  the publish ceiling is GONE because bucket-only publishing is live. The ceiling kept climbing anyway,
  **43 → 46 channels with the flag on**, and every id in the admin's reclaim list began `sn-`. Those are
  `snapshotChannelId`, not `makeChannelId`: preview snapshots, one per workspace, created on every green
  build, and **deleted by nothing** — `snapshotChannelId` appeared at exactly two places in the whole
  server, the line that builds the id and the line that deploys to it. Bucket-only publishing could
  never touch them, because the bucket branch in `deployStatic` was gated on the channel being the
  PUBLISH channel and a snapshot passes its own id by design. So publishes stopped taking channels and
  builds carried on taking them.
  🔒 **THE NAMESPACES CANNOT OVERLAP**, which is what lets one branch serve both: `v3-…` is a Firebase
  publish channel, `a-…` a bucket-only publish, `s-…` a bucket snapshot. A snapshot must never be able
  to overwrite what somebody deliberately published — the same rule that gave it a separate Firebase
  channel, carried into the bucket. ⚠️ **ONE branch in `deployStatic` handles both**, deliberately: that
  method's own docblock says `channelId` is a parameter rather than a second method precisely so the
  two paths cannot drift, and this is that rule applied again.
  ⚠️ **No Cloudflare Worker change is needed** — the Worker already resolves ANY `<sub>.<domain>`
  against `apps/<sub>/`, so the new prefix is served by the code already at the edge. That matters
  because the Worker is deployed by pasting and is the one piece CI cannot prove.
  **What it does NOT do:** the channels already taken stay taken. Clearing them is the admin panel's
  *Reclaim all* button (same change), and reclaiming a snapshot is the safest delete on that screen
  because the next green build writes it again. Logic in `bucketOnlyPublish.ts`
  (`snapshotSubdomain`, `snapshotBucketEnabled`); test-locked in
  `tests/theCeilingWasNeverThePublishes.test.ts`. **What to watch:** the Publish load tile should stop
  rising as builds complete.

- **⚖️ THE JUDGE'S FALL-THROUGH WAS GUARDING THE WRONG STATEMENT (autopsy 2026-09-20; no flag, on by
  construction).** Admin: *"nvidia nahi chal rah hai. jabki woh free hai. dekho kya problem hai.
  kaha?"* — and the honest answer was that **nothing in this platform could say where.**
  🔴 **TWO DEFECTS, both verified by reading the code rather than from a report.** (1) `selectReviewJudge`
  wrapped `new OpenAI({…})` in a `try`, with a comment promising *"a Nemotron outage, a revoked key —
  each simply lands on the judge that is running in production today."* **Constructing an SDK client
  makes no network call**, so it does not throw for a wrong key, a wrong model id, a wrong host, an
  exhausted plan, a 404, a 401 or a timeout. Every one of those happens inside the returned `runTurn`,
  **outside that `try`** — so they reached `judgeBuild`'s catch, which records NOT REVIEWED and stops.
  The review never fell back; **the build silently lost its quality gate**, on every build of that tier.
  (2) That catch then **discarded the error object entirely**, so a bad key, a bad model id, a timeout
  and an empty reply all produced ONE identical sentence naming neither the engine nor the cause.
  🔑 **THE STATUS CODE IS THE DIAGNOSIS, which is why throwing it away was the expensive half:**
  401/403 is the key, 404 is the model id or the host, a timeout is the network or the plan. The
  report now carries it (`judgeFailureReason`), admin-only, one bounded line.
  🔒 **The fix is a CHAIN AROUND THE CALL** (`src/server/AgentV3/judgeChain.ts`, pure): a candidate is
  (kind, modelId, runTurn), and the composed runner walks them at CALL time. **The order is exactly
  today's** — Nemotron → GLM (never on `power`) → Grok → Sonnet last — so no engine becomes reachable
  that was not reachable before; only WHEN the fall-through happens changed. Weak's protection against
  a Sonnet judge is still `noClaudeZone`, refusing at call time; under the chain that refusal is
  RECORDED instead of invisible.
  ⚠️ **AN EMPTY ANSWER IS THAT RUNG FAILING, NOT A VERDICT** — and this is why a wider `try` would not
  have been enough. A reasoning model can spend its whole output allowance thinking and return empty
  content (`glm-5.3` and `kimi-k2.7-code` are both in `MEASURED_ALWAYS_REASONS` for exactly this).
  The old path handed that empty string to `parseJudgeVerdict` and recorded *"the reviewer's answer
  could not be read"* — a sentence about our parser, for a rung that never wrote a character.
  ⚠️ **Each engine is asked for ITS OWN model id.** `judgeBuild` passes one; without the chain owning
  it, the second candidate would be asked for the FIRST one's model at a host that has never heard of
  it — a fallback that cannot succeed.
  ⚠️ **The engine is named AFTER the call** (`chain.servedBy() ?? judge.kind`): with a real
  fall-through, printing the PLANNED name would re-create the defect `judgeEngineLabel` was written to
  fix — a report crediting work to an engine that did not do it.
  🔒 **It still never blocks a build**: when every candidate fails the chain re-throws, so `judgeBuild`
  produces the same honest NOT REVIEWED verdict as before. Cost is at most one extra call per FAILED
  rung, and zero on the ordinary path (test-locked). Test-locked and **reversion-proven three ways** in
  `tests/theJudgeFallsThroughWhereItFails.test.ts` (16 cases), including a SOURCE-level guard — `tsc`
  and `vitest` cannot see that a try/catch guards the wrong statement, which is exactly how this
  survived.
  **What to watch:** the `CHEAP_REVIEW` / `CHEAP_REVIEW_NOT_RUN` detail on the next Weak build. It now
  names each engine that failed and its status code — that line is what answers "kaha?".
- **🧹 `AGENTV3_STREAM_THINKING` — the model's REASONING no longer reaches the chat (added 2026-09-20).
  ⚠️ NOT set, and the code default is OFF**; `on` restores the pre-2026-09-20 behaviour exactly with no
  deploy. Read by `src/server/AgentV3/thinkingStream.ts`; gates BOTH emit sites — `AgentRunner`'s
  `onThinking` and the fast lane's in `routes/agentv3.ts`.
  🔴 **WHY (admin, with two screenshots of a phone filled top to bottom with grey italic text):**
  *"1- main reply with diff · 2- light/gray reply (bakwaas, yeh nahi chahiye!) · 3- live events (yeh
  theek hai)"*. What filled the screen was the architect's private working notes — *"The user asked to
  verify and finish, not start over. I need to read the full App.tsx…"* — streamed verbatim to somebody
  who asked for a billing app. The admin's own 1/2/3 maps exactly onto three separate channels in the
  code, which is why removing #2 needed no clever filtering and **cannot touch #1**: they travel on
  different `kind`s from different emit sites (verified before the change, not assumed).
  🔑 **IT WAS NOT MERELY LONG, IT WAS STRUCTURALLY UNFOLDABLE.** `FoldableMessage` collapses any reply
  over 700 chars, but the renderer skips it entirely while a line is `streaming` — and a thinking line
  NEVER stops streaming, because the reducer finalizes only `kind: 'text'`. So no length limit, present
  or future, could ever have reached that channel. The sibling was fixed in the same change: a
  `narration` line still marked streaming when a build ENDS (a turn that threw, a user Stop) is now
  settled, so every long reply can fold.
  ⚠️ **THIS HIDES REASONING; IT DOES NOT STOP IT BEING GENERATED, and the difference is where the money
  is.** Asked *"thinking off kar do?"*, the honest answer was that it already IS off wherever it can be:
  Anthropic adaptive thinking is pinned `false` in `AgentV3Panel`, and the lead rung `glm-4.7-flashx` is
  sent `thinking: disabled`. The rungs below it reason unconditionally and expose no switch — GLM says
  so in its own 400 (*"This model always engages in thinking and cannot be disabled"*, glmThinking.ts)
  and `kimi-k2.7-code` is in `MEASURED_ALWAYS_REASONS`. **The tokens are spent either way.**
  🔒 **It cannot re-open the blank-screen autopsy (2b0a3ed5).** That silence is covered by the
  elapsed-clock heartbeat (`startWorkingHeartbeat` → `workingLine`), which is untouched — verified: it
  is set up eight lines below the emit this flag gates. Tool events and text deltas keep flowing, and
  the agent card is still touched by a reasoning delta, so a build never looks frozen.
  Test-locked and **proven by reversion** in `tests/theChatShowsTheWorkNotTheThinking.test.ts`, whose
  source-level guard fails if either emit site loses its gate — deleting one breaks no behavioural test
  in this repo, which is exactly why that guard exists.
- **🗣️ THE LIVE STRIP SPEAKS THE USER'S LANGUAGE (same change, no flag, no cost).** It read `writing
  src/components/InvoiceForm.tsx` and `running: npm install --no-audit --no-fund` — a developer's
  sentence shown to a shopkeeper on a phone, and the only window they have onto the build. Now:
  `writing Invoice form`, `installing packages`. `src/components/agentv3/toolLabels.ts` drops the
  directories and spaces a **PascalCase** name (the convention this engine uses for a screen or a
  component); a lowercase identifier like `useInvoices` is left EXACTLY as written, because it is a
  real name the user meets again in Code Studio and "Use invoices" would be a different word from the
  one in their project. A command is renamed only when recognised exactly — anything else is shown as
  typed (capped at 48 chars), because *"running a command"* would hide a real fact and a guessed
  description would state a false one. Full paths are unchanged in the Files tab, the diff and Code
  Studio. Test-locked in `tests/theStripSpeaksTheUsersLanguage.test.ts`.
- **💯 HOW MUCH OF THE APP IS BUILT — a percentage that refuses to be a timer (added 2026-09-20; no
  flag, no cost).** Admin: *"app kitne % ban gayi woh bhi likh kar aana chahiye … **100% done - tap on
  preview!**"*. That last clause is the design, not decoration: **the preview IS the completion
  criterion**, which is what this platform already believes everywhere that matters (`markAppRendered`
  is the single producer of that proof, and the billing law turns on it — *"app bani = preview chala"*).
  🔴 **WHAT IT REFUSES: a bar that crawls on elapsed time.** Every competitor ships one and it is a lie
  by construction — it moves while nothing happens and is always near 90% when a build is about to
  fail. `src/components/agentv3/buildProgress.ts` is pure and every point is a COUNT of things that
  really happened: todos the engine marked `done`, the phase it declared, a preview URL it published,
  a render it proved. Call it a thousand times with the same facts and it returns the same number.
  🔒 **100% IS EARNED.** Only `done && ok && appRendered` reaches it. A build that finished but whose
  render was never proven stops at the number it really reached and says *"finished, preview not
  confirmed"* — saying "100% done — tap Preview" there is autopsy `697b38ee` in the other direction. A
  RUNNING build is capped at 97 so that 100 keeps meaning something; a failed one reports where it got
  to plus *"Your files are saved."*
  ⚠️ **THE HONEST COST, recorded rather than discovered later: without a plan the number JUMPS**
  (5 → 80 → 90 → 100) instead of gliding, because the in-between values do not exist. `basis` on the
  result says which case a reading came from (`plan` / `milestone` / `none`) so a lumpy number is
  distinguishable from a broken one. **Only `done` todos count** — half a point for `in_progress` is a
  convention, not a measurement.
  📌 It rides on the ONE live strip (`WorkingIndicator`) beside the elapsed clock, and the clock is
  what keeps a paused number from reading as a hang — a clock is a measurement, a bar is a promise. The
  floor is held per BUILD ID so it can never fall back mid-build nor seed the next build's first frame.
  Test-locked in `tests/hundredPercentIsEarned.test.ts`.
- **📏 `LADDER_DEPTH` — how far down its tier's ladder a build actually went (added 2026-09-20; no flag,
  always on, zero cost).** Admin: *"pehle yeh measure karo, kitni builds pehle rung par khatam hoti
  hai"*. **Nothing in this repo could answer it**, and the reason is worth recording: `deliveredVia`
  names the VENDOR, and on Weak/Normal the vendor GLM holds **rung 1 (`glm-4.7-flashx`) AND rung 3
  (`glm-5.3`)** — so a build that fell two rungs and one that never left the first were
  indistinguishable in that field; `escalations` counts TIER escalations, a different mechanism, and is
  0 for every ordinary fall inside one tier.
  **It is the size of two open questions at once:** the lead rung is the one sent `thinking: disabled`,
  so the share of builds that LEAVE it is both how much reasoning a user can be shown and how much of
  the cost gap between the cheapest rung and the rest is real. `src/server/AgentV3/ladderDepth.ts` is
  pure and reads the provider ledger we already hold — no call, no I/O, and it decides nothing (a
  measurement that fed back into the routing it measures would stop being a measurement).
  🔒 **An unrecognised model is never rounded into a rung** (`glm-4.7-flash` is NOT `glm-4.7-flashx`;
  exact-match only, except the Claude rungs which name a family by design), and **a rung that was tried
  and delivered no output tokens is never counted as reached** — counting it would report "fell to rung
  3" about a build rung 3 never wrote a character of. Unattributable ⇒ `unknown`, folded rather than
  dropped, because a dropped build would make the rung-1 share look better than it is.
  **Where to read it:** the `LADDER_DEPTH` line in the admin build report (per build), and
  `byLadderDepth` in the daily cost telemetry (the aggregate). Registered in `PROCESS_ONLY_CODES` and
  `NEVER_SUGGEST` — how OUR router behaved is never a finding about the user's app. Test-locked in
  `tests/ladderDepth.test.ts`.

- **🔁 THE READ LOOP, AND THE TWO THINGS THAT LET IT RUN UNSEEN (autopsy `c847b523`, 2026-09-20; no
  flag, all four fixes are on by construction).** The build read `src/App.tsx` **nine times**, wrote
  **zero files**, and the user pressed **Stop at 108 s**. The report carried **39 `control-unlabeled`
  findings**, every one against NavBharatAI's OWN golden scaffolds.
  🔴 **THE ANALYZER WAS LYING ABOUT 20 OF THE 39, and none of the three bugs is a form-label bug —
  each silently disabled EVERY OTHER RULE in `AccessibilityAnalysis.ts`.** (1) The tag scanner was
  `/<\s*[a-zA-Z][\w-]*\b[^<>]*?\/?>/g`, and `[^<>]` cannot contain a `>` — but `(e) => set(e)` does,
  so **every attribute after the first handler was invisible**: `aria-label`, `alt`, `id`, `title`,
  `href`, `scope`, `lang`. (2) `tagName` lowercases, so `<Select label="Category">` was judged by the
  rules for HTML `<select>` and `<Dialog.Root>` as `<dialog>` — a false finding that lands on any user
  with a design system. JSX makes this **decidable, not heuristic**: lowercase is an element,
  capitalised or dotted is a component, and we cannot know a component's contract. (3) A wrapping
  `<label>` counted only on ONE line, so the commonest React form shape in the world read as
  unlabelled. Findings fell **39 → 19** on these alone.
  🔒 **THE OTHER 19 WERE REAL, AND THE FIX IS NOT 19 LABELS.** Nothing had ever run our own gate over
  our own templates: the scaffolds have had a CI lock for parsing, for Babel compilation and for
  duplicate imports since the white-screen work, and accessibility was never asked — so the first
  thing a user's app inherited from us was a screen a blind user cannot fill in.
  `tests/ourOwnTemplatesPassOurOwnGate.test.ts` runs the **real** `scanAccessibility` over every
  registered scaffold (a copy of the rules would drift; asking the production module cannot), and
  carries its own canary so a scanner that silently returned `[]` cannot make it pass for ever.
  🔑 **AN INSTRUMENT ABOUT OUR OWN ENGINE MUST NOT LIVE INSIDE ANOTHER FEATURE'S CONDITIONAL — name
  this class, it will recur.** `REPEATED_READS`, the ONE finding that describes this exact build, sat
  inside `if (credentialGuardEnabled() && expectsArtifacts && writtenFiles.size > 0 &&
  !abort.signal.aborted)` purely because that feature had already assembled a file map. Three of the
  four were false here, so it had been reporting only on builds that **wrote files and were never
  stopped** — the ones least likely to have looped. A biased sample reads as an ABSENCE of the problem,
  which is worse than no measurement because nobody doubts it. It and its sibling
  `WRITE_TIME_TYPECHECK` now sit beside `READY_BEFORE_END`, the block that already states this rule.
  ⚠️ **`tsc` and `vitest` cannot see a measurement that is merely unreachable**, so the lock is a
  SOURCE-level guard (`tests/theLoopBreakerAndItsMeasurement.test.ts`), proven by reversion.
  🔁 **AND THE ADVICE NEVER ESCALATED:** the nudge fired on reads two through nine, word for word.
  `READ_LOOP_LIMIT = 3` turns it into a STOP that names the three ways out — write the change, write a
  different file, or **say plainly what is blocking you** (a stop that only forbids leaves a model
  nowhere to go, and it reads again). What makes it MECHANICAL rather than a louder nag: `stalls`
  counts only reads where the file was unchanged **and not one file anywhere had been written since
  the previous read of that path** — a provably no-progress step. A re-read after an edit resets it to
  zero and never sees the message. The write counter lives on `onFileWrite`, the one durable-write
  door, so the answer is true by construction. ⚠️ **The content is STILL returned in full** — refusing
  a read is the one intervention that can strand a model whose context was trimmed, which is worse
  than the loop. `readLoopStops()` rides on the `REPEATED_READS` detail: stops **plus** a still-high
  re-read count is the escalation being IGNORED, a different problem that must be legible as such.
  ⚠️ **OPEN, not decided here: the DOUBLE DISCOUNT on a stopped build.** A cancelled build has its
  markup waived (no proven preview) and is then halved again for the cancellation, so a stopped build
  can cost NavBharatAI money rather than merely earning nothing. Both rules are individually correct
  and admin-mandated; their composition was never decided. Raised to the admin — billing is not a
  session's call.
  ✅ **DECIDED AND SHIPPED 2026-09-21 — this paragraph stayed "OPEN" after it closed, and a session
  (mine, 2026-09-23) re-asked the admin from it.** The admin chose *"floor + naya message"*:
  `cancelledBuildBilling.ts` now bills `min(decided, max(realCost + sandbox, decided / 2))`, so a
  cancellation may take our margin and never our cost, and the route passes `realCostUsd` /
  `sandboxUsd` in (commit `6844b99f`). Re-grep before re-raising anything this file calls open.

- **🙋 A QUESTION IS AN ANSWER, NOT AN EMPTY BUILD — the retry overrode a correct reply and billed
  ₹196.28 for it (autopsy `e628efd4`, 2026-09-25; no flag, on by construction).** A free-tier user
  asked *"if we don't have a chat in next 2 hours can you send a message to initiate the chat
  again"*. The first model answered it correctly in 7 seconds and asked whether they wanted a small
  reminder app built — zero tool calls, `end_turn`. **That was the right answer.**
  🔴 **`decideBuildNudge` SAW IT AND STOOD DOWN** (`BUILD_NUDGE_STOOD_DOWN`, detail `asked-the-user`).
  **156 milliseconds later `shouldRetryEmptyBuild` read the same turn, counted `filesWritten === 0`,
  and re-ran the whole build one rung higher:** 53 calls, 9 minutes, a six-feature chat app with auth,
  profiles, realtime, notifications, moderation and media upload that nobody ordered.
  🔑 **`nudgeToBuild.ts` had already named the class in its own docblock** — *"`toolUses.length === 0`
  is not evidence of a stall … ask what the turn WAS, not merely count what it did."* `filesWritten
  === 0` is that mistake with a different counter. And **half the guard was already carried across**:
  `modelRefused` IS `turnDeclined`, the same `looksLikeRefusal`. The sibling, `turnAskedTheUser`, was
  left behind — this repo's headline class, one of two lanes fixed.
  ⚠️ **`looksLikeRefusal` was RIGHT to stay silent**: it needs "I can't" near build/make/create/help,
  and the answer says *"I can't **send**"*. The guard that had to speak did not exist.
  🔒 **BOTH HALVES SHIP TOGETHER, or the fix trades one problem for another.** Suppressing only the
  retry leaves zero files reaching `emptyBuildFailureSummary`, which would answer the user's question
  with *"The build produced no files. Please try again"* — 697b38ee's sin in a new place. So
  `emptyBuildFailureSummary` gains `askedTheUser` too, and standing down there leaves `result.ok`
  true — **which is also what keeps the "add credits" upsell quiet**, since that block is gated on
  `!result.ok` and the comment beside it explicitly forbids writing a second answer there. One fix,
  three harms, no second answer anywhere.
  💸 **The bill goes to ₹0**, not by a new rule: a turn that writes no files is zeroed
  *unconditionally*, whatever its verdict. Report code `TURN_ANSWERED_A_QUESTION`, in
  `PROCESS_ONLY_CODES` and `NEVER_SUGGEST` — our retry policy is never a finding against the app.
  Test-locked and **reversion-proven four ways** in `tests/aQuestionIsAnAnswerNotAnEmptyBuild.test.ts`
  (19 cases), against that report's verbatim answer.
  🔴 **THE MISSING SUBSYSTEM, named so it is not re-discovered: nothing answers "what KIND of turn was
  this?" in one place.** `looksLikeRefusal` has four readers, `turnAskedTheUser` had one, and every
  other verdict infers the turn's kind by COUNTING its outputs. A single derived `turnKind`
  (`built` / `declined` / `asked` / `stalled` / `stopped`) that the retry, the settle flip, the
  upsell, `runProvenApp` and the release gate all read is the real fix; it is an **OPEN root cause**
  in `PROGRESS.md`, deliberately not guessed at here. **The next autopsy that finds a third reader of
  this question should build it.** Four more open items are recorded with it; **two were closed the
  same day** and are recorded here because each is a rule in its own right:
  ✅ **`WRITE_TIME_TYPECHECK` now sits AFTER the retry block.** It was above it, so on any retried
  build the line described the ABANDONED attempt — the fourth time that one sentence has been wrong,
  from a third distinct cause. The trace that unblocked it: there is exactly ONE build
  `ToolDispatcher`, it rides in `baseRunnerOpts`, and the retry runner spreads that object without
  overriding it, so the counters are **cumulative across both attempts**.
  ✅ **THE QUESTION WAS NEVER SEEN, AND THE DOUBT WAS THEN THROWN AWAY — two defects, either fatal
  alone** (`IntentClassifier.ts`). A comma is deliberately NOT a `CLAUSE_BOUNDARY` (splitting on
  commas would cut ordinary build orders in half), so that whole run-on sentence was ONE clause,
  `AUX_ASKS_US` was `^`-anchored to it, and the "can you" in the middle was invisible —
  **the THIRD time this exact anchor has cost a build**, after the Hindi particle (2026-09-16) and
  the English WH-openers (2026-09-17). It is unanchored now, and subsumes the opener test. Separately,
  the `long-message` and `code-or-url` branches returned HIGH **unconditionally**, discarding the
  `doubt` computed three lines above — so the message hard-locked to `new_build` on nothing but its
  character count, the intention reader never ran, and `userAskedForAnAppToBeBuilt` (which requires
  HIGH) then admitted five social-domain features into an app nobody ordered.
  ⚠️ **Not a reversal of "length is deliberately NOT a doubt signal"** — length still creates no
  doubt; it may merely no longer CANCEL doubt the grammar already raised. The INTENT is unchanged on
  every branch, so nothing regresses when the reader is down and a plain long build prompt keeps its
  HIGH. Reversion-proven in both halves in `tests/questionReadsEveryClause.test.ts`.
  🔴 **AND ONE OPEN ITEM GOT WORSE ON INSPECTION, traced from code rather than the report: BOTH
  deterministic post-build passes run AFTER the green latch and outside `runInPass`** — the
  starter-test scaffold and the U-2 production defaults (manifest, icon, robots.txt, service worker,
  the index.html meta patch). `currentPass()` is `null`, so Green Freeze refuses every write and each
  refusal is swallowed by its own `catch`. **On every build whose preview is verified in a real
  browser, the launch basics `AppKnowledgeBase.ts` promises "BY DEFAULT after each build" do not
  happen at all** — and the same report's "No tests at all" warning is that defect seen from the other
  end.
  ✅ **CLOSED the same day, with a THIRD TIER in the freeze rather than an allowlist entry.** Both
  passes name themselves now, and `CREATE_ONLY_PASSES` lets a pass write a path **only if that path
  was absent from the green snapshot** — the one question the latch answers exactly. `ALLOWED_PASSES`
  asserts *"this pass writes to a working app on purpose"*, which is true of a user's own repair and
  false of a deterministic sweep; create-only is **strictly narrower than the blanket "new files are
  always allowed" carve-out** the 2026-08-12 adversarial review removed, and both passes are refused
  every `.env` by construction. ⚠️ **The index.html patch stays refused**, so on a green app the
  manifest and service worker land un-linked and inert — and the narration now says what LANDED
  instead of announcing them regardless. Reversion-proven three ways in
  `tests/theLaunchBasicsNeverHappened.test.ts`.
  🔁 **SUPERSEDED IN PART THE SAME DAY BY #3313 (admin chose it: *"user ko working app jaldi mile, aur
  app acche se acchi bane"*): both passes, plus the E2E net and the ADR note, now run BEFORE the render
  rescue — before any latch — so the index.html patch lands too and the whole set is VERIFIED by the
  browser check and `npm run build`, not merely created.** `CREATE_ONLY_PASSES` stays as the net for a
  latch that already exists (a resumed, already-green session); the passes keep their names for it.
  ⚠️ Moving them exposed that the generated `sw.js` was cache-first under a fixed name — a republished
  app never reached a returning visitor — which the "un-linked and inert" state above had been hiding.
  It is network-first now (`appDefaults.ts`); **do not move these passes back behind the latch**.
  ✅ **AND THE DEV SERVER'S LAST WORDS WERE READ ON THE WRONG BRANCH.** This autopsy first recorded
  that *"nothing captures the dev server's own last output"* — **wrong, and re-grepping caught it**:
  `devServerDeathEvidence.ts` has read the log tail since 2026-09-23. It was wired one line before
  each RESTART, and the `PREVIEW_SERVER_DOWN` GIVE-UP recorded the restart COUNT and no cause — so
  the platform could explain a death it recovered from and not the one it gave up on, which is the
  only one a human has to act on. Both give-ups read it now, the 8 s bound moved INTO the module so
  the four sites cannot drift, and ONE sentence serves all four. ⚠️ The log at give-up is not stale:
  it holds the LAST restart's output, the death that ended the loop. ⚠️ **WHY the server dies is
  still OPEN** — it is now *recordable*, not known, and the next report carrying that code is the
  first that can answer it.

- **🪞 TWO ACCESSIBILITY ANALYZERS, AND THE LOCK WAS POINTED AT THE WRONG ONE (autopsy `8a92e5ed`,
  2026-09-20; no flag, on by construction).** The day after `c847b523` root-caused our own templates
  failing our own gate, the very next report told a free user their working password generator had
  **"3 form field(s) with no label"**. All three are labelled — each checkbox sits inside its own
  wrapping `<label>` — and the app is NavBharatAI's OWN golden scaffold.
  🔴 **`tests/ourOwnTemplatesPassOurOwnGate.test.ts` was green throughout, and its docblock promises
  "a new template with an unlabelled control can no longer reach `main`".** It asked
  `AccessibilityAnalysis.ts`. **The `ACCESSIBILITY` line in a build report is written by
  `AppMakerLab/intelligence/A11yLinter.ts`**, through `buildQualityLint.ts`. The instance was fixed,
  the sibling was never hunted, and the lock was aimed at the analyzer that does not judge builds.
  🔑 **The class, in that module's own words: *"regex on the HTML string, not a parser"* — it was
  written for HTML and `lintBuiltApp` feeds it JSX.** In JSX the first `>` of
  `onChange={(e) => …}` belongs to the arrow, so `<input\b[^>]*>` ends there and **every attribute
  after the first handler is invisible**, `aria-label` included. One reader now: `AgentV3/jsxTags.ts`
  (`tagsOnLine` moved verbatim from the analyzer whose suite proves it, plus `scanMarkup`, which
  carries the two facts a regex cannot — an enclosing `<label>`, and whether the tag is an HTML
  element at all, since `<Select label="Category" />` has a real working label we cannot see).
  ✅ **AND THE SIBLING FOUND ELEVEN REAL ONES THE FIRST ANALYZER CANNOT SEE.** `scanAccessibility`
  reads a tag only when it **closes on its own line**, and a generated React input is routinely
  written over six. `<label>Email</label>` beside an `<input>` with no `htmlFor`/`id` is not a label
  to a screen reader, and our login template shipped three; a `placeholder` is not one either. All
  fixed in the scaffold source, and the gate now asks BOTH linters with a canary each.
  ⚠️ **SAME REPORT, SECOND FALSE FINDING, AND IT BECAME THE BUILD'S `rootCause`:** `FEATURE_COVERAGE`
  said *"Mark complete / toggle"* had no control and *"Login / authentication"* was present — in an
  app asked for neither. `toggle uppercase, numbers and symbols` tripped a bare `toggle`, and
  `password` was an auth keyword. **The false POSITIVE is what certified the false NEGATIVE**: the
  corroboration guard only lets a "missing" through once some OTHER probe is present. `password` is
  gone from the auth list (nothing is lost — an app that only says "password" HAS the field, so it
  probed present and reported nothing either way), and the completion keywords now need the company
  that fixes their sense. Same lesson `featureRequest.ts` already encodes for negation ("no
  settings") and deferral ("login in stage 3"), in a third tense.
  🔒 Test-locked and **reversion-proven four ways** in `tests/theAnalyzerLiedAboutOurOwnTemplate.test.ts`,
  including a SOURCE-level guard — `tsc` and `vitest` cannot see that a regex reads the wrong
  dialect, which is exactly how this shipped and passed review.
  **What to watch:** `ACCESSIBILITY` scores on real builds. A sudden crop of genuine `input-label`
  findings on multi-line inputs is the check working for the first time, not a regression.

- **🧩 "FIX BUGS", AND THE BUG WAS OURS — the boot guard ran on one lane of two (autopsy `53d43c18`,
  2026-09-21; no flag beyond the existing `AGENTV3_HTML_ENTRY_GUARD`).** A finished memory-match game
  (rendered, typechecked, production build clean, `GREEN_GUARD_SAVE`) came back an hour later with
  `Cannot read properties of null (reading 'useState')`. The user typed **two words** — *"Fix bugs"* —
  and a **21-minute** build was spent discovering that `index.html` had *"no `<div id="root">` and no
  `<script>`"*, `npm run build` transforming **1 module**. They were billed **₹113** for the engine to
  repair an entry file the engine owns.
  🔴 **`ensureHtmlEntryScript` exists for exactly that, is pure and unit-tested, and had ONE call site:
  `SimpleBuilder.ts` — the FAST LANE.** The architect loop, where most builds run and where all three
  builds in that report ran, had **no boot check at all**. This repo's own headline class (autopsy
  `a38c6fef`): the instance fixed in one of the two lanes that carry it, the sibling never hunted. It is
  now wired beside `ensureViteConfig` in `routes/agentv3.ts` — the existing precedent for a
  deterministic post-build repair — and reports `HTML_ENTRY_REPAIRED`, registered in
  `PROCESS_ONLY_CODES` because a file OUR pass repaired is never a finding against the user's app.
  🔴 **SECOND DEFECT, SAME BLOCK, PROVEN FROM THAT REPORT'S OWN NUMBERS: we were saving our preview
  bridge into the user's source.** The app-defaults pass read `index.html` with a bare
  `actuator.readFile` — the SANDBOX copy, which carries the console mirror — patched its meta tags in
  and wrote it back to the sandbox AND the durable store. Measured: a 299-byte entry file is **18,546
  bytes** bridged and was persisted at **19,224** — which is exactly the `dist/index.html 18.46 kB`
  that report carries, i.e. **18 KB of NavBharatAI debug code shipped inside the user's published app**.
  `withoutPreviewBridge`'s own docblock already named this class (*"they read the sandbox directly …
  apply it wherever sandbox content enters the analysis corpus"*); this call site is worse than an
  analyser because it WRITES. ⚠️ Stripping here cannot turn the live console off — `E2BActuator`
  re-injects the bridge every time the dev server starts.
  ⚠️ **WHAT REMOVED THE MOUNT NODE IS *NOT* SOLVED, and the defaults pass is NOT the culprit** —
  measured, it preserves both the root div and the entry script. That stays an OPEN root cause in
  `PROGRESS.md`; the boot guard means the next occurrence is repaired rather than sold back to the user.
  ⚠️ **THIRD FALSE FINDING OF ONE CLASS IN TWO DAYS** (`FeaturePresence.ts`): *"**Add** pagination or
  infinite scroll to the main list"* tripped the `add` probe, and *"Add / create has no visible control"*
  became that build's reported **root cause**. `add` is the commonest word an English instruction starts
  with. **The object decides** — `add a task` names a thing the USER adds, `add pagination` / `add dark
  mode` / `add tests` / the Hinglish `add karo` name work for the BUILDER — so `BUILDER_INSTRUCTION_OBJECT`
  suppresses the probe per OCCURRENCE (`add a button to add a task` still counts, via the second one).
  Test-locked and reversion-proven in `tests/theBootGuardRanOnOneLaneOfTwo.test.ts` and
  `tests/theAnalyzerLiedAboutOurOwnTemplate.test.ts`.
  ✅ **AND ONE CORRECTION TO THE DAY BEFORE:** yesterday's autopsy recorded `PREVIEW_SNAPSHOT_STALE` as
  if it were universal. It is not — the third build in this report reports `PREVIEW_SNAPSHOT_CURRENT`.
  It goes stale exactly when a post-build pass writes AFTER the copy is taken, which is what
  `POST_GREEN_WRITES` measures.

- **🎧 `AGENTV3_BROWSE_CONSOLE` — THE CONSOLE LISTENER LIVED ON ONE BROWSER LANE OF THREE (autopsy
  2026-09-21). ⚠️ NOT set, and the code default is ON**; `off` is the instant, no-deploy revert and
  emits the pre-change script byte for byte. Read by `browseConsoleCaptureEnabled()` in `E2BActuator`.
  🔴 **WHY: `RUNTIME_UNCHECKED` was not a fault, it was the STRUCTURAL OUTCOME of an ordinary build.**
  Two admin reports, five builds, that code on every one — beside `IN_BUILD_GREEN`, `GREEN_GUARD_SAVE`
  and a preview opened in a real browser and seen rendering. `CONSOLE_LOG` is the only thing
  `getConsoleErrors` reads, and three lanes could have filled it. All three were shut:
  • **the CDP daemon** — the ONLY writer, and it starts solely when the MODEL calls `browser_action`.
  An ordinary build never does. • **the page checks** (`runtimeRecordFromPageChecks`, the documented
  *"second source of runtime truth"*, 2026-08-19) — needs `extractPageRoutes` to find a non-`/` route;
  **MEASURED: 0 of this repo's 40 golden scaffolds yield one — and not one of them uses a router at
  all**, so for an app built from our own templates that lane has never once answered.
  ⚠️ **That number is held by CI, not by this paragraph**, and it is the SECOND measurement of it: the
  first read a `files` key `GoldenScaffold` does not have, so every scaffold reached the function as
  `{}` and the probe could not have returned anything but 0. The conclusion survived; the derivation
  proved nothing. It now reads `appTsx`, asserts the sources are really non-empty, and carries a
  control case proving `extractPageRoutes` does find routes when they exist. • **`browseUrl`** — the navigation the PLATFORM makes on
  essentially every build (the render proof, the verify loop, GreenGuard, `verifyAfterFix`): it launched
  a real browser, waited for paint, read the DOM, and **attached no listener at all**.
  🔑 **The fix is the third lane, because it is already paid for** — the browser launches regardless, so
  the four listeners cost nothing. They are now ONE definition (`CONSOLE_RECORDER_JS` + `attachConsoleJs`)
  interpolated into both the daemon and `browsePageScript`, never copied: a second copy is the
  drifted-copy class this repo has paid for four times (`safeRelPath` ×4, `tagsOnLine` ×2, the HTML boot
  guard ×2, `PLAYWRIGHT_BROWSERS_PATH` ×2).
  🔒 **THE SESSION MARKER IS GATED ON `painted`, AND THAT GATE IS A BUG THIS FIX WOULD OTHERWISE HAVE
  CREATED.** `getConsoleErrors` reports `captured:true` when the log FILE exists, and `provenFromTimeline`
  reads the resulting `RUNTIME_VERIFIED` as *"the app ran in a real browser"*. A browser that loaded a
  dead preview has a perfectly clean console — so an unconditional marker would let a **404 earn a render
  proof**. Painted ⇒ the app's own mount root had content. An ERROR is recorded either way, because a
  crash that prevents paint is exactly what must be reported.
  ⚠️ **IT IS NOT A REPORTING CHANGE — IT SPENDS MONEY, and that is the point.** With the console really
  captured, a build carrying a REAL runtime error now reaches the auto-fix loop (`AGENTV3_AUTOFIX`, on)
  and spends a repair pass it previously could not; on Weak, NavBharatAI pays. Bounded by
  `AGENTV3_AUTOFIX_ATTEMPTS` (default 1) and wrapped in `verifyAfterFix`, so a repair that breaks a green
  app is reverted. ✅ **It also wakes a guard that has been inert since it shipped**: `reRenderOk`'s
  post-repair `afterCount` was `null` on almost every build (nothing to read), so `judgeRuntimeRepair`
  could never see a repair that fixed one error and introduced two. Now it can.
  ⚠️ **The script writes to a FILE and never to stdout** — `browseUrl` parses its stdout for the paint
  marker and the page HTML, so one stray print would corrupt the DOM every caller reads (the preview
  verdict, the feature probe, Green Freeze). And it APPENDS: two lanes now share one log.
  🔒 **The generated script is PARSED by its test** (`node --check`, the real thing). This function has
  shipped broken twice — a shell-quoting bug that handed `node` a fragment, and a path bug that hid
  Playwright — and **neither failed loudly**, because the caller falls back to curl on any error. A
  generated script is code; code nothing ever parses is code presumed to work.
  🧬 **THE 50/50 HALF — a BROWSER-LANE CENSUS.** Six scripts in that one file launch or attach to a
  browser, written eighteen months apart, and nothing knew how many there were. The census names each
  lane, whether it records, and why — and fails when a seventh appears. It deliberately does NOT say
  "every lane must record": the journey check drives hostile input and the page check already collects
  its own errors, so forcing them would put pre-repair errors inside the verdict's 3-minute window and
  report a fixed bug as surviving. Test-locked and **reversion-proven four ways** in
  `tests/theConsoleListenerLivedOnOneLaneOfThree.test.ts` (19 cases).
  **What to watch on the first real builds:** `RUNTIME_VERIFIED` and `RUNTIME_ERRORS_REMAIN` appearing
  **at all**. A crop of `RUNTIME_ERRORS_REMAIN` is not a regression — it is the check working for the
  first time, and each one is a real error that was reaching users unseen. Also watch the repair-pass
  count on Weak; if it rises more than the errors justify, `AGENTV3_BROWSE_CONSOLE=off` reverts it.
  ✅ **AND THE DOOR IT OPENED IS CLOSED IN THE SAME CHANGE.** `auditSummaryClaims` could only catch
  *"you said clean and nobody looked"*; the worse sentence — **we looked, we saw errors, and the summary
  said clean** — had no rule at all, because an ordinary build captured nothing so it was unreachable.
  Making the capture work is what makes it reachable, so `console-clean-but-errors` ships beside it
  rather than waiting for a report to prove it. It reads the FINAL count (after the repair budget), an
  omitted count accuses nobody, and the two rules are `else if` — one claim can never produce two
  contradictions in the user's correction.
  🔴 **STILL OPEN (rule 6): lane B cannot see a state-routed SPA.** `extractPageRoutes` finds only
  `<Route path=…>` and Next `app/x/page.tsx`, so every single-screen app — and our multi-screen
  scaffolds, none of which uses a router — yields nothing. Deriving "pages" for those is a separate problem and
  is NOT guessed at here; lane C now covers them, which is why this is an upgrade rather than a breakage.

- **🧭 IN THE ADMIN CONSOLE THE BOTTOM BAR *IS* THE TAB STRIP (admin 2026-09-20; no flag, no cost).**
  *"jab admin panel open hota hai, to footer me yeh home|ai|preview|studio|more etc jo dikh rahe hai —
  isko badalna hai!! is footer me MONITOR, USERS, ai engine, revenue … jo abhi header me hai, unko
  rakho"*, and the same day: *"ham desktop me aise hi rahne do!"* On a phone the console had been
  spending its ONE always-reachable row on five buttons that lead OUT of the console, while the nine
  tabs that ARE the console sat in a scrolling strip up in the header.
  📌 **It is the FOURTH branch of a pattern already there, not a new one.** `App.tsx` keeps ONE `<nav>`
  and already swaps its contents per surface (Pro chat / the Mode surfaces / the default five); the
  admin panel was falling into the third only because `isModeSurface` does not name it. The upward
  channel existed too — `v3FooterApi` — so `src/components/admin/adminFooterApi.ts` is that same
  channel for the console, and `select` **is** `setActiveTab`, never a second copy of the state.
  🔒 **THE FOOTER NAMES NO TAB.** It renders `adminFooterApi.items` — the console's own `TABS` with its
  own live badges — so a tab added to `TABS` appears in the footer by construction. A hardcoded list in
  `App.tsx` would drift the first time a page was added and **nothing would fail**: the strip would
  simply be missing it. `theAdminFooterIsTheTabStrip.test.ts` asserts those tab NAMES are absent from
  `App.tsx`.
  🔴 **THE ONE LINE THAT MADE IT POSSIBLE, AND THE ONE A LATER SESSION WILL WANT TO "TIDY":** that bar
  carries a deliberate `touchAction: 'none'` (admin 2026-09-14 — a drag upward on it moved the whole
  app and showed white space under it on iOS). **`none` forbids EVERY pan, horizontal included**, so a
  swipable footer with `none` on it is a footer that cannot be swiped and the tabs past the screen edge
  are unreachable by the exact gesture that was asked for. It is `adminStrip ? 'pan-x' : 'none'` —
  horizontal only, so the 2026-09-14 bug stays closed everywhere. **Reversion-proven**; tightening it
  back to `none` fails CI rather than silently killing the swipe.
  ⚠️ **Desktop is untouched BY CONSTRUCTION, not by a second rule** — the bar is mobile-only, so
  `adminMobileFooterActive` returns false there and the header strip stays. The strip stands down with
  `hidden lg:flex` (AgentV3Panel's own idiom), so a wide screen inside a mobile session still has tabs
  rather than none. Publishing `null` on unmount is what returns the bar to its ordinary items on
  logout. The open tab is scrolled back into view on a tab CHANGE only, never on every render, so it
  cannot fight a swipe in progress. New code, so it uses the theme tokens (`text-accent-text` /
  `text-muted`) rather than copying the older branches' `text-indigo-400` / `#484f58` — those are
  invisible or weak on Light, and the ratchet counts them.

- **📜 THE HISTORY LIST IS A LIST, AND THE GROUP HEADING IS WHAT MAKES THAT POSSIBLE (admin 2026-09-20;
  no flag, no cost).** *"isko popup ka ui badalna hai!! claude nad gpt jaisa karo!! open chat button
  kyu banaya hai. hatao isko!!"* Each row had been a `p-6` card carrying a title, a `CUI:` id, a mode
  chip, an App/Chat badge, a full timestamp, the agent name AND a big **Open Chat** button — seven
  pieces of chrome to reach one conversation, three or four rows to a phone screen out of 235.
  🔑 **The change that turns cards back into a list is structural, not aesthetic: the HEADING carries
  the time for every row beneath it**, so no row spends a line on its own date. That is what Claude and
  ChatGPT actually do. `src/components/history/historyGroups.ts` is pure (`now` passed in), headings
  `Ongoing / Today / Yesterday / Previous 7 days / Previous 30 days / Older`.
  🔒 **IT NEVER RE-SORTS.** `sortMergedRows` puts LIVE professional conversations on top and the
  Firestore query is newest-first, so it buckets in the order it was handed. A sort here would overrule
  that and **nothing would fail** — the live chat would just stop being first.
  ⚠️ **An unknown date is `Older`, never `Today`** — a row with no timestamp is not new, it is a row
  whose date we do not know, and the top of the list is a claim nothing supports.
  ⚠️ **The row IS the button now**, which is the only honest way to delete that control; the `CUI` chip
  went but the id is **still searchable**, so nothing became unfindable. **DELETE STAYS** behind the
  quiet kebab with its confirmation — Claude and ChatGPT both keep it, and dropping a real capability to
  look like them would be a regression wearing a redesign.
  📌 **`HistoryView` has exactly two callers — the History TAB and this POPUP — so the redesign lands
  on both, deliberately.** Two row designs for one list would drift the moment either changed, which is
  why `HistoryPopup` already delegates rather than reimplements. `embedded` is what stops the sheet
  titling itself twice ("Chat history" over "SESSION HISTORY"); the tab keeps its heading because it is
  a whole screen. Both files also left the COLOUR baseline entirely (the sheet was `bg-[#0d1117]` — a
  black panel over a white app on Light). Test-locked in `tests/theHistoryListLooksLikeAList.test.ts`.

**New report codes you will now see (2026-08-12) — what they mean:**
- `RELEASE_GATE` — GREEN / YELLOW / RED / **UNKNOWN**. UNKNOWN is the important one: nothing failed and
  nothing was PROVEN, because every runtime check needs a live preview and they all skip together. GREEN
  cannot be earned by clean code alone; RED needs evidence the APP does not work (a failing test suite or
  typecheck is a loud caveat, not a "not shippable"). It is a SUMMARY of other findings, so it can never
  be a build's root cause.
- `CLAIM_UNSUPPORTED` — the build's own summary claimed something the platform's measurements contradict
  (e.g. "no console errors" when the console could not be captured, or a screen description whose labels
  appear nowhere in the app). The user-facing reply carries an honest correction.
- `PREVIEW_SERVER_RESTARTED` — the dev server had stopped and was restarted deterministically. **No code
  was changed and no model call was made** — this used to be a multi-minute LLM repair pass that always
  concluded "no code changes were needed".
- `PREVIEW_UNVERIFIED` — the preview snapshot could not be trusted (taken before the app painted, or
  fetched without running its JavaScript). NOT evidence the app is broken, and no repair is spent on it.
- `TIME_TO_FIRST_CALL` — how long setup took before the build's first model call. A warning past 60s,
  because the user waits through every second of it and nothing used to record it.
- **`AGENTV3_LINT_GATE`** — NOW SET to `on` (admin, 2026-07-11) → moved up into the configured "AgentV3
  controls" list above. It is live: a finished build fails on real ESLint **errors** (warnings/formatting
  never block). Watch the first few real builds; if a genuinely-working app gets blocked, set it `off`.

## ⛔ CLOSED: the inline button-description sweep (admin, 2026-09-12). DO NOT REOPEN.

The admin re-checked the app and closed it: *"is kaam ko band kar do, agar bhi koi agent is par kaam na
kare."* The two descriptions they had marked were already removed (#2828); the rest stay. **This entry
exists only because those strings are still in the code, so the pattern is re-discoverable from any
screen — if a future session thinks ONE description is wrong, it raises that one. It does not restart
the sweep.**

## Play Store release — build a signed `.aab` on every roadmap/checkpoint completion (mandatory, admin-mandated 2026-07-10)

**NavBharatAI is now LIVE on the Google Play Store** (Android app package `com.navbharat.ai`,
a Capacitor shell). ⚠️ **BUNDLED MODE, not a remote wrapper** (corrected 2026-08-11 — this line
previously said "loads the hosted web app", which has been WRONG since the 2026-07-10 switch and would
mislead any session into thinking frontend fixes reach app users automatically). `capacitor.config.ts`
sets `webDir: 'dist'` with **no `server.url`**, so the app boots from its own bundled assets.
**What this means in practice:** a SERVER/backend change reaches installed app users immediately (API
calls are rewritten to the production origin by `src/lib/apiBase.ts`), but a FRONTEND change does NOT —
it is baked into `dist/` and needs a fresh signed `.aab`/`.ipa`. Locked by
`tests/nativeShellInvariants.test.ts`.

**⚠️ CORRECTION 2026-09-07 (admin, verbatim: "jab mai bolu tab ipa,aab banana hai") — this SUPERSEDES
the "on every milestone/phase" trigger that used to stand here.** A store build is now made **ONLY**
when the admin explicitly asks — never automatically on a roadmap phase completing, a checkpoint
shipping, or any other milestone. Do NOT build one on your own initiative for any reason; the
admin's word is the ONLY trigger.

**The trigger, and only the trigger:**
- ✅ **STANDING INSTRUCTION (admin 2026-08-24, verbatim: "jab jab mai bolu to aab aur ipa bana
  dena"): whenever the admin asks, build BOTH — the Android `.aab` AND the iOS `.ipa`, together.**
  Not one or the other. Both workflows are dispatched (`android-aab.yml` and `ios-ipa.yml`, ref
  `main`), both are polled to green in the background, and both run URLs are reported back.
  ⚠️ Build from **`main`**, after the work is merged — an `.aab` cut from a feature branch is not
  the app anyone is shipping. And per the BUNDLED-MODE note above, a FRONTEND change reaches
  installed users ONLY through a fresh bundle, which is precisely why this instruction exists.
- ❌ A roadmap phase completing, a checkpoint shipping, or any other milestone is **NOT** a trigger
  on its own anymore — only the admin explicitly asking is. Each `.aab` run consumes CI and burns a
  Play `versionCode` (it auto-increments per run), which is exactly the cost this correction avoids
  paying on every merge.

**How to build it (the pipeline is real and already working — last green run: #4 on `main`):**
- The signed bundle is produced by **`.github/workflows/android-aab.yml`** (`workflow_dispatch`).
  It runs `npm ci` → `npm run build` → `npx cap sync android` → `./gradlew bundleRelease`, signs
  with the release keystore from repo secrets, auto-increments `versionCode` (= run number), and
  uploads the **`navbharatai-release-aab`** artifact (`app-release.aab`).
- **Trigger it after the checkpoint merges to `main`:** GitHub → Actions → "Build Android App
  Bundle (.aab, signed)" → Run workflow (branch `main`); or from a Claude session via the GitHub
  MCP `actions_run_trigger` on `android-aab.yml`, ref `main`. Then poll the run to green (same
  discipline as CI) and report the run URL to the admin.

**Honest boundaries (rule 6 — what Claude CAN and CANNOT do here):**
- Claude CAN trigger the workflow and confirm it goes green.
- 🟢 **ORGANIZATION DEVELOPER ACCOUNT (D-U-N-S) — STARTED. The admin asked for it on 2026-09-07
  ("DUNS account banwao"), which lifts the earlier deferral** (admin 2026-08-26: "yeh baad me karenge jab
  user badhenge"). The old ⛔ "do NOT start it" line stood here until that moment; it is replaced rather
  than deleted so the change of instruction is legible, and so no session stalls on an order that has
  been withdrawn. The full, verified conversion guide is `MOBILE_PUBLISHING.md` §10 — including the
  finding that the EXISTING account converts in place (no new account, no app transfer), the four
  easy-to-miss traps, and the fact that this is the ONLY thing that brings Doctor AI, Pharmacist, First
  Aid and Maternity back to the Play app.
  **What a session may do, and where the line is.** Almost all of this is admin work a session cannot
  touch: registering a company, applying to Dun & Bradstreet, and every click in Play Console. A session
  CAN do exactly one piece end to end — Track A's **HTML-file website verification**, because `public/`
  is copied into `dist/` and both serving paths serve `dist/`, so a file committed there is live at
  `https://navbharatai.com/<name>` on the next merge. Google issues that filename only AFTER the admin
  presses *Send verification request*, so a session waits for the admin to hand it over; it cannot be
  prepared in advance.
  🔒 **THE ORDER IS A COMPLIANCE REQUIREMENT, NOT A PREFERENCE.** `MEDICAL_PROFESSIONAL_IDS` in
  `src/lib/playCompliance.ts` may be touched ONLY after the org account is live AND the Health-apps
  declaration is filed. Reversing that order is a deceptive-behaviour violation that can ban the whole
  developer account — a far worse outcome than the rejected update it would be trying to fix.
  ⚠️ **AND IT IS A ONE-WAY DOOR:** Google does not convert an organization account back to an individual
  one. Going back would mean a brand-new account plus an app transfer.
  §10.6 records the separate HPR/ABDM doctor-verification plan, which **remains deferred** — it is a
  different thing that does NOT unlock the mobile app, and it must not be started without its own ask.
- Claude CANNOT set/rotate the signing keystore secrets (`ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) — that is a one-time
  admin setup (documented in the workflow header); the keystore is the app's permanent identity
  and must live only with the admin. If a secret is missing the workflow FAILS EARLY with an
  honest message — **never** hand back or fake an unsigned bundle (Play would reject it anyway).
- Claude CANNOT download the artifact or upload to Play Console, and CANNOT set the service-account
  secret. What happens after a green run depends on ONE repo secret:
  ✅ **AUTO-UPLOAD ALREADY EXISTS — do not build it, and do not tell the admin it is missing.**
  `android-aab.yml` has carried a **`upload_to_play`** workflow input and a real
  `r0adkll/upload-google-play` step since before 2026-09-14. Ticked, the freshly-signed bundle goes
  straight to Play's **INTERNAL testing track** (`track: internal`, `status: completed`); the admin
  still promotes it to production themselves, so the API can never publish to production on its own.
  Unticked (the default) the run just produces the downloadable artifact — byte-identical to before.
  🔴 **THE ONLY THING MISSING IS `PLAY_SERVICE_ACCOUNT_JSON`** (a GitHub REPO secret — the whole
  service-account JSON key). Without it the admin downloads `app-release.aab` and uploads by hand.
  Ticking the box WITHOUT the secret fails the run EARLY with a message naming the secret — it can
  never silently skip the upload and report success.
  ⚠️ It is NOT the same as `GOOGLE_PLAY_SA_JSON`, which is a CLOUD RUN env for verifying in-app
  purchases. Same JSON file may serve both if the account holds both permission sets, but they are
  two different places and each must be set separately.
  ⚠️ **CORRECTED 2026-09-14 — this bullet said automating the upload "is a future infra item" and
  that was FALSE for an unknown length of time**, so a session reading it would propose building a
  feature that already shipped, or tell the admin to upload by hand when one secret would have done
  it. **And it named the action as `r0adz0/upload-google-play` — a slug that does not exist.** The
  workflow's own comment records that exact typo as a real incident: GitHub resolves every `uses:`
  up front regardless of the `if:` guard, so the bad slug broke even artifact-only runs. A doc that
  propagates a typo already paid for is worse than a doc that says nothing.
- The iOS counterpart is `.github/workflows/ios-ipa.yml` (App Store `.ipa` → TestFlight); the same
  discipline applies. Trigger it via the GitHub MCP `actions_run_trigger` on `ios-ipa.yml`, ref `main`,
  with input `upload: true` to ship straight to TestFlight (leave it off for a signing dry-run artifact).

### iOS release — durable facts (admin-verified 2026-07-21, so no session re-litigates them)
- **The persistent distribution cert IS set up and ACTIVE.** The admin has configured the repo secrets
  `IOS_DIST_CERT_P12_BASE64` + `IOS_DIST_CERT_PASSWORD` (verified 2026-07-21). So the Fastfile takes the
  `import_certificate` path (reuses ONE cert every run) — NOT `cert()` per run. **Apple's 2-distribution-
  cert cap is permanently solved; do NOT tell the admin to "activate the p12" or revoke certs before a
  build — it's already done.** (Confirm from a build log: the fastlane summary shows `import_certificate`,
  not `cert`.) The cert inside that p12 must never be revoked on the Apple portal or the p12 breaks.
- **Build number auto-increments** = `CFBundleVersion` stamped with `GITHUB_RUN_NUMBER` (Apple rejects a
  re-used build number). **Export compliance** is pre-answered (`ITSAppUsesNonExemptEncryption=false` in
  Info.plist) so no per-upload popup. Both are in the workflow — don't re-add them.
- **"Uploaded" ≠ "available in TestFlight".** The upload now WAITS for Apple to finish processing
  (`skip_waiting_for_build_processing: false`), so a green run means the build genuinely reached
  TestFlight (a processing failure now fails loudly instead of a silent green). **INTERNAL testers**
  (App Store Connect users, incl. the account owner) get every processed build automatically — no group
  or review. **EXTERNAL testers** need the build assigned to a group + Beta App Review: set the repo
  secret `IOS_TESTFLIGHT_GROUPS` (comma-separated external group names) and the Fastfile auto-submits +
  notifies them. The `changelog` workflow input sets the "What to Test" note (defaults to the build #).
  Root cause of a past "build succeeded but no update showed" report: the old `skip_waiting:true`
  reported success before processing, hiding failures.
- Claude CANNOT see App Store Connect. If a build uploaded green but a tester sees no update, the real
  diagnostic is the build's status in App Store Connect → TestFlight (Processing / Ready to Test /
  Missing Compliance / errored) — that check is the admin's (rule 6).

## The autonomous phase cycle (mandatory — how every roadmap phase ships)

**Claude owns the ENTIRE ship cycle for each phase/batch, end to end — including the
merge.** Do NOT stop after opening a PR and hand it to the admin to merge. Drive the
whole loop yourself, autonomously, and immediately start the next phase. This is the
default working mode for all roadmap/march work and it repeats forever until the admin
says stop (or a phase is genuinely blocked — see safeguard #3).

**100% AUTOMATICITY (admin-mandated, 2026-07-06 — the default for completing the roadmap):**
The goal is to complete the ENTIRE roadmap with zero hand-holding. One phase/step done →
push it → its CI runs GREEN **in the background** (poll it with a background task, never
sit idle blocking on it) → the moment it merges, the NEXT phase/step is already underway →
repeat, forever, until the roadmap is done or the admin says stop. You never wait for the
admin to "kick off" the next phase, never park a finished phase waiting for a nod, and never
let CI polling stall forward progress — while one phase's CI is going green you may already
be building the next. The cycle is a continuous conveyor, not a request-response loop.

**🔵 CI RUNS IN THE BACKGROUND — NEVER BLOCK ON IT, ALWAYS ADVANCE (admin-mandated, 2026-07-13; reaffirmed 2026-07-14):**
**THE ONE-LINE RULE (admin verbatim intent): CI ALWAYS runs in the background — the agent goes and
completes the NEXT task, with one eye on CI in the background.** Push → start the next task immediately;
a background timer/notification brings you back to merge each PR the moment its check is green. You are
never idle-waiting on a progress bar — your attention is on the next unit of work, CI just pings you when
it's ready.
**THE FULL LOOP (admin verbatim, 2026-07-19): CI background me chalti hai — green ka wait NAHI karna hai.
CI run hote hi turant naya (next) kaam shuru karo, cycle me. Aur jab CI GREEN ho jaaye, tab ek checkpoint
par ruk kar us PR ko merge karo, phir wapas apne purane checkpoint (jahaan next-kaam paused tha) se kaam
continue karo.** In plain terms: the green-notification is a brief, cheap interrupt — you pause the task
in flight ONLY long enough to land that one merge at its checkpoint, then immediately resume the paused
task from exactly where you left it. You never stop the conveyor to watch a run go green, and you never
abandon the in-flight task after merging — merge, then straight back to the paused checkpoint.
When the work is large or spans many PRs, MANY CI runs will queue up — that is expected and fine.
Do NOT sit and watch any single CI run. The rule, every time you push:
- **Push → then IMMEDIATELY move to the next unit of work** (investigate, design, or start the next
  fix/phase). Never idle-wait for a check to turn green.
- **Poll CI with a BACKGROUND timer/task, never a foreground `sleep`, never idle waiting.** A background
  wait fires a notification when it's time to re-check; between fires you are building the next thing.
- **Several PRs may be "in CI" at once.** That is normal for big work — the conveyor never stalls on a
  single green check. When one goes green, merge it and keep moving; the others keep baking meanwhile.
- **The ONLY hard wait is the merge gate itself:** CI MUST be green BEFORE you merge (never merge red).
  But you "wait" for it by doing OTHER work + polling in the background — not by blocking. Watching a
  progress bar is wasted time; the whole point of background CI is that your attention is elsewhere.
- If a background CI check comes back RED, THEN it becomes the next unit of work: diagnose, fix, re-push
  (which re-arms its background CI), and go back to advancing the next thing.
This applies to the deep-test autopsy loop too: after pushing a root-cause fix, don't watch its CI —
start the next autopsy / next fix, and let the background timer bring you back to merge when it's green.

⚠️ Every "merge it" / "merge when green" instruction above is superseded by the 2026-09-13 correction
after the cycle below: the background timer still brings you back on green, but what it does on
arrival is now tell the admin and wait, not merge — see that correction for the exact rule.

**The cycle (repeat for every phase):**

1. **Complete the next phase** — real, fully-wired work (the two absolute rules apply:
   never break the app; real features only). No half-done work.
2. **Run the full verification gate** (safeguard #5, non-negotiable):
   `npx tsc --noEmit` (frontend) + `npx tsc -p tsconfig.server.json` (if server touched)
   + `npx vitest run` (read the real pass/fail line) + a boot/smoke check for server
   changes. Green or it does not leave your machine.
3. **Branch → commit → push** the work to the feature branch.
4. **Open a PR** to `main`.
5. **Wait for CI to go green** on that PR — actually wait, poll the checks; never merge
   while CI is pending or red.
6. **On green, MERGE it yourself** (CI green BEFORE merge is the hard gate — merging red
   breaks the live app for every user; merge = auto production deploy via Cloud Run).
7. **Immediately start the next phase** → go back to step 1. Same cycle, next phase.

**You do steps 4, 5, AND 6 yourself.** "Open a PR" is not the finish line — a green merge
is. The admin should not have to merge anything for the cycle to keep moving; you complete
each phase, you make the PR, you wait for green, you merge, you move on — over and over.

**Only stop the cycle when:** the admin explicitly says stop/pause, there is no next phase
left, or you hit real doubt/ambiguity/breakage risk (safeguard #3 — then ask the admin).
A transient CI failure is NOT a stop: diagnose, fix, re-push, wait for green, merge, continue.

🔴 **CORRECTION 2026-09-13 (admin-mandated, verbatim: "jab tak kaha na jaye, CI merge na ki
jaye") — THIS SUPERSEDES STEP 6 ABOVE, UNTIL THE ADMIN SAYS OTHERWISE.** After any edit, the
cycle still runs through branch → commit → push → open the PR → wait for CI to go green
(steps 1–5 are unchanged). But the merge itself is no longer Claude's to decide on green: once
CI is green, STOP at that PR, tell the admin it is open and green, and wait — do not merge
until the admin explicitly says to merge THAT PR. This applies to every PR, including small or
documentation-only ones, and holds until the admin lifts it. Nothing else about the gate
changes: CI still must be green before a merge ever happens, and a red or pending PR is still
worked to green in the background exactly as before — only the final "merge it" decision moved
from Claude to the admin.

🔴 **AND THE MERGE IS ONE SESSION'S JOB, NOT EVERY SESSION'S (admin-mandated 2026-09-13, verbatim:
"ab se PR merge sirf aap karoge! mai bolunga apko tab. woh session bas bana bana kar CI check laga
denge").** This is the second half of the correction above, and without it that one is unenforceable:
a rule that says "wait for the admin" still lets five sessions each decide, independently, that their
own PR is the one that may go.

**So there are now exactly two roles, and every session is in one of them.**

| | What it does | Where it STOPS |
|---|---|---|
| **The merging session** — the ONE the admin is talking to | merges, and only when the admin names the PR | — |
| **Every other session** | branch → commit → push → open the PR → drive CI to GREEN → say so | **at green. It does not merge, ever.** |

⚠️ **"I am the session the admin is talking to" is not something to assume — it is something the
admin SAYS.** If you have not been told in your own conversation that merging is yours, you are in
the second row, whatever your PR's state. A session that reasons "the admin clearly wants this
merged" has just made itself the merger, which is the exact thing this rule removes.

🔴 **WHY, AND IT IS NOT HOUSEKEEPING.** On the day this was written, **eight PRs merged into `main`
inside two hours from four different sessions**, and two of them (#2892, #2896) were merged by a
session that did not open them, while the session that did was still working on the branch. Nothing
broke — by luck and a green CI, not by design. With concurrent sessions the merge is the ONE step
where an independent decision compounds: a conflict-resolution another session has not seen, a
half-landed pair, a `main` that moves under three branches at once. One merger makes the order
deliberate instead of incidental.

⚠️ **NOTHING ELSE CHANGES, and a session in the second row must not go quiet.** CI must still be
green before any merge, a red or conflicted PR is still driven to green in the background, and a
merge conflict is still merged in and re-gated by whoever owns the branch. **Reaching green is the
deliverable — report it plainly** ("#NNNN is open and green") so the admin knows there is something
to name. Going idle on a green PR is not obedience to this rule; it is half the job.

### The 60-second auto-answer rule (admin-mandated, 2026-07-06 — keeps the cycle from stalling)

The cycle must NOT freeze waiting on the admin. So:

- **Prefer proceeding over asking.** Reserve real questions for the genuinely
  consequential fork — a choice that is destructive, irreversible, spends real money, or
  carries actual breakage risk. For everything else, do NOT ask: pick the option that best
  serves the app and proceed, stating the assumption in one line so the admin can correct it.
- **If you DO ask and the admin does not answer within ~60 seconds, auto-adopt the answer
  yourself** — the answer that makes NavBharatAI the **best, strongest, and better than every
  other app builder** (Lovable, Bolt, v0, Replit, Cursor, etc.). Announce the assumed answer
  ("no reply — proceeding with X because it makes the app strongest"), then keep moving. The
  admin can always course-correct after the fact; a merged, reversible improvement beats a
  stalled cycle.
- **The absolute rules still win, always.** Auto-answering never overrides the four absolute
  rules: never break the app, real features only (no fakes), be honest (no sycophancy),
  root-cause fixes only. If the forked choice itself carries genuine breakage or
  irreversibility, the auto-default is the **safe** ambitious path (the strongest option that
  cannot break the live app), not a reckless one — and if BOTH options are irreversibly risky,
  that is the rare real block where you still wait for the admin (safeguard #3 stands only for
  that narrow, genuinely-dangerous case; it no longer justifies stalling on ordinary choices).
- **Bias toward ambition.** When auto-answering, lean to the choice that makes the app more
  capable, more complete, and more competitive — not the timid minimum. "Best app builder in
  the world" is the tie-breaker.

This rule reconciles with safeguard #3: #3 still forces a STOP for true 0.01%-breakage doubt,
but ordinary ambiguity is now resolved by proceeding with the best-for-the-app default instead
of blocking. The conveyor keeps moving.

## Pull request naming convention (mandatory — same format for every account/session)

So every PR is traceable to its number AND its original branch commit — consistently, no matter
which account/session opened it — **every PR title MUST use this exact format:**

```
[#<PR-number>] <descriptive title> [<short-commit-sha>]
```

Example: `[#637] fix(agentv3): bound preview retry so it can't hang [a1b2c3d]`

How to produce it (the PR number does not exist until the PR is created — handle it in two steps):
1. After `git push`, capture the short SHA of the branch's HEAD commit (`git rev-parse --short HEAD`).
   Create the PR with the title already ending in `[<short-sha>]` (the SHA is known at creation).
2. Immediately after the PR is created you get its number — **edit the PR title** to prepend
   `[#<PR-number>] `. Final title then carries both the number and the original commit hash.

Notes:
- The `<descriptive title>` stays a normal Conventional-Commits-style summary (e.g. `fix(agentv3): …`).
- The `[<short-sha>]` points at the feature branch's original commit (visible in the PR's Commits tab).
  Squash-merge creates a NEW commit on `main` and GitHub auto-appends `(#<PR-number>)` to it — that is
  expected and separate; do not try to make the two SHAs match.
- This is a naming rule only; it never changes the branch → PR → CI green → merge flow above.

## Language standard (mandatory for all sessions)

All NavBharatAI source code, UI text, code comments, variable names, function
names, and configuration written by Claude sessions **MUST be in professional
English**. This applies to:
- All React/TypeScript component and hook files
- All server-side code (routes, services, actuators, agent loops, utilities)
- All UI labels, button text, error messages, placeholder text, and tooltips
  that are part of NavBharatAI itself
- All inline code comments and documentation strings

**Single exception:** AI-generated response text displayed to end-users inside
chat message bubbles (e.g. Doctor AI replies, Engineer AI agent progress
messages). That content is generated at runtime by AI models and is outside
the scope of this rule.

Do not rewrite existing Hindi/mixed-language strings as part of unrelated work —
that introduces unneeded diffs. All **new** code written in any session must
follow this standard from the start.

🔴 **THIS RULE WAS BROKEN SEVEN TIMES BEFORE IT WAS ENFORCED (admin 2026-09-14).** The admin caught
the voice-chat consent popup — a **price** — rendered entirely in Devanagari, and asked the question
that settles the whole matter: *"south india wale kaise padhenge isko??"* Devanagari is not a national
script, so "the user's language" had quietly become one region's language shown to a national
audience. Six separate modules had each grown the same `lang === 'hi' ? … : …` branch, and three cited
an earlier admin instruction (2026-07-20, 2026-08-05, 2026-08-10) as justification. **Those three are
SUPERSEDED** — the admin's own correction after seeing the result — and each module records that in
its header so nobody re-derives the old behaviour from the old quote.

🔒 **`tests/uiLanguageEnglishOnly.test.ts` now enforces it in CI**: any Devanagari in client code
(`src/**` minus `src/server/**`, comments stripped) fails the build. A file is **guilty until
listed**, and the allowlist entries — greeting detection fed to a model, the localisation editor for
the USER's own app, build-prompt content, input parsing — each carry the reason they are not UI
strings. **Comments are deliberately NOT swept**: the Hindi in them is the admin's own verbatim words
kept as evidence, and destroying that trail to satisfy a lint would cost more than it buys.

## 🎨 COLOUR COMES FROM TOKENS, NEVER FROM A LITERAL (admin-mandated 2026-09-18: "pura theme system badlo")

The audit that day (72 screens × 5 themes, 420 screenshots, every text node measured) found 236 invisible
and 1,557 near-invisible text nodes, and ONE cause: the UI was written in hardcoded GitHub-dark classes
(`text-white` ×1,852, `bg-[#0d1117]`, `text-[#8b949e]` … 14,620 usages) and `theme-compat.css` re-mapped an
allowlist of them. That allowlist was patched three times for "a category I missed" and the audit found
the next 1,347. **An allowlist can never be complete against an open-ended set of class names — so the rule
is now enforced at the source, by CI.**

- **Colour is named by ROLE, through the tokens in `index.css` `@theme inline`:** `bg-surface / bg-card /
  bg-raised`, `text-ink / text-body / text-muted / text-faint`, `border-line`, `text-accent-text`,
  `text-success / text-warn / text-danger / text-info`, `text-on-accent` (white on a solid accent).
  `text-white`, `text-gray-400`, `bg-[#161b22]`, `text-indigo-300`, `style={{ color: '#…' }}` are all
  FORBIDDEN in client code. Solid brand fills (`bg-indigo-600`) are tolerated for now — they are the
  same in every theme — but prefer `bg-accent`.
- **🔒 `tests/themeTokensOnly.test.ts` is the ratchet.** `tests/fixtures/themeColourBaseline.json` records
  today's literal count PER FILE; CI fails if any file goes ABOVE its number (a new literal) or BELOW it
  without the baseline being regenerated (`node scripts/themeColourBaseline.mjs --write`, commit the
  smaller file). A file not in the baseline has a baseline of ZERO. The number only goes down.
- **A faded label is `text-muted`, not `text-ink/40`.** The old `text-white/20`–`/40` idiom is 1.9–2.2:1 on
  every theme; the same test holds every theme's palette at ≥ 4.5:1, and a 40% ink does not clear it.
- **Every theme's palette must pass WCAG AA on all 10 text × 3 surface pairs** — the test reads the blocks
  out of `index.css`. Do not add a theme, or "tune" one, that fails it (Comfort's Solarized values did).
- **Do NOT add selectors to `theme-compat.css`.** It is the thing being retired: it shrinks as files
  migrate, and is deleted when the baseline reaches zero.
- **THREE themes — Light, Dark, High contrast — and no more (PR B, 2026-09-18).** Dim and Comfort are
  RETIRED: the audit found Comfort failing on 84 of 84 screens and Dim adding nothing Dark did not.
  `src/lib/theme.ts` is the one vocabulary (`ThemeMode`, `THEME_MODES`, `normalizeThemeMode`); a saved
  `dim` is carried to `dark` and `comfort` to `light` where the value is READ (`useSettings` writes the
  successor back; the pre-paint script in `index.html` maps the same two names, so the first frame is
  right too). `tests/themeSystem.test.ts` fails if either retired palette reappears in `index.css`.
  ⚠️ Do not add a fourth theme without adding its palette to the AA lock, `THEMES` in
  `themeTokensOnly.test.ts`, the pre-paint script, and the status-bar mapping in `nativeShell.ts`.
- **`getThemeClasses` is GONE — do not bring it back in any form.** It was a per-theme bag of colour
  literals handed through props (`themeClasses`, `bgClass`); every consumer now uses the tokens
  directly (`bg-surface text-body` on the root, `bg-card border-line` on bars) and needs no JavaScript
  to know which theme it is in. `tests/theme.test.ts` asserts the export does not exist.
- **High contrast's brand hues are DISTINCT by test** (success / warn / danger / info each ≥ 7:1 on
  black and no two the same): the first version painted all four #ffff00, so a red "failed" and a
  green "saved" were the same colour to the one audience that chose this theme to read better.
- **A swatch is the one legitimate fixed colour in the picker** (the Light swatch is white even on
  Dark) and it lives in CSS as `.theme-swatch[data-swatch]`, not as a class literal in TSX.
- **Migrate a file with the codemod, not by hand (PR C, 2026-09-18):**
  `node scripts/themeMigrate.mjs <file> [--dry]` then `node scripts/themeColourBaseline.mjs --write`.
  One explicit table, two kinds of row: **EXACT** (the literal is one `theme-compat.css` already remaps,
  and the token emits the SAME variable — `tests/themeMigrate.test.ts` proves it against the compat
  file, so it is pixel-identical on every theme by construction) and **FIX** (the audit's unreadable
  idioms — `text-white/40`, a light brand shade as text, `bg-black/30` as a well — moved to the
  readable token, on purpose). Anything else is left and listed; nothing is guessed. `text-white` on
  a SOLID brand fill in the same string becomes `text-on-accent` (the compat exception, mirrored); a
  fill chosen by a ternary inside a template literal is handled only when every branch is a fill,
  otherwise it is left for a hand split. Verified on AdminDashboard: 1,073 → 1 literals, and the
  audit crawler's numbers and screenshots on the admin view are IDENTICAL before and after on all
  three themes. ⚠️ Do not extend the table with a row you cannot classify as EXACT or FIX. Since PR D
  it also knows a gradient stop into the chrome (`to-[#161b22]` → `to-card`), a hex brand fill
  (`bg-[#24292e]`), and a label directly inside a filled box (the line above opens a solid-fill
  element) — each learned from a real miss in a real file, never from a guess.
- **🔴 A TEMPLATE LITERAL THAT CONTAINS MARKUP IS SOMEBODY ELSE'S APP — never counted, never
  rewritten (PR F, 2026-09-18).** `ComponentLibrary.tsx` holds 19 copyable HTML snippets and
  `SyncedTemplates.ts` whole starter projects as backtick strings; PR D's codemod rewrote the snippets'
  classes to our tokens (`bg-gray-900` → `bg-card`), which would have handed a user a component with no
  background in THEIR plain-Tailwind app, and the census counted 219 starter-project literals as our UI.
  Caught before it reached `main`. `maskEmbeddedSources` (`themeColourBaseline.mjs`) blanks every
  template literal whose body carries `className=`, `class=` or an HTML tag — NavBharatAI's own UI never
  puts JSX in a backtick string — and BOTH the census and the codemod read through that one function. A
  class-list template (`` `px-2 ${x} text-white` ``) has no markup and is still migrated.
- **A grey label under a solid fill becomes `text-on-accent`, wherever it sits (PR F).** The codemod
  treats any non-chrome `bg-[#hex]` as a fixed brand fill (`hasHexBrandFill`) and tracks "inside a fill"
  by indentation across lines (`fillScopes`), so "UTF-8" three lines under Code Studio's `#007acc` status
  bar no longer lands on `text-muted` (1.47:1). When migrating by hand, the same rule: on `bg-indigo-600`
  or a hex fill, text is `text-on-accent`, never `text-ink`/`text-muted`.
- **A filled element names its own label colour (PR G, 2026-09-18).** A button on `bg-violet-600` with
  no `text-` class was white only because the old dark root was `text-white`; on tokens the root is
  `text-body` and the label went near-black on violet. The codemod now adds `text-on-accent` to any
  RESTING solid fill without a text colour (never to a `hover:`-only fill, never to `bg-clip-text`), and
  an inline `style={{ backgroundColor: … }}` that is not a `var(--…)` counts as a fixed fill. By hand:
  never rely on inheritance for text on a fill.
- **🔴 A FIXED box fixes everything inside it, and its LUMINANCE picks the label (PR H, 2026-09-18).**
  `bg-black`, `bg-white` and any non-chrome `bg-[#hex]` are colours the theme can never repaint, so
  every colour nested in that subtree is fixed too — a `text-white` four levels under `bg-black` must
  stay white, not become `text-ink` and vanish on Light. And white is only a legitimate label where it
  clears 4.5:1: `fixedFill()` measures it, and on a LIGHT fixed fill (Facebook's `bg-[#f0f2f5]`) the
  codemod leaves the labels exactly as written rather than guessing inside somebody else's mockup.
  **A third-party preview — a Google result, a Facebook card, a Twitter card — is that case**, and its
  literals stay counted by the ratchet rather than migrated.
  Five further distinctions the same PR had to draw, each from a real miss: a **wash** gradient (a
  translucent or themed stop, a 1px gradient border round a themed card) is NOT a fill; an element
  declaring its **own themed surface** ends any fixed subtree it sits in; a **hover** background is
  not the element's own background (`hover:bg-…` paints nothing at rest); an **inline**
  `style={{ background: '#…' }}` opens a fixed subtree and is measured like any other fill; and a
  background is **never themed while a fixed hex ink sits on the same element**. And on a fixed fill a
  **brand-coloured label keeps its literal** — `text-amber-400` stays, because `text-warn` is dark
  amber on Light and the panel under it is near-black on every theme (2.59:1); same for a hex brand
  ink such as Figma's `#a259ff` on its own dark chip.
  A **translucent tint** (`bg-amber-500/10`) is not a surface either — the fixed box shows through it,
  so "does this element have its own background?" means a resting, OPAQUE one (`hasOwnOpaqueBackground`).
  ⚠️ **While `theme-compat.css` still exists, a GitHub-dark literal is NOT self-coherent** — compat
  repaints `bg-[#0d1117]` per theme, so a fixed ink left on it goes invisible on Light. A code block
  whose background compat owns must have its ink themed too (`bg-surface text-info`), not frozen.
- **A dark tint is a Light defect; a dark shade as text is a Dark defect.** `bg-emerald-900/30` →
  `bg-emerald-500/10` (≤ 60% only — above that it is an opaque panel, by hand) and `text-emerald-600` →
  `text-success`. Both are counted by the census since PR G, so the ratchet sees them.
- **A panel must not carry a PRIVATE theme.** SecurityScan had its own `useState<'dark' | 'light'>`
  and a "Light Mode" button with 23 ternaries; removed in PR G. One theme, the app's — a local toggle is
  a second theme system and is deleted, not migrated.
- **Two more tokens exist since PR C:** `bg-well` (an inset panel inside a card — the old
  `bg-black/20–40` on dark; a 6% ink wash on light) and `bg-scrim` (the modal backdrop, deliberately
  the same dark on every theme because it dims what is behind it).
- **AN INLINE STYLE IS A COLOUR LITERAL TOO, and the codemod could not see one until PR L
  (2026-09-20).** The class table had `theme-compat.css` remapping it per theme; an inline style was
  remapped by NOTHING — `style={{ color: 'rgba(255,255,255,0.4)' }}` is white-at-40% on Light exactly
  as on Dark, 1.1:1, one of the audit's 236 invisible nodes. The codemod could not see a single one.
  `themeMigrate.mjs` now carries an inline table (`INLINE_TEXT` / `INLINE_LINE` / `INLINE_BG`):
  **inline literals 296 → 206** across 15 files (37 exact, 57 readability fixes).
  ⚠️ **The ratchet's 991 is 695 CLASS literals and 296 inline ones — MEASURED, after an earlier draft
  of this bullet asserted the tail was "almost entirely" inline from reading the top three files.** The
  class sweep is its own later slice. ⚠️ **`exact` is MEASURED here too, never claimed**: there
  is no compat layer to be identical to, so a row is `exact` only when the literal IS that role's
  value in `DARK_VALUE` — which `tests/themeMigrate.test.ts` asserts against `index.css`'s own dark
  block. Inheriting `exact` from the class rows (where it means "compat remaps it") would have
  labelled `#e6edf3 → --text-body` as no change when Dark's `--text-body` is `#c9d1d9`.
  🔴 **A DECLARATION'S CONTEXT IS ITS ELEMENT, NEVER ITS LINE**, and this is the one rule not to
  simplify: the first version asked what the background on that LINE was, and a style object is
  routinely written over several — so `color: 'white'` under `background: '#4f46e5'` saw no fill and
  became `--text-primary`, near-black on indigo at ~2.2:1. **The tool that removes invisible labels
  created one**, caught in its own diff before it left the branch. And the object was not enough
  either: `AuthComponent`'s Apple button sets its fill in `className` (`bg-black text-on-accent`) with
  a forced `color: '#ffffff'` beside it whose own comment says it exists to be unthemeable — that one
  broke TRAP 3 and needed `elementAt` + `elementFixesItsLabel`. **A fill is a fill whether it is
  written as a style or as a class.** Eight cases in `tests/themeMigrate.test.ts` lock both halves,
  proven by reversion.
- **🔴 `@theme inline` EMITS NO CUSTOM PROPERTY — so `var(--color-…)` names NOTHING in an inline style
  (verified 2026-09-20).** That is what `inline` means: the utility (`text-on-accent`) gets the value
  baked in, and no `--color-*` variable ever reaches the stylesheet. Checked against the built CSS, not
  reasoned about: `--color-surface`, `--color-ink`, `--color-well`, `--color-scrim` and
  `--color-on-accent` are **all absent**, while `--text-muted`, `--surface-well`, `--scrim` and
  `--accent` — declared in `@layer base` — are present. So `style={{ color: 'var(--color-on-accent)' }}`
  would resolve to nothing, `color` would fall back to the inherited `--text-body`, and a label on a
  solid indigo button would render near-black on Light. **Nothing would fail**: not tsc, not a test, not
  the ratchet, which counts literals and has no opinion about a var that does not exist. The CLASSES are
  fine and widely used; it is only the raw `var(--color-…)` form that is a silent no-op.
  ⚠️ **No shipped component had this bug** — it was found because the inline codemod emitted exactly
  that shape and its own diff was read. **In an inline style use the `@layer base` names**: `--accent`,
  `--on-accent`, `--text-*`, `--surface-*`, `--border-soft`, `--scrim`, `--brand-*`.
  🔒 `--on-accent` is now declared in all three palette blocks and `@theme inline` points
  `--color-on-accent` at it, so the utility and the raw var are one value rather than two.
  `tests/everyTokenAStyleUsesIsDeclared.test.ts` fails CI on any `var(--x)` in client code that nothing
  anywhere declares — reversion-proven. It knows the three ways this app really declares one (a CSS
  declaration, a style-object key, `setProperty`), because `--nbai-pane` is written by `splitPane.ts`
  and read by `AgentV3Panel.tsx`, and `--nb-font-scale` is set imperatively in `a11y.ts`; a narrower
  scan would report half the app as broken and be switched off within a week.
- **⚠️ `tests/inlineThemeColours.test.ts` ALREADY GOVERNED INLINE COLOURS since 2026-08-16 — read it
  before touching them.** Its three traps are binding: **1** a library config is not a DOM style
  (`ShellTerminal`'s xterm theme parses colours itself and cannot read `var()`); **2** the user's
  colours are not ours (`MultiPageBuilder`, `DarkModeGenerator`, `WhitelabelBranding` export colours
  into the USER'S app, where our variables do not exist); **3** a label on a brand fill keeps its white.
  The codemod now names those files in `INLINE_SKIP` and treats a brand fill as FIXED — theming it is
  not even an improvement, since white on Dark's `--accent` (#818cf8) is 3.0:1 against 5.6:1 on #4f46e5.
  🔴 **I did not find that suite before writing the pass, and it cost a full red gate** — safeguard #6's
  vocabulary failure exactly: I searched the codemod and the ratchet, never `find tests -iname "*inline*"`.
- **The class sweep and the inline sweep are SEPARATE runs (`--inline-only`), on purpose.** They touch
  different literals and collide with different pinned tests, so mixing them makes the diff
  unreviewable and the failures indistinguishable. A file whose class literals an earlier PR
  deliberately left — a status dot whose `bg-emerald-500` a test names, an exit dialog's `bg-white/10` —
  must not be migrated as a side effect of fixing its inline styles.

## Engineer AI — permanent constraints (never change without admin sign-off)

- **AI Model (multi-provider fallback — Phase 2, admin-approved):**
  Grok is primary (priority 1, `GROK_API_KEY`/`XAI_API_KEY`).
  Automatic fallback chain: Anthropic (priority 2) → Vertex AI (priority 3) → Gemini direct (priority 4).
  This keeps Engineer AI working when Grok is down or throttled.
  **AiCreditsProvider is NEVER registered** — it proxies through NavBharatAI's own account
  credits, which must never be spent on user builds.
- **User apps run on the user's own accounts.** NavBharatAI's Firebase project
  (`gen-lang-client-0866594388`) is NEVER used for end-user app databases,
  auth, or storage — that would charge NavBharatAI's billing account.
  Users bring their own credentials (Supabase, Firebase, or other providers).
  **ONE ADMIN-AUTHORIZED, QUOTA-BOUND EXCEPTION (2026-08-15, the instant-app store plan):** Nav App
  Store instant apps may keep SMALL SHARED ROWS (chat messages, guestbook entries, scores, bookings)
  on NavBharatAI's Firestore via the `window.NavData` API (`navStoreWebData.ts`), because demanding a
  Supabase account before a shared guestbook works would lose 90% of creators at the door. The
  exception's TERMS are the hard quotas in that module (per-app row cap, per-day write cap, per-row
  size cap, rate-limited routes) — an over-quota app gets an honest 429, never NavBharatAI's
  overdraft. Anything bigger (auth, relations, files, real volume) stays on the USER'S OWN database —
  the one-click Supabase path. Do NOT widen these quotas or add collections/capabilities to NavData
  without fresh admin sign-off; the quotas ARE the authorization's boundary.
- **Sandbox:** E2B real cloud VM. LocalActuator is for dev/CI only.

### NavBharatAI Pro v3.0 (AgentV3) — admin-authorized billing override (2026-06-22)

The constraints above remain in force for **Engineer AI and the existing
builders**. They do **NOT** apply to the separate **NavBharatAI Pro v3.0
(AgentV3 / "Vargen 3.0")** engine, for which the admin (aashishcpmt09) has
explicitly authorized a different model on 2026-06-22 (see
`NAVBHARATAI_PRO_V3_DESIGN.md` §0, decisions D2/D5/D6):

- **NavBharatAI pays the Claude provider cost** for v3.0 builds (its own
  Anthropic account) — this is the authorized exception to "own account credits
  must never be spent on user builds", scoped to AgentV3 only.
- **The user is billed a markup** that makes this revenue-positive: the
  Claude **Opus-equivalent** token cost **× 2.5** (standard), or **× 5** for the
  "Only Opus" super toggle — regardless of which model actually runs. Billed via
  the platform's usage cost record (`UserCostStore`), the same place every other
  build records cost. Margin is structurally positive (billed ≥ real cost).
- **BYOK (user's own Anthropic key) is NOT a NavBharatAI feature and must not be
  built or re-proposed.** The admin (aashishcpmt09) removed it deliberately
  (2026-06-25); v3.0 always runs on NavBharatAI's own Anthropic account billed via
  the markup above. Do not re-introduce a "bring your own Claude key" option in any
  form. (This does NOT affect Bring-Your-Own-*Database* — a separate, kept feature.)

This override is **scoped to AgentV3** and was added in the same change that
wired v3.0 billing. Do not extend it to Engineer AI or remove the constraints
above for the other builders without separate admin sign-off.

## NavBharatAI Pro v3.0 — Model Routing Policy (admin-CONFIRMED 2026-07-12) — ⚠️ CONFIRM WITH ADMIN BEFORE CHANGING

**This is the single source of truth for which AI model runs where in v3.0.** It was explicitly
designed and confirmed by the admin (aashishcpmt09) on 2026-07-12. **DO NOT change any part of this
routing — the ladders, the judge-per-mode, the co-agent mapping, or the "no Claude in free" rule —
without first confirming the exact change with the admin.** (Same discipline as the absolute rules.)
Model ids are env-tunable (defaults below); the STRUCTURE is the policy.

### 1) FREE user (the 50,000 gift-token / never-paid user) — cheapest first; Sonnet/Opus NEVER; Haiku = last resort (amended 2026-07-13)
A graduated ladder (start cheapest; only climb when the judge still finds a real mistake):
1. **`glm-4.7-flash`** / **cheapest Kimi** (flash rung — sasta)
2. **`glm-4.7`** / **`kimi-k2.5`** (cheap coders)
3. **flagship `glm-5.2` / `kimi-k2.7`** (only as the LAST model rung)
4. **Vertex** — after the flagship rung also fails (admin: "agar sab failed ho to vertex use bhi kar sakte hai, but last me").
5. **Claude HAIKU** — the ABSOLUTE last rung (HAIKU AMENDMENT, admin 2026-07-13: "weak module me claude haiku
   add kar de? to last me") — model-pinned by construction; see the 🔒 rule below.
- **Judge = Grok.** After a build, Grok judges → OK ⇒ done; "repair" ⇒ fix on the cheap coders
  (`glm-4.7`/`kimi-k2.5`) and re-judge; still failing ⇒ climb to the flagship rung; flagship fails ⇒ Vertex.
- **Sonnet/Opus NEVER run for a free user — anywhere** (amended: Claude **HAIKU** alone is authorized, and
  only as the final rung). This includes the post-build heal gates (integrity / preview / C9
  reviewer-autofix / runtime): on a free build they MUST run on the **non-flagship cheap coders
  (`glm-4.7` / `kimi-k2.5`)** — NOT flash (too weak to repair), NOT flagship, NOT Sonnet/Opus (the heal
  chains inherit the same Haiku-last backstop).
- **🔒 ABSOLUTE RULE — WEAK MODULE ⇒ NO SONNET/OPUS, EVER; HAIKU = the ONE authorized last resort
  (admin-mandated 2026-07-13, AMENDED by the admin the same day, unbreakable):** original rule: weak module
  never calls Claude. **HAIKU AMENDMENT (admin verbatim: "agar ham, weak module me claude haiku add kar de?
  to last me. par sart yeh hai, weak module me claude ka haiku ke alawa kuch aur nahi chalna chahiye, matlab
  sonnet ya opus never never!!!"):** the weak module may now use **Claude HAIKU as the absolute LAST rung**
  (after GLM/Kimi → Vertex/Gemini) — and ONLY Haiku; **Sonnet/Opus never run on weak, ever**. Enforced by
  construction at THREE layers, not convention: (1) `enforceNoClaude(chain, noClaude)` (`routes/agentv3.ts`)
  strips the `CLAUDE` (Sonnet/Opus) runner from the FINAL `buildTurnRunner` chain and keeps ONLY the
  model-pinned `CLAUDE_HAIKU` backstop, MOVED to the chain's END ("to last me") — the backstop is
  `forceModelRunner(…, haikuModel())`, so it physically cannot execute any non-Haiku model; (2) the
  `ClaudeClient.runTurn` no-Claude-zone chokepoint (`noClaudeZone.ts`) refuses any NON-HAIKU Claude id inside
  a weak build's async context — a raw/forgotten Sonnet path is refused before a token is spent; (3) the
  report's honesty detector (`claudeProviderDelivered`) flags a Sonnet/Opus-class delivery as
  `NO_CLAUDE_VIOLATION` while an authorized Haiku delivery is clean. `noClaude` is threaded from
  `powerSpecResolved.cheapOnly || freeTierBuildActive` into EVERY `buildTurnRunner` call site, and the weak
  chain is `GLM/Kimi → Vertex/Gemini → HAIKU (last)`. ROOT CAUSE the original rule closed (deep-test App #1):
  the "no Claude" guarantee was tied only to `cheapOnly`, so a weak build whose heal gate didn't thread that
  flag ran 4 Sonnet calls on a free build. The resolved `powerLevel` + `noClaude` appear in every build report
  (with the amendment, `noClaude: true` means "no unauthorized Sonnet/Opus ran"; Haiku may have). Do NOT
  weaken or bypass this guard — or extend weak beyond Haiku — without explicit admin sign-off.

### 2) PAID user (bought tokens with real ₹) — flagship first, Claude only as last resort
1. Every 1st build: **flagship `glm-5.2` / `kimi-k2.7`**.
2. **Judge** → no error ⇒ done; error ⇒ send back to **GLM/Kimi** to repair → re-judge.
3. Still error after that ⇒ **Claude fixes it itself** (Sonnet repair).
- **Judge = Grok OR Sonnet — either is fine** (admin: "koi na, dono chalne do, chalega").

### 3) The 5 selectable power tiers — TIER→MODEL redefined by the admin 2026-07-13 (supersedes the old "power = Opus at low/high/max")
**The user's selected tier is EXACTLY the model the backend calls — no substitution** (admin: "user ne
jo select kiya hai, wahi backend par provider call ho, koi aur nahi"). Enforced in code (Fix 59):
| Tier (UI) | Internal | Model | Notes |
|---|---|---|---|
| Weak | `weak` | GLM/Kimi → Vertex/Gemini → **HAIKU last resort ONLY** — **Sonnet/Opus NEVER, in any circumstance** (Haiku amendment 2026-07-13) | free tier; `enforceNoClaude` strips Sonnet/Opus from every chain, keeps the model-pinned Haiku backstop last |
| Normal | `off` | Sonnet (adaptive routing, unchanged) | today's behaviour stays |
| Strong | `mini` | **SONNET pinned 100%** (was Opus low) | never Opus anywhere on this tier — build, sub-agents, heal gates, plan (Grok), judge (paid), vision (cheap). Bills Sonnet-equivalent × 3 |
| Powerful | `medium` | **Opus, effort `medium`** (was high) | bills real Opus × 2 |
| Full Team | `max` | **Opus, effort `max` (ultracode)** | bills real Opus × 2 |
- On the two OPUS tiers: builder + repair/heal gates + **judge** + **plan phase** ⇒ **Opus** (`claude-opus-4-8`).
- Paid pinned tiers (`mini`/`medium`/`max`) never let the GLM/Kimi cheap floor lead and never take the
  fast lane — the pinned model leads 100%; Vertex/Gemini/Haiku remain error-only last-resort backstops
  (the "never break" insurance), used only after the pinned model itself has failed.

### Judge (reviewer) per mode — must become MODE-AWARE (today it is a single global setting)
| Mode | Judge |
|---|---|
| Free | **Grok** |
| Paid | **Grok or Sonnet** (either) |
| Power | **Opus** |

### Co-agents / other engines — the mapping (same spirit: cheap for free, strong for paid, Opus for power)
| Engine | Free | Paid | Power |
|---|---|---|---|
| Builder + frontend/backend sub-agents | flash → 4.7/kimi → flagship → Vertex | flagship → cheap-repair → Claude | Opus |
| Manifest / shared-contract planner | cheap (GLM/Kimi) | cheap-first, Claude backstop | Opus |
| **Judge / Reviewer** | **Grok** | **Grok or Sonnet** | **Opus** |
| Plan phase | Grok | Grok/Sonnet | **Opus** |
| Vision (image describe) | Gemini/Grok (cheap) | Gemini/Grok | Claude/Opus |
| Heal gates (integrity / preview / C9 / runtime) | **GRADUATED: cheap coder → FLAGSHIP LAST (`glm-4.7`→`glm-5.2`, `kimi-k2.5`→`kimi-k2.6`→`kimi-k2.7-code`). NEVER Sonnet/Opus.** Only the FLASH rung is skipped, and it is matched BY NAME, not by position — Kimi has no flash model, so `kimi-k2.5` is KEPT (this rule names it as a heal model). `AGENTV3_WEAK_FLAGSHIP_HEAL=on` restores the 2026-08-02 flagship-LED heal. ⚠️ Flash is still the FIRST rung of the main weak BUILD — it is dropped from the HEAL only. | Claude/Sonnet | Opus |

**SUPERSEDED, 2026-08-13 — the flagship no longer LEADS a weak heal.** The 2026-08-02 entry above put the
flagship FIRST in the heal ladder. The admin then said, three separate times, *"top module last me chalne,
starting me nahi"* and *"flagship use kar sakte hai, LAST me"* — i.e. "last" means last in the LADDER, not
merely last in the build's lifecycle (a heal already runs at the end of a build, which is how the earlier
reading justified itself). **The DEFAULT is now the graduated ladder: cheap coder → flagship LAST**, with the
flash rung dropped because a heal must not begin on the model that produced the failing app — matched BY
NAME, so Kimi's `kimi-k2.5` (which this file names as a heal model) is kept, and the main weak BUILD still
leads with flash exactly as before. Setting
`AGENTV3_WEAK_FLAGSHIP_HEAL=on` restores the flagship-led behaviour without a deploy if a real report ever
shows the graduated ladder looping. Test-locked in `tests/weakHealLadder.test.ts`, which asserts the real
MODEL ORDER out of the constructed chain rather than just the options object — and that the PAID ladder is
untouched, since dropping a rung there would silently downgrade paying users' repairs.

⚠️ **`AGENTV3_WEAK_FLAGSHIP_HEAL=off` WAS A COST TRAP (found and fixed 2026-08-13, while answering the
admin's "mera kharcha kam ho").** The `off` branch returned `{ claudeFirst: false, cheapOnly: true }` with
**no `allowCheapFloor`** — and that does NOT mean "cheap coders instead of the flagship". `buildTurnRunner`
only builds the GLM/Kimi floor when `allowCheapFloor` is set, and `cheapOnly` self-disables without one
(`cheapOnly && floorRunners.length > 0`), so the weak heal chain collapsed to **VERTEX → GEMINI → Haiku with
no GLM/Kimi in it at all**. On the tier NavBharatAI pays for ITSELF, that made the "cheaper-sounding" switch
the **most expensive** rung in the stack: gemini-pro **$10/MTok out** and Haiku **$5**, against flagship
glm-5.2's **$4.40** and kimi-k2.7's **$4.00** (`providerRates.ts`). The branch now carries
`allowCheapFloor: true, free: true`, so it does what its name says.

**COST CONCLUSION, FOR THE RECORD: on a weak heal the FLAGSHIP GLM/Kimi IS the cheap choice — turning it off
costs the admin MORE, not less.** Test-locked in `agentv3.test.ts`: BOTH branches must keep a real floor, so
no future edit can silently route a weak heal to Gemini/Haiku again.

### Env model-id defaults (tune the exact ids here — the code reads these, so no redeploy to change a rung)
- Free ladder (LIVE, Slice 3): flash-first — `AGENTV3_FREE_GLM_MODEL` (default `glm-4.7-flash,glm-4.7,glm-5.2`),
  `AGENTV3_FREE_KIMI_MODEL` (default `kimi-k2.5,kimi-k2.6,kimi-k2.7-code`), then Vertex/Gemini as the absolute
  last rung (never Claude). Separate from the paid `GLM_MODEL`/`KIMI_MODEL` so tuning free never touches paid.
  Dormant until the free-tier master (`AGENTV3_FREE_TIER_CHEAP` / `AGENTV3_COST_ROUTING`) is on.
- Paid/default ladder: `GLM_MODEL` (flagship-first, e.g. `glm-5.2,glm-4.7`), `KIMI_MODEL` (e.g. `kimi-k2.7,kimi-k2.6`).
- ⚠️ The exact Kimi rung ids (`kimi-k2.5` / `kimi-k2.6` / `kimi-k2.7` / `-code` suffix) are admin-tunable —
  cross-check them against the live Moonshot model list before flipping on.

**Implementation status (2026-07-12):** policy SAVED here; code changes ship slice-by-slice (per-tier free
ladder, mode-aware judge, free-tier heal-gate re-route to cheap coders, power-mode judge+plan→Opus), each
tested + gated + merged. Until a slice ships, the current behaviour (audited 2026-07-12) still applies.

### 🔴 THREE TIERS, THREE LADDERS, "100% USI MODE MEIN" (admin-mandated 2026-09-14) — SUPERSEDES the five-tier table and the boolean-assembled chain above

Admin, verbatim: *"abhi 5 type hai — week, normal, strong, power, full team. inko simple 3 me badlo, week,
normal, strong. bas."* and *"user ne agar teeno mode me se jo select kiya hai, aap 100% usi mode me bane."*
Everything above about 'medium' (Powerful) / 'max' (Full Team) and about `claudeFirst` / `allowCheapFloor`
/ `cheapOnly` / the Vertex-Gemini "last resort" describes the engine BEFORE this date. The source of truth
is now **`src/server/AgentV3/tierLadder.ts`**, and the build chain is built from it rung for rung.

| Tier (UI) | Internal | The ladder (first → last) | Escalation cap |
|---|---|---|---|
| Weak (free) | `weak` | GLM `glm-4.7-flashx` → KIMI `kimi-k2.7-code` → GLM `glm-5.3` → Claude **Haiku** | never escalates (NavBharatAI pays) |
| Normal (paid economy) | `off` | GLM `glm-4.7-flashx` → KIMI `kimi-k2.7-code-highspeed` → GLM `glm-5.3` → Claude Sonnet | Sonnet |
| Strong (paid premium) | `mini` | GLM `glm-5.3` → KIMI `kimi-k3` → Claude Sonnet → Claude **Opus** | Opus (its last rung) |

🧠 **A BIG APP DOES NOT OPEN ON THE CHEAPEST RUNG (admin 2026-09-17, verbatim: "kimi ko bade aur
complex task dedo, kabhi bhi — starting me bhi de sakte ho, beech me bhi! task chota/bada/mild/complex
hai code se pata na lage to gptnano se puchwa lo!!").** `AGENTV3_COMPLEX_TO_KIMI` — ⚠️ **NOT set, and
the code default is ON**; `off` restores the pre-change behaviour exactly (every build opens on rung 1)
and costs nothing while off. Read by `src/server/AgentV3/complexityRouting.ts`; applied through
`buildTurnRunner`'s new `complex` flag.

- **A `complex` verdict skips the cheap flash opener**, so on Weak and Normal the first engine to see
  the app is **KIMI**. Strong has no flash rung and is untouched. "Starting me bhi" is literal.
- **The line is 40 — `RequestAnalyser`'s OWN top tier boundary**, not a second invented threshold
  (`simple_app` ≤20 capped, `coding` 30, `debugging` 45, `complex_app` 58, `architecture` 80).
- 🔑 **THE HOOK WAS ALREADY THERE, UNUSED.** `analyzeRequest`'s docblock has said since the cost-ladder
  work that it "marks the genuinely ambiguous ones (`ambiguous: true`) so a caller MAY refine them with
  a cheap LLM analyser" — and nothing ever read that flag. This is that half, so no new scoring concept
  competes with the existing one.
- 💸 **A model is asked ONLY within ±3 of the line**, deliberately narrower than `ambiguous` itself
  (which marks BOTH the 20 and 40 boundaries, because it was written for a three-tier ladder). Only the
  40 line can flip this binary decision, so asking about a score of 18 would spend a call to move a
  verdict from `simple` to `simple`. **"Kharcha kam se kam" applies to the classifier too.**
- 🔒 **It cannot break, hang or mislead a build**: the call is raced at 6 s, and a throw, a timeout, an
  empty reply and an unparseable reply ALL fall back to the deterministic verdict — never to a guess.
  `simple` is the default on every doubt, including a NaN score.
- ⚠️ **What it costs, plainly:** on Weak (which NavBharatAI pays for itself) a complex build opens on
  `kimi-k2.7-code` ($0.95/$4.00) instead of `glm-4.7-flashx` ($0.07/$0.40) — ~13× the input price for
  THOSE builds. The bet is that a cheap rung which fails is paid twice, once in the wasted call and
  once in the heal. **Watch: the share of builds routed complex, and whether their heal count drops.**
- 🔗 `healLadder` and this router share ONE definition of "the cheap opener"
  (`withoutCheapFlashLead`), applied by `buildTurnRunner` for `heal || complex`. They stay separate
  FLAGS — "this is a repair" and "this is a big app" are different questions with the same answer
  today — and a test asserts the two produce identical ladders so they cannot drift.
- ⏱️ **A COMPLEX build's fast lane gets room for its contract (admin-approved 2026-09-24, autopsy
  3ab93068). `AGENTV3_FASTLANE_COMPLEX_SECONDS` is NOT set; the code default of 480 s governs, clamped
  to 240–900, and an unreadable value falls back to 480, never to "no limit".** Opening a complex app on
  a reasoning rung made its plan call take 40 s. Its shared contract was then cut at 56 s by its share of
  the 240 s budget, and the missing contract cost 419 s of repair. So a complex lane gets the larger budget
  and is never talked out of its contract (`fastLaneBudgetMs`). An ordinary lane keeps 240 s, unchanged.
  The `FAST_LANE_PHASES` line now names the contract's own clock (`stopped at its own Ns cap`) instead of
  leaving *"build budget reached"* to be read as the whole build. **Watch: the repair share of complex
  builds in that line.**

🏗️ **`AGENTV3_PROJECT_MODE` — SOFTWARE PROJECT MODE. BUILT, WIRED, TESTED, AND ASLEEP SINCE
2026-07-04. ⚠️ Recorded here on 2026-09-17 because it was MISSING FROM THIS REGISTRY ENTIRELY** —
zero mentions in this file, eight in `PROGRESS.md`. That is precisely the drift this registry exists
to prevent, and it is why the capability is invisible: a session asked to build "milestone building"
would build a second copy of it, and the admin cannot decide on a feature nobody tells them exists.

**What it is** (`src/server/AgentV3/ProjectPlan.ts`, 592 lines + `ProjectPlanStore.ts`): for a build
too big for one conversation, the project is decomposed ONCE into modules carrying explicit
`dependsOn` edges and **frozen export contracts**, persisted durably, and then each turn builds ONE
module in a FRESH context holding only that module's spec plus the contracts of modules already
done — never the transcript. Context stays small however big the project is, so size is bounded by
the plan rather than by the window. It answers the five ceilings by name: context window, the
80-step cap, the 30–60 min clock, the budget cap, and small-app-tuned verification.

🔒 **The wiring is VERIFIED, not taken from the doc** (`routes/agentv3.ts` ~14272–14356 creates and
saves the plan and projects the todos, ~18571 marks each module done/failed after its turn, ~19591
auto-continues to the next buildable module). This is a live path behind a flag, not dead code —
unlike `EmbeddingSearch`, whose only reader is called from nowhere.

✅ **SET `on` IN CLOUD RUN BY THE ADMIN 2026-09-18** — the two-month-old pending decision above is
taken, and Software Project Mode is live for every user. ⚠️ **It had never run for a single real
build before that moment**, so the first real mega-prompts are its first evidence; treat it as new.

🔴 **AND THE SWITCH WAS MEASURED THE SAME HOUR: THE DOOR IT OPENS WAS BOLTED.** `megaProjectSignals`
counted `^- ` / `^1. ` LINES, so **not one of fourteen realistic prompts fired** — "school ERP with
students, teachers, attendance, fees, exams, timetable, library, transport" scored **zero**, while
`ProjectPlan.test.ts`'s own passing case is the same system written as a bulleted spec. **The gate was
built to read a DEVELOPER's spec; real users write one line with commas.** Identical class to the
scoring fix shipped hours earlier that day (`COMPLEX_APP_SIGNAL` listed the words a developer writes
and scored "hospital management system" 5 — the score of "hi"): the instance was fixed in the SIZER,
the two GATES were never hunted.
- Both now ask one shared counter, `src/server/AgentV3/enumeratedFeatures.ts`
  (`countEnumeratedFeatures`), which reads bullet lines AND inline `a, b, c` / `a aur b` runs.
- ⚠️ **`MEGA_BULLETS_WITH_NOUN` moved 8 → 6**, and 6 is not invented: `complexityFromPrompt` already
  floors a named complex app's `featureCount` at six. It is the weaker half of an AND (a big-software
  noun must be present too). Measured margin: every ordinary app prompt counts **0–2**, every real
  project prompt **5–8** — six sits in the gap, not on an edge.
- 🔎 **SIBLING FIXED IN THE SAME CHANGE (rule 3): `featureCount` in `lib/appScopeAnalyzer.ts`**, the
  gate behind `AGENTV3_MEGA_ROADMAP` (on by default), was blind the same way — it saw only bullet
  lines plus loose verbs, so eight comma-listed modules read as the single word "with", halved away.
  It takes the **MAX** of its old count and the shared one, never the sum: that gate spends a real
  planner call on every user's build, so it may only become more right, never more eager. Measured:
  **zero** ordinary prompts flipped to `analyze`.
- Test-locked and reversion-proven in all three halves in
  `tests/theGateReadsBulletsUsersWriteCommas.test.ts` (17 cases), whose ORDINARY corpus is the
  precision lock — a later widening that drags a todo app in fails CI.

⚠️ **What to watch on the first real builds:** the `PROJECT_MODE` report line, and whether a big
request's module plan appears and advances. A build that takes an extra planner call and then
decomposes is the feature working; a *small* app doing that is the precision lock having been broken.

⚠️ **UNSET ⇒ OFF, and every build is byte-identical to today.** The flag takes `on` (everyone),
`off`/unset (the kill switch), or **anything else as an ALLOWLIST of uids/emails** — built
deliberately so the admin can enable it for their OWN account and run one real mega-prompt before
anyone else sees it. Detection (`detectMegaProject`) is HIGH-PRECISION on purpose: an explicit
"100+ files/pages/screens", or a big-software noun (ERP/CRM/HMS/SaaS platform/marketplace…) with ≥8
enumerated features, or ≥14 enumerated features. A false positive costs an ordinary app an extra
planner call; a false negative just builds exactly as it does today. Minimum 3 modules or it falls
straight back to the normal path.

🔴 **THE STATE IS A PENDING ADMIN DECISION, NOT AN UNFINISHED FEATURE.** `PROGRESS.md` (2026-07-04)
records it as *"fully built and dormant … ADMIN DECISION NEEDED (asked in chat, safeguard #3)"*,
with the exact action: set `AGENTV3_PROJECT_MODE=aashishcpmt09@gmail.com` on Cloud Run, send one
mega-prompt, watch the module plan appear and advance, then `on` for everyone once happy. **That
question has been open for over two months.** It is recorded here rather than acted on because the
key lives in a console no session can reach.

⚠️ **Three honest gaps, from that same entry and still open:** an IMPORTED repo never creates a plan
(creation fires only on a fresh `new_build`); a reopened incomplete plan needs a typed "continue"
(restore does not re-emit resumable); and contract DRIFT — a module deviating from its own frozen
contract — is caught only by the whole-workspace `tsc` each turn, not by a dedicated contract check.

🔴 **THE LEAD RUNG CHANGED 2026-09-17 — `glm-5.3-flash` IS OFF EVERY LADDER** (admin, verbatim: *"glm
5.3 flash ko hata do!"*, with the FlashX price read off docs.z.ai on their own screen). It is replaced,
on Weak and Normal and as the PLAN rung of both, by **`glm-4.7-flashx` — $0.07 in / $0.40 out / $0.01
cached**, against 5.3-flash's $0.15 / $0.50 / $0.03. Strong is untouched (it never carried a flash rung).

**This REVERSES half of the 2026-09-14 decision, and the reversal is evidence-led rather than a change
of mind.** That decision picked 5.3-flash on the rule *"a $0 rung that fails costs more than a $0.15
rung that succeeds"* — the rule is still right; its premise was false. Three autopsies in three days:
- **`ee20478d` (09-15)** — 280 hard 400s in ONE build. Every tier opened on a rung that could not
  succeed, because 5.3-flash cannot be told to stop reasoning.
- **`b3a2c81e` (09-16)** — 68 GLM failures, 52 `OUTPUT_BUDGET_STARVED`: the model's mandatory thinking
  spent the whole authorised output ceiling before writing one character.
- **`dd1f5f60` (09-16)** — 8.65 tokens/second sustained; 29.5 of a 30.1-minute build inside one call.

🔑 **FLASHX IS NOT MERELY CHEAPER — THE FAILURE CLASS CANNOT OCCUR ON IT.** `glmCanDisableThinking`
(`glmThinking.ts`) is a NUMERIC family test: 5.3-and-newer always reason; 4.x can be told not to. FlashX
is 4.7, so the turn sends `thinking: disabled` and the entire output budget goes to code rather than to
reasoning nobody reads. Cheaper AND structurally immune — so this is not a trade between the two aims.

💸 **THE BILLING HALF HAD TO SHIP IN THE SAME COMMIT, and it is the third time this exact trap was set.**
`glm-4.7-flashx` contains "flash" (→ the FREE `glm-flash` line) and matches `/glm-?4/` (→ the $0.60
coder line). Either would have been wrong, and a $0 real cost bills the USER ₹0 while we pay Z.ai —
identical in shape to `kimi-k2.7-code-highspeed` and `glm-5.3-flash`, both caught on 09-16. It now has
its own row (`RATE_GLM47_FLASHX_IN` / `_OUT` / `_CACHE`) matched BEFORE both rules. **A model may not
join a ladder until its price is on the card.**

🔁 **A HEAL NOW DROPS THE LEAD RUNG AGAIN — a dormant rule woke up.** `healLadder`'s pattern matched
only `4.7-flash`, so between 09-14 and 09-17 (while 5.3-flash led) every heal restarted on the very
rung whose output needed repairing. FlashX matches it, so the 2026-08-13 rule (*"a repair must not begin
on the model that produced the failing app"*) applies again: a Weak/Normal heal opens on KIMI. It costs
more per heal ($0.95/$4.00 vs $0.07/$0.40) — intended, because a cheap repair that fails buys a second
one. The predicate is now the named `isCheapFlashRung`, so this can never again turn on a coincidence.

⚠️ **THE HONEST RISK, recorded rather than discovered later: FlashX's CODING quality is unmeasured here.**
Z.ai's "X" suffix is the faster, paid variant of a Flash model (GLM-4.5-X, -AirX are all dearer than
their base), and this file's own 09-14 entry calls the free `glm-4.7-flash` *"weak at coding"* — FlashX
may share that brain. What changed is the comparison, not the estimate: a model that reasons well and
delivers nothing is worse than a plainer one that answers. **Watch heal COUNT on the first real builds,
not cost.** 🔒 Revert with no deploy:
`AGENTV3_LADDER_WEAK=GLM:glm-5.3-flash,KIMI:kimi-k2.7-code,GLM:glm-5.3,HAIKU` (and `_NORMAL` likewise).

🔴 **KIMI RUNGS REVISED 2026-09-16** (admin, verbatim: *"free wale me kimi 2.6 ki jagah kimi code 2.7 kar
de! normal wale me kimi code 2.7 highspeed karo strong me kimi k3 bhi add karo"*): Weak's Kimi rung moved
k2.6 → k2.7-code (Moonshot's dedicated coder, same price, better quality, at no extra cost to the builds
NavBharatAI pays for itself); Normal's moved to k2.7-code-highspeed (same model, ~2x tokens/sec, exactly
2x the price — priced into what the paying user is billed); Strong gained a Kimi rung for the first time,
`kimi-k3`, at exactly Sonnet parity, as the second rung (a third independent vendor before climbing to
Claude). Adding the highspeed rung SURFACED a real under-billing defect: `providerRates.ts`'s Kimi matcher
had no branch for the `-highspeed` suffix and would have silently billed it at half its real price via the
plain k2.7-code fallback — fixed with a dedicated `'kimi-k2.7-highspeed'` rate row and matcher branch in
the same change, test-locked (and reversion-proofed by re-deleting the branch and confirming the new test
fails) in `providerRates.test.ts`.

🔴 **REVISED THE SAME DAY UNDER THE ADMIN'S FULL AUTHORITY GRANT** (verbatim: *"mujhe yeh chahiye: mera
kam se kam kharcha; user ko best se best app, ek hi baar me (build fail kam se kam). aapko puri authority
hai, aap kis ai ka kaha use karna chahte ho — i approved"*). The admin's first list (4.7-flash-led Weak,
Kimi-led Normal/Strong, gpt-5.4 last on Weak) was superseded once the real prices were known:
**glm-5.3-flash $0.15 / $0.50, glm-5.3 $1.40 / $4.40.** The one lever behind both aims is that the FIRST
rung must be strong enough that heals are rare — a $0 rung that fails costs more than a $0.15 rung that
succeeds. So 5.3-flash leads Weak and Normal; 5.3 is the strong rung under Sonnet everywhere and leads
Strong; Kimi stays as the second vendor on every tier (see the 2026-09-16 revision above — k3 joined
Strong that day); **glm-4.7-flash and gpt-5.4 are on no ladder** (weak-at-coding / no key + unknown
price). **Nothing to buy from OpenAI.** Haiku is again Weak's last rung. `healLadder` now drops a leading
rung only when it is the known-weak 4.7-flash.

- **The chain IS the ladder.** A build on a tier runs that tier's rungs, in that order, and nothing else —
  no Vertex/Gemini rung, no borrowed Sonnet when the floor is off, no live-health GLM↔KIMI lead swap. A
  keyless rung is SKIPPED; a tier with no keyed rung is refused before the stream (`ENGINE_UNAVAILABLE`;
  weak keeps `WEAK_ENGINE_UNAVAILABLE`) — never built on another tier's model. Test-locked in
  `tests/tierChainFidelity.test.ts` against the CONSTRUCTED chain's (name, model) sequence.
- **Escalation = higher up the same ladder** (`escalationPathForTier`, `ladderFrom`): a Normal build that
  fails its gate restarts at its Sonnet rung; Strong at Opus. "Opus sirf zarurat par" is literal: Opus is
  reached only when K3 and Sonnet failed, or the finished build failed its gate.
- **Heal = the ladder minus its leading flash rung** (the 2026-08-13 rule, now one function: `healLadder`).
- 🔒 **WEAK NEVER RUNS SONNET/OPUS — three nets:** the ladder never names them; `parseLadderOverride`
  REFUSES an `AGENTV3_LADDER_WEAK` that does; `enforceNoClaude` strips every `CLAUDE*` rung except
  `CLAUDE_HAIKU` from the FINAL chain. ⚠️ **It no longer moves Haiku to the end** — the 2026-07-13 "to
  last me" was for a boolean-assembled chain; the admin's own list puts GPT-5.4 AFTER Haiku, so the guard
  decides WHAT and the ladder decides WHERE.
- **Grok STAYS** (admin, same day: *"Grok ko hatao mat … reviewer app tode na"*) — judge (free+paid), free
  plan phase, Engineer AI primary. Gemini/Vertex stay for vision and the free-chat backstop. They are simply
  not BUILD rungs. An earlier plan in this session to retire them is withdrawn.
- **Strong is a LADDER now, not Sonnet-pinned.** This changes the 2026-07-13 fidelity rule's *meaning*, on
  the admin's explicit choice (asked as a question, answered "Ladder: K3/Sonnet lead, Opus sirf zarurat
  par"): fidelity is to the MODE, not to one model id. Billing is unchanged — `powerToTier('mini')` is not
  the Opus tier, so Strong bills real cost + tiered markup, and an Opus rung that ran is priced at its real
  Opus rate inside that. A stored 'medium'/'max' maps UP to 'mini' (never down to Normal).
- **🟢 NVIDIA NEMOTRON — `NEMOTRON_API_KEY` SET, and `AGENTV3_NEMOTRON` set by the admin 2026-09-20.**
  Recorded hand-to-hand per this registry's own rule. The key alone reaches only the **ladder rung**
  (Weak/Normal, in FRONT of the Claude backstop, keyed rather than flagged); the **judge** and **plan**
  roles need `AGENTV3_NEMOTRON` naming a tier — `weak` / `free` / `normal` / `strong`, comma-separated,
  or `on` for every tier. `off` is the hard kill for all three. Read by `src/server/AgentV3/nemotron.ts`.
  💰 **Why the judge is the prize:** by that module's own measurement the judge is **78% of a cheap-lead
  build's entire real provider cost** ($0.0915 of $0.1176) — the one slice the prompt cache cannot
  rescue, being a single call over the app rather than a 70-call loop over a stable prefix. Ultra does
  it at **$0.50/MTok in** against glm-5.3's $1.40 and Grok's $3.00, with **no tools exposed**, which is
  also why it is the safest place to try an unproven vendor.
  ✅ **THE LIVE VALUE IS `weak`, VERIFIED FROM THE CONSOLE 2026-09-20** — the admin sent a screenshot
  of the Cloud Run variable list (`AGENTV3_NEMOTRON = weak`, `NEMOTRON_BASE_URL` = the NVIDIA host), so
  the judge and the plan ARE on for that tier.
  🔴 **AND THIS ENTRY SAID OTHERWISE FOR HALF A DAY, WHICH IS THE PART WORTH KEEPING.** It read *"the
  admin reported setting `AGENTV3_NEMOTRON=week`… the judge and the plan stayed OFF"*, ending with the
  exact sentence **"this must be verified in the console, not assumed from this entry"** — and a
  session (mine) then read the paragraph, skipped its own warning, and told the admin as a live fact
  that their config was broken and to go and change it. The admin opened the console and it was already
  right. **A doc's claim about a value in a console no session can read is only as good as the last
  person who looked; repeating it does not make it truer.** Same shape as the idle-minutes default that
  said "NOT taken" eight days after it was taken, and the E2B rate whose derivation "could not fail".
  🔒 **The GUARD is untouched and stays**, because it was never about one typo: `nemotronConfigNote()`
  names an unreadable value and the accepted words **in the build report's `TIER_LADDER` line as a
  WARNING**, and once in the server log. The value is still deliberately **NOT** corrected toward the
  nearest word — guessing would make the config mean whatever it resembles, and the next typo would
  enable a tier nobody chose. Three real instances of the class remain (a trailing space in
  `BRAVE_API_KEY`, an `=` in `ALERT_EMAIL_FROM`, `20%` in `AGENTV3_FEATURE_HEAL_PCT`); a protection
  built for a class is not retired because one suspected instance turned out not to have happened.
  ⚠️ **NEVER the architect, sub-agents, reviewer or heal passes** — those are the cached 40–70-call
  tool loops where Nemotron is **6.2× DEARER** than flashx (its route does not honour prompt-cache
  markers). `nemotron.ts` makes every other role structurally unreachable; do not widen it.
- **Env keys (names only):** `AGENTV3_LADDER_WEAK` / `_NORMAL` / `_STRONG` (override one tier's ladder,
  `PROVIDER:model,…`, applied whole or refused with the reason in the `TIER_LADDER` report line);
  `OPENAI_API_KEY` (the admin **bought a key on 2026-09-15** and asked what to name it; whether it is
  yet set in Cloud Run is unconfirmed here. ⚠️ **On its own it still changes NO build** — no tier
  ladder names OPENAI, so the rung yields nothing. **READ THE `AGENTV3_FILE_EMBEDDINGS` ENTRY BELOW
  BEFORE SETTING IT**: until 2026-09-15 that key alone silently switched on an unmetered,
  never-read embedding spend on every build) and `OPENAI_BASE_URL`, `AGENTV3_OPENAI_TIMEOUT_MS`; `RATE_GLM53_FLASH_IN`
  / `_OUT` / `_CACHE` (**code default now the admin's real price, 2026-09-14: $0.15 / $0.50, cache
  $0.03** — corrected 2026-09-16 from the admin's own copy of docs.z.ai/pricing, now recorded verbatim
  in `providerRates.ts`. It had been $0.0375, a ≈25%-of-input CONVENTION rather than Z.ai's published
  number, and the same convention over-stated the other two GLM cache rates (glm-5.x $0.35 → **$0.26**,
  glm-4.x $0.15 → **$0.11**). All three moved DOWN, and a bill is the real cost × markup, so the
  convention had been over-stating the USER's bill too. An earlier placeholder had priced flash at the
  glm-5 line, ~10× too high, for a few hours, on no user's bill); non-flash **GLM-5.3 is $1.40 / $4.40 =
  the existing glm-5 line**, no new row — ⚠️ that row is the FAMILY CEILING, and Z.ai's real GLM-5 is
  cheaper ($1.00 / $3.20), which the rate card now says in place;
  `RATE_GPT_NANO_IN` / `_OUT` (**$0.20 / $1.25**, GPT-5.4 Nano — priced so it can never be billed at the
  full-GPT bound, but on NO ladder: the admin's own brief says Nano is for classification/extraction,
  never an app-generation engine); `RATE_GPT_IN` / `_OUT` / `_CACHE` for the FULL gpt-5.4 — ⚠️ **still
  unknown, still the Sonnet-line bound** until the admin has its price. `AGENTV3_CHEAP_FLOOR=off`
  is still the GLM/KIMI kill switch. **Now inert for the build chain:** `AGENTV3_BUILD_CLAUDE_FIRST`,
  `AGENTV3_BUILD_ALLOW_GEMINI`, `AGENTV3_VERTEX_PEER`, `AGENTV3_FLOOR_BALANCE`, `AGENTV3_FREE_KIMI_LEAD`,
  `AGENTV3_WEAK_FLAGSHIP_HEAL`, `GLM_MODEL` / `KIMI_MODEL` / `AGENTV3_FREE_*_MODEL` (the ladders name their
  models; those envs still feed the legacy `cheapBuildFloorRunners`, which only tests call now).
- **🔴 `AGENTV3_FILE_EMBEDDINGS` — the flag that stops a PROVIDER KEY being a FEATURE SWITCH (shipped
  2026-09-15). ⚠️ NOT set, and unset means exactly today's behaviour: zero calls, zero cost.**
  `EmbeddingSearch` (AgentV3's per-file vector index) used to have NO flag at all — its only gate was
  the PRESENCE of `OPENAI_API_KEY`. Found on the day the admin bought an OpenAI key and asked only
  what to name it, so nothing had been spent.
  **What the key alone would have started, none of it visible:** `ToolDispatcher` calls `addFile()` on
  EVERY write, EVERY batched file and EVERY edit (three call sites), so an ordinary build fires dozens
  of `text-embedding-ada-002` calls — on every tier, **free included**, on NavBharatAI's own account.
  They are made with the OpenAI SDK directly, so they never pass `captureTurnUsage`: **in no build
  ledger, in no rate card (`providerRates.ts` prices no embedding model), invisible to
  `AGENTV3_BUILD_COST_CEILING_USD`, and never billed to the user.** That is the money audit's own
  class — a paid call with no governance — reached through a credential rather than a ladder.
  🔴 **AND IT BOUGHT NOTHING: `search()` — the only reader of the index — is called from no live code
  path.** Embed, persist to Firestore, never read. Recorded as an **OPEN root cause** rather than
  quietly wired up, because "make semantic retrieval real" is a separate decision with its own cost
  (`ContextReranker.ts` has described the path as dormant all along).
  🔒 **BOTH are required now, flag FIRST:** `getClient()` returns null unless the flag is on AND a key
  exists, checked at call time so switching it off in Cloud Run bites without a deploy. An unreadable
  value means OFF, never ON. Test-locked in `tests/fileEmbeddingsAreOptIn.test.ts`, whose last case is
  a **reversion guard** asserting the ORDER out of the source (comments stripped) — proven to fail when
  the flag line is deleted, because the behavioural tests alone would not.
  ⚠️ **If it is ever turned on, price it first.** `text-embedding-3-small` is ~5× cheaper than ada-002
  and scores better; the swap is free TODAY only because nothing is stored yet — once vectors exist,
  changing the model silently mixes incompatible embeddings at the same 1536 dimensions, which
  `cosineSimilarity`'s length check cannot catch.
- ⚠️ **Not yet done, said plainly:** the OpenAI rung is untested against a real response; the
  chat router (`AIRouterManager`) has no OpenAI provider — that is slice 3, only if GPT should serve chat.
- 🔴 **`OPENAI_API_KEY` IS SET IN CLOUD RUN (admin, 2026-09-15) — AND IT WOKE A PATH OUTSIDE THIS POLICY.**
  The three ladders are unchanged (no tier names OPENAI, so no build routes to GPT). But
  `src/server/routes/build.ts:130` — the LEGACY `/api/build` chain, live at `server.ts:739` — carries
  `{ name: 'openai', run: () => callOpenAI(...) }` as **rung 6** (claude → grok → aiRouter → gemini →
  groq → **openai** → deepseek → openrouter). `callOpenAI` runs **`gpt-4o-mini`**, and
  `resolveApiKey('openai')` falls through to the generic `process.env['OPENAI_API_KEY']` branch
  (`aiClients.ts:67`). **That rung threw "OpenAI API Key not available" and fell through until the key
  was set; it is now a real billable call on NavBharatAI's account**, from a provider this policy never
  approved, costed by `estimateTokens` rather than the real-cost ledger. Rare (five rungs must fail
  first) and it does add genuine resilience — which is exactly why it is recorded as an ADMIN DECISION
  here rather than silently gated or silently left. ⚠️ Anyone auditing "what does this key switch on?"
  must check BOTH the ladders AND this legacy chain; reasoning that stops at `tierLadder.ts` misses it.
  ✅ **CLOSED 2026-09-25 — THE LEGACY CHAIN IS GONE.** The admin asked for unused code to be removed
  (*"jo jo kaam ka nahi hai, woh hata do"*): `POST /api/build` and `/api/build-stream` answer `410`, and
  the engine behind them (`src/server/EngineerAI/`, the `project/` pipeline, `pro/` orchestrator, and
  `callOpenAI`/`callGrok`/`callDeepSeek`/`callOpenRouter`) is deleted. No client had called either
  endpoint since July. So rung 6 no longer exists; `OPENAI_API_KEY` now powers only the free-chat
  `gpt-5-nano` rung (`OpenAiChatProvider.ts`). The paragraph above is kept as history.
- ⚠️ **FOUR COMMENTS SAID GPT WAS ON THE WEAK LADDER, AND THE ADMIN CAUGHT IT BY READING THE CODE
  (2026-09-15).** They were true of the admin's FIRST list on 2026-09-14 and stale within the same day.
  The table was updated; `providerRates.ts`, `routes/agentv3.test.ts` (×2) and `routes/agentv3.ts` were
  not. **`tsc` and `vitest` cannot read a comment**, so nothing failed. **THE RULE: do not restate
  another module's fact — point at the module that owns it.** `TIER_LADDERS` is the only place a rung
  exists. Pinned by `tests/ladderClaimsMatchTheTable.test.ts`, which DERIVES the invariant from the table
  (so adding GPT for real silences it automatically) and is proven by reversion. `routes/agentv3.ts` is
  listed in its `OWNED_BY_ANOTHER_PR` set because PR #2957 was live in that region — remove that entry
  once #2957 lands.

**THE AGENT × TIER TABLE (admin-approved 2026-09-14, aims verbatim: "user ki app best of best bane — 1 try
me" · "mera kharcha kam se kam ho").** Test-locked in `tests/agentRolesPerTier.test.ts`.

| Role | Weak | Normal | Strong | Note |
|---|---|---|---|---|
| Credits / abuse / free-clamp | code | code | code | ₹0 — never a model |
| Safety triage | code | code | code | `triagePrompt` is deterministic, precision-first |
| Intent doubt-reader | free chat router | free chat router | free chat router | glm-4.7-flash led, $0; one-word answer |
| **Plan** | glm-5.3-flash → own ladder | glm-5.3-flash → own ladder | glm-5.3 → own ladder | `PLAN_RUNG` / `planLadder`; input-heavy call on the cheapest rung that reasons well; **Grok no longer plans** |
| Builder + sub-agents + fast lane | tier ladder | tier ladder | tier ladder | above |
| Heals | ladder minus leading flash | same | same | `healLadder` |
| Lint / typecheck / build / preview / journey / fuzz / CVE | code | code | code | ₹0 |
| **Judge / Reviewer** | **glm-5.3** | **glm-5.3** | **Grok** | a DIFFERENT model from the builder at the lowest input price that reasons well (glm-5.3 $1.40 in vs Grok $3); Strong builds on glm-5.3 so its judge is Grok, outside every ladder; `AGENTV3_REVIEWER=sonnet` forces Sonnet; no keys ⇒ Sonnet; **Opus is never the judge**. ⚠️ The user-facing review narration used to print the judge's vendor name ("🔎 Grok is reviewing…") — a White-Label breach, fixed |
| Vision (describe) | Gemini → Grok | Gemini → Grok | Claude(Haiku describe tier) → Gemini → Grok | `useClaude` follows `powerMode` |
| Escalation | never | own ladder from Sonnet | own ladder from Opus | `escalationPathForTier` |

Deliberate deviations from the admin's draft, each for the two aims: no model on guard/router/lint (code
already does it, ₹0); no Opus on plan or judge (input-heavy calls, and "Opus sirf zarurat par"); no
"context summarizer" (none exists — context is deterministic); "fallback builder" is the ladder's next
rung, not an agent; the explainer lives in chat, not the build. Two names in the draft are unverified
here — a non-flash **GLM-5.3** and **GPT-5 Nano** — and were not wired.

### Billing model — REAL-COST + tiered markup for every non-Opus tier (admin-CONFIRMED 2026-07-14, Fix 65) — ⚠️ CONFIRM WITH ADMIN BEFORE CHANGING

The admin verified the LIVE provider deductions on the GLM (Z.ai) + Kimi (Moonshot) dashboards and
redefined how NavBharatAI bills v3.0 builds. **This supersedes the old "Sonnet-equivalent × 1.2 / × 3"
billing for Weak/Normal/Strong** (which billed a cheap-led build ~21× its real cost — and once billed a
FAILED build ₹811). The Opus tiers are untouched.

- **Non-Opus tiers (Weak, Normal, Strong):** `bill = tieredMarkup( REAL provider cost )`.
  - REAL provider cost = the EXACT per-provider/model token spend × each provider's own real rate card
    (`src/server/AgentV3/providerRates.ts`), summed. The exact model that ran is captured via
    `TurnResult.model` (Claude/GLM/Kimi/Gemini runners all report it) → a `glm-4.7-flash` turn is FREE,
    a `glm-5.2` turn is the flagship rate. The unattributed aux remainder (plan/judge) is priced
    conservatively at Sonnet rates (margin-safe upper bound).
  - `tieredMarkup(C)`:  `C ≤ $1 → C × 4` ;  `C > $1 → $4 + (C − $1) × 3`  (first $1 at 4×, the excess at
    3× — big builds don't run away). Then × the live USD→INR rate (`UsdInrRate`).
- **Opus tiers (Powerful = medium, Full Team = max):** UNCHANGED — real Opus × 2 (`billedForTier 'opus'`).
- **Failed-build guard:** a build that was expected to produce an app but did NOT succeed (`!result.ok`)
  is NEVER charged — same "working app or free" law as the empty-build + unrendered-preview rules.
- **Kill switch:** `AGENTV3_REALCOST_BILLING=off` instantly reverts the non-Opus path to the legacy
  flat/per-tier billing WITHOUT a deploy (default = ON, this IS the billing model now). Rate cards are
  env-tunable (`RATE_GLM_IN`/`RATE_KIMI_OUT`/… ) and the markup curve too (`AGENTV3_MARKUP_SMALL` = 4,
  `AGENTV3_MARKUP_LARGE` = 3, `AGENTV3_MARKUP_THRESHOLD_USD` = 1) — track live prices without a deploy.
- HONESTY: cache-hit input tokens are not yet tracked separately, so cached input is priced at the full
  cache-miss rate → real cost is a slight OVER-estimate (margin-safe). A later slice can capture
  `cache_read` usage to bill even lower.

### THE ONE-WALLET LAW — every AI spends the SAME balance (admin-mandated 2026-08-01, shipped 2026-08-04)

**Admin verbatim: "user unhin 50,000 token se kharch kare, har jagah."** The gifted balance used to be
spent by v5 BUILDS only; the Professionals, Doctor AI and the AI-backed Other-AI tools were bounded by a
daily MESSAGE/ACTION COUNT instead. That is neither the same limit nor the same promise — ten cheap
questions and ten expensive ones cost the user the same while costing NavBharatAI completely different
amounts, and a user holding ₹600 of gifted credit could exhaust ten free messages and be told to buy a
Pass **while their balance sat untouched**.

**The rule now: anything that costs NavBharatAI money draws the ONE wallet down; anything that costs
nothing draws nothing. There are no per-feature quotas left to tune — the price of the thing IS the
limit.** (The deterministic tools — Minifier, Diff, Versioning, Test Runner, APK, CI/CD, SEO, … — cost
nothing to run and stay free and unmetered; metering them would be friction with no saving behind it.)

- **Master switch `AI_WALLET_SPEND`** (default OFF — set `on` in Cloud Run to make it real). While off,
  behaviour is byte-identical to before, with not even an extra Firestore read.
- **Cost comes from REAL reported tokens**, priced by the SAME rate card + tiered markup a build uses
  (`chatSpend.ts` → `providerRates.ts`) — one money model, nothing to keep in sync by hand.
- **🔒 NEVER INVENT A COST.** A provider that reports no usage ⇒ `measured: false` ⇒ **charge ZERO**.
  Estimating tokens from string length would produce a number that LOOKS like a measurement and would
  land on a real user's bill. We eat it. Keep `free-model` (measured, genuinely ₹0) and `unmeasured`
  (we do not know) as SEPARATE outcomes — only the second is costing us money silently.
- **Never charged:** an anonymous caller (no wallet), the admin free-list, and a **Professional Pass
  holder** (the Pass IS the payment — charging the wallet on top bills them twice for one thing).
- **Charge AFTER the answer, never awaited into the response.** A money-path failure must not cost the
  user their reply; charging first would risk billing a turn that then failed. A FAILED action is never
  charged (same "working result or free" law as builds).
- **Empty wallet ⇒ refused BEFORE any provider is called** (`walletTooEmptyForTurn`). A build may
  overdraw because the next pre-flight gate catches it; nothing catches a chat turn afterwards. A
  balance that cannot be READ is allowed through (fail-open, like the build gate).
- **Ledger rollup:** small charges group into ONE row per user per DAY (`computeRolledUpDebit`, label
  `NavBharatAI assistants` — never a vendor name). A row per turn would fill the 500-entry ledger in a
  fortnight and push the user's PURCHASE history off the end. The BALANCE still moves per charge; only
  the row accumulates. The bucket is dated on the SERVER clock (a device clock cannot move it).
- **Exact money:** the debit carries the sub-token remainder (`TOKEN_CARRY_FIELD`) instead of rounding
  up — see the exactness note below.
- **How a tool inherits billing:** `aiSpendZone.ts` (AsyncLocalStorage, same mechanism as
  `noClaudeZone`). The route opens a zone (`inAiSpendZone`), the shared routing layer records each model
  call, the route charges once beside its existing `burnToolAction`. A BATCHED tool is billed for ALL
  its calls, calls are SUMMED before the decision (so ten sub-token calls are one honest charge, and the
  markup applies to the request's real total), and a NEW tool is billed correctly for free. **Do not
  re-thread costs through call sites by hand — that is the fragility this replaced.**
- **Image generation stays on its quota cap**: its cost is per-image, not per-token, so there is nothing
  honest to price it with. An invented number would be worse than the cap.

### Debit exactness — the remainder is CARRIED, never rounded up (shipped 2026-08-04)

`inrToDebitTokens` used to **ceil**. Two costs: the user was charged up to ₹0.01 more than the work
really cost on EVERY build, and — worse — the ceil went into `tokenBalance` while `remaining_balance`
moved by the paisa-rounded ₹, so the wallet's TWO views of one balance drifted further apart on every
single build. Now the charge is exact, the ₹ is DERIVED from the tokens actually debited (so the two can
never disagree), and the sub-token remainder is carried to the user's next charge — no margin is given
away, it is only deferred by at most ₹0.01. This is also what makes per-message charging honest: ceiling
a ₹0.002 chat turn would bill **5×** the real cost. `computeDebitedWallet` returns `applied` — a charge
under one whole token debits 0 tokens but still moves the carry, so `tokensDebited > 0` is NOT a safe
test for "did anything change".

## User-facing Billing + Provider Anonymization — the White-Label Law (admin-mandated 2026-07-15) — ⚠️ CONFIRM WITH ADMIN BEFORE CHANGING

**Two promises to every end user, always kept together:** (1) the bill and cost breakdown they see are
**100% REAL**, and (2) the AI that did the work is **always "NavBharatAI"** — the user must NEVER learn which
third-party model ran in the background. These are not in tension: anonymizing the *vendor* is white-labeling,
NOT dishonesty. We never fake the **result** or the **amount charged**; we only brand the **engine** as ours.
(This is exactly how Lovable/Bolt/v0/Cursor present themselves — the user buys "the product's AI", not a
reseller of someone else's API.)

### 1) The user sees a REAL bill + REAL cost breakdown (honest — rules 2 & 3 apply)
- Every user-facing bill / receipt / wallet entry reflects the user's **actual usage** and the **actual ₹
  charged** (per the REAL-COST + tiered-markup billing model above). **No fabricated, rounded-up, or
  placeholder numbers.** A build that did not succeed is **never** charged (the "working app or free" law).
- The user CAN see an **itemized breakdown** — but itemized by **USER-FACING categories only**: e.g. tokens
  used, the build / tier chosen, ₹ amount, date, and (optionally) which of THEIR builds/features consumed
  what. The breakdown must add up to the real total, so it survives scrutiny.
- The breakdown is **NEVER** itemized by underlying vendor/model. The user must never see a line like
  "GLM $0.02 + Claude $0.11 + Gemini $0.01" — that both leaks the providers AND confuses the buyer. Collapse
  all provider cost into NavBharatAI's own categories (e.g. "AI build — <tier> — ₹X").

### 2) Provider anonymization — ABSOLUTE, on EVERY user-facing surface
On anything a normal end user can see, the AI is **always "NavBharatAI"** (or "NavBharatAI's engine" / "our
AI"). The user must **NEVER** encounter any of:
- Vendor / brand names: **GLM / Z.ai, Kimi / Moonshot, Claude / Anthropic, Gemini / Vertex / Google, Grok /
  xAI, Bedrock / AWS, DeepSeek, OpenAI**, etc.
- **Model ids**: `glm-4.7`, `glm-5.2`, `kimi-k2*`, `claude-sonnet-*`, `claude-opus-*`, `gemini-*`, `grok-*`, …
- **Routing/fallback leakage**: "Provider GLM failed — falling back", "switching to Kimi", "429 from Z.ai",
  "Sonnet is repairing it", "the cheap floor", or any hint that more than one vendor exists. A user-facing
  error degrades to a NavBharatAI-branded line — e.g. *"NavBharatAI's engine hit a brief hiccup and retried"* —
  never the raw provider error. Provider fallback/retry/escalation is **invisible** to the user: they only ever
  see NavBharatAI working.
- Surfaces this covers (non-exhaustive): chat replies, **build progress / narration / status lines**, the
  Billing panel + receipts + wallet ledger, error toasts/messages, empty/"not available" states, exported or
  **shared** build reports, emails/notifications, and any AI that answers "who built this?" / "which AI are
  you?" → the honest, on-brand answer is **"NavBharatAI"**, never the underlying model. (Note: the model-identity
  rule for THIS Claude Code session is separate and internal — it never reaches an end user either.)

### 3) Where provider names ARE allowed — ADMIN-ONLY, never exposed to users
Provider/model identity is essential for ops and MUST stay available to the admin: the **admin dashboard**,
**build-diagnostics JSON**, **server logs**, the **`deliveredVia` / per-provider token telemetry**, cost
autopsies, and `PROGRESS.md`. These are internal/forensic. The hard rule: **no admin-only diagnostic
(especially the build-diagnostics report, which literally names "Provider GLM failed" / "kimi" / "claude-…")
may ever be surfaced to an end user** — not linked, not embedded in a shared report, not shown in a user's
build feed. If a build report is ever made user-shareable, it must pass through an anonymization pass first.

### 4) Enforcement (how we keep it true, not just aspirational)
- **Single choke point:** route every user-facing provider reference through ONE anonymizer
  (e.g. a `publicEngineName()` / `redactProviders(text)` helper) so a NavBharatAI label is applied by
  construction — never sprinkled ad-hoc per call site (same discipline as `enforceNoClaude` / the no-Claude zone).
- **Test the invariant:** a regression test asserts that user-facing streams (narration, `done` summaries,
  billing payloads, error bodies) contain **none** of the forbidden vendor/model tokens, for representative
  builds — so a new leak fails CI instead of reaching a user.
- **Audit before trusting "it's already hidden":** today provider names live in admin diagnostics
  (`buildDiag.record(... "Provider X failed ...")`) and `deliveredVia` telemetry — NOT in user narration — so
  the current default is compliant, but any NEW user-facing surface (a richer billing breakdown, a shared
  report, a "why did this cost so much?" explainer) MUST be built anonymized from the first commit.

**Bottom line:** to the user it is always **NavBharatAI** doing the work, and the bill they pay is always the
**real** one — honestly itemized in our own terms, never a vendor-by-vendor ledger. Real cost, real bill, one
brand.
### Fix 67 — real-cost billing on the watchdog/advisory path + USER-facing provider anonymity (admin 2026-07-15)

Two admin-mandated additions to the billing surface (both verified live: a real PaisaTrack build showed
₹250.67 via the old path while the true cost was ₹39 and the correct Fix 65 bill was ₹157):

- **Watchdog/advisory finalization now bills via Fix 65 too.** A build that overran its wall-clock or
  (post-success) advisory cap used to finalize through `finalizeOnDeadline`, which billed the OLD flat
  `billedAmountUsd` and SKIPPED `setProviderTokens`/`setBilling` — so long builds showed the wrong ₹ and
  their report was billing-null. The shared `decideBuildBilledUsd()` now drives BOTH the normal settle
  AND the finalizer (no drift); the finalizer also records per-provider tokens + billing into the report
  and debits the wallet with the SAME idempotent buildRef (`${workspaceId}_${buildStartedAt}`) the settle
  uses, so a race can never double-charge.
- **🔒 USER-FACING PROVIDER ANONYMITY (standing rule, never weaken without admin sign-off):** the user must
  NEVER see which backend AI did the work — to them, **NavBharatAI did everything**. The user-facing cost
  breakdown is now `userCostBreakdown()` (exported, test-locked in `tests/userCostBreakdown.test.ts`): it
  carries ONLY tokens + the real bill + the user's selected tier, branded `NavBharatAI Pro v3.0` — never a
  provider/model name (GLM/Kimi/Claude/Sonnet/Opus/Gemini/Grok/…), never our internal real cost or markup
  (those stay ADMIN-only in the diagnostics report). This also fixed a real crash: Fix 65's per-tier
  breakdown objects had mismatched shapes that made the client do `undefined.toFixed()`. ✅ **Fix 68 —
  DONE (verified against live code 2026-08-04; this line previously read "not yet done" and was STALE).**
  The build report is now gated: `GET /api/agentv3/diagnostics` resolves `showProviderDetail =
  isReportAdmin(<VERIFIED email>)` and **fails CLOSED** (no email / lookup failure ⇒ anonymized), then a
  non-admin gets `userFacingReport()` (`BuildDiagnostics.ts`) for the latest/session/by-id report and
  `redactProviderError()` (`lib/providerRedaction.ts`) over the history list's `summary`/`rootCause`.
  Test-locked in `providerRedaction.test.ts`, `BuildDiagnostics.test.ts` and `agentv3.test.ts`. Separately,
  the user no longer downloads a report at all (admin 2026-07-29): "Report" submits it server-side to the
  admin inbox and the user receives only `{ ok }`. The standing rule is unchanged and permanent: **do NOT
  surface provider names on any user-facing screen.**

## Core engineering rules (copied up from PROGRESS.md so they're never missed)

These were previously only stated inside `PROGRESS.md`. Because that file is
not auto-loaded, they were easy to miss — they are mirrored here so every
session sees them. They reinforce the one absolute rule (the app must never
break):

- **Real, no hacks.** Build the real thing — no fake success, no stubbed
  "it works" when it doesn't, no placeholder/TODO shortcuts shipped as done.
- **A fix must never trade one problem for another (admin-mandated, 2026-09-13).** Whenever a request
  is an edit, an upgrade, or a fix, do not touch the code until you have traced who else reads,
  writes, or depends on what you are about to change — fixing problem A while quietly creating
  problem X is not an acceptable outcome under any circumstance. Verify this by exercising the
  affected paths (not just the one line changed) before calling the fix done, exactly as safeguard #5
  requires; if the blast radius cannot be fully known, that is 0.01% doubt (safeguard #3) and the
  right move is to say so, not to ship and hope.
- **Zero bugs before push.** The verification gate (safeguard #5) is the
  floor, not a nicety: `tsc --noEmit` + `tsc -p tsconfig.server.json` (if
  server touched) + `vitest run` (read the real pass/fail line) + boot/smoke
  check for server changes. Green or it doesn't get pushed.
- **NO fake success messages, ever.** Never tell the user something is live,
  built, deployed, or passing unless it verifiably is. "Preview is EARNED" —
  generation alone is not success; report honest PASS/FAIL.
- **Commit + push every green milestone.** Don't batch a day of work into one
  risky push (see safeguard #4).
- **Keep `PROGRESS.md` updated, append-only.** After each meaningful unit of
  work, add a new dated milestone entry — **never delete or rewrite existing
  entries** (they're the cross-session audit trail). Correct a stale claim by
  adding a new note, not by erasing the old one.
- **Every change goes branch → commit → push → CI green → merge.** Merge
  is what deploys (see Deployment above), so never merge red or unverified.
  **CRITICAL — CI must be green BEFORE merging, no exceptions:**
  Even when `git push origin main` direct-merge permission is granted, the
  correct flow is ALWAYS: push the feature branch → wait for CI to pass on
  that branch → THEN merge to main. "Direct push permission" means you may
  use `git push origin main` for the merge step, NOT that the CI gate is
  skipped. Never merge a branch to main until you have confirmed
  `.github/workflows/ci.yml` is green on that branch. Merging red CI to
  main breaks the live app for all users.

## 🕓 SCALE PLAN — for MILLIONS of users. ⛔ **DO NOT BUILD ANY OF THIS NOW** (admin-mandated 2026-08-23)

**Read this whole heading before touching anything below it.** The admin asked, on 2026-08-23, what
happens when millions of users arrive and the server slows down or hangs — and asked for the plan to be
**written down and deliberately postponed** until NavBharatAI has the revenue to pay for it. So this is a
**map for later**, not a task list. Every item here costs real money every month, forever, whether or not
anyone is using the platform.

**The rule for any future session: do not start a single item in this section on your own initiative.**
Each one has a written TRIGGER — a real, observable condition. If the trigger has not fired, the correct
action is to do nothing and say so. Building capacity nobody needs yet is how a small product acquires a
big product's bills.

### The honest starting point: Cloud Run already scales, so "the server hangs" is NOT what breaks first

This matters, because the intuitive fear points at the wrong thing. Cloud Run **already** starts more
instances under load — that half is solved and costs nothing to keep. What does not scale is everything
that assumes there is only ONE of us. Those are listed below **in the order they will actually bite**,
which is not the order they look scary.

### 1 · 🔴 Firestore hot documents — the first thing that will break, and partly our own doing

Firestore allows roughly **one sustained write per second to a single document**. Past that, writes queue
and then fail with contention errors. Anywhere the platform writes ONE document on behalf of ALL users is
a wall with a specific, low number on it.

**We built one of these on 2026-08-23 and it should be named honestly here rather than discovered later:**
`metricsTimeline` writes every instance's counters into ONE document per 5-minute bucket. At today's
traffic that is a few writes a minute and completely fine — the flush is batched to once per minute per
instance, which is exactly what keeps it under the limit. But at **60+ concurrent instances** the same
design becomes a contention point, and the failure would be silent: the flush swallows its error and
retries, so the Monitor would quietly under-count instead of breaking.

Same shape, same risk, for `monitor_alert_state` (one document, transactional) — lower volume, so it bites
much later.

**The fix when the trigger fires (sharded counters):** write to `bucket_<t>_shard_<0..N>` chosen at random
per instance, and SUM the shards on read. This is the standard Firestore answer, needs no new
infrastructure and no monthly cost — which is why it is the *first* thing to do here and not a
"when we have money" item at all.

**TRIGGER:** sustained concurrent instances above ~30, OR any Firestore contention error in the logs.

### 2 · 🟡 Per-instance memory that pretends to be global

Several things live in one instance's RAM and are therefore wrong the moment there are several:

| What | Today's consequence | Why it is survivable now |
|---|---|---|
| `MetricsRegistry` (since-boot totals) | each instance reports its own | the Monitor's timeline is Firestore-backed and correct; the registry is labelled "since this server started" |
| `E2BActuator._activeBuilds` | the idle reaper only sees its own instance's builds | the reaper reads the DURABLE record for the cross-instance decision |
| Rate limiters | a user gets N requests **per instance**, not overall | the real spend gate is the wallet, which is in Firestore |
| `serverLoad` | one instance's CPU/memory | the panel says so, in words, on the panel |

**This is the "unified memory" the admin asked about.** The real answer is a **shared cache/state layer
(Redis / Cloud Memorystore)** so every instance reads one truth.

⚠️ **Redis was EXPLICITLY DECLINED by the admin previously** (`ROADMAP.md` §5 lists it under "explicitly
declined: Redis / Terraform / Cloud Armor / SIEM"). This entry does **not** reopen that decision. It
records what would change if it were ever revisited, and the honest cost: Memorystore's smallest instance
is a standing **monthly** bill regardless of traffic, plus a new dependency that can itself fail and take
the platform with it — a single point of failure where today there is none.

**TRIGGER:** a real user-visible problem caused by per-instance state — most likely a rate limiter that
lets through N× the intended traffic, or duplicated work across instances. **Not before.**

### 3 · 🟡 The publish ceiling — already known, already has a plan

Every published app takes one Firebase Hosting channel, and channels are finite per site. `ROADMAP.md`
§10.3 holds the full plan (serve published apps from Cloud Storage through the Cloudflare Worker we
already run). **This one has a real trigger that may fire long before "millions":** the admin's Publish
Capacity panel reaching *warn*. It is in this section only so the scale picture is complete — its plan
lives in the roadmap, not here.

### 4 · 🟢 E2B sandbox concurrency — a COST wall, not a server wall

Builds do not run on our server; they run on E2B VMs. So a flood of builds does not hang Cloud Run — it
produces a bill and, past the account's concurrency limit, a queue. The idle reaper and the 5-minute idle
default are what keep this bounded, and they already work.

**TRIGGER:** users waiting in a build queue, or the E2B bill rising faster than revenue. The response is
commercial (a bigger plan, a warm pool) rather than architectural.

### 5 · 🟢 Provider rate limits — already handled, do not rebuild

The 429-storm path already has a proactive pacer, adaptive concurrency, a circuit breaker, key-pool
rotation and a graduated model ladder. At scale this needs more KEYS, not more code.

### What "strong servers + multiple servers" would actually mean, in order

1. **Shard the hot Firestore documents** (free, no new infrastructure) ← the only item here worth doing early
2. **Raise Cloud Run's max instances and set min-instances above 0** (a settings change; min-instances costs money continuously, and buys away cold starts)
3. **Move the per-instance state that genuinely needs to be shared** into a shared layer — and only the parts that need it, not everything
4. **Split the workload** so a slow build path cannot starve fast chat requests (separate Cloud Run services, one image, different concurrency settings)
5. **A read replica / caching layer for Firestore reads**, if reads rather than writes become the wall

Steps 1 and 2 are cheap and reversible. Steps 3–5 are the ones that cost money every month, and the
honest advice is that **NavBharatAI does not need them until users are actually waiting.**

### The measurement that decides all of it — and it already exists

The Monitor's **Server load** panel (waiting time, CPU, memory against the container's real limit,
requests in flight) is what tells the admin any of these triggers has fired. **The correct posture until
one does is to watch that panel and build nothing.** A session that proposes work from this section
without naming which trigger fired is proposing a bill, not an improvement.

## App Self-Awareness — AppKnowledgeBase sync rule (mandatory, Phase 21+)

`src/server/AppContext/AppKnowledgeBase.ts` is the single source of truth for
what NavBharatAI can do. **Every AI in NavBharatAI** (Free Chat, Pro Chat,
Engineer AI, Doctor AI, and any future AI) reads this to answer "where is X?",
"how do I Y?", and "what can you do?" with exact navigation paths — not guesses.

**THE RULE (no exceptions):** Whenever any new user-facing feature, screen,
button, setting, or navigation path is added to NavBharatAI — add the
corresponding entry to `AppKnowledgeBase.ts` in the same PR, in the same commit.
This is not optional cleanup; it IS part of the definition of "done" for every
user-facing feature. A feature not listed in `AppKnowledgeBase.ts` is invisible
to every AI in NavBharatAI.

What MUST get an entry (add proactively, not after the fact):
- A new page, route, or screen (e.g. a new Settings tab)
- A new top-level feature (e.g. a new AI mode, a new Engineer AI action)
- A new capability of an existing AI (e.g. Engineer AI can now do X → update its entry)
- A new setting or option that users interact with directly
- A new navigation path, button, or menu item that changes what the app does
- Any new AI assistant added under Professionals

What does NOT need an entry:
- Internal refactors, bug fixes, build pipeline changes
- Performance improvements with no user-visible surface change
- Changes to AI prompts, router priority, or backend infrastructure

The `AppFeature` interface requires: `id`, `name`, `path`, `description`,
`howToUse`, `relatedFeatures`, `keywords`, and optionally `aiSurface`.
- `path` must be exact navigation steps (e.g. "Settings → App Settings → Database")
- `description` should list specific sub-capabilities, not just a vague sentence
- `keywords` must include the words a user would ACTUALLY TYPE when asking about it
  (include English AND common Hindi/Hinglish forms)
- `aiSurface` must be set for entries owned by a specific AI
  ('engineer_ai', 'sda_chat', 'pro_chat', 'nbi_chat')
