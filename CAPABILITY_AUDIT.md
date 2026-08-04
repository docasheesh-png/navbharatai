# NavBharatAI — World-Best Capability Audit (2026-08-04)

**Kya cheez ek ASLI app builder me honi chahiye, humare paas kya hai, aur duniya ke top-5 builders me kya
hai jo humare paas nahi.** Har line LIVE CODE se verify ki gayi hai (grep + file read), yaad se nahi.

**Legend:**
`✅` = REAL + wired (code anchor diya hai) · `🟡` = PARTIAL (hai par adhoora/flag-off/weak) ·
`❌` = MISSING · `🔒` = infra/paise/license se blocked (code likh dena kaafi nahi)

**Scale (code-verified):** 1,986 TS/TSX files · 190 agent tools (`ToolCatalog.ts`) · 24 frameworks
(`FrameworkRegistry.ts`) · 203 user-facing features (`AppKnowledgeBase.ts`) · 1,009 test files / 10,571 tests.

---

## 1. Prompt samajhna & requirement capture

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Natural-language prompt se app banana | ✅ `routes/agentv3.ts` |
| 2 | Hindi / Hinglish prompt samajhna | ✅ `LanguageDetect.ts` |
| 3 | Intent classify (build vs edit vs question vs chat) | ✅ `IntentClassifier.ts` |
| 4 | Complexity classify (chhoti app vs badi app) | ✅ `ComplexityClassifier.ts` |
| 5 | Ambiguous prompt ke implicit features khud jodna | ✅ `RequirementGapAnalyzer.ts` (`AGENTV3_REQUIREMENT_AWARE=on`) |
| 6 | Clarifying sawaal — bina build roke | 🟡 `clarify` event built, `AGENTV3_ASK_USER` default OFF |
| 7 | Domain detect (hospital/restaurant/school/ecommerce…) | ✅ 8 domains in gap-analyzer |
| 8 | Requirement coverage — kya maanga tha vs kya bana | ✅ `RequirementCoverage.ts` |
| 9 | "Ye feature skip hua" honestly batana | ✅ `FeaturePresence.ts` |
| 10 | Entity extraction (User/Order/Product nikalna) | ✅ `EntityExtractor.ts` |
| 11 | Image/screenshot se requirement (vision) | ✅ `visionModels.ts` + `screenshotToPrompt.ts` |
| 12 | Voice se app banana | ✅ `VoiceToApp.tsx` |
| 13 | Multi-turn conversation memory | ✅ `ConversationStore.ts` + Firestore |
| 14 | Pichhle builds se seekhna (user-specific) | ✅ `UserLessonBrain.ts`, `BuildLessons.ts` |
| 15 | Request analyse karke model chunna | ✅ `RequestAnalyser.ts` |
| 16 | Prompt me chhupa hua non-goal pakadna | 🟡 partial (`isAffirmativelyRequested`) |
| 17 | Screenshot → layout contract → build (structured) | ❌ ROADMAP AP-8 OPEN |
| 18 | Figma file se requirement | ✅ `FigmaImporter.tsx` + `figmaProxy.ts` |
| 19 | Existing app import karke uske hisaab se samajhna | ✅ `ProjectImport.ts` + survey |
| 20 | Prompt audit trail (kya bheja gaya) | ✅ `PromptAuditStore.ts` |

**Verdict: 17/20 — yeh humari sabse strong jagah hai. Requirement-awareness competitors me bhi nahi hai.**

---

## 2. Planning & architecture

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Build se pehle plan banana | ✅ `ProjectPlan.ts` |
| 2 | Plan user ko dikhana + approve karana | ✅ Plan/Advise modes |
| 3 | File-by-file blueprint | ✅ `BuildManifest.ts` (`AGENTV3_BLUEPRINT`) |
| 4 | Shared contract (types/API ek jagah) | ✅ `ContractMap.ts` |
| 5 | Task DAG / dependency order | ✅ `PlanProgress.ts`, task deps |
| 6 | Architecture map banana | ✅ `architectureMap.ts` |
| 7 | Code graph (kaun kisko import karta hai) | ✅ `codeGraph.ts` |
| 8 | Schema graph (DB relations) | ✅ `schemaGraph.ts` |
| 9 | API graph (routes ↔ callers) | ✅ `apiGraph.ts` |
| 10 | ADR (architecture decision record) memory | ✅ `adrMemory.ts` |
| 11 | Badi app ko module-by-module banana | ✅ Software Project Mode |
| 12 | Coupling / cohesion score | ✅ `couplingAnalysis.ts` |
| 13 | Monorepo samajhna | ✅ `monorepoAnalysis.ts` |
| 14 | Frontend/backend partition decide karna | ✅ `frontendBackendPartition.ts` |
| 15 | Clean/DDD/MVC/Hexagonal named paradigms | ❌ ROADMAP OPEN |
| 16 | Microservice split generator | ❌ OPEN |
| 17 | Scaling/load estimate (numbers ke saath) | ❌ OPEN (qualitative hai) |
| 18 | Plan checkpoint — reload ke baad wapas | ✅ `CheckpointStore.ts` |
| 19 | Second opinion (doosre model se plan check) | ✅ `SecondOpinion.ts`, `Consensus.ts` |
| 20 | Reflection (build ke baad khud ka review) | ✅ `Reflection.ts` |

**Verdict: 17/20 — planning depth top-tier hai.**

---

## 3. Code generation engine (agent loop)

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Native tool-use agent loop | ✅ `AgentRunner.ts` |
| 2 | 100+ generation tools | ✅ **190 tools** |
| 3 | Multi-file batch write | ✅ `write_files_batch` |
| 4 | Surgical edit (poori file rewrite nahi) | ✅ `edit_file`, `replace_symbol` |
| 5 | Codemod (project-wide rename/move) | ✅ `codemod_rename/move_file/add_prop` |
| 6 | Sub-agents (frontend/backend parallel) | ✅ `SubAgent.ts` + `parallelBuild.ts` (flag) |
| 7 | Truncation recovery (adhoora output) | ✅ `TruncationRecovery.ts` |
| 8 | Tool-arg repair (galat args aaye to) | ✅ `toolArgRepair.ts` |
| 9 | Grep / glob / read tools | ✅ |
| 10 | Bash / terminal | ✅ `bash` + `CommandGovernance.ts` |
| 11 | Web search | ✅ `WebSearch.ts` |
| 12 | Browser action (khud app chala kar dekhna) | ✅ `browser_action`, `console_errors` |
| 13 | Screenshot lena | ✅ `screenshot` |
| 14 | Prompt caching (paisa bachana) | ✅ `systemPromptCache.ts` |
| 15 | Path write-lock (parallel me clash na ho) | ✅ `pathWriteLock.ts` |
| 16 | Hallucination detect | ✅ `HallucinationDetector.ts` |
| 17 | Build ko checkpoint/resume karna | ✅ `BuildCheckpoints.ts` + server-restart auto-resume |
| 18 | Deadline / wall-clock cap | ✅ `buildWatchdog.ts`, `AGENTV3_MAX_BUILD_SECONDS` |
| 19 | Build queue (3-role workflow) | ✅ `BuildQueue.ts` |
| 20 | Concurrency limit per user | ✅ `BuildConcurrency.ts` |
| 21 | Rate-limit pacer (429 na aaye) | ✅ `RateLimitPacer.ts` (`AGENTV3_RATE_PACER=on`) |
| 22 | Circuit breaker | ✅ `AGENTV3_CIRCUIT_BREAKER` |
| 23 | MCP server support (agent ke liye) | ❌ MISSING |
| 24 | Long autonomous run (30+ min khud kaam) | 🟡 cap-bound; Replit Agent 3 jitna lamba nahi |

**Verdict: 22/24 — engine world-class hai. MCP ek asli gap hai.**

---

## 4. Frontend frameworks & languages

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | React + Vite | ✅ |
| 2 | Next.js | ✅ |
| 3 | Remix | ✅ |
| 4 | Vue | ✅ |
| 5 | Nuxt | ✅ |
| 6 | Svelte / SvelteKit | ✅ |
| 7 | Solid | ✅ |
| 8 | Preact | ✅ |
| 9 | Lit | ✅ |
| 10 | Alpine | ✅ |
| 11 | Angular | ✅ |
| 12 | Astro | ✅ |
| 13 | Vanilla JS / static | ✅ |
| 14 | TypeScript | ✅ |
| 15 | Node/Express | ✅ |
| 16 | Hono | ✅ |
| 17 | NestJS | ✅ |
| 18 | Fastify | ✅ |
| 19 | Python FastAPI / Django / Flask | ✅ |
| 20 | Java Spring Boot | ✅ |
| 21 | Go | ✅ |
| 22 | Rust / Ruby / PHP / C++ | 🔒 E2B template me runtime hi nahi |
| 23 | React Native / Expo (asli mobile app) | ❌ **BADA GAP** — Bolt ye karta hai |
| 24 | Flutter | ❌ |
| 25 | Framework auto-detect on import | ✅ `FrameworkFoundation.ts` |

**Verdict: 21/25 — web pe bahut aage, native mobile framework pe peeche.**

---

## 5. UI quality & component system

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Tailwind CSS | ✅ scaffold me built-in |
| 2 | shadcn/ui components | ✅ tokens + preview support |
| 3 | Component library browse | ✅ `ComponentLibrary.tsx` |
| 4 | Design system generate | ✅ `DesignSystem.tsx`, `designPresets.ts` |
| 5 | Dark mode generate | ✅ `DarkModeGenerator.tsx` |
| 6 | Loading / empty / error states | ✅ `generate_ui_states` |
| 7 | Responsive (mobile-first) | ✅ prompt + `previewViewport.ts` |
| 8 | Icons | ✅ lucide via CDN |
| 9 | Animation / motion recipe | ❌ ROADMAP OPEN |
| 10 | Multi-page builder | ✅ `MultiPageBuilder.tsx` |
| 11 | Design advisor (AI se design suggestion) | ✅ `DesignAdvisor.ts` |
| 12 | CSS consistency check | ✅ `CssConsistency.ts` |
| 13 | CSS modules generate | ✅ `CssModuleGenerator.ts` |
| 14 | Accessibility check | ✅ `AccessibilityAnalysis.ts` |
| 15 | axe-core live audit | 🔒 headless Chrome infra chahiye |
| 16 | Whitelabel branding | ✅ `WhitelabelBranding.tsx` |
| 17 | Image generate (AI) | ✅ `AIImageGenerator.tsx`, `generate_image` |
| 18 | Image optimization | ✅ `generate_image_optimization` |
| 19 | **Pehli baar me "wow" dikhne wali UI** | 🟡 **v0 abhi bhi humse behtar hai** |
| 20 | Font / typography system | 🟡 basic |

**Verdict: 16/20 — functional UI strong, par "design fidelity" me v0 lead karta hai. Yeh ek asli gap hai.**

---

## 6. Builder ka apna UX (chat + control)

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Chat interface | ✅ `AgentV3Panel.tsx` |
| 2 | Live progress narration | ✅ event stream |
| 3 | Activity timeline | ✅ `activityTimeline.ts` |
| 4 | Reload/tab-switch pe build zinda rehna | ✅ `LiveEventBuffer.ts` + resume |
| 5 | Message fold/unfold | ✅ `FoldableMessage.tsx` |
| 6 | Draft save (composer) | ✅ `composerDraft.ts` |
| 7 | Stop / unsend | ✅ `unsend.ts` |
| 8 | Plan mode / Advise mode | ✅ 3-role workflow |
| 9 | Power tiers (Weak→Full Team) | ✅ 5 tiers |
| 10 | Cost estimate pehle dikhana | ✅ `PreflightEstimate.ts`, `CostEstimator.tsx` |
| 11 | Todo list live | ✅ `update_todo` |
| 12 | Build report download | ✅ `BuildDiagnostics.ts` |
| 13 | History / past builds | ✅ `HistoryView.tsx`, `agentV3History.ts` |
| 14 | Command palette | ✅ `CommandPalette.tsx` |
| 15 | Mobile-friendly builder | ✅ Capacitor app live on Play Store |
| 16 | Offline AI chat | ✅ `offline/` |
| 17 | Starter templates picker | ✅ 16 starters + saved templates |
| 18 | **Visual template gallery (screenshots ke saath)** | ❌ ROADMAP AP-10 OPEN |
| 19 | Community gallery / remix | ❌ **MISSING** — Lovable/v0 dono me hai |
| 20 | Keyboard shortcuts | ✅ |

**Verdict: 17/20 — gallery + community humari 2 khaali jagah hain.**

---

## 7. Visual editing (WYSIWYG)

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Click karke element select | ✅ `VISUAL_EDITOR_SCRIPT` in `ReactPreview.ts` |
| 2 | Clicked element → asli source line | ✅ `data-nbai-src` stamping (har element) |
| 3 | Text inline edit | ✅ double-click |
| 4 | Style edit (color/size/font) | ✅ toolbar + `applyVisualStyleEdit` |
| 5 | Resize (drag handle) | ✅ Slice D |
| 6 | Reposition (drag) | ✅ Slice E (transform-based, layout-safe) |
| 7 | Edit source file me sach me save hona | ✅ `VisualEditPatcher.ts` |
| 8 | Library/nested component pe bhi kaam karna | ✅ (React `_debugSource` ki limitation solve ki) |
| 9 | Undo visual edit | 🟡 file-level checkpoint se |
| 10 | Layout/spacing full control (padding/margin/flex) | 🟡 partial |
| 11 | Component tree panel | ❌ |
| 12 | Multi-element select | ❌ |

**Verdict: 8/12 — core visual editing REAL hai (ye bahut builders me fake hai). Depth me v0's Design Mode aage hai.**

---

## 8. Backend & API generation

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | REST CRUD generate | ✅ `generate_crud` |
| 2 | Auth endpoints | ✅ `generate_auth` |
| 3 | RBAC / ABAC | ✅ `generate_rbac`, `generate_abac` |
| 4 | Validation layer | ✅ `generate_validation` |
| 5 | Rate limiting | ✅ `generate_ratelimit` |
| 6 | CORS | ✅ `generate_cors` |
| 7 | CSRF | ✅ `generate_csrf` |
| 8 | Pagination | ✅ `generate_pagination` |
| 9 | Caching | ✅ `generate_cache` |
| 10 | Background jobs / scheduler | ✅ `generate_jobs`, `generate_scheduler` |
| 11 | Webhooks (in + out) | ✅ `generate_webhook`, `generate_webhook_sender` |
| 12 | OpenAPI spec | ✅ `generate_openapi` |
| 13 | API docs | ✅ `generate_api_docs` |
| 14 | API versioning | ✅ `generate_api_versioning` |
| 15 | Idempotency keys | ✅ `generate_idempotency` |
| 16 | Retry / circuit breaker | ✅ `generate_retry` |
| 17 | Request ID / tracing | ✅ `generate_request_id`, `generate_tracing` |
| 18 | Graceful shutdown | ✅ `generate_graceful_shutdown` |
| 19 | Realtime (websocket/SSE) | ✅ `generate_realtime` |
| 20 | GraphQL | ❌ **OPEN** (ROADMAP #9) |
| 21 | gRPC | 🚫 non-goal |
| 22 | Search (full-text) | ✅ `generate_search` |
| 23 | File upload + MIME validation | ✅ `generate_file_upload` + analyzer |
| 24 | Soft delete / audit log | ✅ `generate_soft_delete`, `generate_audit` |
| 25 | Backend presence detect (kya sach me banا) | ✅ `BackendPresence.ts` |

**Verdict: 23/25 — backend generation duniya me sabse chaudi (widest) hai. GraphQL akela bada gap.**

---

## 9. Database — schema, migration, ORM

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Schema design from prompt | ✅ `schemaGraph.ts` |
| 2 | Prisma support | ✅ + `prismaRepairHint.ts`, `prismaEnumConsumers.ts` |
| 3 | Drizzle / raw SQL | ✅ via prompt |
| 4 | Migration files generate | ✅ `generate_migration` |
| 5 | Migration RUN karna | ✅ `run_migrations` tool |
| 6 | Migration history track | ✅ `migrationHistory.ts` |
| 7 | Seed data | ✅ `generate_seed_data` |
| 8 | Type generation from schema | ✅ `schemaTypeGen.ts` |
| 9 | Query pattern analysis (N+1) | ✅ `queryPatternAnalysis.ts` |
| 10 | Query optimizer suggestions | ✅ `queryOptimizerAnalysis.ts` |
| 11 | Index suggestions | ✅ (optimizer ke andar) |
| 12 | Postgres provision helper | 🟡 `postgresProvision.ts` (config-level) |
| 13 | **One-click DB auto-create (user ko kuch na karna pade)** | 🔒 **BADA GAP** — broker chahiye |
| 14 | Supabase connect | ✅ `userDatabaseContext.ts` |
| 15 | Firebase connect | ✅ |
| 16 | MongoDB Atlas connect | ✅ |
| 17 | Neon Postgres connect | ✅ |
| 18 | **User ke app ka DATA dekhne ka GUI** | ❌ `DatabaseStudio.tsx` demo/humara Firestore only |
| 19 | Backup / restore | ✅ `generate_backup` |
| 20 | Multi-tenant patterns | 🟡 |

**Verdict: 15/20 — connect karna solid, par "user ko DB khud banana padta hai" — yahi #1 friction hai vs Lovable/Replit.**

---

## 10. Auth & user management

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Email/password auth generate | ✅ `generate_auth` |
| 2 | OAuth (Google/GitHub) | ✅ |
| 3 | OTP / phone | ✅ `generate_otp` |
| 4 | TOTP 2FA | ✅ `generate_totp` |
| 5 | SSO / SAML | ✅ `generate_sso` |
| 6 | Password policy | ✅ `generate_password` |
| 7 | Session / JWT | ✅ |
| 8 | RBAC roles | ✅ `generate_rbac` |
| 9 | Clerk connect | ✅ `userAuthContext.ts` |
| 10 | Auth0 connect | ✅ |
| 11 | Supabase Auth connect | ✅ |
| 12 | Firebase Auth connect | ✅ |
| 13 | **One-click built-in auth (zero setup)** | ❌ Replit Auth jaisa nahi hai |
| 14 | Captcha | ✅ `generate_captcha` |
| 15 | Consent / GDPR | ✅ `generate_consent` |
| 16 | Teams / orgs in generated app | ✅ `generate_teams` |
| 17 | Invite flow | ✅ |
| 18 | Audit trail | ✅ `generate_audit` |

**Verdict: 17/18 — sirf "zero-setup built-in auth" missing hai.**

---

## 11. Storage, media & files

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | File upload generate | ✅ `generate_file_upload` |
| 2 | S3-compatible storage connect | ✅ `userStorageContext.ts` |
| 3 | Cloudinary connect | ✅ |
| 4 | Firebase Storage | ✅ |
| 5 | Image optimization | ✅ `generate_image_optimization` |
| 6 | PDF generate | ✅ `generate_pdf` |
| 7 | CSV import/export | ✅ `generate_csv` |
| 8 | QR code | ✅ `generate_qr` |
| 9 | Binary assets sandbox me materialize | ✅ `WorkspaceAssetStore.ts` + sandbox tier |
| 10 | **One-click object storage provision** | ❌ Replit ke paas hai |
| 11 | Upload MIME validation (server-side) | ✅ multer fileFilter analyzer |
| 12 | Virus scan on upload (user apps) | ❌ (humare App Store me hai, generated apps me nahi) |

**Verdict: 10/12**

---

## 12. Payments & monetization (user ki app ke andar)

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Payment gateway integrate | ✅ `generate_payment` |
| 2 | **UPI (India)** | ✅ `generate_upi` — **competitors me NAHI hai** |
| 3 | Cashfree | ✅ platform + recipe |
| 4 | Stripe | ✅ recipe |
| 5 | Subscriptions | ✅ `generate_subscriptions` |
| 6 | Cart | ✅ `generate_cart` |
| 7 | Orders | ✅ `generate_orders` |
| 8 | Coupons | ✅ `generate_coupons` |
| 9 | Gift cards | ✅ `generate_gift_cards` |
| 10 | Loyalty points | ✅ `generate_loyalty` |
| 11 | Referrals | ✅ `generate_referrals` |
| 12 | Wishlist | ✅ `generate_wishlist` |
| 13 | Inventory | ✅ `generate_inventory` |
| 14 | Currency / money format | ✅ `generate_currency`, `generate_money_format` |
| 15 | **GST / Indian tax invoice** | ✅ restaurant-POS recipe me |
| 16 | Monetization wizard (user apni app se kamaye) | ✅ `MonetizationWizard.tsx` |
| 17 | Stripe one-click connect (Lovable jaisa) | 🟡 recipe hai, one-click OAuth nahi |

**Verdict: 16/17 — India-first payments humara MOAT hai. Koi competitor UPI/GST nahi deta.**

---

## 13. Third-party integrations

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Email send | ✅ `generate_email` + template |
| 2 | SMS | ✅ `generate_sms` |
| 3 | Push notification | ✅ `generate_notify`, `PWANotifications.tsx` |
| 4 | Maps / geocoding | ✅ `generate_map`, `generate_geocoding` |
| 5 | Weather | ✅ `generate_weather` |
| 6 | AI inside user's app | ✅ `generate_ai` |
| 7 | Analytics inside user's app | ✅ `generate_analytics` |
| 8 | Error tracking (Sentry-like) | ✅ `generate_error_tracking` |
| 9 | Courier / shipping | ✅ `generate_courier` |
| 10 | Translation / i18n | ✅ `generate_translation`, `LocalizationManager.tsx` |
| 11 | Newsletter | ✅ `generate_newsletter` |
| 12 | Support tickets | ✅ `generate_support_tickets` |
| 13 | CRM | ✅ `generate_crm` |
| 14 | **Generic OAuth connector framework** | ❌ ROADMAP P-INTEG OPEN |
| 15 | **Integrations marketplace UI** | 🟡 `APIMarketplace.tsx` exists, connector framework nahi |
| 16 | Secret vault for connectors | 🟡 `SecretManager.tsx` + `secrets/` (platform-level) |
| 17 | MCP / plugin registry | ❌ |

**Verdict: 13/17 — recipes bahut, par "click karke connect" framework nahi.**

---

## 14. Sandbox & runtime execution

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Real cloud VM sandbox | ✅ E2B |
| 2 | npm install chalana | ✅ |
| 3 | Real terminal | ✅ `RealTerminal.tsx`, `bash` tool |
| 4 | Multi-language runtime | ✅ Node/Python/Java+Maven/Go |
| 5 | MongoDB + Redis pre-installed | ✅ fullstack template |
| 6 | Sandbox resume (band karke wapas) | ✅ `SandboxStore.ts` (`AGENTV3_SANDBOX_RESUME`) |
| 7 | Sandbox reaper (paisa bachana) | ✅ `sandboxReaper.ts` |
| 8 | Command safety governance | ✅ `shellCommandSafety.ts`, `CommandGovernance.ts` |
| 9 | **Instant in-browser runtime (WebContainer)** | 🔒 **Bolt ka moat** — StackBlitz license chahiye |
| 10 | Warm pool (cold-start hatana) | 🔒 infra |
| 11 | Bulk file landing (fast import) | ✅ `BulkLanding.ts` — tar, count-verified |
| 12 | File guardian (files gum na ho) | ✅ `FileGuardian.ts` |
| 13 | Durable file store (sandbox mare to bhi) | ✅ `WorkspaceFileStore.ts` Firestore |

**Verdict: 11/13 — sandbox solid; WebContainer-speed hamara structural nuksaan hai.**

---

## 15. Preview

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Live server preview (asli dev server) | ✅ E2B + port detect |
| 2 | In-browser preview (bina server) | ✅ `ReactPreview.ts` Babel loader |
| 3 | **React CDN-independent (apne server se)** | ✅ **NEW 2026-08-03** — `public/vendor/react18` |
| 4 | 4-rung CDN fallback | ✅ esm.sh → esm.run → plain → unpkg |
| 5 | Preview "sach me chala" verify karna | ✅ `browseUrl` + `analyzePreviewHtml` (EARNED verdict) |
| 6 | Preview health probe | ✅ `PreviewHealth.ts` |
| 7 | **Preview marne pe khud theek hona (baar baar)** | ✅ **NEW** — continuous watchdog (150s + focus) |
| 8 | Diagnose button (no-LLM reboot) | ✅ `preview-diagnose` |
| 9 | Boot overlay (loading dikhna) | ✅ Ashok Chakra + 45s watchdog |
| 10 | Runtime error capture → auto-fix | ✅ `AGENTV3_AUTOFIX=on` |
| 11 | Viewport switch (mobile/tablet/desktop) | ✅ `previewViewport.ts` |
| 12 | Keep-alive | ✅ `previewKeepAlive.ts` |
| 13 | Tailwind Play CDN + shadcn tokens | ✅ |
| 14 | Missing file → stub (poora preview na mare) | ✅ |
| 15 | **Full-stack (Express+DB) app ka client-route serving** | 🟡 **weak spot** — "Cannot GET /route" honestly reported, auto-fix pending |
| 16 | Per-version preview URL | ❌ v0 me hai |

**Verdict: 14/16 — 2 din pehle 12/16 tha. Full-stack SPA routing agla kaam hai.**

---

## 16. Build, compile & dependencies

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | TypeScript typecheck gate | ✅ `TscGate.ts` |
| 2 | ESLint gate | ✅ `LintGate.ts` (`AGENTV3_LINT_GATE=on`) |
| 3 | Prettier gate | ✅ `PrettierGate.ts` |
| 4 | Syntax check | ✅ `SyntaxCheck.ts` |
| 5 | Dependency reconcile (import hai, package.json me nahi) | ✅ `DependencyReconciler.ts` |
| 6 | Dependency mutation guard | ✅ `DependencyMutationGuard.ts` |
| 7 | Lockfile analysis | ✅ `lockfileAnalysis.ts` |
| 8 | Package health / abandoned check | ✅ `packageHealth.ts` |
| 9 | License check | ✅ `check_licenses` |
| 10 | Vulnerability scan | ✅ `scan_vulnerabilities` |
| 11 | Toolchain pin check | ✅ `toolchainPins.ts` |
| 12 | Vite config guard | ✅ `ViteConfigGuard.ts` |
| 13 | tsconfig guard | ✅ `TsconfigGuard.ts` |
| 14 | Bundle size analysis | ✅ `BundleSize.ts` |
| 15 | Heavy import detection | ✅ `heavyImportAnalysis.ts` |
| 16 | Dead code / unused import sweep | ✅ `deadCode.ts`, `UnusedImportSweep.ts` |
| 17 | Duplicate import guard | ✅ `DuplicateImportGuard.ts` |
| 18 | Barrel file generate | ✅ `BarrelGenerator.ts` |
| 19 | Cross-language typecheck | ✅ `crossLangTypecheck.ts` |
| 20 | Incremental build cache | 🔒 E2B volume control chahiye |

**Verdict: 19/20 — yeh gate-stack competitors se kaafi gehra hai.**

---

## 17. Testing & QA

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Unit test generate | ✅ `generate_tests` |
| 2 | Test run karna | ✅ `run_tests`, `testRunner.ts` |
| 3 | Integration test generate | 🟡 skeleton + TODO asserts (ROADMAP #14) |
| 4 | E2E (Playwright) scaffold | ✅ `e2eScaffold.ts` |
| 5 | **E2E auto-run by default** | ❌ on-request only (ROADMAP Cap-2) |
| 6 | Test coverage analysis | ✅ `TestCoverageAnalysis.ts` |
| 7 | Fuzz probe | ✅ `FuzzProbe.ts` |
| 8 | Browser self-test (khud click karke dekhna) | 🟡 `browser_action` hai, full flow auto nahi |
| 9 | Runtime smoke-hit (routes/auth/DB) | ❌ ROADMAP #6 OPEN |
| 10 | Lighthouse / Web Vitals | 🔒 infra |
| 11 | Accessibility audit (axe) | 🔒 infra |
| 12 | Load test (k6/Locust) | 🔒 |
| 13 | Test generation agent | ✅ `TestGenerationAgent.ts` |
| 14 | Regression test har fix ke saath | ✅ (constitution rule) |

**Verdict: 8/14 — 🔴 YEH HUMARI SABSE KAMZOR CATEGORY HAI.** Generated app ki *asli* QA (E2E auto-run,
smoke-hit, Lighthouse) abhi bhi adhoori hai.

---

## 18. Error detection & self-healing

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Build error detect + fix loop | ✅ `AutoFix.ts` |
| 2 | Runtime error classify | ✅ `RuntimeErrorClassify.ts` |
| 3 | Console error capture | ✅ `console_errors` |
| 4 | HTTP 5xx capture | ✅ (2026-07-21, page.on('response')) |
| 5 | Post-build runtime auto-fix | ✅ `AGENTV3_AUTOFIX=on` |
| 6 | Reviewer critical auto-fix | ✅ C9 pass |
| 7 | Reviewer warning auto-fix | ✅ `AGENTV3_REVIEW_AUTOFIX_WARNINGS` |
| 8 | Integrity gate (mount-focus, dup CSS) | ✅ `AGENTV3_INTEGRITY_GATE=on` |
| 9 | Preview auto-restore + watchdog | ✅ (new) |
| 10 | Endgame repair | ✅ `EndgameRepair.ts` |
| 11 | Render rescue | ✅ `renderRescue.ts` |
| 12 | Truncation recovery | ✅ |
| 13 | Import/export reconcile | ✅ `ImportExportReconcile.ts` |
| 14 | Orphan page wiring (page bani, route nahi) | ✅ `orphanPageWiring.ts` |
| 15 | Undefined hook check | ✅ `UndefinedHookAnalysis.ts` |
| 16 | Hooks rules check | ✅ `HooksRulesAnalysis.ts` |
| 17 | Effect cleanup check | ✅ `effectCleanupAnalysis.ts` |
| 18 | Error boundary check | ✅ `ErrorBoundaryAnalysis.ts` |
| 19 | Honest verdict jab fix na ho | ✅ `backstopHonesty.ts` |
| 20 | **Heal ki zaroorat hi na pade (upstream prevention)** | 🟡 constitution rule 5 Step 5 — chal raha hai |

**Verdict: 19/20 — self-healing depth me hum shayad #1 hain. Par (rule 5) heal ka firing hi red flag hai.**

---

## 19. Code quality & review

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | AI code review | ✅ `ReviewerAgent.ts`, `AICodeReview.tsx` |
| 2 | Code smell detection | ✅ `CodeSmellAnalyzer.ts` |
| 3 | Maintainability score | ✅ `maintainabilityAnalysis.ts` |
| 4 | Architecture analysis | ✅ `ArchitectureAnalysis.ts` |
| 5 | Async pattern analysis | ✅ `AsyncPatternAnalysis.ts` |
| 6 | Authenticity (fake code pakadna) | ✅ `AuthenticityAnalysis.ts` |
| 7 | Comment language guard | ✅ `CommentLanguageAnalysis.ts` |
| 8 | Convention check | ✅ `check_conventions` |
| 9 | Tech debt tracking | ✅ `techDebt.ts` |
| 10 | Diff viewer | ✅ `DiffViewer.tsx` |
| 11 | Merge editor | ✅ `MergeEditor.tsx` |
| 12 | Second opinion / consensus | ✅ |
| 13 | Build judge (independent verdict) | ✅ `BuildJudge.ts` |
| 14 | Build confidence score | ✅ `BuildConfidence.ts` |
| 15 | Post-edit reviewer | ✅ `PostEditReviewer.ts` |
| 16 | Traceability (requirement → code) | ✅ `traceability.ts` |

**Verdict: 16/16 — poora.**

---

## 20. Security (generated apps ki)

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Security analysis | ✅ `SecurityAnalysis.ts` |
| 2 | Security headers | ✅ `SecurityHeadersAnalysis.ts` + generator |
| 3 | CSP meta analysis | ✅ `CspMetaAnalysis.ts` |
| 4 | SRI for CDN scripts | ✅ `SriAnalysis.ts` |
| 5 | Secret leak detection | ✅ `SecretLeakAnalysis.ts` |
| 6 | Env secret value analysis | ✅ `EnvSecretValueAnalysis.ts` |
| 7 | Credential log redaction | ✅ `credentialLogRedaction.ts` |
| 8 | Threat model | ✅ `threatModelAnalysis.ts`, `threat_model` |
| 9 | Vulnerability scan | ✅ `scan_vulnerabilities` |
| 10 | Package safety scan | ✅ `PackageSafetyScanner.ts` |
| 11 | Code safety scan | ✅ `CodeSafetyScanner.ts` |
| 12 | Content safety | ✅ `ContentSafetyScanner.ts` |
| 13 | Open redirect check | ✅ |
| 14 | Upload MIME validation | ✅ |
| 15 | Compliance analysis (GDPR etc.) | ✅ `ComplianceAnalysis.ts` |
| 16 | SBOM | ✅ `sbom.ts` |
| 17 | Abuse detection | ✅ `AbuseDetector.ts` |
| 18 | Untrusted content handling | ✅ `UntrustedContent.ts` |
| 19 | Platform source guard (humara code na leak ho) | ✅ `PlatformSourceGuard.ts` |
| 20 | Penetration test | ❌ |

**Verdict: 19/20 — security analysis stack duniya me sabse chaudi hai (competitors me 1-2 checks hote hain).**

---

## 21. Performance & optimization

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Bundle size analysis | ✅ `BundleSize.ts` |
| 2 | Bundle optimization generate | ✅ `generate_bundle_optimization` |
| 3 | Heavy import warning | ✅ `heavyImportAnalysis.ts` |
| 4 | Image optimization | ✅ |
| 5 | Code minify | ✅ `CodeMinifier.tsx`, `minify.ts` |
| 6 | Caching layer | ✅ `generate_cache` |
| 7 | Performance analyzer | ✅ `PerformanceAnalyzer.tsx` |
| 8 | Query optimization | ✅ `queryOptimizerAnalysis.ts` |
| 9 | Lazy loading / code split | 🟡 prompt-driven |
| 10 | **Lighthouse score (asli measurement)** | 🔒 infra blocked — **sabse badi measured kami** |
| 11 | Core Web Vitals (LCP/CLS/INP) | 🔒 |
| 12 | Runtime profiler / memory leak | 🔒 |
| 13 | CDN config | ✅ Cloudflare |
| 14 | Build speed (humara apna) | 🟡 improving (13-min stall fix, bulk landing) |

**Verdict: 9/14 — measurement infra ke bina "fast hai" sirf dawa hai, proof nahi.**

---

## 22. Version control, checkpoints & git

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Har build ka checkpoint | ✅ `BuildCheckpoints.ts`, `CheckpointStore.ts` |
| 2 | Rollback / restore | ✅ "Restore all files" |
| 3 | Version history UI | ✅ `CodeVersioning.tsx`, `HistoryView.tsx` |
| 4 | Diff dekhna | ✅ `DiffViewer.tsx` |
| 5 | Git init + commit | ✅ `GitManager.ts` |
| 6 | GitHub push | ✅ `/api/github/push` |
| 7 | GitHub clone / import | ✅ `GithubZipFetch.ts`, `GithubApiTree.ts` |
| 8 | Apne repo pe direct kaam (own-repo mode) | ✅ `GitRepoSync.ts` |
| 9 | PR banana | ✅ `GitHubPrFlow.ts` (`GITHUB_PR_MODE`) |
| 10 | GitHub App (OAuth + install) | ✅ `GitHubAppClient.ts` |
| 11 | Git panel UI | ✅ `GitPanel.tsx` |
| 12 | Merge conflict editor | ✅ `MergeEditor.tsx` |
| 13 | Branch management | 🟡 basic |
| 14 | **2-way live sync (GitHub → builder auto)** | 🟡 Lovable ka 2-way sync zyada seamless |
| 15 | Manual edit tracking | ✅ `ManualEditTracker.ts` |

**Verdict: 13/15 — git-native depth strong hai.**

---

## 23. Deployment & hosting

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | One-click publish | ✅ `/api/pro/deploy` |
| 2 | Firebase Hosting | ✅ (always available) |
| 3 | Vercel | ✅ `VercelProvider.ts` |
| 4 | Netlify | ✅ `NetlifyProvider.ts` |
| 5 | Cloudflare | ✅ `CloudflareProvider.ts` |
| 6 | GitHub Pages | ✅ |
| 7 | **AWS / Azure / Railway / Render** | ❌ ROADMAP #8 OPEN |
| 8 | Fullstack deploy (server chalta rahe) | 🟡 static solid, fullstack weak |
| 9 | Deploy risk analysis | ✅ AI Deployment Ops |
| 10 | Post-deploy liveness check | ✅ `PostDeployLiveness.ts` |
| 11 | Deploy artifacts (Dockerfile, CI) | ✅ `generate_deploy_artifacts` |
| 12 | IaC (Terraform/K8s/Helm/Ansible) | ✅ `IaCGenerator.ts` |
| 13 | CI/CD pipeline generate | ✅ `CICDPipeline.tsx`, `repair_ci_workflow` |
| 14 | Rollback deploy | 🟡 |
| 15 | Preview deployment per version | ❌ Vercel/v0 me hai |
| 16 | Scheduled jobs / cron (deployed app ke liye) | ❌ Replit me hai |
| 17 | Deployment store / history | ✅ `DeploymentStore.ts` |

**Verdict: 12/17 — deploy targets aur fullstack hosting badhane hain.**

---

## 24. Custom domains, DNS & SSL

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Custom domain connect | ✅ `domains.ts` + `NbaiDomainConnect.tsx` |
| 2 | Cloudflare custom hostname | ✅ `createCustomHostname` |
| 3 | SSL auto | ✅ Cloudflare |
| 4 | DNS instructions user ko | ✅ |
| 5 | Subdomain (free `*.navbharatai`) | ✅ `nbaiDomains.ts` |
| 6 | Domain verification status | ✅ |
| 7 | Domain kharidna (registrar integration) | ❌ |

**Verdict: 6/7**

---

## 25. Mobile apps & PWA

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | PWA generate | ✅ `PwaAnalysis.ts`, `pwa.ts` |
| 2 | Manifest + service worker | ✅ |
| 3 | Offline support | ✅ |
| 4 | Push notifications | ✅ `PWANotifications.tsx`, `push.ts` |
| 5 | Capacitor wrapper generate | ✅ `generate_mobile_export` |
| 6 | **Signed .aab (Android) via CI** | ✅ `mobileShip.ts` — user ke repo me asli CI |
| 7 | **Signed .ipa (iOS) via CI** | ✅ same |
| 8 | APK builder UI | ✅ `APKBuilder.tsx`, `StoreBuildPanel.tsx` |
| 9 | App Store publisher UI | ✅ `AppStorePublisher.tsx` |
| 10 | **Nav App Store (humara apna store)** | ✅ `navStore.ts` — **UNIQUE, kisi competitor me nahi** |
| 11 | Malware scan before publish | ✅ VirusTotal (⚠️ license open item) |
| 12 | React Native / Expo build | ❌ **GAP** |
| 13 | Native device testing | 🟡 `NATIVE_DEVICE_TESTING.md` |
| 14 | Desktop export (.exe/.dmg) | 🟡 generator hai, signing 🔒 |

**Verdict: 12/14 — mobile shipping me hum Lovable/v0/Bolt sabse aage hain.**

---

## 26. Observability, logs & analytics

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Build diagnostics report | ✅ `BuildDiagnostics.ts` |
| 2 | Admin build report store | ✅ `AdminBuildReportStore.ts` |
| 3 | Workspace logs | ✅ `WorkspaceLogs.tsx` |
| 4 | Build analytics (pipeline health) | ✅ `/api/analytics/builds` |
| 5 | Reliability MTTD/MTTR | ✅ `/api/analytics/reliability` |
| 6 | Build optimizer suggestions | ✅ `/api/analytics/build-optimizer` |
| 7 | Cost telemetry per provider | ✅ `AgentV3CostTelemetry.ts`, `ProviderUsageLedger.ts` |
| 8 | Cost alerts | ✅ `costAlert.ts` |
| 9 | Decision trace | ✅ `DecisionTraceManager.ts` |
| 10 | Session timeline | ✅ `SessionTimeline.ts` |
| 11 | Observability generate (user app me) | ✅ `generate_observability`, `ObservabilityInjector.ts` |
| 12 | App health monitor | ✅ `AppHealthMonitor.tsx` |
| 13 | **User ki PUBLISHED app ka analytics dashboard** | ❌ **GAP** — Lovable/Replit me hai |
| 14 | Cloud Error Reporting | ✅ (Cloud Run stdout) |
| 15 | SLO alerting | 🔒 |

**Verdict: 13/15 — internal observability excellent, user-facing app analytics missing.**

---

## 27. Collaboration & teams

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Team invite | ✅ `team.ts`, `TeamCollaboration.tsx` |
| 2 | Roles / permissions | ✅ `normalizeInviteRole`, `canManageTeam` |
| 3 | Team library (shared prompts/components) | ✅ `TeamLibraryPanel.tsx` |
| 4 | @mentions + inbox | ✅ `MentionInbox.tsx` |
| 5 | Share for review (link) | ✅ `ShareForReview.tsx`, `share.ts` |
| 6 | Feedback on shared link | ✅ |
| 7 | **Real-time multiplayer editing (cursors/presence)** | 🟡 `LiveCollaboration.tsx` — Pro v5 in-room "coming soon" |
| 8 | Live chat room | ✅ (chat tab real) |
| 9 | Comments on code | 🟡 |
| 10 | Approvals workflow | ✅ `Approvals.ts` |
| 11 | Workspace per team | 🟡 |

**Verdict: 8/11 — asli real-time co-editing (Replit multiplayer jaisa) sabse bada gap.**

---

## 28. Portability & no lock-in

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | ZIP export (poora code) | ✅ `zip.ts`, `export.ts` |
| 2 | ZIP import | ✅ `zipUpload.ts` |
| 3 | GitHub export | ✅ |
| 4 | GitHub import | ✅ |
| 5 | Import accounting (kaunsi file kahan gayi) | ✅ `importAccountingLine` |
| 6 | Large binary handling | ✅ 2-tier assets (durable + sandbox) |
| 7 | Lockfile preservation | ✅ sandbox-only tier |
| 8 | Import landing telemetry | ✅ `IMPORT_LANDING` (new) |
| 9 | Data loss detection | ✅ `recordDataLoss` |
| 10 | Multi-cloud deploy (vendor lock nahi) | ✅ `MultiCloudDeploy.tsx` |
| 11 | Own-repo mode (humara server bypass) | ✅ |

**Verdict: 11/11 — "no lock-in" promise sach me poora hai.**

---

## 29. India-first moat (jo kisi competitor me NAHI hai)

| # | Capability | Status |
|---|---|---|
| 1 | Hindi/Hinglish prompt + UI | ✅ |
| 2 | UPI payments generator | ✅ `generate_upi` |
| 3 | Cashfree integration | ✅ |
| 4 | GST invoice / tax | ✅ restaurant-POS |
| 5 | Indian validators (PAN/Aadhaar/IFSC/PIN) | ✅ `generate_indian_validators` |
| 6 | Hospital ERP recipe (India) | ✅ `generate_hospital_erp` |
| 7 | School ERP recipe | ✅ `generate_school_erp` |
| 8 | Restaurant POS + KOT | ✅ `generate_restaurant_pos` |
| 9 | Courier/logistics recipe | ✅ `generate_courier` |
| 10 | Kisan / Govt-schemes AI | ✅ Professionals |
| 11 | 40+ Professional AIs (Doctor/CA/Lawyer/…) | ✅ 203 KB entries |
| 12 | Nav App Store (India distribution) | ✅ |
| 13 | Play Store live app | ✅ `com.navbharat.ai` |
| 14 | iOS TestFlight pipeline | ✅ |
| 15 | Mobile-first builder (phone se app banana) | ✅ |
| 16 | Rupee billing + wallet | ✅ |
| 17 | Regional languages (Tamil/Telugu/Bangla…) | ❌ **agla bada moat** |

**Verdict: 16/17 — YEH HUMARA ASLI HATHIYAAR HAI. Koi bhi top-5 builder India ke liye nahi bana.**

---

## 30. AI routing, cost & billing honesty

| # | Kya hona chahiye | Status |
|---|---|---|
| 1 | Multi-provider (vendor lock nahi) | ✅ Claude/GLM/Kimi/Gemini/Grok/Vertex |
| 2 | Cheap-first routing (free tier) | ✅ `FreeTierBuildRouting.ts` |
| 3 | Flagship-first (paid) | ✅ |
| 4 | 5 power tiers user chune | ✅ `powerLevel.ts` |
| 5 | Weak tier me Sonnet/Opus kabhi na chale | ✅ `noClaudeZone.ts` — 3-layer enforcement |
| 6 | Key pool rotation (429) | ✅ `parseKeyPool` |
| 7 | Rate pacer + circuit breaker | ✅ |
| 8 | Provider fallback ladder | ✅ |
| 9 | REAL cost billing (markup honest) | ✅ `providerRates.ts` + tiered markup |
| 10 | Failed build charge NA karna | ✅ "working app or free" |
| 11 | **White-label (user ko provider ka naam na dikhe)** | ✅ `userCostBreakdown()` test-locked |
| 12 | Wallet + affordability gate | ✅ `WalletBalance.ts`, `Affordability.ts` |
| 13 | Cost estimate pehle | ✅ `PreflightEstimate.ts` |
| 14 | Daily spend quota gauge | ❌ ROADMAP #4 OPEN |
| 15 | Escalation orchestrator | 🟡 built, default OFF (measure pending) |
| 16 | Build report me provider anonymize | 🟡 **OPEN (Fix 68)** — report me abhi provider naam dikhta hai |

**Verdict: 14/16 — routing + billing honesty humara sabse defensible moat hai.**

---

# 📊 SCORECARD

| # | Topic | Score |
|---|---|---|
| 1 | Requirement capture | 17/20 |
| 2 | Planning & architecture | 17/20 |
| 3 | Code-gen engine | 22/24 |
| 4 | Frameworks | 21/25 |
| 5 | UI quality | 16/20 |
| 6 | Builder UX | 17/20 |
| 7 | Visual editing | 8/12 |
| 8 | Backend generation | 23/25 |
| 9 | Database | 15/20 |
| 10 | Auth | 17/18 |
| 11 | Storage | 10/12 |
| 12 | Payments (India) | 16/17 |
| 13 | Integrations | 13/17 |
| 14 | Sandbox | 11/13 |
| 15 | Preview | 14/16 |
| 16 | Build & deps | 19/20 |
| 17 | **Testing & QA** | **8/14 🔴** |
| 18 | Self-healing | 19/20 |
| 19 | Code quality | 16/16 |
| 20 | Security | 19/20 |
| 21 | **Performance** | **9/14 🔴** |
| 22 | Version control | 13/15 |
| 23 | Deployment | 12/17 🟠 |
| 24 | Domains | 6/7 |
| 25 | Mobile | 12/14 |
| 26 | Observability | 13/15 |
| 27 | **Collaboration** | **8/11 🔴** |
| 28 | Portability | 11/11 ✅ |
| 29 | **India moat** | **16/17 🏆** |
| 30 | AI routing & billing | 14/16 |
| | **TOTAL** | **≈ 422/505 (84%)** |

**Sabse kamzor 4:** Testing/QA (57%) · Visual-editing depth (67%) · Performance measurement (64%) ·
Collaboration (73%) · Deployment breadth (71%).

---

# 🌍 PART 2 — Duniya ke TOP-5 app builders me kya hai jo humare paas NAHI

> **Honesty note (rule 3):** Part 1 ka har point humare LIVE CODE se verify hua hai. Yeh Part 2
> competitors ke PUBLIC products ki jaankari par based hai (main unka code nahi dekh sakta) — isliye
> ise "verified fact" nahi, "best available understanding" maano. Jo humara side hai wo code-anchored hai.

## 1. Lovable

| Unke paas | Humara status | Kitna bada gap |
|---|---|---|
| **One-click Supabase**: DB + auth + storage + edge functions, user ko kuch setup nahi karna | 🟡 connect kar sakte hain, provision nahi | 🔴 **#1 GAP** |
| **App ka data table me dekhna/edit karna** (builder ke andar) | ❌ `DatabaseStudio` demo/humara Firestore | 🔴 BADA |
| 2-way GitHub sync (dono taraf auto) | 🟡 push/clone hai, live 2-way nahi | 🟠 |
| Stripe one-click connect | 🟡 recipe hai | 🟠 |
| Community gallery + remix (dusron ki app copy karke shuru) | ❌ | 🔴 BADA — cold-start kills |
| Per-project knowledge base | 🟡 `WorkspaceMemory` hai, user-editable nahi | 🟠 |
| Published app ka analytics | ❌ | 🟠 |
| Security scan before publish | ✅ **hum aage hain** (19/20) | — |
| Visual edit | ✅ **hum barabar/aage** | — |
| Hindi / UPI / GST | ❌ unke paas nahi | ✅ **hum jeette hain** |

## 2. Bolt.new (StackBlitz)

| Unke paas | Humara status | Kitna bada gap |
|---|---|---|
| **WebContainer** — browser me hi poora Node, 0-second start, npm install browser me | 🔒 license-blocked (E2B cold-start humara nuksaan) | 🔴 **structural** |
| **Expo / React Native se asli mobile app** | ❌ | 🔴 BADA |
| Instant Netlify deploy | ✅ hum Netlify + 4 aur | — |
| Discuss mode (bina code likhe baat) | ✅ Advise mode | — |
| Token-efficient diff editing | ✅ surgical edit + codemods | — |
| File locking (AI kuch files na chhue) | ❌ | 🟠 |
| Figma import | ✅ hai | — |
| 24 frameworks + Java/Go/Python | ✅ **hum aage** | — |
| Self-healing depth | ✅ **hum bahut aage** | — |

## 3. v0 (Vercel)

| Unke paas | Humara status | Kitna bada gap |
|---|---|---|
| **UI quality / design fidelity — pehli try me hi sundar** | 🟡 functional par utna polished nahi | 🔴 **#2 GAP** |
| Design Mode — inline spacing/typography/layout fine-tune | 🟡 humara visual editor text/color/size/move karta hai | 🟠 |
| Har version ka apna preview URL + fork | ❌ | 🟠 |
| Component ko npm registry pe publish | ❌ | 🟢 chhota |
| Integrations marketplace (Supabase/Neon/Upstash/Blob one-click) | ❌ framework hi nahi | 🔴 BADA |
| Image → code accuracy (screenshot se hubahu) | 🟡 vision hai, layout-contract step nahi | 🟠 |
| Backend generation ki chaudai | ✅ **hum bahut aage** (23/25) | — |
| Mobile app shipping | ✅ **hum aage** | — |

## 4. Replit (Agent 3)

| Unke paas | Humara status | Kitna bada gap |
|---|---|---|
| **Built-in Postgres — app banate hi DB ready** | ❌ user ko khud banana padta hai | 🔴 **#1 GAP (same as Lovable)** |
| **Replit Auth — ek click me login system** | ❌ | 🔴 BADA |
| Object storage built-in | ❌ | 🟠 |
| **Real-time multiplayer (cursors, live co-edit)** | 🟡 "coming soon" | 🔴 BADA |
| Deployments: autoscale / reserved VM / static / **scheduled jobs** | 🟡 static solid, fullstack+cron nahi | 🟠 |
| Agent 3 — 200 min tak khud kaam, khud browser me test | 🟡 hum cap-bound (`MAX_BUILD_SECONDS`) | 🟠 |
| Secrets manager (app ke liye) | 🟡 platform-level hai | 🟠 |
| Bounties / community | ❌ | 🟢 |
| Checkpoints / rollback | ✅ barabar | — |
| Cost transparency + honest billing | ✅ **hum aage** (real-cost + failed-build free) | — |
| Nav App Store jaisa distribution | ✅ **sirf humare paas** | — |

## 5. Cursor

> Cursor developer ka IDE hai, "prompt se app" builder nahi — par engine quality me benchmark hai.

| Unke paas | Humara status | Kitna bada gap |
|---|---|---|
| **Codebase embeddings + semantic search** | 🟡 BM25 + structural (`Bm25.ts`) — embeddings 🔒 key-blocked | 🟠 |
| **MCP support** (koi bhi tool jod do) | ❌ | 🔴 BADA (agent extensibility) |
| Rules files (`.cursorrules`) — user apne rules de | ❌ | 🟠 |
| Background agents | 🟡 build queue hai | 🟢 |
| Model choice user ko | ✅ 5 power tiers | — |
| Local repo pe kaam | 🚫 non-goal (hosted builder) | — |
| 190 domain generation tools | ✅ **hum bahut aage** | — |

---

# 🎯 NICHOD — 8 cheezein jo humein WORLD-BEST banayengi (priority order)

Yeh mera apna judgement hai (rule 5 step 6 — proactive layer), sirf list nahi:

### 🥇 1. One-click DATABASE + AUTH (zero setup) — **sabse bada single lever**
Aaj user ko Supabase/Neon khud banana padta hai, keys copy karni padti hain. Lovable aur Replit dono
me app banate hi DB tayyar hota hai. **Yeh #1 reason hai jisse non-technical user hum chhod ke unke
paas jaata hai.** Infra chahiye (provisioning broker + OAuth), par iska ROI sabse zyada hai.

### 🥈 2. App ka DATA dekhne/edit karne ka GUI
DB ban gaya par user apna data dekh nahi sakta — yeh adhoora feel hota hai. `DatabaseStudio` ka
shell maujood hai; use user ke apne DB se jodna hai (demo data se nahi).

### 🥉 3. UI/design fidelity — "pehli try me sundar"
v0 yahan jeetta hai. Humari app *chalti* hai; unki *dikhti* bhi hai. User pehle 10 second me
judge karta hai. Design-preset + curated component recipes + better design prompt = sabse
sasta bada jeet.

### 4. Template gallery + community remix
Cold-start problem: khaali chat box darata hai. 16 starters hain par visual gallery (screenshot ke
saath) nahi. Yeh weak-tier ki cost bhi ~0 kar deta hai (template se shuru = kam tokens).

### 5. Testing/QA ko 57% se upar lana
E2E auto-run + route smoke-hitter. "App bani" aur "app sach me kaam karti hai" ke beech ka
gap yahi hai. Yeh humari honesty-moat ko aur mazboot karta hai.

### 6. Real-time collaboration (asli multiplayer)
`LiveCollaboration.tsx` me "coming soon" likha hai — rule 2 ke hisaab se ise ya to poora karo ya
honest "not available" dikhao. Team feature bina live co-edit ke adhoora hai.

### 7. React Native / Expo se asli mobile app
Hum .aab/.ipa ship karte hain (webview wrapper) — par asli native app nahi banate. Bolt banata hai.
India me mobile-first market hai, yeh humara natural moat hona chahiye.

### 8. MCP support
Agent extensibility ka industry standard ban chuka hai. Iske bina hum band system hain.

---

## 🛡️ Jo humein KOI nahi de sakta (moat — inhe kabhi mat todna)

1. **India-first**: Hindi + UPI + GST + PAN/Aadhaar validators + hospital/school/restaurant ERP recipes
2. **Honest billing**: real provider cost + failed build free + white-label — koi competitor itna transparent nahi
3. **Self-healing depth**: 19/20 — 5 heal gates, integrity gate, runtime auto-fix
4. **Security analysis**: 19/20 — competitors me 1-2 check hote hain, humare paas 19
5. **Backend breadth**: 190 tools, 23/25 backend capabilities
6. **Nav App Store**: apna distribution channel — kisi builder ke paas nahi
7. **Mobile shipping**: asli signed .aab/.ipa CI — Lovable/v0/Bolt me nahi
8. **40+ Professional AIs**: builder + Doctor/CA/Lawyer/Kisan AI ek hi app me
9. **No lock-in**: 11/11 — poora code ZIP/GitHub me, own-repo mode
10. **Multi-provider routing**: ek vendor ke bharose nahi — koi bhi provider gire, app chalti rahe

---

*Audit method: `ToolCatalog.ts`, `FrameworkRegistry.ts`, `AppKnowledgeBase.ts`, `DeployProviders.ts`,
`userDatabaseContext.ts`, `userAuthContext.ts`, `userStorageContext.ts`, `ROADMAP_REMAINING.md`
(code-verified 2026-07-20) + `src/components/ide/` (73 panels) + `src/server/AgentV3/` (~400 modules)
directly padhe gaye. Competitor section public product knowledge par based hai, code-verified nahi.*
