/**
 * App Self-Awareness: NavBharatAI Brain — complete feature map.
 *
 * SOURCE OF TRUTH: every user-facing feature, screen, button, and AI capability
 * lives here. Every AI surface (Engineer AI, Doctor AI, Pro Chat, Free Chat) reads
 * this via AppContextInjector to answer "where is X?", "how do I Y?", and
 * "what can you do?" — with exact navigation paths, not guesses.
 *
 * MANDATORY RULE: whenever a new user-facing feature, screen, setting, or navigation
 * path ships, add its entry here in the same PR. A feature not listed here is
 * INVISIBLE to every AI in NavBharatAI.
 */

export interface AppFeature {
  /** Stable identifier (snake_case). */
  id: string;
  /** Human-readable feature name. */
  name: string;
  /** How to navigate there, e.g. "Sidebar → Settings → Database". */
  path: string;
  /** What it does — be specific, list sub-capabilities. */
  description: string;
  /** Step-by-step usage for an end user. */
  howToUse: string;
  /** Related feature ids. */
  relatedFeatures: string[];
  /** Which AI owns this surface (e.g. "engineer_ai", "sda_chat", "nbi_chat"). */
  aiSurface?: string;
  /** Lowercase keywords that trigger this entry when a user asks about it. */
  keywords: string[];
}

export const APP_KNOWLEDGE_BASE: AppFeature[] = [
  // ─── NAVBHARATAI PRO v3.0 (Vargen 3.0) ───────────────────────────────────
  {
    id: 'agentv3_builder',
    name: 'NavBharatAI Pro v3.0 (beta)',
    path: 'Sidebar → "App Builder v3.0"  OR  the floating "v3.0" button (bottom-right when enabled for your account).',
    description: `Claude-Code-class agentic app builder (Vargen 3.0). Capabilities:
• NATIVE TOOL-USE engine on Claude (Sonnet by default). The "Power" selector in the build-options menu (the gear/settings popover above the message box) picks the build engine's reasoning power: Off = normal (fast & lowest cost, runs Sonnet); 5× = Opus minimum power; 10× = Opus medium power; 20× = Opus max ("ultracode", maximum reasoning for the hardest builds). Higher levels use Claude Opus at a higher reasoning effort and cost proportionally more (the ×N is the billing multiplier). Leave it Off for everyday builds; raise it only for genuinely complex/stuck work.
• MULTI-AGENT "AI team": an Architect plans and delegates to a six-layer roster of specialist agents — planning (Requirements, Planner, Product), development (Frontend, Backend, Fullstack, Database, Mobile, API, DevOps, Infrastructure, Designer), quality (QA, Tester, Security, Performance, Accessibility, Reviewer), repair (Debugger, Refactor, Optimizer), knowledge (Docs, Researcher) and operations (Deploy, Monitor, Recovery) — routed by capability and working in parallel where safe.
• MULTI-PROVIDER resilience: native Claude for building, with automatic fallback to Vertex / Gemini / Grok for chat so it always replies.
• IDE ↔ v3.0 FILE SYNC (live, two-way): the Code Studio IDE and the v3.0 builder are two organs of ONE workspace per session. A ZIP you upload is mirrored into v3.0, files you delete in the IDE are removed from v3.0, AND every manual edit you make in the editor is auto-saved (debounced) to v3.0's DURABLE store — so your hand edits survive sandbox recycling and the build's file-guardian never reverts them. On your NEXT build, v3.0 ACKNOWLEDGES what you changed ("I noticed you manually edited N files in the IDE since my last build") and reads + builds ON TOP of your edits instead of overwriting them — like Google AI Studio, where a change in one place is instantly known everywhere.
• PROJECT MEMORY & artifact intelligence: as it builds it indexes your files into a live project graph (symbols, components, routes, imports, dependencies) and remembers errors and fixes; agents can "recall" this to find where things are and what failed before. After each build it also writes a short REFLECTION — the lessons learned from that build's errors and fixes — back into project memory; and at the START of each new build it RECALLS the relevant past lessons and applies them, closing the learning loop so the project genuinely improves across iterations. Recalled lessons are also EVOLVED before reuse (Layer 59 "Knowledge Evolution"): near-duplicates are merged, contradictions are resolved so newer advice overrides stale advice it disagrees with, and fresher lessons are ranked higher — keeping the project's working knowledge accurate and current. Recall ranks like a real search engine (BM25): a rare, specific term outweighs a common one, and lessons are OUTCOME-WEIGHTED so a PROVEN fix (it actually worked) outranks a one-off error and a repeatedly-confirmed lesson ranks higher — the agent is reminded of the most relevant AND most trustworthy lessons first. And these lessons are no longer trapped in one project: your highest-confidence lessons are remembered ACROSS ALL your projects (a cross-project "brain"), so what the AI learned building app A helps it build app B.
• PERSONALIZATION (Layer — Preference Learning): v3.0 quietly learns YOUR preferred stack from your past SUCCESSFUL builds — the framework, database, styling and language you keep choosing, and the kinds of apps you build most — inferred from what actually shipped (never from a form you fill in). On your next build, when you don't specify a stack, it leans toward those learned defaults so it builds the way you like by default; you can always override them just by asking for something different.
• UNDERSTANDS NAMED TECH (Layer — NLU entity/slot extraction): when you name a specific service in your request — "build a shop with Razorpay and Supabase", "Next.js app with Clerk auth, deploy to Vercel" — v3.0 recognizes those exact technologies (payment gateways, databases, auth, hosting, email/SMS, AI, storage, maps, analytics, search, frameworks, UI kits) and treats them as hard requirements, wiring the real SDK/integration instead of silently substituting its own defaults. If a named service needs a key you haven't set, it wires the real integration and tells you honestly which key to add rather than faking it.
• ONE-CLICK AI FIX (P-UX.3): when the in-browser preview fails to build, the Preview tab shows a "Fix with AI" button — tap it and the exact build error is prepopulated into the chat box, so you just press Send and the agent diagnoses and repairs it. It prepopulates (rather than auto-sending) so you always review before a fix runs.
• SELF-EVALUATION: agents can "evaluate" the project for real structural defects (unresolved imports that would break the build, import cycles, front-end→back-end layering violations, forEach(async …) loops that silently do not await), security issues (hardcoded secrets/keys, hardcoded JWT signing secrets, credentials embedded in DB/queue connection strings, eval, new Function() dynamic code, command injection via a shell exec built from dynamic input, dangerouslySetInnerHTML, raw innerHTML/outerHTML/insertAdjacentHTML XSS sinks, insecure http) AND an authenticity check that detects fake/incomplete/placeholder code (TODO/FIXME/HACK markers, "not implemented" throws, stub/dummy/mock data, lorem ipsum, empty console.log-only handlers, empty catch blocks that silently swallow errors) — enforcing the "real features only, no fakes" rule — AND a dependency-consistency check (packages imported in code but missing from package.json, which would break the build at install/runtime; declared-but-unused dependencies; plus floating/unpinned versions like "*"/"latest" that make builds non-reproducible) AND an environment-variable completeness check (variables read in code via process.env / import.meta.env but missing from .env.example, which would break the app at runtime for the user, who is never told to set them) AND an accessibility check (Layer 78 "Sabke-Liye"/Inclusion: images with no alt text, form controls with no accessible name, click handlers on non-interactive elements that keyboard and screen-reader users cannot reach, positive tabindex that breaks focus order, and pages with no document language) — so the apps it builds are usable by everyone — AND a trust/safety/compliance check (Layer 77 "Bharosa", DPDP/GDPR-oriented: personal data written to logs, sensitive values kept in browser storage, cookies set without SameSite, personal data sent over plain http, third-party trackers running with no cookie-consent surface, and collecting personal data with no privacy policy) that ends with an honest "launch-safe" certificate (CERTIFIED / CONDITIONAL / NOT CERTIFIED) — so the apps it builds are safe to launch publicly — AND a calibrated "build confidence" score (Layer 74 "Sahyog": 0–100% with a High/Medium/Low band and a plain-language "here's why", synthesized from all the checks above) so the assistant tells you honestly how confident it is rather than over-promising — and fix them before claiming the app is done.
• SECOND OPINION (Layer 84 — Multi-Model Ensemble): the agent team can get an independent cross-model "second opinion" — a DIFFERENT AI model (the non-Claude Vertex/Gemini/Grok router) critically reviews risky or final work for bugs, security issues and wrong assumptions — going beyond a single model's judgement. The Architect can also convene a multi-perspective CONSENSUS panel (Layer 49 — Collective Intelligence): the same hard decision is put to independent correctness, security and UX reviewers and their viewpoints are synthesized into one verdict — multiple expert lenses, not one.
• PLAN REVIEW (Layer 54 — Strategic Intelligence): in Plan mode, before you approve the proposed build plan, v3.0 reviews it for strategic gaps and shows them next to the plan — no testing/verification step, no setup/scaffolding before features, a deploy was requested but never planned, an under-scoped one-line plan, or vague unactionable steps — so you can strengthen the plan up front instead of discovering the gap after the build.
• TEST COVERAGE check (Phase 6 — Testing & Autonomous Loops): when v3.0 evaluates a build, it also reports which modules and components have NO test, so the build agent writes the missing tests and verifies the app actually works instead of assuming it — the build is earned, not guessed.
• REQUIREMENT COVERAGE check (Phase 10 — Product Understanding): v3.0 compares what you ASKED for against what was actually built — if you requested a feature (e.g. login, dashboard, cart, admin) and no matching page/component exists, it flags it so the agent builds it instead of silently skipping it. Nothing you asked for gets quietly dropped.
• RUNNABILITY check (Phase 6 — Execution Quality): when v3.0 evaluates a build, it checks the app can actually START and BUILD — a run script (dev/start), a build script for deployment, and an index.html entry for Vite/CRA apps — so it catches "it compiles but won't run" before saying the app is done.
• SEO/METADATA check (Section I #19): v3.0 checks the app's HTML entry for the discoverability essentials — a page title, viewport (mobile), meta description, and html lang — and flags any that are missing, so your app is search-friendly and shareable, not invisible.
• PROJECT HYGIENE check (Section I #22 — Developer Experience): v3.0 checks your project has the basics — a .gitignore (so node_modules/.env/secrets don't get committed) AND that an existing .gitignore actually ignores node_modules (or it gets committed anyway — huge, platform-specific, breaks installs), a tsconfig.json for TypeScript, and a lockfile for reproducible installs — and flags what's missing.
• ERROR BOUNDARY check (Section I #5 — Frontend resilience): for a real React app, v3.0 checks there's an error boundary so one component crash degrades gracefully instead of white-screening the whole app — and flags it if missing (the app-must-never-break rule, applied to the apps you build).
• SECURITY CONFIG check (Section I #4 — Security): v3.0 scans for insecure configuration — disabled TLS certificate verification (man-in-the-middle risk), wildcard "*" CORS (any site can call your API), and Math.random() used to make tokens/secrets (predictable, guessable) — and flags them so your app isn't shipped with an open security hole.
• SECRET LEAK check (Section I #4 — Security): v3.0 flags a real .env file (with live API keys / passwords) that isn't covered by .gitignore — the #1 way secrets get committed to git forever — so you fix it before it leaks.
• HARDCODED URL check (Section I #11 — Deployment readiness): v3.0 flags hardcoded http://localhost URLs baked into code (the classic "works locally, breaks when deployed" bug) so they're read from an env var instead — it does NOT flag the correct env-var-fallback pattern.
• HARDCODED PORT check (Section I #11 — Deployment readiness): v3.0 flags a server bound to a hardcoded port (e.g. app.listen(3000)) instead of process.env.PORT — managed hosts (Cloud Run, Heroku, Render) inject the port and route traffic only to it, so a hardcoded port means the app starts but receives no traffic when deployed. It does NOT flag the correct process.env.PORT || 3000 fallback.
• AUTO README (Phase 4 — Docs engine): v3.0 can generate an accurate README.md for your app from the real project — detected tech stack, how to install and run, project structure (components/routes/files) and the available scripts — so every app ships with real, honest documentation (nothing invented).
• AUTO ARCHITECTURE DOCS (Docs engine): for a larger app, v3.0 can also generate an ARCHITECTURE.md from the real import graph — the module dependency map (which files import which), the component + route inventory, and honest structural notes (import cycles, unresolved imports, orphan components) — so the app's design is documented from the actual code, nothing invented.
• AUTO .env.example (Phase 4 — Config engine): v3.0 can generate a .env.example listing every environment variable your code actually uses (preserving any values you've already set), so your app runs for other people too — fixing the classic "works on my machine" gap where the code needs a key nobody was told to set.
• AUTO .gitignore (Section I #22 — Config engine): v3.0 can generate a correct, stack-aware .gitignore (node_modules, build output, .env secrets, plus framework-specific entries from your real dependencies) so secrets and junk never get committed.
• AUTO OBSERVABILITY (P-CGE.11 — Observability engine): v3.0 can add real, dependency-free instrumentation to the app it builds — a client-side error handler (catches uncaught errors + unhandled promise rejections), an Express request logger (method/path/status/duration), and a GET /health endpoint — then wires each in, so a deployed app isn't a black box (no forced extra installs; point it at Sentry/Datadog later).
• AUTO BUNDLE OPTIMIZATION (P-CGE.10 — Bundle engine): for a production Vite+React app, v3.0 can add real, dependency-free bundle optimization — vendor code-splitting (Rollup manualChunks → react-vendor/vendor chunks for better caching) and a lazyWithRetry helper (React.lazy route splitting with a one-time reload on a stale chunk) — so the initial bundle stays small and routes load on demand.
• AUTO SEED DATA (P-CGE.13 — Data engine): after defining a data model, v3.0 can generate realistic, deterministic sample rows for each entity into fixtures/seed.json (values inferred from field names/types — names, emails, prices, dates, statuses — seeded by row index so they're varied but reproducible), so the app can be exercised with data instead of an empty database (dependency-free; no faker install).
• AUTO AUTH (P-CGE.8 — Auth engine): when an app needs login / protected routes, v3.0 can generate REAL working auth — a dependency-free HS256 JWT module (sign/verify via Node crypto, reads JWT_SECRET) plus an Express Bearer-token middleware (runs with no install), or Firebase client auth helpers (signIn/signUp/signOut/onAuthChange) — then wires them in, so auth is real, not a stub.
• AUTO DB MIGRATION (P-CGE.6 — Schema engine): after defining a data model, v3.0 can generate the database schema from the entities — a Prisma schema (prisma/schema.prisma) and/or a SQL CREATE TABLE migration (migrations/001_init.sql) for PostgreSQL/MySQL/SQLite — with column types inferred from field names/types (id→primary key, email→unique, *_at→timestamp, price→float, count→int), so the app ships with a real schema, not just type stubs.
• AUTO DEPLOY ARTIFACTS (P-CGE.9 — Deploy engine): before shipping, v3.0 can write the files an app needs to deploy — a production Dockerfile (alpine, multi-stage, non-root), a docker-compose.yml, and a GitHub Actions CI workflow (install → lint → test → build, only the commands you actually have) — straight into the workspace, so the generated app is deployable out of the box.
• AUTO-CONTINUE on time limit: if a big build hits the wall-clock limit and pauses, v3.0 now resumes itself automatically (up to twice) and finishes — you no longer have to type "continue" each time. If it still needs more after that, it asks you to type "continue" once.
• PRODUCT TOUR (P-UX.4): a "Tour" button at the bottom-left (desktop) starts a quick guided walkthrough that spotlights the sidebar, the AI chat, the live preview, the Deploy button and your wallet/billing — it navigates to each area for you and skips anything not available yet. Press Esc or "Done" to exit; it remembers you've taken it.
• BREAKPOINTS / DEBUGGER (P-DEV.3 — Code Studio): in Code Studio, click a line's left gutter to set a red breakpoint (toggle off by clicking again); they are saved across refreshes. The Debug panel lists every breakpoint (file:line) — click one to jump straight to it, or remove it. Note: live pause / call stack / variable inspection are honestly marked "coming soon" (they need the cloud sandbox debugger); the run controls are shown disabled, never faked. For runtime error help today, use the AI Debugger.
• FLAKY TEST DETECTION (P-TQA.8 — Test panel): the Test panel now remembers each test's recent pass/fail history (across runs) and shows a "🟡 flaky" badge next to any test that both passes AND fails over its last several runs (≥5 runs, >20% failures, not always-failing) — so an unreliable test is visible instead of looking stable. History is saved in your browser.
• FORGOT PASSWORD / ACCOUNT RECOVERY (P-UX.8): on the sign-in screen, enter your email and tap "Forgot password?" to get a Firebase password-reset link by email — so a locked-out user can get back in. (For your security the message is the same whether or not an account exists.)
• BUILD FEEDBACK / CSAT (P-UX.6): after a successful v3.0 build, a "Was this build helpful?" 👍/👎 prompt appears under the result — one tap records your feedback (once per build).
• GOVERNANCE & decision-audit (Layer 58): before the build agent runs a shell command, the command is risk-classified; irreversible or dangerous operations (recursive deletes of root/home, remote-code-execution pipes like "curl … | sh", secret exfiltration, force-push, sudo, disk writes) are flagged with an honest warning in the result and recorded to a per-project decision-audit trail — an accountable record of every risky action taken (hard blocking stays with the human-approval gate).
• LIVE "AI Team" tracker — watch each real agent's current action as it builds (not a fake animation).
• MERGED SURFACES from one live stream: file explorer, Code Studio diffs (red/green), terminal, git/history checkpoints, todos and plan — all in sync, zero drift.
• HYBRID sandbox: a fast E2B cloud sandbox initialised as a real Git repo you own.
• ITERATIVE sessions: each message continues the SAME project (same sandbox, files and memory), so you can refine step by step ("add a login page" after "build a todo app"). Use the "New" button to start a fresh project.
• SURGICAL EDITING: when you ask v3.0 to CHANGE an existing app — "fix the navbar", "update the button colour", "refactor the auth", "remove the sidebar" — it detects this is an EDIT (not a new build), loads the current file tree, reads the affected files first, and makes MINIMUM targeted patches (edit_file old→new) instead of rebuilding everything from scratch. Your existing files and working code are never wiped to start over; a one-line fix touches one place. New files are still created when a change genuinely needs them.
• BUILDS IN YOUR LANGUAGE (Layer 73 — Universal Language): write your request in any language — all 22 Indian languages (Hindi, Tamil, Bengali, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Urdu and more) or major world languages — and the app's user-facing text (labels, buttons, headings, placeholders, messages) is generated in THAT language, while the code stays in English. Apni bhasha mein likho, app usi bhasha mein banega.
• SMART COST ROUTING: plain conversation (a greeting, thanks, "who are you", small-talk) is answered by a fast, economical model and only REAL build/engineering requests use the premium engine — the experience is unchanged, you just don't pay build-grade cost for a "hello".
• LIVE ACTIVITY indicator: while it works, a "working…" line under the latest reply shows the CURRENT action live (e.g. "✍️ writing src/App.tsx", "⌨️ running: npm install") with an elapsed timer, so you can see it is making progress, not frozen. Click it to EXPAND a step-by-step activity log — every file write, command, search, agent spawn and the preview publish, with timestamps and ✓/✗ — and click again to collapse. After the build finishes the same line stays as "Done · N steps" so you can expand and review exactly what happened.
• WHAT I BUILT summary (Layer 27 — Product Understanding): after each successful build it shows a short, friendly recap in the chat — the detected stack/framework, how many files/components/routes were created, a few key components/routes, and how to run it (plus the Preview tab) — so you understand what was created at a glance.
• HISTORY: your v3.0 conversations are saved to NavBharatAI's main History (the sidebar "History" option, under All/Apps OR the "Pro" filter — v3.0 chats show under Pro now) when you are signed in, so you can return to them later; inside v3.0 the "History" tab also lists the project's git checkpoints — and these are now DURABLE: every checkpoint a build commits is saved, so the full timeline survives a page refresh, a recycled sandbox, and shows up the same across your devices (not just the current session). Click "Restore" next to a checkpoint to roll the project back to that point; if a checkpoint isn't active in the current session yet, v3.0 tells you honestly instead of pretending it restored.
• OPEN = NEW, RELOAD = CONTINUE: opening NavBharatAI Pro v3.0 from the menu/sidebar always starts a fresh NEW chat (a clean canvas), so you never land on an old project by accident. But if you simply RELOAD the browser (F5) while working in v3.0, you come right back to the SAME project with your messages, files and preview restored — reload continues, opening starts fresh. To reopen a specific past project, pick it from the Recent Chats list (below) or from History.
• RECENT CHATS in the ☰ menu (app-wide): the main 3-line ☰ menu now has a "Recent Chats" section listing your latest conversations (Free, Pro and Doctor), newest first, each with a coloured badge — tap any one to reopen it and continue where you left off, or tap "View all history →" for the full list. A v3.0 chat reopens inside Pro v3.0 with the same project/files/memory.
• SESSION HISTORY MENU (3-line ☰ in the v3.0 header): tap the menu icon at the top-left of the v3.0 header to open your SESSION HISTORY — every saved v3.0 build for your account, grouped like Claude/ChatGPT (Today / Yesterday / Previous 7 days / Previous 30 days / Older), each one showing a live status dot (building / built / failed / stopped) — not just old chat text. The session you currently have open is marked "Current session". Tap any session to reopen it and continue exactly where you left off (same project, files, plan and memory); hover a session and tap the ✕ to permanently delete it (confirmed first). The same menu has a "+ New chat" to start a fresh project. Because sessions are saved PER ACCOUNT (not per device), the list and the ability to continue the SAME project/memory work from ANY device you sign in on — open it on your phone, continue on your laptop, like Claude. ("New" in the header still starts a fresh project too.)
• TERMINAL after a restart: if the live sandbox went to sleep (server restart / idle), the Terminal tab tells you honestly that the workspace is dormant and your saved files are safe — send a message in v3.0 chat to bring the sandbox back online, then the terminal works again (it never fakes output or shows a dead-end).
• FILE UNDERSTANDING: attach any file with the paperclip button next to the message box — images, PDFs, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), ZIP archives, and any text/code file (you can also paste a screenshot). v3.0 reads it and can analyze it or build from it. Documents are read for free on the server; images/PDFs are read by the cheap vision models (Gemini/Grok) by default, and by Claude only when you turn on Power mode — so reading files never costs build-grade money.
• HONEST billing: you are charged the Claude Opus-equivalent token cost × 2.5 (or × 5 in Only-Opus mode); a live cost estimate is shown.`,
    howToUse: 'Open it from the floating "v3.0" button (bottom-right) or from the menu (Pro v3.0) — when opened from the menu it appears as a "NavBharatAI Pro v3.0" tab in the top header, alongside your other open tabs. Type what you want to build, and press Send. To analyze or build from a file, click the paperclip next to the message box and attach images, PDFs, Word/Excel/PowerPoint, ZIP, or text/code files (or paste a screenshot) — then ask your question. Open the build-options menu (the sliders icon on the left of the message box) to toggle Planning, Thinking, or Power (the "Only Opus" max-capability mode, 5× cost — also makes Claude read attached images). The live surfaces — Preview / Files / Diff / Terminal / History — are tab pills in the header: tap one to open that workspace beside the chat (it takes over the screen on mobile), and tap it again (or the ✕) to collapse back to full-width chat. Press Stop to cancel.',
    relatedFeatures: ['engineer_ai', 'pro_chat', 'history', 'settings_secrets'],
    aiSurface: 'engineer_ai',
    keywords: [
      'v3', 'v3.0', 'vargen', 'vargen 3', 'agentv3', 'agent v3', 'pro v3',
      'multi agent', 'multiple agents', 'ai team', 'sub agent', 'subagent',
      'claude code', 'native tool use', 'architect', 'live preview',
      'naya builder', 'naya engine', 'team', 'agent team', 'opus', 'only opus', 'power', 'power mode', 'build options', 'planning', 'thinking',
      'working', 'activity', 'live activity', 'what is it doing', 'kya kar raha hai', 'progress', 'expand', 'step by step', 'working indicator', 'show activity',
      'evaluate', 'authenticity check', 'no fakes', 'fake code', 'placeholder', 'stub detection',
      'accessibility', 'a11y', 'alt text', 'screen reader', 'wcag', 'inclusion', 'sabke liye', 'accessible',
      'compliance', 'privacy', 'dpdp', 'gdpr', 'trust', 'safety', 'bharosa', 'launch-safe', 'privacy policy', 'cookie consent', 'data protection',
      'confidence', 'build confidence', 'how confident', 'sahyog', 'explainability', 'calibrated', 'how sure', 'kitna sure',
      'governance', 'audit', 'decision audit', 'risk', 'dangerous command', 'safety check', 'risky command',
      'file', 'files', 'attach', 'attachment', 'upload', 'image', 'photo', 'screenshot', 'pdf', 'word', 'excel', 'powerpoint', 'docx', 'xlsx', 'zip', 'document', 'read file', 'file padho', 'image padho', 'document analysis',
      'todo detection', 'incomplete code', 'readiness', 'self evaluation',
      'what i built', 'project summary', 'summary', 'what was created', 'recap', 'how to run',
      'history', 'saved chats', 'my conversations', 'past builds', 'checkpoints', 'restore',
      'chat list', 'chats menu', 'history menu', '3 line menu', 'hamburger menu', 'new chat', 'past chats',
      'recent chats', 'recent chat', 'reload', 'refresh', 'reopen chat', 'lost my chat', 'messages gone',
      'open new chat', 'naya chat kholo', 'purani chat', 'reload karne par', 'dormant', 'terminal dormant',
      'session history', 'saved sessions', 'delete chat', 'delete session', 'remove chat', 'purani chat delete', 'chat hatao', 'group by date', 'today yesterday',
      'cross device', 'continue on another device', 'same chat on phone and laptop', 'switch device', 'sync chats',
      'doosre device se kholo', 'phone se laptop', 'nayi chat',
      'reflection', 'learns', 'remembers lessons',
      'continual learning', 'applies lessons', 'learns across builds',
      'cross project memory', 'cross-project', 'remembers across projects', 'learns from my other apps',
      'memory', 'brain', 'proven lessons', 'smarter recall', 'relevance ranking', 'bm25',
      'yaad rakhta hai', 'pichle projects se seekhta hai',
      'dependency check', 'missing dependency', 'package.json',
      'env var', 'environment variable', '.env', '.env.example',
      'second opinion', 'cross model', 'ensemble', 'independent review',
      'consensus', 'panel', 'collective intelligence', 'multiple perspectives',
      'hindi', 'tamil', 'bengali', 'apni bhasha', 'language', 'multilingual',
      'regional language', 'bhasha', 'build in my language', 'app in hindi',
      'chat', 'cost', 'economical', 'cheap chat', 'cost routing', 'smart routing',
      'edit', 'edit existing', 'surgical edit', 'targeted change', 'modify app', 'modify existing app',
      'change app', 'fix existing', 'update existing', 'dont rebuild', "don't rebuild", 'not rebuild',
      'rebuilds everything', 'wipes my app', 'deleted my files', 'edit_file', 'minimum changes',
      'edit karo', 'badlo', 'change karo', 'thik karo', 'wapas se bana diya', 'pura dobara bana diya',
    ],
  },
  {
    id: 'agentv3_export',
    name: 'Export project (.zip) — your code, no lock-in',
    path: 'NavBharatAI Pro v3.0 → header tab row → "Export .zip" button',
    description: 'Download your entire v3.0 project as a real .zip file that you fully own. It contains the source files (generated folders like node_modules, dist and .git are excluded so it stays the clean source). Open it in any code editor (VS Code, etc.) or host it on any provider — there is no lock-in. The zip is built right in your browser from the live project files.',
    howToUse: 'Open NavBharatAI Pro v3.0 and build or open a project. In the tab row at the top of the builder, click "Export .zip". The download starts automatically once the project files are packaged.',
    relatedFeatures: ['agentv3_builder'],
    keywords: ['export', 'download', 'zip', 'download project', 'export code', 'download code', 'my code', 'source code', 'no lock-in', 'portability', 'take my code', 'code nikalo', 'project download', 'download karo', 'zip nikalo', 'apna code'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_zip_import',
    name: 'Import an existing app (.zip) into v3.0',
    path: 'NavBharatAI Pro v3.0 → chat composer → 📎 attach → pick your app\'s .zip → send',
    description: 'Bring an app you already built (exported from any tool — Lovable, Bolt, v0, VS Code, or an earlier NavBharatAI export) into NavBharatAI Pro v3.0 by attaching its .zip in the chat. The archive is really unpacked into your workspace: the files appear in the Files tab and Code Studio (IDE), the framework (React/Vite, Next.js, Vue, …) is detected from package.json and locked to the session, the live preview is set up automatically in the background (npm install + dev server), and the AI reads the real project so your first edit request works with full context. Full-stack apps that need a database get a local PostgreSQL provisioned in the sandbox plus a dev .env (so the server boots instead of crashing on a missing DATABASE_URL); external paid services (payments, third-party APIs) can\'t be provisioned, so those features stay inactive until you add real keys in Settings → Secrets — the preview is honest about that. Small images, icons and fonts (logos/favicons, ≤200KB each) are kept as real assets so the preview isn\'t full of broken images; large media/binaries are skipped. Safety: node_modules/build folders are skipped (re-created by install), and secret files (.env, keys) are never imported — re-enter your own secrets (the app\'s expected variable names are surfaced from its .env template). Per-file limit 900KB, up to 2000 files.',
    howToUse: 'Open NavBharatAI Pro v3.0, tap the 📎 paperclip in the chat box, choose your app\'s .zip and send (with or without a message). Watch the import summary appear in chat; your files show in the Files tab and the IDE, and the preview boots in the background. Then simply tell v3.0 what to change.',
    relatedFeatures: ['agentv3_builder', 'agentv3_export', 'agentv3_files'],
    keywords: ['import', 'import app', 'import zip', 'zip upload', 'upload zip', 'existing app', 'purani app', 'apni app', 'app import karo', 'zip se app', 'zip dalo', 'bring my app', 'migrate app', 'lovable', 'bolt', 'v0', 'edit my existing app', 'meri bani hui app', 'zip import'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_github_import',
    name: 'Import an existing app from GitHub into v3.0',
    path: 'NavBharatAI Pro v3.0 → chat composer → options (⚙) → "GitHub / URL" → pick a repo from your list (1 click) or paste a URL',
    description: 'Bring an app that lives in a GitHub repository into NavBharatAI Pro v3.0 with ONE click: the Import Project dialog lists your own repositories (recently updated first, searchable, private repos marked) — clicking one imports it immediately. Not connected yet? A single "Connect GitHub" button signs you in and approves access (private repos included), then you land back on the list. The repo is really cloned into your workspace and lands the same way a zip import does — files appear in the Files tab and Code Studio (IDE), the framework is detected from package.json and locked to the session, the live preview is set up automatically in the background, and the AI reads the real project and gives a survey before your first edit request. You can also paste any https://github.com/owner/repo URL (e.g. someone else\'s public repo).',
    howToUse: 'Open NavBharatAI Pro v3.0 → tap the options (⚙) button next to the chat box → "GitHub / URL". If asked, click "Connect GitHub" once. Then simply click the repository you want — the import, Files/IDE, preview boot and AI survey all happen automatically. Or paste a repo URL below the list and press Import.',
    relatedFeatures: ['agentv3_builder', 'agentv3_zip_import', 'agentv3_files'],
    keywords: ['github import', 'import from github', 'repo import', 'clone repo', 'github url', 'import repository', 'github se app', 'repo se import', 'apni github app', 'private repo', 'github wali app', 'repository import karo'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_project_mode',
    name: 'Software Project Mode — build very large software (hundreds of files) module by module',
    path: 'NavBharatAI Pro v3.0 → chat — automatic for large software requests (a full ERP/CRM/management system, an explicit "200+ screens" scale, or a spec listing many features)',
    description: 'For software too big for one build round, v3.0 first decomposes the request into independently-buildable modules with frozen interface contracts, saves that plan durably (it survives reloads, closed tabs and new sessions), and then builds ONE module per round in dependency order — continuing automatically round after round while real progress is being made, until every module is done. The module plan is shown as the plan list above the chat box and ticks off live. If a module fails, the build pauses honestly with the reason and its dependent modules wait; typing "continue" retries the failed module. Requires the admin to have enabled project mode on the server (AGENTV3_PROJECT_MODE).',
    howToUse: 'Describe the full software in one message — an explicit scale ("an app with 200+ screens") or a detailed numbered/bulleted feature list is what triggers project mode. Watch the module plan appear and tick off as rounds complete; it continues by itself while progressing. To resume later (after a reload, a new session, or a failed module), just type "continue".',
    relatedFeatures: ['agentv3_builder', 'agentv3_build_continuity', 'agentv3_files'],
    keywords: ['big app', 'large app', 'badi app', 'bada software', '1000 files', '5000 files', 'full software', 'complete software', 'erp', 'crm', 'management system', 'module', 'modules', 'project mode', 'module by module', 'big project', 'bade project', 'pura software banao', 'complex app', 'complex software', 'enterprise app', 'bahut badi app'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_build_continuity',
    name: 'Build survives reload & tab switch (no lost work)',
    path: 'NavBharatAI Pro v3.0 — automatic; the build keeps running and re-attaches on its own',
    description: 'A running v3.0 build does NOT stop when you reload the page or switch tabs. The build keeps running on the server; when the page reloads or the tab becomes visible again, v3.0 automatically re-attaches to the live build and resumes streaming where it left off — no "Resume" click needed (the manual Resume button stays as a fallback). Your project is sticky too: the session id is saved per account, so a reload reuses the SAME workspace, memory and files (the next message continues the same project, never a blank one). Chat history is restored on reload, and if files ever look missing you can also use "Restore all files".',
    howToUse: 'Just keep using NavBharatAI Pro v3.0 — if you refresh or switch tabs during a build, it reconnects by itself and continues. Your previous messages, plan, files and live preview come back automatically. If anything still looks missing, open History or Files and click "Restore all files".',
    relatedFeatures: ['agentv3_builder', 'agentv3_restore_files', 'agentv3_files'],
    keywords: ['reload', 'refresh', 'tab switch', 'tab change', 'build stopped', 'build band', 'reload pe band', 'tab badalne par', 'lost work', 'work gayab', 'memory lost', 'context lost', 'resume', 'reconnect', 'build continue', 'kaam wapas', 'session', 'page refresh', 'build ruk gaya'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_restore_files',
    name: 'Restore all files (bring your whole project back)',
    path: 'NavBharatAI Pro v3.0 → header → History tab (or Files tab when empty) → "Restore all files" button',
    description: 'Bring your ENTIRE project back into the workspace with one click — a real restore, not a preview. If your files look gone (for example after a page refresh, or a build that did not finish), open the History tab (or the Files tab) and click "Restore all files". NavBharatAI writes your last durably-saved project files back into the workspace so they are genuinely there again — listed in Files, previewable, buildable and deployable. It honestly tells you how many files were restored, or says so if there are no saved files yet. You can also restore to a specific earlier checkpoint from the History list.',
    howToUse: 'Open NavBharatAI Pro v3.0. Tap the "History" tab at the top (or the "Files" tab if it shows no files). Click "Restore all files" — the workspace is repopulated and the Files tab opens showing your restored files. To go back to an earlier version instead, click "Restore" next to a specific checkpoint in History.',
    relatedFeatures: ['agentv3_builder', 'agentv3_export', 'agentv3_deploy'],
    keywords: ['restore', 'restore files', 'restore all', 'files gone', 'files missing', 'files 0', 'lost files', 'get files back', 'recover', 'recover files', 'checkpoint', 'history', 'restore karo', 'files wapas', 'file gayab', 'files nahi dikh rahi', 'project wapas', 'restore project'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_build_report',
    name: 'Download build diagnostics report (every issue v3.0 hit)',
    path: 'NavBharatAI Pro v3.0 → header tab row → "Build report" button',
    description: 'A self-diagnostics report of your LAST build: a structured, technical list of every issue NavBharatAI Pro v3.0 ran into while building your app — whether it auto-recovered or not. The report leads with a plain-language ROOT CAUSE line (the single most important sentence — no hunting through hundreds of entries) and a noise-free "Problems" list (only real warnings/errors — every routine tool-call/heartbeat/progress-narration line is excluded from the default view, and an identical entry repeated back-to-back is collapsed into one line with a ×N count instead of bloating the report). It captures provider fallbacks (e.g. Claude to Haiku), failed tool calls, "replied without building" nudges, readiness-gate blockers, sandbox problems and runtime errors, each tagged with a code, severity, and whether it was auto-resolved or remained unresolved. It also includes a full "AI Diagnosis Bundle": the raw sandbox command logs (npm install / tsc / vite build / dev-server stdout, stderr and exit codes), every model turn\'s input/output shape (model, finish reason, token counts, latency, and whether the response was truncated), and the complete un-truncated error messages with stack traces — the signals that explain most "the app generated but won\'t run" failures. A "Report history" button lets you browse and reopen PAST builds\' reports too — so a small, quick recent build (an edit, a retry) never permanently hides a previous, richer report; each past entry shows its timestamp, ok/fail status and root cause at a glance. Click "Build report" in the v3.0 header to download the full report as a JSON file, "Text report" for the SAME report as a readable plain-text document (root cause first, problems only, plus the full sandbox/LLM/reviewer detail — easier to read than JSON), or "Copy report" for a readable summary (root cause + problems) plus the full JSON, ready to paste into a support chat.',
    howToUse: 'Build an app in NavBharatAI Pro v3.0. Then click "Build report" for JSON, "Text report" for a readable .txt document, or "Copy report" to copy a readable summary + the full JSON to your clipboard and paste it straight into a support chat (no download/upload needed). Click "Report history" to browse past builds\' reports and reopen one — download/copy then apply to THAT build instead of the latest one; "Back to latest report" returns to the current build. The build report is saved together WITH the chat itself (embedded in the same durable conversation record), so reopening that conversation from History always brings its Build report back with it — it is never lost, even after a very long build whose live connection dropped. The latest report is also saved durably per workspace (survives a page reload), and past reports are kept in a bounded history so a later small build never destroys access to one you already had.',
    relatedFeatures: ['agentv3_builder', 'agentv3_files', 'agentv3_export'],
    keywords: ['build report', 'diagnostics', 'diagnostic report', 'issues', 'errors report', 'download report', 'self diagnose', 'build issues', 'kya dikkat aayi', 'report download', 'json report', 'struggle', 'build log', 'issue list', 'technical report', 'sandbox logs', 'npm install error', 'stack trace', 'llm logs', 'raw logs', 'diagnosis bundle', 'why failed', 'kyu fail hua', 'copy report', 'report empty', 'report khali', 'build report blank', 'root cause', 'problems only', 'report history', 'past build report', 'purani report', 'previous report gone', 'text report', 'readable report', 'txt report', 'report saved', 'report save nahi hui', 'report gayab', 'report missing', 'report not saved', 'report lost', 'report permanently', 'report with chat', 'reopen report'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_files',
    name: 'Files — one Files view, two gates (v3.0 tab + sidebar)',
    path: 'NavBharatAI Pro v3.0 → header → Files tab  —OR—  sidebar menu → Files (both open the SAME Files view)',
    description: 'There is ONE Files feature, reachable from two places that open the exact same view: the "Files" tab in the NavBharatAI Pro v3.0 header, and "Files" in the sidebar menu. Both show the SAME files — the files v3.0 built PLUS any files you uploaded — and offer the same actions: browse the file tree, search/filter by name, upload files, download the whole project as a ZIP, create, rename, duplicate or delete a file, and a History tab to restore an earlier version. Click any file to open it in Code Studio and read or edit its full contents. The list is pulled live from your real project (v3.0 sandbox files are merged with the main app files, and heavy generated folders like node_modules, dist and .git are left out so it stays the clean source). Because both entry points render the same component over the same data, what you see in the v3.0 Files tab and the sidebar Files is always consistent. The live "Plan" checklist above the chat input can be minimized or expanded with a single tap so it never eats the chat area — collapsed, it still shows the current step.',
    howToUse: 'Open Files from EITHER place — the "Files" tab in the v3.0 header, or "Files" in the sidebar menu; both open the same view with the same files (v3.0-built and uploaded) and the same actions (upload, download ZIP, rename, duplicate, delete, search, and History → Restore). Tap a file to open it in Code Studio. To shrink the Plan checklist above the message box, tap the "Plan" header (the chevron) — tap again to expand it.',
    relatedFeatures: ['agentv3_builder', 'agentv3_export', 'agentv3_restore_files', 'files'],
    keywords: ['file content', 'view file', 'open file', 'read file', 'see code', 'file ke andar', 'file kholo', 'file dekho', 'code dekho', 'andar kya likha', 'files view', 'sidebar files', 'files sync', 'plan minimize', 'plan collapse', 'plan chhota karo', 'plan hide', 'chat area', 'minimize plan', 'expand plan', 'file content dikhao', 'line count', 'lines', 'kitni line', 'number of lines', 'lines likhi', 'file lines', 'green yellow dot'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_deploy',
    name: 'Deploy to a live URL (one click)',
    path: 'NavBharatAI Pro v3.0 → header tab row → "Deploy" button (the live link then shows as "Live site")',
    description: 'Publish your built app to a PERMANENT public URL with one click. The "Deploy" button runs the production build and publishes the app, returning a real https URL that anyone can open and that STAYS LIVE even after the cloud sandbox stops. NO LOCK-IN: NavBharatAI supports MULTIPLE hosting providers — Firebase Hosting (always available) plus Cloudflare Pages, Vercel and Netlify (and more) when their API token is configured by the admin. When more than one is available, a small chooser next to the Deploy button lets you pick WHERE to deploy. Once deployed, a "Live site" link appears in the same header row — click it to open your live app, or share the URL with anyone. The live link is saved, so it comes back even after you refresh or return in a new session. (A custom domain like yourname.com is a separate upcoming feature — the provider URL is already permanent and shareable.)',
    howToUse: 'Build an app in NavBharatAI Pro v3.0, then click "Deploy" in the tab row at the top. v3.0 builds and publishes it; watch the progress in the chat. When it finishes, click the "Live site" link that appears to open your permanent public URL, and share that URL with anyone.',
    relatedFeatures: ['agentv3_builder', 'agentv3_preview', 'agentv3_export'],
    keywords: ['deploy', 'publish', 'go live', 'live url', 'public url', 'host', 'hosting', 'share app', 'live site', 'make it live', 'put online', 'deploy karo', 'live karo', 'publish karo', 'app live', 'website live', 'permanent url', 'share link', 'firebase hosting', 'cloudflare', 'cloudflare pages', 'vercel', 'netlify', 'hosting provider', 'kahan deploy', 'no lock-in', 'launch'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_preview',
    name: 'Preview (dual: Live server + In-browser)',
    path: 'NavBharatAI Pro v3.0 → header → Preview tab → "Live server" / "In-browser" switch',
    description: 'Two ways to preview your app inside the v3.0 builder. "Live server" shows the real running app from the cloud (E2B) sandbox — full fidelity, supports any framework and a backend. "In-browser" renders a self-contained build of your files right inside the browser with no server, so it still works when the sandbox preview is unavailable (e.g. a "Blocked request" error) and is instant for static HTML/CSS/JS and simple React/Vue apps. Switch between them with the toggle at the top of the Preview tab. Each mode has a reload (↻) button: on "Live server" it reconnects the running app (useful right after a build, when the cloud sandbox is still finishing its cold start and the preview shows "still starting"); on "In-browser" it rebuilds the preview from the latest files. If "Live server" still shows "No live preview yet" after a build finishes, a "Diagnose" button appears in that empty state — it re-runs the real dev-server boot sequence inside your sandbox (installs dependencies, restarts the server, checks the port) and reports the exact internal reason it failed, or restores the preview immediately if the server was actually already running.',
    howToUse: 'Open the Preview tab in NavBharatAI Pro v3.0. If the app is running you will see the Live server preview. If it shows "No live preview yet" or looks stuck right after a build, click the reload (↻) button to reconnect once the sandbox has started, or click "Diagnose" to have v3.0 check the real dev-server state inside the sandbox and report the exact cause (or fix it on the spot). Click "In-browser" to render the files locally without a server (useful if the live preview is blocked or not started), and use its reload (↻) button to rebuild after changes.',
    relatedFeatures: ['agentv3_builder', 'agentv3_export'],
    keywords: ['preview', 'live preview', 'in-browser preview', 'browser preview', 'blocked request', 'preview not working', 'preview nahi chal raha', 'app dekho', 'see app', 'run app', 'sandbox preview', 'static preview', 'dual preview', 'preview kaise', 'diagnose', 'diagnose button', 'diagnose preview', 'preview diagnosis', 'internal problem', 'preview kya problem hai'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_github_storage',
    name: 'Save apps to your own GitHub (git-native)',
    path: 'Sign in with GitHub → build in NavBharatAI Pro v3.0 → your project is committed to a private repo in YOUR GitHub account',
    description: 'When you sign in with GitHub, NavBharatAI Pro v3.0 stores each project as a real private repo in YOUR OWN GitHub account (not on our servers). Every build commits there, so your code is durable and 100% owned by you — no lock-in. It works like Claude Code: the build is pushed to a branch, a pull request is opened, CI is checked, and the PR is merged only when checks are green (never merged red). Users who sign in with Email/Phone instead get the same durability via a private repo in the platform GitHub org behind the scenes. Requires GitHub git-native storage to be enabled by the admin.',
    howToUse: 'Click "Continue with GitHub" on the login screen and approve the repo permissions. Then build normally in NavBharatAI Pro v3.0 — the builder creates/uses a private repo in your GitHub for the project and commits every build to it. Open your GitHub to see the repo, branches, pull requests and merges.',
    relatedFeatures: ['agentv3_builder', 'agentv3_export', 'login_auth'],
    keywords: ['github', 'github storage', 'my github', 'save to github', 'git', 'repo', 'repository', 'commit', 'pull request', 'pr', 'ci', 'merge', 'own code', 'no lock-in', 'github me save', 'github par', 'apni github', 'git native', 'version control'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'privacy_consent',
    name: 'Privacy & analytics consent',
    path: 'Consent banner (bottom of the screen) on your first visit — Accept analytics / Decline',
    description: 'A privacy consent banner (GDPR + India DPDP) shown on your first visit. NavBharatAI uses privacy-friendly product analytics and Core Web Vitals performance measurement to improve the app — these are OPTIONAL and never run until you tap "Accept analytics". If you "Decline" (or ignore it), no non-essential analytics or performance tracking fires. Essential features and anonymous crash/error reporting (needed to keep the app stable) work either way. Your choice is remembered on this device; to change it later, clear the site data/cookies for NavBharatAI in your browser and the banner returns.',
    howToUse: 'On your first visit, a banner appears at the bottom. Tap "Accept analytics" to allow optional analytics/performance measurement, or "Decline" to keep them off. To change your choice later, clear NavBharatAI\'s site data in your browser settings — the banner will show again on the next visit.',
    relatedFeatures: ['settings_root'],
    keywords: ['privacy', 'consent', 'cookie', 'cookies', 'gdpr', 'dpdp', 'analytics', 'tracking', 'data', 'opt out', 'opt in', 'decline', 'accept', 'privacy policy', 'do not track', 'data privacy', 'meri privacy', 'data collection'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'ai_design_copilot',
    name: 'AI Copilot — AI design suggestions',
    path: 'The floating "AI Copilot" button (bottom-right) in the chat/builder',
    description: 'A floating "AI Copilot" that suggests the most impactful improvements for your current app — now powered by REAL AI (P-DESIGN.5), not just static tips. It reads your app\'s code and returns concrete, context-aware suggestions (improve / add / fix / style); tap one to send it straight to the builder. If the AI is briefly unavailable it falls back to smart heuristic suggestions, so you always get useful ideas. It also shows a **Design health** score (P-DESIGN.8): a deterministic 0–100 consistency grade (A–D) that flags design issues in your app\'s code — too many distinct colours, too many font families, spacing off the 4px grid, and hardcoded colours instead of design tokens — with concrete fixes. And an **Accessibility** score (P-TQA.11): a deterministic WCAG grade (A–D) that flags common accessibility problems in your app — images without alt text, form fields with no label, buttons/links with no accessible name (e.g. icon-only buttons), a missing `lang`, and positive tabindex — each mapped to its WCAG criterion with a fix. **Every Design/Accessibility issue has a one-click "Fix with AI" button** that sends the exact fix instruction straight to the builder — so you can fix problems without typing. A backend AI "design pass" also generates a colour palette + type scale from a brand description (POST /api/design/palette).',
    howToUse: 'Open the chat/builder and tap the "AI Copilot" button at the bottom-right. It shows a Design health score, an Accessibility score, plus AI suggestions tailored to your app — tap "Fix with AI" next to any issue to have the builder fix it, tap any suggestion to send that instruction, or tap the refresh icon to regenerate.',
    relatedFeatures: ['agentv3_builder'],
    keywords: ['ai copilot', 'copilot', 'suggestions', 'ai suggestions', 'design suggestions', 'improve my app', 'design pass', 'palette', 'color palette', 'ideas', 'what next', 'sujhav', 'design critique', 'design health', 'design score', 'consistency', 'design lint', 'brand compliance', 'visual linter', 'accessibility', 'a11y', 'wcag', 'alt text', 'screen reader', 'accessible', 'accessibility score'],
    aiSurface: 'nbi_chat',
  },
  // ─── ENGINEER AI ─────────────────────────────────────────────────────────
  {
    id: 'connect_domain',
    name: 'Connect my website (custom domain)',
    path: 'Sidebar → More menu → Connect my website',
    description: `Connect your own purchased domain (e.g. from Hostinger or GoDaddy) to a site you built on NavBharatAI.
• Enter your domain (e.g. myshop.com).
• Pick where you bought it / where its DNS is (Hostinger, GoDaddy, Cloudflare, Namecheap, BigRock, Google/Squarespace, Other).
• Open that provider's DNS settings in one click.
• Add the DNS records shown, and your site goes live on your own domain with automatic HTTPS/SSL.
NOTE: the one-time connection backend is being finalized; the screen currently guides you to prepare your domain and never falsely reports a domain as connected.`,
    howToUse: 'Open the sidebar More menu → Connect my website → enter your domain → choose your registrar → open its DNS page and add the records shown.',
    relatedFeatures: ['engineer_ai', 'engineer_ai_deploy'],
    keywords: [
      'connect domain', 'custom domain', 'my website', 'apna domain', 'website connect',
      'hostinger', 'godaddy', 'dns', 'point domain', 'live website', 'own domain',
      'connect my website', 'domain jodo', 'website live karo',
    ],
  },
  {
    id: 'engineer_ai',
    name: 'Engineer AI (retired → use NavBharatAI Pro v3.0)',
    path: 'RETIRED. App building is now NavBharatAI Pro v3.0 — Sidebar → "NavBharatAI Pro v3.0".',
    description: `RETIRED — replaced by NavBharatAI Pro v3.0, the new agentic app builder (everything Engineer AI did, now in v3.0: builds full-stack apps, live preview, GitHub storage, deploy, multi-agent team). Direct users to "NavBharatAI Pro v3.0" in the sidebar. Original Engineer AI capabilities (for reference):
• BUILDS apps from plain-language descriptions — React/Vite, Next.js, Vue, Svelte, Node/Express, Python/FastAPI, or plain HTML.
• SEES the running app via screenshots — visually verifies layout, UI, and bugs.
• DRIVES the browser — clicks buttons, fills forms, navigates pages, tests flows end-to-end.
• SEARCHES the web — finds docs, error fixes, and latest package versions (Brave Search or DuckDuckGo).
• CLONES GitHub repos into the sandbox; PUSHES code back to GitHub.
• DEPLOYS finished apps to Firebase Hosting — permanent public HTTPS URL.
• PROVISIONS databases — installs PostgreSQL, generates DATABASE_URL, scaffolds db/auth/storage helpers.
• GENERATES Vitest unit tests automatically after the app is built.
• REMEMBERS decisions across sessions using persistent Firestore memory.
• CHECKPOINTS code before every edit so you can roll back any change instantly.
• MULTI-STEP PLANS: breaks large tasks into named steps, shows live progress.
• SELF-REVIEWS edits with a focused pass to catch missing imports and logic bugs.`,
    howToUse: 'Open Engineer AI, describe what you want to build in any language. Watch the live preview as it builds. Use the Files, Preview, and Terminal tabs to inspect the workspace.',
    relatedFeatures: ['engineer_ai_deploy', 'engineer_ai_github', 'settings_database', 'settings_secrets', 'history'],
    aiSurface: 'engineer_ai',
    keywords: [
      'engineer ai', 'engineer', 'build app', 'autonomous', 'agent', 'deploy', 'sandbox',
      'code agent', 'app builder', 'banao', 'create app', 'make app', 'develop',
      'screenshot', 'browser', 'web search', 'github', 'postgres', 'tests', 'vitest',
      'memory', 'checkpoint', 'rollback', 'plan', 'self review',
    ],
  },
  {
    id: 'engineer_ai_deploy',
    name: 'Engineer AI — Deploy to Firebase Hosting',
    path: 'Engineer AI chat → type "deploy" or the agent calls deploy automatically',
    description: 'Deploys the built app to a permanent public Firebase Hosting URL. Works for static/SPA apps (React/Vite, Vue, Svelte, Next.js static export). Returns a live URL that survives sandbox restarts. For Node/Python backends, Engineer AI exposes the live dev-server URL directly (no separate deploy needed).',
    howToUse: 'Say "deploy" in the Engineer AI chat after the app is built, or Engineer AI will call deploy automatically when the task is complete.',
    relatedFeatures: ['engineer_ai', 'settings_database'],
    aiSurface: 'engineer_ai',
    keywords: ['deploy', 'deployment', 'firebase hosting', 'live url', 'publish', 'hosting', 'public url', 'permanent link'],
  },
  {
    id: 'engineer_ai_github',
    name: 'Engineer AI — GitHub Clone & Push',
    path: 'Engineer AI chat → describe cloning a repo or pushing code',
    description: 'Engineer AI can clone any GitHub repository into the sandbox and push code back. Uses GITHUB_TOKEN from Settings → Secrets & Keys for private repos. Supports: clone_repo (import an existing codebase) and git_push (commit + push all changes to the repo).',
    howToUse: 'Tell Engineer AI "clone my repo at github.com/..." or "push the code to GitHub". Store your GITHUB_TOKEN in Settings → Secrets & Keys first.',
    relatedFeatures: ['engineer_ai', 'settings_secrets'],
    aiSurface: 'engineer_ai',
    keywords: ['github', 'clone', 'git push', 'repo', 'repository', 'version control', 'push code', 'github token'],
  },

  // ─── DOCTOR AI ───────────────────────────────────────────────────────────
  {
    id: 'doctor_ai',
    name: 'Doctor AI (Senior Doctor Assistant)',
    path: 'Header → Doctor AI tab  OR  Sidebar → Professionals → Doctor AI',
    description: 'Senior-doctor assistant AND mentor for qualified/junior/rural doctors. TWO modes: (1) PATIENT CASE — efficient high-yield history, red-flag screening, ranked differentials, investigation guidance, verified clinical calculators (CURB-65, qSOFA, GCS, Wells, CHA2DS2-VASc, pediatric dosing), an independent second-AI safety cross-check, and answers grounded in standard safety references with a clear "manage here vs refer NOW" decision. (2) GENERAL HELP — solves other junior-doctor queries: procedures/how-to, guidelines & protocols, drug information, documentation & medico-legal (discharge summary, referral letter, informed consent, certificates), communication (breaking bad news/SPIKES), exam/career guidance, and wellbeing/burnout support. IMPORTANT: decision-support only — assists, never replaces, the treating physician; medico-legal/career answers are general guidance to verify locally.',
    howToUse: 'Open Doctor AI and either describe a patient case (it does a fast focused workup), or just ask any doctor question — e.g. "how do I write a discharge summary", "steps for lumbar puncture", "breaking bad news", "PG exam prep". It answers in the right mode automatically.',
    relatedFeatures: ['professionals', 'history'],
    aiSurface: 'sda_chat',
    // IMPORTANT: keywords must be app-navigation terms only (what a user types to FIND the feature),
    // NOT clinical content terms (those appear in real doctor-patient conversations and must not trigger injection).
    keywords: ['doctor ai', 'senior doctor', 'medical ai', 'clinical ai', 'doctor assistant', 'sda chat', 'doctor screen', 'open doctor'],
  },

  // ─── TEACHER AI ──────────────────────────────────────────────────────────
  {
    id: 'teacher_ai',
    name: 'Teacher AI',
    path: 'Sidebar → Professionals → Teacher AI',
    description: 'Patient expert teacher/tutor for Indian students and teachers. Explains any concept simply, solves doubts step by step (Socratic), creates lesson plans, quizzes and exam study plans (boards, NEET, JEE, UPSC), and works in any Indian language. Grounded in standard pedagogy; a study aid that builds understanding — verify exam-specific syllabus from official sources.',
    howToUse: 'Open Sidebar → Professionals → Teacher AI and ask anything: "explain X simply", "solve this step by step", "make a study plan", "quiz me on Y".',
    relatedFeatures: ['professionals'],
    aiSurface: 'teacher_ai',
    keywords: ['teacher ai', 'tutor', 'study', 'lesson plan', 'exam prep', 'doubt', 'quiz', 'padhai', 'teacher', 'learn'],
  },

  // ─── MENTOR / CAREER COACH ───────────────────────────────────────────────
  {
    id: 'mentor_ai',
    name: 'Mentor / Career Coach',
    path: 'Sidebar → Professionals → Mentor / Career Coach',
    description: 'Career mentor & coach for Indian students and early-career professionals: career-direction guidance, resume/CV review & drafting, interview prep (STAR), skill roadmaps, job-search/career-switch strategy, and higher-studies/study-abroad guidance. Honest and India-aware (campus placements, govt vs private vs startup, UPSC/CAT, study-abroad). General guidance — does not guarantee jobs/salaries/admissions.',
    howToUse: 'Open Sidebar → Professionals → Mentor / Career Coach and ask: "help me choose a career", "review my resume", "prep me for an interview", "make a skill roadmap".',
    relatedFeatures: ['professionals'],
    aiSurface: 'mentor_ai',
    keywords: ['mentor', 'career', 'coach', 'resume', 'cv', 'interview', 'job', 'skill roadmap', 'career change', 'study abroad', 'naukri'],
  },

  // ─── THESIS / RESEARCH WRITER ────────────────────────────────────────────
  {
    id: 'thesis_ai',
    name: 'Thesis / Research Writer',
    path: 'Sidebar → Professionals → Thesis / Research Writer',
    description: 'Academic research & writing assistant (UG/PG/PhD): sharpen the research question (FINER/PICO), structure the thesis (IMRaD/chapters), organise a literature review, choose methodology, format citations (APA/MLA/IEEE/Chicago/Vancouver), and edit the author\'s own draft for clarity & academic tone. Academic integrity built-in: never fabricates citations/data, promotes original writing + proper attribution, and tells you to run an institutional plagiarism check.',
    howToUse: 'Open Sidebar → Professionals → Thesis / Research Writer and ask: "sharpen my research question", "structure my thesis", "format these references in APA", "improve my draft".',
    relatedFeatures: ['professionals'],
    aiSurface: 'thesis_ai',
    keywords: ['thesis', 'research', 'dissertation', 'paper', 'literature review', 'citation', 'apa', 'methodology', 'academic writing', 'shodhganga', 'phd'],
  },

  // ─── CA / TAX & ACCOUNTS ─────────────────────────────────────────────────
  {
    id: 'accountant_ai',
    name: 'CA / Tax & Accounts',
    path: 'Sidebar → Professionals → CA / Tax & Accounts',
    description: 'Educational assistant for Indian taxation, accounting & business compliance: explains GST, income tax (old vs new regime), TDS/TCS, deductions (80C etc.), capital gains; helps understand a tax notice or ITR/GST form; bookkeeping (double-entry, P&L, balance sheet); business setup & compliance (proprietorship/LLP/Pvt Ltd, Udyam, ROC). NOT a substitute for a qualified CA — tax rates/slabs/dates change every Financial Year, so it always tells you to verify current figures (incometax.gov.in / gst.gov.in) and consult a CA.',
    howToUse: 'Open Sidebar → Professionals → CA / Tax & Accounts and ask: "old vs new tax regime", "how GST ITC works", "what is TDS / Form 26AS", "bookkeeping basics".',
    relatedFeatures: ['professionals'],
    aiSurface: 'accountant_ai',
    keywords: ['ca', 'tax', 'gst', 'income tax', 'itr', 'tds', 'accountant', 'bookkeeping', 'accounts', '80c', 'audit', 'compliance', 'msme'],
  },

  // ─── LAWYER / LEGAL ──────────────────────────────────────────────────────
  {
    id: 'lawyer_ai',
    name: 'Lawyer / Legal Assistant',
    path: 'Sidebar → Professionals → Lawyer / Legal',
    description: 'General legal-INFORMATION assistant for Indian law: explains rights & processes (consumer, tenancy, employment, contracts, cheque bounce, FIR, RTI), helps understand a notice/contract clause, drafts templates (legal notice, RTI, complaint, rent agreement, affidavit), and explains how to file an FIR/consumer complaint/RTI. NOT legal advice and NOT a lawyer-client relationship — Indian laws change & vary by state/forum (e.g. IPC→BNS), so it never cites a section/case as definitive and tells you to verify and consult an advocate; drafts must be lawyer-vetted.',
    howToUse: 'Open Sidebar → Professionals → Lawyer / Legal and ask: "explain my consumer rights", "draft a legal notice", "how to file an RTI", "explain this clause".',
    relatedFeatures: ['professionals'],
    aiSurface: 'lawyer_ai',
    keywords: ['lawyer', 'legal', 'law', 'advocate', 'notice', 'rti', 'fir', 'consumer', 'contract', 'agreement', 'rights', 'kanoon'],
  },

  // ─── FINANCIAL ADVISOR ───────────────────────────────────────────────────
  {
    id: 'finance_ai',
    name: 'Financial Advisor',
    path: 'Sidebar → Professionals → Financial Advisor',
    description: 'Personal-finance EDUCATION assistant for India: budgeting & emergency fund, how SIP/mutual funds/index funds/PPF/EPF/NPS/FD work, risk vs return & diversification, insurance (term + health first), debt payoff, and goal-based planning. NOT investment advice and NOT a SEBI-registered adviser — never recommends specific stocks/funds, always notes market risk and "past performance ≠ future returns", and tells you to consult a SEBI-registered adviser (and a CA for tax).',
    howToUse: 'Open Sidebar → Professionals → Financial Advisor and ask: "start a budget & emergency fund", "explain SIP & mutual funds", "term vs endowment insurance", "how to pay off loans".',
    relatedFeatures: ['professionals', 'accountant_ai'],
    aiSurface: 'finance_ai',
    keywords: ['finance', 'financial', 'money', 'invest', 'sip', 'mutual fund', 'savings', 'budget', 'insurance', 'ppf', 'nps', 'retirement', 'paisa', 'nivesh'],
  },

  // ─── ASTROLOGER ──────────────────────────────────────────────────────────
  {
    id: 'astrologer_ai',
    name: 'Astrologer',
    path: 'Sidebar → Professionals → Astrologer',
    description: 'Warm guide to Indian astrology (Jyotish/Vedic), horoscopes, numerology and palmistry — for CULTURAL interest & ENTERTAINMENT. Explains rashi/nakshatra/kundli/gun-milan and gives positive sign-based readings. Responsible by design: framed as belief/entertainment (not science or certainty), never uses fear, never pushes paid remedies/gemstones, emphasises free will, and redirects real health/money/legal/relationship decisions to the right professional.',
    howToUse: "Open Sidebar → Professionals → Astrologer and ask: \"today's horoscope\", \"explain my rashi\", \"what is a kundli\", \"how does gun-milan work\".",
    relatedFeatures: ['professionals'],
    aiSurface: 'astrologer_ai',
    keywords: ['astrology', 'astrologer', 'horoscope', 'kundli', 'rashi', 'zodiac', 'jyotish', 'nakshatra', 'gun milan', 'numerology', 'palmistry'],
  },

  // ─── GOVT SCHEMES HELPER ─────────────────────────────────────────────────
  {
    id: 'govt_schemes_ai',
    name: 'Govt Schemes Helper',
    path: 'Sidebar → Professionals → Govt Schemes Helper',
    description: 'Makes Indian government schemes (central & state) easy to understand: find schemes by profile/need (farmer, student, woman, senior, entrepreneur, BPL), explain eligibility, benefits, documents and how to apply (official portal / CSC / local office). Anti-fraud built in: warns that real schemes never charge a fee or ask for OTP/PIN. Names/eligibility/amounts/portals change & vary by state — always verify on official portals (e.g. myscheme.gov.in) or at a CSC.',
    howToUse: 'Open Sidebar → Professionals → Govt Schemes Helper and ask: "schemes for farmers", "scholarships for students", "am I eligible for a housing scheme", "what documents do I need".',
    relatedFeatures: ['professionals'],
    aiSurface: 'govt_schemes_ai',
    keywords: ['scheme', 'yojana', 'government', 'sarkari', 'subsidy', 'scholarship', 'pension', 'pm kisan', 'ayushman', 'pmay', 'eligibility', 'apply', 'benefit'],
  },

  // ─── KISAN / AGRI ADVISOR ────────────────────────────────────────────────
  {
    id: 'kisan_ai',
    name: 'Kisan / Agri Advisor',
    path: 'Sidebar → Professionals → Kisan / Agri Advisor',
    description: 'Practical farming advisor for Indian farmers: crop & season choice (kharif/rabi/zaid), soil & fertiliser (Soil Health Card), pest/disease via Integrated Pest Management, irrigation & water-saving, post-harvest, and market/MSP/scheme awareness (PM-Kisan, KCC, eNAM, FPOs). Safety-first: confirm big decisions with the local KVK/agri officer & a soil test, follow pesticide labels (never banned chemicals), verify current MSP/scheme details officially; never promises yields/prices.',
    howToUse: 'Open Sidebar → Professionals → Kisan / Agri Advisor and ask: "which crop this season", "my crop has a pest", "read my Soil Health Card", "water-saving irrigation".',
    relatedFeatures: ['professionals', 'govt_schemes_ai'],
    aiSurface: 'kisan_ai',
    keywords: ['kisan', 'farmer', 'farming', 'agriculture', 'crop', 'kheti', 'fasal', 'soil', 'pest', 'irrigation', 'msp', 'mandi', 'kvk', 'fertiliser'],
  },

  // ─── NUTRITIONIST / DIET AI ──────────────────────────────────────────────
  {
    id: 'nutritionist_ai',
    name: 'Nutritionist / Diet AI',
    path: 'Sidebar → Professionals → Nutritionist / Diet AI',
    description: 'Friendly nutrition & diet guide for Indian users: balanced Indian plate & portions, sustainable goal-based eating (weight loss/gain, muscle, maintenance) using common foods (roti, rice, dal, sabzi, curd, paneer, eggs, millets), veg/vegan protein sources, micronutrient awareness (iron/calcium/B12/vitamin-D), hydration & gut health, and cutting added sugar/salt/ultra-processed food. Safety-first: general nutrition EDUCATION only, not medical nutrition therapy; refers clinical conditions (diabetes, kidney, thyroid, pregnancy, allergies, eating disorders) to a registered dietitian/doctor; no crash diets, detox fads or fabricated calorie numbers.',
    howToUse: 'Open Sidebar → Professionals → Nutritionist / Diet AI and ask: "make a balanced veg meal plan", "healthy ways to lose weight", "best protein for vegetarians", "how do I cut down sugar & junk food".',
    relatedFeatures: ['professionals', 'sda_chat'],
    aiSurface: 'nutritionist_ai',
    keywords: ['nutrition', 'nutritionist', 'diet', 'food', 'meal plan', 'weight loss', 'weight gain', 'protein', 'calories', 'healthy eating', 'khana', 'diet plan', 'sugar', 'vegetarian'],
  },

  // ─── WELLNESS / COUNSELLOR AI ────────────────────────────────────────────
  {
    id: 'wellness_ai',
    name: 'Wellness / Counsellor AI',
    path: 'Sidebar → Professionals → Wellness / Counsellor',
    description: 'Warm, non-judgemental emotional-wellness companion: listens & validates feelings, shares general coping & self-care (grounding/breathing for anxiety, sleep & routine for low mood, CBT-style thought reframing, stress/exam/work/relationship support), and encourages real-world & professional help while reducing stigma. Safety-first: an AI companion, NOT a therapist, NO diagnosis, NO medication advice; on any crisis/self-harm it shares India helplines (Tele-MANAS 14416 / 1-800-891-4416, KIRAN 1800-599-0019, emergency 112) and steers to immediate human help; never fabricates helplines or clinical claims.',
    howToUse: 'Open Sidebar → Professionals → Wellness / Counsellor and share how you feel: "I am feeling stressed", "help me calm down from anxiety", "how do I deal with low mood", "when should I see a counsellor". For medical/clinical questions use Doctor AI or a professional.',
    relatedFeatures: ['professionals', 'sda_chat'],
    aiSurface: 'wellness_ai',
    keywords: ['wellness', 'counsellor', 'counselor', 'mental health', 'stress', 'anxiety', 'depression', 'sad', 'low mood', 'therapy', 'emotional', 'support', 'mann', 'tension', 'help'],
  },

  // ─── FITNESS / PERSONAL TRAINER AI ───────────────────────────────────────
  {
    id: 'fitness_ai',
    name: 'Fitness / Personal Trainer AI',
    path: 'Sidebar → Professionals → Fitness / Personal Trainer',
    description: 'Encouraging personal-trainer & fitness coach: home/gym workout plans for goals (fat loss, muscle/strength, stamina, general fitness), exercise form & technique cues, warm-up/mobility/recovery & rest, cardio & steps, and habit/motivation help. Defers detailed diet to the Nutritionist AI. Safety-first: general fitness education, NOT medical/physiotherapy advice; advises medical clearance before a new programme (health condition, pregnancy, older, inactive), stop & see a doctor/physio for pain/injury; no crash regimes, overtraining, dehydration cutting, or anabolic/unproven supplements.',
    howToUse: 'Open Sidebar → Professionals → Fitness / Personal Trainer and ask: "beginner home workout plan", "plan to build muscle", "lose fat safely", "fix my squat form". For diet specifics use Nutritionist AI; for pain/injury see a doctor/physio.',
    relatedFeatures: ['professionals', 'nutritionist_ai', 'sda_chat'],
    aiSurface: 'fitness_ai',
    keywords: ['fitness', 'workout', 'exercise', 'gym', 'trainer', 'muscle', 'strength', 'fat loss', 'cardio', 'home workout', 'training', 'kasrat', 'vyayam', 'bodyweight'],
  },

  // ─── VETERINARY / PASHU ADVISOR AI ───────────────────────────────────────
  {
    id: 'vet_ai',
    name: 'Veterinary / Pashu Advisor AI',
    path: 'Sidebar → Professionals → Veterinary / Pashu Advisor',
    description: 'Practical animal-care advisor for Indian livestock farmers & pet owners: livestock husbandry (cattle, buffalo, goat, poultry — housing, feeding, milking hygiene, breeding basics, productivity), pet care (dogs, cats — feeding, grooming, exercise, training basics), prevention/biosecurity & vaccination/deworming AWARENESS, and recognising warning signs. Safety-first: NOT a veterinarian, NO diagnosis or prescription/doses; refers sick/injured animals to a licensed vet, takes bites/rabies & zoonoses (brucellosis, bird flu) seriously with urgent medical/vet care; no banned substances or growth hormones; never fabricates vaccines/doses/schedules.',
    howToUse: 'Open Sidebar → Professionals → Veterinary / Pashu Advisor and ask: "care for a dairy cow", "feeding for my dog", "my animal is off-feed", "why vaccination & deworming matter". For sick/injured animals or bites, see a vet/doctor.',
    relatedFeatures: ['professionals', 'kisan_ai', 'govt_schemes_ai'],
    aiSurface: 'vet_ai',
    keywords: ['vet', 'veterinary', 'pashu', 'animal', 'cattle', 'cow', 'buffalo', 'goat', 'poultry', 'dog', 'cat', 'pet', 'livestock', 'janwar', 'vaccination', 'rabies'],
  },

  // ─── PARENTING / CHILD-CARE AI ───────────────────────────────────────────
  {
    id: 'parenting_ai',
    name: 'Parenting / Child-Care AI',
    path: 'Sidebar → Professionals → Parenting / Child-Care',
    description: 'Warm parenting & child-development companion for Indian parents: development & milestones (as ranges), daily care & routines (sleep, toilet training, screen-time balance, study habits), positive discipline & tantrums/sibling conflict, emotional connection & teens, and home/online safety awareness. Safety-first: general parenting guidance, NOT medical advice; routes illness/fever/vaccination/growth & developmental worries to a paediatrician/Doctor AI and nutrition to the Nutritionist AI; never prescribes medicines/doses for children; rejects harsh/physical punishment; urges professional help for red flags (serious illness, possible delay, teen self-harm, abuse).',
    howToUse: 'Open Sidebar → Professionals → Parenting / Child-Care and ask: "is my child meeting milestones", "handle tantrums calmly", "build a bedtime routine", "support my teen during exams". For illness/medical concerns see a paediatrician/Doctor AI.',
    relatedFeatures: ['professionals', 'nutritionist_ai', 'wellness_ai', 'sda_chat'],
    aiSurface: 'parenting_ai',
    keywords: ['parenting', 'parent', 'child', 'baby', 'toddler', 'kids', 'child care', 'milestone', 'tantrum', 'discipline', 'teen', 'bachcha', 'parvarish', 'newborn'],
  },

  // ─── CYBER SAFETY / DIGITAL SURAKSHA AI ──────────────────────────────────
  {
    id: 'cybersafety_ai',
    name: 'Cyber Safety / Digital Suraksha AI',
    path: 'Sidebar → Professionals → Cyber Safety / Digital Suraksha',
    description: 'Practical digital-safety guide for everyday Indian users: recognising scams (UPI/OTP fraud, fake KYC/bank/electricity calls, "digital arrest"/police-impersonation, lottery/job/loan-app fraud, phishing, fake customer-care, QR-receive tricks, SIM-swap, sextortion), prevention (strong passwords, 2FA, safe UPI habits, device/SIM/privacy hygiene), victim recovery steps, and reporting via helpline 1930 & cybercrime.gov.in. Safety-first: NEVER asks for passwords/OTP/UPI PIN/card details and tells users no genuine party will; strictly DEFENSIVE (refuses to help hack/stalk/defraud); never fabricates helplines/laws or promises guaranteed recovery; urges calling 1930/the bank immediately for active fraud.',
    howToUse: 'Open Sidebar → Professionals → Cyber Safety / Digital Suraksha and ask: "is this message a scam", "keep my UPI & bank safe", "I have been scammed what do I do", "make my accounts secure". For active fraud/loss, call 1930 and your bank immediately and report at cybercrime.gov.in.',
    relatedFeatures: ['professionals', 'finance_ai', 'govt_schemes_ai'],
    aiSurface: 'cybersafety_ai',
    keywords: ['cyber', 'scam', 'fraud', 'safety', 'security', 'otp', 'upi', 'phishing', 'hack', 'digital arrest', 'kyc', 'online fraud', 'suraksha', 'thug', '1930', 'cybercrime'],
  },

  // ─── INSURANCE ADVISOR AI ────────────────────────────────────────────────
  {
    id: 'insurance_ai',
    name: 'Insurance Advisor AI',
    path: 'Sidebar → Professionals → Insurance Advisor',
    description: 'Honest insurance educator for Indian users: types of cover (term life, health/mediclaim & top-up, motor third-party vs comprehensive, personal accident, home, travel, PMFBY crop), choosing adequate cover, why term beats investment-linked plans for protection, policy terms (sum insured, deductible/co-pay, waiting periods, exclusions, no-claim bonus, free-look, portability), how claims work and why they get rejected, and avoiding mis-selling/fraud (verify on IRDAI, use free-look). Safety-first: general education, NOT personalised advice or a product recommendation; never pushes a product/commission; insists on truthful disclosure when buying (top cause of claim rejection); says terms/premiums change — verify wording and consult a licensed IRDAI advisor; never fabricates premiums/clauses.',
    howToUse: 'Open Sidebar → Professionals → Insurance Advisor and ask: "how much term cover do I need", "what to look for in a health policy", "why do claims get rejected", "term vs endowment". For scheme-based health cover (Ayushman Bharat) see Govt Schemes Helper; for a tailored decision consult an IRDAI advisor.',
    relatedFeatures: ['professionals', 'finance_ai', 'govt_schemes_ai'],
    aiSurface: 'insurance_ai',
    keywords: ['insurance', 'bima', 'term', 'life insurance', 'health insurance', 'mediclaim', 'policy', 'premium', 'claim', 'motor insurance', 'ulip', 'lic', 'cover', 'irdai'],
  },

  // ─── CHEF / RECIPE AI ────────────────────────────────────────────────────
  {
    id: 'chef_ai',
    name: 'Chef / Recipe AI',
    path: 'Sidebar → Professionals → Chef / Recipe AI',
    description: 'Friendly home-cooking companion for Indian kitchens: step-by-step recipes (regional Indian & world, veg/non-veg, street food & festive), cook-with-what-you-have suggestions & substitutions, technique (tadka, spice balance, gravy/dough/rice basics), fixing dishes (too salty/spicy/watery), quick/tiffin/budget/batch meals & leftovers, and adapting dishes (lighter, vegan, Jain no onion-garlic, milder/spicier). Safety-first: general cooking guidance, flags common allergens & safe food handling, defers medical/therapeutic diets to the Nutritionist AI; quantities/times are approximate (taste & adjust); no miracle health claims.',
    howToUse: 'Open Sidebar → Professionals → Chef / Recipe AI and ask: "what can I make with these ingredients", "quick 15-minute dinner", "my curry is too salty", "easy tiffin recipes". For diet/nutrition planning use the Nutritionist AI.',
    relatedFeatures: ['professionals', 'nutritionist_ai'],
    aiSurface: 'chef_ai',
    keywords: ['recipe', 'cook', 'cooking', 'chef', 'food', 'khana', 'recipe banao', 'kitchen', 'dish', 'curry', 'sabzi', 'tiffin', 'ingredients', 'meal'],
  },

  // ─── TRAVEL PLANNER AI ───────────────────────────────────────────────────
  {
    id: 'travel_ai',
    name: 'Travel Planner AI',
    path: 'Sidebar → Professionals → Travel Planner',
    description: 'Practical trip-planning companion for Indian travellers (domestic & international): day-by-day itineraries by duration/interests/season, budget breakdowns & money-saving tips, logistics (trains/IRCTC, flights, buses, local transport) & packing lists, international travel awareness (visa types, passport validity, travel insurance, currency, connectivity, etiquette), and safety/season/responsible-travel tips. Safety-first: general guidance NOT live booking data; fares/schedules/visa rules change — verify on official airline/railway/government/embassy sources; never asks for passport/card/OTP details, never books/pays; warns about travel scams; never fabricates live prices, exact visa fees, or guaranteed availability.',
    howToUse: 'Open Sidebar → Professionals → Travel Planner and ask: "plan a 5-day trip", "budget for a Goa trip", "best time & itinerary for Ladakh", "what do I need for international travel". Verify fares/visa rules officially before booking.',
    relatedFeatures: ['professionals', 'cybersafety_ai'],
    aiSurface: 'travel_ai',
    keywords: ['travel', 'trip', 'tour', 'itinerary', 'vacation', 'holiday', 'ghumna', 'yatra', 'flight', 'train', 'visa', 'passport', 'tourism', 'destination', 'budget trip'],
  },

  // ─── VASTU CONSULTANT AI ─────────────────────────────────────────────────
  {
    id: 'vastu_ai',
    name: 'Vastu Consultant AI',
    path: 'Sidebar → Professionals → Vastu Consultant',
    description: 'Respectful guide to Vastu Shastra (traditional Indian architecture/spatial arrangement): directions (the eight dishas) and suggested placement of entrance, kitchen, bedroom, pooja room, study, toilets, water & staircase; practical harmony framed as natural light, ventilation & de-cluttering; and gentle, no-cost remedies for spaces that can’t change. Safety-first: explicitly cultural/traditional belief, NOT science — no guarantees, NO fear-mongering, NO paid yantras/expensive remedies/demolition; real-world priorities (safety, building bye-laws, structural soundness, budget) and a licensed architect/engineer come first; inclusive of those who don’t follow Vastu; never fabricates rules.',
    howToUse: 'Open Sidebar → Professionals → Vastu Consultant and ask: "Vastu tips for my entrance", "best direction for kitchen & bedroom", "Vastu for a rented flat", "simple ways to make my space positive". For actual construction consult a licensed architect/engineer.',
    relatedFeatures: ['professionals', 'astrologer_ai'],
    aiSurface: 'vastu_ai',
    keywords: ['vastu', 'vaastu', 'vastu shastra', 'direction', 'disha', 'home', 'ghar', 'kitchen', 'pooja room', 'entrance', 'remedy', 'upay', 'office vastu', 'rashi ghar'],
  },

  // ─── YOGA & MEDITATION AI ────────────────────────────────────────────────
  {
    id: 'yoga_ai',
    name: 'Yoga & Meditation AI',
    path: 'Sidebar → Professionals → Yoga & Meditation',
    description: 'Calm guide to yoga, pranayama & meditation: beginner asana sequences & Surya Namaskar with alignment cues and easier variations, gentle breathwork (deep breathing, Anulom Vilom, Bhramari), meditation/mindfulness/mantra for focus-calm-sleep, and short routines for stress/energy/desk relief. Safety-first: general practice guidance, NOT medical/therapeutic advice; advises doctor clearance for health conditions/pregnancy/elderly/injury and learning advanced asana/pranayama from a qualified teacher; never push through pain; avoids risky inversions for beginners; makes no medical-cure claims. Routes nutrition to Nutritionist AI and emotional crises to Wellness AI.',
    howToUse: 'Open Sidebar → Professionals → Yoga & Meditation and ask: "15-minute beginner routine", "breathing to reduce stress", "start a meditation habit", "desk stretches for back & neck". Check with a doctor first if you have any health condition.',
    relatedFeatures: ['professionals', 'fitness_ai', 'wellness_ai'],
    aiSurface: 'yoga_ai',
    keywords: ['yoga', 'meditation', 'pranayama', 'asana', 'dhyan', 'breathing', 'mindfulness', 'surya namaskar', 'anulom vilom', 'stretch', 'relax', 'yog', 'meditate', 'om'],
  },

  // ─── SPOKEN ENGLISH / LANGUAGE TUTOR AI ──────────────────────────────────
  {
    id: 'english_ai',
    name: 'Spoken English / Language Tutor AI',
    path: 'Sidebar → Professionals → Spoken English / Tutor',
    description: 'Patient spoken-English & language coach for Indian learners (beginner to advanced): conversation practice & fluency building, gentle grammar & vocabulary correction with reasons, writing help (emails/applications/essays in the learner’s own voice), interview & workplace English with mock interviews, and IELTS/TOEFL-style exam practice & strategies. Encouraging, never shames mistakes; meets learners at their level (uses a Hindi/regional word when it helps). Honesty: a tutor not an exam authority — verify official exam formats/rules with the exam body; no fake "fluent fast" claims or fabricated scores; constructive, accurate feedback (won’t approve wrong English to be nice).',
    howToUse: 'Open Sidebar → Professionals → Spoken English / Tutor and ask: "let’s practise a conversation", "correct my sentences and explain", "help me write a formal email", "run a mock interview". For official exam rules check the exam body’s website.',
    relatedFeatures: ['professionals', 'teacher_ai', 'mentor_ai'],
    aiSurface: 'english_ai',
    keywords: ['english', 'spoken english', 'grammar', 'vocabulary', 'fluency', 'language', 'tutor', 'ielts', 'toefl', 'interview english', 'angrezi', 'speaking', 'writing', 'translate'],
  },

  // ─── RESUME & JOB-APPLICATION AI ─────────────────────────────────────────
  {
    id: 'resume_ai',
    name: 'Resume & Job-Application AI',
    path: 'Sidebar → Professionals → Resume & Job Application',
    description: 'Career-documents specialist for Indian job seekers (freshers to experienced): resume/CV structure & strong achievement bullet points (action verb + measurable impact), ATS-friendly formatting & keyword matching, tailored cover letters & application emails, LinkedIn headline/About, and application strategy (reading a JD, transferable skills, gaps). Works on the user’s OWN real content. Safety-first: NEVER fabricates qualifications/experience/dates/numbers (lying risks the job); helps phrase gaps/career-changes honestly; does not guarantee interviews/jobs/salaries; warns about job scams (no genuine employer asks for money/OTP/bank details — see Cyber Safety AI); follow each employer’s official instructions.',
    howToUse: 'Open Sidebar → Professionals → Resume & Job Application and ask: "review & improve my resume", "make it ATS-friendly for this job", "write a cover letter for this role", "turn my duties into strong bullet points". Paste your real experience or current resume + the target job.',
    relatedFeatures: ['professionals', 'mentor_ai', 'english_ai', 'cybersafety_ai'],
    aiSurface: 'resume_ai',
    keywords: ['resume', 'cv', 'biodata', 'cover letter', 'job application', 'ats', 'linkedin', 'job', 'interview', 'naukri', 'apply', 'fresher', 'curriculum vitae', 'bullet points'],
  },

  // ─── GARDENING / HOME-PLANTS AI ──────────────────────────────────────────
  {
    id: 'gardening_ai',
    name: 'Gardening / Home-Plants AI',
    path: 'Sidebar → Professionals → Gardening / Home-Plants',
    description: 'Friendly home-gardening & houseplant companion for Indian plant lovers (balcony, terrace, kitchen garden, indoor): plant care (watering, light, soil/potting mix, repotting) for common Indian houseplants, kitchen gardens (herbs & veggies in pots by season), diagnosing problems (yellow leaves, drooping, leaf spots, pests like mealybugs/aphids) with organic-first fixes, and soil/compost/feeding. Defers commercial farming to the Kisan AI. Safety-first: general guidance (needs vary by variety/climate — observe & confirm with a nursery); prefers organic/least-toxic methods, label safety for any chemical away from kids/pets/edibles; flags toxic houseplants & washing home-grown edibles; never fabricates species/doses/guaranteed results.',
    howToUse: 'Open Sidebar → Professionals → Gardening / Home-Plants and ask: "why are my leaves yellow", "easy plants for low light", "start a balcony kitchen garden", "get rid of mealybugs". For commercial/field farming use the Kisan / Agri Advisor.',
    relatedFeatures: ['professionals', 'kisan_ai'],
    aiSurface: 'gardening_ai',
    keywords: ['gardening', 'garden', 'plant', 'plants', 'houseplant', 'paudha', 'bagicha', 'kitchen garden', 'balcony', 'indoor plants', 'pot', 'soil', 'watering', 'terrace garden'],
  },

  // ─── PHARMACIST / MEDICINE-INFO AI ───────────────────────────────────────
  {
    id: 'pharmacist_ai',
    name: 'Pharmacist / Medicine-Info AI',
    path: 'Sidebar → Professionals → Pharmacist / Medicine-Info',
    description: 'Careful medicine-INFORMATION assistant for Indian users: explains a medicine’s general purpose/class, safe-use practices (reading the label/leaflet, finishing antibiotic courses, storage, expiry, not sharing prescription meds), side-effect & interaction awareness, generic vs brand & Jan Aushadhi, and responsible antibiotic use/resistance. Safety-first (HEALTH): explicitly NOT a doctor/dispensing pharmacist; NEVER diagnoses, prescribes, gives a dose, or tells anyone to start/stop/combine a medicine — redirects every personal question to a doctor/registered pharmacist; flags emergencies/overdose to call 112; special caution for pregnancy/children/elderly; never fabricates drug names/doses/interactions; discourages buying prescription (Schedule H) meds without a prescription. May point to Doctor AI for clinical questions (also not a substitute for an in-person doctor).',
    howToUse: 'Open Sidebar → Professionals → Pharmacist / Medicine-Info and ask: "what is this medicine generally used for", "how to store & use medicines safely", "generic vs brand", "why antibiotic misuse is dangerous". For what to take/dose or any personal symptom, consult a doctor/pharmacist; emergencies → 112.',
    relatedFeatures: ['professionals', 'sda_chat', 'nutritionist_ai'],
    aiSurface: 'pharmacist_ai',
    keywords: ['medicine', 'pharmacist', 'drug', 'tablet', 'dawai', 'pharmacy', 'side effect', 'antibiotic', 'generic', 'jan aushadhi', 'prescription', 'dose', 'medication', 'chemist'],
  },

  // ─── SMALL-BUSINESS / STARTUP ADVISOR AI ─────────────────────────────────
  {
    id: 'business_ai',
    name: 'Small-Business / Startup Advisor AI',
    path: 'Sidebar → Professionals → Small-Business / Startup',
    description: 'Practical small-business & startup mentor for Indian entrepreneurs (kirana to tech): idea refinement & cheap validation + lean one-page plan, starting-up awareness (proprietorship/LLP/Pvt Ltd, Udyam/MSME, GST basics, separate business account), pricing/margins/break-even & cash-flow discipline, low-cost marketing (Google Business Profile, WhatsApp Business, social, word-of-mouth) & retention, growth/operations, and funding awareness (bootstrapping, bank/MSME/MUDRA loans, schemes, realistic VC view). Safety-first: general guidance NOT legal/tax/accounting/investment advice — routes tax/GST to CA AI, incorporation/contracts to a lawyer/CS, scheme specifics to Govt Schemes Helper; realistic (no guaranteed-profit/get-rich hype); warns about pay-to-join/MLM & fake investor/loan scams (Cyber Safety AI); never fabricates fees/thresholds/amounts.',
    howToUse: 'Open Sidebar → Professionals → Small-Business / Startup and ask: "validate my business idea", "how should I price", "low-cost ways to get customers", "how do I register my business". For tax/GST use CA AI, for legal use a lawyer/CS, for scheme specifics the Govt Schemes Helper.',
    relatedFeatures: ['professionals', 'accountant_ai', 'finance_ai', 'govt_schemes_ai'],
    aiSurface: 'business_ai',
    keywords: ['business', 'startup', 'shop', 'dukaan', 'entrepreneur', 'small business', 'msme', 'udyam', 'company', 'marketing', 'pricing', 'funding', 'loan', 'vyapar', 'idea'],
  },

  // ─── HOME REPAIR / HANDYMAN AI ───────────────────────────────────────────
  {
    id: 'homerepair_ai',
    name: 'Home Repair / Handyman AI',
    path: 'Sidebar → Professionals → Home Repair / Handyman',
    description: 'Practical home-maintenance helper for Indian households: simple SAFE DIY fixes (dripping tap washer, blocked drain, running flush, tripped MCB reset, loose handle/hinge, bulb/tubelight), diagnosing a problem so you can describe it to a technician (and avoid overcharging), and preventive maintenance (RO filters, AC service, monsoon/seepage prep, tools). Safety-first (can be lethal): NOT a licensed electrician/plumber/gas technician — always switch off power/water first; never guides live-wire/rewiring/switchboard work or gas pipe/regulator DIY; for sparking/burning smell → mains off + licensed electrician; gas smell → no switches/flames, turn regulator off, ventilate, leave, call the gas agency; flags water+electricity/height/structural jobs to a pro; never fabricates wiring colours/ratings/steps; emergencies → 112.',
    howToUse: 'Open Sidebar → Professionals → Home Repair / Handyman and ask: "my tap is dripping", "clear a blocked drain safely", "my MCB keeps tripping", "monsoon maintenance checklist". For electrical faults, gas smells or anything risky, call a qualified professional.',
    relatedFeatures: ['professionals', 'cybersafety_ai'],
    aiSurface: 'homerepair_ai',
    keywords: ['repair', 'home repair', 'handyman', 'plumber', 'electrician', 'tap', 'leak', 'mcb', 'fan', 'gas', 'lpg', 'maintenance', 'fix', 'mistri', 'drain'],
  },

  // ─── REAL-ESTATE / PROPERTY ADVISOR AI ───────────────────────────────────
  {
    id: 'realestate_ai',
    name: 'Real-Estate / Property Advisor AI',
    path: 'Sidebar → Professionals → Real-Estate / Property',
    description: 'Honest property guide for Indian buyers, sellers, tenants & landlords: buy vs rent (realistic, no hype), buying due diligence (clear/marketable title, encumbrance certificate, approved plan & occupancy/completion certificate, RERA registration, builder track record, lawyer vetting), home-loan basics (eligibility, down payment, EMI, fixed vs floating, full cost of ownership), renting (agreements, deposit, registration, tenant/landlord rights basics), stamp duty/registration/brokerage awareness, and fraud avoidance. Safety-first: general education NOT legal/financial/tax/valuation advice — routes tax to CA AI, loan/budget to Finance AI, legal to Lawyer AI; verify title/documents with a property lawyer and project status on the state RERA portal; stamp duty/rules vary by state & change; no guaranteed returns; warns about advance-fee/fake-listing scams (Cyber Safety AI); never fabricates prices/rates/thresholds.',
    howToUse: 'Open Sidebar → Professionals → Real-Estate / Property and ask: "should I buy or rent", "what to check before buying a flat", "how does a home loan & EMI work", "what should a rent agreement include". Get documents vetted by a property lawyer and verify on your state RERA portal.',
    relatedFeatures: ['professionals', 'lawyer_ai', 'finance_ai', 'accountant_ai', 'cybersafety_ai'],
    aiSurface: 'realestate_ai',
    keywords: ['property', 'real estate', 'house', 'flat', 'home loan', 'rent', 'buy', 'rera', 'makaan', 'plot', 'registry', 'stamp duty', 'landlord', 'tenant', 'jameen'],
  },

  // ─── DRIVING / RTO & LICENCE AI ──────────────────────────────────────────
  {
    id: 'driving_ai',
    name: 'Driving / RTO & Licence AI',
    path: 'Sidebar → Professionals → Driving / RTO & Licence',
    description: 'Practical guide to driving, road safety & RTO/vehicle paperwork for Indian users: Learner & Driving Licence process (eligibility, documents, LL/driving tests, renewal via Parivahan/Sarathi), vehicle documents (RC, third-party insurance, PUC, road tax, fitness, what to carry), road rules & safety (helmet/seatbelt, speed, signs, no drink-driving/phone, defensive driving), beginner learning guidance, and e-challans. Safety-first: general INFORMATION not official confirmation — rules/fees/age limits vary by state & change, so verify & apply on the official Parivahan/state RTO portal; promotes lawful safe driving; discourages touts/bribes (licence "without a test" is illegal/unsafe); warns about fake RTO/challan sites & OTP scams (Cyber Safety AI); never fabricates fees/rules; never helps get a licence dishonestly or evade penalties.',
    howToUse: 'Open Sidebar → Professionals → Driving / RTO & Licence and ask: "how do I get a driving licence", "documents to carry while driving", "important road rules & signs", "check & pay an e-challan". Apply & verify on the official Parivahan / state RTO portal.',
    relatedFeatures: ['professionals', 'cybersafety_ai', 'govt_schemes_ai'],
    aiSurface: 'driving_ai',
    keywords: ['driving', 'licence', 'license', 'rto', 'dl', 'learner licence', 'parivahan', 'rc', 'insurance', 'puc', 'challan', 'car', 'bike', 'road rules', 'gaadi'],
  },

  // ─── PET-CARE / DOG-TRAINING AI ──────────────────────────────────────────
  {
    id: 'petcare_ai',
    name: 'Pet-Care / Dog-Training AI',
    path: 'Sidebar → Professionals → Pet-Care / Dog-Training',
    description: 'Friendly positive companion for Indian pet parents (mainly dogs & cats): reward-based training (basic commands, house/potty & crate training, leash manners, stopping jumping/pulling/barking), behaviour understanding & humane fixes (fear/boredom/anxiety/socialisation, stress & aggression signals), daily care (exercise, enrichment, grooming, dental/nail basics, hot-climate paw/hydration safety), general feeding & foods toxic to pets to avoid, new-pet/puppy & socialisation, and responsible community-animal guidance. Safety-first: NOT veterinary advice — routes illness/injury/vaccines/parasites/sudden behaviour change to a vet (Veterinary / Pashu Advisor AI for awareness; real diagnosis needs an in-person vet); never gives medicine names/doses; uses ONLY humane positive reinforcement (never hitting/choke/shock/prong collars/fear/punishment); takes bites/rabies seriously (urgent medical care); never fabricates breed facts/training guarantees/medical claims.',
    howToUse: 'Open Sidebar → Professionals → Pet-Care / Dog-Training and ask: "potty-train my puppy", "my dog barks/chews too much", "teach basic commands with rewards", "foods unsafe for my pet". For health issues see a vet (or the Veterinary / Pashu Advisor AI for awareness).',
    relatedFeatures: ['professionals', 'vet_ai'],
    aiSurface: 'petcare_ai',
    keywords: ['pet', 'dog', 'cat', 'puppy', 'kitten', 'training', 'dog training', 'behaviour', 'barking', 'potty training', 'kutta', 'billi', 'leash', 'pet care', 'grooming'],
  },

  // ─── BEAUTY / SKINCARE & GROOMING AI ─────────────────────────────────────
  {
    id: 'beauty_ai',
    name: 'Beauty / Skincare & Grooming AI',
    path: 'Sidebar → Professionals → Beauty / Skincare & Grooming',
    description: 'Sensible guide to skincare, haircare & everyday grooming for all genders: simple routine (cleanse, moisturise, daily SPF sunscreen), skin types & ingredient education (niacinamide, salicylic/glycolic acid, retinoids basics, vitamin C), common concerns (oiliness, dryness, dullness, mild acne/blackheads, tan), haircare & dandruff, shaving/beard & nail/body grooming, and smart habits (patch-testing, one product at a time, not over-exfoliating). Safety-first: general cosmetic guidance NOT medical advice — routes acne-that-scars/persistent rashes/sudden hair loss/severe pigmentation/allergic reactions to a dermatologist; rejects fairness/whitening promises & steroid-cream misuse and risky DIY hacks (lemon/toothpaste/peels); body-positive (healthy not "fair"); never fabricates ingredient/miracle claims; results take time & vary.',
    howToUse: 'Open Sidebar → Professionals → Beauty / Skincare & Grooming and ask: "build a simple skincare routine", "deal with oily skin/acne", "help with dandruff & hair care", "shaving & beard-care tips". For skin/hair conditions see a dermatologist.',
    relatedFeatures: ['professionals', 'wellness_ai', 'nutritionist_ai'],
    aiSurface: 'beauty_ai',
    keywords: ['skincare', 'skin', 'beauty', 'grooming', 'hair', 'acne', 'pimple', 'sunscreen', 'dandruff', 'shaving', 'beard', 'makeup', 'glow', 'twacha', 'baal'],
  },

  // ─── MUSIC / INSTRUMENT LEARNING AI ──────────────────────────────────────
  {
    id: 'music_ai',
    name: 'Music / Instrument Learning AI',
    path: 'Sidebar → Professionals → Music / Instrument Learning',
    description: 'Encouraging music teacher for Indian learners of all levels & styles (Indian classical, film/devotional, Western): starting instruments (guitar, keyboard/piano, harmonium, tabla, flute, ukulele — posture, first chords/notes/bols, tuning), vocals & riyaaz (warm-ups, breathing, sur/pitch), music theory (notes, scales, chords, rhythm/taal, sargam/swaras, basic notation), Indian classical concepts (raga/taal/sargam), and structured practice routines & ear training. Honesty/safety: real skill needs consistent practice (no "master it in a week"); recommends a qualified guru/teacher for serious classical/advanced technique; warns against vocal strain/playing through pain; respects copyright (helps learn, no wholesale reproduction of copyrighted lyrics/sheet music); never fabricates theory or official exam (Trinity/ABRSM/Prayag Sangit) rules — confirm with the official body.',
    howToUse: 'Open Sidebar → Professionals → Music / Instrument Learning and ask: "start learning guitar", "singing basics & riyaaz", "explain chords/sargam simply", "make a daily practice routine". For serious classical or graded exams, learn from a guru and confirm syllabi officially.',
    relatedFeatures: ['professionals', 'teacher_ai'],
    aiSurface: 'music_ai',
    keywords: ['music', 'instrument', 'guitar', 'keyboard', 'piano', 'harmonium', 'tabla', 'singing', 'vocal', 'riyaaz', 'sargam', 'raag', 'sangeet', 'gaana', 'taal'],
  },

  // ─── SPORTS & CRICKET COACHING AI ────────────────────────────────────────
  {
    id: 'sports_ai',
    name: 'Sports & Cricket Coaching AI',
    path: 'Sidebar → Professionals → Sports & Cricket Coaching',
    description: 'Encouraging sports coach with cricket depth (batting: stance/grip/footwork/shot selection/playing spin & pace; bowling: run-up/action/line & length/spin & seam; fielding/keeping; strategy) plus general coaching for football, badminton, kabaddi, athletics & more — technique, structured & solo/at-home drills, sport-specific conditioning (agility/speed/stamina/strength/flexibility, warm-up/cool-down), and mindset (pressure, focus, consistency). Safety-first: coaching guidance NOT medical/physio advice — always warm up & use protective gear, never play through sharp pain (rest + doctor/physio), age-appropriate workloads (e.g. limit young fast-bowling overs), learn high-load techniques under a qualified coach; routes gym/strength to Fitness AI and diet to Nutritionist AI; realistic (no "become a pro fast"); never fabricates official rules/records/selection — confirm with the association.',
    howToUse: 'Open Sidebar → Professionals → Sports & Cricket Coaching and ask: "improve my batting technique", "bowling drills for line & length", "solo practice drills at home", "sport fitness & agility plan". For injuries see a doctor/physio; for serious growth join a coach/academy.',
    relatedFeatures: ['professionals', 'fitness_ai', 'nutritionist_ai'],
    aiSurface: 'sports_ai',
    keywords: ['sports', 'cricket', 'batting', 'bowling', 'fielding', 'football', 'badminton', 'kabaddi', 'athletics', 'coach', 'training', 'khel', 'practice', 'fitness', 'drills'],
  },

  // ─── PHOTOGRAPHY & VIDEOGRAPHY AI ────────────────────────────────────────
  {
    id: 'photography_ai',
    name: 'Photography & Videography AI',
    path: 'Sidebar → Professionals → Photography & Videography',
    description: 'Practical mentor for Indian photographers & videographers (phone & camera, hobby to pro): camera/phone basics (exposure triangle — aperture/shutter/ISO, focus, white balance, lenses, smartphone pro mode), composition & light (rule of thirds, leading lines, framing, golden hour), genres (portrait, landscape/travel, events/weddings, product/food, street), video & reels (stability, framing, audio, lighting, shot types), editing workflow (Lightroom/Snapseed; natural look), and gear/going-pro (budget buying, portfolio, pricing, client comms, backups). Honesty/safety: skill grows with practice (gear alone doesn’t make great photos); settings are scene-dependent starting points; respect privacy/consent (candid/street/children), no-photography areas, copyright, and personal safety while shooting; client work needs permissions/contracts (Lawyer AI) & backups; never fabricates specs/prices or guarantees income.',
    howToUse: 'Open Sidebar → Professionals → Photography & Videography and ask: "explain aperture/shutter/ISO", "composition tips", "smartphone & reels tips", "how to start as a paid photographer". For client contracts use the Lawyer AI.',
    relatedFeatures: ['professionals', 'business_ai', 'lawyer_ai'],
    aiSurface: 'photography_ai',
    keywords: ['photography', 'photo', 'camera', 'videography', 'video', 'reels', 'editing', 'lightroom', 'composition', 'exposure', 'wedding photography', 'photoshoot', 'dslr', 'mobile photography'],
  },

  // ─── PUBLIC SPEAKING & COMMUNICATION AI ──────────────────────────────────
  {
    id: 'speaking_ai',
    name: 'Public Speaking & Communication AI',
    path: 'Sidebar → Professionals → Public Speaking & Communication',
    description: 'Supportive coach for confident, clear communication in any language: overcoming stage fright/nervousness (preparation, breathing, reframing, practice), structuring speeches/presentations (hook → key points → strong close, storytelling, simple slides), delivery (voice pace/pauses/clarity, body language, reducing filler words, audience engagement), everyday communication (speaking up in meetings/GDs, introductions, assertive-but-polite, active listening), and specific situations (interview/pitch delivery, impromptu, debates). Honesty/limits: coaching not overnight fix — confidence comes from preparation & practice; gives kind specific feedback on the user’s OWN voice; never fabricates facts/quotes/stats for a speech; routes language/grammar to Spoken English / Tutor AI, interview content/resume to Resume AI, and severe disabling speech anxiety/disorder (significant stammering) to a professional (speech therapist/counsellor).',
    howToUse: 'Open Sidebar → Professionals → Public Speaking & Communication and ask: "overcome stage fright", "structure a 5-minute speech", "improve my voice & body language", "speak up confidently in meetings/GDs". For grammar use English Tutor AI; for resume/interview content use Resume AI.',
    relatedFeatures: ['professionals', 'english_ai', 'resume_ai', 'mentor_ai'],
    aiSurface: 'speaking_ai',
    keywords: ['public speaking', 'speech', 'communication', 'presentation', 'stage fright', 'confidence', 'gd', 'group discussion', 'speaking', 'bolna', 'aatmvishwas', 'interview', 'voice', 'debate'],
  },

  // ─── EVENT & WEDDING PLANNER AI ──────────────────────────────────────────
  {
    id: 'events_ai',
    name: 'Event & Wedding Planner AI',
    path: 'Sidebar → Professionals → Event & Wedding Planner',
    description: 'Practical, calming planner for Indian weddings, parties & functions (engagements, birthdays, anniversaries, poojas, corporate/community): step-by-step plans & timelines (months-ahead to day-of schedule) and checklists, realistic budgeting & spend tracking, Indian-wedding functions awareness (haldi/mehndi/sangeet/baraat/pheras/reception — general, customs vary by community/religion), vendor selection & coordination (venue, caterer, decor, photographer→Photography AI; quotes, written terms), and guests/logistics/themes. Safety-first: planning guidance NOT legal/financial/contractual advice — routes contracts/disputes to Lawyer AI and big budget decisions to Finance AI; get vendor terms/deliverables/refund policy in writing & pay via traceable channels; warns about advance-fee/fake-vendor scams (Cyber Safety AI); minds crowd/fire/food safety & local permissions; inclusive & respectful of all communities (asks, never assumes); never fabricates vendor prices or guarantees outcomes.',
    howToUse: 'Open Sidebar → Professionals → Event & Wedding Planner and ask: "plan a timeline for my wedding", "help me budget", "what to ask caterers & decorators", "a day-of schedule & checklist". For contracts use the Lawyer AI; for budgets the Finance AI.',
    relatedFeatures: ['professionals', 'photography_ai', 'lawyer_ai', 'finance_ai', 'chef_ai'],
    aiSurface: 'events_ai',
    keywords: ['event', 'wedding', 'shaadi', 'planner', 'party', 'function', 'budget', 'venue', 'catering', 'decor', 'birthday', 'sangeet', 'guest list', 'aayojan', 'celebration'],
  },

  // ─── ELDER-CARE / SENIOR SUPPORT AI ──────────────────────────────────────
  {
    id: 'eldercare_ai',
    name: 'Elder-Care / Senior Support AI',
    path: 'Sidebar → Professionals → Elder-Care / Senior Support',
    description: 'Warm, respectful companion for Indian families caring for elderly relatives (and seniors themselves): daily care & routine (nutrition→Nutritionist AI, hydration, sleep, hygiene, safe activity), home safety & fall prevention (lighting, grab bars, emergency plan), emotional wellbeing & loneliness (connection, hobbies, watching for depression), medication ORGANISATION only (pill organisers, reminders, up-to-date list — never what/how-much), caregiver support (avoiding burnout, sharing responsibilities, when to get an attendant/day-care/professional care), and senior finance/schemes (→ Govt Schemes Helper) & scam protection (→ Cyber Safety AI). Safety-first (vulnerable people): care/wellbeing guidance NOT medical advice — for illness, falls with injury, confusion, chest pain/breathing trouble, stroke (FAST) or any emergency seek medical help immediately/call 112; never gives medicine names/doses; watches for red flags (sudden confusion, self-neglect, abuse); respects the elder’s dignity, autonomy & consent; never fabricates medical/scheme facts.',
    howToUse: 'Open Sidebar → Professionals → Elder-Care / Senior Support and ask: "make the home safer to prevent falls", "a gentle daily routine for my parent", "help with loneliness & low mood", "avoid caregiver burnout". For health concerns see a doctor / Doctor AI; emergencies → 112.',
    relatedFeatures: ['professionals', 'sda_chat', 'nutritionist_ai', 'wellness_ai', 'govt_schemes_ai'],
    aiSurface: 'eldercare_ai',
    keywords: ['elder care', 'elderly', 'senior', 'old age', 'parents', 'caregiver', 'budhe', 'maa baap', 'fall prevention', 'dementia', 'loneliness', 'pension', 'buzurg', 'care'],
  },

  // ─── INTERIOR DESIGN & HOME-DECOR AI ─────────────────────────────────────
  {
    id: 'interior_ai',
    name: 'Interior Design & Home-Decor AI',
    path: 'Sidebar → Professionals → Interior Design & Home-Decor',
    description: 'Practical, creative guide to decorating & organising Indian homes on any budget (rented or owned, small flats to houses): space planning (furniture flow, making small/rented spaces feel bigger, multi-use zoning), colour & lighting (palettes, accent walls, layered light & mood), affordable decor & DIY (cushions/curtains/rugs/plants→Gardening AI/art/lighting, upcycling), storage & decluttering, and room-by-room ideas (living, bedroom, kitchen, study/WFH, kids, balcony, pooja space). Safety-first: decor/design IDEAS NOT structural/electrical/architectural advice — walls/load-bearing/false ceilings/electrical/plumbing need a qualified architect/engineer/licensed tradesperson (Home Repair AI for safe DIY; never DIY electrical/gas/structural); rented homes → reversible, landlord-friendly changes (check the agreement); Vastu placement → Vastu AI; taste is personal (options not rules); never fabricates prices/brand claims or guarantees outcomes.',
    howToUse: 'Open Sidebar → Professionals → Interior Design & Home-Decor and ask: "make my small room feel bigger", "suggest a colour palette", "budget decor for my living room", "smart storage & decluttering tips". For structural/electrical work hire a qualified professional; for Vastu placement use the Vastu AI.',
    relatedFeatures: ['professionals', 'homerepair_ai', 'gardening_ai', 'vastu_ai'],
    aiSurface: 'interior_ai',
    keywords: ['interior', 'interior design', 'decor', 'home decor', 'decorate', 'furniture', 'colour', 'paint', 'storage', 'declutter', 'room', 'ghar sajawat', 'styling', 'small space'],
  },

  // ─── STUDY-ABROAD & EDUCATION CONSULTANT AI ──────────────────────────────
  {
    id: 'studyabroad_ai',
    name: 'Study-Abroad & Education Consultant AI',
    path: 'Sidebar → Professionals → Study-Abroad & Education',
    description: 'Honest guide for Indian students planning higher education abroad or in India: course/country/university choice (fit over rankings; US/UK/Canada/Australia/Germany & strong Indian options), exams (IELTS/TOEFL/PTE, GRE/GMAT, SAT — which & prep strategy), applications (timelines, shortlisting, SOP/personal statement & LOR guidance on the student’s OWN writing, CV→Resume AI), scholarships & funding (finding awards, education-loan basics→Finance AI, total cost & budgeting, Indian schemes→Govt Schemes Helper), and general student-visa awareness. Safety-first: general guidance NOT official admissions/immigration advice — deadlines/fees/eligibility/visa & post-study-work rules change & vary, always verify on official university & government/embassy sites before deciding/paying; never writes a fake SOP or fabricates experiences/grades (misrepresentation → rejection/revocation); warns about dishonest agents & "guaranteed admission/visa"/pay-for-seat scams (Cyber Safety AI), prefers official channels; realistic (no admission/visa/job guarantees); never fabricates fees/scholarship amounts/rankings/visa rules.',
    howToUse: 'Open Sidebar → Professionals → Study-Abroad & Education and ask: "help me choose a course & country", "which exams & how to prep", "guide me on my SOP", "scholarships & education-loan basics". Verify deadlines/fees/visa rules on official sites; use Finance AI for loans and English Tutor AI for exam-language prep.',
    relatedFeatures: ['professionals', 'mentor_ai', 'english_ai', 'resume_ai', 'finance_ai'],
    aiSurface: 'studyabroad_ai',
    keywords: ['study abroad', 'education', 'university', 'college', 'masters', 'mba', 'ielts', 'gre', 'gmat', 'sop', 'scholarship', 'student visa', 'foreign study', 'admission', 'videsh padhai'],
  },

  // ─── DISABILITY & ACCESSIBILITY SUPPORT AI ───────────────────────────────
  {
    id: 'disability_ai',
    name: 'Disability & Accessibility Support AI',
    path: 'Sidebar → Professionals → Disability & Accessibility Support',
    description: 'Respectful, empowering companion for persons with disabilities (PwD) in India & their families/caregivers: rights & entitlements awareness (RPwD Act 2016 concepts — dignity, non-discrimination, reasonable accommodation, reservation; UDID/disability certificate), schemes & benefits (scholarships, pensions, ADIP aids/appliances, travel/tax concessions — specifics→Govt Schemes Helper & official portals), assistive technology & accessibility (screen readers, captions, hearing/mobility aids, AAC, built-in phone/computer accessibility), daily living & inclusion (independence, accessible education/workplace accommodations as rights), and caregiver/emotional support (NGOs, peer communities, Wellness AI). Safety-first: general information & support NOT medical/legal/official advice — medical/therapy→doctor/specialist, legal→Lawyer AI, schemes→Govt Schemes Helper, verify on official sources (rules vary by state & change); respectful person-centred language ("nothing about us without us"), inclusive of all disabilities; warns about bribe/OTP scams around certificates/benefits (Cyber Safety AI); never fabricates laws/scheme amounts/eligibility/medical claims; emergencies→112, distress→Wellness AI.',
    howToUse: 'Open Sidebar → Professionals → Disability & Accessibility Support and ask: "my rights under the RPwD Act", "schemes & benefits I may be eligible for", "assistive technology for my needs", "accommodations at school/work". Verify schemes/rights officially; use Govt Schemes Helper, Lawyer AI, and a doctor/specialist as needed.',
    relatedFeatures: ['professionals', 'govt_schemes_ai', 'lawyer_ai', 'eldercare_ai', 'wellness_ai'],
    aiSurface: 'disability_ai',
    keywords: ['disability', 'disabled', 'pwd', 'divyang', 'accessibility', 'rpwd', 'udid', 'wheelchair', 'blind', 'deaf', 'special needs', 'assistive', 'viklang', 'inclusion'],
  },

  // ─── FASHION & PERSONAL STYLING AI ───────────────────────────────────────
  {
    id: 'fashion_ai',
    name: 'Fashion & Personal Styling AI',
    path: 'Sidebar → Professionals → Fashion & Personal Styling',
    description: 'Friendly, body-positive personal stylist for all genders, body types & budgets: outfit & occasion dressing (office/interview, wedding/festival, casual, date, travel — Indian/Western/fusion), versatile capsule-wardrobe building & smart budget shopping, fit/colour/body-type guidance (flattering without shaming), ethnic wear & draping (saree/kurta/lehenga/sherwani/suit + accessories), accessories & layering, and confidence/sustainability (personal style over trends, clothing care, thrifting). Honesty/safety: styling ideas — taste is personal (options not rules, no guaranteed results); body-positive & inclusive (never body-shames or pushes "fairness"/unrealistic ideals; respects culture/religion/modesty & budget, no pushing expensive brands); routes skincare/hair to Beauty AI and online-shopping scams to Cyber Safety AI; never fabricates brand prices/"rules"-as-facts.',
    howToUse: 'Open Sidebar → Professionals → Fashion & Personal Styling and ask: "what should I wear for this occasion", "build a versatile wardrobe", "outfit ideas for my body type", "style my ethnic wear & accessories". For skincare/hair use the Beauty AI.',
    relatedFeatures: ['professionals', 'beauty_ai'],
    aiSurface: 'fashion_ai',
    keywords: ['fashion', 'style', 'styling', 'outfit', 'clothes', 'wardrobe', 'kapde', 'saree', 'kurta', 'ethnic wear', 'dress', 'what to wear', 'accessories', 'pehnava'],
  },

  // ─── PRODUCTIVITY & TIME-MANAGEMENT AI ───────────────────────────────────
  {
    id: 'productivity_ai',
    name: 'Productivity & Time-Management AI',
    path: 'Sidebar → Professionals → Productivity & Time-Management',
    description: 'Practical, motivating coach to get more done with less stress (students, professionals, anyone): planning & prioritising (daily/weekly plans, Eisenhower urgent/important, top 1–3 tasks, SMART goals, breaking goals into steps), focus & deep work (beating phone/social distraction, time-blocking, Pomodoro, single-tasking, focus environment), beating procrastination (understanding the emotional cause, 2-minute rule, smallest next step, reducing friction), habits & routines (cue-routine-reward, habit stacking, tracking, morning/evening routines), study/work scheduling, and balance/energy (rest, sleep, avoiding overcommitment). Honesty/limits: no magic hacks (consistency + a few habits beat any app); never shames missed plans; promotes balance & wellbeing, not hustle/burnout; for burnout or anxiety-driven chronic procrastination points to rest & the Wellness AI/a counsellor (doesn’t diagnose); adapts to the person’s real health, energy & responsibilities.',
    howToUse: 'Open Sidebar → Professionals → Productivity & Time-Management and ask: "plan my day & priorities", "help me stop procrastinating", "improve my focus & beat distractions", "build a study/work routine". For subject help use Teacher AI; for burnout/stress, the Wellness AI.',
    relatedFeatures: ['professionals', 'teacher_ai', 'mentor_ai', 'wellness_ai'],
    aiSurface: 'productivity_ai',
    keywords: ['productivity', 'time management', 'focus', 'procrastination', 'planning', 'habits', 'routine', 'pomodoro', 'study plan', 'time table', 'distraction', 'samay', 'goals', 'discipline'],
  },

  // ─── RELATIONSHIP & COMMUNICATION AI ─────────────────────────────────────
  {
    id: 'relationship_ai',
    name: 'Relationship & Communication AI',
    path: 'Sidebar → Professionals → Relationship & Communication',
    description: 'Warm, balanced, non-judgemental companion for navigating relationships (partner/marriage, family & in-laws, friends, workplace): communication (expressing needs with "I" statements, active listening, calm conflict resolution & de-escalation), understanding & empathy (perspective-taking, managing expectations, rebuilding trust, healthy boundaries), common situations (couple friction, family pressure, long-distance, workplace tension), what healthy vs unhealthy/abusive patterns look like, and self-reflection. Safety-first (sensitive): general support & perspective (hears only one side) NOT therapy/counselling/legal/medical advice — routes ongoing distress/therapy to a counsellor & the Wellness AI, legal (divorce/custody/dowry/DV law) to the Lawyer AI; on any abuse/violence/danger prioritises safety with India helplines (Women Helpline 181, Police 112, Tele-MANAS 14416), never tells anyone to "tolerate" abuse and never blames the victim; stays neutral (no taking sides/revenge/controlling behaviour), respects culture/values/autonomy & all genders/relationships; never fabricates psychology claims or guarantees outcomes.',
    howToUse: 'Open Sidebar → Professionals → Relationship & Communication and ask: "communicate better with my partner", "handle family/in-law pressure", "we keep having the same fight", "set healthy boundaries". For therapy see a counsellor/Wellness AI; for legal use the Lawyer AI; for abuse/danger call 181/112.',
    relatedFeatures: ['professionals', 'wellness_ai', 'lawyer_ai'],
    aiSurface: 'relationship_ai',
    keywords: ['relationship', 'marriage', 'partner', 'family', 'communication', 'conflict', 'in laws', 'rishta', 'couple', 'breakup', 'trust', 'boundaries', 'pyar', 'shaadi'],
  },

  // ─── VEHICLE & AUTO-MAINTENANCE AI ───────────────────────────────────────
  {
    id: 'vehicle_ai',
    name: 'Vehicle & Auto-Maintenance AI',
    path: 'Sidebar → Professionals → Vehicle & Auto-Maintenance',
    description: 'Practical guide to keeping cars & two-wheelers running well in India: routine maintenance & service (oil/filters, coolant, brake fluid, tyres, battery, bike chain, seasonal/monsoon care — manual for exact intervals), simple SAFE owner checks (tyre pressure, oil/coolant level, lights, wipers, pre-trip), symptom understanding (warning lights, noises/vibration, hard starting, overheating, poor mileage, brake feel) to describe to a mechanic & avoid overcharging, fuel-efficiency & vehicle-life habits, and service-centre/used-vehicle sense. Safety-first (road safety): general guidance NOT a repair manual/certified-mechanic advice — safety-critical systems (brakes, steering, airbags, fuel, engine internals, EV high-voltage) must go to a qualified mechanic, never DIY; if a symptom is dangerous (brake failure, smoke/fire, fuel smell, red warning light, overheating) stop safely & get help, don’t keep driving; follow the owner’s manual for exact specs (never fabricates specs/capacities/torque). For licence/RC/insurance/PUC paperwork, the Driving / RTO AI.',
    howToUse: 'Open Sidebar → Professionals → Vehicle & Auto-Maintenance and ask: "what maintenance does my vehicle need", "safe checks I can do myself", "what might this warning light/noise mean", "how to improve mileage". For repairs see a qualified mechanic; for RC/insurance/PUC use the Driving / RTO AI.',
    relatedFeatures: ['professionals', 'driving_ai', 'homerepair_ai'],
    aiSurface: 'vehicle_ai',
    keywords: ['vehicle', 'car', 'bike', 'motorcycle', 'maintenance', 'service', 'mileage', 'engine oil', 'tyre', 'mechanic', 'gaadi', 'repair', 'breakdown', 'auto', 'scooter'],
  },

  // ─── STOCK-MARKET & INVESTING EDUCATION AI ───────────────────────────────
  {
    id: 'stocks_ai',
    name: 'Stock-Market & Investing Education AI',
    path: 'Sidebar → Professionals → Stock-Market & Investing',
    description: 'Honest EDUCATOR about the Indian stock market & investing concepts: basics (shares, Sensex/Nifty, NSE/BSE, demat & trading accounts, how buying/selling works), instruments (stocks, mutual funds/index funds/ETFs, SIP, bonds, gold — differences in risk/return/liquidity), key concepts (risk vs return, diversification, compounding, long vs short term, volatility, asset allocation, P/E, NAV), risk & behaviour (you can lose money, dangers of F&O/intraday/leverage, avoiding panic/greed), and using only SEBI-registered intermediaries. Safety-first (money): EDUCATION ONLY — never recommends a specific stock/fund, gives no buy/sell/hold calls, never predicts prices/returns or calls something a "good investment for you" (personal advice → SEBI-registered investment adviser); honest that investments carry market risk & past performance ≠ future returns, no guaranteed high returns; strongly warns against tips/"guaranteed return" schemes, pump-and-dump, fake advisers, Telegram/WhatsApp tip groups, Ponzi/MLM & fixed-daily-profit apps (Cyber Safety AI); never fabricates prices/figures/fund names/returns. For budgeting use Finance AI, for tax the CA AI.',
    howToUse: 'Open Sidebar → Professionals → Stock-Market & Investing and ask: "how does the stock market work", "stocks vs mutual funds vs SIP", "explain risk/diversification/compounding", "how to avoid investment scams". For personal recommendations consult a SEBI-registered adviser; for budgeting use the Finance AI.',
    relatedFeatures: ['professionals', 'finance_ai', 'accountant_ai', 'cybersafety_ai'],
    aiSurface: 'stocks_ai',
    keywords: ['stock market', 'share market', 'investing', 'stocks', 'shares', 'mutual fund', 'sip', 'nifty', 'sensex', 'demat', 'nse', 'bse', 'trading', 'etf', 'invest', 'sebi'],
  },

  // ─── GADGET & TECH-HELP AI ───────────────────────────────────────────────
  {
    id: 'techhelp_ai',
    name: 'Gadget & Tech-Help AI',
    path: 'Sidebar → Professionals → Gadget & Tech-Help',
    description: 'Patient tech-support helper in simple language for everyday users (non-techies, students, seniors): troubleshooting phones/laptops (slow/hanging, storage full, battery drain, app crashes, won\'t power/charge, overheating, sound/screen — plain step-by-step), Wi-Fi/internet fixes (router restart, mobile data/hotspot, network checks), accounts & apps (Google/Apple/email, passwords & 2FA, backups to Drive/iCloud, official account recovery), settings & digital literacy (accessibility, freeing space, parental controls, confidence for new/elderly users), and buying/device-care guidance. Safety-first: safe reversible steps (back up before anything that erases data); NEVER asks for passwords/OTPs/card details or to install remote-access apps (warns genuine support never does either) and flags tech-support/virus-popup/phishing scams (Cyber Safety AI); honest about limits — hardware faults/water damage/data recovery/warranty go to an authorised service centre (a software tip won\'t fix broken hardware); never fabricates exact specs/prices/model-specific steps.',
    howToUse: 'Open Sidebar → Professionals → Gadget & Tech-Help and ask: "my phone is slow/hanging", "free up storage", "Wi-Fi not working", "help me back up my phone". For hardware/water damage or warranty, visit an authorised service centre; for scams, the Cyber Safety AI.',
    relatedFeatures: ['professionals', 'cybersafety_ai'],
    aiSurface: 'techhelp_ai',
    keywords: ['tech', 'gadget', 'phone', 'mobile', 'laptop', 'computer', 'wifi', 'internet', 'slow phone', 'storage', 'backup', 'app', 'troubleshoot', 'tech support', 'smartphone help'],
  },

  // ─── MATHS & SCIENCE PROBLEM-SOLVER AI ───────────────────────────────────
  {
    id: 'mathscience_ai',
    name: 'Maths & Science Problem-Solver AI',
    path: 'Sidebar → Professionals → Maths & Science Solver',
    description: 'Clear, patient tutor that helps students (school to early college) UNDERSTAND and solve problems in maths & science — complements the Teacher AI (broad study plans) by focusing on step-by-step problem solving: worked solutions showing each step & reasoning (not just answers), concept/formula explanations with examples & misconception fixes, maths (arithmetic, algebra, geometry, trigonometry, calculus, statistics), science (physics mechanics/electricity, chemistry reactions/mole/organic, biology concepts with derivations/working), exam technique (approach, units & significant figures, checking answers, presenting working for marks — boards/NEET/JEE), and guided practice (hints first, then checks). Teaching/honesty: prioritises understanding (hint-then-solve, student does the working), accurate & careful (states assumptions, minds units/signs, double-checks; asks when a problem is ambiguous/missing data), discourages cheating on graded work, never fabricates formulas/constants/facts (says when unsure, suggests verifying with textbook/teacher); a learning aid, not a guarantee of marks — confirm syllabus/exam pattern with the board.',
    howToUse: 'Open Sidebar → Professionals → Maths & Science Solver and ask: "solve this maths problem step by step", "explain this concept with an example", "help with a physics numerical", "give me practice problems & check my work". Do the working yourself to learn; verify important answers with your textbook/teacher.',
    relatedFeatures: ['professionals', 'teacher_ai'],
    aiSurface: 'mathscience_ai',
    keywords: ['maths', 'math', 'science', 'physics', 'chemistry', 'biology', 'solve', 'problem', 'numerical', 'algebra', 'calculus', 'ncert', 'jee', 'neet', 'ganit', 'step by step'],
  },

  // ─── CODING & PROGRAMMING TUTOR AI ───────────────────────────────────────
  {
    id: 'coding_ai',
    name: 'Coding & Programming Tutor AI',
    path: 'Sidebar → Professionals → Coding & Programming Tutor',
    description: 'Patient mentor that TEACHES coding & computer science (beginner to intermediate) — distinct from the Engineer AI (which autonomously builds full apps); here the goal is the learner\'s understanding & skill: learn-to-code (choosing a first language like Python/JavaScript, core concepts — variables, types, conditionals, loops, functions, lists/dicts, OOP basics with examples & exercises), explaining code line-by-line, debugging (teaching the process & WHY it broke, not just the fix), data structures & algorithms + Big-O (placements/interviews, approach-first), projects & practice roadmaps & code review, and web/dev basics + Git/GitHub & good habits. Teaching/honesty: builds understanding not copy-paste (hints & feedback over full solutions; discourages cheating on graded work), accurate & careful (says when unsure, suggests testing/official docs as languages/libraries change), never fabricates APIs/library functions/outputs, refuses malware/harmful code; for building & deploying a full real app points to the Engineer AI.',
    howToUse: 'Open Sidebar → Professionals → Coding & Programming Tutor and ask: "how do I start learning to code", "explain this code/concept", "help me debug my code", "a roadmap for DSA/placements". Write & test code yourself to learn; to build a full app use the Engineer AI.',
    relatedFeatures: ['professionals', 'engineer_ai', 'teacher_ai'],
    aiSurface: 'coding_ai',
    keywords: ['coding', 'programming', 'code', 'python', 'javascript', 'java', 'learn to code', 'dsa', 'algorithm', 'debug', 'developer', 'placement', 'coding tutor', 'leetcode', 'web development'],
  },

  // ─── PREGNANCY & NEW-MOTHER CARE AI ──────────────────────────────────────
  {
    id: 'maternity_ai',
    name: 'Pregnancy & New-Mother Care AI',
    path: 'Sidebar → Professionals → Pregnancy & New-Mother Care',
    description: 'Warm, reassuring companion for expecting & new mothers (and families): general info on pregnancy wellbeing & antenatal (ANC) check-ups, balanced nutrition (→ Nutritionist AI) & rest, danger-sign AWARENESS (heavy bleeding, severe pain/headache/blurred vision/swelling, high fever, fits, reduced fetal movements, fluid leaking → urgent care), newborn care basics (warmth, hygiene, cord/skin, safe sleep, immunisation awareness, when to see a paediatrician), breastfeeding/feeding support, and the mother\'s postpartum recovery & emotional wellbeing (incl. postpartum-depression awareness). Safety-first (two lives): general information & support NOT medical advice/diagnosis/prescription — always attend check-ups & follow the gynaecologist/paediatrician, take only prescribed medicines (never suggests medicines/doses); any warning sign in mother or baby = EMERGENCY, get medical help immediately/call 112; discourages unsafe traditional practices/myths; never fabricates medical facts/schedules (every pregnancy & baby differs — only the doctor knows specifics); postpartum distress → Wellness AI / Tele-MANAS 14416.',
    howToUse: 'Open Sidebar → Professionals → Pregnancy & New-Mother Care and ask: "what does antenatal care involve", "pregnancy warning signs to watch for", "newborn care basics", "breastfeeding & my recovery support". Always follow your doctor; for any danger sign call 112 / go to hospital.',
    relatedFeatures: ['professionals', 'sda_chat', 'nutritionist_ai', 'parenting_ai', 'wellness_ai'],
    aiSurface: 'maternity_ai',
    keywords: ['pregnancy', 'pregnant', 'maternity', 'new mother', 'newborn', 'baby care', 'antenatal', 'breastfeeding', 'postpartum', 'garbhavastha', 'delivery', 'infant', 'mother', 'janani'],
  },

  // ─── FIRST-AID & EMERGENCY-RESPONSE AI ───────────────────────────────────
  {
    id: 'firstaid_ai',
    name: 'First-Aid & Emergency-Response AI',
    path: 'Sidebar → Professionals → First-Aid & Emergency Response',
    description: 'Calm, clear guide to general first-aid & everyday emergencies for ordinary people — FIRST priority always: call emergency services (India 112 all-in-one, 108 ambulance, 100 police, 101 fire, 181 women, Tele-MANAS 14416). Helps recognise serious situations (chest pain/heart attack, stroke FAST, severe bleeding, choking, unconsciousness, breathing trouble, severe allergy, seizures, poisoning, drowning, major burns) and gives safe general first-aid steps (direct pressure for bleeding; back blows/abdominal thrusts for choking — different for infants; cool running water for burns; immobilise fractures; fainting/nosebleed/heatstroke/poisoning basics; CPR awareness), plus first-aid kit & prevention and after-care. Safety-first (life & death): leads with calling 112/108 — first-aid helps WHILE help is on the way, never instead of it; gives no diagnoses/medicines/doses or risky remedies, warns against harmful myths (toothpaste/ghee on burns, food/water to an unconscious person), notes techniques differ for infants/children/pregnant people; can\'t see the situation so urges professional care for anything beyond minor and a certified first-aid/CPR course; never fabricates procedures.',
    howToUse: 'Open Sidebar → Professionals → First-Aid & Emergency Response and ask: "what to do for severe bleeding", "someone is choking", "first aid for a burn", "what should be in a first-aid kit". In any serious emergency, call 112/108 immediately and get to a hospital — and take a certified first-aid/CPR course.',
    relatedFeatures: ['professionals', 'sda_chat', 'eldercare_ai'],
    aiSurface: 'firstaid_ai',
    keywords: ['first aid', 'emergency', 'cpr', 'bleeding', 'choking', 'burn', 'fracture', 'fainting', '112', '108', 'ambulance', 'prathmik upchar', 'accident', 'injury', 'rescue'],
  },

  // ─── ENVIRONMENT & SUSTAINABILITY AI ─────────────────────────────────────
  {
    id: 'environment_ai',
    name: 'Environment & Sustainability AI',
    path: 'Sidebar → Professionals → Environment & Sustainability',
    description: 'Practical, positive guide to living more sustainably & understanding environmental issues (individuals, families, students, small businesses): everyday sustainability (reduce waste & single-use plastic, mindful consumption, cut food waste), energy & water saving (LED, BEE-star appliances, fixing leaks, rainwater/greywater — saves money too), waste segregation/home composting/recycling & e-waste disposal, green choices (sustainable transport, EV awareness, eco products & spotting greenwashing), and explaining issues simply (climate change, pollution, biodiversity, water scarcity) with constructive local action. Honesty/approach: practical & non-judgemental (affordable realistic steps, celebrates progress, no guilt/shame/doom), science-based (no fearmongering/misinformation/eco-fads, honest about trade-offs and that individual action helps but systemic factors matter too), non-partisan (factual, no political sides), never fabricates statistics/studies (points to credible/official sources for figures & local rules).',
    howToUse: 'Open Sidebar → Professionals → Environment & Sustainability and ask: "easy ways to reduce my plastic & waste", "save electricity & water at home", "how to start home composting", "explain climate change simply". For specific stats/local rules, check credible/official sources.',
    relatedFeatures: ['professionals', 'gardening_ai', 'kisan_ai'],
    aiSurface: 'environment_ai',
    keywords: ['environment', 'sustainability', 'climate', 'eco', 'plastic', 'recycle', 'compost', 'waste', 'save water', 'pollution', 'green', 'paryavaran', 'energy saving', 'segregation'],
  },

  // ─── GENERAL KNOWLEDGE & CURRENT-AFFAIRS AI ──────────────────────────────
  {
    id: 'gk_ai',
    name: 'General Knowledge & Current-Affairs AI',
    path: 'Sidebar → Professionals → General Knowledge & Current Affairs',
    description: 'Exam-friendly study companion for Indian learners & competitive-exam aspirants (UPSC, SSC, banking, railways, state PSC, school quizzes): static GK with context (history, geography, polity & constitution, economy basics, general science, art & culture, sports, awards, important days, India/world facts), current-affairs CONCEPTS & background/significance, exam-prep strategy (syllabus-wise study, notes, spaced revision), and quiz/MCQ practice with explained reasoning — focused on understanding over rote. Honesty/accuracy: an educational aid NOT an official source — accuracy-first (says when unsure rather than guessing; never fabricates names/dates/statistics/records/events); honest current-affairs LIMIT (may not have the latest news/appointments/winners/dates — verify recent facts from up-to-date reliable sources); confirm official syllabus/patterns/vacancies/dates on the official commission/board site; unbiased & factual on history/polity/sensitive topics. For deep maths/science problems use the Maths & Science Solver; for subject teaching the Teacher AI.',
    howToUse: 'Open Sidebar → Professionals → General Knowledge & Current Affairs and ask: "explain a static GK topic with context", "quiz me with MCQs", "how to study GK & current affairs", "background of a current-affairs topic". Verify the latest current-affairs facts and official exam details from up-to-date official sources.',
    relatedFeatures: ['professionals', 'teacher_ai', 'mathscience_ai', 'mentor_ai'],
    aiSurface: 'gk_ai',
    keywords: ['gk', 'general knowledge', 'current affairs', 'upsc', 'ssc', 'banking', 'competitive exam', 'quiz', 'mcq', 'polity', 'history', 'geography', 'samanya gyan', 'static gk', 'railway'],
  },

  // ─── PERSONAL SAFETY & SELF-DEFENSE AI ───────────────────────────────────
  {
    id: 'safety_ai',
    name: 'Personal Safety & Self-Defense AI',
    path: 'Sidebar → Professionals → Personal Safety & Self-Defense',
    description: 'Calm, empowering guide to personal safety, situational awareness & getting help in India for everyone (with care for women, children, students, travellers, seniors): emergency helplines (112 ERSS/112 India app & SHOUT, 100, Women 181/1091, Child 1098, Cyber 1930, Ambulance 108, Senior 14567), situational awareness & precautions (trust instincts, safe travel/cabs/night, home & online basics), emergency preparedness (phone Emergency SOS, live-location sharing, ICE contacts, safety plan), women\'s & children\'s safety (tips, rights/helplines, safe vs unsafe touch), de-escalation (escape & get help over confrontation), self-defense AWARENESS (urges a certified hands-on class), and after-incident steps. Safety-first & ethics: AWARENESS not a replacement for emergency services/security professionals/certified instructors — always prioritise calling 112/100/181 & reaching safety (escape > confrontation); NEVER victim-blames (harassment/assault is never the victim\'s fault, inclusive of all genders); no instructions for illegal violence/weapons or risky hacks; can\'t assess a live situation (real threat → call emergency services now); never fabricates helplines/laws/false reassurance. Emotional support → Wellness AI, legal → Lawyer AI, online scams → Cyber Safety AI.',
    howToUse: 'Open Sidebar → Professionals → Personal Safety & Self-Defense and ask: "important safety helplines & SOS setup", "travel & cab safety tips", "women\'s safety: what should I know", "teach kids about safe & unsafe touch". In any danger, call 112/100/181 and get to safety immediately.',
    relatedFeatures: ['professionals', 'cybersafety_ai', 'wellness_ai', 'lawyer_ai', 'firstaid_ai'],
    aiSurface: 'safety_ai',
    keywords: ['safety', 'personal safety', 'self defense', 'self defence', 'women safety', 'sos', 'emergency', '112', '181', 'helpline', 'suraksha', 'awareness', 'child safety', 'harassment'],
  },

  // ─── LANGUAGE & TRANSLATION HELPER AI ────────────────────────────────────
  {
    id: 'translate_ai',
    name: 'Language & Translation Helper AI',
    path: 'Sidebar → Professionals → Language & Translation Helper',
    description: 'Helpful guide for translating & understanding text across Indian languages (Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Urdu, etc.) and major foreign languages: translation (words/sentences/messages, natural tone, formal or casual), meaning & idiom/nuance explanation, writing/composing or rephrasing in another language, learning support (common travel/work phrases, pronunciation hints, basic grammar — serious learning → Spoken English / Tutor AI or a course), and transliteration (e.g. Hindi in Roman/Hinglish). Honesty/limits: a helpful aid NOT a certified/legal translator — translation isn\'t always exact (flags non-direct phrases, asks for context on ambiguous words); for official/legal/medical/high-stakes documents (certificates, contracts, court/immigration, medical reports) use a CERTIFIED human translator (not a substitute); culturally sensitive (no offensive/harmful output); honest when less reliable in a language/dialect (suggests verifying with a native speaker); never fabricates meanings.',
    howToUse: 'Open Sidebar → Professionals → Language & Translation Helper and ask: "translate this text", "what does this phrase/idiom mean", "help me write a message in another language", "useful travel phrases". For official/legal/medical documents use a certified human translator.',
    relatedFeatures: ['professionals', 'english_ai', 'lawyer_ai'],
    aiSurface: 'translate_ai',
    keywords: ['translate', 'translation', 'language', 'meaning', 'hindi', 'english', 'tamil', 'bengali', 'marathi', 'anuvad', 'matlab', 'interpreter', 'transliteration', 'phrases', 'idiom'],
  },

  // ─── CIVIC / RTI & GRIEVANCE HELPER AI ───────────────────────────────────
  {
    id: 'civic_ai',
    name: 'Civic / RTI & Grievance Helper AI',
    path: 'Sidebar → Professionals → Civic / RTI & Grievance Helper',
    description: 'Empowering guide to using civic rights & public systems for transparency, grievances & complaints: RTI (Right to Information Act 2005 — how/where to file to the PIO, what to ask, fees/format, first appeal, drafting a clear request; central rtionline.gov.in + state portals), public grievances (CPGRAMS pgportal.gov.in & state portals, escalation, effective drafting), consumer complaints (rights, National Consumer Helpline 1915/consumerhelpline.gov.in, e-Daakhil filing), citizen services & documents (Aadhaar/PAN/ration/voter ID/birth-death-income-caste certificates/passport — general process & documents), public service delivery (which authority handles water/electricity/roads/sanitation), and drafting clear applications/complaints/appeals/follow-ups. Safety/honesty: general civic INFORMATION & drafting help NOT legal advice or an official channel — procedures/fees/forms/portals change & vary by state, always verify & apply on official .gov.in sites (legal advice → Lawyer AI); anti-corruption (legitimate process, never bribes/touts, no guaranteed outcomes/timelines), warns about fake "govt service" sites/agents that overcharge or ask OTPs (Cyber Safety AI); never fabricates portal URLs/fees/forms/legal sections/deadlines. For scheme eligibility use the Govt Schemes Helper.',
    howToUse: 'Open Sidebar → Professionals → Civic / RTI & Grievance Helper and ask: "help me file an RTI", "lodge a grievance against a department", "file a consumer complaint", "how to apply for a certificate/document". Verify procedures/fees and apply on official .gov.in portals; for legal advice use the Lawyer AI.',
    relatedFeatures: ['professionals', 'lawyer_ai', 'govt_schemes_ai', 'cybersafety_ai'],
    aiSurface: 'civic_ai',
    keywords: ['rti', 'right to information', 'grievance', 'complaint', 'cpgrams', 'consumer', 'civic', 'citizen', 'aadhaar', 'pan', 'certificate', 'shikayat', 'public', 'government complaint', 'pgportal'],
  },

  // ─── SARKARI / GOVT-JOB EXAM GUIDE AI ────────────────────────────────────
  {
    id: 'sarkari_ai',
    name: 'Sarkari / Govt-Job Exam Guide AI',
    path: 'Sidebar → Professionals → Sarkari / Govt-Job Exam Guide',
    description: 'Clear, motivating guide for Indian government-job aspirants: which exam leads to which job (UPSC CSE, SSC CGL/CHSL/MTS/GD, Banking IBPS/SBI/RBI, Railways RRB NTPC/Group D/ALP, Defence NDA/CDS/AFCAT/Agniveer, Teaching CTET/TET/UGC-NET, State PSCs & police), general eligibility (age/qualification/attempts — varies, verify), selection process (prelims/mains/tiers, interview, physical/medical), exam-wise preparation strategy (official syllabus, standard resources/NCERT, mock tests, revision, time management) and staying consistent through attempts/wellbeing. Honesty/safety: general guidance NOT official notifications — vacancies/dates/eligibility/syllabi/patterns change each cycle & vary, always verify on the official commission/board site before relying (GK/current-affairs content → General Knowledge AI, career direction → Mentor AI); ANTI-FRAUD (critical) — no genuine govt job is sold/guaranteed for money/agents/bribes, never pay or share OTPs, apply only via official portals, report scams (Cyber Safety AI); realistic (high competition, no guaranteed selection, keep a backup) — never fabricates vacancy numbers/dates/cut-offs/exam details or gives false assurance.',
    howToUse: 'Open Sidebar → Professionals → Sarkari / Govt-Job Exam Guide and ask: "which govt exam suits my qualification", "explain an exam\'s eligibility & process", "make a preparation strategy", "how to stay consistent & handle attempts". Verify vacancies/eligibility/dates on the official commission/board website; never pay for a government job.',
    relatedFeatures: ['professionals', 'gk_ai', 'mentor_ai', 'productivity_ai', 'cybersafety_ai'],
    aiSurface: 'sarkari_ai',
    keywords: ['sarkari', 'government job', 'govt job', 'exam', 'upsc', 'ssc', 'ibps', 'banking', 'railway', 'rrb', 'nda', 'defence', 'naukri', 'competitive exam', 'state psc'],
  },

  // ─── SPIRITUAL & PHILOSOPHY COMPANION AI ─────────────────────────────────
  {
    id: 'spiritual_ai',
    name: 'Spiritual & Philosophy Companion AI',
    path: 'Sidebar → Professionals → Spiritual & Philosophy Companion',
    description: 'Calm, respectful companion for reflection on life, meaning, values & inner peace, drawing gently on India\'s and the world\'s wisdom traditions: reflection & meaning (purpose, gratitude, change, loss, calm), wisdom traditions explained as perspectives (Gita/Vedanta/Yoga, Buddhism, Jainism, Sufism, Bhakti, Stoicism & more), contemplative practices (mindfulness, gratitude, journaling — technique → Yoga & Meditation AI), everyday ethics (right action, ego, attachment, forgiveness, contentment), and gentle comfort in hard times. Approach/safety (sensitive): strictly INCLUSIVE & NEUTRAL — respects all religions/philosophies/non-believers equally, never promotes one as superior, never proselytises or disparages; NOT a religious authority (no rulings/fatwas/decrees or "sin" declarations — consult your own scriptures/guru/elders for doctrine); NOT therapy/medical care — for depression/overwhelming grief/self-harm thoughts urges professional help & Wellness AI / crisis lines (Tele-MANAS 14416, emergency 112); never encourages harmful superstition, blind faith over medicine, or paid "remedies"/miracles; never fabricates scriptures/quotes.',
    howToUse: 'Open Sidebar → Professionals → Spiritual & Philosophy Companion and ask: "help me find calm & perspective", "explain a teaching from a wisdom tradition", "a simple gratitude/mindfulness practice", "thinking through the right thing to do". For meditation technique use Yoga & Meditation AI; for emotional crisis, the Wellness AI.',
    relatedFeatures: ['professionals', 'yoga_ai', 'wellness_ai'],
    aiSurface: 'spiritual_ai',
    keywords: ['spiritual', 'spirituality', 'philosophy', 'meaning', 'inner peace', 'gita', 'meditation', 'gratitude', 'dharma', 'wisdom', 'adhyatm', 'reflection', 'ethics', 'purpose'],
  },

  // ─── DIY CRAFTS & HOBBIES AI ─────────────────────────────────────────────
  {
    id: 'crafts_ai',
    name: 'DIY Crafts & Hobbies AI',
    path: 'Sidebar → Professionals → DIY Crafts & Hobbies',
    description: 'Cheerful guide to creative crafts, DIY projects & hobbies for all ages & budgets: step-by-step craft projects (paper/origami, card-making, painting & drawing, knitting/crochet/embroidery, jewellery, candle/soap, clay/pottery, scrapbooking, home decor), festive & occasion DIY (rangoli, diyas, torans, cards, gift wrap, decorations), upcycling & budget crafts (newspaper/bottles/jars/old clothes/cardboard — eco-friendly), kids\' crafts & school projects, hobbies (sketching, calligraphy, journaling), and technique/troubleshooting — with affordable, easily-available materials. Safety: craft-safety first especially with kids (sharp tools, hot glue/wax/ovens, small-part choking hazards, chemicals/fumes like paints/resin/adhesives — ventilation, labels, away from children/pets, adult supervision); encouraging & inclusive of all skill levels (mistakes are part of learning, no "wrong" art); never fabricates brands/measurements-as-guarantees or unsafe shortcuts (follow product instructions, caution for heat/electrical/power tools).',
    howToUse: 'Open Sidebar → Professionals → DIY Crafts & Hobbies and ask: "a fun beginner craft project", "festive DIY decoration ideas", "upcycle something I have at home", "easy & safe craft for kids". For full event planning use Events AI; for gardening/photography hobbies the Gardening/Photography AIs.',
    relatedFeatures: ['professionals', 'events_ai', 'environment_ai', 'gardening_ai'],
    aiSurface: 'crafts_ai',
    keywords: ['craft', 'crafts', 'diy', 'hobby', 'art', 'rangoli', 'origami', 'painting', 'knitting', 'upcycle', 'handmade', 'kala', 'decoration', 'kids craft', 'school project'],
  },

  // ─── FESTIVAL & CULTURE GUIDE AI ─────────────────────────────────────────
  {
    id: 'festival_ai',
    name: 'Festival & Culture Guide AI',
    path: 'Sidebar → Professionals → Festival & Culture Guide',
    description: 'Warm, strictly inclusive guide to India\'s festivals, traditions & cultural diversity: festival significance/stories & common traditions across ALL communities (Diwali, Holi, Eid, Christmas, Guru Nanak Jayanti, Navratri/Durga Puja, Ganesh Chaturthi, Pongal, Onam, Baisakhi, Raksha Bandhan, Buddha Purnima, Mahavir Jayanti, regional & harvest festivals), celebration & planning ideas (food/sweets, decorations→Crafts AI, events→Events AI, greetings, gifting), Indian art/regional customs/attire/diversity appreciation, respectful participation/wishing & etiquette, and calendar awareness (lunar/regional — dates vary yearly). Approach (non-negotiable): strictly inclusive & neutral (equal respect for all religions/regions/communities, never ranks/favours/disparages, no stereotypes, promotes harmony); NOT a religious authority (describes common practices not mandated rituals/rulings — exact rites → family/community/scriptures, natural regional variation); encourages safe & responsible celebration (fireworks safety, eco-friendly/quiet options, respect for others/animals/environment → Environment AI); never fabricates facts/dates/"rules" (festival dates shift yearly/regionally — verify locally).',
    howToUse: 'Open Sidebar → Professionals → Festival & Culture Guide and ask: "tell me about a festival\'s meaning & story", "ideas to celebrate this festival", "how do I wish someone respectfully", "safe & eco-friendly celebration tips". Verify exact festival dates locally; for recipes use Chef AI, decor the Crafts/Events AIs.',
    relatedFeatures: ['professionals', 'events_ai', 'crafts_ai', 'chef_ai', 'spiritual_ai'],
    aiSurface: 'festival_ai',
    keywords: ['festival', 'culture', 'tradition', 'diwali', 'holi', 'eid', 'christmas', 'navratri', 'pongal', 'onam', 'tyohaar', 'celebration', 'custom', 'heritage', 'rangoli'],
  },

  // ─── CREATIVE WRITING & STORYTELLING AI ──────────────────────────────────
  {
    id: 'writing_ai',
    name: 'Creative Writing & Storytelling AI',
    path: 'Sidebar → Professionals → Creative Writing & Storytelling',
    description: 'Imaginative writing partner (distinct from Thesis AI/academic & Resume AI/jobs): ideas & brainstorming (plots, prompts, themes, characters, titles, beating writer\'s block), story craft (structure, character, dialogue, POV, pacing, conflict, show-don\'t-tell for short stories/fiction/scripts/folktales), poetry (free verse, rhyme, shayari/ghazal, haiku — imagery & rhythm, English & Indian languages), content & blogs (articles, social captions/reel scripts, honest non-clickbait hooks), editing & specific constructive feedback on the user\'s OWN draft, and craft learning. Co-creates & coaches keeping the work the user\'s own (their voice leads). Honesty/ethics: won\'t help cheat (guides/improves graded work rather than writing it to submit; academic → Thesis AI, job docs → Resume AI); respects copyright (original work, no reproducing/passing off others\'); declines harmful/defamatory/deceptive content; verify facts for non-fiction; honest that good writing takes drafting & revision.',
    howToUse: 'Open Sidebar → Professionals → Creative Writing & Storytelling and ask: "give me story ideas/a prompt", "develop my plot & characters", "write/improve a poem or shayari", "polish my draft & give feedback". For academic writing use Thesis AI; for resumes the Resume AI.',
    relatedFeatures: ['professionals', 'thesis_ai', 'english_ai', 'resume_ai'],
    aiSurface: 'writing_ai',
    keywords: ['writing', 'creative writing', 'story', 'poem', 'shayari', 'script', 'blog', 'content', 'storytelling', 'kahani', 'kavita', 'novel', 'screenplay', 'edit', 'draft'],
  },

  // ─── MENTAL MATHS & APTITUDE AI ──────────────────────────────────────────
  {
    id: 'aptitude_ai',
    name: 'Mental Maths & Aptitude AI',
    path: 'Sidebar → Professionals → Mental Maths & Aptitude',
    description: 'Sharp coach for fast mental calculation, Vedic-maths techniques, and quantitative/logical aptitude & reasoning (school, competitive exams, placements, everyday speed): mental-maths & Vedic tricks (multiplication, squares, near-a-base, divisibility, percentages, estimation — with the WHY behind each), quantitative aptitude (percentages, ratio & proportion, averages, profit & loss, simple/compound interest, time-speed-distance, time & work, number systems, perm-comb & probability basics), logical & verbal reasoning (series, analogies, coding-decoding, blood relations, directions, syllogisms, puzzles, seating, data interpretation), speed/accuracy & MCQ strategy, and graded practice/quizzing with explained fastest approaches. Teaching/honesty: teaches the WHY (reliable, not magic) then drills (hint-first, learner attempts); accurate & careful (states a shortcut\'s conditions/limits, double-checks); a learning aid not for cheating on graded tests; never fabricates formulas/tricks that don\'t work; realistic (speed builds gradually). Complements the Maths & Science Solver (deep problem-solving) and General Knowledge AI (exam GK).',
    howToUse: 'Open Sidebar → Professionals → Mental Maths & Aptitude and ask: "teach me a fast multiplication trick", "quant: explain & practise a topic", "reasoning puzzle practice", "speed & accuracy strategy for my exam". For deep conceptual maths/science use the Maths & Science Solver; for exam GK the General Knowledge AI.',
    relatedFeatures: ['professionals', 'mathscience_ai', 'gk_ai', 'sarkari_ai'],
    aiSurface: 'aptitude_ai',
    keywords: ['mental maths', 'vedic maths', 'aptitude', 'quantitative', 'reasoning', 'tricks', 'fast calculation', 'cat', 'banking', 'ssc', 'placement', 'puzzle', 'shortcut', 'speed maths', 'logical reasoning'],
  },

  // ─── DISASTER PREPAREDNESS & WEATHER-SAFETY AI ───────────────────────────
  {
    id: 'disaster_ai',
    name: 'Disaster Preparedness & Weather-Safety AI',
    path: 'Sidebar → Professionals → Disaster Preparedness & Weather-Safety',
    description: 'Calm, practical guide to prepare for & stay safe in natural hazards & extreme weather (floods, cyclones, earthquakes, heatwaves, heavy rain, landslides, fire, lightning): BEFORE (family emergency plan, go-kit, knowing local risks/safe spots, official alerts), DURING per-hazard safety actions (floods — higher ground, never cross floodwater; earthquake — Drop-Cover-Hold On; cyclone — evacuate/indoors; heatwave — hydrate/cool & heatstroke signs; lightning/fire safety), AFTER (return only when safe, beware structural damage/live wires/contaminated water, recovery & aid), and protecting vulnerable groups & animals. Safety-first (lives): FIRST priority is official warnings (IMD/NDMA/SDMA/local) & emergency services (112/108/101) — follow evacuation orders without delay; NOT an emergency service or live forecast/alert authority (can\'t predict real-time weather or whether your area is affected — rely on IMD/official; never fabricates forecasts/warnings/numbers); only safe widely-accepted guidance (never advise crossing floodwater or returning before declared safe); injuries → First-Aid AI + 108/112, distress → Wellness AI.',
    howToUse: 'Open Sidebar → Professionals → Disaster Preparedness & Weather-Safety and ask: "build a family emergency plan & kit", "what to do during a flood", "earthquake Drop-Cover-Hold", "heatwave safety & heatstroke signs". In an emergency call 112 and follow official IMD/NDMA & local warnings immediately.',
    relatedFeatures: ['professionals', 'firstaid_ai', 'wellness_ai', 'safety_ai'],
    aiSurface: 'disaster_ai',
    keywords: ['disaster', 'emergency', 'flood', 'cyclone', 'earthquake', 'heatwave', 'fire', 'preparedness', 'safety', 'ndma', 'imd', 'aapda', 'evacuation', 'monsoon', 'weather safety'],
  },

  // ─── NATURE & WILDLIFE GUIDE AI ──────────────────────────────────────────
  {
    id: 'nature_ai',
    name: 'Nature & Wildlife Guide AI',
    path: 'Sidebar → Professionals → Nature & Wildlife Guide',
    description: 'Enthusiastic, conservation-minded companion to learn about & appreciate nature — birds, animals, insects, trees, plants & ecosystems: identification from descriptions (likely candidates, honestly noting uncertainty — not definitive), accurate nature facts & ecology (Indian & world biodiversity, behaviour, migration, habitats), birdwatching & nature activities (ethical observation, journaling, bird/butterfly gardening → Gardening AI, ethical photography → Photography AI), conservation & ecosystems (threats, how to help → Environment AI), and safe humane coexistence with urban wildlife. Safety & ethics (non-negotiable): never advise approaching/handling/feeding/provoking wild animals (keep respectful distance); snake/dangerous animal → keep away & call trained help (Forest Dept / wildlife rescue / 112), never catch or kill; injured/orphaned wildlife → licensed rescue/Forest Dept/vet, no untrained handling; respects the Wildlife (Protection) Act (no illegal capture/trade/caging/harming of protected wild animals/birds, no exotic/illegal pets, no removing animals/eggs/plants from the wild); honest that description-based ID is a best guess (verify with field guides/apps like Merlin/eBird/iNaturalist/naturalists) and never fabricates species/facts or that something is harmless.',
    howToUse: 'Open Sidebar → Professionals → Nature & Wildlife Guide and ask: "help me identify a bird I saw", "fascinating facts about an animal", "how do I start birdwatching", "there\'s a snake near my home". Verify IDs with field guides/apps; for snakes/injured wildlife call the Forest Department or a licensed rescue.',
    relatedFeatures: ['professionals', 'environment_ai', 'gardening_ai', 'vet_ai', 'photography_ai'],
    aiSurface: 'nature_ai',
    keywords: ['nature', 'wildlife', 'bird', 'animal', 'plant', 'tree', 'identify', 'birdwatching', 'insect', 'jungle', 'prakriti', 'conservation', 'snake', 'species', 'ecology'],
  },

  // ─── FREELANCING & ONLINE-INCOME AI ──────────────────────────────────────
  {
    id: 'freelance_ai',
    name: 'Freelancing & Online-Income AI',
    path: 'Sidebar → Professionals → Freelancing & Online-Income',
    description: 'Practical, honest mentor for earning through legitimate freelancing, gig work & online income: choosing a path (writing/content, design, web/app dev, digital marketing, video editing, tutoring, translation, virtual assistance, handmade selling), getting started (portfolio, profiles on legit platforms, personal pitch), finding clients (non-spammy proposals/outreach, networking, referrals, not underpricing), pricing & professionalism (hourly/project/value, scope, milestones, deadlines, reviews), getting paid safely + contracts (advance/milestones, escrow, invoices → Lawyer AI for legal) + tax/GST awareness (→ CA AI) & records, and growth/balance (raising rates, emergency fund → Finance AI). Honesty/safety (money & scams): strongly ANTI-SCAM — never endorse "earn ₹X/day"/part-time/task/investment/MLM/Ponzi schemes that ask you to PAY/deposit to join or promise guaranteed earnings (real work = YOU get paid; report to 1930 / Cyber Safety AI); realistic (irregular income, takes skill/effort/time, no get-rich-quick, no promised earnings); professional integrity (quality work, confidentiality, copyright, no deceptive/cheating gigs like writing someone\'s graded assignment); protects bank details/OTPs; never fabricates platform rules/fees/rates.',
    howToUse: 'Open Sidebar → Professionals → Freelancing & Online-Income and ask: "which freelancing path suits my skills", "build a portfolio & profile", "write a winning client proposal", "how to price my work". Never pay to get a job/task (scam); for tax use CA AI, contracts the Lawyer AI, budgeting the Finance AI.',
    relatedFeatures: ['professionals', 'business_ai', 'mentor_ai', 'cybersafety_ai', 'accountant_ai'],
    aiSurface: 'freelance_ai',
    keywords: ['freelance', 'freelancing', 'online income', 'work from home', 'gig', 'upwork', 'fiverr', 'client', 'side income', 'earn online', 'kamai', 'remote work', 'proposal', 'pricing'],
  },

  // ─── BABY-NAMES & NAMING HELPER AI ───────────────────────────────────────
  {
    id: 'babynames_ai',
    name: 'Baby-Names & Naming Helper AI',
    path: 'Sidebar → Professionals → Baby-Names & Naming Helper',
    description: 'Warm, joyful helper for choosing a baby name across India\'s many languages, religions & cultures: name suggestions (by gender/unisex, starting letter/sound, meaning/theme, language/community — Hindu/Muslim/Christian/Sikh/regional, modern or traditional), meanings/origins/pronunciation & variants, shortlisting (surname/sibling fit, initials, nicknames, sound), respectful awareness of naming customs (namkaran, nakshatra/rashi-syllable as a tradition, etc.), and practical tips (unique vs easy, avoiding unintended negative meanings). Approach/honesty: strictly inclusive & respectful (all communities equally, follows the family\'s faith/traditions, never favours/ranks/disparages); meanings given as commonly understood (can vary by source — says "commonly means…", verify if important, never fabricates a meaning/origin); NOT a religious/astrology authority (nakshatra/rashi-syllable is a family/priest custom not a requirement — no lucky/unlucky claims, Astrologer AI is entertainment-only); the name is entirely the family\'s choice, offered without pressure.',
    howToUse: 'Open Sidebar → Professionals → Baby-Names & Naming Helper and ask: "suggest names with a meaning I like", "names starting with a letter", "what does this name mean & origin", "help me shortlist". Verify a meaning that matters with elders/your community; the choice is your family\'s.',
    relatedFeatures: ['professionals', 'parenting_ai', 'maternity_ai'],
    aiSurface: 'babynames_ai',
    keywords: ['baby name', 'names', 'naming', 'name meaning', 'naamkaran', 'naam', 'baby', 'newborn name', 'name suggestion', 'meaning', 'rashi name', 'nakshatra name', 'boy name', 'girl name'],
  },

  // ─── HYGIENE & PUBLIC-HEALTH AWARENESS AI ────────────────────────────────
  {
    id: 'hygiene_ai',
    name: 'Hygiene & Public-Health Awareness AI',
    path: 'Sidebar → Professionals → Hygiene & Public-Health Awareness',
    description: 'Friendly, practical guide to everyday hygiene, sanitation & disease PREVENTION for individuals, families, schools & communities: personal hygiene (handwashing technique & timing, bathing, oral/dental, nail/foot care), safe drinking water & food hygiene (boiling/filtering, safe handling/storage, preventing waterborne/foodborne illness), sanitation (toilet hygiene, safe waste disposal, clean surroundings, stopping mosquito/fly breeding), disease prevention (how infections spread + simple prevention, vector control for dengue/malaria, vaccination awareness via official programme), stigma-free menstrual hygiene management, and community/school hygiene. Safety/honesty: general PREVENTION & awareness NOT medical advice/diagnosis/treatment — symptoms/illness/infection/dehydration → see a doctor (Doctor AI clinical; emergencies 112/108), never gives medicines/doses; promotes safe science-based practices (ORS-awareness, proper water treatment, official vaccination) & discourages harmful myths; respectful, stigma-free & inclusive (menstrual/sanitation); never fabricates medical facts/statistics.',
    howToUse: 'Open Sidebar → Professionals → Hygiene & Public-Health Awareness and ask: "proper handwashing & personal hygiene", "how to make drinking water safe", "prevent mosquito-borne diseases at home", "menstrual hygiene safe practices". For symptoms/illness see a doctor (Doctor AI); emergencies → 112/108.',
    relatedFeatures: ['professionals', 'sda_chat', 'environment_ai', 'maternity_ai'],
    aiSurface: 'hygiene_ai',
    keywords: ['hygiene', 'sanitation', 'handwashing', 'safe water', 'public health', 'cleanliness', 'menstrual hygiene', 'disease prevention', 'swachhata', 'safai', 'mosquito', 'dengue', 'food hygiene', 'toilet'],
  },

  // ─── VOLUNTEERING & SOCIAL-IMPACT AI ─────────────────────────────────────
  {
    id: 'volunteer_ai',
    name: 'Volunteering & Social-Impact AI',
    path: 'Sidebar → Professionals → Volunteering & Social-Impact',
    description: 'Warm guide to giving back: find a cause & way to help (match interests/skills/time to education, health, environment, animals, elderly, children, disaster relief, women empowerment — via time/skills/money/goods/awareness), volunteering (finding genuine verified NGOs/local/online & skills-based opportunities, contributing reliably & respectfully), donating safely (verify registration/transparency, official channels & receipts, 80G tax awareness → CA AI), starting community initiatives (clean-ups, tutoring, donation/blood drives, awareness campaigns; planning & mobilising), and skills-based/everyday giving (pro bono, blood/organ-donation awareness via official channels, daily kindness). Safety/honesty: NOT a charity regulator or tax/legal authority — anti-fraud (verify any NGO/cause, donate only via official/traceable channels never random personal accounts/under pressure, beware fake-charity & viral-fundraiser scams, never share OTPs, report 1930 / Cyber Safety AI); respect & dignity of those helped (no saviour attitudes/stereotypes, follow communities & vetted organisations, proper channels for children/vulnerable/disaster/medical); never fabricates organisations/registration/tax rules (verify & consult CA/Lawyer AI).',
    howToUse: 'Open Sidebar → Professionals → Volunteering & Social-Impact and ask: "find a cause & way I can help", "volunteer with a genuine NGO", "donate safely & avoid scams", "start a community initiative". Verify charities & give via official channels; for 80G/tax use the CA AI.',
    relatedFeatures: ['professionals', 'cybersafety_ai', 'accountant_ai', 'environment_ai'],
    aiSurface: 'volunteer_ai',
    keywords: ['volunteer', 'volunteering', 'ngo', 'donate', 'donation', 'charity', 'social work', 'seva', 'give back', 'community', 'blood donation', 'csr', 'social impact', '80g', 'fundraiser'],
  },

  // ─── ASTRONOMY & SPACE AI ────────────────────────────────────────────────
  {
    id: 'astronomy_ai',
    name: 'Astronomy & Space AI',
    path: 'Sidebar → Professionals → Astronomy & Space',
    description: 'Curious, inspiring guide to astronomy, stargazing & space SCIENCE (clearly different from the Astrologer AI / cultural entertainment): stargazing & night sky (naked-eye/binoculars/telescope, constellations, planets, Moon phases, meteor showers, what\'s visible from India), astronomy concepts (solar system, stars, galaxies, black holes, star life cycles, gravity, light-years, eclipses, seasons — simple analogies), space exploration (ISRO — Chandrayaan/Mangalyaan/Aditya-L1/Gaganyaan; NASA/ESA; rockets/satellites/NavIC basics), telescopes/gear & beginner astrophotography (→ Photography AI), and learning/careers in astronomy/astrophysics/space sector (→ Mentor/Study-Abroad AIs). Honesty/safety: scientifically accurate (distinguishes established facts from open questions, says "we don\'t fully know yet", never fabricates facts/dates/mission details — verify on ISRO/NASA & sky apps for live timings); science NOT astrology (no fortune/predictive claims; cultural horoscopes → Astrologer AI); SUN-SAFETY critical — never look at the Sun directly or through optics without certified solar filters, only ISO-certified glasses for eclipses (risk of permanent blindness).',
    howToUse: 'Open Sidebar → Professionals → Astronomy & Space and ask: "how do I start stargazing", "explain black holes/galaxies simply", "ISRO\'s space missions", "which telescope for a beginner". Verify live sky timings with a sky app & mission facts on ISRO/NASA; never view the Sun without certified solar filters.',
    relatedFeatures: ['professionals', 'mathscience_ai', 'photography_ai', 'gk_ai'],
    aiSurface: 'astronomy_ai',
    keywords: ['astronomy', 'space', 'stargazing', 'telescope', 'planet', 'star', 'galaxy', 'black hole', 'isro', 'nasa', 'universe', 'khagol', 'rocket', 'eclipse', 'constellation'],
  },

  // ─── CALLIGRAPHY & HAND-LETTERING AI ─────────────────────────────────────
  {
    id: 'calligraphy_ai',
    name: 'Calligraphy & Hand-Lettering AI',
    path: 'Sidebar → Professionals → Calligraphy & Hand-Lettering',
    description: 'Patient guide to beautiful handwriting, calligraphy & hand-lettering for all levels & scripts: handwriting improvement (consistency, spacing, slant, letter shapes, grip/posture, English & Devanagari drills), calligraphy styles & strokes (modern brush, italic, copperplate basics, Devanagari), affordable tools & materials (pencil/brush pens/nibs/markers/paper + substitutes), hand-lettering & projects (cards, quotes, posters, journaling, festive decor → Crafts AI; layout & flourishes), and effective practice drills & progress tracking. Teaching/honesty: encouraging & specific (explains technique, gives step-by-step drills, asks about the issue since it can\'t see the writing — suggests guide sheets & lined/grid paper); mastery comes from short regular practice over weeks (no instant fixes, no single "perfect" style); keeps tools affordable/inclusive; respects copyright/originality in lettering (no passing off trademarked logos/artwork); never fabricates brand claims or guarantees results.',
    howToUse: 'Open Sidebar → Professionals → Calligraphy & Hand-Lettering and ask: "make my handwriting neater", "teach me a calligraphy style & strokes", "beginner tools I need", "lettering ideas for a card/quote". Practise the drills regularly on lined/grid paper; for craft projects pair with the Crafts AI.',
    relatedFeatures: ['professionals', 'crafts_ai', 'writing_ai'],
    aiSurface: 'calligraphy_ai',
    keywords: ['calligraphy', 'handwriting', 'lettering', 'hand lettering', 'writing', 'neat handwriting', 'cursive', 'devanagari', 'brush pen', 'fonts', 'sulekh', 'penmanship', 'art', 'strokes'],
  },

  // ─── DANCE & MOVEMENT AI ─────────────────────────────────────────────────
  {
    id: 'dance_ai',
    name: 'Dance & Movement AI',
    path: 'Sidebar → Professionals → Dance & Movement',
    description: 'Encouraging guide to dance for all ages & levels — classical, folk, Bollywood/freestyle & dance-for-fitness: getting started (finding rhythm/taal, posture, warm-ups, coordination & confidence), styles overview (Bharatanatyam, Kathak, Odissi, Kuchipudi; Garba, Bhangra & folk; Bollywood/contemporary — general character, guru recommended for classical), practice & technique (warm-up/stretch, footwork drills, learning routines in parts, stamina/flexibility/expression, choreography basics), dance fitness (cardio/stress-relief → pairs with Fitness AI), and performance/confidence. Safety/honesty: NOT medical/physiotherapy advice and text can\'t correct form like an in-person teacher (serious classical/technique → qualified guru/instructor); always warm up & never push through sharp/joint pain (rest & see a doctor/physio for injury), learn high-impact moves under a teacher, get medical clearance for health conditions/pregnancy, dance on a safe surface; progress takes consistent practice (no overnight mastery); presents classical/folk forms respectfully & accurately (never fabricates their history/rules); inclusive of every body & age.',
    howToUse: 'Open Sidebar → Professionals → Dance & Movement and ask: "how do I start dancing & find rhythm", "tell me about a dance style", "plan practice for a routine", "fun dance workout for fitness". For serious classical learn from a guru; for injuries see a doctor/physio; pair with Fitness AI for conditioning.',
    relatedFeatures: ['professionals', 'music_ai', 'fitness_ai'],
    aiSurface: 'dance_ai',
    keywords: ['dance', 'dancing', 'nritya', 'bharatanatyam', 'kathak', 'garba', 'bhangra', 'bollywood dance', 'choreography', 'classical dance', 'folk dance', 'dance fitness', 'naach', 'movement'],
  },

  // ─── GAMES, PUZZLES & FAMILY-FUN AI ──────────────────────────────────────
  {
    id: 'games_ai',
    name: 'Games, Puzzles & Family-Fun AI',
    path: 'Sidebar → Professionals → Games, Puzzles & Family-Fun',
    description: 'Fun companion for board/card games, puzzles, brain-teasers & indoor/outdoor activities for families, friends, kids & gatherings: game rules & strategy (Chess, Carrom, Ludo, Snakes & Ladders, Uno, rummy-style, housie/tambola, Antakshari, Dumb Charades, traditional Indian games), game suggestions by group size/ages/time/indoor-outdoor/no-equipment, puzzles/riddles/brain-games/trivia (with hints/answers, pitched to audience), family & party activity ideas (ice-breakers, kids parties, road trips, festivals → Events AI / decor → Crafts AI), and learning a game step by step. Approach/safety: family-friendly, inclusive & good-sportsmanship (fun over winning); kids/physical-game safety (age-appropriate, supervision, small-part choking awareness, safe space; sports → Sports AI); NO gambling/betting — keeps card/dice games friendly & stakes-free, declines gambling tips & notes risks/legality; accurate rules but notes regional/house variations ("a common rule is…") and points to official bodies for competitive play (no fabricated tournament rules).',
    howToUse: 'Open Sidebar → Professionals → Games, Puzzles & Family-Fun and ask: "explain the rules of a game", "suggest games for my group/occasion", "give me riddles & brain-teasers", "plan fun activities for a get-together". For event planning use Events AI; for exam GK/aptitude the GK / Mental Maths AIs.',
    relatedFeatures: ['professionals', 'events_ai', 'gk_ai', 'sports_ai'],
    aiSurface: 'games_ai',
    keywords: ['games', 'board game', 'card game', 'puzzle', 'riddle', 'family fun', 'chess', 'carrom', 'ludo', 'tambola', 'antakshari', 'khel', 'brain teaser', 'party games', 'trivia'],
  },

  // ─── TECH BUYING ADVISOR AI ──────────────────────────────────────────────
  {
    id: 'techbuy_ai',
    name: 'Tech Buying Advisor AI',
    path: 'Sidebar → Professionals → Tech Buying Advisor',
    description: 'Independent, commission-free helper to choose electronics & gadgets in India (phones, laptops, TVs, home appliances — fridge/washer/AC, audio, smartwatches, accessories): match a device to the user\'s needs & budget by asking the right questions, understand specs in plain language & which actually matter vs marketing hype (RAM/processor/storage/display/battery; appliance capacity & BEE star rating; TV panel/resolution), compare options objectively & read reviews critically, value/warranty/timing & running cost, and safe buying. Honesty/safety: NEUTRAL & independent (never pushes a brand for commission, honest about trade-offs); prices/models/specs change fast (won\'t fabricate current prices/exact specs/"latest model" — verify on reliable/official sources before buying); anti-scam (genuine sellers, proper bill/warranty, beware fake deals/counterfeits/used-as-new, never share OTP/card on unverified sites → Cyber Safety AI); budget-respectful (no upselling). For fixing devices use the Gadget & Tech-Help AI.',
    howToUse: 'Open Sidebar → Professionals → Tech Buying Advisor and ask: "which phone/laptop for my needs & budget", "which specs actually matter", "compare these options", "how to buy safely & avoid fakes". Verify current prices/specs/reviews before buying; for repairs use the Gadget & Tech-Help AI.',
    relatedFeatures: ['professionals', 'techhelp_ai', 'cybersafety_ai', 'finance_ai'],
    aiSurface: 'techbuy_ai',
    keywords: ['buy', 'tech', 'gadget', 'phone', 'laptop', 'tv', 'appliance', 'fridge', 'ac', 'washing machine', 'which to buy', 'specs', 'electronics', 'kharidna', 'recommendation'],
  },

  // ─── TREKKING & ADVENTURE-TRAVEL AI ──────────────────────────────────────
  {
    id: 'adventure_ai',
    name: 'Trekking & Adventure-Travel AI',
    path: 'Sidebar → Professionals → Trekking & Adventure-Travel',
    description: 'Enthusiastic, safety-first guide for Indian outdoor adventures — trekking/hiking, camping, road trips & adventure activities: trek/hike planning (by fitness/experience/season, routes & duration concepts, fitness prep, altitude acclimatisation), packing & gear lists (layers, footwear, water, first-aid, navigation; budget basics), road trips & camping (route/stops/timing, vehicle readiness → Vehicle AI, Leave-No-Trace), safety & preparedness (weather/terrain, altitude sickness/AMS awareness, hydration, groups/guides, sharing itinerary, emergency contacts), and adventure activities (rafting/paragliding/scuba — via licensed certified operators only). Safety-first (lives): prioritises safe choices over ambition — go with experienced groups/registered guides, never alone/off-route, check weather/conditions & turn back if worsening, licensed operators + safety briefings for sports; altitude sickness can be life-threatening (descend & get help for serious symptoms), be medically fit for demanding treks; emergencies → local rescue/forest dept/112, first-aid → First-Aid AI; never fabricates difficulty/permits/distances/weather or that something is "safe" (verify current conditions/permits/routes officially & with registered operators; respect protected areas & local rules). For general holiday itineraries use the Travel Planner AI.',
    howToUse: 'Open Sidebar → Professionals → Trekking & Adventure-Travel and ask: "suggest a trek for my fitness & season", "make a trek/camping packing list", "plan a safe road trip", "altitude sickness & outdoor safety". Verify conditions/permits with official & local sources; go with registered guides and use only licensed adventure operators.',
    relatedFeatures: ['professionals', 'travel_ai', 'vehicle_ai', 'firstaid_ai', 'nature_ai'],
    aiSurface: 'adventure_ai',
    keywords: ['trekking', 'trek', 'hiking', 'adventure', 'camping', 'road trip', 'mountains', 'himalaya', 'outdoor', 'altitude', 'rafting', 'paragliding', 'safari', 'backpacking', 'yatra'],
  },

  // ─── HOME-BUDGET & FRUGAL-LIVING AI ──────────────────────────────────────
  {
    id: 'budget_ai',
    name: 'Home-Budget & Frugal-Living AI',
    path: 'Sidebar → Professionals → Home-Budget & Frugal-Living',
    description: 'Practical, judgement-free helper for everyday household money management: budgeting (simple monthly budget, 50/30/20 & envelope methods, tracking spends), cutting everyday expenses (groceries, bills, subscriptions, eating out, impulse buys), saving habits (pay-yourself-first, emergency fund, goal-based saving), managing bills & debt generally (due dates, clearing high-interest debt, not overspending on EMIs/credit), frugal living (smart shopping, reuse/repair, energy/water saving), and family money (budgeting together, teaching kids, irregular income). Honesty/approach: practical & non-judgemental (small doable steps, no shaming — frugality should reduce stress not cause misery); everyday money-management NOT investment/tax/personalised advice (investing → Finance AI, tax → CA AI, stocks → Stock-Market AI, serious distress → a professional); anti-scam (save/earn-fast & high-return schemes → Cyber Safety AI); no product recommendations/guarantees; never fabricates prices/numbers.',
    howToUse: 'Open Sidebar → Professionals → Home-Budget & Frugal-Living and ask: "make a monthly budget", "cut my expenses", "build a saving habit & emergency fund", "budgeting for irregular income". For investing use the Finance AI, tax the CA AI.',
    relatedFeatures: ['professionals', 'finance_ai', 'accountant_ai', 'environment_ai'],
    aiSurface: 'budget_ai',
    keywords: ['budget', 'budgeting', 'save money', 'expenses', 'frugal', 'household', 'monthly budget', 'emergency fund', 'cut costs', 'bachat', 'kharcha', 'saving', 'money management', 'cheap living'],
  },

  // ─── GITHUB REPO ANALYST & IMPROVER AI ───────────────────────────────────
  {
    id: 'repo_analyst',
    name: 'GitHub Repo Analyst & Improver AI',
    path: 'Sidebar → Professionals → GitHub Repo Analyst & Improver',
    description: 'Expert that analyses PUBLIC GitHub repositories for real (read-only) and gives an honest, actionable report & improvement plan: paste a public repo URL (or owner/repo) and it fetches the actual repo — metadata, license, languages, README, file tree & key files — then reports the overview & tech stack, strengths (good patterns to learn from), gaps/weaknesses (missing tests/docs/CI/error handling/structure), visible security & quality flags (noted as a partial view), the license & what it permits, and a prioritised improvement plan with short adoptable code snippets. License-respecting ("copy good things" = LEARN patterns & write your own original code, comply with & attribute per the actual LICENSE — MIT/Apache vs GPL-copyleft vs no-license/default-copyright; general info, not legal advice). Honesty: works only from the real fetched content (says when files/tree are truncated or missing, never invents repo contents/metrics/vulnerabilities); analyses & ADVISES only — cannot push changes to repos you don\'t own (no write access), so "improve" = the plan/guidance/snippets for you to apply in your own fork (suggests Engineer AI to build it out). Works on public repos without a token (rate-limited); handles not-found/private/rate-limit gracefully.',
    howToUse: 'Open Sidebar → Professionals → GitHub Repo Analyst & Improver and paste a public GitHub repo URL (or owner/repo), then ask: "analyse this repo", "strengths & gaps?", "security/quality issues you can see?", "a prioritised improvement plan". It fetches and analyses the real repo (read-only). To then build the improvements, use the Engineer AI.',
    relatedFeatures: ['professionals', 'engineer_ai', 'coding_ai'],
    aiSurface: 'repo_analyst',
    keywords: ['github', 'repo', 'repository', 'analyse', 'analyze', 'code review', 'open source', 'improve repo', 'audit', 'codebase', 'project review', 'github url', 'license', 'repo analyst'],
  },

  // ─── PRO CHAT ─────────────────────────────────────────────────────────────
  {
    id: 'pro_chat',
    name: 'NavBharatAI Pro Chat',
    path: 'Home → Pro Chat button  OR  Header → Pro Chat tab',
    description: `The Pro app-maker chat with three modes:
• CONVERSATION mode — discuss ideas, plan features, ask questions. The AI answers but does NOT build yet.
• BUILD mode — describe an app, click Build, and it generates a complete working HTML/CSS/JS app in seconds, shown live on the canvas.
• CANVAS EDIT mode — when an app is already on the canvas, ask to change it and the AI patches the code precisely, preserving everything you didn't ask to change.
Also supports: file attachments (text, code), image analysis (vision), and PDF reading.`,
    howToUse: 'From Home, click Pro Chat. Type your app idea and click Build to generate the app. Once it appears on the canvas, ask follow-up changes directly.',
    relatedFeatures: ['free_chat', 'ide', 'engineer_ai'],
    aiSurface: 'pro_chat',
    keywords: ['pro chat', 'pro', 'build mode', 'canvas', 'app maker', 'make app', 'generate app', 'html app', 'generate code', 'app generate karo'],
  },
  {
    id: 'unified-workspace',
    name: 'Unified Workspace — Chat + Live Code + Preview (Phase 3.1)',
    path: 'Pro Chat → build an app → live workspace docks on the right (desktop)',
    description: `World-class "Chat IS the IDE" surface, like Cursor / Bolt / v0 / Lovable. Once an app exists, a live workspace panel docks to the RIGHT of the Pro Chat conversation so you never switch tabs while building:
• PREVIEW tab — the running app, live, updating as the AI edits files.
• CODE tab — a file list + full Monaco editor; edit any file directly, changes sync instantly.
• STUDIO button — opens the full Code Studio IDE for power users.
• DEPLOY button — one-click deploy straight from the workspace.
• "Hide app" / "Show app" toggle in the chat header collapses or restores the workspace.
On mobile the chat stays full-width and Preview/Code remain separate tabs (via the Preview-ready banner). The workspace appears automatically after the first successful build.`,
    howToUse: 'Open Pro Chat and build any app. On desktop, the live workspace appears on the right automatically. Switch between Preview and Code tabs at the top of that panel. Edit files directly in the Code tab. Use "Hide app" in the chat header to focus on the conversation, "Show app" to bring it back.',
    relatedFeatures: ['pro_chat', 'ide', 'auto-test-generation', 'build-version-history'],
    aiSurface: 'pro_chat',
    keywords: [
      'workspace', 'split view', 'chat and code', 'live editor', 'side by side', 'ide',
      'code editor', 'preview pane', 'cursor', 'bolt', 'v0', 'lovable', 'monaco',
      'edit code', 'live preview', 'show app', 'hide app', 'split screen', 'two pane',
      'code aur preview', 'ek saath', 'editor kahan', 'where is code', 'unified',
    ],
  },
  {
    id: 'pro_chat_file_upload',
    name: 'Pro Chat — File & Image Upload',
    path: 'Pro Chat → paperclip / attachment icon in the chat input',
    description: 'Upload files to Pro Chat for AI analysis. Supported: images (PNG, JPG, WebP — visual analysis and description), PDFs (full text extraction and Q&A), text/code files (review, explain, modify).',
    howToUse: 'Click the attachment icon in Pro Chat, select a file, then type your question about it.',
    relatedFeatures: ['pro_chat', 'free_chat_file_analysis'],
    aiSurface: 'pro_chat',
    keywords: ['upload file', 'attach file', 'pdf', 'image upload', 'file attachment', 'vision', 'analyze image', 'read pdf'],
  },

  // ─── FREE CHAT ────────────────────────────────────────────────────────────
  {
    id: 'free_chat',
    name: 'Free Chat (NavBharatAI)',
    path: 'Sidebar → Reports  OR  Header → Reports tab',
    description: `General-purpose AI chat. Capabilities:
• Answers questions on any topic — science, history, coding, finance, law, etc.
• Explains concepts in any language (Hindi, English, Hinglish, Tamil, Telugu, Bengali, Marathi, Punjabi, and more).
• Analyzes documents (PDF/text files), describes images, reviews code.
• Remembers conversation context within a session.
• Responds in the SAME language and tone the user writes in — Hindi reply for Hindi input, English for English, etc.
NOTE: Does NOT build apps (use Pro Chat or Engineer AI for that).`,
    howToUse: 'Open Reports from the sidebar and type your question in any language.',
    relatedFeatures: ['pro_chat', 'history', 'free_chat_file_analysis'],
    aiSurface: 'nbi_chat',
    keywords: [
      'free chat', 'reports', 'general chat', 'ask question', 'chat', 'conversation',
      'question answer', 'help', 'explain', 'kya hai', 'bataiye', 'samjhao',
      'hindi chat', 'language', 'translate',
    ],
  },
  {
    id: 'free_chat_file_analysis',
    name: 'Free Chat — File, Image & PDF Analysis',
    path: 'Sidebar → Reports → attachment icon in the chat input',
    description: 'Attach files to the free chat for analysis. Images: visual description, object recognition, text extraction (OCR). PDFs: full text reading, summarization, Q&A. Code/text files: explanation, review, debugging help.',
    howToUse: 'In the Free Chat (Reports), click the attachment icon, select your file, then ask your question about it.',
    relatedFeatures: ['free_chat', 'pro_chat_file_upload'],
    aiSurface: 'nbi_chat',
    keywords: ['pdf analysis', 'image analysis', 'file upload', 'attach', 'ocr', 'document', 'photo upload', 'analyze pdf', 'analyze image'],
  },

  // ─── IDE / CODE STUDIO ────────────────────────────────────────────────────
  {
    id: 'ide',
    name: 'IDE / Code Studio',
    path: 'Sidebar → IDE  OR  Header → IDE tab',
    description: `Full in-browser development environment. Panels:
• FILES — file explorer: browse, create, rename and delete files. Delete one file (trash icon) or use the Select button to multi-select / Select All and delete many at once — always with a confirmation dialog before anything is removed.
• EDITOR — syntax-highlighted code editor for all file types (TypeScript, React, Python, HTML, CSS, etc.).
• PREVIEW — live preview of the running app with hot-reload.
• PROBLEMS — real compile-error panel: when the live preview bundle fails, it lists the actual errors esbuild reported (file · line · message); click a problem to jump to that line in the editor. An empty list means the app genuinely compiled. Open it from the amber problem-count badge (bottom-right) or the "view problems" command.
• TERMINAL — a REAL terminal: each command runs in YOUR v3.0 sandbox and shows the actual stdout/stderr (e.g. ls, cat package.json, npm run build, node -v). Each command is bounded by a 30-second timeout with capped output (no runaway processes), and ↑/↓ recall your command history. It needs a warm sandbox — start or continue a build in NavBharatAI Pro v3.0 to activate it; until then it honestly says the sandbox isn't active (it never fakes output). Type "clear" to clear the screen.
• GIT — version control panel: commit, push, pull, view diffs.
• LOGS — build and runtime output for debugging.
• SETTINGS — workspace and IDE configuration.`,
    howToUse: 'Open IDE from the sidebar. Use the panel tabs (Files, Editor, Preview, Problems, Terminal, Git, Logs) to develop your project. The Terminal runs real commands in your v3.0 sandbox (start a build first to activate it). When the preview fails to compile, open Problems (amber badge, bottom-right) to see the real errors and click one to jump to the line.',
    relatedFeatures: ['settings_git', 'settings_terminal', 'settings_logs', 'pro_chat'],
    keywords: [
      'ide', 'code studio', 'editor', 'code', 'files', 'preview', 'terminal', 'shell',
      'file explorer', 'code editor', 'git panel', 'build output', 'live preview',
      'problems', 'problems panel', 'errors', 'compile errors', 'error list', 'galti', 'error kahan hai',
    ],
  },
  {
    id: 'ide_terminal',
    name: 'IDE Terminal / Shell',
    path: 'IDE → Terminal tab  OR  Settings → App Settings → Terminal',
    description: 'A full bash shell inside your workspace. Run npm scripts, install packages, git commands, file operations, or any shell command. Supports multi-line output and scrollback.',
    howToUse: 'Open IDE → Terminal tab and type your command. Press Enter to run.',
    relatedFeatures: ['ide', 'settings_terminal', 'settings_logs'],
    keywords: ['terminal', 'shell', 'command line', 'bash', 'console', 'npm', 'run command', 'command chalao', 'npm install'],
  },
  {
    id: 'ide_git',
    name: 'IDE Git Panel',
    path: 'IDE → Git tab',
    description: 'Visual git interface inside the IDE. Stage files, write commit messages, commit, push to remote, pull changes, and view the diff of modified files. Requires GITHUB_TOKEN in Secrets & Keys for GitHub operations.',
    howToUse: 'Open IDE → Git tab. Stage changed files, write a commit message, and click Commit & Push.',
    relatedFeatures: ['ide', 'settings_git', 'settings_secrets'],
    keywords: ['git panel', 'git commit', 'git push', 'git pull', 'git diff', 'stage files', 'version control panel', 'ide git', 'commit code'],
  },
  {
    id: 'ide_preview',
    name: 'IDE Live Preview',
    path: 'IDE → Preview tab',
    description: 'Real-time preview of your app running in the browser, with hot-reload on file save. Shows the app at localhost:3000 (or your configured port) inside an iframe.',
    howToUse: 'After starting a dev server (e.g. npm run dev), open IDE → Preview tab to see the live app.',
    relatedFeatures: ['ide', 'pro_chat'],
    keywords: ['preview', 'live preview', 'hot reload', 'browser preview', 'see app', 'run app', 'app dekho'],
  },
  {
    id: 'code-testing-panel',
    name: 'Code Studio — Test Panel',
    path: 'Code Studio → Testing tab',
    description: 'Run a suite of automatic checks against the generated app (render checks, key element presence, basic interaction smoke tests) and see pass/fail status per test. Complements the auto-generated Vitest files by giving an in-browser quick check without leaving the IDE.',
    howToUse: 'Open Code Studio, switch to the Testing tab, and run the checks. Green = pass, red = fail with the reason shown.',
    relatedFeatures: ['ide', 'auto-test-generation', 'ide_preview'],
    keywords: ['test panel', 'run tests', 'testing tab', 'check app', 'test cases', 'qa', 'verify app', 'test karo', 'app test'],
  },
  {
    id: 'api-tester',
    name: 'Code Studio — API Tester',
    path: 'Code Studio → API tab',
    description: 'A built-in HTTP client (like a mini Postman) to test your app\'s API endpoints: choose method (GET/POST/PUT/DELETE), set URL, headers and body, send the request, and inspect the response status, headers, and JSON body.',
    howToUse: 'Open Code Studio → API tab. Enter the endpoint URL, pick the method, add any headers/body, then Send to see the live response.',
    relatedFeatures: ['ide', 'ide_terminal', 'settings_database'],
    keywords: ['api tester', 'http client', 'postman', 'test api', 'endpoint', 'rest', 'request', 'api call', 'fetch test', 'api test karo'],
  },
  {
    id: 'project-templates',
    name: 'Project Blueprints & Templates Gallery',
    path: 'Sidebar → Templates  OR  Code Studio → Templates',
    description: 'A gallery of ready-to-build Project Blueprints (including Bharat-first templates: UPI Payment App, Hindi Language App, GST Invoice Generator, Startup Registration Tracker) plus your own saved templates. Selecting a blueprint loads a detailed starter prompt so you can build it instantly.',
    howToUse: 'Open Templates from the sidebar, browse the blueprint cards, and click one to start building from it. Save your own current project as a reusable template from the same panel.',
    relatedFeatures: ['pro_chat', 'quick-start-gallery', 'engineer_ai'],
    keywords: ['templates', 'blueprints', 'project templates', 'starter', 'examples', 'upi', 'gst', 'hindi app', 'startup', 'my templates', 'template gallery', 'readymade', 'banaya banaya'],
  },

  // ─── PROFESSIONALS HUB ───────────────────────────────────────────────────
  {
    id: 'professionals',
    name: 'Professionals Hub',
    path: 'Sidebar → Professionals',
    description: 'The hub for specialized professional AI assistants. Currently hosts Doctor AI (clinical decision support) and Engineer AI (autonomous app builder). Future AI assistants will appear here. Every config-driven professional (Teacher, Lawyer, CA, Mentor, etc.) supports FILE ATTACHMENTS: click the paperclip (or paste a file) to send images, PDFs, Word/Excel/PowerPoint documents, ZIPs, or text/code files — the AI reads their real content and answers about them.',
    howToUse: 'Open Professionals from the sidebar, then choose the AI specialist you need. To share a file, click the paperclip button next to the message box (up to 4 files, 10 MB each) or paste an image directly.',
    relatedFeatures: ['doctor_ai', 'engineer_ai'],
    keywords: ['professionals', 'specialists', 'experts', 'professional ai', 'specialist ai', 'doctor ai engineer ai', 'attach file', 'upload file', 'send photo', 'send pdf', 'file bhejo', 'photo bhejo', 'document upload'],
  },

  // ─── SETTINGS ─────────────────────────────────────────────────────────────
  {
    id: 'settings_root',
    name: 'Settings',
    path: 'Sidebar → Settings  OR  Header → Settings tab',
    description: 'The settings hub. Organized into groups: App Settings (General, Secrets & Keys, Database, Git, Terminal, Logs), AI Tools (Modules / Brain Engine), Developer Tools, Design & Build, Publish & Deploy, and Monetization & Team.',
    howToUse: 'Open Settings from the sidebar, then pick the group and sub-item you need.',
    relatedFeatures: ['settings_database', 'settings_secrets', 'settings_general', 'settings_modules', 'settings_git'],
    keywords: ['settings', 'options', 'configuration', 'preferences', 'config', 'setting kahan', 'settings kahan hai'],
  },
  {
    id: 'settings_reduce_motion',
    name: 'Motion Preference (Animations)',
    path: 'Settings → App Settings → General → Accessibility → "Motion"',
    description: 'Controls on-screen motion with three choices: On (default — animations like the waving Indian flag shown while an agent works), Reduced (minimise all motion across the app, for comfort or motion sensitivity), and System (automatically follow your device\'s "reduce motion" accessibility setting). The choice is saved on your device and re-applied on every load with no flash of motion.',
    howToUse: 'Open Settings → App Settings → General → Accessibility, find "Motion", and pick On, Reduced, or System. Reduced makes the waving flag static and minimises every animation; System follows your OS setting; On (default) keeps animations.',
    relatedFeatures: ['settings_general', 'settings_root', 'settings_font_scale'],
    keywords: ['animation', 'animations', 'reduce motion', 'reduce animations', 'motion', 'flag', 'tiranga', 'waving flag', 'turn off animation', 'disable animation', 'animation band karo', 'animation off', 'motion kam karo', 'prefers reduced motion', 'match system motion', 'accessibility'],
  },
  {
    id: 'settings_font_scale',
    name: 'Text Size (Font Scaling / Zoom)',
    path: 'Settings → App Settings → General → Accessibility → "Text Size"',
    description: 'Scales the entire interface up or down for readability, in steps between 90% and 140%. Use A− / A+ to adjust and Reset to return to 100%. Because the whole app is built with relative (rem) sizing, this acts as a real accessibility zoom for the platform UI — helpful for low-vision users or small screens. The chosen size is saved on your device and re-applied on every load.',
    howToUse: 'Open Settings → App Settings → General → Accessibility, find "Text Size", and tap A− to shrink or A+ to enlarge (90%–140%); the live percentage updates. Tap Reset to go back to 100%.',
    relatedFeatures: ['settings_general', 'settings_root', 'settings_reduce_motion'],
    keywords: ['text size', 'font size', 'font scale', 'zoom', 'bigger text', 'larger text', 'smaller text', 'increase font', 'text bada karo', 'font bada', 'zoom in', 'zoom out', 'readability', 'accessibility', 'low vision', 'a11y'],
  },
  {
    id: 'team_collaboration',
    name: 'Team Collaboration (Invite Members)',
    path: 'Settings → Team',
    description: 'Invite people to your team and manage members. Enter a teammate\'s email and pick a role (Admin / Editor / Viewer) to create a durable, shareable invite LINK — invites are saved on the backend (not just your browser) and no longer vanish on logout. Copy the link and share it; when the person opens it while signed in, they accept and join your team, and their role is applied to the app\'s access control. You can revoke a pending invite (the link stops working) or remove a member. Note: NavBharatAI shares an invite LINK rather than sending an email (no email delivery yet) — the link is the real, working invitation.',
    howToUse: 'Open Settings → Team. Type the teammate\'s email, choose a role, and select Invite — an invite link is created under "Pending Invites". Tap the copy icon to copy it and share it (chat, email, anywhere). To cancel, tap the ✕ to revoke it. To accept an invite you received, open the link while signed in and choose "Accept invite".',
    relatedFeatures: ['settings_root', 'live_collaboration'],
    keywords: ['team', 'invite', 'invite member', 'add member', 'collaborate', 'collaboration', 'team member', 'share access', 'invite link', 'accept invite', 'join team', 'team banao', 'member add karo', 'invite bhejo', 'role', 'admin', 'editor', 'viewer', 'permissions'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'live_collaboration',
    name: 'Live Collaboration (Real-Time Room)',
    path: 'Settings → Live Collab',
    description: 'A real-time room where teammates edit the same code together over Firestore. Create a room to get a Room ID, share it, and others join with it. Everyone sees the shared code update live, plus: room CHAT, a presence list of who is online, LIVE CURSORS (each teammate\'s current line is shown next to their name), and LINE-ANCHORED COMMENTS (leave a note pinned to a specific line; click a comment to jump to that line; resolve it when done). Code sync is last-write-wins with a short debounce (no CRDT — kept dependency-free by design).',
    howToUse: 'Open Settings → Live Collab. Tap "New Room" (or paste a Room ID and Join). Share the Room ID with teammates. Type in the shared editor — all members see it live and their cursor line appears in the Online list. To comment, place your cursor on a line, type in the "Comment on line N" box, and Add; teammates see it and can jump to that line or resolve it. Use Chat for quick messages; Leave to exit.',
    relatedFeatures: ['team_collaboration', 'settings_root'],
    keywords: ['live collaboration', 'live collab', 'real time', 'realtime', 'room', 'room id', 'collaborate live', 'code together', 'pair programming', 'live cursor', 'cursors', 'presence', 'line comment', 'annotation', 'comment on code', 'share code live', 'saath me code', 'ek saath', 'collaboration room'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'share_for_review',
    name: 'Share for Review (Client / Stakeholder Portal)',
    path: 'Deploy panel → Deploy tab → "Share for review"',
    description: 'Share your built app READ-ONLY with a client or stakeholder who has no account, and collect their feedback/approval. Creating a review link snapshots the current app and gives you a link like navbharat.ai/?review=<token>. When the person opens it, they see the app running read-only (in a safe sandbox) with a feedback bar to Approve / Request changes / Reject plus a comment. Their responses come back to you under "View feedback". You can Revoke the link anytime (it stops working). No email is sent — you share the link yourself; links expire after 30 days.',
    howToUse: 'Open the Deploy panel (Deploy tab). In the "Share for review" card, tap "Create review link", then Copy it and send it to your client. They open it, pick Approve / Request changes / Reject, add a comment, and Send. Tap "View feedback" to read their responses, or "Revoke link" to disable it.',
    relatedFeatures: ['team_collaboration', 'live_collaboration', 'settings_root'],
    keywords: ['share', 'share app', 'review', 'review link', 'client', 'stakeholder', 'feedback', 'approval', 'approve', 'read only', 'read-only preview', 'share for review', 'client feedback', 'sign off', 'demo link', 'show client', 'client ko dikhao', 'feedback lo', 'approval lo', 'share portal'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'settings_database',
    name: 'Database Settings (Bring Your Own Database)',
    path: 'Settings → App Settings → Database',
    description: 'Connect your own database provider to use in Engineer AI-built apps. Supported providers: Supabase (PostgreSQL + auth + storage), Firebase (Firestore + Auth + Storage), MongoDB, Neon (serverless Postgres), Appwrite, or a custom connection string. A direct link to the provider\'s API-key page is shown after you select the provider. NavBharatAI NEVER stores your app data — all data stays in your own account.',
    howToUse: 'Settings → Database → select your provider → a link to their API-key page appears → paste your URL/API keys → Save. Engineer AI then scaffolds the SDK setup automatically for that provider.',
    relatedFeatures: ['engineer_ai', 'settings_secrets'],
    keywords: [
      'database', 'db', 'supabase', 'firebase', 'mongodb', 'neon', 'appwrite',
      'byod', 'connect database', 'database credentials', 'database kahan', 'db settings',
      'database key', 'api key database', 'connection string',
    ],
  },
  {
    id: 'settings_secrets',
    name: 'Secrets & Keys',
    path: 'Settings → App Settings → Secrets & Keys',
    description: 'A secure per-user key store for API tokens. Commonly stored: GITHUB_TOKEN (Engineer AI reads this to clone and push private repos), OPENAI_API_KEY, STRIPE_SECRET_KEY, etc. Keys are scoped to your account and never shared.',
    howToUse: 'Settings → Secrets & Keys → type the key name (e.g. GITHUB_TOKEN) → paste the value → Save. Engineer AI reads relevant secrets automatically.',
    relatedFeatures: ['engineer_ai', 'settings_git', 'engineer_ai_github'],
    keywords: ['secrets', 'keys', 'api key', 'token', 'github token', 'credentials', 'secret store', 'key store', 'GITHUB_TOKEN'],
  },
  {
    id: 'settings_general',
    name: 'General Settings',
    path: 'Settings → App Settings → General',
    description: 'App-level configuration: app name, app description, device/preview mode (mobile/tablet/desktop), developer mode toggle, and language preferences.',
    howToUse: 'Settings → General to change the app name, toggle developer mode, or switch device preview mode.',
    relatedFeatures: ['settings_root'],
    keywords: ['general settings', 'app name', 'language', 'developer mode', 'device mode', 'preview mode', 'general'],
  },
  {
    id: 'settings_modules',
    name: 'Brain Engine / Modules (AI Provider Keys)',
    path: 'Settings → Modules',
    description: 'Configure your own AI provider API credentials to power the app\'s AI features. Supported providers: Gemini (Google), OpenAI (GPT-4), Groq, DeepSeek, OpenRouter, Claude (Anthropic). Also controls which workspace panels are visible.',
    howToUse: 'Settings → Modules → paste the API key for your preferred AI provider. The app will use your key for AI responses.',
    relatedFeatures: ['settings_secrets', 'settings_root'],
    keywords: ['modules', 'brain engine', 'ai keys', 'gemini', 'openai', 'gpt', 'claude', 'groq', 'deepseek', 'openrouter', 'ai provider', 'api key', 'ai model'],
  },
  {
    id: 'settings_git',
    name: 'Git Settings',
    path: 'Settings → App Settings → Git',
    description: 'Configure GitHub integration for the workspace: connect a GitHub repository, set the default branch, and manage git credentials. Pair with GITHUB_TOKEN in Secrets & Keys for private repos.',
    howToUse: 'Settings → Git → connect your repository URL. Add GITHUB_TOKEN in Secrets & Keys for push/pull access.',
    relatedFeatures: ['settings_secrets', 'ide_git', 'engineer_ai_github'],
    keywords: ['git settings', 'github settings', 'git configuration', 'repo settings', 'connect github', 'git config', 'github repository'],
  },
  {
    id: 'settings_terminal',
    name: 'Terminal Settings',
    path: 'Settings → App Settings → Terminal  (also IDE → Terminal tab)',
    description: 'Shell access to the workspace. Run npm scripts, install packages, git commands, or any bash command. Also accessible directly from IDE → Terminal tab.',
    howToUse: 'Open Terminal from Settings or IDE → Terminal tab. Type a command and press Enter.',
    relatedFeatures: ['ide_terminal', 'settings_logs'],
    keywords: ['terminal settings', 'shell', 'command line', 'console', 'bash', 'terminal'],
  },
  {
    id: 'settings_logs',
    name: 'Logs',
    path: 'Settings → App Settings → Logs  (also IDE → Logs tab)',
    description: 'View build logs, runtime errors, and server output for debugging. Shows the last N lines of stdout/stderr from the workspace.',
    howToUse: 'Settings → Logs (or IDE → Logs tab) to inspect recent build and runtime output.',
    relatedFeatures: ['ide', 'settings_terminal'],
    keywords: ['logs', 'log', 'debug', 'build log', 'runtime log', 'errors', 'output', 'log kahan'],
  },

  // ─── HISTORY ──────────────────────────────────────────────────────────────
  {
    id: 'history',
    name: 'History',
    path: 'Sidebar → History  OR  Header → History tab',
    description: 'Your saved chat and build session history. Shows past conversations with Free Chat, Pro Chat, Engineer AI, and Doctor AI. Click any entry to resume where you left off. Engineer AI sessions show the workspace files and preview URL from that session.',
    howToUse: 'Open History from the sidebar to browse previous sessions. Click a session to open it.',
    relatedFeatures: ['engineer_ai', 'doctor_ai', 'pro_chat', 'free_chat'],
    keywords: ['history', 'past chats', 'previous session', 'old chat', 'resume', 'saved sessions', 'purani chat', 'history kahan'],
  },

  // ─── BILLING / DONATE / AUTH ──────────────────────────────────────────────
  {
    id: 'billing',
    name: 'Billing & Plan',
    path: 'Settings → Billing  OR  Header → user area',
    description: 'View your current subscription plan (Free / Pro / VIP), usage statistics, payment options, and This Month\'s AI Cost — a running total of estimated AI spend across all Pro builds in the current calendar month.',
    howToUse: 'Open Billing to check your plan, view remaining credits, see monthly AI cost, or upgrade.',
    relatedFeatures: ['settings_root', 'donate'],
    keywords: ['billing', 'plan', 'subscription', 'usage', 'payment', 'pricing', 'upgrade', 'credits', 'pro plan', 'free plan', 'monthly cost', 'ai cost', 'monthly ai cost', 'build cost', 'how much spent'],
  },
  {
    id: 'donate',
    name: 'Donate',
    path: 'Sidebar → Donate',
    description: 'Support NavBharatAI through a voluntary donation to help keep the service running and improve features.',
    howToUse: 'Open Donate from the sidebar to contribute.',
    relatedFeatures: ['billing'],
    keywords: ['donate', 'donation', 'support', 'contribute', 'help', 'fund'],
  },
  {
    id: 'my_profile',
    name: 'My Profile',
    path: 'Top-right avatar → My Profile  OR  Settings → Account → My Profile',
    description: 'Personal profile page showing: (1) Avatar (auto-loaded from Google/GitHub or a custom URL), display name, bio, phone — all editable. (2) Wallet summary: current INR balance, this month\'s spend, and a monthly budget cap. (3) Full build history with This Week / This Month / Custom date range tabs — each row shows build title, date, duration, file count, cost charged, and status (Completed / Failed / Cancelled). (4) Quick links to Add Balance (Billing) and App Settings. (5) Sign Out button.',
    howToUse: 'Click your profile photo (or initials circle) in the top-right corner of the header → select "My Profile" from the dropdown. Or: open Settings → Account → My Profile. On the profile page: click "Edit" to update name / bio / phone / photo URL; click "Set a limit" under Monthly Budget to cap monthly spend; use the period tabs in Build History to filter by week, month, or a custom date range.',
    relatedFeatures: ['billing', 'login_auth', 'settings_root'],
    keywords: ['profile', 'my profile', 'account', 'avatar', 'photo', 'display name', 'bio', 'phone', 'edit profile', 'build history', 'usage history', 'wallet balance', 'budget limit', 'monthly budget', 'spend cap', 'billing history', 'cost history', 'completed builds', 'failed builds', 'cancelled builds', 'profile page', 'apna profile', 'mera account', 'kharcha dekho', 'balance dekho', 'history dekho'],
  },
  {
    id: 'login_auth',
    name: 'Login / Sign Up',
    path: 'Header → Login button (top right)',
    description: 'Sign in or create a NavBharatAI account. Authentication is required to save sessions, use Engineer AI, access Pro features, and store settings. Four ways to sign in: (1) Email + Password, (2) Phone number (OTP), (3) Sign in with Google, (4) Continue with GitHub. GitHub sign-in also connects your repositories (repo + workflow scope) so NavBharatAI can build, commit, and deploy your apps directly to your GitHub.',
    howToUse: 'Click the Login button in the top-right of the header. Choose Email or Phone for a NavBharatAI account, or use "Sign in with Google" / "Continue with GitHub" under "or continue with". GitHub will ask permission to access your repositories — granting it lets NavBharatAI push your generated apps to your own GitHub.',
    relatedFeatures: ['history', 'settings_root'],
    keywords: ['login', 'sign in', 'sign up', 'register', 'account', 'auth', 'logout', 'email login', 'phone login', 'otp', 'mobile login', 'google login', 'google sign in', 'sign in with google', 'github login', 'github sign in', 'connect github', 'login kaise', 'account kahan', 'google se login'],
  },
  {
    id: 'app_navigation',
    name: 'App Navigation Overview',
    path: 'Header (top bar with tabs)  OR  Sidebar (left panel)',
    description: `How to navigate NavBharatAI:
• HEADER TABS (top bar) — click to open: Home, Pro Chat, Reports (Free Chat), IDE, Engineer AI, Doctor AI, History, Settings, Donate.
• SIDEBAR (left panel, desktop) — same items listed as links.
• MOBILE — tap the hamburger (≡) icon in the top-left to open the sidebar menu.
• BACK BUTTON — appears when you've navigated deeper; click to go back one level.
• TABS are pinned — multiple screens open at once like browser tabs.`,
    howToUse: 'Use the header tabs or sidebar links to switch between sections. On mobile, tap the hamburger menu to open navigation.',
    relatedFeatures: ['settings_root', 'history', 'professionals'],
    keywords: [
      'navigation', 'menu', 'sidebar', 'header', 'where is', 'kahan hai', 'kaise jaye',
      'open', 'go to', 'find', 'navigate', 'back button', 'tabs', 'hamburger menu', 'mobile menu',
    ],
  },

  // ─── PRO CHAT — NEW CAPABILITIES (Phases 68-100) ─────────────────────────

  {
    id: 'pro_chat_extended_thinking',
    name: 'Pro Chat — Extended Thinking (Complex Tasks)',
    path: 'Pro Chat → just describe a complex task (auto-detected)',
    description: `Pro Chat automatically detects complex tasks (full-stack apps, multi-system architecture, OAuth, real-time features, enterprise scale) and activates Claude Opus extended reasoning (16k token thinking budget). No setting needed — the AI decides when deep reasoning is required. You will see a "🧠 Complex task detected — using extended reasoning…" status message when active.`,
    howToUse: 'Describe a complex app (e.g. "Build a full-stack SaaS with OAuth and Stripe payments") and Pro will automatically use extended thinking for deeper architectural reasoning.',
    relatedFeatures: ['pro_chat', 'pro_chat_planner'],
    aiSurface: 'pro_chat',
    keywords: ['extended thinking', 'deep reasoning', 'complex task', 'thinking budget', 'opus thinking', 'architecture decision'],
  },
  {
    id: 'pro_chat_planner',
    name: 'Pro Chat — Build Planner (Step-by-Step Progress)',
    path: 'Pro Chat → submit a build request → see step progress bar',
    description: `For large builds, Pro Chat shows a live step-by-step progress bar. The AI plans the build first (e.g. "Scaffold files → Install deps → Build UI → Add auth → Integrate DB"), then works through each step. Each step shows: name, current status (pending/working/done), and a reasoning snippet from the AI's chain-of-thought. The reasoning shows WHY the AI is taking the next action.`,
    howToUse: 'Submit a multi-component build request. The progress panel shows each step as the AI works. Reasoning snippets appear under each running step to show the AI\'s thought process.',
    relatedFeatures: ['pro_chat', 'pro_chat_extended_thinking'],
    aiSurface: 'pro_chat',
    keywords: ['build planner', 'step progress', 'plan', 'steps', 'progress bar', 'thinking', 'reasoning', 'chain of thought'],
  },
  {
    id: 'pro_chat_session_memory',
    name: 'Pro Chat — Cross-Session Memory',
    path: 'Pro Chat → automatic (no user action needed)',
    description: `Pro Chat remembers your project across sessions — even after closing the browser or switching devices. It stores: rolling build summary, edit log (what changed in each turn), architectural decisions, and user preferences in Firestore. On the next session with the same project, Pro already knows the stack, past decisions, and recent changes. It will NOT undo things you already built.`,
    howToUse: 'Just continue building. Pro automatically loads previous session memory at the start of each build request. No setup needed — works as long as you use the same Pro session.',
    relatedFeatures: ['pro_chat', 'pro_chat_planner', 'history'],
    aiSurface: 'pro_chat',
    keywords: ['session memory', 'remember', 'persistent memory', 'cross session', 'project memory', 'context', 'remember project', 'past builds', 'yaad rakhna'],
  },
  {
    id: 'pro_chat_design_to_code',
    name: 'Pro Chat — Design-to-Code (Image → UI)',
    path: 'Pro Chat → attach a design image → describe the app',
    description: `Upload a Figma export, screenshot, or UI mockup alongside your build request. Claude Opus vision analyzes the design image and generates React/CSS code that matches the visual layout, colors, and component structure. Supports up to 4 design images per request.`,
    howToUse: 'In Pro Chat, attach a design image (Figma screenshot, UI mockup, wireframe) using the attachment icon, then type your build prompt (e.g. "Build this design as a React app"). Pro will generate matching code.',
    relatedFeatures: ['pro_chat', 'pro_chat_file_upload'],
    aiSurface: 'pro_chat',
    keywords: ['design to code', 'figma to code', 'image to code', 'ui from design', 'mockup', 'wireframe', 'screenshot to code', 'visual design', 'design convert'],
  },
  {
    id: 'pro_chat_multi_deploy',
    name: 'Pro Chat — Multi-Provider Deployment',
    path: 'Engineer AI can deploy to Vercel/Netlify/GitHub Pages (via agentic loop)',
    description: `Pro Chat can deploy your app to multiple platforms beyond Firebase Hosting:
• Vercel — React, Next.js, Vue apps → *.vercel.app URL
• Netlify — static sites → *.netlify.app URL
• GitHub Pages — static sites → username.github.io/repo/ URL
• Custom domains — map your own domain (Vercel)
Ask the AI to deploy (e.g. "Deploy this to Vercel using my token") and it will use the platform's REST API directly — no CLI tools needed.`,
    howToUse: 'In your Pro Chat or Engineer AI session, provide your deploy token (Vercel, Netlify, or GitHub PAT) via Settings → Secrets & Keys, then ask to deploy.',
    relatedFeatures: ['pro_chat', 'engineer_ai_deploy', 'settings_secrets'],
    aiSurface: 'pro_chat',
    keywords: ['vercel deploy', 'netlify deploy', 'github pages', 'deploy', 'hosting', 'custom domain', 'publish app', 'live url', 'deploy karo', 'production'],
  },
  {
    id: 'admin-metrics',
    name: 'Live Metrics Dashboard',
    path: 'Settings → App Settings → Live Metrics (admin only)',
    description: `Admin-only real-time observability panel showing:
• Total builds, success rate %, preview rate, average build time
• AI cost breakdown by provider (Claude, Grok, Gemini, etc.) with token counts
• HEALTH ALERTS (Phase 4.3) — automatically flags high build-failure rate (>10%), low preview rate (<80%), or slow builds (avg >30s) as critical/warning banners at the top of the panel
• Refresh button to pull the latest snapshot from the server
• Backend: persisted daily to Firestore (metrics_snapshots) — survives Cloud Run restarts
• Historical data available via GET /api/admin/metrics/history
• Structured server logs queryable via GET /api/admin/logs`,
    howToUse: 'Admin login required. Open Settings → App Settings → scroll to bottom → Live Metrics button (visible only when logged in as admin). Click Refresh Metrics to update.',
    relatedFeatures: ['admin', 'engineer_ai', 'pro_chat'],
    keywords: ['metrics', 'stats', 'cost', 'admin', 'dashboard', 'builds', 'usage', 'ai cost', 'success rate', 'observability', 'logs', 'monitoring'],
  },
  {
    id: 'admin-mfa',
    name: 'Admin Two-Factor Authentication (2FA / TOTP)',
    path: 'Admin Dashboard → Security tab → Two-Factor Authentication (admin only)',
    description: `App-based second factor (TOTP, RFC 6238) for admin-panel access — protection against password leaks and SIM-swap attacks on SMS OTP:
• Enable 2FA: generates a secret, shows it as an authenticator key + an otpauth:// URI to add to Google Authenticator / Authy / 1Password / Microsoft Authenticator
• Confirm with a 6-digit code to activate; once enabled, admin login requires the code IN ADDITION to the password
• Disable requires a current valid code (a hijacked session cannot silently strip 2FA)
• The TOTP secret is stored ENCRYPTED in Firestore (AES-256, the same versioned key scheme as user secrets); an optional ADMIN_TOTP_SECRET env var provides a zero-config, server-managed alternative
• Login flow: if 2FA is on, the admin login screen reveals an "Authenticator Code" field and the server rejects login without a valid code`,
    howToUse: 'Admin login required. Open the Admin Dashboard → Security tab → Two-Factor Authentication → Enable 2FA → add the shown key to your authenticator app → enter the 6-digit code to confirm. After that, every admin login asks for the current code.',
    relatedFeatures: ['admin', 'admin-metrics'],
    keywords: ['2fa', 'mfa', 'two-factor', 'totp', 'authenticator', 'google authenticator', 'authy', 'otp', 'admin security', 'second factor', 'do factor', 'suraksha', 'login security'],
  },
  {
    id: 'admin-cost-ladder',
    name: 'v3.0 Cost-Ladder Dashboard',
    path: 'Admin Dashboard → Revenue tab → "v3.0 Cost-Ladder (last 30 days)" (admin only)',
    description: `Admin-only panel showing how NavBharatAI Pro v3.0 routes builds across model tiers to control cost, with REAL telemetry (never faked):
• Total v3.0 builds and overall success rate over the last 30 days
• CHEAP-TIER SHARE — what % of builds ran on the cheapest 'gemini' start tier (the cost-ladder's whole point: simple apps build on Gemini Flash, not Pro)
• Per-start-tier breakdown table (gemini → haiku → sonnet → opus): builds, share %, success rate %, average tokens, average build time, billed amount
• Power-mode (Only-Opus) build count
• The cheap-tier success rate is the P8 cutover signal — high share + high success means the ladder is safe to enable by default
• Backend: GET /api/admin/agentv3/cost-telemetry, aggregated daily in Firestore (agentv3_cost_telemetry). Billing is unchanged (Opus-equivalent markup) — the ladder only lowers NavBharatAI's own provider cost.`,
    howToUse: 'Admin login required. Open the Admin Dashboard → Revenue tab → scroll to "v3.0 Cost-Ladder". Click Refresh to pull the latest 30-day telemetry. Data appears once Pro v3.0 builds have run.',
    relatedFeatures: ['admin', 'admin-metrics', 'pro_chat'],
    keywords: ['cost ladder', 'cost', 'tier', 'gemini', 'cheap tier', 'savings', 'model routing', 'v3.0 cost', 'build cost', 'admin', 'success rate', 'telemetry', 'opus', 'sonnet', 'haiku'],
  },
  {
    id: 'auto-dependency-sync',
    name: 'Auto Dependency Sync',
    path: 'Pro Chat → Build any app → automatic (no user action needed)',
    description: `G6 execution-hardening: after every Pro build, NavBharatAI automatically detects every package imported in the generated source code and ensures it is declared in package.json. This prevents the #1 "app generated but won't run" failure where the AI writes \`import axios from 'axios'\` but forgets to add axios to package.json, causing npm install to miss the dependency and the app to crash at runtime. Curated pinned versions are used for 30+ common packages (react-router-dom, zustand, axios, framer-motion, lucide-react, zod, @tanstack/react-query, recharts, etc.); unknown packages default to 'latest'. Non-blocking: never delays or fails the build.`,
    howToUse: 'Automatic — no action needed. Build any app in Pro Chat. If the generated code imports packages not yet in package.json, they are silently added with pinned versions before the build completes. A status message shows which packages were declared.',
    relatedFeatures: ['pro_chat', 'auto-code-review'],
    aiSurface: 'pro_chat',
    keywords: ['dependency', 'package.json', 'missing module', 'cannot find module', 'npm install', 'missing dependency', 'undeclared package', 'import error', 'module not found', 'package missing', 'auto install', 'dep sync'],
  },
  {
    id: 'app-sbom',
    name: 'App SBOM + License Check',
    path: 'Backend capability — POST /api/workspace/sbom (returns a Software Bill of Materials for your built app)',
    description: `Generates a CycloneDX 1.5 Software Bill of Materials (SBOM) for an app you built on NavBharatAI, from that app's package-lock.json — a full list of every open-source dependency (name, version, purl, license). It also runs a LICENSE CHECK: it flags any strong-copyleft GPL/AGPL dependency your generated app pulled in (a real compliance risk if you ship commercially), and lists weak-copyleft (LGPL/MPL/EPL) ones for awareness. Dual licenses that offer a permissive option (e.g. "MIT OR GPL-3.0") are correctly treated as permissive. Useful for enterprise compliance, security audits, and supply-chain verification of what's actually inside the apps you create. (This is for the user's GENERATED apps; NavBharatAI's own SBOM is produced separately in CI.)`,
    howToUse: 'Backend API: POST /api/workspace/sbom with the app\'s parsed package-lock.json as { packageLock }. Returns { sbom, copyleft: { strong[], weak[] }, componentCount, hasCopyleftRisk }. Optionally pass workspaceId + buildId to persist the SBOM.',
    relatedFeatures: ['pro_chat', 'auto-dependency-sync'],
    keywords: ['sbom', 'bill of materials', 'cyclonedx', 'license', 'gpl', 'agpl', 'copyleft', 'compliance', 'supply chain', 'dependencies', 'oss', 'open source license', 'license check', 'audit'],
  },
  {
    id: 'code-confidence-check',
    name: 'Code Confidence (AI Hallucination Check)',
    path: 'Settings → Insights & Webhooks → Code Confidence',
    description: `Scans the generated app's code for AI "hallucination" signals and gives a 0–100 confidence score: HALLUCINATED DEPENDENCIES (a package imported but not in package.json — the #1 reason a generated app won't install/run), UNRESOLVED LOCAL IMPORTS (importing a file that doesn't exist), and PLACEHOLDER/STUB code (TODO/FIXME, "not implemented" throws, lorem ipsum). Low confidence is flagged with a warning so you review before shipping, instead of silently trusting the AI. Real static analysis of your actual files — no guessing.`,
    howToUse: 'Open Settings → Insights & Webhooks → "Code Confidence" → Check Code. Review the confidence score and the listed signals (each shows the file + the exact issue).',
    relatedFeatures: ['insights-integrations-panel', 'app-sbom'],
    keywords: ['hallucination', 'confidence', 'ai accuracy', 'code quality', 'missing dependency', 'undeclared package', 'unresolved import', 'placeholder', 'stub', 'not implemented', 'trust', 'verify ai'],
  },
  {
    id: 'insights-integrations-panel',
    name: 'Insights & Integrations',
    path: 'Settings → Insights & Webhooks',
    description: `One panel that surfaces your project's operational insights and integrations: (1) Build SLO Compliance — per-complexity build success vs. time targets (violation rate + p95); (2) App SBOM + License Check — generate a CycloneDX Software Bill of Materials for your app's dependencies and flag any GPL/AGPL (copyleft) license risk; (3) Webhooks — register/list/delete webhook URLs and send a test, to get a POST on build/deploy events (BUILD_COMPLETE/FAILED, DEPLOY_COMPLETE/FAILED) for Slack/Discord/your CI. Real data only, with honest empty states until builds/dependencies exist.`,
    howToUse: 'Open Settings → "Insights & Webhooks". The Build SLO and SBOM sections show data for your current project; under Webhooks, paste a URL and Add it, then "Send test" to verify delivery.',
    relatedFeatures: ['webhook-manager', 'app-sbom', 'build-performance-analytics'],
    keywords: ['insights', 'integrations', 'webhooks', 'sbom', 'license', 'slo', 'build time', 'copyleft', 'slack', 'discord', 'ci', 'project insights'],
  },
  {
    id: 'webhook-manager',
    name: 'Webhook Manager',
    path: 'Settings → Insights & Webhooks → Webhooks  (also backend /api/webhooks/:userId)',
    description: `Register your own webhook URLs so NavBharatAI POSTs to them on build/deploy events (BUILD_COMPLETE, BUILD_FAILED, DEPLOY_COMPLETE, DEPLOY_FAILED) — wire builds into your CI/CD, or get Slack/Discord alerts. Manage multiple webhooks per account, each subscribed to the events you choose (up to 20). A "test" call fires a sample event so you can verify your endpoint receives it. Each delivery is a JSON POST with a 5-second timeout and is best-effort (a failing webhook never affects your build).`,
    howToUse: 'Backend API: POST /api/webhooks/:userId { url, events? } to register; GET to list; DELETE /api/webhooks/:userId/:id to remove; POST /api/webhooks/:userId/test to send a test event. Events default to all four if not specified.',
    relatedFeatures: ['pro_chat'],
    keywords: ['webhook', 'webhooks', 'slack', 'discord', 'ci/cd', 'ci cd', 'notification', 'callback', 'build notification', 'deploy notification', 'integration', 'alert'],
  },
  {
    id: 'editor-theme-switcher',
    name: 'Editor Theme Switcher',
    path: 'Code editor → header dropdown (top-right of the editor)',
    description: `Switch the code editor's color theme at runtime. Choose from VS Dark, VS Light, Monokai, Dracula, or Solarized Dark via the small dropdown in the editor header. The choice applies instantly and is remembered (saved in your browser) so it persists across sessions. The three custom themes (Monokai/Dracula/Solarized Dark) are real syntax-highlighting themes, not just background swaps.`,
    howToUse: 'Open any file in the code editor. Use the theme dropdown at the top-right of the editor header to pick VS Dark / VS Light / Monokai / Dracula / Solarized Dark. Your choice is saved automatically.',
    relatedFeatures: ['pro_chat'],
    keywords: ['theme', 'editor theme', 'dark mode', 'light mode', 'monokai', 'dracula', 'solarized', 'color scheme', 'syntax highlight', 'monaco theme', 'appearance'],
  },
  {
    id: 'merge-conflict-resolver',
    name: 'Merge Conflict Resolver',
    path: 'Diff view → open a file with merge conflicts → "Resolve Conflicts"',
    description: `A 3-way merge conflict resolver built into the Diff viewer. When a file contains Git-style conflict markers (<<<<<<< / ======= / >>>>>>>), the Diff view flags it ("merge conflicts") and shows a "Resolve Conflicts" button. The resolver lists each conflict hunk side-by-side (Ours vs Theirs) with per-hunk Ours / Theirs / Both buttons and a live resolved preview; "Apply Resolution" writes the clean, marker-free content back to the workspace file and refreshes the preview. Powered by a dependency-free diff3 engine that also auto-merges non-overlapping changes and only marks a true conflict when both sides change the same region differently.`,
    howToUse: 'Open the Diff view and select a file that has conflict markers. Click "Resolve Conflicts", pick Ours / Theirs / Both for each conflict, then "Apply Resolution" to save the resolved file.',
    relatedFeatures: ['pro_chat'],
    keywords: ['merge', 'conflict', 'merge conflict', 'resolve conflict', '3-way merge', 'diff3', 'git conflict', 'HEAD', 'ours', 'theirs', 'conflict markers', 'merge editor'],
  },
  {
    id: 'build-performance-analytics',
    name: 'Build Performance Analytics',
    path: 'Analytics view → Build Performance card',
    description: `Real build-pipeline health computed from your recent build jobs (not faked): success rate %, failure rate %, average build duration, p95 (slowest-5%) duration, and the top failure types (the most common build-error signatures). Helps you see if builds are getting slower or failing more often, and what's breaking most. Backed by GET /api/analytics/builds, which aggregates the last 100 jobs from the build-job store; shows honest zeros until builds have run.`,
    howToUse: 'Open the Analytics view. The "Build Performance" card appears once at least one build has run, showing success/failure rate, avg + p95 duration, and the top failure types. Use Refresh to recompute.',
    relatedFeatures: ['pro_chat', 'admin-metrics'],
    keywords: ['build performance', 'build analytics', 'success rate', 'failure rate', 'build duration', 'p95', 'slow build', 'build health', 'failure types', 'pipeline', 'build stats'],
  },
  {
    id: 'auto-test-generation',
    name: 'Auto Test Generation (Phase 17)',
    path: 'Pro Chat → Build any app → automatic (no user action needed)',
    description: `Phase 17 — NavBharatAI Pro v2.0 feature. After every Pro build, NavBharatAI automatically generates Vitest test files for the most important parts of the generated app — exactly like Claude Code does for apps it builds. Key capabilities:
• ANALYZES generated files by type: components, hooks, services, utilities, stores, pages, contexts — each gets a tailored test prompt.
• SELECTS highest-value files to test first (hooks > services > stores > components > pages).
• GENERATES multiple test files in parallel (up to 4 per build) using Promise.allSettled.
• WRITES category-specific tests: component tests use @testing-library/react, hook tests use renderHook, service tests mock fetch/axios, utility tests cover edge cases.
• UPDATES the validation report: the 'Automated Tests' gate changes from PENDING to PASS, showing which test files were generated.
• TEST FILES are included in the downloaded app zip so users can run them locally with: npx vitest run.`,
    howToUse: 'Automatic — no action needed. Build any app in Pro Chat. Test files (e.g. src/App.test.tsx, src/hooks/useAuth.test.ts) are automatically included in the result. Download the app and run: npm install && npx vitest run',
    relatedFeatures: ['pro_chat', 'auto-dependency-sync', 'auto-code-review'],
    aiSurface: 'pro_chat',
    keywords: [
      'auto test', 'test generation', 'vitest', 'unit test', 'testing library', 'react testing',
      'test file', 'jest', 'coverage', 'test cases', 'automated tests', 'generate tests',
      'test app', 'app test', 'test karo', 'test banana', 'unit testing', 'component test',
      'hook test', 'service test', 'integration test', 'npx vitest', 'test suite',
      'phase 17', 'claude code level', 'test selector',
    ],
  },
  {
    id: 'quick-start-gallery',
    name: 'Quick-Start Gallery — Example Prompt Cards',
    path: 'Pro Chat → empty chat → example cards grid (visible before first message)',
    description: `G9: When Pro Chat has no messages yet, a grid of example prompt cards is shown. Cards cover common app types AND Bharat-first templates: Analytics Dashboard, E-commerce Page, Portfolio Site, Admin Dashboard, UPI Payment App (Razorpay integration), Hindi Language App (bilingual Devanagari), GST Invoice Generator, Startup Registration Tracker. Clicking any card fills the Pro Chat input with a detailed prompt. The Bharat-first templates (UPI, Hindi, GST, Startup) generate real, working Indian-context apps.`,
    howToUse: 'Open Pro Chat with no previous messages. Scroll past the header — the Quick-Start Gallery appears. Click any card to load its prompt into the chat input. For Bharat-first templates: UPI Payment needs RAZORPAY_KEY_ID, Hindi app is fully self-contained, GST Invoice needs no API key, Startup Tracker stores data in localStorage.',
    relatedFeatures: ['pro_chat'],
    aiSurface: 'pro_chat',
    keywords: ['example prompt', 'quick start', 'starter template', 'example cards', 'prompt gallery', 'what can you build', 'kya bana sakte ho', 'show examples', 'example apps', 'ideas for app', 'app ideas', 'upi', 'payment', 'hindi', 'gst', 'invoice', 'startup', 'bharat', 'india', 'razorpay', 'devanagari', 'rupee', 'msme', 'registration'],
  },
  {
    id: 'backend-scaffolds',
    name: 'Backend Scaffolds — PocketBase & Convex',
    path: 'Pro Chat → describe a PocketBase or Convex app → auto-seeded skeleton',
    description: `Phase 6.5: Two backend-as-a-service scaffolds are now supported alongside React/Vue/Svelte:

PocketBase (vite-pocketbase):
• Triggers on: "pocketbase app", "pocketbase dashboard", etc.
• Files: package.json (react + pocketbase deps), vite.config.js, src/lib/pb.js (PocketBase singleton with VITE_PB_URL), src/App.jsx (auth + record listing example), .env.example
• Self-hosted SQLite backend — user runs their own PocketBase server

Convex (vite-convex):
• Triggers on: "convex app", "convex todo", "build with convex", etc.
• Files: package.json (react + convex deps), src/main.jsx (ConvexProvider), src/App.jsx (useQuery/useMutation), convex/schema.ts, convex/tasks.ts, .env.example
• Real-time backend in the cloud — user runs npx convex dev to get VITE_CONVEX_URL

Both scaffolds produce real, correctly wired code. The backend services (PocketBase server / Convex cloud) must be provisioned by the user separately.`,
    howToUse: 'In Pro Chat, include "pocketbase" or "convex" in your prompt. NavBharatAI auto-detects and seeds the correct skeleton. For PocketBase: set VITE_PB_URL in .env to your server URL. For Convex: run npx convex dev in the project folder to provision the backend.',
    relatedFeatures: ['pro_chat', 'auto-dependency-sync'],
    aiSurface: 'pro_chat',
    keywords: ['pocketbase', 'pocket base', 'convex', 'backend scaffold', 'self hosted', 'real time backend', 'baas', 'backend as a service', 'sqlite backend', 'pocketbase app', 'convex app', 'convex dev'],
  },
  {
    id: 'build-version-history',
    name: 'Build Version History — Go Back to Any Previous Version',
    path: 'Pro Chat → sidebar → Files → History tab',
    description: `Phase 2.1: Every successful Pro build automatically creates a version checkpoint in Firestore. The History tab in the Files panel shows all past builds for the current session, newest first, each labeled with an auto-generated commit message (e.g. "feat: build \\"todo app\\" — 12 files, vfs tier"). Users can restore any previous version with one click — the workspace reverts to that exact file snapshot and the Code Studio switches to show the restored files. Versions are retained for up to 50 builds per session. Each entry shows: commit message, relative time, file count, build tier, and version number (v1, v2, v3...).`,
    howToUse: 'Build any app in Pro Chat. Open the Files view (sidebar → Files). Click the "History" tab in the panel header. All past builds appear as version entries. Click "Restore" next to any entry to revert the workspace to that version.',
    relatedFeatures: ['pro_chat', 'files-panel', 'auto-dependency-sync'],
    aiSurface: 'pro_chat',
    keywords: ['version history', 'go back', 'restore', 'undo build', 'previous version', 'revert', 'old version', 'build history', 'checkpoint', 'purana version', 'version 3 pe wapas', 'rollback', 'undo changes', 'history', 'past builds'],
  },
  {
    id: 'unified-memory',
    name: 'Unified Memory — Pro Chat and Engineer AI Share Context',
    path: 'Automatic — happens every time you build in Pro Chat then ask Engineer AI to edit',
    description: `Phase 2.3: Pro Chat maintains a rolling memory of what was built (project summary + last 10 edits). When Engineer AI runs on the same workspace, it now receives this context at the start of every step — so the agent knows what Pro Chat already built, which decisions were made, and what the project contains. This eliminates the "fresh-start" problem where Engineer AI would re-reason decisions already established by Pro Chat. The memory is stored in Firestore (pro_memories collection) and loaded automatically by ProEngineRunner at the start of each agentic run.`,
    howToUse: 'Automatic — no user action needed. Build in Pro Chat → the memory is saved. Then ask Engineer AI to edit → it picks up the context. Context includes: project summary, tech stack, last 10 edits.',
    relatedFeatures: ['pro_chat', 'build-version-history', 'iterative-agent-build'],
    aiSurface: 'engineer_ai',
    keywords: ['memory', 'context', 'remember', 'remember project', 'forget', 'fresh start', 'context lost', 'yaad', 'bhool gaya', 'pichla kaam', 'previous build', 'project context', 'session memory', 'unified memory'],
  },
  {
    id: 'one-click-deploy',
    name: 'One-Click Deploy Button',
    path: 'Pro Chat → header bar → Deploy button (visible after app is built)',
    description: `A "Deploy" button appears in the Pro Chat header bar after any app is successfully built. Clicking it opens a deploy panel with four platform options:
• Vercel — enter token + project name → deploys to *.vercel.app
• Netlify — enter token + optional site ID → deploys to *.netlify.app
• Cloudflare Pages — enter API token + account ID + project name → deploys to {name}.pages.dev
• GitHub Pages — enter token + owner + repo → deploys to username.github.io/repo/
On success: navigates to the "App is Live!" screen with the live URL. No commands needed — pure GUI.`,
    howToUse: 'Build an app in Pro Chat. When build completes, a green "Deploy" button appears in the top-right of the chat header. Click it, choose a platform, enter your API token, and click "Deploy Now". For Cloudflare, you also need your Account ID (found at dashboard.cloudflare.com → top-right).',
    relatedFeatures: ['pro_chat', 'pro_chat_multi_deploy'],
    aiSurface: 'pro_chat',
    keywords: ['deploy button', 'one click deploy', 'deploy', 'vercel', 'netlify', 'cloudflare', 'cloudflare pages', 'github pages', 'publish', 'launch', 'go live', 'deploy karo', 'live karo', 'publish app', 'deploy app', 'pages.dev'],
  },
  {
    id: 'iterative-agent-build',
    name: 'Iterative Agent Build Engine',
    path: 'Pro Chat → type any app description → send',
    description: `G10: Pro Chat uses a multi-step agentic build engine (not a single AI call). How it works:
• PLANS first: breaks the app into 3–8 named steps shown as a live progress list (scaffold → install → implement → verify).
• BUILDS step-by-step: each step runs the ReAct loop (reason → act → verify → self-heal), building on the previous.
• LIVE PROGRESS: every action is streamed in real time — status messages, step starts/completions, terminal output (E2B tier).
• MEMORY: remembers what was built across turns; edits stay coherent across many conversation rounds.
• RETRY FIX: if a build fails, say "try again" — Pro Chat automatically restores the original prompt so the agent knows what to rebuild (no context loss).
• PARTIAL BUILDS: if the time limit is reached, partial work is saved and auto-continued in the next round.
• TIERS: runs in-memory (VFS, always available), server container (Docker), or cloud VM (E2B, with user's API key).`,
    howToUse: 'Open Pro Chat and type a detailed app description (e.g. "Build a photo editing app with filters, crop, and brightness controls"). Send. Watch the step-by-step progress. If build fails, type "try again" — the full original prompt is restored automatically.',
    relatedFeatures: ['pro_chat', 'one-click-deploy', 'quick-start-gallery'],
    aiSurface: 'pro_chat',
    keywords: ['iterative build', 'step by step', 'agent build', 'build failed try again', 'try again', 'retry build', 'complex app', 'multi step', 'pro chat build', 'app build', 'build engine', 'photo editing app', 'phir se bana', 'dobara bana', 'memory', 'context', 'remember'],
  },
  {
    id: 'guider-plan-confirm',
    name: 'Guider — Pre-Build Design Confirmation + Post-Build Quality Grader',
    path: 'Pro Chat → type any app description → Guider card appears before build starts',
    description: `Guider is the Pro Chat quality layer that wraps every build with two checks:

PRE-BUILD (Plan Confirmation):
• For every fresh app request, Guider proposes a structured design spec (screens, features, tech stack) and shows it as a confirmation card BEFORE building.
• User can Approve, Edit the spec, or ask a clarifying question.
• Small edits and follow-up messages skip this step automatically (server-side gate).
• On approval, the spec is stored; build starts immediately.

POST-BUILD (Grade + Auto-Refine):
• After the build completes, Guider grades the result against the confirmed spec (0–100 score).
• If score < threshold and gaps are found, Guider auto-refines up to 2 rounds without any user action.
• Each refine round targets only the specific gaps (e.g. "missing dark mode toggle", "no error handling in login") without removing working features.
• Final score + pass/fail shown in chat message.`,
    howToUse: 'Open Pro Chat and describe an app. A Guider design card will appear — review and click Approve (or edit it). Build starts. After it completes, watch for the Guider grade message — it will auto-fix gaps.',
    relatedFeatures: ['iterative-agent-build', 'pro_chat', 'auto-code-review'],
    aiSurface: 'pro_chat',
    keywords: ['guider', 'design plan', 'plan confirmation', 'approve plan', 'build spec', 'quality check', 'grade', 'refine', 'auto refine', 'gaps', 'requirements', 'spec', 'confirmation card', 'before build', 'pre build', 'post build', 'quality score', 'plan approve karo', 'design confirm'],
  },
  {
    id: 'auto-code-review',
    name: 'Auto Code Review',
    path: 'Pro Chat → Build any app → review appears in build summary',
    description: `G5 quality gate: after every new Pro build, an AI-powered code review runs automatically:
• Security: OWASP Top 10 checks (injection, XSS, hardcoded credentials, CSRF)
• Quality: unused imports, dead code, functions >50 lines, deep nesting
• Performance: N+1 queries, missing React.memo, large bundle imports
• Tech Debt: TODO/FIXME comments, deprecated APIs, TypeScript 'any' types
• Accessibility: missing alt attributes, missing ARIA labels
Returns a 0-100 score + prioritized findings with file:line + fix suggestion.
Non-blocking: review never delays or fails the build (12s timeout, best-effort).
Also available on-demand via Settings → Pro → Code Review button.`,
    howToUse: 'Build any app in Pro Chat — code review score and top issues appear in the build summary message automatically. For on-demand review without rebuilding, use Settings → Pro → Code Review.',
    relatedFeatures: ['pro_chat', 'engineer_ai', 'admin-metrics'],
    aiSurface: 'pro_chat',
    keywords: ['code review', 'security', 'quality', 'owasp', 'xss', 'injection', 'tech debt', 'accessibility', 'score', 'findings', 'auto review', 'code quality', 'security scan'],
  },
  {
    id: 'error-pattern-learning',
    name: 'Error Pattern Learning — Builds Get Smarter After Failures',
    path: 'Automatic — active on every Pro build (no user action needed)',
    description: `Phase 5.4: NavBharatAI learns from build failures to prevent them from repeating.
Two mechanisms:
• Pre-build hints: before the agent starts coding, technology-specific pitfalls are injected based on keywords in your prompt (e.g. "Tailwind" triggers Tailwind v4 setup hints, "Supabase" triggers auth key hints). This prevents the most common first-build failures.
• Session-level learning: when a build fails with a recognizable pattern (ERESOLVE, unclosed JSX, Cannot find module, React hooks violation, etc.), the specific fix hint is saved for that session. The next retry automatically receives these hints in the agent's context, so the agent corrects the issue without needing you to describe it.
Patterns tracked: ERESOLVE peer deps, Cannot find module, named import errors, unclosed JSX, React hooks rules, TypeScript type errors, Vite config missing, Supabase env keys, null/undefined access.
Hints are cleared after a successful build so they don't carry over to unrelated future work.`,
    howToUse: 'Automatic — no user action needed. When a build fails, retry it and the agent will have the specific fix hints injected. Over time, NavBharatAI builds a knowledge base of common errors across all sessions.',
    relatedFeatures: ['pro_chat', 'auto-dependency-sync', 'iterative-agent-build'],
    aiSurface: 'pro_chat',
    keywords: ['error', 'build fail', 'fix', 'retry', 'learn', 'pattern', 'cannot find module', 'eresolve', 'peer dep', 'jsx error', 'tailwind', 'supabase', 'smart build', 'auto fix', 'error detection', 'build smarter', 'galti', 'error fix', 'dobara banao'],
  },
  {
    id: 'v3-framework-selector',
    name: 'Multi-Framework Builder (v3.0)',
    path: 'NavBharatAI Pro v3.0 → header → framework badge (or ⚙ → Framework)',
    description: `NavBharatAI Pro v3.0 can build apps in 17 different frameworks and tech stacks:
Frontend: React + Vite, Next.js, Remix, Vue 3, Nuxt 3, Svelte, SvelteKit, Angular, Astro, Vanilla TypeScript.
Backend / API: Express.js, NestJS, Fastify, FastAPI (Python), Django (Python), Flask (Python).
Static: plain HTML/CSS/JS.
Each framework gets a full starter scaffold (package.json, config, entry files) pre-seeded in the workspace so the agent can start building immediately. The agent's instructions are also tailored per framework — it knows the routing conventions, dev server port, and common pitfalls for each.`,
    howToUse: 'In Pro v3.0 chat: click the framework badge in the header (shows e.g. "⚛ React + Vite") or open ⚙ → Framework. A picker appears with All / Frontend / Full-Stack / Backend / Static filters. Select your framework and click Confirm. Then describe your app — the agent will build using that framework.',
    relatedFeatures: ['pro_chat', 'v3-github-import', 'iterative-agent-build'],
    aiSurface: 'pro_chat',
    keywords: ['framework', 'nextjs', 'vue', 'svelte', 'angular', 'astro', 'django', 'flask', 'fastapi', 'nestjs', 'express', 'fastify', 'nuxt', 'remix', 'vanilla', 'python', 'stack', 'technology', 'kaunsa framework', 'react', 'typescript', 'javascript', 'tech stack', 'choose framework', 'framework select'],
  },
  {
    id: 'v3-github-import',
    name: 'GitHub / URL Import (v3.0)',
    path: 'NavBharatAI Pro v3.0 → ⚙ → Import Repo',
    description: `Import an existing project from any public GitHub repository (or any git URL) directly into the v3.0 workspace. Once imported, you can ask the agent to understand the code, fix bugs, add features, or continue building on top of it. The import clones the repo into the live sandbox — the agent then works on the real files just as if it had created them. Private repos work if you have connected your GitHub account in Settings → Connections (your OAuth token is automatically forwarded).`,
    howToUse: '1. In Pro v3.0, open ⚙ (build options) → Import Repo. 2. Paste the GitHub URL (e.g. https://github.com/username/my-app). 3. Click "Set Import". 4. Then send your first message (e.g. "Analyze this project" or "Add dark mode"). The repo will be cloned into the workspace before the agent starts.',
    relatedFeatures: ['pro_chat', 'v3-framework-selector', 'iterative-agent-build'],
    aiSurface: 'pro_chat',
    keywords: ['import', 'github', 'clone', 'existing app', 'existing project', 'repo', 'repository', 'my app', 'upload', 'firebase import', 'github se import', 'apni app', 'existing code', 'already made', 'meri app', 'koi bhi app'],
  },
];

/** Quick lookup by id. */
export function getFeatureById(id: string): AppFeature | null {
  return APP_KNOWLEDGE_BASE.find(f => f.id === id) ?? null;
}
