# NavBharatAI — Session Constitution

This file is auto-loaded at the start of every Claude Code session in this
repo. It exists because **more than one Claude account/session works on this
project, sequentially (never at the same time)** — credits run out on one,
work continues later from another account/session. These rules exist to stop
that handoff from breaking the app or wasting work. They rarely change; the
living, constantly-updated status (current phase, exact resume point, what's
done) lives in `PROGRESS.md`, not here.

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

## The 7 safeguards (mandatory, every session)

1. **Fresh-state check before trusting any doc.** At the start of every
   session: `git fetch origin main` + `git log --oneline -10` (and check open
   PRs) BEFORE believing what `PROGRESS.md` claims is done. `PROGRESS.md` can
   go stale the moment another session pushes after it was written — this
   happened for real (PR #1 and PR #4 were redundant work built blind on a
   stale picture of `main`). Treat the actual git state as ground truth;
   treat the doc as a hint.

2. **Phase-level lock + exact resume point.** Don't start, redo, or
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

6. **Redundant-work check before starting anything new.** Before building a
   new feature or fix, grep/search the current `main` to confirm it doesn't
   already exist. This is not optional housekeeping — it is what would have
   prevented PR #1 and PR #4 from being built at all.

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

## The autonomous phase cycle (mandatory — how every roadmap phase ships)

**Claude owns the ENTIRE ship cycle for each phase/batch, end to end — including the
merge.** Do NOT stop after opening a PR and hand it to the admin to merge. Drive the
whole loop yourself, autonomously, and immediately start the next phase. This is the
default working mode for all roadmap/march work and it repeats forever until the admin
says stop (or a phase is genuinely blocked — see safeguard #3).

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

## Core engineering rules (copied up from PROGRESS.md so they're never missed)

These were previously only stated inside `PROGRESS.md`. Because that file is
not auto-loaded, they were easy to miss — they are mirrored here so every
session sees them. They reinforce the one absolute rule (the app must never
break):

- **Real, no hacks.** Build the real thing — no fake success, no stubbed
  "it works" when it doesn't, no placeholder/TODO shortcuts shipped as done.
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
