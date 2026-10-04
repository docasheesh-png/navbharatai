# Change Intelligence Engine — design and phased plan

Status: **slice 1 shipped** (this PR). Slices 2–6 are planned below and not built yet.
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

## 7. The plan for the remaining slices (not built)

| Slice | What | Trigger to start |
|---|---|---|
| 2 | Feed `FEATURE_REGRESSED` into the existing feature-heal runner under `verifyAfterFix`, with no new repair engine | Slice 1 has run on real builds and FEATURE_REGRESSED has shown no false positives |
| 3 | Requirements beyond the probe table: accept `RequirementCoverage` labels and confirmed feature-card items as ledger items with status `requested`, verified by journeys (`JOURNEY_PASSED`) | After 2 |
| 4 | Deterministic impact set from `codeGraph.impactOf` for standard/deep changes: list the files and requirements a change will touch, before implementation | After 1 has data on how often deep changes regress |
| 5 | A consistency pass on deep changes: run the dead `PlanIntelligence.analyzePlan` against the ledger before implementation; at most ONE question on a genuinely consequential ambiguity, with a recommended default | After 4 |
| 6 | Fold `techDebt` into the issue queue and give `workspace_traceability` its producer (REQ → file → test → evidence), then retire the duplicates | After 3 |

Every slice reuses an existing system named in the audit's do-not-duplicate list, and none of them adds a
planner or a repair engine of its own.
