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
