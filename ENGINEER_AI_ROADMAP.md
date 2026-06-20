# Engineer AI — Mythos-Level Build Roadmap

> ## 📁 SCOPE OF THIS FILE — read first
> This file is the **single home** for the **Engineer AI** workstream's roadmap and
> edit plan (the autonomous Grok-only + E2B agent that sees/drives/tests/fixes apps).
> All Engineer-AI planning, phases, and progress belong **here, and only here**.
>
> The **NavBharatAI Pro** app-maker engine is a **separate project** — its plan and
> progress live in **`PROGRESS.md`**. Do NOT mix the two: no NavBharatAI-Pro plan in
> this file, no Engineer-AI plan in `PROGRESS.md`.

> **Goal:** Engineer AI that builds real apps, deploys them to permanent URLs, and wires
> in real databases — matching Bolt.new / Lovable.dev quality under the Engineer AI brand.
> **AI Model:** Grok ONLY (xAI api.x.ai) — no Claude, no AiCredits proxy.
> **Sandbox:** E2B (real cloud VM, full OS isolation).
> **Updated:** 2026-06-19 (v3 — Phases 1–13 shipped; Phase 14 redesigned as Bring Your Own Database)

---

## INFRASTRUCTURE NOTES (confirmed 2026-06-19)

**Firebase project:** `gen-lang-client-0866594388` — this is the REAL project used by all code
(`firebase-applet-config.json`, `src/config/firebase.ts`, `FirestoreJobStore`).
`navbharatai-3395f` in `.firebaserc` is a stale CLI alias — ignore it.

**Google credentials:** `GOOGLE_APPLICATION_CREDENTIALS` is NOT set as an env var.
Firebase Admin SDK uses **Application Default Credentials (ADC)** via Cloud Run's service identity
— proven by `FirestoreJobStore.initializeApp({})` which works in production with zero credential config.
Same ADC mechanism powers Phase 13 Firebase Hosting REST API calls. No new secrets needed.

**If Phase 13 deploy returns 403:** Grant the Cloud Run service account
`Firebase Hosting Admin` IAM role on project `gen-lang-client-0866594388` in GCP Console.

---

## CURRENT STATUS

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation (core fixes + browser bar) | ✅ DONE — merged PR #72 |
| 2 | Agent Eyes — Screenshots (Grok vision) | ✅ DONE — merged PR #72 |
| 3 | Agent Hands — Browser Actions (Playwright) | ✅ DONE — merged PR #72 |
| 4 | Live Sync (error capture) | ✅ DONE — merged PR #72 |
| 5 | Web Search (DuckDuckGo key-free) | ✅ DONE — merged PR #72 |
| 6 | Workspace Persistence (E2B pause/resume) | ✅ DONE — merged PR #72 |
| 6.5 | Visible AI Cursor — live preview driving | ✅ DONE — merged |
| 7 | Whole-project context (smart retrieval) | ✅ DONE — merged PR #74 |
| 8 | Checkpoints + Rollback | ✅ DONE — merged PR #75 |
| 9 | Live bidirectional sync + one-click deploy | ✅ DONE — merged PR #76 |
| 10 | Database + Auth + Storage provisioning | ✅ DONE — merged PR #77 |
| 11 | Git + real auto-repair + multi-framework | ✅ DONE — merged PR #78 |
| 12A | Multi-viewport verify + cross-session memory | ✅ DONE — merged PR #79 |
| 12B–F | Tests, design-to-code, cost control, mobile UX | ✅ DONE — merged PR #80 |
| **13** | **Real Persistent Deploy (Firebase Hosting)** | ✅ DONE — merged PR #84 |
| **14** | **Bring Your Own Database (user-controlled DB/Auth)** | ✅ DONE — code complete (BackendScaffolder.ts) |
| 15 | Brave Search API (replace DuckDuckGo) | ✅ DONE — Brave primary + DuckDuckGo fallback |
| 16 | Production Build Pipelines (esbuild Node/Next) | ✅ DONE — merged PR #102 |
| 17 | Real Test Generation (proactive Vitest) | ✅ DONE — merged PR #101 |
| 18 | Grok Quality (CoT + self-review pass) | ✅ DONE — merged PR #101 |
| 19 | Persistent Memory (Firestore-backed) | ✅ DONE — merged PR #101 |
| 20 | UX Polish + Mobile-First Redesign | ✅ DONE — merged PR #103 |
| **21** | **App Self-Awareness (NavBharatAI Brain)** | ✅ DONE — merged PR #101 |

> **What's live now (Phases 1–21, all merged):** Engineer AI can SEE apps (Grok vision),
> DRIVE them (Playwright), CATCH runtime errors, SEARCH the web, PERSIST/RESUME workspaces
> (E2B pause/resume), DEPLOY to Firebase Hosting, use esbuild for Node.js production builds,
> write Vitest tests proactively, self-review edits with CoT, remember context across sessions
> (Firestore memory), and understand the NavBharatAI app itself (App Self-Awareness).
> Mobile-first UI: hamburger nav, bottom bar, swipe gestures, Quick Tools wrap on mobile.
> Multi-provider fallback: Grok → Anthropic → Vertex → Gemini.
>
> **All 21 phases complete.**

---

## PHASE 1 — Foundation ✅ DONE (merged, deployed)

> Merged via PR #72. E2B_API_KEY + GROK_API_KEY Cloud Run me added ✅.

**Kya bana:**
- `req.on('close')` → `res.on('close')` — chatbox dead fix (root cause)
- Grok priority-1, AiCredits fallback (but Engineer AI ke liye Grok ONLY rakhunga Phase 2 se)
- Browser tab me URL address bar — user koi bhi link khuld sakta hai
- E2B me long-running dev servers background mode me chalte hain
- `server_ready` event se live preview URL auto-load hota hai iframe me

**Block:** Dono PRs merge karo aur do keys daalo. Tab tak aage nahi badha ja sakta.

---

## PHASE 2 — Agent ko Aankhein dena: SCREENSHOTS 👁️

> Sabse important phase. Yahi Devin/Mythos ka core hai.
> Agent apna banaya hua app DEKHE — code padhna kaafi nahi hai.

### Kya hoga end-to-end:
1. Agent "screenshot" action le sakta hai
2. E2B sandbox me Playwright khulta hai, running app ka screenshot leta hai
3. Screenshot (base64 PNG) Grok vision model ko jaata hai
4. Grok kehta hai: "navbar left-align ho gayi, button missing hai, form submit nahi ho raha"
5. Agent yeh dekh ke code fix karta hai, phir dobara screenshot leta hai
6. Frontend pe screenshot dikhta hai — user bhi dekhe, agent bhi dekhe

### Files banani ya badalni hain:

**`src/server/EngineerAI/actuators/IEngineerActuator.ts`**
- Naya method add: `screenshot(workspaceId, url): Promise<{ base64: string; mimeType: string }>`

**`src/server/EngineerAI/actuators/E2BActuator.ts`**
- Implement: Playwright `chromium.launch()` → `page.goto(url)` → `page.screenshot({ type: 'png' })` → base64

**`src/server/EngineerAI/actuators/LocalActuator.ts`**
- Reject (jaise browseUrl karta hai) — vision sirf E2B me kaam karta hai

**`src/server/AI/Router/AIRouter.ts`**
- `route()` method extend: optional `images?: string[]` parameter accept kare
- Grok vision ke liye content array format me images pass kare

**`src/server/AI/Router/providers/GrokProvider.ts`**
- `execute()` me vision support: agar `images` diya to `content` array me `image_url` blocks add karo
- Format: `{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }`
- Grok-2-vision ya latest Grok model use karo (already `api.x.ai/v1`)

**`src/server/EngineerAI/EngineerAITypes.ts`**
- Naya action: `screenshot` — `{ url?: string }` args (blank = current preview)
- Naya event: `screenshot_result` — `{ url: string; base64: string }`

**`src/server/EngineerAI/EngineerAgentLoop.ts`**
- `screenshot` action handle karo: `actuator.screenshot()` call → `screenshot_result` event yield → image ko next AI call me include karo
- SYSTEM_PROMPT update: agent ko batao "screenshot action se app dekh sakta hai, verify karne ke liye use karo"
- `buildPrompt()` me latest screenshot context include karo agar available hai

**`src/components/engineer/EngineerAIChat.tsx`**
- `screenshot_result` event: screenshot browser tab me show karo (ya chat me thumbnail)

### Loop after Phase 2:
```
Code likho → Build karo → Dev server start karo → Screenshot lo → Grok dekhe →
Fix karo → Screenshot dobara lo → Theek hai? → Done
```

---

## PHASE 3 — Agent ko Haath dena: BROWSER ACTIONS 🖱️

> Agent sirf dekhe nahi — click kare, type kare, form bhar ke submit kare, verify kare.

### Kya hoga:
- Agent `browser_click`, `browser_type`, `browser_navigate` actions le sakta hai
- Playwright coordinates ya CSS selectors use karta hai
- Har browser action ke baad automatically screenshot aata hai (Phase 2 se)
- Agent form fill kare, submit kare, aur check kare result theek aaya ya nahi

### Files:

**`IEngineerActuator.ts`**
- Naya method: `browserAction(workspaceId, action, args): Promise<{ screenshot: string; result: string }>`
- Actions: `click(selector)`, `type(selector, text)`, `navigate(url)`, `scroll(direction)`, `wait(ms)`

**`E2BActuator.ts`**
- Persistent Playwright browser instance maintain karo per sandbox (new ek baar, phir reuse)
- `browserAction()` implement karo: proper selector handling, timeout, error catching

**`EngineerAITypes.ts`**
- Naya action: `browser_action` — args: `{ action: 'click'|'type'|'navigate'|'scroll', selector?: string, text?: string, url?: string }`
- Naya event: `browser_action_result` — `{ action: string; screenshot: string; success: boolean; detail: string }`

**`EngineerAgentLoop.ts`**
- `browser_action` handle: actuator call → screenshot embed → next step me Grok ko dikhaao
- SYSTEM_PROMPT: "app build ke baad khud test karo — click, form fill, verify results"

### Loop after Phase 3:
```
Build → Start server → Screenshot → "Login form dikhta hai" →
browser_type("#email", "test@test.com") → browser_click("#submit") →
Screenshot → "Login successful dikhta hai" → Done ✅
```

---

## PHASE 4 — User + Agent ka Browser Ek ho: LIVE SYNC 🔄

> Yeh sabse powerful UX hai. User exactly wahi dekhe jo agent dekh raha hai.

### Kya hoga:
- Agent jab bhi screenshot le → frontend pe real-time show ho (har 2-3 sec)
- User ka browser bar aur agent ka browser bar sync rahe
- User frontend pe kisi element pe click kare → coordinates NDJSON stream me agent ko jaayein
- Console errors (JS errors, network failures) live chat me aayein
- Agent jab navigate kare → user ka URL bar update ho

### Files:

**`EngineerAITypes.ts`**
- Naya event: `browser_sync` — `{ screenshot: string; url: string; timestamp: number }`
- Naya event: `console_error` — `{ message: string; stack?: string; url: string }`

**`EngineerAgentLoop.ts`**
- Background screenshot polling: jab dev server chal raha ho, har 3 second pe screenshot → `browser_sync` yield
- Console error feed: E2B me JS console errors capture karo

**`E2BActuator.ts`**
- `watchConsole(workspaceId, cb)` — Playwright `page.on('console')` + `page.on('pageerror')` hook

**`EngineerAIChat.tsx`**
- `browser_sync` event: live screenshot browser tab me (image element, auto-update)
- User click on screenshot → coordinates capture → NDJSON frame me server ko bhejo
- `console_error` event: chat me error badge show karo

**Server side: `routes/engineer.ts`**
- Bidirectional streaming (NDJSON already unidirectional) — user ke click events accept karne ke liye
- Ya: ek alag `POST /api/engineer-browser-event` endpoint

---

## PHASE 5 — Web Search: Agent Documentation Dhundh Sakta Hai 🔍

> Agent stuck nahi hoga. Naya package? Version issue? Khud search karega.

### Kya hoga:
- Agent `web_search` action le sakta hai
- Results process karo → relevant part AI context me jaaye
- `npm_info` action bhi: exact package version check

### Files:

**`EngineerAITypes.ts`**
- Naya action: `web_search` — `{ query: string }`
- Naya event: `search_result` — `{ query: string; results: { title: string; url: string; snippet: string }[] }`

**`src/server/EngineerAI/WebSearchClient.ts`** (naya file)
- Brave Search API ya Serper.dev API (ek aur key chahiye — user se lena hoga)
- Ya Grok ka built-in search (xAI Live Search feature — agar available ho)
- Fallback: npm registry API for package-specific queries (no key needed)

**`EngineerAgentLoop.ts`**
- `web_search` handle: search call → top 3 results → context me include
- SYSTEM_PROMPT: "use web_search jab documentation chahiye, package version chahiye, ya error ka solution nahi milta"

---

## PHASE 6 — Memory + Persistence: Workspace Survive Kare 💾

> Har session me naya sandbox nahi. Kaam kahan chhoda tha wahaan se shuru.

### Kya hoga:
- Session khatam hone pe E2B snapshot lo (sandbox freeze + ID save karo)
- Agli session me same snapshot se resume karo (files, node_modules, running state)
- Project context yaad rahe: stack, project name, last instruction

### Files:

**`E2BActuator.ts`**
- `saveSnapshot(workspaceId): Promise<string>` — E2B `sandbox.snapshot()` call → snapshot ID return
- `resumeFromSnapshot(workspaceId, snapshotId): Promise<void>` — `Sandbox.create(snapshotId)` use karo

**`IEngineerActuator.ts`**
- `saveSnapshot()` aur `resumeFromSnapshot()` interface me add

**`src/server/routes/engineer.ts`**
- Naya endpoint: `POST /api/engineer-snapshot` — snapshot ID save karo (Firestore ya memory)
- Naya endpoint: `GET /api/engineer-snapshot/:workspaceId` — last snapshot ID return

**`EngineerAIChat.tsx`**
- Session khatam hone pe (component unmount) → snapshot save karo silently
- Next session start pe → agar snapshot available hai → resume karo automatically

---

## ════════════════════════════════════════════════
## PART 2 — GAP-CLOSING ROADMAP (Mythos parity → Mythos beat)
## ════════════════════════════════════════════════

> Phases 1–6 ne Engineer AI ko "dekhne + chalane wala agent" bana diya — woh sab DONE + LIVE hai.
> Ab yeh phases use "duniya ka best AI app maker" banayenge. Source: Mythos-class comparison.
> **Rule wahi:** Grok ONLY, E2B-native, pure additive, app kabhi na toote.
> **Build order:** **6.5** → 7 → 8 → 9 → 10 → 11 → 12 (impact + safety order). Ek-ek karke, har phase apni PR.

---

## PHASE 6.5 — Visible AI Cursor: Live Preview Driving 🖱️👀 🔜 NEXT

> **User ka vision:** "Jaise Engineer AI ko aankhein (eyes 👀) di — ab use ek HAATH do: ek
> cursor jo AI control kare, live preview chala ke khud dekhe, jo kaha jaaye woh kare, aur
> koi problem aaye to apni hi banayi eyes se dekh ke theek kare."
>
> **Note:** Phase 3 ne "hands" (browser_action: click/type/navigate/scroll/press/wait) aur
> Phase 2 ne "eyes" (Grok vision screenshots) already de diye — par woh sab **headless**
> hai (E2B ke andar, user dekh nahi paata). Phase 6.5 unko **VISIBLE + LIVE + autonomous**
> banata hai: user apni aankhon se dekhe ki AI ka cursor live preview pe kya kar raha hai.

### Kya hoga end-to-end:
1. **Visible cursor overlay** — har browser_action/screenshot ke saath cursor ki (x,y)
   position aaye; frontend live screenshot ke upar ek animated cursor 🖱️ render kare —
   user dekhe AI kahaan click/type kar raha hai (Mythos/Devin jaisa "agent driving" feel).
2. **Live drive stream** — drive session ke dauraan har action ke baad fresh screenshot
   turant frontend pe (browser tab live update) — ruk-ruk ke nahi, continuous.
3. **"Drive preview" mode** — user bole "preview chala ke test kar" / "login try kar" →
   agent autonomously: navigate → click → type → submit → screenshot → vision se verify →
   problem dikhe to khud fix/retry. Yeh Phase 2 (eyes) + Phase 3 (hands) ka tight loop hai.
4. **Self-heal via eyes** — koi bhi step pe screenshot + runtime errors (Phase 4) dekh ke
   agent khud decide kare agla kadam — "button nahi mila / page blank / error aaya" → fix.

### Files (additive, Grok-only, E2B-native):
- **`E2BActuator.ts`** — `browserAction()`/`screenshot-cdp` me cursor position bhi return karo:
  click/type se pehle `page.mouse.move(x,y)` + element ka bounding-box center nikaalo;
  result me `{ cursorX, cursorY }` add. (CDP shared-browser already hai — hardening PR se.)
- **`EngineerAITypes.ts`** — `browser_action_result`/`screenshot_result` me optional
  `cursorX?/cursorY?`; naya `drive_frame` event (live screenshot + cursor + url).
- **`EngineerAgentLoop.ts`** — naya high-level `drive` action (ya browser_action ko extend):
  "drive this preview / test this flow" — internal mini-loop (navigate→act→see→fix),
  har frame `drive_frame` yield. SYSTEM_PROMPT update.
- **`EngineerAIChat.tsx`** — browser tab pe live screenshot ke upar absolute-positioned
  cursor 🖱️ (CSS transition se smooth move); `drive_frame` pe image + cursor update;
  "AI is driving…" indicator.

### Loop:
```
User: "preview chala ke login test kar"
 → navigate(localhost:3000) → [cursor 🖱️ user ko dikhe] → screenshot → eyes: "login form hai"
 → type(#email) → type(#password) → click(submit) [cursor har step pe move karta dikhe]
 → screenshot → eyes: "dashboard aaya ✅" ya "error aaya ❌ → fix → retry"
 → Done (user ne LIVE dekha)
```

### Done when: user apni aankhon se dekhe AI ka cursor live preview pe click/type karke
app drive kar raha hai, aur problem aane pe khud (vision se) theek kar raha hai.

> **Depends on:** hardening PR (`fix/engineer-ai-audit-hardening`) — kyunki shared-CDP-browser
> screenshot wahaan se aata hai. Pehle woh merge, fir 6.5.

---

## PHASE 7 — Whole-Project Context (Smart Retrieval) 🧠

> **Problem:** Abhi agent sirf 20 files × 1000 chars dekhta hai (`EngineerAgentLoop.ts`:
> `MAX_FILES_SHOWN = 20`, `MAX_CHARS_PER_FILE = 1000`). Bada app = agent andha. Yeh sabse
> bada correctness gap hai.

### Kya hoga:
- Har step pe poori workspace dump karne ke bajaye — **task ke relevant** files retrieve karo.
- Keyword/grep-based retrieval first (no embeddings, no extra key): instruction + recent
  errors se search terms nikaalo, sandbox me `grep -rl` chala ke matching files laao.
- File tree summary (sirf paths) hamesha do, content sirf relevant files ka.
- Bade file ke liye: symbol outline (imports/exports/function signatures) bhejo, poora body nahi.

### Files:
- **`EngineerAgentLoop.ts`** — `buildPrompt()` rewrite: relevance-ranked file selection;
  `MAX_FILES_SHOWN`/`MAX_CHARS_PER_FILE` ko dynamic budget se replace karo (~12k char budget).
- **`IEngineerActuator.ts`** + **`E2BActuator.ts`** + **`LocalActuator.ts`** — naya
  `searchFiles(workspaceId, terms): Promise<string[]>` (sandbox `grep -rl`, node_modules skip).
- **(naya)** `src/server/EngineerAI/ContextRetriever.ts` — relevance ranking + budget packing.

### Done when: 60+ file project me agent sahi file edit kare bina "file not found / blind guess".

---

## PHASE 8 — Checkpoints + Rollback (Safety) ⏪

> **Problem:** Edits seedhe write hote hain, koi undo nahi. Ek galat step workspace corrupt
> kar sakta hai — yeh "app kabhi na toote" rule ke against hai. Safety pehle.

### Kya hoga:
- Har mutating action (edit_file / patch_file / bash-jo-files-badle) se PEHLE ek checkpoint.
- Checkpoint = lightweight: workspace ka git stash-style snapshot (Phase 11 git aane se pehle:
  E2B filesystem snapshot ya `cp -r` to `.checkpoints/<n>`).
- Frontend me har checkpoint ke saath "Restore" button — ek click me us point pe wapas.
- Agent khud bhi rollback kar sake agar koi change cheezein toad de (build red ho jaye).

### Files:
- **`IEngineerActuator.ts`/`E2BActuator.ts`/`LocalActuator.ts`** — `checkpoint(workspaceId): id`,
  `restore(workspaceId, id)`.
- **`EngineerAgentLoop.ts`** — mutating action se pehle auto-checkpoint; build-fail pe
  agent ko restore option.
- **`EngineerAITypes.ts`** — `checkpoint_created` event.
- **`EngineerAIChat.tsx`** — checkpoint timeline + Restore button.

### Done when: koi bhi step ke baad ek click se us se pehle ki exact state wapas aaye.

---

## PHASE 9 — Live Bidirectional Sync + One-Click Deploy 🔄🚀

> Original Phase 4 ka bacha hua hissa + deploy. Do cheezein jo "agent" ko "product" banati hain.

### 9A — Live bidirectional sync (Phase 4 remainder):
- Dev server chalu hone pe har ~3 s background screenshot → `browser_sync` event → user live dekhe.
- User preview pe click kare → coordinates server ko jaayein → agent ko "user yahan click kar raha hai" pata chale.
- Naya `POST /api/engineer-browser-event` (user → agent), ya NDJSON ke saath light polling.

### 9B — One-click Deploy:
- Agent ka banaya app E2B dev-server URL pe chalta hai (temporary). "Publish" button:
  app ko build kar ke ek persistent public URL pe host karo.
- v1: E2B sandbox ko alive rakh ke stable public host URL (already `getHost(port)` hai).
- v2: static build ko hamare existing Cloud Run/Firebase hosting pipeline pe push (CLAUDE.md
  deploy infra reuse) + optional custom domain.

### Files: `EngineerAgentLoop.ts` (bg screenshot loop), `routes/engineer.ts` (browser-event +
`/api/engineer-deploy`), `E2BActuator.ts` (`deploy()`), `EngineerAITypes.ts` (`browser_sync`,
`deployed`), `EngineerAIChat.tsx` (live image + click capture + Publish button).

### Done when: user agent ko build karte hue LIVE dekhe, click kar ke guide kare, aur ek button se app public ho.

---

## PHASE 10 — Database + Auth + Storage Provisioning 🗄️

> **Problem:** Real apps (login, todo-with-account, SaaS) backend ke bina nahi bante.

### Kya hoga:
- Agent `provision_db` action le sake: ek Postgres/Supabase-style backend auto-wire ho.
- Auth (email/password + session) + file storage ka boilerplate auto-generate.
- Connection string/secrets sandbox env me inject ho (built app ke liye), UI me na leak ho.
- v1: E2B ke andar local Postgres + ek thin auth/storage helper lib scaffold.
- v2: managed backend provider over HTTP (jab user key de).

### Files: naya `BackendProvisioner.ts`, actuator me `provisionBackend()`, loop me action +
prompt, types me events, frontend me "Backend ready" badge.

### Done when: "login wala todo app banao" → agent DB + auth khud bana ke working app de.

---

## PHASE 11 — Git + Real Auto-Repair + Multi-Framework 🔧

### 11A — Git inside workspace:
- `git init`, har milestone pe commit, branch, diff-history, purane version pe restore.
- Phase 8 checkpoints ko git commits se back karo (proper history).

### 11B — Real auto-repair loop:
- Build/runtime fail → agent auto-diagnose → fix → re-verify (2–3 pass) — sirf report nahi.
- Web_search + error text + relevant file (Phase 7) combine kar ke targeted fix.

### 11C — Multi-framework scaffolds:
- Abhi sirf vite-react (`E2BActuator.ensureWorkspace`). Add: Next.js, Vue, Svelte, Node/Express
  API, Python/FastAPI, static site — `TemplateRegistry` extend karke.

### Files: actuator (`gitCommit`/`gitLog`/`gitRestore`, new templates), loop (auto-repair),
types/frontend (commit timeline).

### Done when: agent versioned commits banaye, fail hone pe khud fix kare, aur React ke alawa stacks bhi scaffold kare.

---

## PHASE 12 — Differentiators (Design-to-Code, Tests, Polish) ✨

- **Design-to-code:** user screenshot/Figma image upload kare → Grok vision se matching UI bane.
- **Test gen + run:** agent tests likhe, loop me chalaye, red test ko build-fail jaise treat kare.
- **Multi-viewport verify:** mobile + desktop width pe screenshot, layout fix.
- **Asset upload:** logos/images workspace me drop.
- **Cross-session project memory:** decisions/architecture summary persist (kyun, sirf files nahi).
- **Cost control:** per-user E2B+Grok usage tracking, idle sandbox auto-cleanup.
- **Shareable preview links** (optional password), better mobile UX for 4-panel layout.

### Done when: Engineer AI sirf parity nahi — Mythos se aage (design-in, tested-out, remembered).

---

## Gap-Closing Phase Order + Effort

| Phase | Theme | Priority | New files | Modified |
|-------|-------|----------|-----------|----------|
| 6.5 | Visible AI cursor — live preview driving | 🔴 NEXT (user-requested) | 0 | 4 |
| 7 | Whole-project context | 🔴 Critical | 1 | 4 |
| 8 | Checkpoints + rollback | 🔴 Critical (safety) | 0 | 5 |
| 9 | Live sync + deploy | 🔴 Critical | 0 | 4 |
| 10 | DB + auth + storage | 🔴 Critical | 1 | 4 |
| 11 | Git + auto-repair + frameworks | 🟠 High | 0 | 4 |
| 12 | Differentiators | 🟡 Medium | 2–3 | several |

> Har phase: branch → build → `tsc` (frontend + server) + `vitest` green → PR → merge → deploy.
> Ek phase merge hone ke baad hi agla shuru (cross-session safe, CLAUDE.md safeguard #2).

---

## Technical Decisions (Final)

| Decision | Choice | Reason |
|----------|--------|--------|
| AI Model | **Grok ONLY** | User ka instruction — no Claude |
| Sandbox | **E2B** | Real VM, Playwright support, network access |
| Vision | **Grok vision** (multimodal) | Same API, same key, `api.x.ai/v1` already connected |
| Browser automation | **Playwright in E2B** | Already available in e2b base template |
| Web search | Brave API / Grok Live Search | TBD — user se key needed |
| Persistence | E2B Snapshots | Built-in to e2b SDK |
| Stream protocol | **NDJSON** (already working) | No change needed |

---

## Order of Execution

```
PART 1 (DONE ✅ — merged PR #72, deployed):
Phase 1 → 2 → 3 → 5 → 6   ✅ all shipped
Phase 4                    🟡 error-capture shipped; sync-half → Phase 9

PART 2 (gap-closing, one-by-one, each its own PR):
Audit hardening  ← PR open (fix/engineer-ai-audit-hardening): true Grok-only + correctness
Phase 6.5 ← NEXT (visible AI cursor — live preview driving, user-requested)
Phase 7          (whole-project context)
Phase 8          (checkpoints + rollback)
Phase 9          (live sync + deploy)
Phase 10         (DB + auth + storage)
Phase 11         (git + auto-repair + frameworks)
Phase 12         (differentiators)
```

**Discipline:** ek phase merge + deploy verify hone ke baad hi agla. No batching.

---

## Estimated Files Changed Per Phase

| Phase | New Files | Modified Files |
|-------|-----------|---------------|
| 2 (Screenshots) | 0 | 6 |
| 3 (Browser Actions) | 0 | 5 |
| 4 (Live Sync) | 0 | 4 |
| 5 (Web Search) | 1 | 3 |
| 6 (Memory) | 0 | 4 |

Koi bada refactor nahi — pure additive changes. Existing code safe rahega.

---

## PHASE 13 — Real Persistent Deployment (Firebase Hosting) ✅ DONE (merged PR #84)

> Phase 13 is complete. Every app built by Engineer AI now gets a permanent Firebase
> Hosting URL that survives sandbox pause/resume/recreation.

### What shipped:
- `DeploymentService.ts` (new) — Firebase Hosting REST API v1beta1 client
  - ADC auth (GoogleAuth, no new env vars needed on Cloud Run)
  - Per-workspace preview channel: `eng-{workspaceId}` → permanent URL
  - Full file upload flow: hash → populateFiles → gzip upload → finalize → release
  - URL: `https://gen-lang-client-0866594388--eng-{workspaceId}.web.app`
- `IEngineerActuator.downloadDistFiles()` — downloads built dist/ from sandbox as Map<path, Buffer>
- `E2BActuator.downloadDistFiles()` — Node.js script inside sandbox reads all files as base64 JSON
- `LocalActuator.downloadDistFiles()` — throws (Firebase deploy requires real E2B sandbox)
- `EngineerAITypes` — new `deploy` action + `deploy_result` event
- `EngineerAgentLoop` — `deploy` action: build → download → Firebase upload → `deploy_result` event
- `routes/engineer.ts` — `/api/engineer-deploy` now does real Firebase Hosting deploy
- `EngineerAIChat.tsx` — `deploy_result` event handled; shows "Deployed!" with permanent URL

### Agent usage:
```json
{ "action": "deploy", "args": {} }
```
Agent auto-runs the build, uploads dist/ to Firebase, returns permanent URL in `deploy_result`.

### One-time IAM setup (if 403):
Grant Cloud Run service account → Firebase Hosting Admin role on project `gen-lang-client-0866594388`.

### Files changed: 8 files (1 new)

---

## PHASE 14 — Bring Your Own Database (User-Controlled DB/Auth) 🗄️

> **Critical design principle:** NavBharatAI's own Firebase project
> (`gen-lang-client-0866594388`) is NEVER used for user app data — that would
> charge NavBharatAI's billing. Every user brings their own credentials from
> their own account. NavBharatAI just scaffolds the code.

### What we'll build:

**Provider selection UI (inside EngineerAIChat workspace panel):**
- Dropdown: **Firebase** / **Supabase** / **Other**
- After selection, a direct link appears pointing to that provider's API key /
  credentials page so the user can generate keys without searching:
  - Firebase → `console.firebase.google.com` (Project Settings → Service Accounts / Web App)
  - Supabase → `app.supabase.com` (Project → Settings → API)
  - Other → free-form text field: "Platform name" + "Connection string / API key"
- User pastes their credentials once; they are stored in workspace memory
  (never in NavBharatAI's Firestore — stored inside the E2B sandbox's
  `.engineer/db-config.json` only, scoped to that workspace).

**Agent scaffolding (triggered automatically when DB credentials are present):**

For **Supabase**:
```typescript
// agent generates: src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
```
Agent writes `.env` placeholders (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
and fills them from stored credentials. Also scaffolds auth flows
(email/password, Google OAuth) and RLS-aware SQL schemas via a Grok call.

For **Firebase**:
```typescript
// agent generates: src/lib/firebase.ts
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
const app = initializeApp({ /* user's own Firebase config */ });
export const db = getFirestore(app);
export const auth = getAuth(app);
```

For **Other** (any platform):
Agent receives the platform name + connection string. A Grok call determines
the correct SDK and generates the setup file. Fallback: a generic `.env` file
with the connection string and comments explaining how to use it.

### Files to create/modify:

**`src/server/EngineerAI/BackendScaffolder.ts`** (NEW)
```typescript
export interface DbProviderConfig {
  provider: 'supabase' | 'firebase' | 'other';
  credentials: Record<string, string>;
  platformName?: string; // for 'other'
}

export class BackendScaffolder {
  async generateSetup(config: DbProviderConfig, framework: string): Promise<ScaffoldResult>
  private generateSupabase(config: DbProviderConfig): ScaffoldResult
  private generateFirebase(config: DbProviderConfig): ScaffoldResult
  private generateOther(config: DbProviderConfig): ScaffoldResult
}
```

**`src/server/routes/engineer.ts`**
- New endpoint: `POST /api/engineer-db-config` — stores credentials to workspace
  `.engineer/db-config.json` inside the sandbox (never to NavBharatAI Firestore)
- Returns: scaffold files generated for the chosen provider

**`src/server/EngineerAI/EngineerAITypes.ts`**
- New event: `backend_provisioned` — `{ provider: string; filesWritten: string[] }`

**`src/server/EngineerAI/EngineerAgentLoop.ts`**
- On session start: check `.engineer/db-config.json` — if present, include DB
  context in system prompt so agent knows which SDK is available
- System prompt note: if user asks for auth/DB features and no config exists,
  instruct them to configure their database provider first

**`src/components/engineer/EngineerAIChat.tsx`**
- New "Database" settings section in the workspace panel:
  - Provider dropdown (Firebase / Supabase / Other)
  - On selection: show direct key-generation link for that provider
  - "Other": text input for platform name + connection string
  - Save button → POST to `/api/engineer-db-config`
  - Confirmation badge: "Supabase connected" / "Firebase connected"
- `backend_provisioned` event: show scaffold summary in chat

### Key invariant:
NavBharatAI's Firebase project is NEVER referenced in any scaffolded code.
The only Firebase project that ever appears in user app code is the user's own.

### Done when:
1. User opens Engineer AI, clicks "Database", selects "Supabase"
2. A direct link to `app.supabase.com` appears
3. User pastes their URL + anon key, clicks Save
4. Agent automatically generates `src/lib/supabase.ts` with the user's credentials
5. User says "add user login" → agent scaffolds Supabase Auth flow
6. App authenticates and stores data in the **user's own** Supabase project

---

## PHASE 21 — App Self-Awareness: NavBharatAI Brain 🧠

> **The Vision:** Right now, every AI inside NavBharatAI — Doctor AI, Engineer AI, and
> any future AI — is "blind" about the app it lives inside. Ask Engineer AI "settings
> kahan hai?" and it will guess or say it doesn't know. Ask Doctor AI "mujhe koi aur
> feature chahiye" and it has no map of what exists.
>
> After Phase 21, every AI in NavBharatAI will know the entire app — every feature,
> every screen, every button's location, every setting's path — the same way a human
> brain knows every part of its own body. Not just "there is a settings button" —
> but *exactly* where it is, what it contains, what it does, and how to get there.
>
> **Analogy:** The human brain doesn't just know that the heart exists. It knows the
> heart is in the chest cavity, left-center, it pumps blood, it has 4 chambers, if
> it hurts it means X. NavBharatAI's AIs should know the app at that same depth —
> "Settings is the gear icon top-right, it has 6 tabs, Database is tab 3, you paste
> your Supabase key there, here is the exact path."

---

### Why this is a separate phase (not just a system prompt addition):

The naive fix is: paste the app's feature list into every AI's system prompt. That
doesn't work at scale because:
1. The app keeps growing — every new feature, every UI change would require manually
   updating every AI's prompt. It would rot within weeks.
2. Context window cost — a large static app-description block in every prompt wastes
   tokens on every single API call, even when the user is asking a question that has
   nothing to do with the app's structure.
3. It needs to stay synchronized with the real app — if someone moves a button or
   renames a setting, the AI's knowledge must update automatically.

**The right solution is a live, auto-generated, structured App Knowledge Base** that
is injected into AI system prompts selectively — only when relevant — and that updates
itself whenever the app changes.

---

### What we'll build:

#### 1. `AppKnowledgeBase.ts` (new server file)

A single source of truth — a machine-readable, structured map of NavBharatAI:

```typescript
export interface AppFeature {
  id: string;
  name: string;
  path: string;           // how to navigate there (e.g. "Sidebar → Professionals → Doctor AI")
  description: string;    // what it does
  howToUse: string;       // step-by-step for a user
  relatedFeatures: string[];
  aiSurface?: string;     // which AI owns this (e.g. "sda_chat", "engineer_ai")
}

export const APP_KNOWLEDGE_BASE: AppFeature[] = [
  {
    id: 'settings_database',
    name: 'Database Settings',
    path: 'Settings (gear icon, top-right) → Database tab',
    description: 'Where users add their own database credentials (Supabase / Firebase / Other)',
    howToUse: 'Click gear icon → Database → choose provider → paste URL + key → Save',
    relatedFeatures: ['engineer_ai', 'pro_chat'],
  },
  {
    id: 'engineer_ai',
    name: 'Engineer AI',
    path: 'Sidebar → Professionals → Engineer AI',
    description: 'Autonomous AI agent that builds, runs, tests, and deploys full apps',
    howToUse: 'Describe the app you want → Engineer AI builds it step by step',
    relatedFeatures: ['settings_database', 'history'],
    aiSurface: 'engineer_ai',
  },
  {
    id: 'doctor_ai',
    name: 'Doctor AI',
    path: 'Sidebar → Professionals → Doctor AI',
    description: 'Senior doctor assistant — clinical reasoning, diagnosis support, drug info',
    howToUse: 'Describe symptoms or ask a clinical question',
    relatedFeatures: ['history'],
    aiSurface: 'sda_chat',
  },
  // ... all features, settings, surfaces mapped here
];
```

This file is the **single source of truth**. When a new feature ships, one entry is
added here. Every AI automatically benefits.

---

#### 2. `AppContextInjector.ts` (new server utility)

Smart, token-efficient context injection — NOT a static block pasted into every prompt:

```typescript
export class AppContextInjector {
  /**
   * Given the user's current message and which AI surface they are on,
   * return a focused subset of AppKnowledgeBase entries relevant to
   * this conversation turn — keeping the injected context small.
   *
   * Examples:
   *   "database kahan hai?" → injects settings_database entry only
   *   "koi aur AI hai?" → injects all aiSurface entries
   *   "app kya kya kar sakta hai?" → injects the full summary
   */
  static getRelevantContext(userMessage: string, surface: string): string
  static getFullSummary(): string   // used when user explicitly asks about the whole app
  static getFeatureById(id: string): AppFeature | null
}
```

This keeps the injected context under ~200 tokens in most turns (vs. 2000+ for a
static full-app dump on every call). The full map is only sent when the user is
genuinely asking "what can this app do?"

---

#### 3. System prompt integration (all AIs)

Every AI's system prompt gets one new block at the top:

```
ABOUT NAVBHARATAI (inject relevant entries here)
You are operating inside NavBharatAI. When the user asks about the app,
its features, or how to navigate anywhere, you have complete knowledge.
Never say "I don't know where that is" — consult the app context below.
[AppContextInjector.getRelevantContext(userMessage, surface) result here]
```

This block is populated **per-request** by `AppContextInjector`, so:
- Turn 1 (user: "code likhke deploy karo") → no app-context injected (irrelevant)
- Turn 2 (user: "database settings kahan hain?") → settings_database block injected
- Turn 3 (user: "navbharatai me kya kya hai?") → full summary injected

---

#### 4. Auto-sync mechanism

`AppKnowledgeBase.ts` is the source of truth. Rules to keep it fresh:
- Every new feature that ships → one entry added (part of the feature's PR checklist)
- Settings restructure → update the `path` field
- Feature renamed → update `name` field

No AI prompt files need touching. Updating `AppKnowledgeBase.ts` propagates to
every AI automatically via `AppContextInjector`.

---

### Files to create/modify:

| File | Action | Purpose |
|------|--------|---------|
| `src/server/AppContext/AppKnowledgeBase.ts` | NEW | Structured map of entire app |
| `src/server/AppContext/AppContextInjector.ts` | NEW | Smart context selection per turn |
| `src/server/routes/engineer.ts` | MODIFY | Inject app context into Engineer AI system prompt |
| `server.ts` (SDA route) | MODIFY | Inject app context into Doctor AI system prompt |
| `src/server/AI/AIRouterManager.ts` | MODIFY (minor) | Inject for NavBharatAI Pro chat |

---

### What each AI will know after Phase 21:

| Question | Before Phase 21 | After Phase 21 |
|----------|----------------|----------------|
| "Settings kahan hai?" | "I'm not sure..." | "Gear icon top-right → 6 tabs: General, Database, Modules, Billing, History, About" |
| "Database kaise setup karoon?" | Guess / hallucinate | Exact path + steps for the user's chosen provider |
| "Engineer AI kahan milega?" | Doesn't know | "Sidebar → Professionals → Engineer AI — ya seedha type karo 'Engineer'" |
| "App me aur kya kya hai?" | No idea | Full feature list with navigation path for each |
| "Mera purana chat kahan gaya?" | Guess | "Sidebar → History tab — sessions 30 days tak saved rehte hain" |
| "Billing kahan dekhoon?" | Doesn't know | "Settings → Billing tab → current plan + usage" |

---

### Done when:

Ask any AI in NavBharatAI — Doctor AI, Engineer AI, Pro chat — any question about
the app itself (navigation, features, settings, how-to), and it answers correctly,
confidently, and with the exact path/steps. Zero "I don't know where that is."

**The test:** 10 navigation/feature questions asked to each AI surface. All 10 correct
= Phase 21 done. The app knows itself completely — like a brain knows its own body.

---

### ⚠️ After Phase 21 completes — add this rule to CLAUDE.md:

> **`AppKnowledgeBase.ts` must stay in sync with the app (mandatory for every session).**
> Whenever any new feature, screen, button, setting, or navigation path is added to
> NavBharatAI — in the same PR, in the same commit — add the corresponding entry to
> `src/server/AppContext/AppKnowledgeBase.ts`. This is not optional housekeeping.
> A feature that exists in the app but not in `AppKnowledgeBase.ts` is invisible to
> every AI in NavBharatAI. No PR that adds a user-facing feature may be merged without
> its `AppKnowledgeBase.ts` entry.

> **Do NOT add this rule to CLAUDE.md before Phase 21 is built and merged** —
> the file does not exist yet and the rule would be meaningless until it does.
