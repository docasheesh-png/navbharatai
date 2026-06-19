# Engineer AI — Mythos-Level Build Roadmap

> ## 📁 SCOPE OF THIS FILE — read first
> This file is the **single home** for the **Engineer AI** workstream's roadmap and
> edit plan (the autonomous Grok-only + E2B agent that sees/drives/tests/fixes apps).
> All Engineer-AI planning, phases, and progress belong **here, and only here**.
>
> The **NavBharatAI Pro** app-maker engine is a **separate project** — its plan and
> progress live in **`PROGRESS.md`**. Do NOT mix the two: no NavBharatAI-Pro plan in
> this file, no Engineer-AI plan in `PROGRESS.md`.

> **Goal:** Engineer AI jo khud banaye, khud dekhe, khud test kare, khud fix kare — bina user ke haath lagaye.
> **AI Model:** Grok ONLY (xAI) — no Claude, no AiCredits proxy.
> **Sandbox:** E2B (real cloud VM, full OS isolation).
> **Updated:** 2026-06-18 (v2 — Phases 1–6 shipped, gap-closing Phases 7–12 added)

---

## CURRENT STATUS

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation (core fixes + browser bar) | ✅ DONE — merged (PR #72) |
| 2 | Agent Eyes — Screenshots (Grok vision) | ✅ DONE — merged (PR #72) |
| 3 | Agent Hands — Browser Actions (Playwright) | ✅ DONE — merged (PR #72) |
| 4 | Live Sync | 🟡 PARTIAL — runtime error capture shipped; full bidirectional sync pending → folded into **Phase 9** |
| 5 | Web Search (key-free) | ✅ DONE — merged (PR #72) |
| 6 | Memory + Workspace Persistence (E2B pause/resume) | ✅ DONE — merged (PR #72) |
| 0–6 | **Audit hardening** (true Grok-only, build-skip-install, shared browser, etc.) | 🔜 PR open (`fix/engineer-ai-audit-hardening`) |
| **6.5** | **Visible AI Cursor — live preview driving** 🖱️👀 | 🔜 NEXT (before Phase 7) |
| **7** | **Whole-project context (smart retrieval)** | 🔜 After 6.5 |
| **8** | **Checkpoints + Rollback (safety)** | 🔜 Planned |
| **9** | **Live bidirectional sync + deploy** | 🔜 Planned |
| **10** | **Database + Auth + Storage provisioning** | 🔜 Planned |
| **11** | **Git + real auto-repair + multi-framework** | 🔜 Planned |
| **12** | **Differentiators (design-to-code, tests, polish)** | 🔜 Planned |

> **What's live now (PR #72, deployed):** Engineer AI can SEE apps (Grok vision), DRIVE them
> (Playwright click/type/navigate/scroll/press/wait), CATCH runtime errors, SEARCH the web
> key-free, and PERSIST/RESUME workspaces (E2B pause/resume) — all Grok-only.
>
> **Phase 4 honesty note:** the original Phase 4 scoped *full live bidirectional sync*
> (3 s background screenshot streaming + user-click-on-preview → agent). Only the runtime
> **error-capture** half shipped. The remaining interactive-sync half is now **Phase 9** below,
> so nothing is lost.

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
