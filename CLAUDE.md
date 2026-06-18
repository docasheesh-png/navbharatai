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
