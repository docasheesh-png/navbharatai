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

⛔ **NO FAKE BUTTON, NO FAKE FEATURE — the same rule applied to the apps NavBharatAI BUILDS (admin-mandated
2026-10-04, unbreakable).** A login, Google/Apple button, payment, OTP or email in a built app is REAL (the
user's own provider, its keys asked for) or it is marked on the app's own screen, in RED, in the user's
language, as a demo — naming the key and `⋮ More → Keys & Secrets`. Enforced by `fakeFeatureScan.ts`
(shape, not words) + `NO_FAKE_FEATURE_RULE` in every lane; the entry for `AGENTV3_NO_FAKE_FEATURES` in
`docs/claude/ENV_REGISTRY.md` has the whole design. A seeded demo account is never the app's login.

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

### 🧬 EVERY PROBLEM IN EVERY REPORT, FIXED AT THE ROOT, SIBLINGS INCLUDED — so it never comes back (admin-mandated 2026-09-30)

Admin, verbatim: *"jab bhi koi autopsy ki jaye, kisi build report ki ya koi aur report ki — identify ki huyi
sabhi, choti badi problem ka root cause dhund ke DNA level par fix karni hai. same (with siblings) problem
wapas na mile!!!!"*

- **Any report, not only a build report.** The admin's build report, a diagnostics report, the Monitor, a
  scorecard, a screenshot, a user complaint, a CI failure, a Play/App Store rejection — each is an autopsy
  under this rule.
- **Every item it surfaces, small or big.** There is no "too small to root-cause". A one-line wrong label and
  a failed build get the same treatment: the exact origin, the CLASS behind it, and a fix to the class.
- **"Fixed" means the CLASS cannot return — the instance AND every sibling.** Before calling an item done:
  (1) name the class in one sentence; (2) hunt its siblings across the whole repo (other lanes, other
  surfaces, other copies of the same helper — safeguard #6's method, three names, whole repo); (3) fix every
  sibling found in the same change; (4) lock it with a test that encodes the CLASS, not the instance — a
  census or source guard that fails when a NEW sibling appears, proven by reversion (put the bug back, watch
  the test fail).
- **Check whether it has come back before.** Search `PROGRESS.md` and this file for the same class. If an
  earlier autopsy "fixed" it, that fix was incomplete — say so plainly in the reply, and fix what the earlier
  one missed (most often: a sibling lane it never hunted).
- **Close every autopsy with one ledger row per item:** problem → root cause → class → siblings found and
  fixed → the test that locks it. An item that genuinely cannot be fixed now is recorded in `PROGRESS.md` as
  an OPEN root cause with what it needs (rule 6) — never left silent, never counted as done.

### 📚 Product policies and autopsy precedents → `docs/claude/PRODUCT_POLICY_PRECEDENTS.md`

Moved out verbatim on 2026-10-04 to shrink this file. The rules there are still binding. The short form:
- **Pornography is banned** (`ILLEGAL_RULES.ADULT_CONTENT` → `block`, via `triagePrompt` on build, chat and image). A refusal is final: never retried, never upsold. Detection stays precision-first. Image prompts also pass `pollinationsGuard.ts`.
- **Read the mood first:** a question gets an answer, not an app. A new build goes ahead only when the message confirms it (`buildConfirmation.ts`).
- **Zero files is not "nothing happened":** a verified verdict turn can succeed without a diff, but only with real browser evidence.
- **A fact about a provider call is never a fact about the app:** provider-phase issues never count as app blockers; the platform proves the preview itself (`deliveryProof.ts`).
- **A server body is not the answer until it is checked:** `res.ok` plus a shape check at the one place it enters state.

Read that file before touching triage, intent, delivery verdicts, preview proof or a client that stores a server body.

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

## The sixth absolute rule: ZERO UNRESOLVED — a build report is a contract, and every item in it ends in a recorded state (admin-mandated 2026-10-01)

Admin, verbatim: *"claude md me bhi yahi likh do! aur accha kar ke! yeh chatgpt ka external suggestion hai.
aap isko improv kar ke claude.md me likho!! strict rule"*. The text below is that suggestion ADAPTED under the
external-suggestion rule — kept where it fits this repo, sharpened where it was vague, corrected where it would
have collided with the absolute rules above. **The fifth rule's 2026-09-30 section says HOW each item is fixed
(root, class, siblings, a test that locks the class). This rule says that EVERY item gets there — none dropped,
none forgotten between sessions, none called done before it is.**

🔴 **WHY IT WAS NEEDED, IN THIS SESSION'S OWN WORDS (autopsy 6461025c, 2026-10-01).** The first reply to that
report fixed five root causes and listed four items as "still open" in a footnote. The admin had to ask *"sab
root cause fix huye?"* before two more were fixed — and the honest answer to the question was "no". A list of
"still open" items at the bottom of a reply is exactly how an item disappears: nothing owns it, the next report
arrives, and it is never seen again.

### The contract

1. **Every actionable item gets an ID and a row.** Actionable = every line of the report at warning or error
   severity, every item in the fifth rule's five buckets (✅ self-heal, 🔀 workaround, ⏭️ skip, ❌ shipped
   broken, 🥵 struggle), every false finding (a lying analyzer is a defect — fixing the analyzer resolves it),
   and every defect DISCOVERED while working the report even if the report never showed it (the #3426 bullet
   bug found while merging #3427 is one). Same root cause behind several items ⇒ one fix, but every item still
   gets its own row pointing at it, so the count can be checked.
2. **There are exactly two final states.**
   - ✅ **RESOLVED** — root cause fixed at the class, siblings hunted, locked by a test proven by reversion
     (put the bug back, watch it fail), full CI-equivalent gate green on the final merged state. Where the real
     input exists (a prompt, a log line), the test uses it — a fixture of the real report beats a paraphrase.
     A fix whose live effect is only visible on the next real build says what to watch for, in the row.
   - 🟡 **BLOCKED — REQUIRES ACTION** — with all four: *what* is blocked, *why* (one of: external service or
     limit, missing information such as a truncated report, infrastructure/console only the admin can reach,
     a decision that is the admin's — money, policy, user-visible behaviour, irreversibility — or a fix whose
     only available form risks breaking a working app), *what is required* to unblock it, and *what was
     already tried*. A decision-blocked item comes with the options and a recommendation, never a bare question.
   - ❌ **"Still open", "noted", "recorded", "deliberately not fixed", "by design" in a footnote are NOT states.**
     "By design" is a claim — it is either argued with evidence and the admin agrees (then RESOLVED as
     not-a-defect, with the evidence in the row), or it is BLOCKED pending that agreement.
3. **The queue is a FILE, not a memory: `BUILD_REPORT_QUEUE.md`.** A session's context dies; an "internal
   queue" dies with it. Every item that is not ✅ at the end of a turn is a row there: ID, report, problem,
   state, owner (PR number), last action. Rows move to ✅ only when the PR that resolves them is MERGED, and
   are then deleted from the open table (their ledger stays in `PROGRESS.md`). With several live sessions
   (see below), a row carrying another session's PR number is TAKEN — pick another or ask.
4. **No new self-started work while the queue has an actionable row.** Before starting anything — a feature,
   a refactor, the fifth rule's proactive suggestions, an idea of our own — read `BUILD_REPORT_QUEUE.md`. If a
   row is actionable (not BLOCKED), it comes first. **The admin's explicit instruction overrides the order,
   never the queue:** an admin task runs when asked, the queue stays exactly as it was, and the turn after
   that task returns to it. A BLOCKED row is re-checked whenever its blocker could have changed (a new report
   arrives, the admin sets a key, a PR lands).
5. **Completion words are earned.** "Done", "fixed", "complete", "ready", "sab theek ho gaya" may be said about
   a report only when every one of its rows is ✅ or 🟡 with all four fields. Anything else is reported as
   **NOT COMPLETE**, naming the remaining IDs. This is the third absolute rule (honesty) applied to progress:
   the admin's question *"sab fix huye?"* must never be needed to discover the truth.

### What was ADAPTED from the external text, and why (so nobody "restores" the original)

- **"Fix 20/20, no exceptions" is bounded by the first absolute rule.** A fix that can only be made by risking
  a working app (6461025c: forcing `@types/express` back to v4 under a codebase that typechecked clean on v5)
  is not made silently and not dropped silently — it is 🟡 BLOCKED with the risk named and the safe options
  laid out. Never-break outranks fix-everything; both outrank silence.
- **"No unnecessary retries / fallbacks" means none used to HIDE a deterministic failure** (the fourth rule's
  forbidden list). It does NOT ban the engine's own designed resilience — the tier ladder, the 429 bench, the
  render rescue are the product, not patches.
- **"Never start new work"** applies to work WE choose. The admin's explicit order always runs; the queue is
  preserved, not abandoned (point 4).
- **"Remaining: 0" is only true with evidence.** A test that passed is evidence; "I believe it is fixed" is not.
  A report that was truncated (e.g. "kept 40 of 42 commands") is recorded as such, and any item whose cause
  lies in the missing part is BLOCKED on a fuller report, not guessed.
- **The final report goes to the admin in their language and in plain words**, not as a code-formatted form.

### The closing report for every build report (required, every time)

```
BUILD REPORT <id> — RESOLUTION
Items: N · ✅ Resolved: R · 🟡 Blocked: B · Remaining: N − R − B
Q-xxx ✅ <problem> — root cause · fix (PR) · proof (test, reverted-and-failed)
Q-yyy 🟡 <problem> — blocked because · needs · already tried
FINAL: ✅ COMPLETE (Remaining = 0)   or   ❌ NOT COMPLETE — remaining: Q-…, Q-…
```

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
- **`BUILD_REPORT_QUEUE.md`** — every build-report item not yet ✅, with its state and owner (the sixth
  absolute rule). Read it BEFORE starting any work of our own choosing.
- **`PROGRESS.md`** — living state: current phase, exact resume point, what's
  done, what's next. Changes constantly. Must be read explicitly (not
  auto-loaded) — see safeguard #1, read it but verify it against real git
  state first.
- Never push directly to `main`. Every change goes: branch → commit → push →
  PR. Even documentation-only changes follow this.


**Moved out of this file on 2026-10-04 (verbatim, still binding) — read the one that matches your task:**

| Before you touch… | Read |
|---|---|
| any env key, flag, provider, sandbox, billing/hosting/image/referral/alert setting | `docs/claude/ENV_REGISTRY.md` |
| a model ladder, judge, tier, price, markup, wallet, or vendor-naming text | `docs/claude/ROUTING_AND_BILLING.md` |
| prompt triage, intent / build confirmation, delivery verdicts, preview proof | `docs/claude/PRODUCT_POLICY_PRECEDENTS.md` |
| a store build (`.aab` / `.ipa`) | `docs/claude/RELEASE.md` |
| client colours, themes, inline styles | `docs/claude/THEME_RULES.md` |
| scaling infrastructure | `docs/claude/SCALE_PLAN.md` |

⚠️ **Keep this file short.** It is loaded into every message of every session, so each kilobyte here is paid for on every turn. New registry entries, incident histories and long rationales go in the matching `docs/claude/` file; only a rule every session needs belongs here.

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

## Configured Cloud Run environment keys → `docs/claude/ENV_REGISTRY.md`

The full registry (names only, never values), the 2026-09-12 money audit and the 2026-08-20 Cloud Run audit were moved out verbatim on 2026-10-04. They were 375 KB of this file.

- **Before changing or reasoning about ANY env key, flag, provider, sandbox, billing, hosting, image, referral or alert setting, read its entry there.** Many entries carry standing admin decisions and corrections.
- **When the admin says they set a key in Cloud Run, append its NAME to that file in the same session.** Not here.
- Two facts that must never be forgotten: `FIREBASE_PROJECT_ID` must be `gen-lang-client-0866594388` (never `navbharatai-3395f`); an env value always beats a code default, so a stale or duplicated key silently wins.
- **Any new wallet writer must go through `walletMirror.ts`**, and a free-first ladder's paid rungs must be cheapest-first and metered (the money audit's class).

## ⛔ CLOSED: the inline button-description sweep (admin, 2026-09-12). DO NOT REOPEN.

The admin re-checked the app and closed it: *"is kaam ko band kar do, agar bhi koi agent is par kaam na
kare."* The two descriptions they had marked were already removed (#2828); the rest stay. **This entry
exists only because those strings are still in the code, so the pattern is re-discoverable from any
screen — if a future session thinks ONE description is wrong, it raises that one. It does not restart
the sweep.**

## Play Store / App Store releases → `docs/claude/RELEASE.md`

Build a store bundle **only when the admin asks**, and then build **both** the `.aab` (`android-aab.yml`) and the `.ipa` (`ios-ipa.yml`), from `main`. The apps are BUNDLED: a frontend change reaches phone users only through a fresh bundle; a server change reaches them at once. Four features are hidden on iOS on purpose (see the file). Read that file before building or describing a release.

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

## 🎨 Colour comes from tokens, never from a literal → `docs/claude/THEME_RULES.md`

Colour is named by role (`bg-surface`, `text-ink`, `text-muted`, `border-line`, `text-on-accent`, …), never `text-white` / hex. `tests/themeTokensOnly.test.ts` ratchets the literal count per file and only lets it go down. Three themes only (Light, Dark, High contrast). In an inline style use the `@layer base` variable names (`--accent`, `--text-*`), never `var(--color-…)`. Read that file before writing or migrating any client colour.

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

## Model routing, tiers, billing and the White-Label Law → `docs/claude/ROUTING_AND_BILLING.md`

⚠️ **Confirm with the admin before changing any of it.** The short form:
- **Three tiers, three ladders** (`src/server/AgentV3/tierLadder.ts` is the only source of truth). A build runs exactly its tier's rungs, in order.
- **Weak never runs Sonnet or Opus.** Haiku is its only Claude rung, enforced by three nets (`enforceNoClaude`, `noClaudeZone`, the report detector).
- **Billing:** real provider cost + tiered markup; a failed build is never charged; the markup needs a preview that ran; one wallet for every AI (`THE ONE-WALLET LAW`); a cost is never invented.
- **White-Label Law:** a user never sees a vendor or model name anywhere; provider names are admin-only.

Read that file before changing any ladder, judge, tier, price, markup, wallet path, or user-facing text that could name a vendor.

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
- **An `/api` route nothing in the app calls is decided when its file is next touched (admin 2026-10-05, Q-162).**
  `tests/fixtures/uncalledApiRoutesBaseline.json` lists them; 45 are `undecided`. Touching a route file that has
  one means deciding it in the same PR — give it a screen, name its outside caller (change its reason), or delete
  it — and shrinking the baseline. Never a mass deletion: an old bundled phone app may still call a route.
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

## 🕓 Scale plan → `docs/claude/SCALE_PLAN.md` — ⛔ DO NOT BUILD ANY OF IT NOW

A map for later. Every item has a written trigger; until one fires, build nothing from it.

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
