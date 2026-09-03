# NavBharatAI — Session Constitution

This file is auto-loaded at the start of every Claude Code session in this
repo. It exists because **more than one Claude account/session works on this
project, sequentially (never at the same time)** — credits run out on one,
work continues later from another account/session. These rules exist to stop
that handoff from breaking the app or wasting work. They rarely change; the
living, constantly-updated status (current phase, exact resume point, what's
done) lives in `PROGRESS.md`, not here.

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
- **📊 WHAT E2B ACTUALLY COSTS — measured, not estimated (admin's own dashboard, 2026-08-11).** The
  knobs above are worth real money, so here is the money. Billing window Jul 14 – Aug 13 2026 (30 days),
  read off the E2B usage dashboard: **1,260 sandboxes started/resumed · 2,078.29 vCPU-hours ·
  4,156.57 RAM-hours · $172.08 total**.
  - **A running sandbox costs ~$0.083/hour (~₹7).** Derived: $172.08 ÷ 2,078.29 vCPU-hours. RAM-hours ÷
    vCPU-hours is **exactly 2.0**, so every sandbox is **1 vCPU + 2 GB**, and $0.083 matches E2B's
    published per-vCPU + per-GB rates almost to the cent — which is what makes this a measurement rather
    than a guess.
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
  the admin's *real* rate ($0.083/hr, which is exactly the measured rate from the E2B cost analysis above),
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
- **Live daily-life data for the chat AIs (added 2026-08-25):** `RAPIDAPI_KEY` (✅ **SET in Cloud Run by
  the admin 2026-08-25** — ONE RapidAPI key covering the subscribed marketplace APIs: IRCTC
  (`irctc1.p.rapidapi.com`, live train running status + PNR) and AeroDataBox (flight status); the admin
  also subscribed an IMDb API the same day, whose exact host is pending a screenshot before it is wired —
  do NOT guess the host, several APIs share the name. Read by `src/server/lib/transitLive.ts`; without the
  key every path honestly degrades to web search, never an invented "live" answer). Companion keys, NOT
  set yet: `BRAVE_API_KEY` (search-quality upgrade over the DuckDuckGo fallback, read by
  `AgentV3/WebSearch.ts`), `TMDB_API_KEY` (movies-now-playing source in `lib/liveDataSources.ts` — may be
  superseded by the admin's IMDb API once its host is known). Key-free live sources (weather/AQI/currency/
  PIN codes) need no env at all. ⚠️ Open licensing item recorded in PROGRESS.md 2026-08-25: the no-key
  weather source (Open-Meteo) is licensed non-commercial — license or swap it before heavy real traffic.
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
    flagship in front would invert the free tier's cost model). ⚠️ **Set `RATE_KIMI3_IN`/`_OUT`/`_CACHE`
    to K3's real published price** — `providerRates.ts` defaults them to the k2.7 rate because K3's price
    is not verifiable here, which UNDER-states our real cost if K3 is pricier (margin risk, never a user
    over-charge). Kimi ids (from platform.kimi.ai/docs/models):
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
  `AGENTV3_PER_TIER_BILLING`. `WELCOME_BONUS_TOKENS` (default 50000) tunes the new-wallet bonus.
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
- **`AGENTV3_JOURNEY_CHECK`** (default ON, set `off` to disable) — after a successful build with a live
  preview, derives a real user journey from the app's OWN markup and runs it in the sandbox's pre-baked
  browser: fill the form, submit, **reload, and check the item is still there**. That last step is the
  only thing that separates an app which really saves data from one that only looks like it does. Every
  selector is read out of the source, never guessed; a form it cannot address honestly yields NO journey.
  A journey against a USER-OWNED database is downgraded to a non-writing submit — we do not put test rows
  in somebody's real Supabase. Evidence, never a gate. Codes: `JOURNEY_PASSED` / `JOURNEY_FAILED` /
  `JOURNEY_NOT_DERIVED`.

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

## Play Store release — build a signed `.aab` on every roadmap/checkpoint completion (mandatory, admin-mandated 2026-07-10)

**NavBharatAI is now LIVE on the Google Play Store** (Android app package `com.navbharat.ai`,
a Capacitor shell). ⚠️ **BUNDLED MODE, not a remote wrapper** (corrected 2026-08-11 — this line
previously said "loads the hosted web app", which has been WRONG since the 2026-07-10 switch and would
mislead any session into thinking frontend fixes reach app users automatically). `capacitor.config.ts`
sets `webDir: 'dist'` with **no `server.url`**, so the app boots from its own bundled assets.
**What this means in practice:** a SERVER/backend change reaches installed app users immediately (API
calls are rewritten to the production origin by `src/lib/apiBase.ts`), but a FRONTEND change does NOT —
it is baked into `dist/` and needs a fresh signed `.aab`/`.ipa`. Locked by
`tests/nativeShellInvariants.test.ts`. Because of that, the store build must track
our progress: **whenever a roadmap phase completes, or any big checkpoint/milestone ships to
`main`, Claude MUST build a fresh signed Android App Bundle (`.aab`) so a current, uploadable
release is always ready for Play Console.** This is part of "done" for a phase/checkpoint, the
same way a green Cloud Run deploy is — it is not optional cleanup.

**What counts as a trigger (use judgement — do NOT over-build):**
- ✅ A roadmap **phase/Tier** completes, or a named milestone (a cluster of merged PRs that forms
  one shippable increment), or the admin explicitly asks for a build.
- ✅ **STANDING INSTRUCTION (admin 2026-08-24, verbatim: "jab jab mai bolu to aab aur ipa bana
  dena"): whenever the admin asks, build BOTH — the Android `.aab` AND the iOS `.ipa`, together.**
  Not one or the other, and no waiting for a phase boundary: their word IS the trigger. Both
  workflows are dispatched (`android-aab.yml` and `ios-ipa.yml`, ref `main`), both are polled to
  green in the background, and both run URLs are reported back. ⚠️ Build from **`main`**, after the
  work is merged — an `.aab` cut from a feature branch is not the app anyone is shipping. And per
  the BUNDLED-MODE note above, a FRONTEND change reaches installed users ONLY through a fresh
  bundle, which is precisely why this instruction exists.
- ❌ NOT every individual small PR. Each `.aab` run consumes CI and burns a Play `versionCode`
  (it auto-increments per run), so batch to phase/checkpoint boundaries, not micro-commits.

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
- ⛔ **ORGANIZATION DEVELOPER ACCOUNT (D-U-N-S) — DEFERRED, do NOT start it (admin 2026-08-26: "yeh baad
  me karenge jab user badhenge").** The full, verified conversion guide lives in `MOBILE_PUBLISHING.md` §10
  — including the finding that the EXISTING account converts in place (no new account, no app transfer),
  the four easy-to-miss traps, and the fact that this is the ONLY thing that brings Doctor AI, Pharmacist,
  First Aid and Maternity back to the Play app. §10.6 records the separate (also deferred) HPR/ABDM
  doctor-verification plan. A session must not begin either without the admin asking.
- Claude CANNOT set/rotate the signing keystore secrets (`ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) — that is a one-time
  admin setup (documented in the workflow header); the keystore is the app's permanent identity
  and must live only with the admin. If a secret is missing the workflow FAILS EARLY with an
  honest message — **never** hand back or fake an unsigned bundle (Play would reject it anyway).
- Claude CANNOT download the artifact or upload to Play Console. After the run is green, the
  **admin** downloads `app-release.aab` and uploads it to Play Console (Play App Signing handles
  the final signing). Automating the Play upload (a Play service-account + `r0adz0/upload-google-play`
  step) is a future infra item — until it exists, the upload is the admin's manual step.
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
