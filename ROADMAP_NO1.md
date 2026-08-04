# ROADMAP #1 — Har jagah number one banne ka plan

**Yeh file kya hai:** `CAPABILITY_AUDIT.md` (2026-08-04) me jo bhi gap mila, use **systematically**
band karne ka sequenced plan. Har item ka *kya · kyun · kaise · kitna · kab done* likha hai.

**Relationship to other docs (drift na ho isliye):**
- `CLAUDE.md` — constitution (kaise ship hota hai). Yeh roadmap use kabhi override nahi karta.
- `CAPABILITY_AUDIT.md` — **evidence** (aaj hum kahan hain, 422/505).
- `ROADMAP_NO1.md` (yeh file) — **plan of record**: kya, kis order me, kyun us order me.
- `ROADMAP_REMAINING.md` — item-level detail ledger; jahan overlap ho, **yeh file priority decide karti hai**.
- `PROGRESS.md` — append-only record (kya sach me shipped).

---

## 🎯 "Number one" ka matlab kya — measurable definition

Warna "best" ek bhaavna hai, target nahi. Teen numbers se naapenge:

| Metric | Aaj | Target | Kaise naapenge |
|---|---|---|---|
| **Capability score** | 422/505 (84%) | **≥ 480/505 (95%)** | `CAPABILITY_AUDIT.md` har phase ke baad re-run |
| **Koi category 75% se neeche nahi** | 4 categories neeche hain | **0 categories** | scorecard |
| **First-try success** (build → chalti app, bina "fix karo" bole) | measure nahi karte 🔴 | **≥ 85%** | build reports se auto-tally (Phase 0 me banega) |

> **Honest baat (rule 3):** teesra metric abhi hum naap hi nahi sakte. "Best" claim karne se pehle
> naapna zaroori hai — isliye wo Phase 0 ka pehla kaam hai.

---

## 🗺️ Phase order — aur us order ki wajah

```
Phase 0  Honesty debt + measurement        ← sabse pehle: bina naape sudhaar andha hai
   ↓
Phase 1  Zero-setup backend (DB + Auth)    ← #1 user friction, sabse bada revenue lever
   ↓
Phase 2  Apna data dekhna (Data GUI)       ← Phase 1 ke bina bekaar hai, isliye baad me
   ↓
Phase 3  Pehli nazar (UI + gallery)        ← user 10 second me judge karta hai
   ↓
Phase 4  Sabooti (Testing/QA + preview)    ← "bani" se "sach me chalti hai" tak
   ↓
Phase 5  Chaudai (deploy/GraphQL/MCP/Expo) ← breadth, ab jab core pakka hai
   ↓
Phase 6  India moat gehra karna            ← jo copy nahi ho sakta, use aur gehra karo
```

**Sequencing logic:** Phase 1 sabse zyada user-pain hatata hai, aur Phase 2/4 ki value bhi kholta
hai (DB nahi hai to data-GUI aur full-stack preview dono adhoore hain). Phase 3 sasta hai par
core theek hone se pehle karna "lipstick" hota. Phase 5 breadth hai — core pakka hone ke baad.

---

# PHASE 0 — Honesty debt + measurement
**Kyun pehle:** constitution ka rule 2 (real features only) aur rule 3 (honesty) **absolute** hain.
Jo aaj jhooth bol raha hai use pehle theek karo — warna baaki sab uske upar bana jhooth hai.
Aur jo naapa nahi ja sakta, wo sudhaara nahi ja sakta.

| # | Item | Kya karna hai | Effort | Done kab |
|---|---|---|---|---|
| 0.1 | **"Coming soon" audit** | 7 jagah "coming soon" mila (`LiveCollaboration` ×2 tabs, `SocialHub` feed, `ProfessionalsView`, `TeamCollaboration`, `GitPanel` sync, `DebugPanel` live-pause). Har ek ko decide: **(a) sach me bana do**, **(b) honest "abhi available nahi" state**, ya **(c) hata do**. *(Note: `HostingChooser` ka "coming soon" pehle se HONEST hai — wo asli alternative bhi batata hai; use rehne do.)* | 2-3 PR | Zero dead buttons; test lock kare ki koi naya "coming soon" bina honest-state ke na aaye |
| 0.2 | **First-try success metric** | Build reports se auto-tally: kitne builds bina follow-up "fix karo" ke chale. Admin dashboard pe ek number. | 1-2 PR | Dashboard pe live % dikhe |
| 0.3 | **Fix 68 — build report anonymize** | Report me abhi provider naam (`GLM failed`, `claude-…`) har user ko dikhta hai — white-label law ka ulta. User ko anonymous view, admin ko poora detail. | 1 PR | Regression test: user-view me koi vendor token nahi |
| 0.4 | **VirusTotal license** | Free API commercial product me allowed nahi (open item 2026-07-27). Paid plan ya MetaDefender. | Admin decision | Legal-clean scanning |
| 0.5 | **Scorecard automation** | `CAPABILITY_AUDIT.md` ka score har phase ke baad manually nahi — ek script jo code se count kare (tools, frameworks, providers, KB entries). | 1 PR | `npm run audit:score` chale |

**Phase 0 gate:** koi bhi UI element jhooth nahi bolta · first-try % dikh raha hai · user ko provider naam nahi dikhta.
**Score impact:** +6 (Collaboration 8→9, honesty items)

---

# PHASE 1 — Zero-setup backend: DB + Auth
**Yeh #1 lever hai.** Lovable/Replit me app banate hi DB+login tayyar. Humare me user ko Supabase
kholna, project banana, keys copy karni padti hain — **yahin non-technical user chhod jaata hai.**

### ⚠️ Pehle ek constitution constraint (yeh design badalta hai)
`CLAUDE.md`: *"User apps NavBharatAI ke Firebase project pe kabhi nahi chalengi — wo humara bill hai."*
Iska matlab: hum "apna DB de denge" wala rasta nahi le sakte. **Sahi design = user ke APNE account me,
ek click me, humare through provision karna (OAuth).** User ka data user ka, bill user ka, mehnat humari.

### Aaj kya hai (redundant kaam se bachne ke liye — safeguard #6)
- ✅ **Sandbox Postgres provisioning bana hua hai** — `postgresProvision.ts`, watchdog + preflight probe
  ke saath (`AGENTV3_SANDBOX_POSTGRES`). Development ke waqt DB chalta hai.
- ✅ **PR #2064 (abhi merge hua, 2026-08-04)** — sandbox provisioning ab *sach me* chalta hai (pehle
  recovery loop `give_up` pe jaake bolta tha "provisioning PostgreSQL…" jabki kuch karta nahi tha), aur
  user ke saved keys ab asli me app tak pahunchte hain (`.env` write ab build-start pe explicit hai,
  lazily `run_command` ke andar nahi — isliye import/Diagnose/update_preview paths pe keys gayab thi).
  **Yeh Phase 1 ki buniyaad hai — dohrana mat.**
- ✅ `generate_db_config` — connection wiring.
- ✅ Supabase / Firebase / MongoDB / Neon **connect** kar sakte hain (`userDatabaseContext.ts`).
- ❌ **Asli gap: PRODUCTION DB.** #2064 ke baad bhi — dev sandbox ka Postgres publish ke baad mar jaata
  hai. User ki LIVE app ke liye durable DB abhi bhi user ko khud banana padta hai.
- ❌ Zero-setup auth (Replit Auth jaisa).

| # | Item | Kya karna hai | Effort | Blocked on |
|---|---|---|---|---|
| 1.1 | **Neon/Supabase OAuth connector** | User "Connect Database" dabaye → apne Neon/Supabase account me login kare → hum uske account me project **auto-create** karke `DATABASE_URL` app me wire kar dein. | 3-4 PR | 🔒 **Admin:** Neon/Supabase pe OAuth app register (client id/secret + redirect URI) |
| 1.2 | **Sandbox → production migration path** | Dev me sandbox Postgres, publish pe schema+data user ke durable DB me migrate. Aaj yeh chhoot hai. | 2-3 PR | 1.1 |
| 1.3 | **Zero-setup Auth** | User ke provisioned DB ke upar ek complete auth (signup/login/session/reset) — ek click, koi key nahi. Clerk/Auth0 OAuth connector bhi isi framework pe. | 2-3 PR | 1.1 |
| 1.4 | **Secrets vault (user apps ke liye)** | Provisioned keys encrypted store + deploy pe inject. Platform-level `secrets/` hai; per-user-app nahi. | 2 PR | — |
| 1.5 | **Honest fallback** | Jab tak OAuth app register nahi, "Connect Database" **honest** state dikhaye + aaj wala manual rasta de. Fake kabhi nahi. | (1.1 ka hissa) | — |

**Phase 1 gate:** ek non-technical user prompt likhe → app bane → login kaam kare → data save ho → publish ho — **beech me ek bhi key copy-paste na kare.**
**Score impact:** +9 (Database 15→19, Auth 17→18, Storage 10→11)

---

# PHASE 2 — Apna data dekhna (Data GUI)
**Kyun ab:** Phase 1 se DB mila; ab user use dekh/badal sake. Aaj `DatabaseStudio.tsx` **demo data**
(`DEMO_COLLECTIONS` — "Arjun Sharma" jaisi nakli rows) + humara Firestore dikhata hai — user ke app ka DB nahi.

| # | Item | Kya karna hai | Effort |
|---|---|---|---|
| 2.1 | **Real DB browser** | Phase-1 wale connected DB se tables/rows padhna. Demo data sirf tab jab koi DB connected na ho — aur clearly "Demo" label ke saath (aaj bhi label hai, sahi hai). | 2-3 PR |
| 2.2 | **Row edit/insert/delete** | Firestore path ke liye pehle se hai; Postgres/Supabase ke liye banana. | 2 PR |
| 2.3 | **Schema view** | Tables, columns, relations, indexes — `schemaGraph.ts` pehle se hai, use UI me dikhana. | 1-2 PR |
| 2.4 | **SQL/query runner** | Read-only default, write ke liye confirm. | 1-2 PR |
| 2.5 | **CSV import/export** | Data seed karna aasan. | 1 PR |

**Phase 2 gate:** user apne app ka asli data builder ke andar dekh aur badal sake.
**Score impact:** +5 (Database 19→20, Storage, Observability)

---

# PHASE 3 — Pehli nazar: UI quality + gallery
**Kyun ab:** core pakka ho gaya; ab wo cheez jo user **pehle 10 second** me dekhta hai.
v0 yahin jeetta hai — humari app *chalti* hai, unki *dikhti* bhi hai.

| # | Item | Kya karna hai | Effort |
|---|---|---|---|
| 3.1 | **Design-quality prompt upgrade** | Builder prompt me concrete design system: spacing scale, type scale, colour ramp, shadow/radius tokens, layout patterns. Sabse sasta bada jeet — sirf prompt + preset. | 2-3 PR |
| 3.2 | **Curated component recipes** | Hero, pricing, dashboard shell, data table, form, empty state, auth screens — tested + sundar. LLM har baar naya ghatiya version na likhe. | 3-4 PR |
| 3.3 | **Animation/motion recipe** | ROADMAP me OPEN. Micro-interactions se app "zinda" lagti hai. | 1-2 PR |
| 3.4 | **Visual template gallery** | 16 starters hain par sirf text. Screenshot + category + "ye banao" — cold-start khatam, aur weak-tier cost ~0 (template se shuru = kam tokens). | 2-3 PR |
| 3.5 | **Community gallery + remix** | Users apni app publish karein (opt-in), doosre remix karein. Lovable/v0 dono me hai. Nav App Store ka infra pehle se hai — wahi model. | 3-4 PR |
| 3.6 | **Visual editor depth** | Spacing/padding/flex controls, component tree panel, multi-select. | 2-3 PR |

**Phase 3 gate:** ek naya user khaali box nahi dekhta; aur pehli build **dikhne me** competitor-level ho.
**Score impact:** +11 (UI 16→19, Builder UX 17→20, Visual editing 8→11)

---

# PHASE 4 — Sabooti: Testing/QA + full-stack preview
**Kyun ab:** yeh humari **sabse kamzor category (57%)** hai. Iske bina "app bani" aur "app sach me
chalti hai" ka farq sirf ummeed hai. Yeh humari honesty-moat ko sabse zyada mazboot karta hai.

| # | Item | Kya karna hai | Effort |
|---|---|---|---|
| 4.1 | **Full-stack (Express+DB) client-route serving** | Aaj "Cannot GET /customer/home" honestly report hota hai par auto-fix nahi. SPA fallback wiring generate + verify. **Known weak spot.** | 2-3 PR |
| 4.2 | **Route/API/auth/DB smoke-hitter** | Build ke baad asli routes hit karo (health, ek auth flow, ek DB read) — honest pass/fail. ROADMAP #6. | 2-3 PR |
| 4.3 | **E2E auto-run by default** | `generate_e2e` (Playwright) hai par on-request. Har successful build pe ek starter E2E chale. | 2 PR |
| 4.4 | **Real integration tests** | Aaj skeleton + TODO asserts. Asli assertions + working mocks. | 2-3 PR |
| 4.5 | **Browser self-test flow** | `browser_action` hai; poora user-flow (signup → login → CRUD) khud chala kar verify karna. | 2-3 PR |
| 4.6 | **Lighthouse + axe over live preview** | 🔒 headless Chrome infra chahiye — **admin item**. Yeh humari sabse badi *measured* kami hai. | Infra |

**Phase 4 gate:** har build ke saath honest evidence — "ye routes chale, ye E2E pass hua, ye score aaya".
**Score impact:** +14 (Testing 8→13, Preview 14→16, Performance 9→12)

---

# PHASE 5 — Chaudai: deploy, GraphQL, MCP, Expo, integrations
**Kyun ab:** core pakka hone ke baad breadth. Pehle karna = kamzor buniyaad pe chaudai.

| # | Item | Kya karna hai | Effort |
|---|---|---|---|
| 5.1 | **Fullstack hosting** | Aaj static solid, backend+DB "coming soon" (HostingChooser). Phase 1 ke baad yeh natural agla kadam. | 4-5 PR + infra |
| 5.2 | **Deploy targets: Railway, Render, AWS** | Har ek ek provider module (`DeployProviders.ts` pattern ready hai). | 2 PR each |
| 5.3 | **Scheduled jobs / cron** | Deployed app ke liye. Replit me hai. | 2 PR |
| 5.4 | **Per-version preview URL + fork** | v0 me hai; checkpoint system pehle se hai, uske upar. | 2-3 PR |
| 5.5 | **GraphQL recipe** | ROADMAP #9 OPEN. Schema + resolvers + client. | 2 PR |
| 5.6 | **MCP support** | Agent extensibility ka industry standard. Iske bina hum band system hain. | 3-4 PR |
| 5.7 | **OAuth connector framework + marketplace** | Phase 1.1 ka framework yahan generalize — Stripe/Slack/Google one-click. | 4-5 PR + admin OAuth apps |
| 5.8 | **React Native / Expo** | Asli native app (aaj webview wrapper). India mobile-first hai — yeh natural moat hai. | 5-6 PR + 🔒 E2B template |
| 5.9 | **Real-time multiplayer** | Phase 0.1 me honest state banega; asli co-edit (presence/cursors) yahan. | 4-5 PR |
| 5.10 | **DDD/Clean/MVC paradigms + service split** | ROADMAP OPEN. | 2-3 PR |

**Score impact:** +18 (Deployment 12→16, Integrations 13→16, Frameworks 21→23, Engine 22→24, Collaboration 9→11)

---

# PHASE 6 — India moat gehra karna
**Kyun last par sabse important:** yeh wo hai jo **koi copy nahi kar sakta**. Baaki sab me hum
barabari kar rahe hain; yahan hum akele hain.

| # | Item | Kya karna hai | Effort |
|---|---|---|---|
| 6.1 | **Regional languages** | Tamil, Telugu, Bangla, Marathi, Gujarati, Kannada — prompt + UI. Audit me yeh akela ❌ tha India section me. | 3-4 PR |
| 6.2 | **Aur India recipes** | Kirana/retail POS, medical store, coaching institute, dairy, mandi/agri-market, transport. | 1-2 PR each |
| 6.3 | **ONDC / DigiLocker / UPI AutoPay** | India-specific rails jo koi global builder nahi dega. | 2-3 PR each + 🔒 registration |
| 6.4 | **Bharat-scale performance** | Slow network, low-end phone, offline-first defaults generated apps me. | 2-3 PR |

**Score impact:** +5 (India 16→17, Performance, UX)

---

# 📈 Score projection

| Phase | Score | % |
|---|---|---|
| Aaj | 422/505 | 84% |
| Phase 0 | 428 | 85% |
| Phase 1 | 437 | 87% |
| Phase 2 | 442 | 88% |
| Phase 3 | 453 | 90% |
| Phase 4 | 467 | 92% |
| Phase 5 | 485 | **96%** |
| Phase 6 | 490 | **97%** |

Bacha hua ~15 points sab **🔒 infra/license-blocked** hain (WebContainer license, Rust/Ruby/PHP runtime,
Lighthouse infra, GPU/multi-region). Wo paise/decision se khulte hain, code se nahi — isliye 100%
promise karna jhooth hoga.

---

# 🙋 Aapko (admin) kya karna hai — sirf yeh 6 cheezein

Baaki sab Claude khud karega (branch → verification gate → PR → CI green → merge → agla).

| # | Kaam | Kis phase ko kholta hai | Kyun sirf aap kar sakte hain |
|---|---|---|---|
| 1 | **Neon/Supabase pe OAuth app register** (client id + secret + redirect URI) | **Phase 1 — #1 lever** | Business account + credentials |
| 2 | **VirusTotal paid plan ya MetaDefender** | Phase 0.4 | Paisa + license |
| 3 | **Headless Chrome / CI runner** Lighthouse+axe ke liye | Phase 4.6 | Infra spend |
| 4 | **E2B template rebuild** (Rust/Ruby/PHP/Expo runtimes) | Phase 5.8, framework breadth | E2B account + multi-GB image |
| 5 | **WebContainer (StackBlitz) license — haan/na** | Sandbox speed | Commercial license decision |
| 6 | **Fullstack hosting infra decision** (Cloud Run per-app? partner?) | Phase 5.1 | Architecture + cost decision |

**Sabse zaroori: #1.** Uske bina Phase 1 ka asli hissa nahi ban sakta (aur honest fallback hi ship hoga).

---

# ⚙️ Kaise chalega (constitution ke andar)

- Har item: **branch → verification gate (tsc + full vitest) → PR → CI green → merge**. Merge = auto deploy.
- CI **background** me; green ka intezaar nahi — agla kaam shuru, green pe merge karke wapas.
- Har user-facing feature ke saath **`AppKnowledgeBase.ts` entry** usi PR me (warna app ki AI use dekh nahi paati).
- Har fix **root-cause + regression test** (rule 4), aur har build report pe **forensic autopsy** (rule 5).
- **Moat ko haath nahi lagana:** multi-provider routing · billing honesty · white-label · coherence architecture.
- Phase khatam hone pe: `CAPABILITY_AUDIT.md` re-score + `PROGRESS.md` entry + signed `.aab` build (Play Store rule).

---

# 🚦 Agla kadam

**Phase 0 se shuru** — 0.1 ("coming soon" audit) aur 0.2 (first-try success metric).
Dono pure code hain, kisi infra ka intezaar nahi, aur dono constitution ke absolute rules
(real features only + honesty) ka seedha bakaya hain.

Saath hi aap **item #1 (Neon/Supabase OAuth app)** register kar dein — jab tak Phase 0 chalta hai,
Phase 1 ka rasta khul jayega.

---

*Banaya: 2026-08-04 · Base: `CAPABILITY_AUDIT.md` (code-verified) · Har phase ke baad update hoga.*
