# Engineer AI — Mythos-Level Build Roadmap

> **Goal:** Engineer AI jo khud banaye, khud dekhe, khud test kare, khud fix kare — bina user ke haath lagaye.
> **AI Model:** Grok ONLY (xAI) — no Claude, no AiCredits proxy.
> **Sandbox:** E2B (real cloud VM, full OS isolation).
> **Updated:** 2026-06-18

---

## CURRENT STATUS

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation (core fixes + browser bar) | ⏳ PRs merged pending |
| 2 | Agent Eyes — Screenshots | 🔜 Next |
| 3 | Agent Hands — Browser Actions | 🔜 After Phase 2 |
| 4 | User + Agent Ek Browser | 🔜 After Phase 3 |
| 5 | Web Search | 🔜 Parallel |
| 6 | Memory + Workspace Persistence | 🔜 Last |

---

## PHASE 1 — Foundation ✅ (code done, merge pending)

> PRs #65 + #66 — user karo merge. Fir E2B_API_KEY + GROK_API_KEY Cloud Run me daalo.

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

## Order of Execution (Main Order)

```
Phase 1 ← USER: merge PRs + add keys  [TODAY]
Phase 2 ← Main karunga               [Next session]
Phase 3 ← Phase 2 ke turant baad     [~same session]
Phase 5 ← Phase 3 ke baad (quick)    [~same session]
Phase 4 ← Full sync (biggest UX win) [Next major session]
Phase 6 ← Last                       [Final session]
```

**Phase 2 + 3 saath me ek hi session me kar sakta hoon** — woh tightly coupled hain (screenshot → action → screenshot).

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
