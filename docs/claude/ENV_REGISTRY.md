# Cloud Run environment keys — NAMES ONLY (registry), plus the money and Cloud Run audits

> Moved verbatim out of `CLAUDE.md` on 2026-10-04 (admin: *"han"* to shrinking it — the file was 563 KB and was loaded into every message of every session). Read the entry for any env key, flag, provider, sandbox, billing or hosting setting before changing or reasoning about it. **When the admin says they set a key, record its name HERE** (not in `CLAUDE.md`). Nothing here was reworded; the rules in it are as binding as they were in `CLAUDE.md`. `CLAUDE.md` keeps a short summary and a pointer to this file.

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
  GLM-429-storm response — key rotation is now genuinely active in prod.
  🔴 **CORRECTED 2026-09-27 — "genuinely active" was true of the BUILD ENGINE ONLY.** The pool parser
  lived inside `routes/agentv3.ts`; the FREE CHAT leader (`GlmProvider`) and the free vision rung
  (`visionChain.tryGlm`) sent the whole comma string as ONE bearer token, so from 2026-07-21 every free
  chat, Professional and Doctor AI turn was refused by Z.ai and fell through to a PAID rung — the admin
  Diagnostics page read *"GLM 8 requests · 8 errors"* and *"0% served by the free model"*, and nothing
  looked broken because the fallback worked. **Every reader of a pooled key now goes through
  `src/server/lib/keyPool.ts`** (`parseKeyPool` / `firstPoolKey` / `nextPoolKey`, round-robin); a new
  reader that passes `process.env.GLM_API_KEY` straight to a client re-opens this. Test-locked and
  reversion-proven in `tests/theDiagnosticsPageToldThreeUntruths.test.ts`.)
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
- **GitHub native sign-in, legacy switch (Q-629, added 2026-10-05):** `GITHUB_NATIVE_LEGACY_TOKEN_RETURN`
  — NOT set; **unset means ON**. While on, an app build from before 2026-08-28 (#2706), which sends the bare
  `nbai-native` state, still gets the GitHub token in the `com.navbharat.ai://github-callback#gh_token=…`
  deep link — the only thing that build can read. Set it to `off` to retire that path once enough users
  run a bundle with the device-nonce flow; old installs then see "Please update the NavBharatAI app to
  connect GitHub." ⚠️ While on, a crafted authorize link with `state=nbai-native` still makes the server
  put a token in a deep link any installed app can claim — the switch, not the app, is the exposure.
  Read by `legacyTokenReturnEnabled()` in `src/server/lib/githubNativeHandoff.ts`; nothing else reads it.
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
- **Scheduled work without an awake server — Cloud Scheduler tick (built 2026-10-05, Q-159, NOT live until set):**
  `SCHEDULER_TICK_SECRET` (16+ random characters). Cloud Scheduler calls `POST https://navbharatai.com/api/internal/scheduler-tick`
  with header `x-scheduler-secret: <the same value>` every 5 minutes; the tick runs every exclusive job (plan sweep and
  renewal reminders, hosting daily bill, image cleanup, outbound rescan, site uptime, retention purge when enabled) that
  is due by the durable `job_runs` record. Unset ⇒ the route answers 503, so a half-done setup shows red in the Cloud
  Scheduler console. The admin's choice over `--min-instances 1` (2026-10-05): it costs nothing while idle.
  ✅ **SET 2026-10-06 — the admin reports `SCHEDULER_TICK_SECRET` set in Cloud Run and the Cloud Scheduler job created**
  ("done"). Name recorded only; the value was never written anywhere in this repo. Not verified from a session (the
  session network cannot reach the live host): the proof is the Cloud Scheduler job's Force run reading Success —
  503 = the Cloud Run value is missing or under 16 characters, 401 = the two values differ.
  ✅ **VERIFIED 2026-10-06:** the admin's Force run of job `scheduler-tick` (asia-southeast1, `*/5 * * * *`) read
  **Success** in the Cloud Scheduler console (admin screenshot). Q-159 is closed.
- **New domain gets the published app by itself (built 2026-10-05, Q-163):** `DOMAIN_AUTOPUBLISH` — kill switch,
  **default ON**; `off` stops the uptime sweep putting the already-published app (from `PUBLISHED_APPS_BUCKET`'s copy)
  on a connected domain whose site is still empty. Once per domain + app, owner's active app only.
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
  🔴 **CORRECTED 2026-09-27 — "134 ≥ 117 ✓" WAS THE WRONG COMPARISON, AND BUILD 134 CANNOT ATTEST.**
  117 is when the plugin SHIPPED, not when it WORKED: builds 117–136 send a classic Play Integrity
  request with no nonce (the SDK refuses it before it reaches Google) and do not list the `phone` sign-in
  provider, so on build 134 every device check and every in-app mobile OTP fails — the admin's "mobile
  recognition" problem. Both were fixed in #3338, first built by run **#137** (138 is built from main
  too), and **neither is on Play**. The preflight now compares against `FIRST_RELEASE_THAT_ATTESTS =
  137` and shows 134 as failed. ⚠️ **To actually fix it: roll out build 137/138 (or a fresh one) on
  Play, then set this key to its run number.** No server change can make build 134 attest.
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
  🔁 **2026-10-06 (Q-690) — the SAME two keys now also drive the daily Play refund check** (no new key).
  `GOOGLE_PLAY_SA_JSON` + `GOOGLE_PLAY_PACKAGE_NAME` are read by `playVoidedPurchases.ts`, an exclusive
  scheduler job (`play-voided-purchases`, 06:00 UTC) that reads Play's Voided Purchases list and takes
  back the tokens of every refunded or charged-back pack. It is NOT gated on `STORE_BILLING`, on
  purpose: a pack bought while billing was on can still be refunded after it is switched off. Either
  key missing ⇒ the run records `not-configured` and calls nothing. ⚠️ **One extra Play Console
  permission is needed, and it is not the one purchase verification needs:** Play Console → Users and
  permissions → this service account → **"View financial data, orders and cancellation survey
  responses"**. Without it Google answers 401/403 and every run records `refused` with that hint (shown
  on admin → Revenue). Test-locked in `tests/aPlayRefundTakesBackWhatItBought.test.ts`.
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

- **🖼️ THE IMAGE GENERATOR: CLOUDFLARE FIRST, 5 FREE A DAY, THEN ₹1 EACH (admin 2026-09-30, verbatim:
  *"haan, cloudflare wala bana do. aur per day 5 image free for user, uske bad 1₹/image. image generator ai
  ke aage se free word hatao"*). No key needs setting for the defaults.**
  **Rung 1 — FLUX.1 schnell on Cloudflare Workers AI** (`src/server/lib/cloudflareImage.ts`), fetched by
  THIS server so every client, old phone apps included, gets bytes. Reuses `CLOUDFLARE_ACCOUNT_ID` +
  `CLOUDFLARE_API_TOKEN`; ⚠️ **that token was made for DNS/Pages and may lack the *Workers AI* permission** —
  then every call is an `HTTP 403` in the admin diagnostic and the request falls to the next rung. Fix by
  adding Workers AI to that token, or set **`CLOUDFLARE_AI_TOKEN`** (a token made only for Workers AI, which
  wins). Optional: `CLOUDFLARE_IMAGE_MODEL` (default `@cf/black-forest-labs/flux-1-schnell`),
  `CLOUDFLARE_IMAGE_STEPS` (default 4, clamped 1–8), `IMAGE_GEN_CLOUDFLARE=off` (removes the rung).
  💵 The account's free allowance is 10,000 neurons/day ≈ ~170 pictures at published rates, then ~$0.0006
  each — ⚠️ derived from the rate card, NOT measured; on Cloudflare's free Workers plan calls past the
  allowance are refused (the next rung serves), on the $5 paid plan they are billed. It draws ONLY
  1024×1024 (the model has no size input), so Wide/Portrait/custom go to the next rung; it runs the same
  Pollinations word ban (an image model draws, it does not refuse).
  **The price** (`src/server/lib/imageAllowance.ts`): `AI_IMAGE_FREE_PER_DAY` (default **5**, India's day),
  `AI_IMAGE_PRICE_INR` (default **₹1**, capped ₹50; unreadable ⇒ the default), `AI_IMAGE_PRICING=off` (the
  pre-2026-09-30 behaviour exactly). Counted per DELIVERED picture whichever rung drew it (an edit too),
  charged from the count AFTER the picture so two at once cannot both be the free fifth, refused BEFORE any
  engine with the `wallet_empty` code when the free ones are used and the wallet holds under the price.
  A failed picture is never counted or charged; free-listed accounts are neither; a link the BROWSER
  fetches (`IMAGE_GEN_CLIENT_FETCH`) is not counted, because we cannot see whether it arrived. Wallet line
  `image` ("Image Generator AI"). **This supersedes `AI_IMAGE_FREE_DAILY_LIMIT` (3) while pricing is on** —
  that limit rode `PROFESSIONAL_PAID_ENABLED`, which is unset, so it was never enforced anyway.
  🔁 **It reverses 2026-09-23's "one tier: FREE" on the admin's word** — still one screen and one route, no
  PRO switch; the name dropped FREE ("Image Generator AI") the same day. And it amends THE ONE-WALLET LAW's
  line "Image generation stays on its quota cap": the price is the admin's own fixed number, not an
  estimated cost. Test-locked and reversion-proven in `tests/fiveFreeImagesThenOneRupee.test.ts`.
  🔁 **SUPERSEDED THE SAME EVENING — FREE AND PAID ARE TWO MODES AGAIN (admin 2026-09-30, verbatim: *"pahle
  ek system tha, free + paid (dono the) wahi bana do! free wala sabhi ke liye free, agar pollination se
  image na bane, to likh kar aye, free server are too busy try on paid service (user ki bhasa me). aur
  paid wala system abhi apne jo banaya hai, aur old paid wala mila ke banao!!"*).** The admin also said
  Pollinations had not been down (*"pollination ai chal raha hai … woh band nahi hua tha"*); the 401 in
  `freeProviderDoor.ts` came from the provider's published docs and was never observed from a session,
  so the earlier outage's cause is unproven. No env key; the request's `tier` field decides
  (`src/server/lib/imageTier.ts`), and a request with no tier — every installed phone app — is FREE.
  - **FREE mode:** the free provider only, fetched by the user's browser (`IMAGE_GEN_CLIENT_FETCH`), or
    once from our server with `anonymous: true`. **Our `POLLINATIONS_API_KEY` is never used here.** No
    count, no charge, no paid rung. When it cannot make the picture, the answer is **503 `free_busy`**:
    "the free servers are too busy, try Paid mode", in the prompt's language (`detectLanguageHint`
    scripts plus Roman Hindi; English otherwise). An edit of the user's photo in Free mode is **409
    `needs_paid`**. The screen shows a **Switch to Paid** button for both, which re-sends the same request.
  - **PAID mode:** Cloudflare (1024×1024 only) → the free provider **with** our key → the old Pro tier's
    host (`imageProHost.ts`: `IMAGE_PRO_KEY` / `IMAGE_PRO_ENDPOINT` / `IMAGE_PRO_AUTH_SCHEME`, which the
    admin set on 2026-09-21; words only, async answers polled; `IMAGE_PRO_ENABLED=off` removes it) →
    Gemini → Grok. 5 free a day then ₹1 (`imageAllowance.ts`), counted and charged in Paid mode only.
    An edit goes to `runImageEdit`, **never to the old host**: that host's edit returning the photo
    unchanged is why the Pro tier was removed on 2026-09-23. With pricing on, the platform cap
    (`AI_IMAGE_FREE_PAID_DAILY_CAP`) does not apply to Paid mode; it stays the pricing-off rule.
  - The screen opens on **Free** every visit and never stores the choice (the 2026-09-22 rule: a
    remembered Paid is a charge the user did not decide on). Test-locked and reversion-proven in
    `tests/imageFreeAndPaid.test.ts` and `tests/theImageGeneratorHasFreeAndPaid.test.ts`.
- **🔁 FREE MODE REMOVED (2026-10-05, admin's choice "Free mode हटाएँ", after a screenshot of Free mode answering
  every request "the free image servers are too busy" over `HTTP 402 | anonymous access refused`).** The provider was
  not busy: its anonymous door asks for payment from everybody, so Free mode could make nothing and told users a false
  cause. Now ONE screen: 5 free a day, then ₹1 (`imageAllowance.ts`), every rung fetched by this server.
  - **No env key changed.** `IMAGE_GEN_CLIENT_FETCH` and `IMAGE_GEN_ANON_PROBE` are now **dead** (nothing reads the
    first for minting, `freeProviderDoor.ts` is deleted); leaving them set is harmless. `IMAGE_GEN_POLLINATIONS=off`
    still removes the KEYED rung. `POLLINATIONS_API_KEY` is still optional, for that keyed rung only.
  - 🔒 **Consent to a price:** only a request with `tier: 'paid'` (the current screen, which shows the price) is
    charged. A request with no tier — every phone app installed before this change — gets the same 5 free a day,
    then **429 `free_used_update`** ("update the app or open navbharatai.com"), never a charge (`imageTier.ts`).
  - `imageGenConfigured()` counts the free provider only WITH a key, and the route also counts `IMAGE_PRO_KEY`.
  - Test-locked in `tests/imageFreeAndPaid.test.ts`. Everything below about Free mode is history.
- **🔑 `POLLINATIONS_API_KEY` — THE FREE IMAGE PROVIDER CLOSED ITS ANONYMOUS DOOR (2026-09-30, admin:
  *"image banne band ho gaye hai!!"*). ⚠️ NOT set as of this date.** The provider now answers **401**
  to any request without an account key, and everything below (`IMAGE_GEN_CLIENT_FETCH`) was built on
  that anonymous door — so every free picture failed at once, and the bundled phone apps, which cannot
  fall back on their own, showed *"NavBharatAI's engine could not make that image right now"* with no
  way out. Nothing on our side changed.
  🔒 **THE SERVER NOW KNOWS WHEN THE DOOR IS SHUT** (`src/server/lib/freeProviderDoor.ts`): a 401/402/403
  from its own fetch, from a new client's `freeFailed` report, or from a small probe (at most every
  10 min; the first on an instance is awaited for ≤ 4 s) closes it for 30 min. While closed, **no link
  is minted and no anonymous request is made**, so the request goes straight to the metered paid rungs
  (Gemini → Grok, bounded by `AI_IMAGE_FREE_DAILY_LIMIT` and `AI_IMAGE_FREE_PAID_DAILY_CAP`) and even an
  old phone app gets the picture bytes. Only an AUTH answer closes it — a timeout, 429 or 5xx is "could
  not tell", so our own egress failing never moves every free user onto paid engines.
  `IMAGE_GEN_ANON_PROBE=off` stops the probe (the door then closes only on real failures).
  💳 **THE REAL FIX IS THE KEY, AND IT COSTS MONEY — the admin's decision.** An account at
  enter.pollinations.ai issues a SECRET key (`sk_…`); set it as **`POLLINATIONS_API_KEY`** and the
  picture is fetched by THIS server from `gen.pollinations.ai` with the key in an `Authorization`
  header — **never in a link**, because a link the browser fetches is a key every user can copy. So with
  a key the browser-fetch path is off by construction and the per-IP benefit of `IMAGE_GEN_CLIENT_FETCH`
  is gone (the key's own limits apply instead). Generations spend the account's "pollen"; a 402 (budget
  out) falls through to the paid rungs. `POLLINATIONS_BASE_URL` overrides the keyed host (default
  `https://gen.pollinations.ai`). ⚠️ **Never put a publishable `pk_` key here** — the provider limits
  those to one request per IP per hour and forbids them off a browser.
  🚑 **No-deploy stopgap:** `IMAGE_GEN_POLLINATIONS=off` skips the free provider entirely (every free
  picture then comes from the capped paid rungs). ⚠️ **The provider's live behaviour could not be
  verified from a session** (its hosts are refused by the session's egress policy); the 401 comes from
  its own published docs. Test-locked and reversion-proven in `tests/theFreeDoorClosedAndNobodyNoticed.test.ts`.
  🔁 **Since the Free / Paid split (same evening): the key is PAID MODE's.** Free mode never sends it,
  and a closed anonymous door in Free mode is the `free_busy` answer, not a fall-through to paid engines.
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
  🇮🇳 **EVERY PERSON IS INDIAN UNLESS NAMED OTHERWISE, AND NO IMAGE IS NOT A DEAD END (admin
  2026-09-30: *"jab bhi koi human image banayi jaye to default indian face hi banna chahiye … 'indian
  face' diya to image bani hi nahi"*). No env key.** (1) `imagePeople.ts` puts
  `INDIAN_PEOPLE_DIRECTION` straight after the subject whenever a person is in the brief and no other
  origin, mix or character is named ("a Japanese chef", "diverse team", "spiderman" stand down) —
  in the craft layer (every rung of the generator), never on an edit, a UI screenshot or a
  background. Precision-first: player / worker / cook / seller / driver are NOT people words, and a
  cat's face or a face-wash bottle is not a face. (2) 🔴 **Since this key made the browser fetch the
  free picture, a picture the engine did not deliver was a dead end** — the server had already
  returned the link, so the old ladder (a try from our side, then the metered paid rungs) never ran.
  The browser now probes a link it cannot read (`imageLinkLoads`) and, when no picture came, re-sends
  the SAME request with `freeFailed` (the signed link and its reason). The server honours it only via
  `freeFailureVerified` — our signature, unexpired, and the prompt inside the link equal to this
  request's prompt — and then runs the server ladder; a mismatch is a 403. The paid rungs stay
  metered exactly as before. ⚠️ **Why "indian face" failed is NOT proven** (the provider cannot be
  reached from a session); the suspect is the provider's own `safe=true` filter (added 2026-09-28)
  refusing a close-up face. The `[IMAGE_GEN] the browser could not get the free picture (<reason>)`
  log line now names it — read it before changing anything else.
  💬 **NAVBHARATAI FREE DOES NOT MAKE PICTURES, AND IT KNOWS WHERE THEY ARE MADE (admin 2026-09-30:
  *"photo nahi banata hai = sahi hai, banana bhi nahi hai … navbharatai free ko mode aur uske andar jo
  hai, sabke bare me batao"*).** The inline Pollinations picture in `routes/chat.ts` is removed — a
  free picture request now reaches the model with `FREE_IMAGE_REQUEST_DIRECTIVE`, which answers in the
  user's language and points to **Mode → Image Generator AI FREE**. And `freeChatModeGuide()` is a
  STANDING part of the free system prompt (every turn, not a keyword match): the Mode sheet's two
  groups, the studio, every expert by name, the four the phone app hides, and that Pro is not in Mode.
  🔒 `tests/freeChatKnowsItsModeButton.test.ts` holds the guide equal to the sheet
  (`newModeEntries`) in both directions — it found the GitHub repo analyst missing on its first run.
  ⚠️ The free chat's own PHOTO EDIT (an attached picture + "background badlo", 2026-09-21) is
  deliberately untouched — the admin's word was about MAKING a picture; ask before removing an edit.
  🔴 **AND ON THE PHONE THE MESSAGE NEVER EVEN REACHED THE SERVER** (admin's screenshot, same day:
  "photo banao" → *"Building applications is only available for NavBharatAI-Pro"*). `useChatEngine.ts`
  ran `/bana do|build|create|generate|coding|program|banao|project/i` over every free message and
  answered a match itself — so "photo banao", "chai kaise banao" and "project report likho" were all
  refused with a canned line. The free agent now always falls through to the server, whose own prompt
  sends an app request to Pro and a picture request to Mode. Sibling fixed in the same file:
  `githubTriggers` matched "git" inside "digital" and "repo" inside "report". ⚠️ Bundled mode: the
  website has it on deploy; phone users need a fresh `.aab`/`.ipa`.

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
- **AI inside a PUBLISHED app — the gateway (built 2026-09-12, ROADMAP §13 item 3.1):**
  ✅ **LIVE — the admin SET `APP_AI_GATEWAY = on` in Cloud Run on 2026-09-30** (recorded hand-to-hand the
  same session, right after #3405 taught the builder to use it). Verify on a real build: a published AI
  app with no server should call `generate_ai` (navbharat) and answer with no key pasted anywhere.
  `APP_AI_GATEWAY` (the master switch — unset or anything but `on` means the old behaviour exactly: no token
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
  🔀 **SINCE 2026-09-30 THE SWITCH ALSO STEERS THE BUILDER (admin chose "B").** With it on, the architect
  AND every sub-agent read `aiInAppRule()`: an AI app WITHOUT a server of its own takes the keyless route
  (`run_recipe` → `generate_ai`, provider `navbharat`) and tells the user the assistant answers after
  PUBLISH, not in the preview; an app with a server keeps `AI_IN_APP_RULE` (#3387) unchanged. Off ⇒ the
  prompt is byte-identical to before. Before this, nothing told a builder the gateway existed, so turning
  the key on alone would have changed no generated app (autopsy d8ed307a).
  ⚠️ **BEFORE FLIPPING IT ON:** the switch changes what a PUBLISH does, not what an existing app does —
  apps published before it was set carry no token and are unaffected until they are published again.
  The per-app cap is the platform default for every app; there is deliberately **no owner-facing
  override yet**, because nothing in the product can set one and a field with no screen behind it is a
  promise. Reverting is one key: unset it and new publishes stamp nothing, while apps already carrying
  a token get an honest "not available" from the endpoint.
- **🤖 THE APP'S OWN AI WORKS IN THE PREVIEW, ON THE OWNER'S KEY IF THEY WANT, AND IT CAN BE SWITCHED OFF
  (built 2026-10-04; admin: "preview me AI chalao ₹2/din … apni api keys … red dot … navbharatai ki api
  delete kar de … navbharatai api browser me na jaye").** One key, NOT set, code default governs:
  `APP_AI_PREVIEW_CAP_INR` (**₹2 a day per app**, unreadable ⇒ 2, never "no limit"). Everything rides the
  existing `APP_AI_GATEWAY` switch. Code: `src/lib/previewAiProtocol.ts` (the relay), `lib/appAiAnswer.ts`
  (ONE answer path for published + preview), `lib/appAiOwnKey.ts`, `lib/AppAiSettingsStore.ts`
  (`app_ai_settings`, erased with the workspace), `routes/appAiOwner.ts`, `AppAiSettingsCard.tsx`.
  🔒 **NO CREDENTIAL IN THE PREVIEW PAGE:** the app posts its question to its PARENT (the NavBharatAI page the
  owner is signed in to), which asks `POST /api/app-ai/preview-ask` with the owner's own login (strict
  `ownedByVerifiedUid`). Opened anywhere else there is no parent to answer. The saved preview copy gets the
  same relay (`withPreviewAiRelay`) only when its bundle uses `NavAI`.
  🔑 **OWN KEY = SERVER-SIDE:** `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in the vault (shared or for that app)
  makes BOTH the preview and the published app answer on that key from our server; ₹0 to the wallet; the
  app's code does not change. A refused key is reported, **never silently replaced by our engine**.
  🔘 **THE SWITCH** (`POST /api/app-ai/settings`) stops NavBharatAI's engine for that app immediately,
  published and preview, no republish. 🔴 **RED DOT** on More → Keys & Secrets (`secrets.ai-notice`) until
  the owner opens the "AI in this app" card (seen-state is per device, localStorage).
  ⚠️ **Honest limit:** a PUBLISHED page still carries the public, signed app token — it is an identifier,
  not a key, and the per-app (₹20) and per-visitor (₹2) caps are what bound it. Nothing callable from a
  public page can be made secret; provider keys never leave the server.
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
- **⏱️ A FREE BUILD HOLDS THE MACHINE FOR LESS (admin 2026-09-30, verbatim: *"han, free build time-limit
  wala PR banao"*). Two keys, NEITHER set, both with working defaults.** Read by
  `src/server/AgentV3/freeBuildTimeCap.ts`; applies to every build with `freeTierBuildActive` (free tier or
  the Weak level, including the admin's own Weak builds).
  - **`AGENTV3_FREE_BUILD_SECONDS`**: the free build's window. Default **1500 (25 min)**, floor 300. It is
    never above the paid cap, so the orphan reaper (paid cap + 10 min) stays safe. `off` gives the paid
    window. An unreadable value falls back to the default, never to "no limit". Applied to
    `effectiveBuildSeconds`, so the watchdog, the runner's own stop, the reserve and the reviewer's
    headroom all read the same number. A disabled watchdog (`AGENTV3_MAX_BUILD_SECONDS=0`) stays
    disabled.
  - **`AGENTV3_FREE_BUILD_AUTO_SECONDS`**: how long one free request may run unattended across windows.
    Default **3000 (two default windows)**. Once it is spent, the watchdog pause is sent `resumable:
    false`. The work is saved, the user is told so in branded words, and each "continue" buys one more
    window. A new request starts a new allowance. `off` leaves the chain to the client's own bounds, as
    before.
  - 🔴 **WHY:** the window was never the bill; the unattended chain was. A free build got the paid
    30/60-minute window, and the client auto-continued the watchdog pause for up to 8 windows while
    files grew, plus 2 with no progress at all. That is four hours (eight on a deep prompt) of a machine
    NavBharatAI pays for, with nobody pressing anything. The chain is bounded on the SERVER because the
    phone apps are bundled: the server decides whether a pause is resumable, and every client already
    obeys that.
  - ⚠️ **The chain is counted in one instance's memory.** An auto-continue that lands on another Cloud
    Run instance is a new chain there, which is exactly the old behaviour. So it can only fail toward
    being more generous, never toward stopping a build wrongly. A durable counter is the complete fix;
    it is an OPEN item in `PROGRESS.md`.
  - ⚠️ **25 minutes is an assumption, not a measurement.** Watch `FREE_BUILD_TIME_CAP` and
    `FREE_BUILD_CHAIN_PAUSED` in admin reports. Both are process codes, never app findings. A crop of
    chain pauses on apps that were nearly done means the window is too short. Test-locked and
    reversion-proven in `tests/aFreeBuildHoldsTheMachineForLess.test.ts`.
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
- **💳 `AGENTV3_SUPABASE_PAYMENTS` — payment verification in the USER'S OWN Supabase (built 2026-09-29).
  ⚠️ NOT set, and unset means OFF** — only the exact value `on` enables it, because it deploys code into a
  user's own account. Read by `src/server/lib/supabasePayments.ts`. For a Razorpay app with no server of
  its own, the build adds guarded payment columns to the app's table, stores the user's Razorpay keys as
  THAT project's secrets, and deploys the `nbai-payments` Edge Function, so a row is marked paid only after
  Razorpay's signature is verified. With it off, `generate_payment` on a serverless app gives the honest
  "payment pending" guidance (PR A). ⚠️ **Turning it on also adds `edge_functions.write` + `secrets.write`
  to the Supabase consent screen** — so the Supabase OAuth app must have those two permissions enabled
  first, and a user who connected earlier gets a "reconnect" message on first use. **Never live-tested**
  (the Management API is unreachable from a session): test on the admin's own account in Razorpay TEST
  mode before widening.
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
  ✅ **CLOSED 2026-09-27 (autopsy 2720e553):** every abort of the build's signal — this cost stop, the
  Stop button, the watchdog, a deploy drain — now reaches the call in flight. `RunTurnParams.signal`
  runs through the provider ladder (which neither benches a vendor nor falls to the next rung for it),
  closes a GLM/Kimi stream, and cancels the Claude request and its retries; `stopSignal.ts` is the one
  definition. The fast lane, which never read the signal at all, checks it at every step.

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
  🌦️ **A CRAWL IS WEATHER, NOT A VERDICT — `AGENTV3_CRAWL_BENCH_SECONDS` (NOT set; default 180; clamped
  30–1800; unreadable ⇒ 180; `off` ⇒ the old whole-build bench). Autopsy 876afca9, 2026-09-30.** A stream
  abandoned for crawling used to bench its rung for the WHOLE build on one sample: GLM flashx answered the
  plan in 2.4 s, crawled once, and every call for ten minutes went to the reasoning rung. Now the crawl bench
  ends after the window, the rung is re-probed ONCE, and a second crawl benches it for the build
  (`crawlBench.ts`). At most two abandons per build, the second only on that re-probe (a concurrent call in
  flight is never the re-probe), so bad weather at every vendor still cannot walk the ladder. The THROUGHPUT
  bench above is untouched. Test-locked and reversion-proven in `tests/aCrawlIsWeatherNotAVerdict.test.ts`.
  🔴 **ITS FIRST REAL OUTING WAS DEFEATED BY A SECOND BENCH (autopsy d382b398, 2026-10-01).** A crawl abandon's
  message contains "timed out", so it ALSO counted toward the family's "2 consecutive timeouts" bench, and two
  fast-lane calls crawling in the same second both abandoned (the "never a concurrent call" check read a count
  recorded only after an await). Result: every GLM rung, glm-5.3 included, benched for the whole build. Now a
  crawl abandon never feeds the timeout streak, and `canAbandonSlowStream()` CLAIMS the abandon when it is
  decided (`{ peek: true }` only asks). Locked in `tests/theElectricalTestingAutopsy.test.ts`.
  ✅ **AND THIS REPORT SETTLED THE STREAMING ENTRY'S ONE OPEN QUESTION: Z.ai DOES honour
  `stream_options.include_usage`** — real per-call input/output/cache token counts came back on every
  streamed call. The "0 in / 0 out" risk that entry warns to watch for did not materialise.
- **🎁 THE FREE-CREDIT STEPS, FINAL PLAN (admin 2026-09-27, verbatim: *"sabhi pahle 50₹ do! (mobile +
  website) · fir refral code ke 100₹ (only mobile') · fir login par 50₹ (dono par) · fir mobile otp
  verification par 100₹ (dono par) · fir github connect (100₹ mobile only) — ab yeh final hai"*). SUPERSEDES
  the step amounts in the two entries below.** Signup ₹50 (both) · referral code ₹100 (app) · login with a
  verified email ₹50 (both) · mobile OTP ₹100 (both) · GitHub ₹100 (app). App ₹400, website ₹200 — exactly
  the two ceilings that already existed, so neither moved. Referrer still ₹25 × (login, mobile, GitHub),
  never for the signup. Amounts live in `STEP_RUPEES` (`referralRewards.ts`); **`REFERRAL_STEP_TOKENS` is
  no longer read.** New key **`REFERRAL_WEB_HOLD_UNTIL_MOBILE`** (NOT set; default OFF): `on` puts the
  website's signup/login money back behind the OTP, the 2026-09-26 rule, without a deploy.
  ⚠️ **THE COST THE ADMIN ACCEPTED, stated:** the ₹50 + ₹50 are earnable on the website with no phone and
  no device check, so scripted accounts can collect ₹100 each (credit only — it cannot be withdrawn).
  Watch the Referral cost card; the lever above is the answer if it is farmed.
  📱 **Three steps no longer need the phone to be recognised:** the sign-in settle every client already
  calls (`/api/payment/reconcile`, including build 134) pays the day-one two (signup, login — never the
  mobile, which would make a new app user "old" before their typed code is applied), and a failed device
  check on the phone falls back to the web rules for signup/login/mobile on both the client and the server.
  Only the referral code and GitHub still need a device that can be checked. The phone also retries a
  transient Play Integrity failure (-3/-8/-9/-12/-17/-100) twice before reporting it.
  ⏳ **THE CODE BOX CLOSES AFTER 3 APP OPENS OR 7 DAYS (admin 2026-09-30: *"4rth time … input box gayab
  ho jaye … missed (❌)"*; 30-minute rule and 7-day backstop approved, choice "b" for existing accounts).**
  No env key — `CODE_WINDOW_OPENS` / `OPEN_GAP_MS` / `CODE_WINDOW_DAYS` in `src/server/lib/referralCodeWindow.ts`.
  🔒 Counted on the SERVER, on the account, by the app's own status read (`GET /api/referral/:uid`, app only —
  the website never spends a chance), so every installed build is covered without a new `.aab`; opens inside
  30 min of the last counted one are one open. The 7-day backstop (Firebase `creationTime`) bounds an app that
  never reports. `/redeem` refuses with `code-window-closed`. A missed row is sent only to a client that asks
  (`missed=1`) — an older build would draw it as ₹100 still waiting — and is ❌ with no button, never counted
  as pending. A code applied in time keeps its ₹100.
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
  🔴 **SUPERSEDED BY THE ADMIN ON 2026-09-27 — the paragraph above is history, not the rule.** The
  website now earns signup ₹50, login ₹50 and mobile ₹100 (**₹200 max**); GitHub and the rest still
  need the Android device check. Verified in `routes/referral.ts` (`stepAllowedOnWeb`, "The website earns
  signup ₹50, login ₹50 and mobile ₹100 — at most ₹200 (admin 2026-09-27)"). Recorded 2026-09-30 when the
  admin Referral card showed *"Website · ₹100 paid"*: that payment is the CURRENT rule working, not a
  leak — a session reading only the ₹0 paragraph would have "fixed" it.
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
  ⛔ **DO NOT SET `APP_CHECK_MODE=enforce` YET.** Slice 2 (2026-09-26) added the phone half —
  `@capacitor-firebase/app-check` (pinned `~8.3.0` like the other Firebase plugins): Play Integrity on
  Android, App Attest on iOS — but it reaches users only through a FRESH `.aab`/`.ipa`, and every build
  already installed sends no token. Enforce would refuse all of those on their next build or chat.
  ⚠️ iOS needs TWO one-time admin steps before its tokens are real: Apple Developer → Identifiers →
  com.navbharat.ai → **App Attest** ✅, then the `ios-ipa.yml` input **`enable_app_attest`** (default OFF —
  signing with the entitlement before the capability exists fails the export). Android needs Firebase
  console → App Check → the Android app → **Play Integrity** registered with the app's SHA-256 (the same
  fingerprints `ANDROID_CERT_SHA256` holds). `capacitor.config.ts` carries the SwiftPM `symlink` option the
  plugin's README requires (a package-identity collision with Firebase's own `FirebaseAppCheck`). Read `GET /api/admin/app-check` first — it counts
  valid/missing/invalid/unverifiable **per web and per native**, per instance since boot.
  🔴 **UNTIL 2026-09-30 THE PHONE HALF NEVER STARTED, whatever the console said.** `loadNativeAppCheck`
  returned the plugin proxy from an async function, so resolving it read `.then` off the proxy — a native
  call no platform has (*"FirebaseAppCheck.then() is not implemented on ios"*) — and the promise NEVER
  resolved. So every native request so far arrived with NO token, and the counters' "native: missing"
  was our bug, not old installs. It is fixed in the bundle, which means it reaches phones only with a
  **fresh `.aab`/`.ipa`**; read the native counts only from builds made after the fix.
  `tests/pluginProxyIsNeverResolved.test.ts` now fails CI on the pattern anywhere in the client (third
  time this class shipped).
  ⛔ **AND DO NOT turn on App Check ENFORCEMENT in the Firebase console for Firestore/Auth** — the phone
  apps talk to Firestore directly and would lose it. Registering the web app with the site key is safe;
  the console's *Enforce* buttons are not, until slice 2 ships and the numbers say so.
  **Admin setup (web):** Google Cloud → Security → reCAPTCHA Enterprise → create a *Website* key for
  `navbharatai.com` and `www.navbharatai.com` (no localhost) → Firebase console → App Check → register the
  web app with that key → set `APP_CHECK_SITE_KEY` in Cloud Run. The privacy policy (§3.3, §7) already
  discloses reCAPTCHA; `tests/appCheck.test.ts` holds that and the shared route list.
- **🔒 TEN FREE MESSAGES A DAY WITHOUT SIGNING IN, ALL SURFACES TOGETHER (admin 2026-09-27, built the same day).**
  `GUEST_DAILY_MESSAGES` (NOT set; code default **10**; `0` = sign-in from the first message; `off` = no limit;
  unreadable ⇒ 10, never unlimited) and `GUEST_DAILY_IP_CAP` (NOT set; default **100**, never below the per-device
  limit). Read by `src/server/lib/guestDailyQuota.ts`, mounted on every AI route a signed-out visitor can reach
  (free chat, Repo Analyst, App Review, Security Scan, AI Debugger, App Scan, design tools); the census in
  `tests/tenFreeMessagesThenSignIn.test.ts` fails when a new anonymous AI route lacks it. The visitor is the random
  device id the app sends (`x-nb-guest`, `src/lib/guestId.ts`), because Indian mobile networks share one IP among
  many phones; the IP (the LAST `X-Forwarded-For` entry) is only the backstop. The day is India's. Refusal is
  **403 `guest_limit_reached`** — never 401, which the free-chat client reads as an expired session.
  ⚠️ **The old browser counter (`FREE_DAILY_MESSAGES`) is gone on purpose; do not reintroduce a client-side count.**
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
  | **`GRIEVANCE_OFFICER_NAME`** (+ optional `_EMAIL` / `_PHONE` / `_ADDRESS`) — read by `src/server/lib/grievanceOfficer.ts`; the public page is `/grievance` | Admin Monitor: the amber "Grievance Officer not named" warning is GONE. It is driven by `officerIsNamed`, so it cannot be green while the key is missing. 🔴 **CHECKED 2026-09-27 AND IT FAILED:** the admin's own Monitor capture that day still shows *"Grievance Officer not named"*, so the RUNNING revision reads `GRIEVANCE_OFFICER_NAME` as empty or absent — never set, set on a revision that was replaced, or set under a mistyped name (a trailing space counts). This row is therefore **NOT done**, whatever the queue list says |
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
  🔴 **CORRECTED 2026-10-01 (autopsy de3bb2bb) — A STYLESHEET IMPORTED BY TWO MODULES IS NOT A DEFECT.**
  Vite emits the rule ONCE however many modules import the file (proven with a real Vite build), yet the gate
  spent an LLM repair pass on it and held the release gate YELLOW. It is now an `info` line, never repaired.
  The same change: a code a heal reports fixed resolves the finding it fixed (`HEAL_RESOLVES` in
  `BuildDiagnostics.ts`, census-locked against every `*_HEALED / *_REPAIRED / *_AUTOFIXED` the route
  records), and the after-check reads the WHOLE project, not only the files the heal wrote. Locked in
  `tests/theCoactCollectorAutopsy.test.ts`.
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
- **🧭 A PATH IS NOT A PROGRAM (autopsies Sur Taal + e3b0ce25, 2026-10-04; no flag).** `isDevServerInvocation`
  reads each path by its LAST part (`pathsAsBasenames`, #3506): the typecheck primer copies
  `/home/user/.warm/vite-react/node_modules`, and "vite" in that directory name made every write-time typecheck a
  dev-server launch (BROWSER=none syntax error, the running server killed, a 30 s timeout). Two sessions found it
  the same day; #3506 shipped the fix. ⚠️ **Any new command the platform builds for itself goes into the census in
  `tests/aTypecheckIsNotADevServer.test.ts`.** Same autopsy: an EMPTY sandbox `package.json` is restored in
  `_npmInstall` (the one install path) with the machine's state recorded (`emptyManifest.ts`) — which process
  emptied it is OPEN (Q-414).
- **🔧 A REPAIR THE PLATFORM CHECKS DOES NOT CHECK ITSELF, AND A REPAIR THAT CHANGED NOTHING SAYS SO (autopsy
  6cd698cc, 2026-10-01).** The explorer repair fixed a theme button in 61 s, then ran the production build, a dev
  server, the preview and a browser of its own (its prompt was the reviewer's `judgeRepairPrompt`, "verify the app
  builds…") until its 150 s cap; the platform undid the working fix. Now the explorer and green functional repairs
  get `PLATFORM_CHECKS_THE_FIX` (`repairScope.ts`), run without the preview/browser tools (`withoutPlatformCheckTools`)
  and with `focusedRepair` (no style hand-back). ⚠️ Never hand a platform-checked repair `judgeRepairPrompt`. And a
  platform-requested run whose last turn claims a change while it changed no file is narrated as "No change was made
  in that step." (`repairClaim.ts`, `REPAIR_CLAIM_WITHHELD`). Two keys, NEITHER set, default ON, `off` reverts:
  **`AGENTV3_WRITE_TYPE_IMPORT_HEAL`** (the write-time typecheck rewrites a TS1361 `import type` of a value in a file
  this build wrote, and says so; the fast lane's timeout salvage runs the same `deterministicImportFixes` as its
  verify) and **`AGENTV3_DETACHED_METHOD_NOTE`** (a write-time note names a method that reads `this` and is handed
  out uncalled, e.g. `return store.set`; `detachedMethod.ts`). Test: `tests/theRepairThatWorkedWasUndone.test.ts`.
- **⛔ `AGENTV3_NO_FAKE_FEATURES` — NO FAKE BUTTON, NO FAKE FEATURE (admin-mandated 2026-10-04, unbreakable;
  verbatim: *"koi bhi function fake nahi hona chahiye! 'login' button bane to fake login na bane, real login
  button ho, google login, apple login, user se real api secret mange jaye! … agar koi button/feature fake
  banaya hai to user ko clearly bataya jaye ki yeh fake hai, aur kyu … 3 dot menu ke secret and keys me yeh
  secret dalo! red colour me saf saf likho user ki language me"*). ⚠️ NOT set; default ON; `off` reverts
  every reader with no deploy (and removes an earlier on-screen line on the next build).** Module
  `src/server/AgentV3/fakeFeatureScan.ts`.
  🔴 **WHY THE KEY WAS NEVER ASKED FOR:** `AppRequirements` demands a key only when the app's code NAMES one
  (a package or an env var); `AuthenticityAnalysis` finds the WORDS mock/fake/simulate; `SEED_PASSWORD_RULE`
  told the builder how to seed a demo user. A login that checks `password === 'demo123'` names no key and
  carries no such word — so all three were blind to it, and the user got a button that only pretends. The
  class: a feature whose real version needs the USER'S OWN credential (login, Google/Apple button, payment,
  OTP, email) built LOCALLY so nothing ever asked for the credential.
  **What runs now, on every successful non-import build (zero model calls):** (1) the WHOLE project is read by
  SHAPE — a sign-in screen whose password lives in the app or is compared in the browser, a "Continue with
  Google" with no OAuth SDK/route, a pay action that marks itself paid with no gateway or UPI link, an OTP the
  page makes up, "email sent" with no transport — each only when NO provider exists anywhere in the project;
  (2) a **RED line in the user's language is put on the app's own screen** (`withHonestyBanner`, injected into
  `index.html` at the production-defaults pass, idempotent, removed when the fake is made real, dismissible for
  the session, 36px thumb target so the mobile check does not flag it) naming the feature, "DEMO — not real",
  the exact key names and `NavBharatAI → ⋮ More → Keys & Secrets`; (3) the chat gets one 🔴 line per fake in
  the user's language (11 languages) with the files, the keys and BOTH paths, and the admin report
  `FAKE_FEATURE_SHIPPED` (warning, an app finding with a one-tap "Make the demo feature real" offer);
  (4) the fake IMPLIES the service it stands in for (`impliedRequirementsFor` → the new implied-only `login`
  catalogue entry, `payments_razorpay`, `sms`, `email_api`), so the closing ask card asks for the exact keys
  (Supabase Auth's two for a login — real email, Google and Apple sign-in; the one-tap database includes it);
  (5) the builder is told at write time (`fakeFeatureWriteNote`), and `NO_FAKE_FEATURE_RULE` is in all THREE
  lanes (architect, fast lane, one-shot — the one-shot lane carried no honesty rule at all until this day);
  `SEED_PASSWORD_RULE` now says a seeded account is never the app's login.
  🔒 **Precision first:** a PIN lock on a diary is not a login, "mark as paid" in an expense tracker is not a
  payment, a chat's "message sent" is not an email, a comment is not the app, an import turn is never scanned,
  and a request that ASKED for a demo / offline login / cash-only stands the matching rule down. A false
  positive costs one red line on a working screen; a false negative is the fake button the admin saw.
  ⚠️ **Honest limits:** detection is by shape, so a fake written in a shape not listed is missed (then the
  prompt rule and the write-time note are the only guard); the on-screen line needs an `index.html` (a
  Next.js app gets the chat line and the ask only); and adding the key does NOT rewrite the fake code — the
  user is told to reply "make it real" (or press the offer), which is the honest sequence. Test-locked and
  reversion-proven (20 of 27 cases fail with the reader disabled) in `tests/noFakeButtonNoFakeFeature.test.ts`,
  which also runs the reader over every golden scaffold.
  🧬 **SIBLINGS KILLED IN THE SAME CHANGE (admin: "sath kill the siblings"):** (a) every writing SPECIALIST
  carries the rule (`SubAgent.ts` — until then only the architect's prompt did, and specialists write the
  login screen as often); (b) the two heals most likely to WRITE a fake — the feature-presence heal ("add
  the missing login") and the completion heal ("implement the stub for real") — carry it in their own
  instruction; (c) the server-built in-browser preview (`runtime/ReactPreview.ts`) builds its own `<body>`
  and now carries the red block from `index.html` (`src/lib/honestyBanner.ts`, ONE definition of the
  markers; the client renderer reuses the app's body, so it rides along by construction — tested both);
  (d) the claim audit contradicts a summary that SELLS the demo ("✅ Login with Google is implemented") with
  `feature-claimed-but-demo`, fed from the same findings; (e) four more shapes: a sign-up that keeps its
  accounts in `localStorage`, "reset / verification link sent", "SMS sent to your mobile" (→ `sms`), and
  "uploaded / synced to the cloud" with no storage (→ `storage`). `FAKE_FEATURE_SHIPPED` stays the one code.
  🤝 **ONE JUDGEMENT WITH THE SIGN-IN EXPLORER, AND OUR OWN TEMPLATE WAS THE FIRST CATCH (same day).** #3526
  (Q-540) added `authLivesInTheBrowser` — the explorer's decision that an app's accounts live in the browser
  alone — which is the very fake this scanner discloses. They disagreed on the school app Q-540 was built for
  (`localStorage.setItem(USERS_KEY, …)` behind a constant), so the explorer knew what the user was never told.
  The scanner now asks that same function (plus a sign-in surface; a password-manager request stands down),
  and its own separate sign-up shape is gone so the two cannot drift. The first thing the shared judgement
  caught was **our own "Login page" template**: any valid email + 8 characters showed "Signed in". It is now a
  REAL sign-in — Supabase Auth's REST API (no new dependency) with `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY`: email log in / sign up, Google / GitHub / Apple through the provider's page — and
  until those keys are saved a red line says sign-in is not connected and nobody is ever shown as signed in.
- **`AGENTV3_WRITE_SECURITY`** (NOT set; default ON, `off` disables — added 2026-09-30, autopsy 466c260a) —
  `scanSecurity`'s medium/high findings (an XSS sink such as `dangerouslySetInnerHTML` / raw `innerHTML`, a
  hardcoded secret) are handed back with every write (`securityWriteNote`, via `writeSteeringNotes`). Before
  this they surfaced only at readiness, after the app was green, where the reviewer is suggest-only — so
  three sinks shipped with a warning nobody acted on. Advisory, never blocks a write, no model call.
  Same PR, no flag: an `nb-` class the design kit does not define and no stylesheet defines is named at
  write time too (`inventedKitClassNote`).
- **🖥️ `AGENTV3_EARLY_PREVIEW` — THE USER SEES THE APP WHILE IT IS BEING BUILT (admin 2026-10-01, verbatim: *"preview
  jitna jaldi ayega, user utna rukega.... banao"*). ⚠️ NOT set; default ON; `off` reverts all four parts.**
  `earlyPreview.ts`. In the calendar report the builder wrote five screens and never `src/App.tsx`, so the live preview
  showed the starter page for five minutes and the user stopped. The architect and the UI specialists now write the
  entry right after `src/types.ts`; a fast-lane hand-off names an unwritten entry first; while a build runs the
  in-browser preview (`ReactPreview.ts`, `building`) draws an unwritten screen as a "being built" card and reports no
  missing file as an error (the honest banner returns after the build); and the live strip offers "watch it live" once
  the entry is written (`earlyPreviewCue.ts`; a desktop opens the preview itself). 🔒 Only a capitalised import becomes
  a card — a missing helper keeps the empty stub. The fast lane's tier order is deliberately unchanged. Test-locked
  with a real-browser render in `tests/theAppIsOnScreenWhileItIsBuilt.test.ts`.
- **🌐 `AGENTV3_BROWSER_ONLY_GUARD` — BROWSER-ONLY CODE IS NOT RUN IN NODE (queue row Q-146, 2026-10-05).
  ⚠️ NOT set; default ON; `off` removes both the write note and the run refusal.**
  `BrowserOnlyInNode.ts`. A report recorded the cost: the agent ran a browser-oriented localStorage seed with
  `npx tsx`, it failed on `window is not defined` — deterministically, since node has no such global — and the
  agent then hand-mocked `window` into a stack overflow: **4 failures, ~10 minutes** of a user's build on a
  command whose outcome was knowable before it ran. Two layers, as the fifth rule's step 5 requires: (1) the
  WRITE that creates a script-named file using browser globals says so while the file is open, so the run is
  never attempted; (2) the `bash` case refuses the run if it is attempted anyway, naming the one path that
  works — and saying explicitly **not** to mock the browser, which is the improvisation that turned one failure
  into four. 🔒 The global list is MEASURED against `node:22-bookworm` (what all three E2B Dockerfiles pin), and
  `navigator`/`fetch` are deliberately excluded because node 22 defines them; the test re-measures in the running
  node, so a future runtime that defines one fails CI instead of leaving the guard wrong. Precision: it stands
  down on a `typeof` guard, on a `globalThis.x =` polyfill, on an imported binding of the same name, and for
  every ordinary app file — a component using `localStorage` SHOULD, and gets no note. Built in the shape of the
  five guards beside it (`ScaffoldGuard`, `gitCloneGuard`, `PreviewGuard`, `fixNodeModulesTypo`, the
  empty-command refusal). Test-locked in `tests/aSeedScriptIsNotABrowser.test.ts`, reversion-proven six ways.
- **🙋 `AGENTV3_ASK_UNRELATED` — A DIFFERENT APP IS ASKED ABOUT, NOT BUILT INTO THE ONE THAT IS HERE (admin
  2026-09-30, verbatim: *"puch lo user se!"*, on autopsy 1389f0d5: a Genesis-4 PDF was built INTO a calculator).
  ⚠️ NOT set; default ON; `off` restores the old edit-always behaviour.** `unrelatedRequest.ts`. A build order on
  a workspace that holds an app is normally turned into an edit (`BUILD_ORDER_READ_AS_EDIT`). Now, when the order
  names a WHOLE thing (an app, website, game, PDF, store) that shares no word-stem with the app here (its own
  file names and earlier build requests), the turn is answered in chat with the question: reply "add it to this
  app", or tap "New" (phone: More → New chat) and send it there. 🔒 Precision first: an edit verb, "app me/ko …",
  "this/the/my app", "make it …", a style comparison ("like a website"), packaging (android/apk/PWA), a part of
  an app ("game mode", "pdf download") and continue/fix all stand it down, and so does a workspace we cannot read
  or name. A 22-message precision lock in `tests/askBeforeBuildingSomethingElseIntoThisApp.test.ts` fails CI if
  an ordinary edit ever meets the question. The reply never falls through to a build if the chat model fails.
- **📊 `AGENTV3_SPREADSHEET_FILE` — A SPREADSHEET IS A FILE, NOT AN APP (admin 2026-10-01, verbatim: *"A karo!!"*).
  ⚠️ NOT set; default ON; `off` builds such requests as before.** "Make a sample Excel file" was built as a React
  dashboard and the user got no `.xlsx`. `spreadsheetRequest.ts` (precision first: a spreadsheet noun + a create
  verb or "sample data", and no software word, how-to, existing-file handling or other format) turns the turn into a
  chat turn; `spreadsheetTurn.ts` asks the free router for JSON rows; `lib/spreadsheetFile.ts` clamps them and
  writes `.xlsx` (exceljs) / `.csv` (BOM + formula-injection guard); rows live in `agentv3_sheet_files` under the
  VERIFIED uid; `routes/spreadsheetFiles.ts` downloads through the App Mart ticket shape (HMAC over file + format +
  sheet + account, 10 min). The chat line and the persisted turn carry `file`, so the Download card survives a
  reopen. ₹0, like the chat lane. ⚠️ The card reaches phone users only with a fresh `.aab`/`.ipa`. Test-locked in
  `tests/aSpreadsheetIsAFileNotAnApp.test.ts`.
- **🧩 `AGENTV3_DANGLING_CSS_GUARD` — AN IMPORT OF A STYLESHEET THAT DOES NOT EXIST IS REMOVED (autopsy 120eb52f).
  ⚠️ NOT set; default ON; `off` leaves such imports.** Four components imported `./X.css` files nobody wrote;
  `tsc` cannot see a stylesheet import, and Vite cannot build one. At the end of a build, a SIDE-EFFECT import of
  a sheet the sandbox confirms absent is removed (`DANGLING_STYLESHEET_IMPORT_REMOVED`); a CSS-module import
  (`import s from …`) is never touched. Upstream half, no flag: the write-time class note now names the missing
  imported file as the place for the rules instead of "Add the rules to src/index.css", which is how the
  imports were left behind.
- **🔒 ONE INSTALL INTO `node_modules` AT A TIME (autopsy 120eb52f, no flag).** The typecheck's own `npm
  install` raced the background boot install and tore `typescript` (its `bin/` without its `lib/`); the crash was
  then read as a CLEAN typecheck five times. `_npmInstall` now writes `/tmp/nbai-npm-install.lock`
  (`NPM_INSTALL_LOCK`); `TSC_ENSURE` waits up to 20 s for it, then prints "still being installed" and checks
  nothing rather than starting a second install; a torn compiler is removed and reinstalled; and
  `looksLikeBrokenTscInstall` makes `tscVerdict` call any such output "did not run". ⚠️ A lock older than
  6 minutes is ignored (an install is bounded at 5).
- **📣 `AGENTV3_SUMMARY_ADDITIONS` — THE END OF A SUCCESSFUL BUILD IS WHAT THE USER STILL HAS TO DO (admin
  2026-09-30: *"app banne ke last me clearly user ko dikhe"*). ⚠️ NOT set, and the code default is ON**; `off`
  restores the old behaviour. `summaryAdditions.ts`.
  🔴 **WHY: on a SUCCESSFUL build the chat panel never rendered `result.summary`**. It is rendered only on
  failure. So every line the platform appended to a successful reply never reached a screen:
  - the "what this app needs from you" key checklist (AppRequirements, since 2026-08-03);
  - claim corrections;
  - the green-repair line;
  - the review offers;
  - the live-preview line.

  Only the separate cards (the key-entry card, the suggestion card) were visible. The route now records
  every chat line the user has seen and sends the summary minus the model's reply as the build's final
  chat line.
  🔒 **It is sent from the SERVER on purpose:** the phone apps are bundled, so a panel change would reach
  them only with a new store build. If the reply cannot be found in the summary, nothing is sent
  (`SUMMARY_REPLY_NOT_FOUND`), because a repeated reply is worse than a missing note.
  🤖 **AI inside the app, same change:**
  - **Builder:** `AI_IN_APP_RULE` makes the builder call AI from the app's server through one standard
    request configured by `AI_API_KEY` / `AI_BASE_URL` (default `https://navbharatai.com/api/v1`) /
    `AI_MODEL` (default `navbharatai`). The NavBharatAI API does not accept calls from other sites'
    browser pages, so a browser-side call could never work with it.
  - **Checklist:** for an app that reads `AI_API_KEY`, it offers both a NavBharatAI API key (Home → Other
    AI → Developer Tools → NavBharatAI API) and the user's own OpenAI / Anthropic / Google / xAI key, in
    11 languages. For an app written against one provider's client, the NavBharatAI option is never
    offered, because it would not work there.
  - **Asking last:** the architect prompt's ASK LAST rule puts the model's own questions at the end of
    its reply.

  Test-locked in `tests/theAskComesLast.test.ts`.
- **🐍 `AGENTV3_PYTHON_BACKEND_BOOT` — A PYTHON BACKEND COMES BACK WITH ITS APP (Q-284, autopsy 241215d1, 2026-10-04).
  ⚠️ NOT set; default ON; `off` reverts.** `pythonBackendBoot.ts`. Every platform start of an app (the preview wake,
  our own preview start, both in-build restarts) used to run only `npm run dev`, so a FastAPI/Flask server came back
  with no venv and no process. Now one plan (start command read by `pythonStart.ts`, port from the front end's proxy
  target, else the server's own, else 8000) is used by the service graph (a `python:` backend) and by every start
  path, which boots it first: venv, install only when the manifest changed (`timeout 240`), detached start, 30 s port
  wait. The script is sent base64-encoded so it is never treated as a dev-server launch. 🔒 No declared server ⇒ no
  plan ⇒ the old behaviour. A recipe recorded from the backend's launch is never replayed as the preview.
  Report codes `PYTHON_BACKEND_UP` (process-only) / `PYTHON_BACKEND_NOT_UP`.
- **📝 `AGENTV3_SCRIPT_REQUEST_NOTE` — A SCRIPT REQUEST IS BUILT AS A WEB APP, AND THE USER HEARS IT FIRST (Q-274,
  admin chose "a" 2026-10-04). ⚠️ NOT set; default ON; `off` reverts.** `scriptRequest.ts`: a request for a Python
  script, a command-line tool, a Streamlit dashboard or a notebook (precision-first: a film script, JavaScript, a
  build script, a conversion or an explicit web-app request stand down) gets a builder note and one start-of-build
  line. When live data was asked, sample data must be labelled "Sample data", and `claimAudit` (`live-data-claimed`)
  corrects a summary that calls a simulated feed live. Report code `SCRIPT_REQUEST_AS_WEB_APP` (process-only).
- **📋 A PASTED APP IS THE SPEC, AND PASTED CODE IS NOT PROSE (autopsy a106df77, 2026-10-01).** Two keys, NEITHER
  set, default ON: **`AGENTV3_PASTED_APP_BRIEF`** (`off` drops the brief). A user pasted their own HTML bill maker with no other words.
  The published title became `<!doctype html> <html lang="en"> <head>`, a `<meta content="width=…">` was shown
  to them as "the app you asked for", and the rebuild dropped their "Items" tab.
  - `lib/pastedSource.ts` is the ONE detector: an HTML document, or 8+ code lines making up most of the paste.
  - Every reader of the user's WORDS reads `readablePrompt` (the text around the paste) or, through
    `withoutMachineText`, those words plus the page's visible text. The size readers (`RequestAnalyser`,
    `BuildTimeEstimator`) pass `keepPasted`, so routing is unchanged.
  - The builder (both lanes) gets `pastedAppBrief`: the page's name, every tab, button, field and colour, and
    "improve, never remove".
  - Same autopsy, no keys: nested `<Route path="new">` routes are joined to their parents
    (`routerPaths.ts`), and the page check and the journey read them. `summaryAdditions` matches through the
    narration's emoji rule. `@types/X` beside a self-typed X is advised "remove it" (`lib/selfTypedPackages.ts`).
  - The end-of-turn hand-back for undefined classes is #3425's `stylePolishResume.ts` (`AGENTV3_STYLE_RESUME`).
    This PR had built a duplicate of it; the duplicate was removed when `main` was merged in.
  - ⚠️ Precision first: an ordinary prompt is returned byte for byte. A one-tag sentence or a stack trace is
    not pasted source.
  - Test-locked and reversion-proven in `tests/aPastedAppIsTheSpec.test.ts`.
  - 🧭 **Follow-up, admin "han karo": `AGENTV3_FEATURE_PROBE_SCREENS`** (NOT set; default ON; `off` reverts).
    When the home screen leaves a requested control unseen, the feature probe reads up to 4 of the app's own
    routes within 45 s, and judges them together with home (`featureProbeScreens.ts`). Only screens that
    rendered count. It never runs behind a sign-in session.
    ⚠️ Those screens are read with `browseUrl(…, { recordConsole: false })`. A repair re-checks only home, so
    an error recorded from another screen would read as surviving its fix. Test-locked in
    `tests/aControlOnAnotherScreenIsNotMissing.test.ts`.
  - 📄 **A PASTED ONE-FILE APP STAYS ONE FILE (admin 2026-10-01: "banao", after being asked to choose):
    `AGENTV3_PASTED_KEEPS_FORMAT`** (NOT set; default ON; `off` restores the React rebuild).
    - **The rule:** the format that was pasted is the format that comes back (`pastedAppFormat.ts`). A NEW
      build whose prompt is a whole pasted HTML page runs on `static`. The user's page is written over the
      untouched static starter as `index.html`, and `script.js`/`style.css` are removed. Both lanes get
      `pastedOneFileRule`: improve in place, one file, keep its own look, never link the kit, and keep the
      page's storage names, so data already saved on the user's device is still read.
    - **When React is used instead, exactly as before:** the user's WORDS (never the paste) name a framework
      or ask for something one file cannot carry (login, database, backend, several users, "full app",
      React); the user picked a framework in the picker; or the turn is an edit of an app that exists. A
      turn re-read as an edit gives the framework back.
    - **Big-app planners stand down:** no fast-lane regeneration, no milestones, no module plan.
    - **The user's page is not billed as our delivered work** unless the build changed it (`preseededGolden`).
    - **The upgrade offer:** report code `PASTED_APP_KEPT_ONE_FILE` is process-only. It shows the one-tap
      "Upgrade to a full app project", which keeps the same screens and storage names.
    - ⚠️ **What happens in practice is unmeasured:** no real pasted-page build has run this path yet. Watch
      the first `PASTED_APP_KEPT_ONE_FILE` report for a model that rewrites the file instead of editing it.
    - Test-locked and reversion-proven in `tests/aPastedOneFileAppStaysOneFile.test.ts`.
  - 🧹 **A PACKAGE THIS BUILD INSTALLED AND NEVER USED IS REMOVED (admin 2026-10-01, the other approved
    a106df77 item): `AGENTV3_PRUNE_UNUSED_DEPS`** (NOT set; default ON; `off` keeps today's warning-only behaviour).
    - **Only a package THIS build added** (`unusedDepPrune.ts`). The baseline is the `package.json` read after
      every platform seed and before the first model call. With no readable baseline nothing is removed. A
      package the user had is never touched.
    - **It must also be unused:** `findUnusedDependencies` says so, no other file names it (a config, a CSS
      `@import`, an HTML tag or a string-load keeps it), it is not tooling (plugin, CLI, compiler, polyfill),
      and no other declared package lists it as a dependency or peer (read from `node_modules`). At most 5.
    - **Verify-and-restore:** back up `package.json` and the lock, `npm uninstall`, run the app's own
      `npm run build`. Kept only if the build passes; otherwise both files go back and `npm install` restores
      `node_modules`. No build script ⇒ nothing is removed.
    - **Never on** an import, a project-mode module or roadmap milestone turn (a package for a later module is
      not unused yet), a stopped build, or a workspace already latched green. Report codes
      `UNUSED_DEPS_REMOVED` / `UNUSED_DEPS_KEPT`; the user sees one line naming the packages.
    - Proven on a real npm project in the session (a wrong removal reverted, a real one removed, a peer kept).
      Test-locked and reversion-proven in `tests/aPackageThisBuildNeverUsedIsRemoved.test.ts`.
  - 🗑️ **A FILE THE FAST LANE SALVAGED AND THE APP NEVER USES IS REMOVED (autopsy f496c75b, 2026-10-04):
    `AGENTV3_PRUNE_DEAD_SALVAGE`** (NOT set; default ON; `off` keeps them). `deadSalvage.ts`: only salvaged
    files, only ones no other file refers to by path (a fixpoint, so a pair that only import each other go
    together), never an entry/config/routed file, at most 12; kept only if the app's own `npm run build`
    passes, otherwise every file is written back. Report `DEAD_SALVAGE_REMOVED` / `_KEPT` (process-only).
- **`AGENTV3_STORE_LOOP_NOTE`** (default ON, `off` disables — added 2026-09-29, autopsy 6a4a799f) — a
  write-time note (`storeEffectLoop.ts`, via `ToolDispatcher.writeSteeringNotes`) when a file binds a
  zustand hook with NO selector (`const store = useMusicStore()`), lists that bare name in an effect's
  dependencies and calls one of its actions inside the effect. That loops forever ("Maximum update depth
  exceeded") and was what left "Blue Berry" on its error screen. No model call; never blocks a write.
  🔴 **Same autopsy: the scaffold's own ErrorBoundary screen is now judged NOT rendered**
  (`scaffoldCrashScreen` in `PreviewVerify.ts`). Before, it was saved as the last known good at 809 s.
  Do not loosen that match to the bare words; an app's designed error card must stay a render.
- **🧭 A FORM ON A WIZARD STEP IS REACHED (Q-016, autopsy 2b1f845e; no flag).** A form-bearing component no
  page reaches (`src/steps/DesignStep.tsx`) gets a save journey on `/` that first presses the ONE visible control
  named after its screen (`reachWordFor` → "design"), and presses it again after the reload. 🔒 An action word
  ("post", "pay", "send", "delete", "add") never becomes the reach word, a destructive or creating control is
  never pressed, and a form whose submit is outward gets no journey. No matching control ⇒ `unreachable`, never
  a failure. Real-browser test: `tests/aFormOnAWizardStepIsReached.test.ts`.
- **`AGENTV3_NPM_VERSION_HINT`** (NOT set; default ON, `off` disables — added 2026-10-01, autopsy 2b1f845e) — an
  `npm install` that fails with ETARGET (a guessed range such as `cors@^4` that does not exist) gets the real latest
  version from one `npm view`, appended to the same tool result (`npmVersionHint.ts`). Advice only. Same autopsy, no
  flags: one never-the-app port list (`neverAppPorts.ts` — the sandbox agent 49983, rpcbind, SSH, our CDP port and the
  data services) replaces five drifted copies; a subshell-wrapped `git commit` naming a `vite.*` file is no longer a
  dev-server launch (`withoutGroupingPrefix`); DB/auth templates never throw at import.
- **📱 PHONE FEATURES — `nativeCapabilities.ts` is the ONE table (built 2026-09-27, admin: *"jarwis jaisa
  app … navbharatai banayega"*).** It feeds the builder's brief, the user's summary (web / phone app / impossible,
  with More → Download APK + connect GitHub) and the phone build (plugin versions aligned to the app's
  Capacitor major; Android permissions + iOS usage strings added on the runner from the app's own package.json).
  🔒 **Every plugin version was verified on npm against Capacitor 7, the phone build's default** — most plugins'
  latest releases need 8. A test fails if `DEFAULT_CAPACITOR_MAJOR` moves, so re-verify the table before bumping it.
  Play-restricted permissions are test-locked out. **`AGENTV3_LABEL_REPAIR`** (NOT set, default ON; `off`
  reverts) — an unlabelled field whose literal placeholder names it gets that text as its `aria-label`.
- **`AGENTV3_ARCH_INVARIANTS`** (default ON, set `off` to disable) — before EDITING an existing app, the
  engine reads that app's OWN rules out of its code (styling system, import style, where network calls
  go, where pages live) and hands them to the builder before it writes a line; after the build it checks
  the changed files against the rules derived from the project as it was BEFORE the build. Costs no file
  reads (it uses the already-warm graph) and no model call. Purely advisory — it can never fail a build.
  Report codes: `ARCHITECTURE_INVARIANTS_HELD` (clean) / `ARCHITECTURE_INVARIANT_VIOLATED`.
- **🎨 THE IN-BROWSER PREVIEW RENDERS CSS MODULES AND TAILWIND v4, AND THE REAL BROWSER MEASURES STYLING (admin
  2026-09-28: *"user ko aise farzi app na mile! … sundar aur real cheez bane fake/farzi nahi!!"*; no flag).** Both
  in-browser renderers (`src/server/runtime/ReactPreview.ts` — the preview pane, the admin Built-apps preview, every
  App Mart web player; and `src/lib/previewUtils.ts`) answered every `.css` import with `exports: {}`, so a CSS-Module
  app rendered with every class blank, and only Tailwind v3 was detected, so a v4 app got a compiler that emits
  nothing. `previewFidelity.ts` KNEW and said so in a caveat. **A well-built app was shown as raw HTML, and the label
  made that feel handled.** Now: `src/lib/cssModules.ts` (ONE pure transform, both renderers, path-hash scope +
  class map shipped in the bundle) and `src/lib/previewTailwind.ts` (ONE detector: v3 → Play CDN + shadcn config,
  v4 → `@tailwindcss/browser@4`). ⚠️ A NEW reader of `.css` in either loader must go through `cssModuleExportsJs`
  and `TAILWIND_DIRECTIVE_RE_SOURCE`; a second copy is the drifted-copy class. And `renderStyle.ts`: the browse
  script measures a painted page (author rules, font rule, default-looking buttons) and the route records
  `UNSTYLED_RENDER` / `RENDER_STYLE`, tells the user in plain words with a one-tap repair, and the claim audit
  contradicts "beautiful, polished UI" about a raw-HTML page. **Evidence, not a gate — it fails no build and moves no
  money**; a post-render styling heal is deliberately NOT wired until `UNSTYLED_RENDER` has appeared on real builds.
  The fast lane's convention now names ONE global stylesheet as the default (CSS Modules only where the project
  already uses them) — it used to say "CSS Modules (default)" a paragraph after the design contract said the
  opposite. Test-locked and reversion-proven in `tests/theCssModulesCameOutBlank.test.ts` and
  `tests/theRenderedAppLookedLikeRawHtml.test.ts`.
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
  🔴 **THE FINDING IS PROVEN BEFORE THE APP IS EDITED (autopsy 972acde5, 2026-09-30).** The pass was
  handed `judgeRepairPrompt`, which calls every finding a "real problem that must be fixed". That is true
  of a failed build's judge verdict and false of a reviewer's reading of working code. On a correct
  calculator, the repair traced the reviewer's CRITICAL and wrote *"this happened to work"*, then edited
  the app anyway. The user was told a real problem had been fixed. It now gets `greenRepairPrompt`: prove
  each finding with one concrete input, change nothing for the rest, and end with `CONFIRMED n` /
  `NOT A BUG n` lines, read by `readRepairVerdicts`. When every finding is refuted, whatever it changed
  is undone (`REVIEW_FUNCTIONAL_REFUTED`). A refuted finding is never claimed as fixed and never offered
  to the user. Unreadable verdicts ⇒ the previous behaviour. Test-locked in `tests/theCalculatorAutopsy.test.ts`.
- **ONE BUILD PER APP ACROSS SERVERS, AND SCOPED REPAIRS — built ONCE, by #3331 (autopsy eed79815 =
  "4D Future City Drive", 2026-09-26).** The lease is `AgentV3/workspaceBuildLease.ts` (kill switch
  `AGENTV3_WORKSPACE_LEASE=off`; see SCALE PLAN §2), the repair scope is `limitRepairToScope` +
  `pathsNamedInErrors` in `SimpleBuilder.ts`, and the echoed format example is refused in
  `parseFileBlocks` (`isEchoedFormatExample`).
  🔴 **THE SAME REPORT WAS AUTOPSIED BY TWO SESSIONS AT ONCE, and each built its own lease, its own repair
  scope and its own marker fix — same file name, same collection.** #3331 merged first; #3332 was cut
  back to the two pieces #3331 did not carry (below and the marker sibling in `FastLaneContinuation`).
  **This is safeguard #6's open-PR check failing in real time:** neither PR existed when the other session
  started. When a report is pasted into more than one session, the admin's naming of ONE owner is the
  only thing that prevents this. ⚠️ **Not ported, offered to the admin instead:** following a build that
  runs on another server live (a `/status` that reports it, an `/attach` that says so), so a dropped
  connection shows the running build rather than "network error". Today the retry is REFUSED with
  `BUILD_RUNNING_ELSEWHERE` and a Stop — no second build, but the first screen still reads as an error.
- **🧊 A GREEN APP MAY RESTORE ITS OWN FILES (same autopsy, 2026-09-26; no flag).** After build C was
  verified working, copying the app's OWN saved files back into its sandbox was refused one file at a time
  — **49 `GREEN_FREEZE_DEFERRED` lines**, each telling the user *"Reply if you want this change made"*,
  one about `.nbai-landing.tar.gz`. A write with no pass name is an unknown writer to the freeze, and the
  actuator's restore had been named `sandbox-file-restore` on 2026-08-20 while its three route siblings
  (preview revive, the restore-files route, the build-start data-loss restore) and the shared asset
  restore never were — the headline class once more. All three now carry the name, and
  `restoreWorkspaceAssets` **names itself**, so a fourth caller cannot forget it. ⚠️ `writeWorkspaceFiles`
  is deliberately NOT named inside: it also lands IMPORTS, which are not restores. Source-guarded and
  reversion-proven in `tests/aGreenAppMayRestoreItsOwnFiles.test.ts`.
- **`AGENTV3_FASTLANE_REASONING_GATE`** (default ON, `off` reverts — added 2026-09-23, autopsy ac41a924,
  PR #3278). The fast lane is skipped when the build opens on a model that ALWAYS reasons
  (`modelAlwaysReasons`). Its single plan call is capped at 90 s, a cap sized for a rung that answers
  directly, so on `kimi-k2.7-code` it spent the whole cap thinking and handed over nothing.
  `fastLaneRungDecision` in `fastLaneRung.ts`; report code `FAST_LANE_SKIPPED_REASONING_RUNG`.
- **`AGENTV3_HANDOFF_EARLY_SAVE`** (NOT set; default ON; `off` restores the old wait-then-save — Q-422, autopsy
  1eaa5f5a, admin chose "wait, but show the finished files" 2026-10-04). When the fast lane decides mid-tier to hand
  off (`stopLane`), the tier still waits for the calls in flight (67 s there, nothing on screen, the user pressed
  Stop). The files finished at that moment are now saved and announced (`onFilesReady`) at once, and each in-flight
  file as it lands; the catch waits for those saves before its import-fixed salvage write, so the salvage stays the
  last word. Calls are NOT cancelled (the wait salvaged App.tsx). Test: `tests/theHandOffShowsWhatIsFinished.test.ts`.
- **`AGENTV3_FASTLANE_GAMES`** (NOT set; unset ⇒ a GAME skips the fast lane; `on` lets games back in —
  added 2026-09-30, autopsy 0bb437b4). The lane has no tools, so it cannot run the game recipes the full
  builder's prompt requires for any game. For "Make a racing game" it planned five generic files, spent
  96 s and wrote nothing. The domain is `analyzeRequirementGaps(prompt).domain === 'game'`;
  `fastLaneSkipsGame` in `fastLaneRung.ts`; report code `FAST_LANE_SKIPPED_GAME` (process-only).
  Same autopsy, no flags: every in-sandbox browser lane opens pages with `reducedMotion: 'reduce'`
  (`BROWSER_PAGE_OPTIONS`, one definition), because the kit's game button pulses for ever and Playwright
  never presses a moving element. The explorer dispatches the click on the same element only for a
  "not stable" failure.
- **🖼️ AN APP THAT MAKES PICTURES REALLY MAKES THEM — `generate_image_ai` (admin 2026-10-01, verbatim:
  *"jab user apni api key dalna chahe kisi aur provider ki to bhi dal sakta ho, jab chahe change kare, agar
  user keys na de, to default pollination ai"*).** A recipe (`src/server/lib/ImageAiGenerator.ts`, reached
  through `run_recipe`) writes a modular engine into the USER's app: `ImageGenerationProvider` →
  `PollinationsProvider` / `ServerImageProvider` in `src/lib/imageAi.ts`, plus `useImageGenerator()` for React.
  - **Default (`server` left out): the page calls Pollinations directly** (`image.pollinations.ai`, `safe=true`,
    `private=true`). No key exists, so nothing can leak, and it works the same in the preview and after publish.
  - **`server: true`: the page posts to the app's own `/api/generate-image`**, and `server/lib/imageAi.ts` picks
    the engine on every request from the APP's env: no `IMAGE_API_KEY` ⇒ Pollinations; otherwise `IMAGE_PROVIDER`
    = `pollinations` | `openai` (any OpenAI-compatible images API via `IMAGE_BASE_URL`) | `stability`, with
    `IMAGE_MODEL`, and `IMAGE_RATE_PER_MINUTE` (default 10 per visitor). The owner sets them in Settings → App
    Settings → Secrets & API Keys; the vault reaches the app's `.env` at boot (`devSecretsBoot.ts`), so a change
    applies on the next start with no code change. ⚠️ These are the USER's app keys, not Cloud Run keys.
  - 🔒 **A key with an unknown `IMAGE_PROVIDER` is sent NOWHERE** (an honest 500): guessing would hand one
    company's key to another. A provider's refusal reaches the visitor as plain words; the detail goes to the log.
  - `IMAGE_IN_APP_RULE` (`AgentV3/inAppImageGeneration.ts`) is read by the architect and every writing
    sub-agent. **`AGENTV3_FASTLANE_IMAGE_APPS`** (NOT set; unset ⇒ an app that makes pictures skips the fast
    lane, which cannot run a recipe; `on` lets it back) — `appGeneratesImages(prompt)`, report code
    `FAST_LANE_SKIPPED_IMAGE_APP` (process-only).
  - ⚠️ **Not verified against the live provider from a session** (its hosts are refused by the session's egress
    policy). The generated code is compiled with the real TypeScript compiler under strict Vite settings and RUN
    against a fake network in `tests/anImageAppMakesRealPictures.test.ts`; the first real build is the first live
    evidence. ⚠️ A published STATIC app has no server, so the own-key path needs the app's server hosted
    (NavBharat Cloud, which is admin-only today) — the Pollinations default needs nothing.
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
  🔒 **When every changed file fits inline, the lean review has NO tools (autopsy bee95692, 2026-09-30)** —
  it was handed the code and read it all again anyway, then timed out; `leanReviewAnswersInOneCall` +
  `toolsOverride: []`. ⚠️ Do NOT "save money" by skipping this review on green apps: it is also what
  finds the bugs for `AGENTV3_GREEN_FUNCTIONAL_REPAIR` (the admin was asked and chose the fix).
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

- **`AGENTV3_SIGNIN_EXPLORE`** (default ON, set `off` to disable — added 2026-09-30, autopsy 8e124182, admin:
  *"login ke andar wali jaanch bhi banao"*) — **the checks look behind the sign-in page.** A stock app put
  every screen behind `/login`, and the page check, the form journeys, the click explorer and the feature
  probe all stopped at the door (the probe then called the stock list missing and spent a repair on it).
  `signInExplore.ts` signs in ONCE, in the sandbox browser, with credentials THE APP ITSELF SHIPS — the form
  it pre-fills, a seed/demo account in its source (object pairs, an email→password-constant map, a demo hint)
  — saves the session to `/tmp/nbai-signed-in.json`, and the page check, the journeys (except the sign-in form
  itself) and the explorer open the app with it; the feature probe reads up to 6 screens behind the door.
  🔒 **It never guesses a password, never tries more than 3 candidates, never creates an account, and never
  prints a credential** — the report says only where the account came from. A failed sign-in is never read
  as success (the password field must be gone). No credentials ⇒ `AUTH_EXPLORE_NOT_RUN` with the reason, and
  every check runs signed-out as before. Codes are `PROCESS_ONLY_CODES`/`NEVER_SUGGEST` (our instrument).
  Real-browser tests in `tests/weLookBehindTheSignInPage.test.ts`. ⚠️ The same change makes a sign-in form
  that STARTS with a password typed in a medium security finding (`prefilled-password`) — so new apps
  mostly ship the demo account as source/hint text, which this reads too.
- **📱 MOBILE FIRST — games get touch controls, apps are measured on a phone (admin 2026-09-30, verbatim:
  *"mobile friendly game/app bane — mobile first!!!!!!"*).** Two keys, NEITHER set, both default ON.
  🔴 **WHY:** the game runtime's `Input` has accepted a touch joystick and virtual buttons since it was
  written, but NOTHING DREW THEM — a game built for WASD + mouse (autopsy 6a55d939, "god of war")
  rendered on a phone and could not be played, the HUD paused only on Escape, and `AppKnowledgeBase`
  told users all along that games "work on a phone". And every browser check we own opened apps at
  1280×720 — nothing ever looked at an app on a phone.
  - **The game shell draws the controls** (`GameShellGenerator` → `src/game/ui/touchControls.ts`, no
    flag — it is part of the recipe): joystick under the left thumb, camera drag on the right,
    Attack/Jump/Use/Run bottom-right (64px), a HUD Pause button for every device, multi-touch by
    pointer id, everything released on blur. Shown where the PRIMARY pointer is coarse, or on the first
    real touch; a mouse never sees it. `touchControls: { buttons: [...] }` chooses buttons; `false` only
    for a game with its own. Proven with real `tsc` over all seven recipes and real CDP touch events.
  - **`AGENTV3_TOUCH_GAME_NOTE`** (`off` disables): a game written WITHOUT the shell (a single-file HTML
    game, a hand-rolled canvas loop) whose file has a render loop, keyboard control keys and no touch
    handling gets a write-time note, once per build (`touchPlayableGame.ts`).
  - **`AGENTV3_MOBILE_LAYOUT`** (`off` disables): after the app renders, it is opened ONCE at 390×844
    with touch (`mobileLayoutCheck.ts`) and measured for sideways scroll and tap targets under 32px.
    ⚠️ **Measure against `documentElement.clientWidth`, never `innerWidth`**: at phone size `innerWidth`
    GROWS to fit overflowing content (measured 708 on a 390px screen with a 700px box), which hides
    exactly the sideways scroll being looked for — the first version of this check did that. Evidence,
    never a gate; `MOBILE_LAYOUT_ISSUES` becomes the one-tap offer "Make it fit a phone".
    `MOBILE_LAYOUT_OK` / `_NOT_RUN` are process-only.
- **🔁 A RENDERED APP'S CONSOLE LINE IS CHECKED AGAIN BEFORE A REPAIR, AND OUR OWN NOTICE IS NOT A REQUEST
  (autopsy 12511a9c, 2026-09-30).** Two keys, NEITHER set, both default ON; `off` reverts each alone.
  - **`AGENTV3_CONSOLE_RECHECK`** (`renderCheckConsole.ts`): an app that RENDERED in a real browser, where
    the only evidence against it is its console, gets one free second look before a repair is paid for
    (`PREVIEW_CONSOLE_RECHECK`). A calculator (158 CSS rules, 20/20 buttons styled) was repaired twice
    (~90 s, then ~3 min with a 118 s model call) for "The script has an unsupported MIME type
    ('text/html')". That is Chrome's message for a service worker whose script came back as HTML. The
    defaults pass had written `register('/sw.js')` into index.html BEFORE writing public/sw.js. The pass now
    writes index.html LAST. And the runtime auto-fix reads the console only from the last CLEAN real-browser
    check (`runtimeAutofixSince`): its fixed 180 s window was the sibling the 7d79254b fix never reached.
  - **`AGENTV3_NOTICE_ECHO`** (`platformNoticeEcho.ts`): a prompt that IS one of our own notices (the
    weak-tier welcome or build-failed notice, any language, or a 60+ character piece of one) is answered
    with a fixed line naming the user's earlier request. No model call, no build, and it is never recorded as a
    request. The report's prompt was the notice byte for byte, most likely copied from the notice bubble.
    The build ran on our words and shipped them as the app's og:description. Second instance of the class
    after fdd59ef8 (our sign-in notice).
- **`AGENTV3_CLICK_EXPLORE`** (default ON, set `off` to disable — added 2026-09-28, competitive gap G1,
  admin: *"best solution jo gaps ko fill kar ke navbharatai ko compatitors se aage la jaye"*) — **the
  app is PRESSED, not only painted.** Every post-build check watched the app render or drove ONE derived
  form; nothing pressed the rest of it, so a tab that white-screens, a button whose handler throws and a
  link to a page that was never written survived every check we own. `clickExplorer.ts` opens the running
  app in the sandbox's pre-baked browser and presses up to 12 visible controls, EACH ON A FRESH LOAD (so a
  failure belongs to exactly one control), recording an error overlay, a blank root, an in-app link that
  lands on a missing page, or an uncaught error. **No model call.** Measured on a local test page: seven
  presses in ~10 s.
  🪜 **ONE LEVEL DEEPER (2026-09-28, same day):** a first-screen press that WORKED and CHANGED the screen
  (a tab, a menu, an in-app link) is looked at again, and the controls it revealed — never ones the first
  screen already had — are pressed too: up to **8** more (`MAX_SECOND_LEVEL_CLICKS`), at most **2** under
  any one parent (`MAX_SECOND_LEVEL_PER_PARENT`), each on a fresh load with the parent pressed UNARMED
  first so nothing the parent does is blamed on the child. The same never-press rules apply. A failure is
  named with its screen (*"Pressing "Refresh" (on the "Reports" screen) …"*). The 75 s budget is
  unchanged, so first-screen presses always go first and a slow app loses depth, never coverage.
  ⚠️ **THE RUNNER IS A TS TEMPLATE, SO EVERY BACKSLASH IS DOUBLED** — a single `\b` reaches the page as a
  backspace, parses fine, and silently never matches. `node --check` cannot see it; a test now fails on
  any raw control character in the generated module.
  🔒 **WHAT IT WILL NOT PRESS IS THE DESIGN:** any name matching `NEVER_PRESS` (delete, clear, pay, buy,
  checkout, send, share, upload, download, log out, …), a form's submit (the journey owns forms), a link
  out of the app (another origin, `mailto:`/`tel:`, a new tab, a download), a control with no readable
  name (an unnamed icon is as likely a trash can) — and, when `writesToUserDatabase` is true, every
  creating verb too (`WRITE_VERBS`), the same rule the journey obeys. Browser dialogs are DISMISSED. The
  in-page collector receives the exported regexes as data rather than a copy of them.
  ⚠️ **The words are not only English (autopsy de3bb2bb, 2026-10-01):** a Hindi app's "Saara data hatayein"
  button was a press away. `localActionWords.ts` holds the Hinglish and Devanagari destructive, spending and
  creating words, read by BOTH `NEVER_PRESS`/`WRITE_VERBS` and the sign-in explorer's `SIGN_IN_NEVER`.
  🔒 **THREE OUTCOMES, never two:** `EXPLORE_PASSED` / `EXPLORE_FAILED` need a loaded app and a completed
  press; `EXPLORE_NOT_RUN` (never reached the app) and `EXPLORE_NOTHING_TO_PRESS` are facts about OUR
  instrument, registered in `PROCESS_ONLY_CODES` and `NEVER_SUGGEST`. A press that could not complete
  (covered, detached, timed out) is `skipped`, never a failure. `EXPLORE_FAILED` offers the user one
  next step ("Fix the button that breaks your app").
  ⚠️ **THE BUILD CARD HAS ONE SLOT** (`state.verification`), so the journey's proof is now HELD and emitted
  once, merged with this one (`mergeUserProofs`) — a second `verified` event would have erased the
  first. A source guard asserts there is exactly one `emit({ type: 'verified'` in the route.
  ⚠️ **Evidence, never a gate**: it never fails a build and never spends a repair; runs only with ≥90 s of
  build budget left. It does NOT attach the console recorder, deliberately — its errors are attributed per
  press, and feeding them into the runtime auto-fix window would be a spend decision nobody took.
  Test-locked and reversion-proven in `tests/theAppIsPressedNotOnlyPainted.test.ts`, whose real-browser
  half runs wherever Chromium exists (`/opt/pw-browsers`) and is skipped in CI, which has none.
  **What to watch:** `EXPLORE_FAILED` on real builds — each is a button a user would have found broken in
  their first minute. A crop of `EXPLORE_NOT_RUN` means the runner, not the apps, needs looking at.
  🔎 **IT TRIES A SEARCH BOX AND A SORT MENU TOO (2026-09-30, admin: *"haan, search/sort wala check bana do"*,
  after autopsy ee0e6de5, whose lookup app was "nothing safe to press"). No flag of its own.** After the
  first-screen presses, up to `MAX_NARROWING_PROBES` (3) controls are tried on a fresh load: a word from the
  list's own items is typed (`pickSearchWord`), or another option is picked, and the screen's words (form
  controls removed) are compared. A control that changed nothing is `unresponsive` — in `FAILING_VERDICTS`,
  which `explorerRepair.ts` now reads instead of its own copy, so it is reported AND repaired like a crash.
  🔒 Precision first: only a control that names itself a search (`SEARCH_CONTROL`, Hindi included) or a
  sort/filter menu (`SORT_CONTROL`, deliberately not "type"/"status"); never inside a form, a dialog or a
  row of the list; no menus at all when the app writes to the user's own database; a list of ≥3 items
  (search) or 2 distinct (sort); a search with a button beside it is `skipped`, never called broken.
  Real-browser test: `tests/theSearchBoxIsTypedInto.test.ts`.
  🌓 **AND A LIGHT/DARK SWITCH IS PRESSED UNTIL THE COLOURS CHANGE (autopsy 8257ca59, 2026-10-01; no flag).**
  A calculator's polish step replaced the template's working ThemeToggle with a 🌓 button that toggled a `dark`
  class nothing styles; the explorer called it *"it responded (nothing visibly changed)"* because it compares
  TEXT. A control named as a theme switch (`THEME_CONTROL`: text, aria-label or title; never a bare "Light"/"Day")
  is now pressed up to `MAX_THEME_PRESSES` (3, for Auto → Light → Dark) and judged by the computed colours of
  the page, with the mouse moved away and focus dropped first, so a hover style is never the theme changing.
  No change ⇒ `unresponsive`, reported and repaired like a broken button. Same autopsy, no flags:
  - `deadThemeSwitch.ts`: a write that switches a class or `data-*` attribute on `<html>`/`<body>` that no
    stylesheet, `<style>` string or Tailwind `dark:` styles gets a write-time note naming the project's own
    mechanism (silent unless the whole project could be read).
  - The template ThemeToggle reads "🌓 Auto / ☀️ Light / 🌙 Dark" (it read "Auto"), and the VERIFY & FINISH
    prompt tells the polish step to keep the template's own controls.
  - The release gate reads the explorer (`explore`, `explorePresses`): pressed controls are proof of
    interaction for every app, and for an app with nothing to save they are its journey and can earn GREEN.
    `JOURNEY_NOT_DERIVED` names the file and line that made an app read as taking input (`dataEntryEvidence`).
  - The review's "changed this turn" leaves out pre-seeded template files the builder never touched
    (`reviewChangedPaths`), so a scaffolded app's lean review stays one call with no tools.
  - An untouched file orphaned by this build removing its last import is reported as this build's doing
    (`droppedRelativeImports`), not as "your existing code".
  - The write-time typecheck warm-up claims a warm cache only when it compiled (`WARMUP_COMPILED_MARKER`).
  Test-locked and reversion-proven in `tests/theThemeSwitchThatDidNotSwitch.test.ts`.
  🔧 **AND NOW IT FIXES WHAT IT FINDS — `AGENTV3_EXPLORER_REPAIR` (2026-09-28, admin: *"han dono ho jaye …
  real engineering kar ke, world class banao"*). ⚠️ NOT set; code default ON; `off` restores report-only.**
  `explorerRepair.ts`. One bounded repair pass (allowlisted pass `explorer-repair`, refused every `.env`),
  then EVERY button is pressed again. **Kept only if the app renders, a broken control now WORKS (pressed,
  not merely present — deleting the button is not a fix) and no control that worked broke.** Anything
  else — timeout, a failed pass, a re-check that threw, a regression — is undone to the green snapshot, and
  the pass's billing phase (`PHASE_EXPLORER_REPAIR`) goes barren, so **an undone repair is never billed.**
  A kept repair whose re-press found nothing broken clears the earlier `EXPLORE_FAILED`
  (`BuildDiagnostics.resolveOnRecheck`) so the release gate is not held yellow by buttons that now work.
  Report codes `EXPLORE_REPAIRED` / `_NO_CHANGE` / `_UNDONE` / `_SKIPPED`.
  💸 **Normal/Strong always. Weak under `AGENTV3_EXPLORER_REPAIR_WEAK_DAILY`** (NOT set; default **100
  repairs a day, platform-wide**; `0` = never on Weak; `off` = no cap; unreadable ⇒ 100, never unlimited).
  Counted per ATTEMPT in `explorer_repair_weak_daily`, and it **fails closed** — an unreadable counter
  refuses the repair and the broken button is reported exactly as before. Free-listed accounts are neither
  counted nor refused. ⚠️ **100 is a starting point, not a measurement**: nobody has measured one Weak
  repair's cost yet. `[AGENTV3] free-tier explorer repair allowance reached` in the log (once per day) is
  what says whether it is right.
  🔴 **SIBLING FIXED IN THE SAME CHANGE:** `verifyAfterFix` KEEPS a change whose re-check throws (right for
  a crash fix), and the reviewer's green repair — which promises "an unproven result is UNDONE" — relied on
  it, so a browser timeout during its check kept the edit. Both repairs now wrap their re-check in
  `strictReverify`; the crash-fix callers are untouched.
- **💰 `AGENTV3_LIVE_COST` — the build shows what it has cost SO FAR (2026-09-28, admin approved "build ke
  dauraan live ₹ kharcha"). ⚠️ NOT set; code default ON; `off` sends no figure.** `liveBuildCost.ts` +
  `liveCostLabel.ts`. The live strip reads **"₹12.40 so far"**, tappable for a one-line explanation.
  🔒 **ONE PRICE, TWO READINGS:** it is `decideBuildBilledUsd` — the final bill's own function — over the
  same live ledger, with the same sandbox measure and the same build discount (read once, up front). A
  source guard fails CI if the live path's arguments or its "who is charged" predicate drift from the
  settle's. 🔒 **Shown only to someone who will be charged** (the settle's `billingActive`), and never
  while `AGENTV3_FREE_ONBOARDING_BUILDS` could zero the bill. Throttled to one update per 2.5 s and
  computed only after the throttle allows it; the event (`cost_so_far`) carries one rupee number, no
  vendor, no split. The label says what can still move it: more work adds to it, the checks at the end
  can only lower it, a build that fails is free.

- **🧠 `AGENTV3_CHANGE_ENGINE` — the app remembers what it is supposed to do, across edits (built
  2026-10-04, slice 1 of `docs/CHANGE_ENGINE.md`). ⚠️ NOT set; the code default is ON**, and `off` stops
  every read, write and prompt block with no deploy. Lives in `src/server/AgentV3/changeEngine/`.
  🔴 **WHY:** every "what did the user ask for?" check reads only the CURRENT prompt
  (`currentRequestForCoverage` returns the last request on purpose — report 1682cd03), so an edit that
  silently removed a working Delete button was graded against "make the header blue" and passed.
  **What it does:** classifies each change (micro-ui … architectural / large → light / standard / deep,
  higher risk wins); keeps a requirement ledger with stable `REQ-nnn` ids, **verified only by a control a
  real browser saw** (prose never verifies); re-probes every verified requirement on a later edit
  (`probeFeatures`, same guards as the coverage probe) and records **`FEATURE_REGRESSED`**; queues
  unresolved APP findings as `ISS-nnn` moved only by evidence (FIXED/VERIFIED need a build that reached its
  release gate unstopped); and leaves a `CHG-nnnn` record per build. Report codes `CHANGE_CLASSIFIED`,
  `CHANGE_RECORDED` (info), `FEATURE_REGRESSED` (warning).
  🔒 **Server-side only** (`app_engineering_memory_v1/{workspaceId}`, erased with the workspace) — NOT a
  `.navbharat/` folder in the app (GitHub push, Green Freeze, forgeable by an imported repo, served on the
  preview URL). Stored text is platform-authored except a redacted 160-char request digest; issue text
  reaches the builder **fenced**, in the per-turn message, never the cached prefix.
  🔁 **SLICE 2 (same day, admin: "sara kaam karo"): a regression joins the EXISTING feature heal** — same
  runner, same `verifyAfterFix` net, same `AGENTV3_FEATURE_HEAL` cohort gate (so it spends a repair pass
  only for the 20% cohort today; widening `_PCT` widens this too). The prompt says RESTORE, never
  redesign. A restore is recorded as `FEATURE_REGRESSION_HEALED`; what the heal could not restore stays
  `FEATURE_REGRESSED`. ⚠️ The regression probe's false-positive rate on real builds is UNMEASURED — the
  admin chose to ship the repair before that measurement. **What to watch:** `FEATURE_REGRESSED` and
  `FEATURE_REGRESSION_HEALED` on edit builds, and any heal on an app the user says was fine.
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
  🧰 **AND THE CONTRACT'S HELPERS GET A FILE TOO — `AGENTV3_UTIL_OWNER` (NOT set; default ON; `off` reverts),
  autopsy 876afca9, 2026-09-30.** The contract file keeps types only. Helper signatures stayed in prose,
  "implemented in the file the file list names for them", and on "Create a calculation app" the file list
  named none. `App.tsx` imported all four helpers from `./types`: five tsc errors and a 241 s repair (53% of the
  lane). Now `utilOwnerFor` picks an owner before file one: a planned file whose purpose names a helper, else
  a planned `utils`/`helpers` file in the contract's folder, else a new `utils.ts` beside it (generation tier 0,
  so the screens see its exports). The contract text carries one line saying where they live.
  🪞 **Same autopsy, `AGENTV3_ENTRY_SHADOW` (NOT set; default ON; `off` reverts):** a Vite plan's
  `public/index.html` is dropped (`entryShadow.ts`), and the full builder is told at write time. Vite serves
  `public/` as-is at the root, so that copy shadowed the real entry ("unsupported MIME type ('text/html')") and
  cost two repair passes. CRA is exempt (there it IS the entry). Test-locked in
  `tests/theCalculatorsHelpersHadNoHome.test.ts`.
  🔁 **The owner rules missed a sibling (build 9762f589, 2026-09-30).** The plan had `src/utils/sales.ts ::
  Sample sales data generation …` for `generateSampleSalesData`: it described the helpers without naming
  them, outside the contract's folder, so the lane added a SECOND `src/utils.ts`. Two files wrote the same
  helpers with different signatures and three repairs chased the mismatch. `helperModuleByWords` now picks a
  planned plain module (never a `.tsx`, config, entry or `.d.ts`) sharing ≥ 2 word stems with the helpers;
  a tie picks nobody.
  🏷️ **`AGENTV3_CONTRACT_NAME_SPLIT` (NOT set; default ON; `off` reverts), same build.** The contract prompt
  has forbidden a type named after a component since autopsy 121c2431; this contract still declared
  `interface CitySummary` beside `CitySummary.tsx` (TS2865). `separateTypeFromComponentNames` renames such a
  type (`CitySummaryData`) before the contract file is written, unless the contract declares the component
  itself under that name. The net: `fixTypeImportValueClash` in the shared deterministic pass turns a TS2865
  import type-only (tsc's own fix; a model repair had made it a self-import). Test-locked and
  reversion-proven in `tests/theSalesSampleHadTwoHelperHomes.test.ts`.
  📦 **AND ITS SHARED CONSTANTS GET ONE OWNER (autopsy 6ae30b33, 2026-09-30; rides `AGENTV3_UTIL_OWNER`, no key
  of its own).** The contract now declares every shared constant (`export declare const gkQuestions:
  GKQuestion[];`), and `valueOwnerFor` pins them to one file (a planned data/constants file, else a new
  `data.ts` beside the contract). The types module never carries them. In the report, tier-0 files written in
  parallel each invented their own names for the same seed data.

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

- **📏 `AGENTV3_PLANNING_CONTEXT` + 🎨 `AGENTV3_KIT_RESTORE` — THE SIZERS READ WHAT THE BUILDER READS, AND THE
  KIT'S RULES COME BACK WITH ITS CLASSES (autopsy e725e002, 2026-09-29). ⚠️ NEITHER is set; both default ON;
  `off` reverts each alone.** The message was `mkdir src`; the builder, reading it with the attached file /
  earlier requests, built a 35-file shop in 17.6 min — while the complexity score (5), the ETA (2–4 min), the
  request analysis, the complexity router, project-mode detection and the fast lane (267 s planning a generic
  app) all read the four words. `planningRequest.ts` is ONE request (message + capped attachment + the last 3
  earlier requests ONLY while no app exists) that every sizer and planner reads; intent and the golden
  scaffold still read the message. Admin line `PLANNING_CONTEXT`.
  🔁 **A message that POINTS at the conversation reads the conversation (autopsy 5759ad8b, 2026-10-01).** "Can you
  make this app" meant an app described in CHAT, which this block drops by design (6ae30b33); the fast lane planned a
  counter. A short message (≤ 14 words) whose subject is a pointer ("this app", "yeh app", "isko banao", "यह ऐप") on a
  workspace with no finished app now adds its chat turns and the conversation's last answer (one bounded read,
  `conversationReference.ts`, `lastAssistantText`). Every other message is unchanged.
  `kitRestore.ts`: the design repair is told the kit is "already in the project" — it was not, the architect
  had rewritten `src/index.css` — so four empty states shipped on undefined `.nb-empty*`. A kit class with no
  rule has exactly one right rule, the kit's, so it is appended deterministically (with its media rules,
  keyframes and light/dark tokens), never restyling a class or overriding a token the app defines. It runs
  before the CSS check, after the design/CSS repair, and in the fast lane's verify. Admin line
  `DESIGN_KIT_RESTORED`. Test-locked in `tests/theSizersReadWhatTheBuilderReads.test.ts`.
  ✅ **THE PREVENTION HALF — `AGENTV3_KIT_KEEP` (NOT set; default ON; `off` writes the model's content as
  sent), admin 2026-09-29: *"architect ko index.css replace na karne wala fix bhi karo"*.** At the write
  door (`write_file`, `write_files_batch`; the fast lane writes through `write_file`), a rewrite of a
  stylesheet that carried the kit (≥ `KIT_SIGNATURE_MIN` kit rules) keeps every kit rule it dropped
  without restyling — EXACTLY as the old file had it, tuned palette included — appended after the
  model's own content, which is never altered. A class the rewrite restyles is the model's. The model is
  told in the tool result; the architect prompt now says never to replace `src/index.css` wholesale.
  Admin line `DESIGN_KIT_KEPT` (sub-agents count into it). ~~`edit_file` is not guarded~~ — **it is
  since 2026-09-30**: an edit that cuts kit rules out keeps them the same way. Test-locked and
  reversion-proven in `tests/theStylesheetKeepsItsKit.test.ts` and
  `tests/aStaleCopyCannotRunInsteadOfTheBuild.test.ts`.
  🪞 **`AGENTV3_SHADOW_TWIN` — A STALE COPY OF A MODULE CANNOT RUN INSTEAD OF THE BUILD'S OWN (same
  autopsy, 2026-09-30). ⚠️ NOT set; default ON; `off` removes nothing.** `shadowTwin.ts`. The sandbox
  came up warm on a resumed id with the durable store EMPTY, and an earlier never-saved attempt had left
  `.js` copies of every module (`AuthContext.js` beside the new `AuthContext.tsx`). Imports are
  extensionless and Vite tries `.mjs, .js, .mts, .ts, .jsx, .tsx` in that order, so the OLD copy ran and
  the build's file was dead. Now, at the write door (`write_file`, `write_files_batch`, `edit_file`;
  sub-agents share it), a same-named file in the same directory that resolves EARLIER and that this build
  did NOT write is removed (`rm -f`, confirmed by a read), the model is told, the durable store forgets it
  after the run, and the report says `SHADOW_TWIN_REMOVED`. 🔒 Unknown authorship ⇒ nothing is removed;
  a twin the build wrote itself is never touched; a `.d.ts` is never a twin; a later-resolving twin stays
  (it cannot shadow). One sandbox listing per dispatcher, reused.
- **🗂️ `AGENTV3_USER_FILE_GUARD` — A FILE THE USER PUT HERE IS NEVER DELETED UNASKED, AND A PAGE THE APP DOES NOT
  SHIP IS NOT SCORED AS THE APP (autopsy 4d538ca3, 2026-10-01). ⚠️ NOT set; default ON; `off` lifts the delete
  guard only.** `evaluate` scored a Vite app 0/100 on 34 findings inside a page the user had added from Code
  Studio. The model then ran `rm` on the user's file, under a prompt that said "do not remove any existing
  working features". `outsideTheApp.ts` sets such a page aside: an HTML file in a project with a bundler that is
  not the entry, not in `public/`, and named by no bundler config. It is set aside from every scan and the tech-
  debt register, and named in the result. Unknown means judge everything, so a static site is unchanged.
  `userFileGuard.ts` refuses `rm`/`unlink`/`git rm` (globs and `sh -c` included) of a file in
  `ManualEditTracker.userOwnedFiles` (a durable set that a build never clears) unless the request names that
  file with a delete word (report `USER_FILE_KEPT`). `evaluate` now re-reads the disk itself, so a model-called
  evaluate is never stale. ⚠️ Only Code Studio edits are remembered as the user's files today; zip and repo
  imports are an OPEN item in `PROGRESS.md`.
- **⏯️ `AGENTV3_UNFINISHED_RESUME` — A BUILD THAT STOPPED TALKING IS NOT A BUILD THAT FINISHED (autopsy
  121c2431, 2026-09-26). ⚠️ NOT set, and the code default is ON**; `off` restores the old ending exactly.
  Read by `src/server/AgentV3/unfinishedResume.ts`; applied in `AgentRunner`'s readiness gate.
  🔴 **WHY:** the build-nudge fires only for a run with ZERO tool calls, so an architect that worked, then
  wrote 26,371 characters of deliberation and ended its turn with no tool call, ended the build FAILED at
  5.4 min with 1,418 s of budget unspent — while the readiness gate, run only to write the failure message,
  already knew the entry was still the starter. Now the gate's blockers are handed back with "act now", **at
  most twice**, and **never after a refusal or a question to the user** (the nudge's own two tests, reused —
  the asymmetry in `nudgeToBuild.ts` holds here too). Admin code `UNFINISHED_BUILD_RESUMED`.
  🔒 **Two siblings in the same change:** a compile error a later clean compile answered is RESOLVED in
  project memory instead of being handed to every later agent as a "Recent error" (`markTscClean`,
  `openErrors`, one output-read door `noteCompileOutput` — the shell path had marked tsc clean on a `| head`
  exit code of 0); and when the release gate's typecheck passed, a reviewer finding claiming the project does
  not compile is dropped before the user sees it (`reviewEvidence.ts`, `REVIEW_REFUTED_BY_EVIDENCE`).
- **🧩 FOLLOW-UP TO AUTOPSY de3bb2bb — THREE BUILDER RULES AND ONE REPORT FIX (admin decisions 2026-10-01, PR #3467).**
  - **Small batches, no flag:** `write_files_batch` carries at most `MAX_FILES_PER_BATCH = 3` new files
    (`batchSize.ts`, read by the prompt, the tool text and the dispatcher). One 189 s call had written 7 files, so
    the preview showed nothing for three minutes. The old prompt line ("pass all files in one call … 3× faster")
    was never measured; do not restore it. An oversized batch is still written in full and told to shrink.
  - **Sub-agents get the style hand-back, no flag of its own** (rides `AGENTV3_STYLE_RESUME`): a writing
    specialist is handed back, once, the undefined classes / page defects / unnamed controls in the files IT
    wrote (`scopeStyleHandBack`). A sibling's class is the sibling's, because specialists run in parallel.
  - **`AGENTV3_UNKNOWN_NAME_NOTE`** (NOT set; default ON; `off` disables), `unknownName.ts`: on a NEW build, an
    all-caps word NavBharatAI does not know ("COACT", most likely "collect") is not built as an outside service.
    The builder, planner and fast lane are told: no client, no API URL, no env variable for it; build
    self-contained; say in one sentence how the word was read. Precision-first: acronyms, known services,
    emphasis words, a word the request names as a service ("ACME API", "ACME se connect") and all-caps prompts
    stand down. Report code `UNKNOWN_NAME_IN_REQUEST` (process-only).
  - A readiness warning is recorded once per build (`readinessWarningsSeen` in `BuildDiagnostics`); each runner's
    `done` had recorded "No tests at all" again.
- **🎨 `AGENTV3_STYLE_RESUME` — A TURN THAT ENDS WITH UNSTYLED SCREENS IS HANDED THE CLASS LIST ONCE (autopsy
  1be16985, 2026-10-01). ⚠️ NOT set; default ON; `off` reverts.** `stylePolishResume.ts`, applied in
  `AgentRunner` after a READY readiness verdict. The write-time note (`undefinedClassWriteNote`, e6d46cde)
  had no end-of-turn check behind it: 63 classes survived, the model's one append missed its anchor and was
  never retried, and a 174 s fresh-context repair pass added the rules afterwards. Now the architect gets the
  list (`ToolDispatcher.undefinedClassesNow` — an unread stylesheet means "unknown", never a list) and is told
  to append in ONE `edit_file` with an empty `old_string`. Once, never after a refusal or a question. Code
  `STYLE_RULES_RESUMED` (process-only). Same change: an edit that misses its anchor in a long file is shown
  the END of the file too and told how to append; the post-write "no React import" note is gone (the automatic
  JSX runtime needs none; only `React.` without an import is flagged); and every repair runner is marked
  `platformRequest`, so its reply never thanks the user for "the fixes you requested" (`platformRequest.ts`).
  **Second pass, same day:**
  - The end-of-turn message now carries the page-design findings too (the same `analyzeDesignCoverage`).
  - A list of a hand-written record's own field (`topic.sections`) is no longer a "data list" (`recordFieldLiteral`).
  - Every engine-authored user turn is stamped `origin: 'platform'` on its persisted copy (`pushPlatformTurn`), so a
    reopened chat never shows a repair instruction as the user's own message.
  - **Q-037 / Q-022 (admin chose option b):** it also carries spacing off the 4px grid, but only in files THIS
    agent wrote (`offGridHandBack`) and only above the `DESIGN_CONSISTENCY` finding's own threshold. A file the
    build never touched is not handed back (Q-015). Test: `tests/offGridSpacingIsHandedBack.test.ts`.
- **🧹 `AGENTV3_ORPHAN_HANDBACK` — A SCREEN THIS BUILD WROTE AND NOTHING SHOWS IS HANDED BACK ONCE (Q-202, autopsy
  3f959fde, 2026-10-04). ⚠️ NOT set; default ON; `off` reverts.** `orphanHandBack.ts`. The build changed course and left
  `DataPreview.tsx` and `AlgorithmSuggestions.tsx` imported by nothing. The architect's end-of-turn hand-back (the same one-time
  message as `AGENTV3_STYLE_RESUME`) now names every component THIS build wrote — every lane, via the route's write set
  (`setBuildWrites(() => modelAuthoredPaths(writtenFiles))`), our pre-seed left out — that the import graph PROVES nothing
  reaches (`unreferencedComponents`), and says: wire it in, or delete it if it was replaced. 🔒 Never a file the build did not
  write, never when one import cannot be resolved, never to a specialist (the architect wires its screens in after it returns),
  never on a project-mode module awaiting its shell; tests, stories and `ui/` kit parts are excluded. Detail in
  `STYLE_RULES_RESUMED` carries `<path>:unimported`. Test-locked and reversion-proven in
  `tests/aScreenNothingShowsIsHandedBack.test.ts`.
- **🖼️ `AGENTV3_PICTURE_ANSWER` — A PICTURE REQUEST IN PRO IS ANSWERED, NOT BUILT (autopsy 19641ab5, 2026-10-01).
  ⚠️ NOT set; default ON; `off` builds as before.** `pictureRequest.ts`. "Create full image" + a portrait photo was
  built as an 11-feature image-generator app (stopped at 108 s, ₹7.62). Free chat, Doctor AI and every Professional
  already pointed picture requests to Image Generator AI; Pro was the sibling never hunted, while `AppKnowledgeBase`
  said it did. A `detectImageIntent` request that names no software, in a workspace with no user app, is answered on
  the chat lane (₹0) with Home → Other AI → AI Image Gen and an offer to build an image app. Same autopsy, no flags:
  the sizers no longer read a PHOTO's description as a feature list (only documents and UI-design pictures,
  `planningRequest.ts`); a build cut short before its ETA band is `untested`; the platform ETA prior averages
  successful builds; and setup puts back the template when a workspace holds only a piece of our own starter
  (`starterFragment.ts`). Test-locked in `tests/aPictureIsNotAnApp.test.ts`.
- **✍️ A REQUEST TO WRITE A PROMPT IS ANSWERED, NOT BUILT (autopsy cf09c03c, 2026-10-04; no flag).** "Etake aro
  improve korar jonno ekta valo prompt likhe dao" (write a better prompt) was locked to an EDIT by "improve" and
  replaced our starter's App.tsx with a page showing a prompt (₹6.34). 6ae30b33's written-content rule had asked
  only the NEW-build verbs and had no "prompt" noun. Now the edit verbs ask it too (`asksForWrittenText` → chat
  LOW; `namesTextNotScreen` → edit LOW, so "change the caption" still reaches the reader as an edit), and
  `asksForPromptText` in `lib/imageIntent.ts` stops a request to WRITE a prompt reading as a picture on every
  chat surface (a prompt the user GIVES is still a picture). Same change: on an edit, "I changed N files" counts
  what the turn authored (`reviewChangedPaths`), and an omitted stylesheet no longer gives the lean review its
  tools back. Test: `tests/aPromptIsTextNotAnApp.test.ts`.
- **📱 "TURN MY WEBSITE INTO AN APK" IS ANSWERED, AND A STARTER CONFIG IS EDITED, NOT REWRITTEN (autopsy dcce5d26,
  2026-10-04; no flag).** "I want to convert one existing website into an online APK but not publically" was built
  on a fresh workspace. `projectElsewhere.ts` now counts a CONVERSION of the user's own site or app into a phone
  app (existing / possessive / "this" / a link) as "the thing is elsewhere", and the reply says the honest limit:
  the APK Builder packages a web app whose code is in the project, never a live link by itself. A request to
  build a converter still builds. Same report: the fast lane's per-call `model` named the vendor ("glm") —
  `fastLaneCallIdentity` now reads `TurnResult.model` (`answeringModel`), which also woke its dead
  reasoning-rung check; and a planned config file the starter already has (`package.json`, `tsconfig*.json`,
  `vite.config.*`, root `index.html`) is handed its current content in both fast lanes (`existingConfig.ts`).
  ⚠️ Never let a lane write a project config file blind — that is what `ViteConfigGuard` and the HTML entry guard
  were cleaning up after. Test: `tests/aWebsiteToApkIsAnsweredNotBuilt.test.ts`.
- **🔐 `AGENTV3_REQUEST_SCOPE` — A LOGIN NOBODY ASKED FOR IS NOT BUILT (autopsy 70e030bb, 2026-10-04). ⚠️ NOT set;
  default ON; `off` reverts.** "An app which takes notes from online classes" opened on a username/password form with a
  hashed demo account, and "Clear Completed" (a to-do prop the contract invented) deleted every note. `requestScope.ts`:
  on a new build whose request names no sign-in word (login, account, password, OTP, roles, admin, private, secure,
  multi-user, Hindi forms) and no domain the requirement analyzer recognises, the architect, the fast lane and the
  one-shot lane are told: no login, sign-up, password gate, demo account or accounts, and no control for a state the
  data does not have. ⚠️ It stands down for every recognised domain, so it never fights `AGENTV3_REQUIREMENT_AWARE`.
  Report code `REQUEST_SCOPE_NOTE` (process-only). Same report, no flags: a fast-lane plan no longer lists the
  starter's compiler files (`STARTER_COMPILER_FILES`: tsconfig ×4, `src/vite-env.d.ts`; both lanes), a `.d.ts` names no
  dependency and a React app is never "Stack: Vue", a password form is a sign-in journey run signed out
  (`isCredentialForm`), the sign-in explorer reads `passwordHash: hashPassword("demo123")`, and a pruned package takes
  its `@types/` with it. Test: `tests/theNotesAppAutopsy.test.ts`.
- **🙋 `AGENTV3_CONFIRM_BUILD` + 📎 `AGENTV3_ATTACHMENT_MEMORY` (admin 2026-10-03, Q-200 / Q-201). ⚠️ NEITHER is set;
  both default ON; `off` reverts each alone.** `buildConfirmation.ts`: see "READ THE MOOD FIRST" above — an unconfirmed
  build is answered and offered, and a "yes" builds the offered request. `lib/attachmentMemory.ts`: the latest
  attached DOCUMENT's text (PII masked, ≤ 50 KB, 30 days) is kept per chat in `agentv3_attachment_memory/<workspaceId>`
  and handed back only to a later message in the SAME chat that brings no file and talks about the data/file or
  accepts an offer. The record carries the uid and a read with another uid gets nothing (admin: *"ek chat ki baat
  dusre chat me na jaye"*). Deleted with the chat (`purgeWorkspace`) and on unsend; disclosed in Privacy Policy §6 (retention).
  Report codes `BUILD_OFFER_ACCEPTED` / `ATTACHMENT_RECALLED` (process-only). Test-locked and reversion-proven in
  `tests/aBuildStartsOnlyWhenAskedFor.test.ts`.
- **📦 `AGENTV3_PORT_DIGEST` — A PORT IS HANDED ITS SOURCE PROJECT ONCE (autopsy 51ef24ad, 2026-10-04). ⚠️ NOT set;
  default ON; `off` reverts.** `portDigest.ts`. On a build ORDER over a project holding ≥3 Kotlin/Java/Swift/Dart app
  sources (`buildOrderReadAsEdit`), the originals are read once (≤40 files) and a ≤16 KB digest — screens, view-models
  and data files with their declarations, data models whole — is prepended to the architect's prompt and handed to
  every specialist (`SubAgentDeps.portDigest`). A specialist used to start empty and spend its step cap re-reading the
  Kotlin. `taskHandoff.filesNamedIn` also attaches those extensions now. Report line `PORT_DIGEST` (process-only).
  The same autopsy sizes such a turn's ETA by the project's own screen files (`projectSizedComplexity`).
- **🧪 `AGENTV3_STRICT_TRIAL` — A SHARE OF NEW APPS START WITH TYPESCRIPT STRICT MODE ON (queue Q-008, admin "han"
  2026-10-01). ⚠️ NOT set; default ON; `off` seeds every new app loose as before.** `AGENTV3_STRICT_TRIAL_PCT` (NOT set;
  default **20**; `0` pauses; unreadable ⇒ 0, never 100). `strictTrial.ts`. The Vite-React starter compiles with strict
  off, which makes `if (!result.ok)` fail to narrow and lets "may be null" crash on the phone. 20% of NEW workspaces (by
  workspace id) are seeded with `"strict": true`. 🔒 **An existing app's tsconfig is never rewritten**, and the foundation
  that fills in a missing tsconfig stays loose. Measured by `STRICT_TRIAL` (process-only) and `byStrictCohort` in the daily
  cost telemetry: compare `strict-new` with `loose-new`, then the admin decides 100% or off. 🔒 The census in
  `tests/aNewAppMayStartStrict.test.ts` typechecks every starter in BOTH modes; it found Panchang's null use and Arcade's
  `<Empty>` called with props it does not take. **Never change a starter without it staying at zero errors.**
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
  ✅ **THE ANSWER HALF IS CLOSED (2026-09-26, `src/server/AgentV3/turnAnswer.ts`) — and building it
  found two live defects, which is the case for having built it.** The readers did not merely
  re-derive the kind; they read `result.summary` AFTER the platform had rewritten it. (1) A free
  build whose model **declined** had its refusal replaced by the empty-build flip with *"please try
  again"*, and the upsell then asked `looksLikeRefusal` of THAT sentence, found nothing, and offered
  *"Add credits and I will complete it on the best engine"* — report 03997004's sentence, alive for
  every refusal the triage does not catch. (2) On an **edit**, a model that **asked** *"navy or sky
  blue?"* had its question replaced by `verifiedNoChangeSummary` with *"Nothing needed changing — your
  app works"*. **The rule now: the model's answer is read ONCE (`readTurnAnswer`), right after the
  last model run and before the platform writes a word, and every verdict reads that capture.** Both
  platform sentences stand down when the model answered instead of building; `TURN_DECLINED` records
  it. ⚠️ **Never add a reader that asks `looksLikeRefusal(result.summary)` or `turnAskedTheUser(…)`
  late in the route** — `tests/turnAnswerIsReadOnce.test.ts` fails on either call appearing there.
  ✅ **THE `stopped` HALF IS CLOSED TOO (2026-09-26, the same day) — and the premise first written here
  was WRONG, which is the part worth keeping.** It said "a model's own `stop_build` call may not raise
  the abort signal". It does: the Stop button, Unsend and `stop_build` ALL go through
  `abortBuild(…, 'user-stop')`, so the signal is the complete source, and the retry (abort signal)
  and the upsell (`USER_STOPPED_BUILD`) are not disagreeing — they ask different questions ("did the
  run end early at all?" vs "was a capability ever judged?"). **Unifying them would have been wrong.**
  The one real gap: the upsell's question was answered from `USER_STOPPED_BUILD` alone, which our OWN
  interruptions (deploy drain, lock takeover, reaper, unknown) never write — so a build OUR server cut
  short could be told to buy a stronger engine. `interruptedBeforeAnyVerdict(cause)`
  (`buildAbortCause.ts`, exhaustive over `AbortCause`) now reads the signal's cause, and the upsell
  stands down on `interrupted` with its own record. It can only suppress an upsell; it moves no money.
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

- **🧯 CRASH REPORTING — Firebase Crashlytics in the phone apps (built 2026-10-04). No Cloud Run key.** One
  build-time value, set only by the store workflows: **`VITE_CRASH_TEST`**. `1` adds the controlled crash
  tools (`window.__nbaiCrashTest`). Both `android-aab.yml` and `ios-ipa.yml` take a `crash_test` input that
  sets it, and both REFUSE it together with an upload. Collection is decided natively: on for Android
  release builds (`manifestPlaceholders`), off for debug. The full design is in `docs/CRASHLYTICS.md`.
  ⚠️ **Before the first `.aab` / `.ipa` with it ships:** enable Crashlytics in Firebase Console, and declare
  crash and diagnostic data in Play Data safety and App Store App Privacy (`MOBILE_PUBLISHING.md`).
---

### 2026-10-04 — app pictures, the Images API permission, and the safety filter (autopsy cc3ef776)

- **No new Cloud Run key.** App pictures reuse the engines already configured for the Image Generator's paid ladder: Cloudflare FLUX, keyed Pollinations (`POLLINATIONS_API_KEY`), then Grok. They run only when the OWNER saved a NavBharatAI API key with the "Images" permission. With an OpenAI, Gemini, Grok or Pollinations key of their own, NavBharatAI's keys are not touched at all.
- **Correction: `safe=true` is NOT the nudity filter on the current Pollinations API.** It now covers only privacy and secrets. Every keyed call names its filters: `safe=privacy,secrets,sexual,violence` (`POLLINATIONS_SAFE_FILTERS` in `imageGen.ts`). The legacy anonymous link keeps `safe=true`.
- **The app's own secrets** (saved in Keys & Secrets, never in Cloud Run) are:
  - `NAVBHARATAI_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `XAI_API_KEY` (or `GROK_API_KEY`), `POLLINATIONS_API_KEY`;
  - optional `IMAGE_PROVIDER`;
  - optional `<PROVIDER>_IMAGE_MODEL`.
- **Admin action:** after the PR merges, run the manual `e2b-template` workflow. The warm primer in `infra/e2b/e2b.Dockerfile` now carries `@types/react` and `@types/react-dom` (Q-574), and it reaches live sandboxes only after that rebuild.

### 2026-10-05 — WhatsApp bot signatures and the bot ledger (Q-612)

- **`WHATSAPP_SIGNATURE_REQUIRED_AFTER`** (NOT set; default `2026-11-05T00:00:00Z` in `src/server/bots/whatsappSignature.ts`) — an ISO date or date-time. Until then, a hosted WhatsApp bot connected WITHOUT a Meta App Secret (every bot connected before 2026-10-05) is still served, and its owner sees a notice in the Bot Builder naming this date. After it, such a bot's deliveries are refused (403) until the owner adds the App Secret. Bots connected from 2026-10-05 must give the App Secret at connect, and their deliveries are checked against `X-Hub-Signature-256` at once — this date does not affect them. An unreadable value is ignored (logged once per read) and the default applies. Set it only to give owners more time; moving it earlier cuts off legacy bots sooner.
- **No new secret in Cloud Run.** Each bot's App Secret is the USER's own (their Meta app), stored encrypted in the `bots` collection with the existing `SECRET_ENCRYPTION_KEY` / `SECRET_KEY_V<N>` (`lib/secrets.ts`).

### 2026-10-06 — the retention purge is switched on (Q-110, Q-134)

- `DATA_RETENTION_PURGE_ENABLED` — ✅ **SET to `on` by the admin, 2026-10-06** (name recorded only). Read through
  `envFlag` in `server.ts`, so `on` / `true` / `1` all count. It registers the exclusive `retention-purge` job (daily
  03:00 UTC, also once at boot through the claim; the Cloud Scheduler tick from Q-159 catches it up when no instance
  was awake) which runs every `RETENTION_POLICIES` entry and every `SUBCOLLECTION_RETENTION_POLICIES` entry in
  `DataRetentionManager.ts` — among them `server_logs` 30 d, `build_jobs` 90 d, the 180-day removal / safety /
  admin-audit records, `site_analytics` 30 d (the Privacy Policy's stated window), and past build reports
  (`workspace_diagnostics_v3/*/history`) 180 d. Each policy deletes at most 500 documents per run, so a backlog drains
  over several nights. **What to watch:** Cloud Run logs carry `[P-DATA.4] retention purge removed N expired record(s)`
  on a run that found something; nothing is logged when nothing had expired. To stop it, unset the key (or set `off`)
  and redeploy — the job is then not registered at all.

### 2026-10-06 — the sleeping-database watch (Q-700)

- `SUPABASE_PAUSE_WATCH` — **NOT set, and does not need to be: the watch is ON by default.** Only `off` stops it.
  Read by `src/server/lib/supabasePauseWatch.ts`; the job is `supabase-pause-watch` (05:10 UTC, exclusive, so the
  Q-159 Cloud Scheduler tick also runs it). It only READS each connected user's Supabase project state and tells the
  owner once per episode when one is paused, failed or removed. **It never wakes a project** — only the owner's Wake
  button in Settings → Database does (see `supabaseProjectState.ts` for why).

### 2026-10-06 — the two identities user code runs as (P0 hosting isolation)

- `NAVBHARAT_APPS_RUNTIME_SA`: ⚠️ **NOT SET — and NavBharat Cloud hosting now REFUSES (admin included) until it is.**
  It names the dedicated, **role-less** service account every hosted user app runs as. It must be an account of
  `navbharatai-user-apps`, never a Google default. Suggested: `nbai-app-runtime@navbharatai-user-apps.iam.gserviceaccount.com`.
- `NAVBHARAT_APPS_BUILD_SA`: ⚠️ **NOT SET — same refusal.** It names the dedicated build account. Roles:
  Artifact Registry Writer on `nbai-apps` only, Storage Object Viewer on the staging bucket only, and Logs Writer.
  It must differ from the runtime account. Suggested: `nbai-app-builder@navbharatai-user-apps.iam.gserviceaccount.com`.
- Before these, every user app and build ran as the default compute account `219549203609-compute@developer…`.
  Read by `src/server/AgentV3/appsIdentity.ts`. The full design, the setup steps and the verification are in
  `docs/HOSTING_ARCHITECTURE.md` §11.

