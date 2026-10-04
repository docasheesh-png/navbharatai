# Change Intelligence Engine — design and phased plan

Status: **slices 1–7 built** (2026-10-04). Slice 1 is PR #3477; the rest are stacked PRs.
Owner of the idea: the admin's request of 2026-10-04 to bring spec-driven editing to NavBharatAI.
It was studied against GitHub Spec Kit (commit `ae5ade7`) and **adapted, not copied**.

## 1. The problem, measured against the code

An edit to an existing app had no memory of what the app was supposed to do. Every check that compares
the app with "what was asked" reads only the **current** prompt:

- `requestedFeatureLabels(prompt)` tells the builder what to build.
- `checkFeaturePresence(milestoneRequest ?? prompt, …)` grades the running app.
- `currentRequestForCoverage` returns only the **last** request, on purpose. Report 1682cd03 showed
  that re-grading the whole first-build spec on a micro edit produced false findings.

That fix was correct, but it removed the only whole-app check. **An edit that removed a working Delete
button was graded only against "make the header blue", passed, and the user found the loss themselves.**

The same audit found several dead ends:

- `recordDebt` writes security findings on every build, and nothing ever reads them back.
- `engineeringMemoryDigest` has no caller.
- `workspace_traceability` has no producer.
- `PlanIntelligence.analyzePlan` has no caller.
- Each repair pass builds its own one-off prompt, and no list of problems survives from one build to
  the next.

## 2. What Spec Kit got right, and what we took

| Spec Kit idea | Taken? | NavBharatAI form |
|---|---|---|
| Stable requirement IDs (FR-001) that tasks and tests point at | ✅ | `REQ-001`, never reused or renumbered (`appSpec.ts`) |
| **Converge**: distrust completion claims; find missing / partial / contradicting work | ✅, made stronger | Judged against **runtime evidence** (a real browser probe), not by reading code. Statuses are moved only by evidence. |
| Bug triad (assess → fix → test, and "verified" only if the repro ran) | ✅ | Issue lifecycle: FIXED needs a build whose checks ran; VERIFIED needs two such builds |
| Append-only artifacts | ✅ | Change records are append-only (bounded); the ledger keeps dropped items with their ids |
| Analyze: read-only consistency pass with severities | Partly | Severity on issues; a full spec-vs-plan pass is slice 5 |
| Human gates between phases, slash commands, a user-written constitution, files in the repo | ❌ | The user never sees phases. Memory is server-side (see §4). Our "constitution" is the platform's own rules, not user text. |
| Converge with no iteration cap | ❌ | Every repair here is bounded. The engine records; existing bounded heals repair. |

## 3. The pipeline, adapted to how NavBharatAI actually runs

```
request ─► intent (IntentClassifier, unchanged)
        ─► CHANGE CLASSIFICATION  (changeClassifier.ts)       micro-ui … architectural / large → light | standard | deep
        ─► PROJECT UNDERSTANDING  (buildProjectContext, unchanged) + REQUIREMENT LEDGER + OPEN ISSUES (by depth)
        ─► plan / tasks / implement / build / test (existing engine, unchanged)
        ─► VERIFY  (existing real-browser probe)  + REGRESSION RE-PROBE of every requirement seen working before
        ─► CONVERGE (existing bounded heals; FEATURE_REGRESSED is now a finding they can act on — slice 2)
        ─► RECORD  one transaction: ledger + issue queue + CHG record
```

The depth decides **how much the builder is shown**. It does not decide which model runs; the ladder
and the router are unchanged.

| Depth | When | The builder sees |
|---|---|---|
| light | micro visual change | one line: N requirements on record, keep them working |
| standard | local change, feature, bug, refactor | the requirement list + the open issues |
| deep | cross-cutting, data, integration, security, architectural, large | the above + "name which requirements you touch, keep each working" |

When the signals disagree, the **higher risk wins**. Calling a cross-cutting change micro loses features;
calling a micro change deep costs a few hundred prompt tokens.

## 4. Where the memory lives, and why not in the user's app

The memory is one server-side Firestore document per workspace: `app_engineering_memory_v1/{workspaceId}`.
It holds the ledger, the issue queue and the last 60 change records, all with fixed caps.

A `.navbharat/` folder inside the app was rejected for five reasons verified in the code:

1. GitHub sync runs `git add -A --force` and would push the folder into the user's repo.
2. Green Freeze refuses writes to it after the latch, and most of the evidence arrives after the latch.
3. The model's tools, Code Studio and an imported repo can all forge or delete it. An imported repo
   could ship a fake ledger, which would be a prompt-injection channel straight into orchestration.
4. The dev server would serve it on the public preview URL.
5. Every scanner would read it as app code.

`workspace_memory_v3` was rejected because it replaces its whole document on save and keeps 100 episodes.
Requirements written there would be evicted by an ordinary busy build.

## 5. Security and white-label rules this engine obeys

- **User app code and builder memory never mix.** The memory is outside the app's files and is read only
  by the platform.
- **Stored text is platform-authored, except one field.** Requirement labels come from our feature table
  and issue messages from our own checks. Both are redacted of secrets and provider names.
- **The one user-derived field is `summary`.** It is a 160-character digest of the request, redacted of
  secrets, PII and provider names.
- **Issue text reaches the builder fenced.** It can quote the app's own labels, so it goes through
  `fenceUntrusted`, and the block is framed as subordinate to the current request.
- **The block goes into the per-turn message,** never the cached system prefix.
- **Only app findings enter the queue** (`isAppFinding`). Provider and sandbox findings never do, so
  vendor names cannot reach a user-visible list.
- **Erasure:** the collection is in `WORKSPACE_SCOPED_COLLECTIONS`, so deleting an account wipes it.

## 6. Slice 1 — shipped in this PR

- `changeEngine/changeClassifier.ts`: the classification, which is pure and costs ₹0.
- `changeEngine/appSpec.ts`: the requirement ledger.
  - An item is verified only by a **control** a real browser saw; prose never verifies anything.
  - A missing item counts as a regression only if it was verified before.
  - A new build in a reused workspace retires the old app's requirements, so they cannot produce false
    regressions.
- `FeaturePresence.probeFeatures` and `requestedProbeFeatures`: the regression probe.
  - It reuses the same feature table and the same guards (unrendered shell, control-backed corroboration,
    sign-in wall).
  - `checkFeaturePresence` now selects its features through `requestedProbeFeatures`, so what is recorded
    and what is graded cannot drift apart.
- `changeEngine/issueQueue.ts`: the issue lifecycle DETECTED → TRIAGED → ASSIGNED → FIXED → VERIFIED.
  - FIXED and VERIFIED require a build that reached its release gate without being stopped.
  - A recurrence reopens the issue.
  - Numbers are normalised, so "3 unlabelled" and "4 unlabelled" are one issue.
- `changeEngine/changeLog.ts`: the CHG records and the memory document.
- `changeEngine/engineeringMemoryStore.ts`: transactional read-modify-write, an in-process cache, and the
  kill switch `AGENTV3_CHANGE_ENGINE=off`.
- `changeEngine/changeSession.ts`: three hooks the route calls (`beginChange` → `observeProbes` →
  `settleChange`).
- New report codes:
  - `CHANGE_CLASSIFIED` and `CHANGE_RECORDED`: info, admin-only.
  - `FEATURE_REGRESSED`: a warning about the app.

**What slice 1 does NOT do, plainly:**

- A regression is **reported, not repaired**. It enters the issue queue and the next edit's context, but
  no heal pass acts on it in the same build. That waits until real reports show the regression probe has
  no false positives (slice 2).
- Only the nine probe-able features (add, delete, edit, complete, filter, search, list, auth, theme) can be
  verified. Requirements outside that table are not in the ledger yet (slice 3).

## 7. Slices 2–7 — all built 2026-10-04 (admin: "sara kaam karo")

Each slice is its own branch and PR, stacked in order (`claude/change-engine-slice1` … `slice7`).

| Slice | What was built | What it deliberately does NOT do |
|---|---|---|
| 2 | A regressed feature joins the EXISTING feature heal: same runner, same `verifyAfterFix` net, same `AGENTV3_FEATURE_HEAL` cohort gate. The prompt says *restore, do not redesign*. Codes `FEATURE_REGRESSION_HEALED` / `FEATURE_REGRESSED`. | Spend outside the heal cohort. The regression probe's false-positive rate is unmeasured; the admin chose to ship first. |
| 3 | The contract labels (named + ticked features) join the ledger as non-probe-able requirements, marked `built` only by a build that passed its release gate GREEN. | Call one *verified* or *regressed*: no runtime check exists for them. |
| 4 | Impact set: files the request names (by file-name words) plus the conventional files of its change kind, and every file that imports them (`codeGraph.impactOf`). Given to standard/deep edits, fenced as data. | Restrict what the builder may change. A request naming nothing yields nothing; a request matching half the app also yields nothing. |
| 5 | A deliberate removal ("remove the delete button", "search bar hata do") is read against the request, passed as DECLINED to all four coverage probes and to the ledger, so it is dropped and never healed back. This closed a pre-existing defect: "remove" is the delete probe's own keyword. | Ask the user a question: no consequential ambiguity was found that needed one. `PlanIntelligence.analyzePlan` was not reused because it reviews a plan-mode todo list, not an edit. |
| 6 | Security findings (high/medium) enter the issue queue, redacted. A security issue clears only if this build actually analysed its file. | Retire `techDebt` or `workspace_traceability`: they have other readers (the techDebt GET, the traceability POST), and replacing them is a separate decision. |
| 7 | **User-visible:** the History tab's "What your app does" card shows each requirement's real status, the open problems and the change log, in plain words. Strict owner read, white-labelled by construction. AppKnowledgeBase entry added. | Expose codes, vendors or model ids. |

## 8. What to watch after merge

- `FEATURE_REGRESSED` on edit builds. A false one means a working app was flagged. Inside the heal cohort, it also means a repair pass was spent.
- `FEATURE_REGRESSION_HEALED`: a lost feature restored.
- `CHANGE_CLASSIFIED`: whether the light/standard/deep split matches reality.
- The "What your app does" card on real apps: whether its statuses match what the user sees.
