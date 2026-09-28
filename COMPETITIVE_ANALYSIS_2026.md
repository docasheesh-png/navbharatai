# NavBharatAI Pro v5 vs the Top 5 — August 2026

**Why this file exists (admin, 2026-08-27):** *"navbharatai pro ko other ai app builder (top 5 leading)
se compair karo. sabhi choti moti badi gaps ko find karo. other ai app builders ki acchi acchi bato ko
bhi short list karo. un sabhi gaps ko smartly and intelligently fill karo."*

**Method, stated honestly.** The competitor side was researched fresh (August 2026) against official
pages — docs, changelogs, blogs — never from memory, because these products change monthly; claims that
could only be found in third-party round-ups are marked as such. The NavBharatAI side was verified
against LIVE CODE, not against our own documentation — which matters, because during this comparison the
verification caught what would have been the **eighth false-open**: the "visual click-to-edit" gap this
document was about to declare is in fact fully shipped (`VisualEditPatcher.ts` + `VisualEditor.tsx`).
Per the external-suggestion rule in `CLAUDE.md`, everything a competitor does is **raw material to
adapt, never a spec to transcribe** — several of their headline features are deliberately NOT copied
below, with reasons.

The five: **Lovable** (lovable.dev) · **Bolt.new** (StackBlitz) · **v0** (Vercel) · **Replit**
(Agent 4) · **Cursor** (2.0/Composer). Cursor is included because the admin named it, with the honest
caveat that it is not an app-builder — it ships verified PRs into your own repo and hosts nothing.

---

## 1 · The comparison — where each capability actually stands

**Legend:** ✅ we have it, verified in code · 🟰 rough parity · 🔶 they are ahead · ❌ we lack it ·
🚫 deliberately not copied

| Capability (2026 baseline) | Lovable | Bolt | v0 | Replit | NavBharatAI — verified state |
|---|---|---|---|---|---|
| Prompt → working full-stack app | ✔ | ✔ | ✔ | ✔ | ✅ v5 engine, fast lane + deep pipeline |
| Zero-setup backend (DB/auth/storage) | Lovable Cloud | Bolt Database | Marketplace BYO | built-in Postgres | ✅ **and ours is user-owned**: one-tap Supabase project in the USER'S account (their bill, their data) + NavData for instant apps. Their "own cloud" models re-bill the user for infra; ours never holds their data hostage |
| Visual click-to-edit (no tokens) | Visual Edits | — | Design Mode | canvas | ✅ SHIPPED: element picker → colour/font/spacing/text land in REAL source by AST, zero model cost |
| Self-testing of the built app | Try-to-fix | agent iterates | error recovery | **real-browser user simulation, 200-min autonomy** | 🟰 journey check (fill→submit→reload→persistence), preview probe, runtime autofix, vaccine (runs the app's own tests), reviewer + design gates. Replit's browser-driving is broader — see gap G1 |
| Version history: preview + restore + labels | Versioning 2.0 | rollback/backups | versions+fork | checkpoints+screenshots | ✅ checkpoints, named labels, live per-version PREVIEW (stronger than a screenshot) |
| Diff two versions | partial | — | — | — | ❌ **G2 — genuinely open** (our roadmap's B6) |
| Checkpoint includes DATABASE state | — | — | — | ✔ (incl. DB rollback) | ❌ G3, infra-heavy — see verdicts |
| Git-native (auto-commit, PR, branches) | bi-directional sync | auto-commit | chat=branch, PR merge in-product | full git | ✅ GitHub storage + PR mode + Git panel; PR-review reading built, trigger missing (G4) |
| Security scan at publish | ✔ (headline) | — | — | — | ✅ **stronger**: hardcoded-secret publish REFUSAL naming file+line, dependency CVE gate, APK malware scan + human approval |
| Plan / ask-before-build mode | — | — | — | plan mode | ✅ 🔨 Build · 🧠 Plan · 🔍 Advise |
| Parallel sub-agents | ✔ (May 2026) | — | — | Agent 4 | ✅ parallel frontend/backend build + task/second_opinion/consensus |
| Web search with citations in builder | — | — | ✔ | — | ✅ builder WebSearch + chat live-data + LINK_POLICY citations |
| Mid-build steering | — | — | — | — | ✅ every tier, queue of 5 — **none of the five advertise this** |
| Real shell in the builder | — | — | — | ✔ | ✅ PTY terminal, 30 min/day free |
| Scheduled/background runs | — | — | — | ✔ Scheduled deploys | ❌ G5 (roadmap E3) |
| External connectors (Slack/Notion/Sheets…) | ✔ | — | — | ✔ Agent 4 | ❌ G6 — deliberate sequencing, see verdicts |
| Native mobile (Expo/RN) | — | ✔ Expo→stores | — | ✔ Expo→TestFlight | 🔶 G7 — ours is Capacitor (real APK/AAB/IPA pipeline, honest webview); RN is INFRA-BLOCKED (E2B template needs Expo+SDK — admin infra item, already recorded in ROADMAP §1.1) |
| Figma import | — | ✔ | design-system aware | — | ❌ G8 — image/PDF design-to-code contract exists; Figma API import does not |
| Design variants ("canvas") | — | — | — | ✔ Agent 4 | ❌ G9 |
| Cost shown per message/build | ✔ per-message | tokens | credits | effort-priced | 🟰 honest bill AFTER build + context meter DURING; no live ₹ ticker (G10) |
| India-first: Hindi/Hinglish, UPI/Cashfree, domain recipes, App Mart instant apps | — | — | — | — | ✅ **the moat — none of the five have any of it** |
| Transparent real-cost billing (never charge a failed build) | credits | tokens | credits | effort-based | ✅ real provider cost × published markup; failed build = ₹0. **No competitor states this promise** |

## 2 · Their best ideas — the shortlist (kaam 3)

1. **Replit — browser-driving self-test**: the agent uses the app like a human before calling it done. The single best idea in the field.
2. **Replit — effort-based pricing**: simple edits cost <$0.25; price tracks effort. (We already bill real-cost×markup — philosophically the same, ours is more transparent.)
3. **Lovable — security scan as a VISIBLE trust feature**: we scan more than they do, but they *market* it at the moment of publish; ours is quiet.
4. **v0 — chat-as-branch + PR merge inside the product**: version control a non-developer can feel safe in.
5. **Cursor — Bugbot**: automatic review on every PR with a verdict. (Our C9 reviewer already reviews every build; the PR-side trigger is the missing bit — G4.)
6. **Replit — checkpoints that include the database**: rollback that cannot orphan data.
7. **Lovable/v0 — no-token visual editing**: ✅ already ours.
8. **Replit Agent 4 — design variants canvas**: pick a look before spending build credits.
9. **Lovable — per-message cost visibility**: the user always knows what this message cost.
10. **Cursor — video artifact of what the agent did**: the demo IS the proof. (Expensive; our live per-version preview covers most of the value.)

## 3 · Every gap, with an honest verdict (kaam 2 + 4)

**Filled NOW (this session):**
- **G2 · Checkpoint diff** — "what changed between then and now" in plain terms. Small, real, shipped with this analysis (see PROGRESS.md entry).
- **G11 · Code literacy in the user's language (ROADMAP §9.1a–c)** — *"ye error kya keh raha hai?"* answered in Hinglish register (English nouns, Hindi grammar — never चर for variable). Not copied from anyone: none of the five can do it, and it serves the user we already have. The roadmap itself ranks it highest value-per-effort in the whole audit. Shipped with this analysis.

**Real gaps, sequenced into ROADMAP (not built today, with reasons):**
- **G1 · Broader browser-driving self-test** — we verify derived journeys; Replit drives the whole app. Extending `JourneyCheck` to multi-page journeys is real work on a real foundation. Next hardening round, after the APK telemetry data lands.
- **G4 · "Check my pull request" trigger** — the reading/triage/reply blocks are BUILT and tested (ROADMAP D3); one user-action trigger completes it. Small; queued next.
- **G5 · Scheduled/background runs** — ROADMAP E3, unchanged priority.
- **G10 · Live ₹ ticker during a build** — adaptation of Lovable's per-message cost; needs the accumulating provider-cost to be surfaced mid-build without leaking providers. Small-medium; queued.
- **G3 · DB-inclusive checkpoints** — needs coordinated Supabase PITR/snapshot per checkpoint in the USER'S project; real infra + their quota. Record, don't improvise.
- **G6 · Connectors** — each is an OAuth surface to maintain forever. Build the FIRST one when a real user names one; India-first candidates (WhatsApp Business, Google Sheets) beat Linear/Notion for our audience.
- **G8 · Figma import** — big; our image→contract pipeline already covers "here's a screenshot of the design". Defer until asked.
- **G9 · Design variants** — honest cost problem: N variants = N× generation spend. A cheap adaptation exists (palette/layout presets BEFORE building — we already have palette presets); a true canvas is not worth its bill yet.

**Deliberately NOT copied (🚫), and why:**
- **First-party "own cloud" backend** (Lovable Cloud / Bolt Database): re-billing users for infra we'd host is the model the admin already rejected — user apps run on the USER'S accounts. Our zero-setup Supabase-in-their-account delivers the same one-click without owning their data. The standing NavData exception stays quota-bounded.
- **In-product domain PURCHASE** (Lovable): being a domain reseller is a compliance+support business. We already do managed-DNS connect for domains users own.
- **Platform API / embeddable builder** (v0): developer-platform play, ROADMAP §8E defer stands.
- **Seat pricing** (Cursor): wrong model for our audience; wallet + real-cost billing stays.
- **In-browser WebContainers** (Bolt): a different engine architecture, not a feature — our E2B path runs real servers/databases a browser runtime cannot.

## 4 · Where NavBharatAI is genuinely AHEAD (rule 3 — stated without inflation)

1. **India-first moat**: Hindi/Hinglish everywhere, Cashfree/UPI, Indian domain recipes, App Mart instant apps with remix, mobile-first — absent from all five.
2. **Billing honesty**: real cost × published markup, a failed build is never charged, no invented numbers. No competitor makes that promise in writing.
3. **Publish safety**: secret-refusal naming file+line, CVE gate, APK malware scan + human review — deeper than Lovable's headline scan.
4. **Mid-build steering on every tier** — none of the five advertise it.
5. **Per-version LIVE preview** before restore — stronger than Replit's screenshots.
6. **Honest-failure culture**: preview is earned, RELEASE_GATE says UNKNOWN when unproven, "working app or free". This is a product feature, not a slogan — it is why the trust flywheel can work.

**And the honest deficit, so this document cannot be read as comfort:** Replit's autonomy envelope
(200-minute unsupervised runs, whole-app browser testing) is ahead of ours today, and native mobile
(Expo) is a real product gap held behind our own infra item. Those two are where the next big pushes
belong once the APK telemetry round lands.

---
*Drift warning: competitor facts above are an August-2026 snapshot; re-verify before quoting in
marketing. NavBharatAI-side claims were code-verified 2026-08-27 — re-grep before relying on them later,
exactly as ROADMAP.md's own history demands.*

---

## 5 · September 2026 refresh (2026-09-28) — what moved, what the gaps are now, what was built

The admin asked for the comparison again, across **architecture, systems, design and skill**, and for the
best gap-filling solution to be BUILT, not only listed. This section appends; §1–§4 are the August record.

### 5.1 What the competitors shipped since August (web-verified 2026-09-28)

| Competitor | What changed | Why it matters to us |
|---|---|---|
| **Lovable** | Agent is the default builder. Security scan on every publish plus an on-demand **deep scan** (database access rules, keys in JS bundles, auth config, HTTP headers). **From 2026-09-09, Free/Pro content trains Lovable's models unless the user opts out.** | The scan is now a visible product. The training change is a **privacy opening** for us (see 5.4). |
| **Bolt** | **Bolt Cloud**: hosting, domains and SEO public; auth, storage, payments, databases and analytics built with Netlify + Supabase. Azure/Microsoft partnership (May 2026). | Owns the whole backend. We deliberately don't (§3 "Deliberately NOT copied"), and that still holds. |
| **v0** | **v0 API GA**: a headless builder (prompt → app → sandbox preview URL). **Vercel Connect**: short-lived managed credentials for 100+ services instead of pasted keys. | Connect is the best answer yet to "connectors" (our G6). The API is still a developer-platform play (§8E defer stands). |
| **Replit** | **App Testing**: the agent drives the app in a real browser like a user (buttons, forms, APIs) and fixes what it finds. Agent 3 runs up to ~200 min autonomously. **Expo mobile** with App Store/Play submission (early 2026). | This was our #1 honest deficit in August (G1). See 5.3. |
| **Cursor** | Bugbot 3× faster and 22% cheaper. **Security Review** and **Rollouts** bots (2026-09-23, Teams/Enterprise). Self-hosted cloud agents. | PR-time review is now table stakes for developer tools (our G4). |
| **Google AI Studio** | Coding agent built on Antigravity parts. **Auto-provisions Firestore + Firebase Auth** when an app needs data or login. Hands off to Antigravity, which verifies the app in a real browser. Firebase Studio closed to new signups 2026-06-22; sunset 2027-03-22. | Zero-setup backend from a free tier. Our equivalent is one-click Supabase **in the user's own account**. |

### 5.2 Gaps now, by layer (✅ = closed, 🟡 = partial, ❌ = open)

**Architecture**
- ❌ **No shared evidence ledger.** Gates and the agent keep private notions of what is proven (open root cause, CLAUDE.md autopsy 697b38ee). This is the single biggest *internal* ceiling.
- ❌ **No single `turnKind`.** "What kind of turn was this?" is still inferred by counting outputs in several places (open root cause, autopsy e628efd4).
- 🟡 **`routes/agentv3.ts` is ~20k lines.** It works and is heavily test-locked, but every new check is wired into one file. Extraction is incremental, never a rewrite.
- ❌ **Native mobile is a Capacitor webview.** Replit ships Expo and Google ships Kotlin/Compose. Our phone features are real (`nativeCapabilities.ts`), but it is not a native UI toolkit.
- ⏸️ **No headless builder API** (v0). Deliberately deferred.

**Systems**
- ✅ **G1 · Whole-app browser self-test**: closed in part by this refresh (5.3).
- 🟡 **Visible deep security report.** Publish safety is real (secret refusal with file and line, CVE gate, APK scan + human review), but there is no one-button report of the kind Lovable shows ("your tables are readable by anyone").
- ❌ **G6 · Connectors.** v0's short-lived-credential model is the one to adapt, not per-service OAuth plumbing.
- ❌ **G5 · Scheduled runs**, ❌ **G10 · live ₹ during a build**, ❌ **G4 · PR / security review trigger.** All three are unchanged since August.
- 🟡 **Analytics.** Visitor analytics for published apps exist (§13 item 1.1). Funnels and custom events (Replit) do not.

**Design**
- ❌ **G8 · Figma import** and ❌ **G9 · variants** are unchanged. The image → contract pipeline covers "here is a screenshot".
- ❌ **Design-system upload** (Bolt). This is a real ask for agencies, but it is not our first audience.

**Skill** (what the engine knows how to do)
- 🟡 **Reusable skill packs** (Replit "Growth Skills") vs our domain recipes + requirement-aware building (hospital, restaurant, …). Our recipes are deeper for India. Theirs are user-installable. Making recipes user-visible and selectable is a cheap adaptation.
- ✅ **Code literacy in the user's language** (G11, shipped August). No competitor has it.

### 5.3 What was BUILT in this refresh — the click explorer (closes G1's biggest half)

Every check we ran after a build watched the app **paint**, or drove **one** derived form. Nothing pressed the rest of the app. `clickExplorer.ts` now opens the finished app in the sandbox's pre-baked browser and presses up to 12 visible controls, **each on a fresh load**. It names the exact control that crashes the app, blanks the screen, opens a page that does not exist, or throws an error, and the user sees that in the build card. Flag `AGENTV3_CLICK_EXPLORE` (default on).

**Where this puts us, stated without inflation:**
- **Ahead on:**
  - It runs on **every** build, not when an agent "decides enough has changed".
  - It costs **no model call**, where Replit's testing is model-driven.
  - Its **safety rules are written down and tested**: it never presses delete, pay, send, upload or log out, never submits forms, never leaves the app, and never writes to a database the user owns.
  - The user sees a **per-button** result, in plain language.
- **Behind on:** Replit's tester also **fixes** what it finds. Ours reports it and offers the fix as the next step, one tap. Wiring the finding into a bounded, verified repair pass is the obvious follow-up, and it is a **spend decision** for the admin (on Weak, NavBharatAI pays).
- **Not covered yet:** only the home screen's controls are pressed. Controls inside a modal or on another page are not reached, and multi-step flows are the journey check's job.

### 5.4 Where NavBharatAI is ahead now (re-verified against code 2026-09-28)

1. **India-first:** Hindi/Hinglish, UPI/Cashfree, Indian domain recipes, App Mart instant apps, mobile-first. Unchanged, and still absent from all six.
2. **Privacy:** NavBharatAI does not train models on the user's chats, documents or apps. Our own Privacy Policy already promises this in writing ("we do not use the private content of your chats, your uploaded documents or your built apps to train any AI model", `privacyPolicy.ts`), and providers are contractually barred from training on it. **Lovable now trains by default** on Free/Pro. This is a line we can say truthfully today.
3. **Billing honesty:** real cost × published markup, a failed build is never charged, markup only when the preview ran. Nobody else puts this in writing.
4. **Proof shown to the user:** the form → reload → still-there journey, and now every safe button pressed, in the same card. Failures are shown as plainly as passes.
5. **Publish safety** beyond a headline scan (APK malware scan + human review, secret refusal with file and line).

### 5.5 The next levers, ranked (value to the user ÷ cost to us)

1. **Explorer → verified repair** (small; a spend decision). Close the "Replit fixes it" gap with the `verifyAfterFix` wrapper the heals already use.
2. **One-button security report** (medium). Most of the probes exist already (secret scan, CVE gate, headers). Add a Supabase access-rule probe **against the user's own project, read-only**, and show the result as a card.
3. **Live ₹ during a build (G10)** (small–medium). The ledger already accumulates real cost mid-build (`buildCostCeiling.ts` reads it). Surfacing it needs only a branded, provider-free line.
4. **Connectors via short-lived credentials (G6)** (medium). Start with WhatsApp Business and Google Sheets for our audience.
5. **Expo / native UI (G7)** (large). The deepest product gap, and an infra item. It needs its own admin decision.

*Sources (2026-09-28):*
- **Lovable:** [security overview](https://docs.lovable.dev/features/security), [how Lovable protects apps](https://lovable.dev/blog/how-lovable-protects-your-apps-automatically), [training-data opt-out](https://docs.lovable.dev/features/business/data-opt-out)
- **Bolt:** [Bolt Cloud](https://support.bolt.new/cloud/bolt-cloud), [Sacra on Bolt](https://sacra.com/c/bolt-new/)
- **v0:** [new v0 API](https://vercel.com/blog/introducing-the-new-v0-api), [InfoQ on the v0 API](https://www.infoq.com/news/2026/08/vercel-v0-api/), [Vercel Connect](https://v0.app/docs/vercel-connect)
- **Replit:** [App Testing](https://docs.replit.com/features/agent/app-testing), [self-testing at scale](https://blog.replit.com/automated-self-testing), [Expo mobile](https://docs.replit.com/learn/mobile/expo)
- **Cursor:** [Bugbot update](https://cursor.com/blog/bugbot-updates-june-2026), [Rollouts and Security Review](https://ccleaks.com/news/cursor-rollouts-security-review-sep-2026)
- **Google:** [AI Studio + Firebase](https://firebase.blog/posts/2026/03/announcing-ai-studio-integration), [full-stack vibe coding in AI Studio](https://blog.google/innovation-and-ai/technology/developers-tools/full-stack-vibe-coding-google-ai-studio/), [Firebase Studio sunset](https://firebase.google.com/docs/studio/migrating-project)
