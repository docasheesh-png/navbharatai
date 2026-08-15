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
  /** Optional DIRECT-NAVIGATION target so the Offline AI (and any surface) can render a working
   *  "Open →" button that takes the user straight there — not just describe the path in words.
   *  `view` is a top-level ViewType (opens that tab); `settingsScreen` opens Settings on that screen.
   *  Absent → the surface falls back to showing `path` as text guidance (honest: no fake button).
   *  ADD `nav` when a new feature is a reachable page/tab so the Offline AI can jump to it. */
  nav?: { view?: string; settingsScreen?: string };
}

export const APP_KNOWLEDGE_BASE: AppFeature[] = [
  // ─── DOWNLOAD APP (mobile web → Android app) ─────────────────────────────
  {
    id: 'sonic_voice_chat',
    name: 'NavBharatAI Voice (talk to any AI — paid, per second)',
    path: 'Any AI chat (NavBharatAI Free, Pro v5.0, Doctor AI, or any Professional) → tap the 🔊 voice button in the input row. Signed-in users only, when voice is enabled.',
    description:
      "NavBharatAI Voice — a real-time, talk-back-and-forth VOICE mode available on EVERY AI in the app (NavBharatAI Free, Pro v5.0, Doctor AI and every Professional; it used to be inside Professionals only). IT IS A PAID FEATURE, charged BY THE SECOND from the same single balance everything else uses — 2 paise per second, about ₹1.20 a minute. The price is shown in your own language BEFORE any call starts: tapping the voice button opens a short card stating the rate, and nothing is charged until you accept. Charging begins only once the call actually connects and stops the moment you end it, a live meter shows the time and the rupees spent so far while you talk, and if your balance runs out the call ENDS and says so rather than running up a bill. A call that fails to connect costs nothing. Tap the mic next to Send and the SAME professional you were chatting with (Doctor, Lawyer, Teacher, …) talks back — full-screen with a live animated orb — in its own persona. Speak naturally in Hindi, Hinglish, English or a regional language and hear a spoken reply, like a phone call, with an on-screen transcript. Capabilities: choose a MALE or FEMALE voice; pick a regional BOLI (Bhojpuri/UP-Bihar, Haryanvi, Punjabi, Rajasthani, Marathi, Bengali, Hyderabadi, South Indian) that shifts only the tone/warmth while keeping YOUR language; BARGE-IN by simply speaking over the assistant to interrupt it; MUTE the mic mid-call; and it REMEMBERS your past calls with that professional (continues where you left off, across sessions and devices) and continues an ongoing TEXT chat from where it stopped. Signed-in users only (voice uses a paid AI model). It is a NavBharatAI product; never tell users which third-party model or company powers it.",
    howToUse:
      'Sign in and open ANY AI — NavBharatAI Free, Pro v5.0, Doctor AI or a Professional. In the chat input row, tap the 🔊 voice button (separate from the 🎙️ dictation mic, which only types your speech into the box) — it appears only when signed in and voice is enabled. A card first tells you the per-second price in your language; accept it to start. Then: pick ♀/♂ voice and an optional Boli; tap the mic, allow the microphone when asked, and speak. To interrupt the assistant, just start talking (barge-in). Use the mute button to stop the mic; tap ✕ (top-right) to close. If you were typing first, the voice picks up your conversation from where the text left off, and it remembers earlier calls with that professional.',
    relatedFeatures: ['nbi_chat', 'agentv3_builder'],
    keywords: [
      'voice', 'voice chat', 'talk', 'speak', 'microphone', 'mic', 'awaaz', 'navbharatai voice',
      'bol kar baat', 'voice se baat', 'audio chat', 'speak to ai', 'voice assistant', 'baat karo',
      'professional voice', 'doctor se baat', 'voice mode', 'boli', 'accent', 'dialect', 'male voice',
      'female voice', 'mute', 'interrupt', 'barge in', 'voice memory', 'yaad', 'awaz me baat',
      'voice price', 'voice charge', 'kitna lagega', 'per second', 'paise', 'voice paid', 'call cost',
    ],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'download_app',
    name: 'Download app (Android)',
    path: 'Sidebar menu → "Download app" (shows only on a mobile browser on navbharatai.com)',
    description:
      'A one-tap way to get the NavBharatAI Android app. The "Download app" button appears in the sidebar ONLY when you open navbharatai.com in a mobile browser (never inside the already-installed app, never on desktop). Tapping it downloads the Android app directly (a signed APK) when a direct-download is configured, otherwise it opens the Google Play listing (com.navbharat.ai). Inside the installed app, the app also tells you when a new version is available (with an Update / Later choice) and occasionally asks for a Play Store rating.',
    howToUse:
      'On your phone, open navbharatai.com in a browser, open the sidebar menu, and tap "Download app" — the Android app download/Play page opens. If you are already using the installed app, you will instead get an in-app "Update available" prompt when a newer version is published.',
    relatedFeatures: ['nbi_chat'],
    keywords: [
      'download app', 'download', 'apk', 'android app', 'install app', 'mobile app', 'play store',
      'app download karo', 'app install', 'update app', 'rate app', 'review app',
    ],
  },
  {
    id: 'support_contact',
    name: 'Support & Help (email us)',
    path: 'Sidebar menu → Settings → Support & Help',
    description:
      'A one-tap way to contact the NavBharatAI team for any problem, question, or feedback. The "Support & Help" button sits in Settings; tapping it opens your device mail app with a new email already addressed to info@navbharatai.com (subject pre-filled) so you just type your message and send. Works on the web app and inside the Android/iOS app.',
    howToUse:
      'Open the sidebar menu, tap Settings, then tap "Support & Help". Your mail app opens with a new email to info@navbharatai.com — describe your issue and send. You can also email info@navbharatai.com directly from any mail app.',
    relatedFeatures: ['nbi_chat'],
    keywords: [
      'support', 'help', 'contact', 'contact us', 'email', 'mail', 'customer support', 'feedback',
      'report problem', 'complaint', 'reach us', 'sahayata', 'madad', 'support chahiye', 'problem hai',
      'shikayat', 'contact karo', 'email karo', 'info@navbharatai.com',
    ],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'offline_ai',
    name: 'Offline AI (on-device chat)',
    path: 'Sidebar menu → Offline AI',
    description:
      'A 100% on-device CHAT assistant that works even with NO internet. It talks back turn-by-turn like a bot, but every reply is DETERMINISTIC (it does not run an AI model and does not "think", so it never invents a fact). It knows every feature of NavBharatAI — where each button/option is, what it does, and how to use it — and answers instantly from the built-in app knowledge, so it never guesses. Ask "where is X" or "how do I Y" and it shows the exact place with step-by-step how-to, plus a direct "Open →" button that takes you straight to that page. It also answers small questions fully OFFLINE that the device can truly compute — a CALCULATION (e.g. "2+2", "15% of 200", "(12*5)/4"), today\'s DATE & TIME from your device clock, and greetings / "who are you". These are real computations, never guessed. PHONE-SETTINGS HELP (offline): ask about a phone problem — "wifi not working", "bluetooth not pairing", "battery draining", "notifications not showing", "storage full", "factory reset", "clear cache" — and it shows real, step-by-step Android fixes. Honest: it GUIDES you (it cannot change your phone\'s settings for you), and exact menu names can differ by phone brand (Samsung/Xiaomi/…). YOU CAN TEACH IT (personal on-device memory): type "remember my gate code is 4821", "when I ask my name answer …", or "json means …" and press Enter — it saves that ON THIS DEVICE ONLY (never uploaded) and recalls it exactly next time, even offline. This is a deterministic personal memory (your own notes / answers), NOT machine-learning training — so it only ever repeats what YOU taught, with no made-up facts. Manage or delete anything you taught under "Things you\'ve taught me". Search is TYPO-TOLERANT — a small misspelling (e.g. "databse", "walet", "deploi") still finds the right feature. Every result also lists its Related features as one-tap chips so you can hop across connected screens without retyping, and starter suggestion chips give you a next step from a blank box or an empty result. It shows a live badge telling you whether you are online or using the offline on-device guide. OFFLINE THINKING (BETA, opt-in): on a capable phone (WebGPU + enough RAM/storage) you can tap the "Beta" button to download a small AI model once (~hundreds of MB) that then runs ENTIRELY on your device — it can chat about open-ended things with no internet. It is experimental and CAN be wrong (a small on-device model), so facts still use the reliable deterministic engine; it is default-OFF, downloads only when you choose, and can be turned off anytime. On unsupported phones it honestly says so. Note: building apps, full Pro chat and general-knowledge questions need the internet — the Offline AI answers those honestly by pointing you online, never with a made-up answer. It updates itself automatically: any new NavBharatAI feature becomes answerable here the moment it ships.',
    howToUse:
      'Open the sidebar menu and tap "Offline AI". It opens a chat — type a message and send (like a bot): ask "where is the database", "how do I deploy", a calculation ("15% of 200"), a phone-settings problem ("wifi not working"), or teach it something ("remember my gate code is 4821"). Tap "Open →" on any card it replies with to jump straight there, or "Ask online" when a question needs the internet. It works the same whether you are online or offline. OFFLINE THINKING (BETA) — the optional on-device AI: tap the chip in the header to open its panel. "Download & enable" fetches the model once (a few hundred MB — use Wi-Fi); after that it works with no internet. Two separate buttons control it afterwards, and they do different things: "Turn off" stops using it but KEEPS the model, so switching it back on is instant; "Delete" removes the model from your phone and gives the space back. If your phone is running out of storage, use Delete — it appears in the panel even when the beta is already turned off, as long as a model is still stored. You can download it again any time.',
    relatedFeatures: ['support_contact', 'nbi_chat'],
    keywords: [
      'offline', 'offline ai', 'no internet', 'without internet', 'on device', 'on-device', 'app guide',
      'delete model', 'model delete', 'storage full', 'memory full', 'free up space', 'jagah khali',
      'phone bhar gaya', 'model hatao', 'download hatao', 'offline thinking', 'beta model', 'space kam',
      'help', 'where is', 'how do i', 'navigation', 'find feature', 'kaha hai', 'kaise kare', 'offline mode',
      'internet nahi', 'bina internet', 'guide', 'assistant', 'app awareness', 'where is the button',
      'offline calculator', 'calculate offline', 'offline answer', 'offline question', 'date', 'time',
      'what time', 'todays date', 'calculator', 'hisaab', 'quick answer',
      'teach', 'train', 'remember', 'yaad rakho', 'yaad rakhna', 'memory', 'teach ai', 'train ai',
      'khud train', 'remember this', 'personal memory', 'note', 'forget',
      'phone help', 'phone settings', 'settings problem', 'phone problem', 'device help', 'phone fix',
      'wifi problem', 'battery problem', 'phone settings help', 'mobile settings',
      'offline chat', 'chat offline', 'offline bot', 'bot', 'chatbot', 'talk offline', 'baat karo offline',
      'offline thinking', 'on device ai', 'on-device model', 'offline llm', 'offline model', 'beta ai',
      'download ai', 'offline gpt', 'device ai',
    ],
    nav: { view: 'offline_ai' },
    aiSurface: 'nbi_chat',
  },
  // ─── NAVBHARATAI PRO v5.0 (Vargen 3.0) ───────────────────────────────────
  {
    id: 'agentv3_builder',
    name: 'NavBharatAI Pro v5.0 (beta)',
    path: 'Sidebar → "App Builder v5.0"  OR  Professionals → "NavBharatAI Pro v5.0" card (both open the same v5.0 builder).',
    description: `World-class agentic app builder (Vargen 3.0). Capabilities:
• POWER SELECTOR (build-options menu — the ⚙️ gear/settings popover opened from the toolbar just below the message box): five tiers of build engine, cheapest → strongest. "Weak" = the FREE tier (runs on NavBharatAI's fast economy engine — the free tier that never uses the premium engines). "Normal" = balanced (the standard engine, adaptive). "Strong 💪" = a stronger engine, pinned for the whole build. "Powerful" = NavBharatAI's most capable engine at higher reasoning effort. "Full Team" = the most capable engine at maximum effort (ultracode). The tier you select is exactly the engine that runs — the backend pins it. FULL TEAM PREMIUM EXPERIENCE (Fix 60): on the Full Team tier a running build shows the live ⚡ FULL TEAM HQ card above the message box — the real agent roster (Architect + every specialist, with what each is doing right now), real plan-progress squares, and a live clock — AND the message box stays LIVE during the build: type and send while the team works, and they act on your message at the very next step (a "queued" note appears instantly, then "picked up" when the team folds it in). This mid-build messaging works ONLY on Full Team — on other tiers the composer shows Stop while building, which is expected behavior, not a bug. WHO SEES WHAT: a FREE user (never purchased) can use ONLY "Weak"; once you add credits (become a paid user) all five unlock, defaulting to "Normal", and you can pick any of them per build. Billing follows the tier and the real work done: the lower tiers cost the least, and the two top ("Powerful"/"Full Team") tiers cost more because they run the most capable engine at higher effort — the bill scales with the tokens actually spent, and a live cost estimate is always shown. This is enforced server-side — a free account can never spend the paid engines. IF A FREE USER ASKS why the other tiers are locked / "select nahi ho raha" / greyed out with a 🔒: explain warmly, IN THE USER'S OWN LANGUAGE and in your own words (never a canned copy-paste — vary the phrasing each time, keep the meaning), that on a free account only the "Weak" tier is available, and that recharging (adding credits to the wallet) instantly unlocks every tier from Normal to Full Team — the tier selector is behind the ⚙️ options button (the Settings gear, title "Build options") in the toolbar just below the message box. IF THE USER SAYS THEY ALREADY RECHARGED/PAID but the tiers are still locked: NEVER repeat "recharge karo" — instead walk them through (in their language, own words): (1) close and reopen the 🎛️ options popover (it re-checks your account) or refresh the page once; (2) open Wallet & Billing from the sidebar and confirm the payment shows as SUCCESS and the tokens were credited; (3) if the payment shows SUCCESS there and the tiers are STILL locked after a refresh, apologize and tell them to contact support with their payment reference — do not blame them or loop the same suggestion.
• UNSEND & EDIT (take back / re-write your last message): hover the LAST message you sent in a build chat — two actions appear under it. ✏️ EDIT takes the message back AND drops its text into the message box so you can re-write it and send again. ✕ UNSEND just takes it back. Both do the SAME full take-back: they stop any build still running for that message and permanently remove it from the conversation — the visible thread, the durable transcript the AI replays, and the AI's project memory — so it never resurfaces or influences a future turn. Neither undoes files already written (take-back forgets the message, it doesn't roll back the app — the preview and file list keep reflecting reality); to undo file changes, use the Git/History checkpoints. Only the newest message is editable/unsendable; older messages keep Copy. Use Edit to fix a typo or reword a request, and Unsend when you'd rather the AI simply forgot what you sent.
• START FROM A TEMPLATE (cold-start helper): when a new Pro v5.0 chat is empty, a grid of one-tap starter template CARDS appears under the message box — each card shows a small layout sketch (the SHAPE of that kind of app: a list, a dashboard with a sidebar, a grid of products, a board of columns), its name and its category, so you can tell them apart at a glance. Note the sketch is a diagram of the layout, not a picture of the finished app. The templates cover — SaaS dashboard, CRM, invoicing, online store, restaurant/menu, bookings, social feed, community forum, events, project board, notes, learning platform (LMS), portfolio, fitness tracker, expense tracker, and more. Tapping one fills the message box with a rich, detailed prompt for that kind of app, which you then edit and send — it never builds on its own, so you stay in control. Great for "I don't know what to type" — pick the closest template, tweak it, build. You can also SAVE YOUR OWN: tap the ☆ (Save as template) under any message you sent to store its prompt as a reusable template on this device; your saved templates then appear under "Your templates" in that same picker (each with a × to remove). Saved on-device only (not synced across devices).
• MULTI-AGENT "AI team": an Architect plans and delegates to a six-layer roster of specialist agents — planning (Requirements, Planner, Product), development (Frontend, Backend, Fullstack, Database, Mobile, API, DevOps, Infrastructure, Designer), quality (QA, Tester, Security, Performance, Accessibility, Reviewer), repair (Debugger, Refactor, Optimizer), knowledge (Docs, Researcher) and operations (Deploy, Monitor, Recovery) — routed by capability and working in parallel where safe.
• MULTI-ENGINE resilience: builds on NavBharatAI's own engines, with automatic fallback across them so it always replies — you never see a provider name or a dead end.
• IDE ↔ v5.0 FILE SYNC (live, two-way): the Code Studio IDE and the v5.0 builder are two organs of ONE workspace per session. A ZIP you upload is mirrored into v5.0, files you delete in the IDE are removed from v5.0, AND every manual edit you make in the editor is auto-saved (debounced) to v5.0's DURABLE store — so your hand edits survive sandbox recycling and the build's file-guardian never reverts them. On your NEXT build, v5.0 ACKNOWLEDGES what you changed ("I noticed you manually edited N files in the IDE since my last build") and reads + builds ON TOP of your edits instead of overwriting them — like Google AI Studio, where a change in one place is instantly known everywhere.
• PROJECT MEMORY & artifact intelligence: as it builds it indexes your files into a live project graph (symbols, components, routes, imports, dependencies) and remembers errors and fixes; agents can "recall" this to find where things are and what failed before. After each build it also writes a short REFLECTION — the lessons learned from that build's errors and fixes — back into project memory; and at the START of each new build it RECALLS the relevant past lessons and applies them, closing the learning loop so the project genuinely improves across iterations. Recalled lessons are also EVOLVED before reuse (Layer 59 "Knowledge Evolution"): near-duplicates are merged, contradictions are resolved so newer advice overrides stale advice it disagrees with, and fresher lessons are ranked higher — keeping the project's working knowledge accurate and current. Recall ranks like a real search engine (BM25): a rare, specific term outweighs a common one, and lessons are OUTCOME-WEIGHTED so a PROVEN fix (it actually worked) outranks a one-off error and a repeatedly-confirmed lesson ranks higher — the agent is reminded of the most relevant AND most trustworthy lessons first. And these lessons are no longer trapped in one project: your highest-confidence lessons are remembered ACROSS ALL your projects (a cross-project "brain"), so what the AI learned building app A helps it build app B.
• PERSONALIZATION (Layer — Preference Learning): v5.0 quietly learns YOUR preferred stack from your past SUCCESSFUL builds — the framework, database, styling and language you keep choosing, and the kinds of apps you build most — inferred from what actually shipped (never from a form you fill in). On your next build, when you don't specify a stack, it leans toward those learned defaults so it builds the way you like by default; you can always override them just by asking for something different.
• UNDERSTANDS NAMED TECH (Layer — NLU entity/slot extraction): when you name a specific service in your request — "build a shop with Razorpay and Supabase", "Next.js app with Clerk auth, deploy to Vercel" — v5.0 recognizes those exact technologies (payment gateways, databases, auth, hosting, email/SMS, AI, storage, maps, analytics, search, frameworks, UI kits) and treats them as hard requirements, wiring the real SDK/integration instead of silently substituting its own defaults. If a named service needs a key you haven't set, it wires the real integration and tells you honestly which key to add rather than faking it.
• ONE-CLICK AI FIX (P-UX.3): when the in-browser preview fails to build, the Preview tab shows a "Fix with AI" button. Tapping it FIRST runs a free "deep refresh" — a clean, cache-bypassing rebuild of the preview — because a blank or failed preview is often just a stale cached render or a transient glitch and simply works after a fresh rebuild (no AI needed, no credit spent); if it recovers, the Preview shows a "recovered after a deep refresh — no AI fix was needed" note. Only if the preview STILL fails does it prepopulate the exact build error into the chat box, so you just press Send and the agent diagnoses and repairs it. It prepopulates (rather than auto-sending) so you always review before a fix runs.
• SELF-EVALUATION: agents can "evaluate" the project for real structural defects (unresolved imports that would break the build, import cycles, front-end→back-end layering violations, forEach(async …) loops that silently do not await), security issues (hardcoded secrets/keys, hardcoded JWT signing secrets, credentials embedded in DB/queue connection strings, eval, new Function() dynamic code, command injection via a shell exec built from dynamic input, dangerouslySetInnerHTML, raw innerHTML/outerHTML/insertAdjacentHTML XSS sinks, insecure http) AND an authenticity check that detects fake/incomplete/placeholder code (TODO/FIXME/HACK markers, "not implemented" throws, stub/dummy/mock data, lorem ipsum, empty console.log-only handlers, empty catch blocks that silently swallow errors) — enforcing the "real features only, no fakes" rule — AND a dependency-consistency check (packages imported in code but missing from package.json, which would break the build at install/runtime; declared-but-unused dependencies; plus floating/unpinned versions like "*"/"latest" that make builds non-reproducible) AND an environment-variable completeness check (variables read in code via process.env / import.meta.env but missing from .env.example, which would break the app at runtime for the user, who is never told to set them) AND an accessibility check (Layer 78 "Sabke-Liye"/Inclusion: images with no alt text, form controls with no accessible name, click handlers on non-interactive elements that keyboard and screen-reader users cannot reach, positive tabindex that breaks focus order, and pages with no document language) — so the apps it builds are usable by everyone — AND a trust/safety/compliance check (Layer 77 "Bharosa", DPDP/GDPR-oriented: personal data written to logs, sensitive values kept in browser storage, cookies set without SameSite, personal data sent over plain http, third-party trackers running with no cookie-consent surface, and collecting personal data with no privacy policy) that ends with an honest "launch-safe" certificate (CERTIFIED / CONDITIONAL / NOT CERTIFIED) — so the apps it builds are safe to launch publicly — AND a calibrated "build confidence" score (Layer 74 "Sahyog": 0–100% with a High/Medium/Low band and a plain-language "here's why", synthesized from all the checks above) so the assistant tells you honestly how confident it is rather than over-promising — and fix them before claiming the app is done.
• BUILD-HEALTH CARD (R2 — Earned readiness, shown every build): after each build finishes, v5.0 shows a build-health card right in the chat — an honest 0–100 score, a ready / not-ready verdict, and the exact blockers (things that still break the app) and warnings (advisory) — derived from the build's own diagnostics. So you see at a glance whether the app is genuinely ready or what to fix before shipping, instead of taking "done" on faith.
• STOP & UNSEND in every chat (admin 2026-08-13): while any NavBharatAI AI is replying — NavBharatAI Free, the Vishwakarma tiers, Doctor AI (SDA), and every Professional AI — the Send button turns into a red ■ Stop button. Tapping it ONCE cancels the reply immediately (no confirmation dialog), keeping whatever had already streamed (marked "⏹ stopped"), so a wrong or accidental question never has to run to the end. In NavBharatAI Free chat there is also an Unsend button (↩) next to Send: it takes back your last message — it stops any reply in progress, removes the last exchange, and drops your message text back into the box so you can edit or discard it. (NavBharatAI Pro v5.0 already had its own Stop for builds.)
• NEXT-BUILD SUGGESTIONS 💡 (admin 2026-08-13): after a build finishes, a small lightbulb icon lights up BELOW the message box (bottom-right of the v5.0 composer), with a little count badge. Tap it to see a short list of tailored "what could I build next?" ideas for YOUR specific app — domain-specific gaps (e.g. for a game: sound, save/high-score, a tutorial, a difficulty curve; for a shop: cart, payments, order management) shown first and marked "For this app", then universal polish (dark mode, mobile-friendly layout, search, share, export, animations). It NEVER runs anything on its own: tapping a suggestion just drops a ready-to-send instruction into the message box for you to review, edit, or ignore, then send when you want. The ideas are computed for free from your app's own files (no AI cost, instant), only show what your app does not already have, and refresh after each build. If there is nothing worth suggesting, the bulb stays hidden. GUIDED ROADMAP (for BIG apps): when you ask for a very large app in one line (for example a well-known app or game — "PUBG jaisa", "WhatsApp jaisa", "an app like Instagram"), NavBharatAI is honest that it is big, builds a real WORKING first version (the core) quickly so you get a live preview in a few minutes, and then lays out the rest as a simple step-by-step ROADMAP inside this same 💡. Each checkpoint shows what it will add and whether it needs extra setup; tap "Build next step" and it drops that step's instruction into the box for you to review and send — you grow the app one working milestone at a time, and the roadmap remembers where you are even if you come back later. This guided roadmap appears only for genuinely large apps; ordinary apps just build directly with no extra steps.
• SECOND OPINION (Layer 84 — Multi-Model Ensemble): the agent team can get an independent cross-model "second opinion" — a DIFFERENT, independent AI engine critically reviews risky or final work for bugs, security issues and wrong assumptions — going beyond a single model's judgement. The Architect can also convene a multi-perspective CONSENSUS panel (Layer 49 — Collective Intelligence): the same hard decision is put to independent correctness, security and UX reviewers and their viewpoints are synthesized into one verdict — multiple expert lenses, not one.
• PLAN REVIEW (Layer 54 — Strategic Intelligence): in Plan mode, before you approve the proposed build plan, v5.0 reviews it for strategic gaps and shows them next to the plan — no testing/verification step, no setup/scaffolding before features, a deploy was requested but never planned, an under-scoped one-line plan, or vague unactionable steps — so you can strengthen the plan up front instead of discovering the gap after the build.
• TEST COVERAGE check (Phase 6 — Testing & Autonomous Loops): when v5.0 evaluates a build, it also reports which modules and components have NO test, so the build agent writes the missing tests and verifies the app actually works instead of assuming it — the build is earned, not guessed.
• QUALITY DEFAULTS (U-2 — Production basics by default): every successful build automatically gets the launch basics — SEO + OpenGraph meta tags (title, description, share preview), a mobile viewport, an html lang attribute, a theme-color, a web app manifest with a real installable icon, robots.txt, AND an offline-first service worker (with its registration) so the app is a genuine installable PWA that works offline — plus a starter test skeleton. It adds only what is missing and never overwrites an existing manifest/service worker. This runs BY DEFAULT after each build (no need to ask), so the apps it builds are search-friendly, shareable, installable and offline-capable out of the box.
• DEAD-CODE / UNWIRED FILE CHECK: v5.0 can find modules it built but never wired in — a component, hook or util that nothing imports (and isn't an entry, test, config or route). This catches the common "created it, forgot to use it" bug where the code compiles but the feature never shows up; v5.0 then imports it where it belongs or removes it, so nothing you asked for is silently orphaned.
• TOOLCHAIN CHECK (D11 — Version pinning for imported repos): when v5.0 imports or clones an existing project, it can report the toolchain the repo declares it needs — Node (.nvmrc / engines), Python (.python-version / pyproject), Java (pom.xml), Go (go.mod) — and flag any internal contradiction where two files pin different versions. That silent mismatch is a classic "works for the author, breaks here" build failure, and v5.0 surfaces it honestly instead of leaving you guessing.
• PACKAGE HEALTH CHECK (GA-3 — Scripts that actually run): v5.0 checks package.json for two common ship-blockers other tools miss — an npm script that calls a build tool the project never installed (like a lint script using ESLint with no ESLint dependency, which fails with "command not found"), and a package declared in both dependencies and devDependencies. So the scripts it ships actually run instead of breaking on the first command.
• LINT ENGINE (GA-12 — ESLint + Prettier): v5.0 can run the project's own ESLint and Prettier as part of verification — catching a class of real bugs a typecheck does not (unused variables, React hooks exhaustive-deps, no-undef, promise misuse) plus formatting drift. ESLint errors block "done"; Prettier lists files to reformat. Together with running the real tests and compiling every language, this makes "verified" mean genuinely clean, not just type-correct.
• API CONTRACT CHECK (GA-5 — Frontend↔backend wiring): for a full-stack app, v5.0 can cross-check the backend routes it defined against the fetch/axios calls the frontend makes, and flag any call that has NO matching route — the silent bug where the UI calls an endpoint that does not exist (it compiles, the preview loads, but the feature is broken at runtime). It detects Express/Fastify, FastAPI/Flask and Spring routes, lists unused routes too, and fixes mismatches before calling the app done.
• ARCHITECTURE ONBOARDING (A2 — Understand before editing): when v5.0 opens an app it did not just build — an imported repo or a large existing project — it can produce a quick orientation map from the real import graph: the entry points, the core (most-imported) modules, the structural areas by folder, the key dependencies, and a suggested reading order. So it understands how the app is put together before making changes, instead of editing blind.
• AST CODEMODS (C7 — Surgical multi-file edits): for repo-wide structural changes v5.0 uses exact AST codemods instead of risky whole-file rewrites — rename a symbol across every file, add a React prop and update every usage site, or move/rename a file and rewrite every import that points to it (relative or @/alias) in one atomic step. So a rename or file-move updates all call sites correctly instead of missing some and breaking the build.
• CODE-GRAPH QUERIES (A1 — Safe editing at scale): before changing a shared file, v5.0 can QUERY the project's real import graph instead of guessing — "who imports this file?", "what does it depend on?", the full set of files a change would ripple to (its change-impact / blast radius), and where a symbol is defined. This lets it update every call site and read the affected files first, so edits to a big/unfamiliar app are deliberate, not blind.
• CROSS-LANGUAGE TYPECHECK (B6 — Every language compiles): for a polyglot app, v5.0 doesn't just check the frontend TypeScript — it compiles EVERY language in the project and reports OK/FAIL per language: tsc for TS/TSX, Python compile for .py files, Maven compile for Java, and go build for Go. So "verified" means the Java, Python, and Go parts actually compile too, not just the UI — a type/compile error in any language is caught before the build is called done.
• CROSS-LANGUAGE TYPE-CHECK (B6): beyond TypeScript (tsc), v3.0 can type/compile-check a polyglot app's OTHER languages — Python via mypy (or a py_compile syntax check) and Java by compiling with Maven/Gradle/javac — and report honest per-language error counts. If a toolchain isn't available in the sandbox it says the check could not run, never a fake "clean". Useful for a full-stack app with a Python/Java backend.
• RUNS THE PROJECT'S OWN TESTS (B4 — Earned Verification): beyond a typecheck, v5.0 can auto-detect and actually RUN your app's real test suite — Vitest/Jest/Playwright for JS/TS, pytest for Python, Maven/JUnit for Java, and go test for Go — then read honest passed/failed counts and the names of failing tests. It picks up the project's own "test" script or test config automatically (great for an imported repo that already ships tests), reports real PASS/FAIL rather than assuming, and fixes failures before claiming the build is verified — without ever faking a green result.
• REQUIREMENT COVERAGE check (Phase 10 — Product Understanding): v5.0 compares what you ASKED for against what was actually built — if you requested a feature (e.g. login, dashboard, cart, admin) and no matching page/component exists, it flags it so the agent builds it instead of silently skipping it. Nothing you asked for gets quietly dropped.
• RUNNABILITY check (Phase 6 — Execution Quality): when v5.0 evaluates a build, it checks the app can actually START and BUILD — a run script (dev/start), a build script for deployment, and an index.html entry for Vite/CRA apps — so it catches "it compiles but won't run" before saying the app is done.
• SEO/METADATA check (Section I #19): v5.0 checks the app's HTML entry for the discoverability essentials — a page title, viewport (mobile), meta description, and html lang — and flags any that are missing, so your app is search-friendly and shareable, not invisible.
• GAME BUILDING — the engine layer (generate_game_runtime, 2026-08-09): v5.0 can now build GAMES, not just apps. Ask for a game and it first lays down a real game runtime — a fixed-timestep loop (so the game runs identically on a 144Hz gaming monitor and a cheap Android, and switching tabs cannot teleport your player), one input system that handles keyboard, mouse AND a touch joystick with on-screen buttons so the same game works on a phone, an event system, object pooling (this is what stops the stutter that makes browser games feel cheap), save/load, and "game feel" — screen shake, hit-stop and easing, which is what makes a hit actually land. No game engine is downloaded, so your game stays light and loads fast. HONEST LIMIT: NavBharatAI builds games from CODE and shapes, not from a library of ready-made 3D characters and buildings — so 2D games, and low-poly or stylised 3D where simple shapes ARE the art style, come out genuinely good. A photo-realistic 3D world with detailed human characters is NOT something it can make today, and it will say so rather than hand you grey boxes and call them a village.
• 3D GAMES — the look (generate_game_3d, 2026-08-09): for a 3D game v5.0 adds a real scene layer — nine lighting moods (day, sunset, night, overcast, horror, desert, forest, underwater, neon), each with proper sky+sun+bounce lighting, fitted shadows and matching fog so the world does not end at a visible edge; camera rigs (third-person that will not push through walls, first-person, top-down, side-view); colour palettes including an Indian-village one; and procedural landscapes — hills, trees, rocks and buildings generated from code, placed in ONE draw call so hundreds of them still run smoothly on a phone. What makes a 3D scene look good is the lighting and colour setup, not how detailed the models are — that is what this gets right by default.
• GAME CHARACTER — how it FEELS to move (generate_game_controller, 2026-08-09): the player controller v5.0 builds includes the small things that separate a game that works from one that feels good — the jump still works for a split second after you run off a ledge (so pressing slightly late still jumps, which is what everyone actually does), a jump pressed just before you land is remembered and fires the moment you touch down, letting go of the button early gives a shorter hop, the character steps over small ledges instead of getting stuck on them, and steep slopes slide instead of being climbed. These look like small details and they are the difference between controls that feel responsive and controls that feel sticky.
• APP UPDATE NOTICE (Android, 2026-08-11): if you installed NavBharatAI from the Play Store and a newer version is published, the app now tells you — a small "A new version is available" bar at the top with an Update button that opens the Play Store listing. Tap "Later" and it stays quiet for three days, and it never nags again for a version you already dismissed (a genuinely NEWER release will still tell you). It only appears in the installed Android app: the website always loads the latest version already, so there is nothing to update there. If the app cannot check, it shows nothing rather than guessing — you will never be sent to the Play Store for a version you already have.
• GAME COMBAT, ENEMIES + WAVES (generate_game_systems, 2026-08-10): v5.0 builds the actual gameplay — enemies that see you, chase you and attack, health and damage, shooting, collectibles, and waves that get harder as you survive. What matters here is that it gets right the things a hand-made game usually gets wrong: an enemy standing next to you cannot drain your whole health bar in half a second (there is a brief protection window after every hit — without it, damage lands 60 times a second); fast bullets actually hit small enemies instead of passing straight through them; a group of enemies spreads out instead of all merging into one spot; enemies notice you at a sensible distance rather than the whole level walking at you from the start; and a wave always finishes even if one enemy falls off the map, so you are never left standing in an empty level waiting. Difficulty rises steadily and enemy speed is capped, so later waves are hard but never impossible, and every run is repeatable from the same starting seed.
• PLAYABLE GAME — the part that turns the pieces into a game (generate_game_shell, 2026-08-10): everything above is a set of parts; this is what assembles them into something you can actually play, with a HUD (score, health bar, lives), a pause screen (Esc) and a game-over screen with "Play again" that really restarts. It also quietly handles the things that make browser games break for real users — the game runs at the same speed on a 144Hz gaming monitor and a cheap phone (get this wrong and the character literally jumps higher on a better screen), it pauses when you switch tabs, it recovers instead of going permanently black if the phone's graphics reset, and it cleans up properly when you leave the game screen (skip that and the browser refuses to show any 3D at all after a few visits). Sound is unlocked on your first tap, which is the #1 reason web games are silent. If a device cannot do 3D at all, it says so honestly instead of showing a black screen.
• GAME EFFECTS + SOUND (generate_game_vfx, 2026-08-10): this is what makes a hit feel like it HAPPENED instead of just changing a number. v5.0 adds particle effects (muzzle flash, impact sparks, explosions, dust when you land, smoke, blood, heal and pickup sparkles) and real game sound, and — the important part — it wires them together in ONE place, so every event fires its effect, its sound, a small camera shake and a split-second freeze all at once. That combination is what people feel as "impact"; games that add the sound but forget the shake feel weak and nobody can say why. The effects are drawn in a way that stays fast even with hundreds of particles on a cheap phone, and the sound uses the browser trick that most hand-made web games get wrong (browsers block sound until you tap once — the #1 reason a web game is silent). HONEST LIMIT: the effects are generated from code, but SOUND FILES are yours to add — until you do, the game runs perfectly and simply stays quiet rather than pretending to play a sound it does not have.
• MOTION / ANIMATION recipe (generate_animation): v5.0 can add a dependency-free motion pack so your app feels alive instead of assembled — entrance animations (fade / slide up / slide down / scale, with a one-line stagger for lists), press-and-lift feedback on buttons and cards, and reveal-on-scroll via a <Reveal> component. NO animation library is installed, so your app does not get heavier: it is plain CSS moving only transform and opacity, which phones animate on the GPU and keeps it smooth on low-end Android. It also respects the phone\'s "reduce motion" setting automatically — for people who get motion sickness every effect switches itself off while the content still appears instantly. Just ask for animations, or say "make it feel more alive".
• PROJECT HYGIENE check (Section I #22 — Developer Experience): v5.0 checks your project has the basics — a .gitignore (so node_modules/.env/secrets don't get committed) AND that an existing .gitignore actually ignores node_modules (or it gets committed anyway — huge, platform-specific, breaks installs), a tsconfig.json for TypeScript, and a lockfile for reproducible installs — and flags what's missing.
• ERROR BOUNDARY check (Section I #5 — Frontend resilience): for a real React app, v5.0 checks there's an error boundary so one component crash degrades gracefully instead of white-screening the whole app — and flags it if missing (the app-must-never-break rule, applied to the apps you build).
• SECURITY CONFIG check (Section I #4 — Security): v5.0 scans for insecure configuration — disabled TLS certificate verification (man-in-the-middle risk), wildcard "*" CORS (any site can call your API), and Math.random() used to make tokens/secrets (predictable, guessable) — and flags them so your app isn't shipped with an open security hole.
• SECRET LEAK check (Section I #4 — Security): v5.0 flags a real .env file (with live API keys / passwords) that isn't covered by .gitignore — the #1 way secrets get committed to git forever — so you fix it before it leaks.
• HARDCODED URL check (Section I #11 — Deployment readiness): v5.0 flags hardcoded http://localhost URLs baked into code (the classic "works locally, breaks when deployed" bug) so they're read from an env var instead — it does NOT flag the correct env-var-fallback pattern.
• HARDCODED PORT check (Section I #11 — Deployment readiness): v5.0 flags a server bound to a hardcoded port (e.g. app.listen(3000)) instead of process.env.PORT — managed hosts (Cloud Run, Heroku, Render) inject the port and route traffic only to it, so a hardcoded port means the app starts but receives no traffic when deployed. It does NOT flag the correct process.env.PORT || 3000 fallback.
• AUTO README (Phase 4 — Docs engine): v5.0 can generate an accurate README.md for your app from the real project — detected tech stack, how to install and run, project structure (components/routes/files) and the available scripts — so every app ships with real, honest documentation (nothing invented).
• AUTO ARCHITECTURE DOCS (Docs engine): for a larger app, v5.0 can also generate an ARCHITECTURE.md from the real import graph — the module dependency map (which files import which), the component + route inventory, and honest structural notes (import cycles, unresolved imports, orphan components) — so the app's design is documented from the actual code, nothing invented.
• DEVELOPER GUIDE (generate_dev_guide — Docs engine): v5.0 can generate a DEVELOPER_GUIDE.md — a human onboarding doc for developers working ON the app: how to run it locally, where the code lives, framework-aware "how to add a page / route / component / API endpoint" recipes, how to test, how to build & deploy, coding conventions, and a troubleshooting table. Derived from the app's real package.json (name, scripts, detected framework) and the env vars the code references — nothing invented. Distinct from the README (what the app IS) and ARCHITECTURE.md (structure). Writes DEVELOPER_GUIDE.md, no keys.
• AUTO .env.example (Phase 4 — Config engine): v5.0 can generate a .env.example listing every environment variable your code actually uses (preserving any values you've already set), so your app runs for other people too — fixing the classic "works on my machine" gap where the code needs a key nobody was told to set.
• AUTO .gitignore (Section I #22 — Config engine): v5.0 can generate a correct, stack-aware .gitignore (node_modules, build output, .env secrets, plus framework-specific entries from your real dependencies) so secrets and junk never get committed.
• AUTO OBSERVABILITY (P-CGE.11 — Observability engine): v5.0 can add real, dependency-free instrumentation to the app it builds — a client-side error handler (catches uncaught errors + unhandled promise rejections), an Express request logger (method/path/status/duration), and a GET /health endpoint — then wires each in, so a deployed app isn't a black box (no forced extra installs; point it at Sentry/Datadog later).
• AUTO BUNDLE OPTIMIZATION (P-CGE.10 — Bundle engine): for a production Vite+React app, v5.0 can add real, dependency-free bundle optimization — vendor code-splitting (Rollup manualChunks → react-vendor/vendor chunks for better caching) and a lazyWithRetry helper (React.lazy route splitting with a one-time reload on a stale chunk) — so the initial bundle stays small and routes load on demand.
• AUTO SEED DATA (P-CGE.13 — Data engine): after defining a data model, v5.0 can generate realistic, deterministic sample rows for each entity into fixtures/seed.json (values inferred from field names/types — names, emails, prices, dates, statuses — seeded by row index so they're varied but reproducible), so the app can be exercised with data instead of an empty database (dependency-free; no faker install).
• AUTO AUTH (P-CGE.8 — Auth engine): when an app needs login / protected routes, v5.0 can generate REAL working auth — a dependency-free HS256 JWT module (sign/verify via Node crypto, reads JWT_SECRET) plus an Express Bearer-token middleware (runs with no install), or Firebase client auth helpers (signIn/signUp/signOut/onAuthChange) — then wires them in, so auth is real, not a stub.
• AUTO DB MIGRATION (P-CGE.6 — Schema engine): after defining a data model, v5.0 can generate the database schema from the entities — a Prisma schema (prisma/schema.prisma) and/or a SQL CREATE TABLE migration (migrations/001_init.sql) for PostgreSQL/MySQL/SQLite — with column types inferred from field names/types (id→primary key, email→unique, *_at→timestamp, price→float, count→int), so the app ships with a real schema, not just type stubs.
• AUTO DEPLOY ARTIFACTS (P-CGE.9 — Deploy engine): before shipping, v5.0 can write the files an app needs to deploy — a production Dockerfile (alpine, multi-stage, non-root), a docker-compose.yml, and a GitHub Actions CI workflow (install → lint → test → build, only the commands you actually have) — straight into the workspace, so the generated app is deployable out of the box.
• IMPORT PROJECT (.zip) — ANY SIZE (admin 2026-07-28): tap the 📎 attach button in NavBharatAI Pro v5.0 and choose "Import project (.zip)". This is a DEDICATED option, separate from "Choose file", because a project is an IMPORT, not a chat attachment. Your zip is uploaded in small pieces and unpacked on the server WITHOUT ever loading the whole archive into memory — zips up to 5 GB work (a real 4-5 GB zip is almost all node_modules/media, which are skipped honestly; the source inside imports fine), and your files open straight in the Files tab / Code Studio, ready to edit. It does NOT start a build and does not spend tokens — you import first, then tell the AI what to change. If the zip only contains node_modules or build output it says so honestly instead of importing nothing. (A zip attached through the ordinary "Choose file" option was previously packed into the build request and refused above 18 MB — that path is gone; use this option.)
• PUBLISH / HOSTING CHOOSER (Hosting Phase 1): the "Publish" button (top of the v5.0 chat, or the mobile More sheet → Publish) opens a chooser with THREE ways to ship your app (admin 2026-08-13): (1) "Host on NavBharatAI" — our own one-click hosting, Free, no account, permanent link (frontend/static now; full-stack hosting with a running backend + database is coming soon), (2) "Host somewhere else" — your OWN hosting, offered as two sub-choices in one card: (a) "We deploy to your provider" — WE publish to your own Vercel / Netlify / Cloudflare / GitHub Pages account (your account, your bill, free from us; only providers you've actually configured are offered), OR (b) "I host it myself" (Set up) — for users who don't want NavBharatAI touching hosting at all: NavBharatAI only writes code and opens a pull request into YOUR OWN GitHub repo (a dedicated 'navbharatai/work' branch), merging into your main branch only once your checks are green; your own host — connected to that exact repo on ITS OWN dashboard (Vercel/Netlify/Render/Cloudflare Pages "Import Git Repository") — picks up every merge and deploys it automatically, and NavBharatAI never sees or touches your deploy credentials (needs GitHub connected and an imported/owned repo to activate), and (3) "Make an Android app" — turns this app into a real installable Android app (.apk); it opens the built-in APK Builder already targeted at this exact app, so you don't re-pick it (built on your own GitHub account; a paid step — the builder shows the price first — see the APK Builder entry for the full flow). If your app SAVES data (a login, orders, bookings, any records) and you have not connected a database yet, the Publish screen tells you so before you publish — it names exactly what in your app needs one, and offers two answers: "Create one free in my account" (one tap, inside your OWN database account, only shown when your account is already connected) or "Connect my own database" (opens Settings → App Settings → Database). You can also choose "Publish without a database" — the site will load, but anything that saves data will not work, and NavBharatAI says that plainly instead of letting you find out from real users. After publishing via (1) or (2), a "Live site" link appears. When custom-domain hosting is enabled, "Host on NavBharatAI" also shows a "Connect your own domain" option: enter your domain (e.g. myshop.com), and NavBharatAI shows the exact DNS records to add at your registrar (Hostinger/GoDaddy/etc.) and issues free HTTPS automatically once they resolve — the domain then serves this app. Publish once after connecting so the domain serves your latest build. This SAME "Connect your own domain" flow is also reachable from Sidebar → More menu → "Connect my website" and Home → Other AI → Publish & Deploy → "Custom Domain" (one real flow, not three different screens — root-cause fix 2026-07-27).
• INFRASTRUCTURE-AS-CODE (GA-15 — IaC engine): for deploying to a cluster or cloud, v5.0 can also generate real Kubernetes manifests (a non-root Deployment with health probes + resource limits, a Service, an HPA, and an Ingress), a values-parameterized Helm chart, Terraform for Google Cloud Run, and an Ansible playbook (deploys the container to your own SSH hosts via community.docker, with a healthcheck) — ready to "kubectl apply" / "helm install" / "terraform apply" / "ansible-playbook". Pick a subset with the include option; Ansible deploys to servers you already have (it does not provision them — that's Terraform's job).
• VULNERABILITY SCAN (GA-13 — supply-chain security): v5.0 can scan the app's dependencies for known CVEs / GitHub advisories against the OSV.dev database and report each vulnerable package with its advisory IDs, so a real app ships without known-vulnerable packages. It is honest — if the advisory database is unreachable it says the scan could not run, never a fake "all clear".
• THREAT MODEL (GA-13 — own-code security scan): v5.0 can threat-model your app's OWN code (not just dependencies) and flag the most exploitable web-app defects — a secret hardcoded into client-side code (it ships to every visitor's browser), a wildcard CORS with credentials, SQL built by string interpolation (injection), XSS via dangerouslySetInnerHTML from a non-constant, and eval() on a non-literal — each with the file, line and fix. High-precision (no vague warnings), advisory only. It also surfaces automatically in the build readiness check. Ask to "threat-model / security-check my app" before shipping.
• LICENSE CHECK (dependency copyleft compliance): v5.0 can check your app's dependency licenses and flag copyleft-compliance risk — strong-copyleft (GPL/AGPL) packages that could require you to release your own source, plus weak-copyleft (LGPL/MPL) ones for awareness — reading package-lock.json and classifying each SPDX license. It confirms "no copyleft risk" when the app is all-permissive. Advisory only (never blocks a build). Ask to "check my licenses / any GPL dependencies?" before shipping.
• DATABASE MIGRATIONS (GA-10 — migration runner): for a fullstack app with a database, v5.0 detects the migration tool the project uses (Prisma, Knex, Drizzle, TypeORM, Sequelize, Flyway, Alembic) and applies the schema by running the real migration command in the sandbox — reporting the true result, never a fake "migrated" — so the app does not boot against an empty database and crash.
• ENGINEERING MEMORY (GA-6 — ADR + migration history): v5.0 remembers a project's architecture across builds. On a successful build it captures the real detected stack (framework + database + styling + language) as a dated, numbered decision record written to docs/decisions/ADR-NNN.md, and reads prior decisions back into the next build so follow-up work stays consistent with the established stack (a no-change rebuild adds no duplicate record). It also keeps a migration-run history per project, so before re-running migrations the AI sees what schema was already applied, when, and whether it succeeded — instead of blindly re-running.
• BRING-YOUR-OWN DATABASE (connection wiring): v5.0 can wire the app to connect to your OWN database — Supabase, Neon, Firebase, or plain Postgres — generating a real client module + the .env.example keys + the dependency. You paste your credentials into .env (NavBharatAI never stores them). It wires the connection; creating the database itself is done in the provider's own console.
• PAYMENTS (Razorpay / Stripe): v5.0 can add a real payment checkout to your app — a server route that creates the order/session AND verifies the payment signature (the payment is never trusted from the client alone) plus a client checkout helper. Razorpay (India-first) and Stripe are supported. You paste your provider keys into .env; NavBharatAI never stores them.
• TRANSACTIONAL EMAIL (Resend / SendGrid): v5.0 can add a real server-side sendEmail() helper for signup confirmation, password reset, receipts and notifications. You paste your provider API key + a verified sender into .env; NavBharatAI never stores them.
• FILE UPLOADS / STORAGE (S3 / R2 / Supabase / Cloudinary): v5.0 can add real file uploads — a server route + a client uploadFile() helper that uploads directly to storage (presigned URL for S3-compatible providers, a signed upload for Cloudinary), so the file never proxies through your server and your secret never leaves it. You paste your keys into .env; NavBharatAI never stores them.
• REALTIME (Pusher / Ably): v5.0 can add live pub/sub for chat, notifications, presence and collaborative updates — a server publish() helper + a client subscribe() that returns an unsubscribe cleanup. You paste your keys into .env (the secret stays server-side); NavBharatAI never stores them.
• FULL-TEXT SEARCH (Algolia / Meilisearch): v5.0 can add real search to a content-heavy app (catalog, docs, marketplace) — a server indexer (indexRecords, uses the admin/write key) + a client search() (uses a search-only key that is safe in the browser). The admin key stays server-side; NavBharatAI never stores your keys — you paste them into .env.
• LIST PAGINATION (generate_pagination): v5.0 can add real, DoS-safe pagination (server/lib/pagination.ts) — dependency-free parsePagination(req.query) → a clamped { limit, offset, page } (caps limit so ?limit=999999 cannot OOM the DB, floors a bad/missing page at 1) and pageMeta(total, params) → { total, page, pages, hasNext, hasPrev }. Use on any list endpoint (products, orders, posts, search); feed limit/offset into SQL LIMIT/OFFSET or .skip()/.take(). No keys.
• PHONE OTP / VERIFICATION (MSG91 / Twilio Verify): v5.0 can add real phone-number verification — a server sendOtp(phone) + verifyOtp(phone, code) pair (MSG91 India-first, or Twilio Verify) so signup/login can confirm a real number. You paste your keys into .env; NavBharatAI never stores them.
• AUTHENTICATOR 2FA / TOTP (generate_totp): v5.0 can add real app-based two-factor auth (server/lib/totp.ts, RFC 6238) — dependency-free (node:crypto) generateTotpSecret() to enroll a user, totpAuthUrl({issuer, account}) → an otpauth:// URI you show as a QR code (pair with generate_qr) for Google Authenticator / Authy / 1Password, and verifyTotp(secret, code) that gates login with a constant-time compare and ±1-step clock-drift tolerance. This is the 6-digit-authenticator-app second factor — distinct from PHONE OTP (which is SMS). No API key, no dependency.
• INDIAN VALIDATORS (generate_indian_validators): v5.0 can add real Indian identity/format validators (server/lib/indianValidators.ts) — dependency-free isValidPAN, isValidGSTIN, isValidAadhaar, isValidIFSC, isValidPincode, isValidUPI, isValidIndianMobile, plus normalizeIndianMobile(num) → one canonical +91XXXXXXXXXX form (tolerates +91/0/spacing; null if invalid) for de-duping users and passing to SMS/WhatsApp APIs. GSTIN and Aadhaar verify the REAL government checksum (GSTIN mod-36, Aadhaar Verhoeff), so a single mistyped character is caught at the form instead of failing later in a payout or a tax filing — a bare regex would let it through. Use at signup/KYC/invoice/payout forms. No keys.
• TRANSACTIONAL SMS (Twilio / Vonage): v5.0 can add a real server sendSms(to, message) helper for order updates, alerts and one-off notifications. You paste your keys + sender into .env (server-side only); NavBharatAI never stores them.
• PASSWORD HASHING (generate_password): v5.0 can add real secure password hashing (server/lib/password.ts, bcryptjs) — hashPassword(plain) to store at signup (bcrypt cost 12, per-password salt; NEVER plaintext or a fast MD5/SHA hash), verifyPassword(plain, hash) to gate login (constant-time, fails safe), and needsRehash(hash) to transparently upgrade older hashes. Complements the auth/JWT generator (issue the session only AFTER verifyPassword). bcryptjs is pure JS (no native build). Adds the bcryptjs dependency; no keys.
• SECURE IDS & TOKENS (generate_ids): v5.0 can add real crypto-secure ID/token generation (server/lib/ids.ts) — dependency-free newId() (UUID v4 primary key / public record id), shortId() (compact URL-safe share/referral code, base62 with no modulo bias), secureToken() (long unguessable token for password-reset / email-verification links & API keys) and hashToken() for at-rest storage. All from the node:crypto CSPRNG — never Math.random(), which is predictable and would let an attacker guess a reset token. No keys.
• PRODUCT ANALYTICS (PostHog / Mixpanel): v5.0 can add real event tracking — a client track(event, props) + identify(userId) so you can see what users actually do. You paste your project key into .env; NavBharatAI never stores it.
• INTERACTIVE MAPS (Google Maps / Mapbox): v5.0 can add a real interactive map component (markers, pan/zoom) to your app. You paste your map key into .env; NavBharatAI never stores it.
• GEOCODING (Google / Mapbox): v5.0 can add a server geocode(address) → { lat, lng } (and reverse) helper — turn an address into coordinates for maps, delivery and store-locators. Server-side (the key never reaches the browser); you paste it into .env; NavBharatAI never stores it.
• BACKGROUND JOBS / QUEUES (BullMQ / pg-boss): v5.0 can add a real job queue — an enqueue(name, data) producer + a worker that processes jobs off-request (emails, exports, image processing) so slow work doesn't block the response. Uses your Redis (BullMQ) or Postgres (pg-boss); you paste the connection into .env; NavBharatAI never stores it.
• JOB SCHEDULER / CRON (generate_scheduler): v5.0 can add a real recurring-job scheduler (server/lib/scheduler.ts) — dependency-free scheduleEvery(ms, fn) for fixed-interval work (hourly sync, cleanup) and scheduleDailyUtc(hour, minute, fn) for "run once a day at HH:MM UTC" (nightly purge, daily digest). The daily job recomputes its next run each day so it never drifts, a thrown run never stops the loop, and each returns stop(). Distinct from background jobs (a queue). Honest scope: in-process only — for a run that survives a restart/scale-to-0, drive it from an external cron. No keys.
• API RATE LIMITING (in-memory / Redis): v5.0 can add a real rate-limit middleware that caps requests per IP/user (protects login, APIs and expensive routes) — in-memory for a single instance or Redis-backed for multi-instance. You paste the Redis URL (if used) into .env; NavBharatAI never stores it.
• API VERSIONING (generate_api_versioning): v5.0 can add a real API-versioning middleware (server/lib/apiVersion.ts) — dependency-free, it resolves the client-requested version from the X-API-Version header (or the standard Accept-Version), accepts "v2" or "2", falls back to a default when none is sent, and rejects an unknown version with 406 + the supported list. The resolved version is on req.apiVersion (branch on it, or mount separate v1/v2 routers) and echoed on the response — so the app can evolve its API without breaking existing clients. No dependency, no key.
• ERROR TRACKING (Sentry / Rollbar): v5.0 can wire real production error monitoring — client + server capture so exceptions reach your dashboard with stack traces instead of vanishing. You paste your DSN/token into .env; NavBharatAI never stores it.
• FEATURE FLAGS (LaunchDarkly / Unleash): v5.0 can add a real isEnabled(flag, user) helper so you can turn features on/off and roll out gradually without a redeploy. You paste your SDK key into .env; NavBharatAI never stores it.
• AI / LLM TEXT (OpenAI / Anthropic): v5.0 can add a real server generateText(prompt) helper so your app can do AI text generation, summaries and chat. Server-side (the key never reaches the browser); you paste it into .env; NavBharatAI never stores it.
• TRANSLATION (Google Translate / DeepL): v5.0 can add a real server translate(text, targetLang) helper to localize content on the fly. Server-side; you paste your key into .env; NavBharatAI never stores it.
• CONTENT MODERATION (OpenAI Moderation / Perspective): v5.0 can add a real server moderate(text) → { flagged, score } helper to catch toxic/unsafe user content before it is shown or stored — it fails OPEN so a moderation outage never blocks your app. You paste your key into .env; NavBharatAI never stores it.
• CAPTCHA / BOT PROTECTION (generate_captcha): v5.0 can add real CAPTCHA verification (server/lib/captcha.ts) — a dependency-free verifyCaptcha(token, ip?) that checks the client token SERVER-SIDE against Cloudflare Turnstile, hCaptcha, or Google reCAPTCHA v2/v3 (CAPTCHA_PROVIDER + CAPTCHA_SECRET in .env), enforcing the reCAPTCHA v3 score. Use on public forms (signup/login/contact) — the client widget alone is not enough, a bot can forge the token. FAILS CLOSED (an unverifiable token is rejected) so an outage never lets bots through. You paste the secret into .env; NavBharatAI never stores it.
• CACHING (Redis / Upstash): v5.0 can add a real key/value cache — cacheGet / cacheSet(ttl) / cacheDel (JSON-serialised) so expensive DB queries and API responses are served instantly next time. Redis over TCP or Upstash over HTTP (serverless/edge); you paste the connection into .env; NavBharatAI never stores it.
• RETRY WITH BACKOFF (generate_retry): v5.0 can add a real resilience helper (server/lib/retry.ts) — dependency-free retry(fn, { attempts, baseMs, shouldRetry, signal }) that wraps a flaky external call (payment gateway, third-party API, DB mid-failover) with exponential backoff + FULL JITTER (avoids a retry storm), a shouldRetry predicate, an attempt/delay cap and AbortSignal cancellation, and rethrows the last error on give-up (never a fake success). Only retry idempotent work (GET/PUT or an idempotency-keyed payment) — retrying a bare create can duplicate it. No keys.
• RESILIENT HTTP CLIENT (generate_http_client): v5.0 can add a resilient HTTP client (server/lib/http.ts) — dependency-free fetchJson(url, { timeoutMs, headers, method, body }) that fixes the three classic bare-fetch bugs: it adds a REAL timeout (default 10s via AbortController) so a dead upstream fails fast instead of hanging the request forever, throws HttpError on any non-2xx status (native fetch resolves on 4xx/5xx — a silent bug), and returns parsed JSON. Use it for every server-side call to a third-party API; wrap with generate_retry for automatic backoff. No keys.
• IDEMPOTENCY (generate_idempotency): v5.0 can add real idempotency (server/lib/idempotency.ts) — a dependency-free Express middleware + createMemoryStore() that make a POST run ONCE per client "Idempotency-Key" header and replay the same response for any repeat, so a double-tap or a retried/dropped request never double-charges or double-creates. A 5xx is not cached (stays retryable); a still-in-flight repeat gets 409. Guard payment/order mutations with it (pairs with retry). In-memory (per-instance) — swap the store for Redis to scale. No keys.
• NEWSLETTER / MAILING LIST (Mailchimp / Brevo): v5.0 can add a real server subscribe(email) helper for the "join our newsletter / waitlist" signup that adds a contact to your list (distinct from transactional email, which sends one-off mails). You paste your key + list id into .env; NavBharatAI never stores them.
• EMAIL TEMPLATE BUILDER (generate_email_template): v5.0 can add a real HTML email template builder (server/lib/emailTemplate.ts) — dependency-free renderEmail({ title, heading, body, button, footer, preheader }) → { html, text }. The HTML is responsive, TABLE-based with INLINE styles (renders correctly in Outlook/Gmail, unlike a div/flex email) with a bulletproof button, every value escaped; it also returns the matching PLAIN-TEXT body (send both so it stays out of spam). Use for welcome / verify / reset / receipt emails; pass .html + .text into the email-send recipe. No keys.
• CURRENCY CONVERSION (ExchangeRate-API / Fixer): v5.0 can add a real server getRate(from, to) + convert(amount, from, to) helper for multi-currency pricing and international checkout. Server-side; you paste your key into .env; NavBharatAI never stores it.
• INDIAN MONEY FORMATTING (generate_money_format): v5.0 can add real Indian money/number formatting (server/lib/money.ts) — dependency-free formatInr(paise) → a correctly lakh/crore-grouped ₹ string (12345678 → "₹1,23,456.78"), formatIndianNumber(n) → Indian-grouped counts, and rupeesInWords(rupees) → the amount in words (lakh/crore) for invoices/cheques — with paise and the legal "Rupees … Only" suffix, correct into the thousands of crores. Built on native Intl en-IN so grouping is right (NOT Western thousands). Store money as integer paise. Distinct from currency conversion. No keys.
• WEATHER (OpenWeatherMap / WeatherAPI): v5.0 can add a real server getWeather(city) → { tempC, description, humidity } helper for delivery ETAs, travel and dashboards — it returns null on failure so a weather outage never breaks the app. You paste your key into .env; NavBharatAI never stores it.
• IST DATE/TIME FORMATTING (generate_datetime): v5.0 can add real IST date/time formatting (server/lib/datetime.ts) — dependency-free formatIstDateTime/formatIstDate/formatIstTime that render any timestamp in IST (Asia/Kolkata) regardless of the server timezone (fixing the UTC-server bug where times show 5.5h off), plus relativeTime(ts) for a "2 hours ago" label. Accepts a Date, ISO string or epoch-ms and guards invalid dates. Use on order/appointment/"posted at" labels. Built on native Intl; no keys.
• TEAM NOTIFICATIONS (Slack / Discord): v5.0 can add a real server notify(message) helper that posts to your Slack/Discord channel on the events that matter (a new order, signup, failed payment) — it never throws, so a notification failure can't break the request. You paste the webhook URL into .env; NavBharatAI never stores it.
• FAIL-FAST ENV VALIDATION (startup guard): v5.0 can add a real environment-variable validator (server/lib/env.ts) — requireEnv() checks every required var (DATABASE_URL, API keys, …) is set and non-empty AT STARTUP and crashes the app with ONE clear message naming any that are missing, so a misconfigured deploy fails immediately with an actionable error instead of a cryptic 500 deep inside a request later. It enforces the keys the other integrations need (generate_env_example only documents them).
• IMAGE PROCESSING (generate_image): v5.0 can add real image resize/optimize (server/lib/image.ts, sharp) — resizeImage(buffer, { width }) turns a heavy upload into a fast WebP web asset (honours EXIF orientation) + makeThumbnail(buffer, 200) for a square avatar/tile. Pair with file uploads: resize before storing. Server-side, no keys.
• PDF FILES (generate_pdf): v5.0 can add real PDF generation (server/lib/pdf.ts) — a createInvoicePdf(...) ready invoice + a generic createPdf((doc) => …) builder (pdfkit) that return a Buffer to stream as the response, save, or email. Core for GST/tax invoices, receipts, order confirmations, tickets and reports. Server-side, no keys.
• QR CODES (generate_qr): v5.0 can add real QR-code generation (server/lib/qr.ts) — a server generateQr(text) → PNG data-URL + generateQrSvg(text) → SVG helper, for event/movie tickets, UPI & payment links, "scan to open", table ordering and share links. Server-side, generated on demand per order/ticket; adds the qrcode dependency, no keys.
• UPI PAYMENT LINK (generate_upi): v5.0 can add a real UPI payment deep-link (src/lib/upi.ts) — India-first, dependency-free, NO API key and NO payment gateway. buildUpiLink({ payeeVpa, payeeName, amount, note }) returns a "upi://pay?..." link that opens GPay/PhonePe/Paytm/BHIM directly for a real payment to the merchant's OWN VPA; isValidVpa(vpa) validates the address; omit amount for an open collect link where the payer types it. Params are URL-encoded and the amount is fixed to 2 decimals (UPI spec) so it works on the first tap; pairs with generate_qr for a scan-to-pay code. For a full gateway with webhooks/refunds use generate_payment instead. No keys.
• CSV IMPORT/EXPORT (generate_csv): v5.0 can add real CSV import/export (server/lib/csv.ts) — a server toCsv(rows) → Excel-ready CSV string + parseCsv(text) → objects, for report/table export ("download as CSV") and bulk product/contact/order import from an uploaded file. Quoting/escaping of commas, quotes and newlines is RFC-4180 correct (built on papaparse), so data never corrupts. Server-side; adds the papaparse dependency, no keys.
• AUDIT LOG (generate_audit): v5.0 can add a real tamper-evident audit log (server/lib/audit.ts) — dependency-free (node:crypto), NO API key, storage-agnostic. appendAudit(store, { actor, action, target, meta }) records who did what when; each entry stores the SHA-256 hash of the previous entry (a hash chain), so if anyone later edits or deletes a past row the chain breaks. verifyAuditChain(entries) returns the seq of the first tampered entry (or -1 if intact). You back it with a tiny { last(), save() } store on your own DB. Use it for admin actions, refunds/money movements, role changes and sensitive data edits. No keys.
• SOFT DELETE / TRASH & RESTORE (generate_soft_delete): v5.0 can add a real soft-delete pattern (server/lib/softDelete.ts) — dependency-free and storage-agnostic. Instead of hard-deleting a record, softDelete(record) stamps deletedAt so it can be RESTORED (undo delete, a Trash/Bin, audit-friendly retention); restore(record) brings it back, isDeleted(record) checks it, and activeOnly/trashedOnly filter a list. For SQL, add a nullable deleted_at column and use activeWhere() ("deleted_at IS NULL") on your default queries and trashedWhere() for the Trash view. Pairs with the audit-log recipe. No dependency, no key.
• BOOKING / APPOINTMENTS (generate_booking): v5.0 can add a real booking backend (server/booking/) — a packaged domain vertical for clinics, salons, tutors and consultants. The real guarantee is correct DOUBLE-BOOKING PREVENTION: a slot holds at most one confirmed booking and cancelling frees it. Ships a dependency-free BookingService (book / cancel / isSlotAvailable / list) + an Express router — POST /bookings (409 if the slot is already taken), GET /bookings (filterable), GET /slots/:id/available, DELETE /bookings/:id (frees the slot). In-memory by default; swap the store for your DB (same contracts). Slots are defined by your app; pairs with the OTP/payment/notification recipes for a full booking flow. No key.
• INVENTORY / STOCK (generate_inventory): v5.0 can add a real inventory backend (server/inventory/) — a packaged domain vertical for retail/e-commerce. The real guarantee is NO OVERSELLING: reserve() rejects when stock is insufficient and never lets on-hand go negative. Ships a dependency-free InventoryService (setStock / restock / reserve / release / isLowStock / list) + an Express router — GET /stock, GET/PUT /stock/:sku, POST /stock/:sku/reserve (409 if insufficient), POST /stock/:sku/release. In-memory by default; swap the store for your DB (same contracts). Pairs with the payment/notification/audit recipes for a full order flow. No key.
• CRM / LEAD PIPELINE (generate_crm): v5.0 can add a real CRM backend (server/crm/) — a packaged domain vertical for any SMB with a sales motion. The real guarantee is a sales-stage STATE-MACHINE: a lead moves new → contacted → qualified → won/lost along allowed transitions only (won/lost terminal except a reopen to new), and an invalid jump is rejected (409). Ships a dependency-free CrmService (contacts, leads, moveStage, assign, notes, filtered list, openPipelineValue) + an Express router — GET/POST /contacts + /leads, PATCH /leads/:id/stage, PATCH /leads/:id/assign, POST /leads/:id/notes, GET /pipeline/value. In-memory by default; swap the store for your DB. Pairs with the auth/notification/audit recipes. No key.
• HOSPITAL-ERP / EMR (generate_hospital_erp): v5.0 can add a real hospital / clinic EMR backend (server/hospital/) — a packaged domain vertical for hospitals, clinics and healthcare apps. THREE real guarantees: (1) NO DOUBLE-BOOKING — a doctor can never hold two overlapping appointments (409 on conflict; a cancelled appointment frees the slot); (2) RBAC — a role→permission matrix gates patient-record writes (admin/doctor/nurse write, receptionist read-only; 403 on a blocked write, everyone may view); (3) AUDIT — every record write (patient create, note add, appointment change) appends an immutable audit entry. Ships a dependency-free HospitalService (patients, encounter notes, appointments, canEdit/canView, auditTrail) + an Express router — GET/POST /patients, GET /patients/:id, GET/POST /patients/:id/notes, GET/POST /appointments (409 on a doctor double-book), PATCH /appointments/:id/status, GET /audit. The demo auth shim reads x-role/x-user-id headers — replace with real auth. In-memory by default; swap the Maps for your DB. Pairs with the auth/RBAC/audit recipes. No key.
• SCHOOL / EDUCATION-ERP (generate_school_erp): v5.0 can add a real school / education backend (server/school/) — a packaged domain vertical for schools, coaching institutes and LMS apps. THREE real guarantees: (1) IDEMPOTENT ATTENDANCE — marking a (student, class, date) is idempotent (a repeat mark updates the same record, never a duplicate; 404 if the student is not enrolled in the class); (2) VALID GRADES — a recorded score must be within 0..maxMarks (409 otherwise) and a student's percentage is computed exactly; (3) EXACT FEE LEDGER — a student's balance is always invoiced − paid, a payment over the outstanding balance is rejected (409, never negative), and every change is an append-only entry. Ships a dependency-free SchoolService (classes, enrollment, roster, attendance + rate, assessments, grades, percentage, fee invoice/pay/balance) + an Express router — POST /classes, POST /students, GET /classes/:id/roster, POST /attendance, GET /students/:id/attendance(/rate), POST /assessments, POST /grades, GET /students/:id/percentage, POST /fees/invoice, POST /fees/pay, GET /students/:id/fees. In-memory by default; swap the Maps for your DB. Pairs with the auth/notification/payment recipes. No key.
• COURIER / LOGISTICS (generate_courier): v5.0 can add a real courier / logistics backend (server/courier/) — a packaged domain vertical for delivery, courier and last-mile apps. THREE real guarantees: (1) SHIPMENT STATE-MACHINE — status moves created → picked_up → in_transit → out_for_delivery → delivered along allowed transitions only (a failed_attempt loops back; delivered/returned/cancelled are terminal), an invalid jump is rejected (409); (2) APPEND-ONLY tracking history — every status change appends an immutable tracking event so the shipment's trail is complete and ordered; (3) UNIQUE tracking numbers — each shipment mints a unique tracking number with exact lookup. Ships a dependency-free CourierService (createShipment, advanceStatus, assignDriver, getByTracking, history, list) + an Express router — POST/GET /shipments, GET /shipments/:id, PATCH /shipments/:id/status (409 on invalid), PATCH /shipments/:id/driver, GET /shipments/:id/history, GET /track/:trackingNo (public tracking). In-memory by default; swap the Maps for your DB. Pairs with the auth/notification/maps recipes. No key.
• RESTAURANT / POS (generate_restaurant_pos): v5.0 can add a real restaurant point-of-sale backend (server/restaurant/) — a packaged domain vertical for restaurants, cafés and cloud kitchens. THREE real guarantees: (1) TABLE STATE-MACHINE — a table moves free → occupied → billing → free along allowed transitions only (seating an already-occupied table is rejected, 409); (2) KOT ORDER LIFECYCLE — an order moves placed → preparing → served → closed and items can be added only while it is open (adding to a served/closed order is rejected, 409); (3) EXACT GST BILL — subtotal + CGST + SGST (split from the per-item or default GST rate) + grand total, computed exactly and rounded to 2 decimals. Ships a dependency-free RestaurantService (menu, tables, openOrder, addLine, setOrderStatus, bill, closeOrder) + an Express router — GET/POST /menu + /tables, POST /orders, GET /orders/:id, POST /orders/:id/lines, PATCH /orders/:id/status, GET /orders/:id/bill, POST /orders/:id/close. Set restaurant.defaultGstRatePct (default 5) or a per-item gstRatePct. In-memory by default; swap the Maps for your DB. Pairs with the auth/payment/notification recipes. No key.
• REAL-ESTATE / PROPERTY PORTAL (generate_real_estate): v5.0 can add a real property-listing backend (server/realestate/) — a packaged domain vertical for property portals and brokerages. THREE real guarantees: (1) LISTING STATE-MACHINE — a property moves draft → available → under_offer → sold|rented along allowed transitions only (it can be withdrawn from the market; sold/rented/withdrawn are terminal), an invalid jump is rejected (409); (2) APPEND-ONLY price history — every price change records an immutable {from,to,at} entry; (3) INQUIRY CAPTURE — inquiries and price changes are accepted only while the listing is on the market (409 otherwise). Ships a dependency-free RealEstateService (createListing, setStatus, changePrice, addInquiry, inquiriesFor, priceHistory, search by city/kind/status/maxPrice/minBedrooms) + an Express router — GET/POST /listings, GET /listings/:id, PATCH /listings/:id/status, PATCH /listings/:id/price, GET /listings/:id/price-history, POST/GET /listings/:id/inquiries. In-memory by default; swap the Maps for your DB. Pairs with the auth/notification/maps recipes. No key.
• FITNESS / GYM (generate_fitness): v5.0 can add a real gym / fitness backend (server/fitness/) — a packaged domain vertical for gyms, studios and fitness apps. THREE real guarantees: (1) MEMBERSHIP VALIDITY GATE — a check-in is accepted only with an ACTIVE membership (an expired or frozen membership is rejected, 409); (2) DETERMINISTIC renew/freeze date-math — renew() extends by the plan days from max(now, currentEnd) so an early renewal loses no days, and freeze()/unfreeze() shift the end date by the exact frozen duration so no paid day is lost; (3) IDEMPOTENT check-in — at most one per member per day. Ships a dependency-free FitnessService (addPlan, join, isActive/statusOf, renew, freeze, unfreeze, checkIn, checkInsFor, listMembers by status) + an Express router — POST /plans, POST/GET /members(/:id), POST /members/:id/renew, /freeze, /unfreeze, /checkin (409 if not active), GET /members/:id/checkins. In-memory by default; swap the Maps for your DB. Pairs with the auth/payment/notification recipes. No key.
• PHARMACY (generate_pharmacy): v5.0 can add a real pharmacy / medical-store backend (server/pharmacy/) — a packaged domain vertical for pharmacies and chemists. THREE real guarantees (distinct from the inventory recipe): (1) EXPIRY GATE — an expired batch can never be dispensed (409 if all stock is expired); (2) FEFO DISPENSING — draws from the earliest-expiry non-expired batch first (First-Expiry-First-Out) and never oversells across batches (409 on insufficient non-expired stock); (3) CONTROLLED-SUBSTANCE — a prescription-only (Schedule-H) drug needs a prescription id to dispense (403 otherwise). Ships a dependency-free PharmacyService (addDrug, addBatch, availableStock, dispense, expiringBefore, dispenseHistory) + an Express router — GET/POST /drugs, POST /batches, GET /drugs/:id/stock, POST /dispense, GET /dispense/history. In-memory by default; swap the Maps for your DB. Pairs with the auth/inventory/notification recipes. No key.
• RECRUITMENT / JOB-BOARD (generate_recruitment): v5.0 can add a real recruitment / ATS backend (server/recruitment/) — a packaged domain vertical for job portals and hiring apps. THREE real guarantees (a HIRING pipeline, distinct from the CRM sales pipeline): (1) APPLICATION STATE-MACHINE — applied → screening → interview → offer → hired along allowed transitions only (reject/withdraw from any non-terminal stage; hired/rejected/withdrawn terminal), an invalid jump is rejected (409); (2) ONE application per candidate per job (a duplicate is rejected, 409); (3) CLOSED-JOB GUARD — a closed job accepts no applications (409). Ships a dependency-free RecruitmentService (postJob, closeJob/reopenJob, addCandidate, apply, advance, applicationsFor by stage, listJobs) + an Express router — GET/POST /jobs, GET /jobs/:id, POST /jobs/:id/close|/reopen, POST /candidates, POST /jobs/:id/apply, GET /jobs/:id/applications, PATCH /applications/:id/stage. In-memory by default; swap the Maps for your DB. Pairs with the auth/notification/email recipes. No key.
• INVOICING / BILLING (generate_invoicing): v5.0 can add a real invoicing backend (server/invoicing/) — a packaged domain vertical for freelancers, agencies and SMBs. THREE real guarantees: (1) INVOICE STATE-MACHINE — draft → sent → paid|cancelled along allowed transitions only (paid/cancelled terminal), an invalid jump is rejected (409); (2) EXACT PAYMENT LEDGER — balance = total − sum(payments), a payment can never exceed the balance (409, no negative), the invoice auto-marks PAID at zero balance; (3) OVERDUE is DERIVED — a sent, unpaid, past-due invoice reads "overdue" (computed from the dates, never set by hand). Ships a dependency-free InvoicingService (createInvoice, total, balance, setStatus, recordPayment, displayStatus, isOverdue, list by status, outstandingTotal) + an Express router — GET/POST /invoices, GET /invoices/:id (with subtotal/tax/total/balance/displayStatus), PATCH /invoices/:id/status, POST /invoices/:id/payments, GET /invoices/outstanding/total. In-memory by default; swap the Maps for your DB. Pairs with the auth/payment/notification recipes. No key.
• HELPDESK / TICKETING (generate_helpdesk): v5.0 can add a real support-desk backend (server/helpdesk/) — a packaged domain vertical for customer support and IT desks. THREE real guarantees: (1) TICKET STATE-MACHINE — open → in_progress → resolved → closed along allowed transitions only (with a reopen from resolved/closed → open), an invalid jump is rejected (409); (2) PRIORITY-DRIVEN SLA + BREACH DETECTION — each priority has an SLA target (urgent 4h / high 12h / medium 24h / low 72h) and a still-unresolved ticket past its due time is SLA-breached, derived from the dates (reopening restarts the clock); (3) APPEND-ONLY thread — every status change and comment is an immutable, ordered thread entry. Ships a dependency-free HelpdeskService (createTicket, setStatus, assign, addComment, slaDueAt, isSlaBreached, thread, list by status/priority/assignee/breached) + an Express router — GET/POST /tickets, GET /tickets/:id (with slaDueAt + slaBreached), PATCH /tickets/:id/status, PATCH /tickets/:id/assign, POST /tickets/:id/comments, GET /tickets/:id/thread. Tune SLA_HOURS to your policy. In-memory by default; swap the Maps for your DB. Pairs with the auth/notification/email recipes. No key.
• EVENTS / RSVP (generate_events): v5.0 can add a real event-signup backend (server/events/) — a packaged domain vertical for meetups, workshops, webinars and community events. The real guarantee is CAPACITY ENFORCEMENT + a WAITLIST: an event never confirms more attendees than its capacity, overflow RSVPs go to a FIFO waitlist, and cancelling a confirmed seat AUTO-PROMOTES the first waitlisted attendee. Ships a dependency-free EventService (createEvent, rsvp, cancelRsvp, attendees, seatsLeft) + an Express router — POST /events, GET /events/:id (+ seatsLeft), GET /events/:id/attendees, POST /events/:id/rsvp (409 on duplicate), DELETE /rsvps/:id. In-memory by default; swap the store for your DB. Pairs with the OTP/notification/email recipes. No key.
• SUBSCRIPTIONS / RECURRING BILLING (generate_subscriptions): v5.0 can add a real subscription-state backend (server/subscriptions/) — a packaged domain vertical for SaaS and memberships. The real guarantees are a lifecycle STATE-MACHINE (active ↔ paused, → past_due → cancelled, reactivate) enforced on every status change (409 on invalid), and deterministic renewal-date math (renewalAt = start/renew + the plan's interval). Ships a dependency-free SubscriptionService (definePlan, subscribe, setStatus, renew, isDue, list) + an Express router — POST /plans, POST/GET /subscriptions(/:id), PATCH /subscriptions/:id/status, POST /subscriptions/:id/renew. Charging is your gateway's job — call renew() on a successful charge; use isDue() in a scheduled job (pairs with generate_jobs). In-memory by default; swap the store for your DB. No key.
• POLLS / SURVEYS (generate_polls): v5.0 can add a real poll/voting backend (server/polls/) — a packaged domain vertical for communities, events and product feedback. The real guarantee is VOTE INTEGRITY: each voter can vote at most once per poll (a repeat vote is rejected, or moved with allowChange), a closed poll accepts no more votes, and the tally is always exact. Ships a dependency-free PollService (createPoll, vote, closePoll, results, hasVoted) + an Express router — POST /polls, GET /polls/:id(/results), POST /polls/:id/vote (409 on a duplicate vote or closed poll), POST /polls/:id/close. Identify the voter by auth user id (or a device/session id for anonymous polls). In-memory by default; swap the store for your DB. No key.
• BLOG / CMS (generate_blog): v5.0 can add a real blog/CMS backend (server/blog/) — a packaged domain vertical for content sites, marketing pages, docs and any publish-workflow app. The real guarantees are a publish STATE-MACHINE (draft ↔ published ↔ archived, invalid jumps rejected → 409), UNIQUE-slug generation from the post title (de-duplicated: hello, hello-2, hello-3), and a public feed that returns PUBLISHED posts only (drafts/archived stay private). Ships a dependency-free BlogService (createPost, publish, unpublish, archive, getBySlug, listPublished, listAll) + an Express router — POST /posts, GET /posts (admin), GET /posts/published (public feed), GET /posts/slug/:slug (404 unless published), PATCH /posts/:id, PATCH /posts/:id/status. Editing a title never rewrites the slug so permalinks stay stable. In-memory by default; swap the store for your DB. No key.
• REVIEWS / RATINGS (generate_reviews): v5.0 can add a real reviews/ratings backend (server/reviews/) — a packaged domain vertical for marketplaces, ecommerce, app stores, courses and any product-feedback surface. The real guarantee is RATING INTEGRITY: a rating is an integer 1..5 (out-of-range rejected), each user may review a given item at most once (a repeat submission UPDATES the existing review instead of double-counting), and the aggregate (average + count + per-star distribution) is computed EXACTLY from the live reviews. Ships a dependency-free ReviewService (submit, getByUser, remove, listForItem, aggregate) + an Express router — POST /reviews (create-or-update, 400 on a bad rating), GET /items/:itemId/reviews, GET /items/:itemId/rating (the aggregate), GET /reviews/:id, DELETE /reviews/:id. Take the userId from the auth session in production, not the request body. In-memory by default; swap the store for your DB. No key.
• LOYALTY / POINTS WALLET (generate_loyalty): v5.0 can add a real loyalty/points-wallet backend (server/loyalty/) — a packaged domain vertical for retail, apps, memberships and any rewards programme. The real guarantee is LEDGER INTEGRITY: a member's point balance is ALWAYS exactly sum(earned, not expired) − sum(redeemed) and can never go negative (a redeem beyond the balance is rejected), and every change is an append-only ledger entry (earn/redeem/expire) for a full audit history. Optional per-earn point expiry is supported. Ships a dependency-free LoyaltyService (earn, redeem, balance, expireDue, history) + an Express router — POST /loyalty/earn, POST /loyalty/redeem (409 on insufficient balance), GET /loyalty/:member/balance, GET /loyalty/:member/history. Take the member from the auth session in production. In-memory by default; swap the store for your DB. No key.
• REFERRALS / INVITES (generate_referrals): v5.0 can add a real referral/invite backend (server/referrals/) — a packaged growth vertical for any app that wants viral invites. The real guarantee is ATTRIBUTION INTEGRITY: every user gets ONE stable unique referral code, a new user can be attributed to at most one referrer (self-referral, an unknown code, and double-attribution are rejected), and the referrer is credited EXACTLY ONCE when the referred user completes the qualifying event (a retried completion never double-credits). Ships a dependency-free ReferralService (codeFor, attribute, complete, statsFor, listFor) + an Express router — GET /referrals/:user/code, POST /referrals/attribute (409 on self/unknown/already-referred), POST /referrals/:referred/complete, GET /referrals/:referrer/stats. Pay rewards off the completed count. Take the user id from the auth session in production. In-memory by default; swap the store for your DB. No key.
• THREADED COMMENTS / DISCUSSION (generate_comments): v5.0 can add a real threaded-comments backend (server/comments/) — a packaged domain vertical for blogs, forums, docs, social feeds and any content that invites discussion. The real guarantee is THREAD INTEGRITY: a reply MUST reference an existing parent (orphan replies rejected), a reply inherits its parent's thread and gets depth = parent.depth + 1, and a SOFT-DELETE tombstones a comment that has replies ("[deleted]", children survive and stay nested) while a childless comment is hard-removed. Ships a dependency-free CommentService (post, edit, remove, tree, listThread, count) + an Express router — POST /comments (404 if the parent is missing), GET /threads/:threadId/comments (nested tree), GET /threads/:threadId/count, PATCH /comments/:id, DELETE /comments/:id. Identify the thread with whatever the discussion hangs off (a post id, an issue id). Pairs with the blog recipe. In-memory by default; swap the store for your DB. No key.
• DIRECT MESSAGING / CHAT (generate_messaging): v5.0 can add a real 1:1 messaging backend (server/messaging/) — a packaged domain vertical for social apps, marketplaces (buyer↔seller chat), support and any two-party conversation. The real guarantee is CONVERSATION INTEGRITY: a conversation is keyed by the canonical (sorted) participant pair, so (a,b) and (b,a) are the SAME conversation (never a duplicate), each participant's unread count is exact, and marking-read is MONOTONIC (the read cursor only moves forward — already-read messages never resurface). A self-conversation and an empty body are rejected. Ships a dependency-free MessagingService (send, history, unreadCount, markRead, inbox) + an Express router — POST /messages, GET /conversations/:me/:other/messages, POST /conversations/:me/:other/read, GET /inbox/:me. Take the sender from the auth session; emit a socket event from send() for real-time delivery. In-memory by default; swap the store for your DB. No key.
• MARKETPLACE LISTINGS (generate_listings): v5.0 can add a real marketplace-listings backend (server/listings/) — a packaged domain vertical for classifieds, peer-to-peer marketplaces, second-hand stores and any buyer↔seller app. The real guarantee is SALE INTEGRITY: a listing follows the lifecycle draft→active→sold/removed (invalid jumps rejected), it can be SOLD AT MOST ONCE (a purchase on a sold/draft/removed listing is rejected, and a seller cannot buy their own), and only ACTIVE listings are publicly searchable. A sold listing is immutable. Ships a dependency-free ListingService (create, publish, setStatus, buy, update, search, listBySeller, purchasesBy) + an Express router — POST /listings, GET /listings?q= + /listings/:id, PATCH /listings/:id/status (409 on invalid transition), POST /listings/:id/buy (409 on already-sold / unavailable / self-purchase). Distinct from inventory (which tracks stock quantity). Take seller/buyer from the auth session in production. In-memory by default; swap the store for your DB. No key.
• JOB BOARD / HIRING (generate_job_board): v5.0 can add a real job board / applicant-tracking backend (server/jobboard/) — a packaged domain vertical for career sites, hiring platforms and any recruiting flow. The real guarantee is APPLICATION INTEGRITY: a candidate can apply to a given job AT MOST ONCE (a duplicate is rejected), only OPEN jobs accept applications, and an application follows the hiring state-machine applied→screening→interview→offer→hired/rejected (invalid jumps rejected; hired/rejected terminal). Ships a dependency-free JobBoardService (postJob, listOpenJobs, apply, advance, applicationsForJob, applicationsByCandidate) + an Express router — POST /jobs, GET /jobs, PATCH /jobs/:id/status, POST /jobs/:id/apply (409 on closed/duplicate), GET /jobs/:id/applications, PATCH /applications/:id/status (409 on invalid transition). Distinct from the background job queue (generate_jobs). Take the candidate from the auth session in production. In-memory by default; swap the store for your DB. No key.
• WISHLIST / FAVORITES / LIKES (generate_wishlist): v5.0 can add a real favorites backend (server/favorites/) — a near-universal domain vertical (ecommerce wishlists, content bookmarks, social likes). The real guarantee is IDEMPOTENT MEMBERSHIP: a (user, item) favorite exists AT MOST ONCE — add is idempotent (favoriting twice is a no-op, not a double entry), remove is idempotent, toggle flips the state, and the per-item favorite COUNT is always exact. One service covers wishlists/likes/bookmarks via a collection namespace. Ships a dependency-free FavoritesService (add, remove, toggle, has, listByUser, countForItem, usersForItem) + an Express router — POST /favorites (201 new / 200 existing), POST /favorites/toggle, DELETE /favorites, GET /favorites/:user, GET /items/:item/favorites ({ count, favorited }). Take the user from the auth session in production. In-memory by default; swap the store for your DB. No key.
• ADDRESS BOOK / SHIPPING ADDRESSES (generate_addresses): v5.0 can add a real address-book backend (server/addresses/) — a universal domain vertical for ecommerce, delivery and billing. The real invariant is AT-MOST-ONE-DEFAULT: a user can save many addresses but at most one is the default — the first address added becomes the default automatically, setting a new default atomically unsets the previous one, and deleting the default promotes the most-recently-added remaining address (last delete leaves no default). Ships a dependency-free AddressBook (add, setDefault, getDefault, update, remove, list) + an Express router — POST /addresses, GET /addresses/:user (+ /default), POST /addresses/:id/default, PATCH /addresses/:id, DELETE /addresses/:id (returns the promoted newDefaultId). Pairs with the payment / listings / booking recipes. Take the user from the auth session in production. In-memory by default; swap the store for your DB. No key.
• COUPONS / DISCOUNT CODES (generate_coupons): v5.0 can add a real coupon backend (server/coupons/) — a packaged domain vertical for ecommerce, SaaS and any checkout. The real guarantee is REDEMPTION INTEGRITY: a code enforces an optional TOTAL-redemption cap AND an optional PER-USER limit (both counted exactly), rejects an expired/inactive code or an order below its minimum, and computes the discount correctly — percentage (capped at the order total) or fixed (never below zero). validate() checks without counting; redeem() records the redemption toward both caps. Ships a dependency-free CouponService (create, validate, redeem, stats) + an Express router — POST /coupons, POST /coupons/validate (422 with a reason if not usable), POST /coupons/redeem (422 on failure), GET /coupons/:code/stats. Amounts are in the smallest currency unit (paise/cents). Pairs with the payment / loyalty recipes. In-memory by default; swap the store for your DB. No key.
• KANBAN BOARD / TASK BOARD (generate_kanban): v5.0 can add a real kanban board backend (server/kanban/) — a packaged domain vertical for project management, issue tracking and any "columns of cards" UI. The real guarantee is BOARD INTEGRITY: a card lives in exactly one column with a stable contiguous position (0,1,2,…); adding and moving re-index the affected columns so positions never collide or gap; and an optional per-column WIP LIMIT rejects an add/move that would overflow the column (moveCard clamps the target position to the destination length). Ships a dependency-free KanbanService (addColumn, addCard, moveCard, updateCard, removeCard, board) + an Express router — POST /columns, GET /boards/:boardId, POST /columns/:columnId/cards (409 at WIP limit), PATCH /cards/:id/move (409 if destination full), PATCH/DELETE /cards/:id. Distinct from the support-ticket status machine (generate_support_tickets). In-memory by default; swap the store for your DB. No key.
• TIME TRACKING / TIMESHEETS (generate_timesheet): v5.0 can add a real time-tracking backend (server/timesheet/) — a packaged domain vertical for freelancing, agencies, attendance and any billable-hours app. The real guarantee is SESSION INTEGRITY: a user has AT MOST ONE open (running) entry — clocking in while already clocked in is rejected, clocking out with nothing running is rejected, and clocking out computes an exact duration (endedAt − startedAt, never negative). Totals sum the CLOSED entries (optionally per project). Ships a dependency-free Timesheet (clockIn, clockOut, openEntry, addManual, list, totalMs) + an Express router — POST /time/clock-in (409 if already running), POST /time/clock-out (409 if nothing running), GET /time/:user/open, POST /time/manual, GET /time/:user (?project=, returns entries + totalMs), DELETE /time/:id. Multiply totalMs by your rate for billing. Take the user from the auth session in production. In-memory by default; swap the store for your DB. No key.
• LEADERBOARD / RANKINGS (generate_leaderboard): v5.0 can add a real leaderboard backend (server/leaderboard/) — a packaged domain vertical for games, gamification, sales contests, quizzes and any ranked score. The real guarantee is RANK INTEGRITY: submit() keeps each player's BEST score (a lower resubmit never downgrades and never resets the tie-break time); ranking is score DESC with a deterministic tie-break (whoever reached the score earlier ranks higher), so top/rankOf/around are exact, 1-based and stable. Multiple boards are isolated by a board name. Ships a dependency-free LeaderboardService (submit, top, rankOf, entryOf, around, size, remove) + an Express router — POST /leaderboard/scores, GET /leaderboard (?n=&board=), GET /leaderboard/:player (?k=&board=, entry+rank+neighbours, 404 if not ranked), DELETE /leaderboard/:player. Pairs with the loyalty / gamification recipes. Take the player from the auth session in production. In-memory by default; swap the store for your DB. No key.
• LAUNCH WAITLIST (generate_waitlist): v5.0 can add a real waitlist backend (server/waitlist/) — a packaged domain vertical for product launches, beta access, drops and any "get in line" flow. The real guarantee is QUEUE INTEGRITY: join() dedups by email (case-insensitive) so a repeat join returns the SAME stable entry (never a duplicate); position() is a contiguous 1..n over the people still WAITING in join order; invite(n) moves the front n waiting entries (in order) to invited, after which the remaining queue re-numbers correctly. Ships a dependency-free Waitlist (join, get, position, invite, remove, list) + an Express router — POST /waitlist (idempotent join, returns position), GET /waitlist/:email, POST /waitlist/invite {n}, GET /waitlist (?status=), DELETE /waitlist/:email. Captures referredBy for referral-boosted launches (pairs with generate_referrals). Take the email from the signup form. In-memory by default; swap the store for your DB. No key.
• TAGS / TAXONOMY (generate_tags): v5.0 can add a real tagging backend (server/tags/) — a cross-cutting domain vertical used by blogs, ecommerce, CRMs, task boards and anything that labels content. The real guarantee is TAG INTEGRITY: tags are canonicalized (trimmed, lower-cased slug) so "React" and " react " are one tag; tag/untag are idempotent (a (tag, entity) attachment exists at most once); rename CASCADES to every attachment and MERGES into an existing tag if the target slug already exists; usage counts are exact. Ships a dependency-free TagService (tag, untag, tagsOf, entitiesWith, rename, all, count) + an Express router — POST /tags (201 new / 200 existing), DELETE /tags (?entity=&tag=), GET /tags (usage counts), GET /tags/:tag/entities, GET /entities/:entity/tags, POST /tags/rename ({from,to}, 404 on unknown tag). entity is any id you tag (post/product/contact). Pairs with the blog / listings / CRM recipes. In-memory by default; swap the store for your DB. No key.
• A/B TESTING / EXPERIMENTS (generate_experiments): v5.0 can add a real experiment-assignment backend (server/experiments/) — a packaged domain vertical for any product running A/B tests or staged rollouts. The real guarantee is DETERMINISTIC STICKY ASSIGNMENT: assign() is a PURE hash of (experiment salt + user) → a stable [0,1) bucket → the weighted variant, so the SAME user ALWAYS gets the SAME variant with no stored state; variant WEIGHTS are respected across the population; expose() logs each user once for exact counts(). An inactive/unknown experiment returns the first-declared variant (control) and never throws. Ships a dependency-free ExperimentService (define, assign, expose, counts, list; node:crypto only) + an Express router — POST /experiments, GET /experiments/:key/assign/:user, POST /experiments/:key/expose, GET /experiments/:key/counts, GET /experiments. Assignment is pure so client and server agree with no round-trip. Distinct from the feature-flags recipe (generate_feature_flags, a LaunchDarkly/Unleash provider). In-memory by default; swap the store for your DB. No key.
• URL SHORTENER (generate_short_links): v5.0 can add a real link-shortener backend (server/shortlinks/) — a packaged domain vertical for marketing links, sharing and QR targets. The real guarantee is LINK INTEGRITY: shorten() makes a UNIQUE code (auto-generated codes retry on the rare collision; a custom alias is rejected if taken or malformed; only http(s) URLs accepted); resolve() returns the target and increments an EXACT click count but returns null for an unknown/disabled/EXPIRED code (so the route 404s instead of redirecting); peek() previews without counting. Ships a dependency-free ShortLinkService (shorten, resolve, peek, setActive, remove, list; node:crypto only) + an Express router — POST /api/links (409 on a taken alias), GET /api/links/:code (stats, no click), PATCH/DELETE /api/links/:code, and the public GET /:code (302 redirect + click, 404 if not live). Mount at the ROOT so links look like https://yourdomain/:code. Pairs with the QR recipe (generate_qr). In-memory by default; swap the store for your DB. No key.
• FEEDBACK / FEATURE-REQUEST BOARD (generate_feedback): v5.0 can add a real product-feedback backend (server/feedback/) — a public roadmap (Canny/Featurebase style). The real guarantee is VOTE + STATUS INTEGRITY: a user can upvote a given post AT MOST ONCE (upvote/unvote are idempotent, so vote counts are always exact), and a post moves along the status lifecycle open→planned→in_progress→done/declined (allowed transitions only; done/declined reopen to open). The author's own vote is counted on submit. Ships a dependency-free FeedbackService (submit, upvote, unvote, hasVoted, setStatus, list) + an Express router — POST /feedback, GET /feedback (?status=, sorted by votes), GET /feedback/:id (?user= → votedByYou), POST/DELETE /feedback/:id/upvote, PATCH /feedback/:id/status (409 on invalid transition). Distinct from polls (fixed-option voting) and the kanban board (private task board). Take author/user from the auth session in production. In-memory by default; swap the store for your DB. No key.
• CONSENT LOG / GDPR PRIVACY (generate_consent): v5.0 can add a real consent-log backend (server/consent/) — a packaged domain vertical for cookie/marketing/terms consent, DPA compliance and audit. The real guarantee is an APPEND-ONLY event log: every grant/withdraw is recorded with its purpose, policy version and source, and nothing is ever mutated or deleted — hasConsent(user, purpose) is derived from the MOST-RECENT event (latest wins), so the current state is always provable and the full history is auditable. Ships a dependency-free ConsentService (record, hasConsent, stateOf, history, grantedUsers) + an Express router — POST /consent ({action: grant|withdraw, purpose, policyVersion?, source?}), GET /consent/:user (all purposes), GET /consent/:user/:purpose (current state), GET /consent/:user/history. Distinct from generate_audit (general tamper-evident log). In-memory by default; swap the store for your DB. No key.
• ACTIVITY FEED / TIMELINE (generate_activity_feed): v5.0 can add a real activity-feed backend (server/activity/) — a social feed, an activity stream, a per-project event log or a notification timeline. The real guarantee is STABLE CURSOR PAGINATION: every event gets a monotonic sequence id and the feed is paged newest-first by "id < cursor", so paging a live feed NEVER duplicates or skips an item even when new events are appended between page fetches (the classic offset-pagination bug this prevents). Ships a dependency-free ActivityFeedService (record, feed, actorFeed, markSeen, unseenCount) + an Express router — POST /api/activity ({actor, verb, object, meta?}), GET /api/activity (?cursor&limit → newest-first + nextCursor), GET /api/activity/actor/:actor, GET /api/activity/unseen (?viewer), POST /api/activity/seen ({viewer}). Distinct from generate_audit (tamper-evident log) and generate_notification_center. In-memory by default; swap the array for your DB (an auto-increment id column plays the sequence-id role). No key.
• SHOPPING CART (generate_cart): v5.0 can add a real per-user shopping-cart backend (server/cart/) — the foundational ecommerce primitive. The real guarantee is CART INTEGRITY: adding the same product MERGES quantities into one line (never a duplicate), setting a line to 0 (or removing it) drops it, quantities never go negative, and the cart total is ALWAYS the exact sum of unitPrice × qty in INTEGER minor units (paise/cents) so money never drifts. Ships a dependency-free CartService (add, setQty, remove, clear, view) + an Express router — GET /api/cart/:userId, POST /api/cart/:userId/items ({productId,name,unitPriceMinor,qty?}), PATCH /api/cart/:userId/items/:productId ({qty}, 0 removes), DELETE /api/cart/:userId/items/:productId, DELETE /api/cart/:userId (empty). Take userId from the auth session in production. Distinct from generate_inventory (stock), generate_orders (placed order) and generate_payment (charge). In-memory by default; swap the Maps for your DB. No key.
• EMOJI REACTIONS (generate_reactions): v5.0 can add a real emoji-reactions backend (server/reactions/) — react (👍 ❤️ 😂 …) to any post, comment, message or media. The real guarantee is REACTION INTEGRITY: a user's reaction to a given (target, emoji) is an idempotent TOGGLE (re-reacting with the same emoji removes it — never a double count), and a user holds AT MOST ONE emoji per target (a new emoji replaces the old), so per-emoji counts are always exact. Ships a dependency-free ReactionService (react, unreact, hasReacted, countFor, summary) + an Express router — POST /api/reactions/:targetId ({userId, emoji} → toggle, returns the summary), DELETE /api/reactions/:targetId ({userId}), GET /api/reactions/:targetId (?viewer= → {total, reactions:[{emoji,count,reactedByViewer}], viewerEmoji}). Emoji are validated against an allow-list. Distinct from generate_feedback (single-upvote board) and generate_polls (fixed-option voting). In-memory by default; swap the Map for your DB. No key.
• ORDERS / ECOMMERCE LIFECYCLE (generate_orders): v5.0 can add a real order-lifecycle backend (server/orders/) — checkout → fulfillment. The real guarantee is ORDER IMMUTABILITY + a status STATE-MACHINE: placing an order captures an IMMUTABLE SNAPSHOT of its line items and total (a later catalog price change can never alter a placed order; the total is the exact sum of frozen subtotals in integer minor units), and it moves placed → paid → shipped → delivered along allowed transitions only (illegal jump → 409), with cancel allowed until it ships. Ships a dependency-free OrderService (place, get, transition, cancel, listForUser) + an Express router — POST /api/orders ({userId, items:[{productId,name?,unitPriceMinor,qty}]}), GET /api/orders (?userId=), GET /api/orders/:id, PATCH /api/orders/:id/status ({status}, 409), POST /api/orders/:id/cancel (409 once shipped). Pairs with generate_cart (build the item list), generate_inventory (reserve stock) and generate_payment (charge the total). In-memory by default; swap the Map for your DB. No key.
• FAQ / KNOWLEDGE BASE (generate_faq): v5.0 can add a real FAQ / help-center backend (server/faq/) — for a product FAQ or knowledge base. The real guarantee is the PUBLISH GATE + HELPFULNESS: a DRAFT entry is never returned by the public list or search (only published entries are), entries are grouped by category and manually ordered, keyword search matches the question OR answer (published only, case-insensitive), and each entry keeps EXACT helpful / not-helpful vote counts. Ships a dependency-free FaqService (add, update, setPublished, vote, publicList, adminList, search) + an Express router — GET /api/faq (?category=, ?q=), GET /api/faq/admin (guard with auth), GET/PATCH/DELETE /api/faq/:id, POST /api/faq, PATCH /api/faq/:id/publish ({published}), POST /api/faq/:id/vote ({helpful}). Distinct from generate_support_tickets (per-user ticket state machine) and generate_blog (articles). In-memory by default; swap the Map for your DB. No key.
• QUIZ / ASSESSMENT (generate_quiz): v5.0 can add a real quiz / assessment backend (server/quizzes/) — for edtech, training or knowledge checks. The real guarantee is GRADING INTEGRITY: a submission is scored against the stored answer key into an EXACT score (points earned / total) plus per-question correctness, a configurable pass mark decides pass/fail, and the correct-answer key is NEVER exposed to the taker (the public view strips it; only server-side grading reads it). Each question is validated to have exactly one correct option. Ships a dependency-free QuizService (create, get, publicView, grade) + an Express router — POST /api/quizzes ({title, passMarkPercent?, questions:[{text, points?, options:[{text, correct}]}]} — guard with auth), GET /api/quizzes/:id (taker view without the key), POST /api/quizzes/:id/submit ({answers:{[questionId]:optionId}} → {scorePoints, totalPoints, percent, passed, perQuestion}). Distinct from generate_polls (opinion tally, no right answer) and generate_feedback. In-memory by default; swap the Map for your DB. No key.
• AVAILABILITY / OPENING HOURS (generate_availability): v5.0 can add a real opening-hours backend (server/availability/) — for a shop, clinic, restaurant or support desk ("are you open right now?"). The real guarantee is CORRECT OPEN/CLOSED RESOLUTION: weekly recurring windows per weekday (multiple a day), OVERNIGHT windows that cross midnight (close ≤ open runs into the next day), and date-specific EXCEPTIONS that override the weekly schedule for one date (closed, or special hours) — isOpenAt(date) resolves all of that exactly, and nextOpenFrom(date) finds the next opening. Ships a dependency-free AvailabilityService (setWeekly, setException, isOpenAt, nextOpenFrom, weeklySchedule) + an Express router — GET /api/availability, PUT /api/availability/weekly/:weekday ({windows:[{open,close}]}), PUT /api/availability/exceptions ({date, windows}), GET /api/availability/open (?at=ISO → {open, at, nextOpen}). Distinct from generate_booking (reserves discrete slots) and generate_scheduler (runs cron jobs). In-memory by default; swap the Maps for your DB. No key.
• ANNOUNCEMENTS / SITE BANNERS (generate_announcements): v5.0 can add a real site-announcement banner backend (server/announcements/) — for maintenance notices, promos and new-feature callouts. The real guarantee is SCHEDULED VISIBILITY + DISMISS-ONCE: a banner is only active inside its optional [startsAt, endsAt] window (and when published), and once a user dismisses a dismissible banner it NEVER shows for that user again — activeFor(user) returns exactly the banners a given user should see now. level is info|success|warning|critical. Ships a dependency-free AnnouncementService (create, update, dismiss, activeFor, list) + an Express router — GET /api/announcements/active (?user=), GET/POST /api/announcements, PATCH/DELETE /api/announcements/:id, POST /api/announcements/:id/dismiss ({user}). Distinct from generate_notification_center (per-user inbox) and generate_activity_feed (event timeline). In-memory by default; swap the Maps for your DB. No key.
• SAVED COLLECTIONS / BOARDS (generate_collections): v5.0 can add a real saved-collections backend (server/collections/) — Pinterest-style boards or "save to collection". The real guarantee is MEMBERSHIP INTEGRITY: an item can belong to MANY collections at once, saving the same item twice is idempotent (no duplicate, exact itemCount), removing an item from one collection never affects the others, and each list is duplicate-free (newest-saved first). Collection names are unique per owner. Ships a dependency-free CollectionService (create, rename, saveItem, removeItem, collectionsForItem, view, listForOwner) + an Express router — GET /api/collections (?owner=), POST /api/collections ({ownerId,name}, 409 on name clash), GET/PATCH/DELETE /api/collections/:id, POST /api/collections/:id/items ({itemId}), DELETE /api/collections/:id/items/:itemId. Distinct from generate_wishlist (single flat list per user) and generate_tags (labels on one entity). In-memory by default; swap the Maps for your DB. No key.
• CONTACT FORM (generate_contact_form): v5.0 can add a real "Contact us" / lead-capture backend (server/contact/) — the universal contact form every site needs. The real guarantee is VALIDATED CAPTURE + SPAM REJECTION: a submission requires a name, a valid email and a non-empty message (bad input rejected, never silently stored), a filled hidden HONEYPOT field marks the submission as spam and drops it (bots fill it; humans never see it), and every accepted message moves through a status lifecycle new → read → archived (or spam). Ships a dependency-free ContactService (submit, setStatus, list, unreadCount) + an Express router — public POST /api/contact ({name,email,message,subject?,honeypot?}), admin GET /api/contact (?status=), GET /api/contact/:id, PATCH /api/contact/:id/status ({status}, 409 on illegal move), DELETE /api/contact/:id. Pair with generate_email to notify staff on accepted submissions. Distinct from generate_newsletter (email-only capture) and generate_feedback (a public voting board). In-memory by default; swap the Map for your DB. No key.
• PAGE-VIEW COUNTER / SELF-HOSTED ANALYTICS (generate_pageviews): v5.0 can add a real self-hosted view/visit counter (server/pageviews/) — privacy-friendly, storing nothing with any third party. The real guarantee is UNIQUE-VISITOR DEDUP: every hit increments a page total, but a given visitor counts toward the page unique count only ONCE PER DAY — the visitor is a SALTED HASH of IP+User-Agent (the raw IP is never stored, non-reversible), so it is privacy-preserving. Plus a top-pages ranking. Ships a dependency-free PageViewService (record, stats, topPages, siteTotal) using node:crypto + an Express router — POST /api/views ({path}, visitor derived from request IP + User-Agent), GET /api/views/stats (?path=), GET /api/views/top (?limit=). Distinct from generate_analytics (sends events to a third party like PostHog/Mixpanel) — this keeps all counts on your own server. In-memory by default; swap the Maps for your DB, set PAGEVIEW_SALT in production. No key.
• GIFT CARDS / STORE CREDIT (generate_gift_cards): v5.0 can add a real prepaid gift-card / store-credit backend (server/giftcards/) — for ecommerce. The real guarantee is BALANCE INTEGRITY: a card is issued with a monetary balance in INTEGER minor units (paise/cents), redeeming DEBITS the balance atomically and can NEVER overdraw (a redemption for more than the remaining balance is rejected; a partial redemption leaves the EXACT remainder; sum(redemptions)+balance === original always). Codes are unique (node:crypto); a card can be deactivated; an expired card cannot be redeemed. Ships a dependency-free GiftCardService (issue, get, balance, redeem, setActive, list) + an Express router — POST /api/gift-cards ({amountMinor,currency?,expiresAt?}, admin), GET /api/gift-cards/:code (balance), POST /api/gift-cards/:code/redeem ({amountMinor,note?}, 409 on insufficient/not-redeemable), PATCH /api/gift-cards/:code ({active}). Distinct from generate_coupons (a discount, not a stored balance) and generate_loyalty (earned points); pairs with generate_orders/generate_payment. In-memory by default; swap the Map for your DB. No key.
• TEAMS / WORKSPACES (generate_teams): v5.0 can add a real teams / workspaces (multi-tenant membership) backend (server/teams/) — for any B2B SaaS. The real guarantee is MEMBERSHIP INTEGRITY: a user can be a member of MANY workspaces with a per-workspace role (owner|admin|member), a workspace ALWAYS keeps at least one owner (removing or demoting the last owner is rejected), and invites are SINGLE-USE (accepting a token twice fails). Ships a dependency-free TeamService (createWorkspace, invite, acceptInvite, setRole, removeMember, workspacesForUser, roleOf) using node:crypto + an Express router — POST /api/workspaces ({ownerId,name}), GET /api/workspaces (?user=), GET /api/workspaces/:id/members, POST /api/workspaces/:id/invites ({email,role?}), POST /api/workspaces/invites/accept ({token,userId}), PATCH/DELETE /api/workspaces/:id/members/:userId. Distinct from generate_rbac/generate_abac (a permission MODEL, not tenancy/membership) — pair them to check what a role may DO. In-memory by default; swap the Maps for your DB. No key.
• STATUS PAGE / INCIDENTS (generate_status_page): v5.0 can add a real public status / incident page (server/status/) — like status.example.com. The real guarantee is DERIVED OVERALL STATUS + an APPEND-ONLY INCIDENT TIMELINE: each service component has a health status (operational|degraded|partial_outage|major_outage) and the overall system status is DERIVED as the WORST component status; an incident carries an append-only timeline of updates (investigating→identified→monitoring→resolved) — resolving stamps resolvedAt and a resolved incident can no longer be updated. Ships a dependency-free StatusPageService (addComponent, setComponentStatus, overallStatus, openIncident, addUpdate, snapshot, incidentHistory) + an Express router — GET /api/status ({overall, components, activeIncidents}), GET /api/status/incidents, POST /api/status/components, PATCH /api/status/components/:id ({status}), POST /api/status/incidents ({title,message,componentIds?}), POST /api/status/incidents/:id/updates ({status,message}, 409 if resolved). Distinct from generate_announcements (dismissible banners) and generate_support_tickets (a private ticket queue). In-memory by default; swap the Maps for your DB. No key.
• SURVEYS / QUESTIONNAIRES (generate_survey): v5.0 can add a real multi-question survey backend (server/surveys/) — for user research, NPS and feedback drives. The real guarantee is SCHEMA-VALIDATED RESPONSES + EXACT AGGREGATION: a survey has typed questions (single_choice|multi_choice|rating|text), a submitted response is validated against that schema (required questions answered, choice answers reference real options, rating 1..5) so an invalid response is REJECTED — never stored, and aggregate() tallies each question EXACTLY (option counts, rating average, text answers). Ships a dependency-free SurveyService (create, get, submit, responseCount, aggregate) + an Express router — POST /api/surveys ({title, questions:[{type,prompt,required?,options?}]}), GET /api/surveys/:id (render), POST /api/surveys/:id/responses ({answers}, 400 on schema violation), GET /api/surveys/:id/results (aggregate). Distinct from generate_polls (a single fixed-option question) and generate_quiz (graded right/wrong answers). In-memory by default; swap the Maps for your DB. No key.
• SUPPORT TICKETS / HELPDESK (generate_support_tickets): v5.0 can add a real support-ticket backend (server/tickets/) — a packaged domain vertical for any SaaS/service business. The real guarantee is a status STATE-MACHINE: a ticket moves open → in_progress → resolved → closed along allowed transitions only (a closed ticket can only be reopened), and an invalid jump is rejected (409). Ships a dependency-free TicketService (create / transition / assign / comment / list) + an Express router — POST /tickets, GET /tickets(/:id), PATCH /tickets/:id/status, PATCH /tickets/:id/assign, POST /tickets/:id/comments. In-memory by default; swap the store for your DB (same contracts). Pairs with the auth/notification/audit recipes. No key.
• CSRF PROTECTION (generate_csrf): v5.0 can add real CSRF protection (server/lib/csrf.ts) — dependency-free (node:crypto) issueCsrfToken(res) + a csrfProtection Express middleware using the double-submit-cookie pattern. Use it when the app authenticates with a COOKIE session: it guards state-changing routes (POST/PUT/PATCH/DELETE) by requiring the "x-csrf-token" header to match the csrf_token cookie (constant-time compare) — a cross-origin attacker cannot read the cookie so cannot forge the header → 403. Safe methods (GET/HEAD/OPTIONS) pass through; combine with SameSite cookies. Not needed for pure Bearer/JWT-header APIs. No keys.
• SAFE CORS (cross-origin config): v5.0 can add a correct CORS setup (server/lib/cors.ts) so your frontend can call your backend from another origin — a dependency-free middleware that allows credentialed requests ONLY from an allowlist (ALLOWED_ORIGINS in .env) and echoes back the exact matching origin, never a wildcard "*" (which would be unsafe with credentials). It handles the OPTIONS preflight and fixes the common "blocked by CORS policy" error. You set ALLOWED_ORIGINS in .env; NavBharatAI never stores it.
• FILE UPLOADS WITH ZERO SETUP (generate_storage, provider "supabase"): ask for photo/file/document uploads and v5.0 wires REAL uploads with NOTHING for you to configure — no keys, no bucket to create, no dashboard to visit. The storage bucket and its security rules are created inside YOUR OWN database project (the same one the one-click database uses, on your own account), and the app gets an uploadFile() helper it can call. Each signed-in user's files live in their own folder, so one user can never overwrite or delete another's file, and a file bigger than the limit (10 MB by default) is refused with a clear message. Public buckets give a plain shareable URL; private ones give a signed link that expires after an hour. If you already have your own storage instead, the same tool still supports "s3" (AWS S3 / Cloudflare R2 / MinIO) and "cloudinary" with your own keys pasted into .env. HONEST LIMIT: the zero-setup option needs a NavBharatAI-provisioned database on your account — the bucket is created when that database is set up, and the files count against your own storage quota.
• URL SLUGS (generate_slug): v5.0 can add a real URL slug generator (server/lib/slug.ts) — a dependency-free slugify(title) that turns any title into a clean, URL-safe slug (blog posts, product pages, docs, profiles), plus uniqueSlug(title, existing) for collision-safe slugs. Unicode-aware: Hindi/Indic titles (e.g. "नमस्ते दुनिया" → "नमस्ते-दुनिया") produce a real slug instead of an empty string (combining matras are preserved), and Latin accents are folded (café → cafe). No keys.
• GRAPHQL API (generate_graphql): v5.0 can add a real runnable GraphQL API (server/graphql/schema.ts + yoga.ts, graphql + graphql-yoga) — a schema-first setup with a WORKING example (a Query health/items/item, a typed Item, and an addItem Mutation with input validation) and a one-line-mountable yoga handler (Express: app.use(yoga.graphqlEndpoint, yoga); or plain Node createServer(yoga)). GraphiQL explorer is on in dev; a thrown resolver error surfaces as a proper GraphQL errors[] entry. Use when the user wants a GraphQL (not REST) backend — extend the SDL + resolvers and swap the demo store for your DB. No keys.
• REQUEST VALIDATION (zod): v5.0 can add real input validation (server/lib/validate.ts) — a validateBody() helper + an Express validate(schema) middleware that reject a malformed request body with a clear 400 listing exactly which fields are wrong, BEFORE your handler runs, so bad input never crashes a route or reaches your database. Built on zod (type-safe schemas). Guard any route that accepts a body — signup, forms, APIs.
• GLOBAL STATE (generate_state): v5.0 can add real global state management to the frontend (src/store/, zustand) — a typed cross-component store + selector hooks (useItems/useItemsActions) so shared app state (cart, session, a live list) is not prop-drilled or improvised. Ships a working example with an OPTIMISTIC async action that applies instantly, confirms with the server, and ROLLS BACK on failure. Use when the app needs shared state across components. (For a LOCAL optimistic list inside one component, use generate_ui_states' useOptimisticList.) Adds the zustand dependency, no keys.
• SETTINGS PAGE (generate_settings): v5.0 can add a real settings scaffold to the frontend (src/settings/, dependency-free React) — a SettingsProvider that persists preferences to localStorage AND applies the theme to <html data-theme> (so dark mode actually works, target :root[data-theme='dark'] in CSS), a useSettings hook, and a SettingsPage with grouped sections + working controls (theme select, compact-mode + email-notification toggles, reset). Wrap the app in <SettingsProvider>, render <SettingsPage/> on /settings, read a pref anywhere via useSettings(). No keys.
• DEPLOY CONFIG — Railway/Render/Fly/AWS/Azure (generate_deploy_config): v5.0 can add the platform config for a git-push / container PaaS — render.yaml (Render Blueprint), railway.json (Nixpacks + health check + restart policy), fly.toml (http_service + health check), apprunner.yaml (AWS App Runner source deploy), or azure.yaml (Azure Developer CLI "azd up" → Azure Container Apps). Each references /health + PORT. HONEST: it generates the config; the user deploys from their OWN Railway/Render/Fly/AWS/Azure account (BYO), it does not auto-deploy. One-click deploy already exists for Firebase/Vercel/Netlify/Cloudflare; multi-service AWS/Azure IaC → generate_iac. Pairs with generate_deploy_artifacts (Dockerfile). No keys.
• INTEGRATION TESTS (generate_integration_tests): v5.0 can add a REAL integration-test suite for a REST resource (tests/, supertest + express) — a full create → read → update → delete → 404 lifecycle test with real assertions on real response bodies, NOT the TODO skeletons generate_tests emits. It ships a working in-memory reference app the suite runs against, so the tests are GREEN out of the box; swap the app import to test your own Express backend. Supports string/number/boolean fields (the first is validated on create → 400). Use to verify a CRUD API end-to-end. Dev deps only (supertest + express), no API key.
• NOTIFICATION CENTER (generate_notification_center): v5.0 can add a real IN-APP notification center to the frontend (src/notifications/, dependency-free React) — a NotificationsProvider (add / mark-read / mark-all-read / unread count, persisted to localStorage so it survives a reload) + a useNotifications hook + a NotificationBell component (unread badge + accessible dropdown + honest empty state). Wrap the app in <NotificationsProvider>, drop <NotificationBell/> in the header, and call add({ title, body }) anywhere. This is the IN-APP bell/center; for OUTBOUND email/SMS/push use generate_notify. No keys.
• HTML SANITIZATION / XSS (generate_sanitize_html): v5.0 can add real HTML sanitization (server/lib/sanitize.ts) — sanitizeHtml(dirty) keeps a safe formatting subset (headings, lists, bold/italic, links forced to safe protocols + rel="noopener") and strips <script>, event handlers, javascript: URLs and <iframe>; sanitizeToText(dirty) strips all markup to plain text. Run it on any user-supplied HTML before storing or rendering it (comments, rich-text posts, bios, ticket bodies) to close the stored-XSS hole — a proper allowlist (built on sanitize-html), not a bypassable regex. No keys.
• MARKDOWN → SAFE HTML (generate_markdown): v5.0 can add real Markdown rendering (server/lib/markdown.ts, marked + sanitize-html) — renderMarkdown(md) renders Markdown AND sanitizes the output in ONE call, so untrusted Markdown (a comment, a wiki edit) can never inject <script> or an onerror handler — safe by construction, no separate sanitize step to forget. Keeps a rich subset (headings, lists, tables, code blocks, images, links forced to safe protocols + rel="noopener"). Use for blogs, docs, comments, product descriptions. No keys.
• STRUCTURED LOGGING (pino): v5.0 can add real structured logging (server/lib/logger.ts) — a JSON logger + a requestLogger middleware that logs method/url/status/duration for every request (never headers or body, so secrets never leak), replacing console.log with searchable, level-filtered, shippable logs for real production observability. Set LOG_LEVEL in .env to tune verbosity.
• CORRELATION IDS / REQUEST ID (generate_request_id): v5.0 can add a real request-id middleware (server/lib/requestId.ts) — dependency-free (node:crypto), it reuses a SAFE inbound X-Request-Id (from a trusted proxy/gateway) or mints a UUID, attaches it to req.id, and echoes it on the response header, so every log line and downstream call for one request shares one id and can be traced end to end. An unsafe/oversized header value is ignored; set trustInbound:false to always mint a fresh id. Mount it first — pairs with the logging and tracing recipes. No dependency, no key.
• FILE-UPLOAD VALIDATION (generate_file_upload): v5.0 can add real upload validation (server/lib/upload.ts) — a dependency-free validateUpload(buffer, { allowed, maxBytes }) + detectFileType(buffer) that identify the TRUE file type from its MAGIC BYTES (PNG/JPEG/GIF/WebP/PDF/MP4/ZIP), NOT the forgeable client filename/extension/Content-Type, so a renamed .php or a script can't slip through as an image. Enforces a type allowlist + size cap and returns an honest {ok, type, error}. Run it before saving any upload (avatars, product photos, documents); pair with the image recipe to resize after validating. No keys.
• GRACEFUL SHUTDOWN (zero-downtime restarts): v5.0 can add real graceful shutdown (server/lib/shutdown.ts) — installGracefulShutdown(server) traps the SIGTERM every deploy/restart sends, stops accepting new connections, lets in-flight requests finish, runs optional cleanup (close the DB pool), then exits with a hard timeout so a stuck connection can't hang the deploy. Prevents dropped requests and cut database connections on every restart. Dependency-free; SHUTDOWN_TIMEOUT_MS tunes the timeout.
• MAINTENANCE MODE (generate_maintenance): v5.0 can add a real maintenance-mode switch (server/lib/maintenance.ts) — a dependency-free Express middleware that, when on, returns a proper 503 + Retry-After to every request EXCEPT health checks (/health,/healthz,/readyz, so the orchestrator doesn't kill the instance), with an optional operator bypass header+token (verify the fix before reopening) and a runtime setMaintenance(true/false) toggle seeded from the MAINTENANCE_MODE env. Mount it first, use it to take the app down cleanly for a deploy or DB migration. HONEST: the flag is per-instance — for a multi-instance deploy, back it with a shared source via isEnabled(). No dependency, no key.
• SECURITY HEADERS (browser hardening): v5.0 can add real security headers (server/lib/securityHeaders.ts) — a dependency-free middleware setting the safe hardening headers (X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy, HSTS, Permissions-Policy) that defend against clickjacking, MIME-sniffing and referrer leakage without breaking a normal app. A Content-Security-Policy is included as a commented, opt-in block (a wrong CSP breaks your app, so tune it to what you load before enabling).
• SEO ESSENTIALS (generate_seo): v5.0 can add real SEO (server/lib/seo.ts) — dependency-free buildMetaTags({ title, description, url, image }) → <head> title + description + canonical + OpenGraph + Twitter-card tags (so a shared link shows a proper preview on WhatsApp/LinkedIn/Twitter), buildSitemap(entries) → a valid /sitemap.xml, and buildRobotsTxt({ sitemapUrl, disallow }) → /robots.txt. Every value is escaped, so a title with <, > or & never breaks the tag or the XML. Use on any public site for discoverability. No keys.
• WEBHOOK VERIFICATION (generate_webhook): v5.0 can add real incoming-webhook signature verification (server/lib/webhook.ts) — a dependency-free verifyWebhookSignature(rawBody, header, secret) that HMAC-SHA256s the RAW request body and compares in CONSTANT TIME (crypto.timingSafeEqual), tolerating the "sha256=<hex>" header form — so a forged "payment succeeded" callback is rejected. Essential for payment webhooks (Cashfree/Razorpay/Stripe) and GitHub/Shopify/WhatsApp callbacks; call it on every webhook route before trusting the payload. You set the provider secret in .env; no dependency (node:crypto).
• OUTGOING WEBHOOK SENDER (generate_webhook_sender): v5.0 can add a real signed webhook sender (server/lib/webhookSender.ts) — a dependency-free sendWebhook(url, payload, secret, { event }) for when YOUR app lets customers subscribe to events. It HMAC-SHA256 signs the JSON body as "X-Webhook-Signature: sha256=<hex>" (the exact format the incoming-webhook recipe verifies, so subscribers can confirm it is really you), enforces a timeout so a slow subscriber cannot hang your server, and returns { ok, status } without throwing (retry on !ok). The send/verify pair to generate_webhook. No keys.
• LIVE WEB BROWSING (v5.0 can open real websites): NavBharatAI Pro v5.0 runs a REAL Chrome browser inside its cloud sandbox, so it can actually VISIT a real website and look at it — not describe it from memory. Say "look at <website>", "make it like <site>", or "what does this page do? <url>" and v5.0 navigates there, takes a screenshot, and answers from what it genuinely sees; it can also click, scroll and type on the real page to see more, and it tells you honestly if a page fails to load instead of inventing its contents. It copies IDEAS and LAYOUT only — never a site's text, images or logos. Internal/private network addresses are refused for safety; only real public websites open. HONEST LIMIT: this needs the real cloud sandbox, so it works during a v5.0 session, and it is a look-and-learn tool — it does not log into sites for you.
• MAKE AN ANDROID APP (.apk / .aab) — the FIRST answer to any "how do I get my app on a phone / make an APK / put it on the Play Store" question, in ANY language: use NavBharatAI's OWN built-in APK Builder (Other AI → AI Tools → APK Builder, or the shortcut More → Download APK). NavBharatAI builds the real, installable, SIGNED app FOR you — you do NOT need Android Studio, a computer, developer tools, the Capacitor CLI, or to set up GitHub Actions yourself. Tap "Get my app ready to build" then "Build my APK now" and the finished .apk downloads right there (the Play .aab needs your own signing key, added once). Never send the user to external tools or a manual GitHub/Android-SDK setup — the APK Builder is the whole route. (ADVANCED, secondary: v5.0 can also emit a raw capacitor.config.ts + MOBILE_EXPORT.md wrapper for a developer who wants to run the native toolchain themselves — but that is NOT the route to offer a normal user; the APK Builder is.)
• STORE-READY BUILD KIT (real signed .aab + .ipa → TestFlight, no Mac needed): NavBharatAI builds the genuine signed binaries FOR you — you start it from the built-in APK Builder (Other AI → AI Tools → APK Builder / More → Download APK), not by setting anything up yourself. Under the hood it creates and runs a complete GitHub Actions pipeline in your own repository automatically, so GitHub's real Linux and macOS runners do the compiling and signing — but that is the mechanism, NOT a route you offer the user to set up by hand. You get .github/workflows/android-aab.yml (signed .aab for Play Store, versionCode auto-stamped so Play never rejects a re-used version), .github/workflows/ios-ipa.yml + fastlane/Fastfile (signed .ipa uploaded straight to TestFlight, build number auto-stamped, export compliance pre-answered, and the upload WAITS for Apple's processing so a green run truly means it landed in TestFlight), and SHIPPING.md listing every secret you must set and exactly where to get it. The Android build produces BOTH a .aab (the only format Google Play accepts) AND a .apk (which Play does NOT accept, but which you can install straight onto a phone to try your app immediately) — and you can download either one directly inside NavBharatAI once the build turns green, without hunting through GitHub. Find it in Other AI → AI Tools → APK Builder: fill the App Information at the top, then tap "Get my app ready to build" and "Build my APK now" (or "Build the Play Store bundle") — this pipeline is created into your repository and started for you automatically, no manual setup.
• POINT-AND-CHANGE ("remove that green dot", "make the logo smaller"): for anything you can SEE, just describe it — the colour, shape, text or where it sits — and v5.0 asks the RUNNING app itself which element that is, then edits exactly that. It reads the live page (real colours, sizes, positions, and each element's own source location) instead of guessing at code, so a small visual change is quick and lands on the right element. AND IF THE THING ISN'T THERE, v5.0 SAYS SO instead of changing something else: it will tell you what it looked for and what the page actually has (e.g. "there is no green dot here — the only green on this page is the Submit button"), and ask what you meant. It will also tell you when a detail lives inside an image/logo file rather than in the code, so you know why it can't be edited as text.

• HOW TO PUBLISH ON THE PLAY STORE / APP STORE (step-by-step, written for non-technical users): NavBharatAI includes a complete plain-language walkthrough for both stores — ask "how do I publish my app to the Play Store / App Store?" and walk through it step by step. It states the real costs up front (Google Play: about $25 / ₹2,000 ONCE, no yearly fee. Apple: about $99 / ₹8,000 EVERY year, and the app is removed from the App Store if you stop paying), the realistic time each step takes, and for every step what to click, what to type, and what you should see afterwards so you can check it worked. Play Store steps: developer account → create your signing key → add it to GitHub as a secret → let NavBharatAI\'s built-in APK Builder do the build for you (you never set up GitHub Actions or Android Studio yourself) → download the .aab/.apk → create the app + store listing (screenshots, icon, descriptions) → content rating + Data Safety + privacy policy → upload the .aab and submit (Google's review usually takes 1–7 days). App Store steps: Apple Developer account → create the app entry in App Store Connect → create an App Store Connect API key with the Admin role → add the secrets to GitHub → build and upload to TestFlight → install via TestFlight on an iPhone to test → fill the App Store page (screenshots for 6.7" and 6.1") → submit for review (1–3 days; an Apple rejection is normal, they tell you the exact guideline to fix). YOU DO NOT NEED A MAC OR AN iPHONE TO BUILD the iOS app — the build runs on a real Apple computer inside GitHub. What only the user can do (and why): paying for the store accounts, holding the signing key/Apple credentials (those are their identity), uploading to Play Console, and submitting for review. HONEST LIMIT (why it works this way): no browser or server can compile or sign a mobile app, and an iOS build legally requires macOS — so the binary is built on GitHub with YOUR signing keystore (Android) and YOUR Apple Developer account + App Store Connect API key (iOS). Those secrets are your identity and only you can set them; uploading the finished .aab to Play Console and submitting for store review also stay with you. Everything that can be automated, is.
• DESKTOP APP EXPORT (Windows .exe / macOS .dmg / Linux .AppImage via Electron): v5.0 can turn your generated web app into a desktop app — it emits electron/main.cjs + electron-builder.yml + a DESKTOP_EXPORT.md runbook and lists the Electron devDependencies/scripts + the package.json "main" entry to set. HONEST LIMIT: it generates the wrapper config, not the final signed installer — electron-builder must run on the matching OS (Windows for .exe, macOS for a signed .dmg); the runbook gives the steps (and the required relative-base-path fix so assets load under file://). Ask for a "desktop / .exe / installable version" of your app to use it.
• BROWSER EXTENSION EXPORT (Chrome / Edge / Firefox, Manifest V3): v5.0 can turn your generated web app into a browser extension — it emits a manifest.json (Manifest V3) that serves your built app as the extension popup + an EXTENSION_EXPORT.md runbook (build → load unpacked → package). HONEST LIMIT: it generates the manifest + instructions, not a published extension — publishing needs a Chrome Web Store / Firefox AMO developer account + review; the runbook gives the steps (and the relative-base-path fix so the popup isn't blank). Ask for a "browser / Chrome extension version" of your app to use it.
• DATABASE TYPES (schema → TypeScript): v5.0 can generate TypeScript interface types from your database schema (Prisma models / SQL CREATE TABLE) and write them to src/types/db.ts, so your frontend and backend share ONE typed shape of the database instead of hand-written types that drift out of sync. Prisma enums become string-union types. Ask to "generate types from my schema" after defining or changing it.
• SCHEMA GRAPH / BLAST RADIUS: v5.0 can show your database schema's relationship graph (Prisma models / SQL tables and how they reference each other) and the change-propagation blast radius — ask "what depends on the User model?" and it lists every model/table that references it, so you (and the AI) review those before renaming, dropping, or changing a key, instead of silently breaking dependents. Works for both Prisma schema and SQL migrations.
• INFRA OPTIMIZER (Docker / Kubernetes / Terraform): v5.0 can scan your infrastructure files for real security + reliability anti-patterns — a base image on :latest, a container running as root, a secret baked into an image layer, a K8s pod with no resource limits or running privileged, a public (allUsers) Cloud Run binding, an unpinned Terraform provider — and reports each with a concrete fix. Ask to "harden/optimize my Docker / Kubernetes / Terraform" or it can run before deploy.
• CI WORKFLOW REPAIR (GitHub Actions · GitLab CI · Jenkins): v5.0 can detect and fix a broken CI pipeline (.github/workflows/*.yml, .gitlab-ci.yml, or Jenkinsfile) that would FAIL when it runs — an "npm ci" step with no committed lockfile (auto-fixed to "npm install"), a setup-node cache keyed to the wrong package manager (repointed to the one your project actually uses), or an "npm run <script>" step for a script your package.json doesn't define (flagged for a manual fix). It only touches workflows that are actually broken. This also surfaces automatically in the build readiness check, so a broken CI file is caught before you push.
• AUTO-CONTINUE on time limit: if a big build hits the wall-clock limit and pauses, v5.0 now resumes itself automatically (up to twice) and finishes — you no longer have to type "continue" each time. If it still needs more after that, it asks you to type "continue" once.
• BREAKPOINTS / DEBUGGER (P-DEV.3 — Code Studio): in Code Studio, click a line's left gutter to set a red breakpoint (toggle off by clicking again); they are saved across refreshes. The Debug panel lists every breakpoint (file:line) — click one to jump straight to it, or remove it. Note: live pause / call stack / variable inspection are honestly marked "coming soon" (they need the cloud sandbox debugger); the run controls are shown disabled, never faked. For runtime error help today, use the AI Debugger.
• FLAKY TEST DETECTION (P-TQA.8 — Test panel): the Test panel now remembers each test's recent pass/fail history (across runs) and shows a "🟡 flaky" badge next to any test that both passes AND fails over its last several runs (≥5 runs, >20% failures, not always-failing) — so an unreliable test is visible instead of looking stable. History is saved in your browser.
• FORGOT PASSWORD / ACCOUNT RECOVERY (P-UX.8): on the sign-in screen, enter your email and tap "Forgot password?" to get a Firebase password-reset link by email — so a locked-out user can get back in. (For your security the message is the same whether or not an account exists.)
• BUILD FEEDBACK / CSAT (P-UX.6): after a successful v5.0 build, a "Was this build helpful?" 👍/👎 prompt appears under the result — one tap records your feedback (once per build).
• GOVERNANCE & decision-audit (Layer 58): before the build agent runs a shell command, the command is risk-classified; irreversible or dangerous operations (recursive deletes of root/home, remote-code-execution pipes like "curl … | sh", secret exfiltration, force-push, sudo, disk writes) are flagged with an honest warning in the result and recorded to a per-project decision-audit trail — an accountable record of every risky action taken (hard blocking stays with the human-approval gate).
• LIVE "AI Team" tracker — watch each real agent's current action as it builds (not a fake animation).
• MERGED SURFACES from one live stream: file explorer, Code Studio diffs (red/green), terminal, git/history checkpoints, todos and plan — all in sync, zero drift.
• HYBRID sandbox: a fast E2B cloud sandbox initialised as a real Git repo you own.
• ITERATIVE sessions: each message continues the SAME project (same sandbox, files and memory), so you can refine step by step ("add a login page" after "build a todo app"). Use the "New" button to start a fresh project.
• SURGICAL EDITING: when you ask v5.0 to CHANGE an existing app — "fix the navbar", "update the button colour", "refactor the auth", "remove the sidebar" — it detects this is an EDIT (not a new build), loads the current file tree, reads the affected files first, and makes MINIMUM targeted patches (edit_file old→new) instead of rebuilding everything from scratch. Your existing files and working code are never wiped to start over; a one-line fix touches one place. New files are still created when a change genuinely needs them.
• POLYGLOT BACKENDS (AB-1 — Fullstack sandbox): beyond JavaScript/TypeScript and Python, v5.0 can now build and RUN real Java (Spring Boot, JDK 17 + Maven) and Go (1.23) backends. Ask for a "Spring Boot REST API" or a "Go web service" and v5.0 scaffolds a real, runnable app (a live web server bound to 0.0.0.0:$PORT so the preview works) and routes that build onto a dedicated fullstack cloud sandbox that has the JDK, Maven, Go, MongoDB and Redis pre-installed — so a Java/Go backend actually compiles and starts, not just gets written. JS/Python/frontend builds are unchanged (they keep using the fast default sandbox).
• BUILDS IN YOUR LANGUAGE (Layer 73 — Universal Language): write your request in any language — all 22 Indian languages (Hindi, Tamil, Bengali, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Urdu and more) or major world languages — and the app's user-facing text (labels, buttons, headings, placeholders, messages) is generated in THAT language, while the code stays in English. Apni bhasha mein likho, app usi bhasha mein banega. THE PROGRESS MESSAGES TOO: when you write your request in HINDI (Devanagari), the build's own status lines — "database तैयार किया जा रहा है", "छूटे हुए import जोड़े गए" — are shown in Hindi as well, not just the AI's replies. Write in English (including romanised Hinglish like "mujhe app banao") and those lines stay in English, matching how the AI itself replies. Other Indian scripts still get the AI in their own language while the platform's own status lines remain in English for now — an honest limit, not a bug.
• SMART COST ROUTING: plain conversation (a greeting, thanks, "who are you", small-talk) is answered by a fast, economical model and only REAL build/engineering requests use the premium engine — the experience is unchanged, you just don't pay build-grade cost for a "hello".
• LIVE ACTIVITY indicator: while it works, a "working…" line under the latest reply shows the CURRENT action live (e.g. "✍️ writing src/App.tsx", "⌨️ running: npm install") with an elapsed timer, so you can see it is making progress, not frozen. Click it to EXPAND a step-by-step activity log — every file write, command, search, agent spawn and the preview publish, with timestamps and ✓/✗ — and click again to collapse. After the build finishes the same line stays as "Done · N steps" so you can expand and review exactly what happened. FILES ARRIVE ONE BY ONE, EACH WITH A SHORT NOTE saying what that file IS — "LoginForm.tsx · a part of a screen", "orders.ts · an API endpoint", "package.json · the app's package list" — so you can follow what is being built for you even if you do not read code. The engine still writes many files at once in the background (nothing is slowed down); only the DISPLAY is paced so each file is readable. The note is worked out from the file's own path, so it is instant and free — and when a path does not clearly say what it is, no note is shown rather than a guess. Tapping any file still opens its real code/diff exactly as before. LANGUAGE: these notes, and every other label and status line in NavBharatAI, are in English — that is the app speaking. Anything the AI itself writes to you (its replies, its explanations, Doctor AI, every Professional) comes back in YOUR language, whichever one you wrote in.
• WHAT I BUILT summary (Layer 27 — Product Understanding): after each successful build it shows a short, friendly recap in the chat — the detected stack/framework, how many files/components/routes were created, a few key components/routes, and how to run it (plus the Preview tab) — so you understand what was created at a glance.
• HISTORY: your v5.0 conversations are saved to NavBharatAI's main History (the sidebar "History" option, under All/Apps OR the "Pro" filter — v5.0 chats show under Pro now) when you are signed in, so you can return to them later; inside v5.0 the "History" tab also lists the project's git checkpoints — and these are now DURABLE: every checkpoint a build commits is saved, so the full timeline survives a page refresh, a recycled sandbox, and shows up the same across your devices (not just the current session). Click "Restore" next to a checkpoint to roll the project back to that point; if a checkpoint isn't active in the current session yet, v5.0 tells you honestly instead of pretending it restored.
• PREVIEW AN OLD VERSION BEFORE YOU RESTORE IT (History tab → "Preview" next to any checkpoint): opens THAT version of your app running in a new tab, while your current app stays exactly as it is — nothing is overwritten. This is the safe way to compare "is the older one actually better?" before deciding. Restore is still there for when you want to go back for real. Preview needs your build environment to be awake (send any message to wake it), and it costs you nothing extra — the old version runs inside the same environment your app is already using. If that old version can't start (usually because it needed different packages from your app today) or its history is no longer available, v5.0 says so plainly instead of opening a broken page — and either way your current files are never touched. Up to 2 versions can be open at once; opening a third closes the one you opened first.
• OPEN = NEW, RELOAD = CONTINUE: opening NavBharatAI Pro v5.0 from the menu/sidebar always starts a fresh NEW chat (a clean canvas), so you never land on an old project by accident. But if you simply RELOAD the browser (F5) while working in v5.0, you come right back to the SAME project with your messages, files and preview restored — reload continues, opening starts fresh. To reopen a specific past project, pick it from the Recent Chats list (below) or from History.
• RECENT CHATS in the ☰ menu (app-wide): the main 3-line ☰ menu now has a "Recent Chats" section listing your latest conversations (Free, Pro and Doctor), newest first, each with a coloured badge — tap any one to reopen it and continue where you left off, or tap "View all history →" for the full list. A v5.0 chat reopens inside Pro v5.0 with the same project/files/memory.
• SESSION HISTORY MENU (3-line ☰ in the v5.0 header): tap the menu icon at the top-left of the v5.0 header to open your SESSION HISTORY — every saved v5.0 build for your account, grouped by date (Today / Yesterday / Previous 7 days / Previous 30 days / Older), each one showing a real status dot (building / built / failed / stopped) — not just old chat text. Sessions whose app is PUBLISHED show a glowing green "Live" dot (verified against the deployment registry — the dot appears only when the app is really live at its URL, never for held or taken-down apps; a failed later build keeps its red "Failed" dot so problems stay visible). The session you currently have open is marked "Current session". Tap any session to reopen it and continue exactly where you left off (same project, files, plan and memory). Each session row has two actions: a 📌 PIN (pin an important build so it floats to the top under a "Pinned" section, above the date groups, no matter how old — tap again to unpin; pinning never changes the build's "time ago") and a ✕ DELETE (permanently remove it, confirmed first). A SEARCH box at the top of the list filters your sessions instantly by name as you type (client-side, no reload) — type part of an app's name to find it. The same menu has a "+ New chat" to start a fresh project. Because sessions are saved PER ACCOUNT (not per device), the list and the ability to continue the SAME project/memory work from ANY device you sign in on — open it on your phone, continue on your laptop. ("New" in the header still starts a fresh project too.)
• MOBILE FOOTER (phone/tablet): while NavBharatAI Pro v5.0 is open on a phone or tablet, the app's bottom bar shows v5.0's OWN six buttons — History (the session-history list as a bottom sheet), Pro Chat (back to the chat), Preview (the live preview), Files (the files v5.0 built — tap a file for Open in Code Studio / Copy file / Copy path / Delete, and Delete is REAL: the file is removed from the durable workspace too, it never comes back on reload), Code Studio (opens the code editor on the SAME files v5.0 just built — edit them by hand, then ask v5.0 to keep working; it is one shared file set, not a copy), and More (Framework picker, Diff, Terminal, Checkpoints, Report, GitHub, Deploy, Live site, New chat). REPORT lives in the More sheet (it used to also sit in the footer, which just duplicated it): tapping it sends THIS build's report to the NavBharatAI team, and the button then shows how many times you have already sent it — "Report (1)", "Report (2)" — with a line saying it is already sent, so nobody reports the same build twice by accident. The count is per build and survives a page reload. The v5.0 header on mobile is slim — just the title, framework icon, build stamp and the Stop/Resume button. On desktop everything stays in the header exactly as before. Also: once you open the Preview it now STAYS alive when you switch tabs or go back to chat — switching away no longer destroys the rendered preview.
• RESPONSIVE PREVIEW (device views): the Preview toolbar has four viewport buttons — Auto, Mobile, Tablet, Desktop — that work on BOTH previews (the In-browser build and the Live server). These are REAL, not labels: picking Mobile renders your app at a true phone width (390px) so its OWN responsive CSS / media-query breakpoints actually switch to the mobile layout; Tablet is 768px and Desktop is 1280px. Auto fills the panel (default). A device wider than the panel is scaled down to fit while still laying out at the true device width, so what you see is exactly how the app responds at that size — the fastest way to check your app looks right on phone, tablet and desktop without leaving the preview.
• INSTANT PROJECT CHECK (right after you import): the moment your project lands, NavBharatAI reads it and tells you what it found — for FREE, with no AI/build turn and nothing deducted from your balance. It reports only real, checkable things: imports that point at files which do not exist (these break the app), front-end files importing server-only code (these crash in the browser), screens/components that exist but nothing ever shows, circular imports, and files nothing uses. Each finding comes with real examples so you can verify it yourself. If your project is clean it simply says so — it never invents problems to look useful, and it never gives a "score" or a grade for anything it did not actually measure. Say "fix these" and the engine repairs the ones it genuinely can (it will NOT offer to delete unused files — that stays your decision).
• OPEN PROJECT FOLDER (no zipping at all — Chrome/Edge on a computer): tap 📎 Attach → "Open project folder" and pick the folder your app lives in. Nothing is zipped and nothing extra is uploaded: your browser reads the folder directly, keeps only the source code (plus small images/icons so the preview looks right), and sends just that. node_modules, .git, dist/build folders, videos and large files are skipped without even being opened — so a project of any size opens in seconds, and your .env and key files never leave your computer. This option only appears on browsers that support it (Chrome/Edge on desktop); on a phone or Firefox, use "Import project (.zip)" instead, which now does the same filtering inside your browser before uploading. Either way you are told exactly what came in and what did not.
• PREVIEW AUTO-FAILOVER (In-browser → Live server): the Preview tab opens on the In-browser view, which renders your files instantly with no server. That view has to fetch third-party packages over the internet, so it can occasionally fail (a blocked or slow network) even when your app is perfectly fine. If that happens and your app IS running on the Live server, the Preview now switches you to the Live server automatically and shows a short note explaining why — so a working app is never hidden behind an error screen. It switches at most once, and if YOU picked In-browser yourself it leaves your choice alone. You can always switch back with the In-browser / Live server buttons.
• TERMINAL after a restart: if the live sandbox went to sleep (server restart / idle), the Terminal tab tells you honestly that the workspace is dormant and your saved files are safe — send a message in v5.0 chat to bring the sandbox back online, then the terminal works again (it never fakes output or shows a dead-end).
• FILE UNDERSTANDING: attach any file with the paperclip button next to the message box — images, PDFs, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), ZIP archives, and any text/code file (you can also paste a screenshot). v5.0 reads it and can analyze it or build from it. Documents are read for free on the server; images/PDFs are read by NavBharatAI's economy vision engine by default, and by the top engine only when you turn on Power mode — so reading files never costs build-grade money.
• BUILD FROM A DESIGN / SCREENSHOT, AND GET TOLD WHAT WAS MISSED: when the file you attach is a UI design, mockup, wireframe or screenshot of a screen, v5.0 does more than "look at it". It writes down a checklist from the picture — every screen, its sections in top-to-bottom order, and the exact button/heading texts shown — and builds to that checklist instead of a loose impression. After the build it CHECKS the result against the same checklist and tells you honestly what is present and what is not, naming the exact missing sections or texts, so you can simply say "add the pricing section and the Contact us button" instead of hunting for the difference yourself. If the checklist could not be read from your image (for example the file is a photo or a document rather than a screen design), it says the design could not be checked — it never claims a match it did not verify. Costs nothing extra: the checklist comes out of the same single read of your image.
• HONEST billing: you are charged for the real work each build does — the everyday tiers cost the least, and the top "Power" tiers cost more because they run the most capable engine. You never see which provider actually ran; a live cost estimate is shown before and a real charge after.
• BUDGET REACHED / CONTINUE: a very large build can hit its per-build budget cap. When that happens v5.0 does NOT fail or silently keep spending — it PAUSES honestly, saves your files, and shows a calm "budget reached — Continue building" state with a Continue button. Clicking Continue resumes the same build with a fresh budget window (it uses more of your balance); you can also just stop there. This is separate from running out of wallet balance (which blocks new paid builds until you recharge).
• COST BREAKDOWN ("Why this cost?"): after a billed build, a "Why this cost?" toggle appears next to the ₹ amount in the result footer — expand it to see exactly how the charge was computed: your input/output token split, the tier that ran, the base cost for that tier, the markup applied, and the final USD → ₹. Free builds show no charge to explain.`,
    howToUse: 'Open it from the sidebar menu → "App Builder v5.0" (or from Professionals → the "NavBharatAI Pro v5.0" card) — it then appears as a "NavBharatAI Pro v5.0" tab in the top header, alongside your other open tabs. Type what you want to build, and press Send. To analyze or build from a file, click the paperclip next to the message box and attach images, PDFs, Word/Excel/PowerPoint, ZIP, or text/code files (or paste a screenshot) — then ask your question. Open the build-options menu (the ⚙️ gear "Build options" in the toolbar just below the message box) to toggle Planning, Thinking, Power (the maximum-capability mode — bills more because it runs the top engine, and also uses that engine to read attached images), or "Keep screen on" (default ON — stops your phone/screen from sleeping while a build runs so it cannot be cut off; works while the tab is open). The live surfaces — Preview / Files / Diff / Terminal / History — are tab pills in the header: tap one to open that workspace beside the chat (it takes over the screen on mobile), and tap it again (or the ✕) to collapse back to full-width chat. Press Stop to cancel.',
    relatedFeatures: ['engineer_ai', 'pro_chat', 'history', 'settings_secrets'],
    aiSurface: 'engineer_ai',
    keywords: [
      'v3', 'v5.0', 'vargen', 'vargen 3', 'agentv3', 'agent v3', 'pro v3',
      'multi agent', 'multiple agents', 'ai team', 'sub agent', 'subagent',
      'claude code', 'native tool use', 'architect', 'live preview',
      'mobile view', 'desktop view', 'tablet view', 'responsive', 'responsive preview', 'device view', 'device preview', 'viewport', 'mobile preview', 'phone view', 'screen size', 'mobile me kaisa dikhega', 'mobile view dekho', 'preview size', 'change view',
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
      'design se app banao', 'screenshot se app', 'mockup', 'wireframe', 'figma screenshot', 'design upload',
      'build from design', 'image se banao', 'design match', 'ye design banao',
      'history', 'saved chats', 'my conversations', 'past builds', 'checkpoints', 'restore',
      'preview old version', 'preview version', 'see old version', 'compare versions', 'purana version dekho',
      'pehle wala version', 'old version kaise dekhe', 'version preview', 'before restoring', 'undo dekhna',
      'chat list', 'chats menu', 'history menu', '3 line menu', 'hamburger menu', 'new chat', 'past chats',
      'recent chats', 'recent chat', 'reload', 'refresh', 'reopen chat', 'lost my chat', 'messages gone',
      'open new chat', 'naya chat kholo', 'purani chat', 'reload karne par', 'dormant', 'terminal dormant',
      'session history', 'saved sessions', 'delete chat', 'delete session', 'remove chat', 'purani chat delete', 'chat hatao', 'group by date', 'today yesterday',
      'pin chat', 'pin session', 'unpin', 'pinned', 'chat pin karo', 'search chat', 'search session', 'find chat', 'search history', 'chat search', 'chat dhundo', 'pin karo',
      'green dot', 'live dot', 'which app is live', 'live app', 'published app', 'kaunsi app live hai', 'live wali chat',
      'footer', 'bottom bar', 'bottom nav', 'neeche wala menu', 'footer buttons', 'pro chat button', 'report button',
      'code studio button', 'code studio footer', 'editor kaha hai', 'code edit karo', 'report count', 'report kitni baar', 'duplicate report', 'report (1)', 'report already sent',
      'green dot', 'dot hatao', 'remove that', 'yeh hatao', 'point and change', 'visual edit', 'element kaha hai', 'which file', 'kis file me hai', 'nahi mila', 'not found on page',
      'copy file', 'copy path', 'delete file', 'file delete', 'file options', 'preview gayab', 'preview disappear', 'preview wapas',
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
      'java', 'spring boot', 'springboot', 'go', 'golang', 'backend', 'jvm', 'maven', 'mongodb', 'mongo', 'redis',
      'solid', 'solidjs', 'solid.js', 'solid js', // SolidJS + Vite frontend scaffold (fine-grained reactive)
      'preact', 'preactjs', // Preact + Vite frontend scaffold (tiny React alternative)
      'lit', 'litelement', 'lit-html', 'web component', 'web components', // Lit + Vite (Web Components)
      'alpine', 'alpinejs', 'alpine.js', // Alpine.js + Vite (lightweight HTML-driven reactivity)
      'hono', // Hono + Node backend API framework
      'polyglot', 'fullstack', 'full stack', 'rest api', 'microservice', 'java app', 'go app', 'java banao', 'backend banao',
      'graphql', 'graphql api', 'graphql server', 'apollo', 'graphql-yoga', 'graphiql', 'schema resolver', 'query mutation', 'gql',
      // Bring-Your-Own integration recipes the builder can wire (users ask "can you add X to my app?")
      'add integration', 'integrate', 'byo', 'bring your own', 'add feature to app', 'connect service',
      'payments', 'razorpay', 'stripe', 'checkout', 'payment gateway', 'upi payment',
      'email', 'send email', 'resend', 'sendgrid', 'transactional email',
      'file upload', 'uploads', 'storage', 's3', 'r2', 'cloudinary',
      'realtime', 'real-time', 'pusher', 'ably', 'live updates', 'websocket',
      'search', 'full text search', 'algolia', 'meilisearch',
      'pagination', 'paginate', 'page', 'limit offset', 'infinite scroll', 'load more', 'per page', 'list endpoint', 'page size',
      'otp', 'phone verification', 'verify phone', 'msg91', 'twilio verify', 'otp verification',
      'pan', 'gstin', 'gst number', 'aadhaar', 'aadhar', 'ifsc', 'pincode', 'pin code', 'upi id', 'validate pan', 'validate gstin', 'validate aadhaar', 'kyc', 'indian mobile', 'verhoeff', 'normalize mobile', 'normalize phone', 'canonical phone', 'phone number format', 'e164', '+91',
      'sms', 'send sms', 'text message', 'vonage', 'twilio',
      'password', 'password hash', 'hash password', 'bcrypt', 'bcryptjs', 'store password', 'login password', 'signup password', 'salt', 'verify password', 'secure password',
      'uuid', 'generate id', 'unique id', 'short id', 'random id', 'token', 'secure token', 'reset token', 'api key', 'verification token', 'nanoid', 'random string',
      'analytics', 'product analytics', 'event tracking', 'posthog', 'mixpanel',
      'maps', 'map', 'google maps', 'mapbox', 'interactive map',
      'geocode', 'geocoding', 'address to coordinates', 'lat lng', 'reverse geocode',
      'background jobs', 'job queue', 'queue', 'bullmq', 'pg-boss', 'worker', 'cron job',
      'scheduler', 'schedule job', 'cron', 'recurring', 'daily job', 'nightly', 'setinterval', 'scheduled task', 'run every', 'run daily',
      'rate limit', 'rate limiting', 'throttle', 'api limit',
      'error tracking', 'error monitoring', 'sentry', 'rollbar', 'crash reporting',
      'feature flags', 'feature flag', 'launchdarkly', 'unleash', 'toggle feature',
      'ai', 'llm', 'openai', 'anthropic', 'chatgpt', 'text generation', 'ai text',
      'translation', 'translate', 'google translate', 'deepl', 'localize',
      'moderation', 'content moderation', 'toxicity', 'perspective', 'filter content',
      'captcha', 'recaptcha', 'hcaptcha', 'turnstile', 'bot protection', 'anti bot', 'verify captcha', 'spam protection', 'form protection',
      'cache', 'caching', 'upstash', 'redis cache',
      'retry', 'retries', 'backoff', 'exponential backoff', 'jitter', 'resilience', 'flaky api', 'transient error', 'retry storm', 'retry failed request',
      'http client', 'fetch timeout', 'fetchjson', 'api call', 'call external api', 'third party api', 'request timeout', 'fetch hangs', 'axios alternative', 'http request', 'rest client',
      'idempotency', 'idempotency key', 'idempotent', 'double charge', 'duplicate payment', 'duplicate request', 'exactly once', 'double submit', 'prevent duplicate',
      'newsletter', 'mailing list', 'mailchimp', 'brevo', 'waitlist', 'subscribe',
      'email template', 'html email', 'transactional email design', 'email layout', 'welcome email', 'reset email', 'receipt email', 'email html', 'responsive email',
      'currency', 'exchange rate', 'convert currency', 'forex', 'multi currency',
      'money format', 'format money', 'rupee format', 'inr format', 'lakh', 'crore', 'amount in words', 'rupees in words', 'indian number format', 'price format', 'format amount',
      'weather', 'weather api', 'openweathermap', 'weatherapi', 'forecast',
      'date format', 'time format', 'ist timezone', 'indian standard time', 'timezone', 'asia/kolkata', 'format date', 'relative time', 'time ago', 'posted at', 'datetime', 'date time',
      'notifications', 'slack', 'discord', 'team notification', 'slack alert', 'webhook notify',
      'notification center', 'in-app notification', 'notification bell', 'bell icon', 'unread badge', 'notifications dropdown', 'alerts panel', 'notification panel', 'mark as read',
      'env validation', 'validate env', 'required env', 'missing env var', 'env check', 'fail fast', 'startup check', 'environment variable validation',
      'cors', 'cross origin', 'blocked by cors', 'cors policy', 'cors error', 'allowed origins', 'preflight', 'access control allow origin',
      'csrf', 'csrf protection', 'csrf token', 'cross site request forgery', 'xsrf', 'double submit cookie', 'anti csrf', 'forged request', 'csrf middleware',
      'seo', 'meta tags', 'open graph', 'opengraph', 'og tags', 'sitemap', 'robots.txt', 'twitter card', 'social preview', 'search engine', 'canonical url',
      'slug', 'url slug', 'slugify', 'permalink', 'seo url', 'pretty url', 'friendly url', 'blog url', 'unique slug',
      'webhook', 'webhook verification', 'verify webhook', 'webhook signature', 'hmac', 'signature verification', 'payment webhook', 'razorpay webhook', 'stripe webhook', 'cashfree webhook', 'github webhook', 'timing safe',
      'send webhook', 'outgoing webhook', 'webhook sender', 'notify subscribers', 'fire webhook', 'dispatch webhook', 'webhook delivery', 'sign webhook',
      'validation', 'validate', 'input validation', 'request validation', 'zod', 'schema validation', 'validate body', 'form validation', 'sanitize input', 'bad request', '400',
      'integration test', 'integration tests', 'api test', 'endpoint test', 'crud test', 'supertest', 'lifecycle test', 'e2e api test', 'route test', 'rest test', 'real integration test',
      'xss', 'sanitize html', 'sanitize-html', 'html sanitization', 'cross site scripting', 'stored xss', 'clean html', 'strip html', 'user generated content', 'rich text', 'safe html',
      'state management', 'global state', 'zustand', 'redux', 'store', 'shared state', 'app state', 'optimistic update', 'context', 'state store',
      'settings page', 'settings scaffold', 'preferences page', 'user settings', 'theme toggle', 'dark mode toggle', 'app preferences', 'settings screen', 'account settings',
      'railway', 'render deploy', 'fly.io', 'flyctl', 'render.yaml', 'railway.json', 'fly.toml', 'nixpacks', 'paas deploy', 'deploy to railway', 'deploy to render',
      'aws', 'app runner', 'apprunner', 'apprunner.yaml', 'deploy to aws', 'azure', 'azd', 'azure.yaml', 'azure container apps', 'deploy to azure',
      'markdown', 'render markdown', 'marked', 'md to html', 'markdown to html', 'commonmark', 'blog markdown', 'docs markdown',
      'qr', 'qr code', 'qrcode', 'scan', 'upi qr', 'ticket qr', 'generate qr',
      'upi', 'upi link', 'upi payment', 'upi id', 'vpa', 'collect payment', 'pay link', 'gpay', 'phonepe', 'bhim', 'scan to pay', 'upi intent', 'accept payment',
      'pdf', 'invoice', 'gst invoice', 'receipt', 'generate pdf', 'pdfkit', 'download pdf', 'export pdf',
      'csv', 'export csv', 'import csv', 'download csv', 'export to excel', 'excel export', 'spreadsheet', 'papaparse', 'parse csv', 'bulk import', 'data export', 'data import',
      'audit log', 'audit trail', 'activity log', 'tamper evident', 'tamper proof', 'who did what', 'change history', 'admin actions log', 'immutable log', 'hash chain', 'compliance log', 'action history',
      'image', 'resize', 'thumbnail', 'sharp', 'optimize image', 'compress image', 'avatar', 'image upload',
      'logging', 'logs', 'logger', 'structured logging', 'pino', 'log level', 'request log', 'console log', 'observability', 'json logs',
      'file upload', 'upload validation', 'validate upload', 'magic bytes', 'file type', 'mime check', 'allowed file types', 'max file size', 'malicious upload', 'image upload', 'avatar upload', 'document upload',
      'graceful shutdown', 'sigterm', 'zero downtime', 'drain connections', 'shutdown', 'restart', 'deploy downtime', 'dropped requests',
      'security headers', 'helmet', 'clickjacking', 'x-frame-options', 'hsts', 'csp', 'content security policy', 'harden', 'nosniff', 'referrer policy',
    ],
  },
  {
    id: 'agentv3_export',
    name: 'Export project (.zip) — your code, no lock-in',
    path: 'NavBharatAI Pro v5.0 → Files tab → "ZIP" button (top of the file list)',
    description: 'Download your entire v5.0 project as a real .zip file that you fully own. It contains the source files (generated folders like node_modules, dist and .git are excluded so it stays the clean source). Open it in any code editor (VS Code, etc.) or host it on any provider — there is no lock-in. The zip is packaged by the server (/api/download-zip) from your live project files, then the download starts automatically; a failure shows an honest "Download failed — try again" instead of a silent stall.',
    howToUse: 'Open NavBharatAI Pro v5.0 and build or open a project, then open the Files tab (or the sidebar Files view). At the top of the file list, tap the "ZIP" button — the whole project downloads as a .zip. (After a deploy you can also download the ZIP from the deploy card in the chat.)',
    relatedFeatures: ['agentv3_builder'],
    keywords: ['export', 'download', 'zip', 'download project', 'export code', 'download code', 'my code', 'source code', 'no lock-in', 'portability', 'take my code', 'code nikalo', 'project download', 'download karo', 'zip nikalo', 'apna code'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_zip_import',
    name: 'Import an existing app (.zip) into v5.0',
    path: 'NavBharatAI Pro v5.0 → chat composer → 📎 attach menu → "Import project (.zip)" → pick your app\'s .zip (it imports immediately — no send needed)',
    description: 'Bring an app you already built (exported from any tool — Lovable, Bolt, v0, VS Code, or an earlier NavBharatAI export) into NavBharatAI Pro v5.0 by attaching its .zip in the chat. The archive is really unpacked into your workspace: the files appear in the Files tab and Code Studio (IDE), the framework (React/Vite, Next.js, Vue, …) is detected from package.json and locked to the session, the live preview is set up automatically in the background (npm install + dev server), and the AI reads the real project so your first edit request works with full context. Full-stack apps that need a database get a local PostgreSQL provisioned in the sandbox plus a dev .env (so the server boots instead of crashing on a missing DATABASE_URL); external paid services (payments, third-party APIs) can\'t be provisioned, so those features stay inactive until you add real keys in Settings → Secrets — the preview is honest about that. Small images, icons and fonts (logos/favicons, ≤200KB each) are kept as real assets so the preview isn\'t full of broken images; large media/binaries are skipped. Safety: node_modules/build folders are skipped (re-created by install), and secret files (.env, keys) are never imported — re-enter your own secrets (the app\'s expected variable names are surfaced from its .env template). Archive limit 5 GB; per-file limit 900KB for editable source.',
    howToUse: 'Open NavBharatAI Pro v5.0, tap the 📎 attach button in the chat box, choose "Import project (.zip)", and pick your app\'s .zip — it imports right away (no send needed). Watch the import summary appear in chat; your files show in the Files tab and the IDE, and the preview boots in the background. Then simply tell v5.0 what to change.',
    relatedFeatures: ['agentv3_builder', 'agentv3_export', 'agentv3_files'],
    keywords: ['import', 'import app', 'import zip', 'zip upload', 'upload zip', 'existing app', 'purani app', 'apni app', 'app import karo', 'zip se app', 'zip dalo', 'bring my app', 'migrate app', 'lovable', 'bolt', 'v0', 'edit my existing app', 'meri bani hui app', 'zip import'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_github_import',
    name: 'Import an existing app from GitHub into v5.0',
    path: 'NavBharatAI Pro v5.0 → chat composer → the gear "Build options" (⚙) button → "Import Repo" (GitHub / URL) → pick a repo from your list (1 click) or paste a URL',
    description: 'Bring an app that lives in a GitHub repository into NavBharatAI Pro v5.0 with ONE click: the Import Project dialog lists your own repositories (recently updated first, searchable, private repos marked) — clicking one imports it immediately. Not connected yet? A single "Connect GitHub" button signs you in and approves access (private repos included), then you land back on the list. The repo is really cloned into your workspace and lands the same way a zip import does — files appear in the Files tab and Code Studio (IDE), the framework is detected from package.json and locked to the session, the live preview is set up automatically in the background, and the AI reads the real project and gives a survey before your first edit request. You can also paste any https://github.com/owner/repo URL (e.g. someone else\'s public repo). The SAME dialog has an Import / Push toggle: switch to "Push" and click one of your repos to publish your CURRENT app to it (a new repo is created automatically if it does not exist). Push is safe — secrets like .env and service-account files are never sent, and if the repo already has newer commits you are asked to import first instead of overwriting your work.',
    howToUse: 'Open NavBharatAI Pro v5.0 → tap the gear "Build options" (⚙) button next to the chat box → "Import Repo". If asked, click "Connect GitHub" once. Then simply click the repository you want — the import, Files/IDE, preview boot and AI survey all happen automatically. Or paste a repo URL below the list and press Import.',
    relatedFeatures: ['agentv3_builder', 'agentv3_zip_import', 'agentv3_files', 'agentv3_ship_to_main'],
    keywords: ['github import', 'import from github', 'repo import', 'clone repo', 'github url', 'import repository', 'github se app', 'repo se import', 'apni github app', 'private repo', 'github wali app', 'repository import karo'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_roles_queue',
    name: 'Plan & Advise modes + the build queue (3-role workflow)',
    path: 'NavBharatAI Pro v5.0 → mode selector at the message box (bottom-left, next to the settings button) — a small "🔨 Build" dropdown that opens upward with Build · Plan · Advise (+ the Queue chip)',
    description: 'Work on one app with three modes from the same chat box. BUILD (default) is the normal builder — messages build/edit the app. PLAN switches the composer to a read-only planner: describe a goal (even a 10-phase roadmap) and it decomposes it into ordered, buildable steps — it never edits anything itself. ADVISE is a read-only advisor for audits, test ideas, research, explanations and comparisons, grounded in your real project files. When Plan/Advise propose steps, a card appears in the chat with a "Queue all" button and per-step + buttons — steps are only added when YOU approve them, never automatically. Queued steps go into this app\'s command queue and the builder runs them ONE AT A TIME in order, hands-free (the queue pauses on an error so you decide, and pauses when you close the tab — it resumes when you come back). The Queue chip above the chat box shows pending/running counts; tap it to see every step and cancel pending ones. Because only the builder ever writes files, your app can never be corrupted by two edits at once.',
    howToUse: 'Open a v5.0 chat on your app. Tap the mode selector at the bottom-left of the message box (it shows "🔨 Build") and pick "Plan", then describe your goal — review the proposed steps and tap "Queue all" (or + on individual steps). Switch back to "Build" or just wait: the builder picks up the queue and runs each step in order. Tap the "Queue" chip any time to watch progress or cancel a pending step. Use "Advise" the same way for audits/reviews — its suggested fixes queue the same way.',
    relatedFeatures: ['agentv3_builder'],
    keywords: ['plan mode', 'planner', 'advisor', 'advise', 'audit', 'review code', 'roadmap', 'queue', 'build queue', 'command queue', 'steps queue', 'queue all', 'ek ek karke', 'roadmap chalao', 'plan banao', 'audit karo', 'queue me daalo', 'multiple commands', '10 commands'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_ship_to_main',
    name: 'Edit your own GitHub repo & ship to main (own-repo mode)',
    path: 'NavBharatAI Pro v5.0 → import YOUR OWN GitHub repo → edit → "Ship to main" button above the chat box',
    description: 'When you import a GitHub repository that YOU own, NavBharatAI Pro v5.0 works directly on that real repo — not a separate copy. Your edits are committed to a dedicated working branch (navbharatai/work) inside your repo, so your default branch (main) is never touched automatically and stays 100% safe. A pull request from navbharatai/work → main is kept open so you can review the diff. When you are ready, tap "Ship to main" (the green rocket button above the chat box): it merges that PR into your default branch — but ONLY when the repository\'s CI checks are green (a red or pending PR is left open with an honest note, never force-merged). So the whole loop — fetch your repo → edit → review PR → ship on green → revert if needed — happens in one place, and going live is just a normal merge to your own repo. If a shipped change breaks the app, tap "Revert last" (right next to Ship): it undoes the most recent change on your default branch by restoring the previous state as a new, non-destructive commit (your history is preserved and the revert is itself undoable). GitHub\'s own "Revert" button on the merged PR also works.',
    howToUse: 'Import a repository you own (see "Import an existing app from GitHub"). Edit it by chatting with v5.0 — each build saves to the navbharatai/work branch, and your main stays untouched. When you\'re happy, tap "Ship to <main>" above the chat box: if CI is green it merges to your default branch; if CI is red or still running it leaves the PR open and tells you honestly. If a merge broke something, tap "Revert last" right beside it to restore the previous state.',
    relatedFeatures: ['agentv3_github_import', 'agentv3_builder'],
    keywords: ['ship to main', 'merge to main', 'pr to main', 'push to main', 'deploy my repo', 'edit my github repo', 'own repo', 'work branch', 'navbharatai/work', 'merge branch', 'apni repo me push', 'main me merge', 'github pe live', 'pull request merge', 'ship karo', 'revert merge'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_project_mode',
    name: 'Software Project Mode — build very large software (hundreds of files) module by module',
    path: 'NavBharatAI Pro v5.0 → chat — automatic for large software requests (a full ERP/CRM/management system, an explicit "200+ screens" scale, or a spec listing many features)',
    description: 'For software too big for one build round, v5.0 first decomposes the request into independently-buildable modules with frozen interface contracts, saves that plan durably (it survives reloads, closed tabs and new sessions), and then builds ONE module per round in dependency order — continuing automatically round after round while real progress is being made, until every module is done. The module plan is shown as the plan list above the chat box and ticks off live. If a module fails, the build pauses honestly with the reason and its dependent modules wait; typing "continue" retries the failed module. Requires the admin to have enabled project mode on the server (AGENTV3_PROJECT_MODE).',
    howToUse: 'Describe the full software in one message — an explicit scale ("an app with 200+ screens") or a detailed numbered/bulleted feature list is what triggers project mode. Watch the module plan appear and tick off as rounds complete; it continues by itself while progressing. To resume later (after a reload, a new session, or a failed module), just type "continue".',
    relatedFeatures: ['agentv3_builder', 'agentv3_build_continuity', 'agentv3_files'],
    keywords: ['big app', 'large app', 'badi app', 'bada software', '1000 files', '5000 files', 'full software', 'complete software', 'erp', 'crm', 'management system', 'module', 'modules', 'project mode', 'module by module', 'big project', 'bade project', 'pura software banao', 'complex app', 'complex software', 'enterprise app', 'bahut badi app'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_build_continuity',
    name: 'Build survives reload & tab switch (no lost work)',
    path: 'NavBharatAI Pro v5.0 — automatic; the build keeps running and re-attaches on its own',
    description: 'A running v5.0 build does NOT stop when you reload the page or switch tabs. The build keeps running on the server; when the page reloads or the tab becomes visible again, v5.0 automatically re-attaches to the live build and resumes streaming where it left off — no "Resume" click needed (the manual Resume button stays as a fallback). Your project is sticky too: the session id is saved per account, so a reload reuses the SAME workspace, memory and files (the next message continues the same project, never a blank one). Chat history is restored on reload, and if files ever look missing you can also use "Restore all files".',
    howToUse: 'Just keep using NavBharatAI Pro v5.0 — if you refresh or switch tabs during a build, it reconnects by itself and continues. Your previous messages, plan, files and live preview come back automatically. If anything still looks missing, open History or Files and click "Restore all files".',
    relatedFeatures: ['agentv3_builder', 'agentv3_restore_files', 'agentv3_files'],
    keywords: ['reload', 'refresh', 'tab switch', 'tab change', 'build stopped', 'build band', 'reload pe band', 'tab badalne par', 'lost work', 'work gayab', 'memory lost', 'context lost', 'resume', 'reconnect', 'build continue', 'kaam wapas', 'session', 'page refresh', 'build ruk gaya'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_restore_files',
    name: 'Restore all files (bring your whole project back)',
    path: 'NavBharatAI Pro v5.0 → header → History tab (or Files tab when empty) → "Restore all files" button',
    description: 'Bring your ENTIRE project back into the workspace with one click — a real restore, not a preview. If your files look gone (for example after a page refresh, or a build that did not finish), open the History tab (or the Files tab) and click "Restore all files". NavBharatAI writes your last durably-saved project files back into the workspace so they are genuinely there again — listed in Files, previewable, buildable and deployable. It honestly tells you how many files were restored, or says so if there are no saved files yet. You can also restore to a specific earlier checkpoint from the History list.',
    howToUse: 'Open NavBharatAI Pro v5.0. Tap the "History" tab at the top (or the "Files" tab if it shows no files). Click "Restore all files" — the workspace is repopulated and the Files tab opens showing your restored files. To go back to an earlier version instead, click "Restore" next to a specific checkpoint in History.',
    relatedFeatures: ['agentv3_builder', 'agentv3_export', 'agentv3_deploy'],
    keywords: ['restore', 'restore files', 'restore all', 'files gone', 'files missing', 'files 0', 'lost files', 'get files back', 'recover', 'recover files', 'checkpoint', 'history', 'restore karo', 'files wapas', 'file gayab', 'files nahi dikh rahi', 'project wapas', 'restore project'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_build_report',
    name: 'Report a build to NavBharatAI (admin-only report)',
    path: 'NavBharatAI Pro v5.0 → header tab row → "Report" button',
    description: 'A build\'s diagnostics report is sent to the NavBharatAI team, not shown to you. After a build, a single "Report" button appears in the v5.0 header (and in the mobile More sheet). Tapping it submits that build\'s full diagnostics report — root cause, problems, sandbox/LLM detail — to NavBharatAI so the team can review it and improve the build engine. You see only a short "Report sent" acknowledgement; the report content itself is not shown, downloaded or copied to you (admin 2026-07-29). CHOOSE WHICH BUILD (2026-08-04): a chat usually has many builds — the first one plus every edit. If this chat has more than one, tapping Report first asks "Which build had the problem?" and lists them (newest first) so you can report the build that actually broke, not just the most recent one. Each row shows only your own request, the time, and whether it worked — never the report\'s contents. With just one build it sends straight away in one tap.',
    howToUse: 'Build an app in NavBharatAI Pro v5.0, then tap "Report" in the tab row at the top (or More → Report on mobile). If the chat has several builds, pick the one that had the problem from the list that appears (the newest is at the top, marked "Latest"). You will see "Report sent" — that build\'s report has gone to the NavBharatAI team. There is nothing to download or read; the team reviews reports to make builds better.',
    relatedFeatures: ['agentv3_builder', 'agentv3_files', 'agentv3_export'],
    keywords: ['build report', 'report', 'report button', 'send report', 'report to team', 'report bhejo', 'report kaise', 'diagnostics', 'build issues', 'kya dikkat aayi', 'why failed', 'kyu fail hua', 'report sent', 'report admin', 'feedback', 'report a build', 'support', 'which build', 'old build report', 'purani build', 'pichli build', 'report list', 'choose build', 'edit ki report'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_files',
    name: 'Files — one Files view, two gates (v5.0 tab + sidebar)',
    path: 'NavBharatAI Pro v5.0 → header → Files tab  —OR—  sidebar menu → Files (both open the SAME Files view)',
    description: 'There is ONE Files feature, reachable from two places that open the exact same view: the "Files" tab in the NavBharatAI Pro v5.0 header, and "Files" in the sidebar menu. Both show the SAME files — the files v5.0 built PLUS any files you uploaded — and offer the same actions: browse the file tree, search/filter by name, upload files, download the whole project as a ZIP, create, rename, duplicate or delete a file, and a History tab to restore an earlier version. Click any file to open it in Code Studio and read or edit its full contents. The list is pulled live from your real project (v5.0 sandbox files are merged with the main app files, and heavy generated folders like node_modules, dist and .git are left out so it stays the clean source). Because both entry points render the same component over the same data, what you see in the v5.0 Files tab and the sidebar Files is always consistent. The live "Plan" checklist above the chat input can be minimized or expanded with a single tap so it never eats the chat area — collapsed, it still shows the current step.',
    howToUse: 'Open Files from EITHER place — the "Files" tab in the v5.0 header, or "Files" in the sidebar menu; both open the same view with the same files (v5.0-built and uploaded) and the same actions (upload, download ZIP, rename, duplicate, delete, search, and History → Restore). Tap a file to open it in Code Studio. To shrink the Plan checklist above the message box, tap the "Plan" header (the chevron) — tap again to expand it.',
    relatedFeatures: ['agentv3_builder', 'agentv3_export', 'agentv3_restore_files', 'files'],
    keywords: ['file content', 'view file', 'open file', 'read file', 'see code', 'file ke andar', 'file kholo', 'file dekho', 'code dekho', 'andar kya likha', 'files view', 'sidebar files', 'files sync', 'plan minimize', 'plan collapse', 'plan chhota karo', 'plan hide', 'chat area', 'minimize plan', 'expand plan', 'file content dikhao', 'line count', 'lines', 'kitni line', 'number of lines', 'lines likhi', 'file lines', 'green yellow dot'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_deploy',
    name: 'Publish to a live URL (one click)',
    path: 'NavBharatAI Pro v5.0 → header action row → "Publish" button (opens the Hosting chooser; the live link then shows as "Live site")',
    description: 'Publish your built app to a PERMANENT public URL. The "Publish" button opens a Hosting chooser — host free on NavBharatAI, or bring your own provider (no lock-in) — then runs the production build and publishes, returning a real https URL that anyone can open and that STAYS LIVE even after the cloud sandbox stops. Providers: Firebase Hosting (always available) plus Cloudflare Pages, Vercel and Netlify (and more) when their API token is configured by the admin. Once published, a "Live site" link appears in the same row — click it to open your live app, or share the URL with anyone. The live link is saved, so it comes back even after you refresh or return in a new session. To put it on your own domain, use Settings → App Settings → Domain.',
    howToUse: 'Build an app in NavBharatAI Pro v5.0, then click "Publish" in the action row at the top (on mobile it is in the More sheet). Pick where to host in the chooser; v5.0 builds and publishes it — watch the progress in the chat. When it finishes, click the "Live site" link that appears to open your permanent public URL, and share that URL with anyone.',
    relatedFeatures: ['agentv3_builder', 'agentv3_preview', 'agentv3_export'],
    keywords: ['deploy', 'publish', 'go live', 'live url', 'public url', 'host', 'hosting', 'share app', 'live site', 'make it live', 'put online', 'deploy karo', 'live karo', 'publish karo', 'app live', 'website live', 'permanent url', 'share link', 'firebase hosting', 'cloudflare', 'cloudflare pages', 'vercel', 'netlify', 'hosting provider', 'kahan deploy', 'no lock-in', 'launch'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_preview',
    name: 'Preview (dual: Live server + In-browser)',
    path: 'NavBharatAI Pro v5.0 → header → Preview tab → "Live server" / "In-browser" switch',
    description: 'Two ways to preview your app inside the v5.0 builder. "Live server" shows the real running app from the cloud (E2B) sandbox — full fidelity, supports any framework and a backend. "In-browser" renders a self-contained build of your files right inside the browser with no server, so it still works when the sandbox preview is unavailable (e.g. a "Blocked request" error) and is instant for static HTML/CSS/JS and simple React/Vue apps. Switch between them with the toggle at the top of the Preview tab. Each mode has a reload (↻) button: on "Live server" it reconnects the running app (useful right after a build, when the cloud sandbox is still finishing its cold start and the preview shows "still starting"); on "In-browser" it rebuilds the preview from the latest files. If "Live server" still shows "No live preview yet" after a build finishes, a "Diagnose" button appears in that empty state — it re-runs the real dev-server boot sequence inside your sandbox (installs dependencies, restarts the server, checks the port) and reports the exact internal reason it failed, or restores the preview immediately if the server was actually already running. After a successful build, NavBharatAI also OPENS THE OTHER PAGES of your app in a real browser (not just the home page) and reports whether each one actually rendered — so a page that loads with no error but paints a blank screen is caught and named in the build report, instead of looking fine until you click on it. Dynamic pages (like /users/:id) are skipped, because opening one would need an id we had to invent. If your app has a backend (a Node/Express API, a database, or a Python server), the "In-browser" preview — which runs only the frontend — shows an honest banner explaining that its data/API features won\'t work there and pointing you to the "Live server", which actually boots the backend; so a full-stack app never looks silently broken. NEW (2026-08-06): (1) a CONSOLE drawer — the terminal icon in the preview toolbar opens a panel showing everything your running app prints (logs, warnings, errors) without opening browser devtools; error lines carry a one-tap "Fix with AI" button, and a red badge on the icon counts errors. (2) In the Visual Editor, after selecting an element, an "Ask AI" button attaches that EXACT element (its real source location) to the chat — you just type what to change and the AI edits precisely that element, never a guess.',
    howToUse: 'Open the Preview tab in NavBharatAI Pro v5.0. If the app is running you will see the Live server preview. If it shows "No live preview yet" or looks stuck right after a build, click the reload (↻) button to reconnect once the sandbox has started, or click "Diagnose" to have v5.0 check the real dev-server state inside the sandbox and report the exact cause (or fix it on the spot). Click "In-browser" to render the files locally without a server (useful if the live preview is blocked or not started), and use its reload (↻) button to rebuild after changes. Tap the terminal icon to see your app\'s console (and "Fix with AI" on any error). In Edit mode, select an element and tap "Ask AI" to tell the AI what to change about exactly that element.',
    relatedFeatures: ['agentv3_builder', 'agentv3_export'],
    keywords: ['preview', 'live preview', 'in-browser preview', 'browser preview', 'blocked request', 'preview not working', 'preview nahi chal raha', 'app dekho', 'see app', 'run app', 'sandbox preview', 'static preview', 'dual preview', 'preview kaise', 'diagnose', 'diagnose button', 'diagnose preview', 'preview diagnosis', 'internal problem', 'preview kya problem hai'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'agentv3_github_storage',
    name: 'Save apps to your own GitHub (git-native)',
    path: 'Sign in with GitHub → build in NavBharatAI Pro v5.0 → your project is committed to a private repo in YOUR GitHub account',
    description: 'When you sign in with GitHub, NavBharatAI Pro v5.0 stores each project as a real private repo in YOUR OWN GitHub account (not on our servers). Every build commits there, so your code is durable and 100% owned by you — no lock-in. It works like a professional git workflow: the build is pushed to a branch, a pull request is opened, CI is checked, and the PR is merged only when checks are green (never merged red). Users who sign in with Email/Phone instead get the same durability via a private repo in the platform GitHub org behind the scenes. Requires GitHub git-native storage to be enabled by the admin.',
    howToUse: 'Click "Continue with GitHub" on the login screen and approve the repo permissions. Then build normally in NavBharatAI Pro v5.0 — the builder creates/uses a private repo in your GitHub for the project and commits every build to it. Open your GitHub to see the repo, branches, pull requests and merges.',
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
  // ─── ENGINEER AI ─────────────────────────────────────────────────────────
  {
    id: 'connect_domain',
    name: 'Connect my website (custom domain)',
    path: 'Settings → App Settings → Domain  (also: Sidebar → More menu → "Connect my website", or Home → Other AI → Publish & Deploy → "Custom Domain" — all the same real flow)',
    description: `Connect your own purchased domain (e.g. from Hostinger or GoDaddy) to a NavBharatAI Pro v5.0 app you built.
• First pick WHICH app the domain should point to (auto-picked if you only have one).
• Enter your domain (e.g. myshop.com) and press Connect — this attaches it directly to that app's own hosting.
• You get the EXACT DNS records to add at your registrar (Hostinger, GoDaddy, Cloudflare, Namecheap, BigRock, etc.).
• Press "Check" to see the real live status (ownership / DNS / SSL) — HTTPS is issued automatically once the records resolve.
Honest throughout: it never claims a domain is connected until it verifiably is, and it never offers this for an account with no built app yet — it tells you to build one first. Root-cause fix 2026-07-27: this used to be two different half-working screens; both entries now share one real, working flow.
NOTE (2026-08-06): connecting a domain is part of the Custom Domain plan (₹99/30 days, Billing → Plans, paid from the wallet — it also removes the "Made with NavBharatAI" badge). A user without the plan gets an honest upgrade note at the Connect step; already-connected domains keep working.`,
    howToUse: 'Open Settings → App Settings → Domain (or Sidebar → More → Connect my website, or Home → Other AI → Publish & Deploy → Custom Domain) → pick the app → enter your domain → Connect → add the DNS records shown → press Check until it shows Live.',
    relatedFeatures: ['engineer_ai', 'engineer_ai_deploy', 'settings_root'],
    keywords: [
      'connect domain', 'custom domain', 'my website', 'apna domain', 'website connect',
      'hostinger', 'godaddy', 'dns', 'point domain', 'live website', 'own domain',
      'connect my website', 'domain jodo', 'website live karo',
      'app settings domain', 'settings domain', 'domain setting',
    ],
  },
  {
    id: 'made_with_badge',
    name: '"Made with NavBharatAI" badge on published apps',
    path: 'Automatic — appears in the bottom-right corner of every app published on NavBharatAI hosting',
    description: `Every app published on NavBharatAI's free hosting carries a small glowing "Made with NavBharatAI" badge in the bottom-right corner. It links back to navbharatai.com and is part of the free-hosting agreement — free hosting is paid for by this attribution.
• It is added by the PUBLISHING SERVER, not by the app's source code — so editing or deleting it from the code (by hand or with any AI assistant) does not remove it; the next publish stamps it back automatically.
• It is small, sits above the page corner, and never blocks the app's own buttons or content.
• HONEST ANSWER when a user asks how to remove it: buy the Custom Domain plan (₹99/30 days, Billing → Plans, paid from the wallet) — the badge then stops being added on the next publish, automatically. Do not suggest code edits, CSS tricks, or other AI tools to strip it; those do not work and breach the hosting terms.`,
    howToUse: 'Nothing to set up — publish any app and the badge appears automatically on the live site. To publish without the badge, activate the Custom Domain plan in Billing → Plans; there is no other supported way to remove it.',
    relatedFeatures: ['connect_domain', 'hosting_plan', 'engineer_ai_deploy'],
    keywords: [
      'made with navbharatai', 'badge', 'watermark', 'logo hatao', 'badge remove', 'badge hatao',
      'remove branding', 'watermark remove', 'bottom right badge', 'popup corner', 'branding',
    ],
  },
  {
    id: 'hosting_plan',
    name: 'Custom Domain plan (₹99 / 30 days)',
    path: 'Billing (wallet) → Plans card → "Activate — ₹99"',
    description: `The one paid hosting plan. ₹99 per 30 days, paid directly from the same wallet everything else uses (no separate payment flow). What it gives:
• Removes the "Made with NavBharatAI" badge from every app you publish (takes effect on your next publish).
• Unlocks connecting your OWN purchased domain (e.g. myshop.com from Hostinger/GoDaddy) to your app.
The Plans card also shows the rest of the account honestly: Database is always FREE (your apps' databases run on your own account), and Coding is pay-per-use from the wallet — no subscription.
Renewal: auto-renew is on by default and charges the wallet ₹99 when the 30 days end; turn it off with one tap and the plan simply ends on its expiry date.
What happens if it is NOT renewed (honest answer): you get in-app reminders 5 days and 1 day before expiry (they name the exact shortfall if your balance is low). After expiry there is a 3-day grace window — recharge in it and nothing is interrupted. Past grace, your custom DOMAIN is paused (it stops serving) — but your APP is never deleted: it stays live on its free NavBharatAI link with the badge. Buy the plan again and the domain reconnects automatically within minutes.`,
    howToUse: 'Open Billing (wallet) → find the Plans card → tap "Activate — ₹99". Needs at least ₹99 of wallet balance (recharge first if short). Then publish again for badge-free hosting, or go to Settings → App Settings → Domain to connect your domain.',
    relatedFeatures: ['made_with_badge', 'connect_domain'],
    keywords: [
      'hosting plan', 'custom domain plan', 'plan kharido', 'badge hatane wala plan', '99 plan',
      'paid plan', 'subscription', 'upgrade', 'plans', 'hosting charge', 'domain plan', 'auto renew',
    ],
  },
  {
    id: 'engineer_ai',
    name: 'Engineer AI (retired → use NavBharatAI Pro v5.0)',
    path: 'RETIRED. App building is now NavBharatAI Pro v5.0 — Sidebar → "NavBharatAI Pro v5.0".',
    description: `RETIRED — replaced by NavBharatAI Pro v5.0, the new agentic app builder (everything Engineer AI did, now in v5.0: builds full-stack apps, live preview, GitHub storage, deploy, multi-agent team). Direct users to "NavBharatAI Pro v5.0" in the sidebar. Original Engineer AI capabilities (for reference):
• BUILDS apps from plain-language descriptions — React/Vite, Next.js, Vue, Svelte, Node/Express, Python/FastAPI, or plain HTML.
• SEES the running app via screenshots — visually verifies layout, UI, and bugs.
• DRIVES the browser — clicks buttons, fills forms, navigates pages, tests flows end-to-end.
• SEARCHES the web — finds docs, error fixes, and latest package versions (Brave Search or DuckDuckGo).
• CLONES GitHub repos into the sandbox; PUSHES code back to GitHub.
• DEPLOYS finished apps to Firebase Hosting — permanent public HTTPS URL.
• PROVISIONS databases — installs PostgreSQL, generates DATABASE_URL, scaffolds db/auth/storage helpers.
• GENERATES Vitest unit tests automatically after the app is built.
• END-TO-END TESTS (Cap-2 — Playwright E2E scaffold): v3.0 can scaffold a real end-to-end test setup — a playwright.config.ts that starts your dev server and an e2e/smoke.spec.ts that loads the running app in a real browser and asserts it renders (failing on a blank screen, a build-error overlay, or a console/page error — render, not just compile), with one nav test per known route. It adds @playwright/test + the test:e2e scripts to package.json and never overwrites existing files. Ask to "add E2E / Playwright tests" for a runnable smoke net you can extend.
• REMEMBERS decisions across sessions using persistent Firestore memory.
• CHECKPOINTS code before every edit so you can roll back any change instantly.
• MULTI-STEP PLANS: breaks large tasks into named steps, shows live progress.
• SELF-REVIEWS edits with a focused pass to catch missing imports and logic bugs.`,
    howToUse: 'Engineer AI is retired — its app-building is now NavBharatAI Pro v5.0. Open "App Builder v5.0" from the sidebar (or the "NavBharatAI Pro v5.0" card under Professionals), describe what you want to build in any language, and watch the live preview as it builds. Use the Files, Preview, Diff and Terminal tabs to inspect the workspace.',
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
    name: 'Deploy to Firebase Hosting (NavBharatAI Pro v5.0)',
    path: 'NavBharatAI Pro v5.0 → "Publish" → host on NavBharatAI (Firebase Hosting)',
    description: 'Deploys the built app to a permanent public Firebase Hosting URL. YOUR TABLES ARE CREATED ON YOUR REAL DATABASE AT PUBLISH: the preview\'s database is temporary and disappears when the build ends, so a published app used to point at your own database with no tables in it — the page loaded and then every signup, order and booking failed. Now, right after publishing, NavBharatAI runs your app\'s own migrations (Prisma, Drizzle, Knex, TypeORM, Sequelize, Flyway or Alembic) against the database you connected, and tells you plainly whether it worked. Nothing is ever deleted: only forward-only “apply the pending changes” commands are allowed to touch a live database, anything else is refused rather than risked, and if the setup fails your app still stays published with an honest note that it cannot save data yet. (Engineer AI is retired — app building + deploy is now NavBharatAI Pro v5.0.) Works for static/SPA apps (React/Vite, Vue, Svelte, Next.js static export). Returns a live URL that survives sandbox restarts. For Node/Python backends, the live server preview is exposed directly. SEPARATE BACKEND — "Deploy it for me": if your app has a Node/Express backend that needs its own server, open Code Studio → Git/DevOps → Deploy, pick Render, and NavBharatAI adds the real render.yaml to your project AND can then trigger the deploy itself with a "Deploy it for me" button. It deploys into YOUR OWN Render account — save your RENDER_API_KEY in Settings → Secrets & API Keys (Render → Account Settings → API Keys) — so the app, the data and the bill all stay yours; NavBharatAI never hosts your backend on its own account. Two things stay with you because only you can do them: pushing the project to GitHub, and connecting the repo once in Render (Render → New → Blueprint — it already has render.yaml). If either is missing, NavBharatAI says exactly which one instead of failing vaguely, and a triggered deploy is reported honestly as "Render is building it now" rather than pretending the URL is already live. Cloud Run and Railway get the real config file added, but NavBharatAI cannot trigger those deploys yet and says so plainly rather than showing a button it cannot honour.',
    howToUse: 'FRONTEND: build an app in NavBharatAI Pro v5.0, then tap "Publish" in the action row and choose "host on NavBharatAI" (Firebase Hosting) — it builds and returns a permanent live URL. SEPARATE BACKEND (Render): 1) Settings → Secrets & API Keys → save RENDER_API_KEY (get it from Render → Account Settings → API Keys). 2) Code Studio → Git/DevOps → Deploy → choose Render → it adds render.yaml to your project. 3) Push the project to GitHub. 4) In Render → New → Blueprint, pick that repo (one time only). 5) Come back and tap "Deploy it for me" — NavBharatAI triggers the real deploy on your account and shows the URL.',
    relatedFeatures: ['engineer_ai', 'settings_database', 'settings_secrets'],
    aiSurface: 'engineer_ai',
    keywords: ['deploy', 'deployment', 'firebase hosting', 'live url', 'publish', 'hosting', 'public url', 'permanent link', 'render', 'backend deploy', 'deploy my backend', 'node server deploy', 'render api key', 'backend kaise deploy kare', 'separate backend', 'tables not created', 'database empty after publish', 'migrations', 'publish ke baad data save nahi', 'production database'],
  },
  {
    id: 'engineer_ai_github',
    name: 'GitHub Clone & Push (NavBharatAI Pro v5.0)',
    path: 'NavBharatAI Pro v5.0 → gear "Build options" → "Import Repo" (clone) / the "Push" toggle (push back) / "Ship to main"',
    description: 'Clone any GitHub repository into your workspace and push code back — now handled by NavBharatAI Pro v5.0 (Engineer AI is retired). Import a repo from the "Import Repo" dialog; publish your current app to a repo via the same dialog\'s Push toggle; and, for a repo you own, edit and "Ship to main" (CI-gated merge). Private repos use your connected GitHub or a GITHUB_TOKEN from Settings → App Settings → Secrets & API Keys.',
    howToUse: 'In NavBharatAI Pro v5.0, open the gear "Build options" → "Import Repo" to clone, use the Import/Push toggle to publish to a repo, or "Ship to main" to merge your own repo. Connect GitHub once, or store a GITHUB_TOKEN in Settings → App Settings → Secrets & API Keys for private repos.',
    relatedFeatures: ['engineer_ai', 'settings_secrets'],
    aiSurface: 'engineer_ai',
    keywords: ['github', 'clone', 'git push', 'repo', 'repository', 'version control', 'push code', 'github token'],
  },

  // ─── DOCTOR AI ───────────────────────────────────────────────────────────
  {
    id: 'doctor_ai',
    name: 'Doctor AI (Senior Doctor Assistant)',
    path: 'Header → Doctor AI tab  OR  Sidebar → Professionals → Doctor AI',
    description: 'Senior-doctor assistant AND mentor for qualified/junior/rural doctors. TWO modes: (1) PATIENT CASE — efficient high-yield history, red-flag screening, ranked differentials, investigation guidance, coded, unit-tested clinical calculators (CURB-65, CRB-65 [no-lab/PHC], qSOFA, GCS, Wells DVT/PE, CHA2DS2-VASc, eGFR/Cockcroft-Gault for renal drug dosing, anion gap, Killip class, Centor/McIsaac, paediatric maintenance fluids & weight-based dosing), an independent second-AI safety cross-check, and answers grounded in standard safety references with a clear "manage here vs refer NOW" decision. (2) GENERAL HELP — solves other junior-doctor queries: procedures/how-to, guidelines & protocols, drug information, documentation & medico-legal (discharge summary, referral letter, informed consent, certificates), communication (breaking bad news/SPIKES), exam/career guidance, and wellbeing/burnout support. IMPORTANT: decision-support only — assists, never replaces, the treating physician; medico-legal/career answers are general guidance to verify locally.',
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
    description: 'Patient expert PERSONAL teacher/tutor for Indian students and teachers. Takes a real introduction on first meeting (name, place, occupation, college, course, target exam, subjects, weak subjects) and — for signed-in users — remembers the student across sessions and devices, teaching them personally on every visit (extra care on weak subjects, examples pitched to their exam). Teaches concepts so they STICK (explain → example → analogy → check → explain-back/Feynman → memory hook → recap + practice + spaced revision), solves doubts step by step (Socratic), teaches ANY topic including out-of-syllabus, creates lesson plans, quizzes and exam study plans (boards, NEET, JEE, UPSC), in any Indian language. Grounded in standard pedagogy; a study aid — verify exam-specific syllabus from official sources.',
    howToUse: 'Open Sidebar → Professionals → Teacher AI. First time, introduce yourself (or just start asking — the teacher will get to know you); it remembers you when signed in. Ask anything: "explain X so I never forget", "solve this step by step", "make a study plan", "quiz me on Y".',
    relatedFeatures: ['professionals'],
    aiSurface: 'teacher_ai',
    keywords: ['teacher ai', 'tutor', 'study', 'lesson plan', 'exam prep', 'doubt', 'quiz', 'padhai', 'teacher', 'learn', 'personal teacher', 'remember', 'my teacher', 'weak subject', 'yaad', 'introduction', 'concept', 'never forget'],
  },

  // ─── MENTOR / CAREER COACH ───────────────────────────────────────────────
  {
    id: 'mentor_ai',
    name: 'Mentor / Career Coach',
    path: 'Sidebar → Professionals → Mentor / Career Coach',
    description: 'Personal career mentor & coach for Indian students and early-career professionals: takes an intake on first meeting (your stage, field, goal, skills, constraints) and — for signed-in users — REMEMBERS you across sessions to mentor you personally over time. Career-direction guidance, resume/CV review & drafting, interview prep (STAR), skill roadmaps, job-search/career-switch strategy, and higher-studies/study-abroad guidance. Honest and India-aware (campus placements, govt vs private vs startup, UPSC/CAT, study-abroad). General guidance — does not guarantee jobs/salaries/admissions.',
    howToUse: 'Open Sidebar → Professionals → Mentor / Career Coach and ask: "help me choose a career", "review my resume", "prep me for an interview", "make a skill roadmap". Introduce yourself once and it remembers your goal & progress (when signed in).',
    relatedFeatures: ['professionals'],
    aiSurface: 'mentor_ai',
    keywords: ['mentor', 'career', 'coach', 'resume', 'cv', 'interview', 'job', 'skill roadmap', 'career change', 'study abroad', 'naukri', 'remembers me', 'personal mentor', 'my goal'],
  },

  // ─── THESIS / RESEARCH WRITER ────────────────────────────────────────────
  {
    id: 'thesis_ai',
    name: 'Thesis / Research Writer',
    path: 'Sidebar → Professionals → Thesis / Research Writer',
    description: 'Personal academic research & writing assistant (UG/PG/PhD) — takes an intake (level, field, topic, citation style, stage, deadline) and, for signed-in users, REMEMBERS your project across sessions. Sharpen the research question (FINER/PICO), structure the thesis (IMRaD/chapters), organise a literature review, choose methodology, format citations (APA/MLA/IEEE/Chicago/Vancouver), and edit the author\'s own draft for clarity & academic tone. Academic integrity built-in: never fabricates citations/data, promotes original writing + proper attribution, and tells you to run an institutional plagiarism check.',
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
    description: 'Personal educational assistant for Indian taxation, accounting & business compliance: takes an intake on first meeting (taxpayer type, entity, turnover band, GST/regime, what you need) and — for signed-in users — REMEMBERS your context across sessions so answers fit your situation. Explains GST, income tax (old vs new regime), TDS/TCS, deductions (80C etc.), capital gains; helps understand a tax notice or ITR/GST form; bookkeeping (double-entry, P&L, balance sheet); business setup & compliance (proprietorship/LLP/Pvt Ltd, Udyam, ROC). NOT a substitute for a qualified CA — tax rates/slabs/dates change every Financial Year, so it always tells you to verify current figures (incometax.gov.in / gst.gov.in) and consult a CA; never asks for PAN/GSTIN/passwords.',
    howToUse: 'Open Sidebar → Professionals → CA / Tax & Accounts and ask: "old vs new tax regime", "how GST ITC works", "what is TDS / Form 26AS", "bookkeeping basics". Tell it your taxpayer/entity type once and it remembers (when signed in).',
    relatedFeatures: ['professionals'],
    aiSurface: 'accountant_ai',
    keywords: ['ca', 'tax', 'gst', 'income tax', 'itr', 'tds', 'accountant', 'bookkeeping', 'accounts', '80c', 'audit', 'compliance', 'msme', 'remembers me', 'my business'],
  },

  // ─── LAWYER / LEGAL ──────────────────────────────────────────────────────
  {
    id: 'lawyer_ai',
    name: 'Lawyer / Legal Assistant',
    path: 'Sidebar → Professionals → Lawyer / Legal',
    description: 'Personal legal-INFORMATION assistant for Indian law: takes an intake on first meeting (your state/jurisdiction, area of law, the matter, any deadline, desired outcome) and — for signed-in users — REMEMBERS your matter across sessions so it never re-asks. Explains rights & processes (consumer, tenancy, employment, contracts, cheque bounce, FIR, RTI), helps understand a notice/contract clause, drafts templates (legal notice, RTI, complaint, rent agreement, affidavit), and explains how to file an FIR/consumer complaint/RTI. NOT legal advice and NOT a lawyer-client relationship — Indian laws change & vary by state/forum (e.g. IPC→BNS), so it never cites a section/case as definitive and tells you to verify and consult an advocate; drafts must be lawyer-vetted. Reminds you not to share sensitive/privileged details.',
    howToUse: 'Open Sidebar → Professionals → Lawyer / Legal and ask: "explain my consumer rights", "draft a legal notice", "how to file an RTI", "explain this clause". Tell it your state & matter once and it remembers (when signed in).',
    relatedFeatures: ['professionals'],
    aiSurface: 'lawyer_ai',
    keywords: ['lawyer', 'legal', 'law', 'advocate', 'notice', 'rti', 'fir', 'consumer', 'contract', 'agreement', 'rights', 'kanoon', 'remembers me', 'my case'],
  },

  // ─── FINANCIAL ADVISOR ───────────────────────────────────────────────────
  {
    id: 'finance_ai',
    name: 'Financial Advisor',
    path: 'Sidebar → Professionals → Financial Advisor',
    description: 'Personal-finance EDUCATION assistant for India that knows YOUR situation: takes an intake on first meeting (life stage, money goals, income band, what you invest in, risk comfort, debts) and — for signed-in users — REMEMBERS it across sessions to tailor explanations. Budgeting & emergency fund, how SIP/mutual funds/index funds/PPF/EPF/NPS/FD work, risk vs return & diversification, insurance (term + health first), debt payoff, and goal-based planning. NOT investment advice and NOT a SEBI-registered adviser — never recommends specific stocks/funds, always notes market risk and "past performance ≠ future returns", and tells you to consult a SEBI-registered adviser (and a CA for tax); never asks for account numbers/passwords.',
    howToUse: 'Open Sidebar → Professionals → Financial Advisor and ask: "start a budget & emergency fund", "explain SIP & mutual funds", "term vs endowment insurance", "how to pay off loans". Tell it your goals & risk comfort once and it remembers (when signed in).',
    relatedFeatures: ['professionals', 'accountant_ai'],
    aiSurface: 'finance_ai',
    keywords: ['finance', 'financial', 'money', 'invest', 'sip', 'mutual fund', 'savings', 'budget', 'insurance', 'ppf', 'nps', 'retirement', 'paisa', 'nivesh', 'remembers me', 'my goals'],
  },

  // ─── ASTROLOGER ──────────────────────────────────────────────────────────
  {
    id: 'astrologer_ai',
    name: 'Astrologer',
    path: 'Sidebar → Professionals → Astrologer',
    description: 'Warm PERSONAL guide (remembers your rashi/birth details & interests when signed in) to Indian astrology (Jyotish/Vedic), horoscopes, numerology and palmistry — for CULTURAL interest & ENTERTAINMENT. Explains rashi/nakshatra/kundli/gun-milan and gives positive sign-based readings. Responsible by design: framed as belief/entertainment (not science or certainty), never uses fear, never pushes paid remedies/gemstones, emphasises free will, and redirects real health/money/legal/relationship decisions to the right professional.',
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
    description: 'Makes Indian government schemes (central & state) easy to understand — PERSONAL: remembers your profile (state, category like farmer/student/woman/senior) when signed in to surface schemes that fit you: find schemes by profile/need (farmer, student, woman, senior, entrepreneur, BPL), explain eligibility, benefits, documents and how to apply (official portal / CSC / local office). Anti-fraud built in: warns that real schemes never charge a fee or ask for OTP/PIN. Names/eligibility/amounts/portals change & vary by state — always verify on official portals (e.g. myscheme.gov.in) or at a CSC.',
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
    description: 'Practical PERSONAL farming advisor for Indian farmers — takes an intake (state/district, land size, crops, livestock, soil & irrigation, concerns) and, for signed-in users, REMEMBERS your farm to advise season on season. Crop & season choice (kharif/rabi/zaid), soil & fertiliser (Soil Health Card), pest/disease via Integrated Pest Management, irrigation & water-saving, post-harvest, and market/MSP/scheme awareness (PM-Kisan, KCC, eNAM, FPOs). Safety-first: confirm big decisions with the local KVK/agri officer & a soil test, follow pesticide labels (never banned chemicals), verify current MSP/scheme details officially; never promises yields/prices.',
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
    description: 'Personal nutrition & diet guide for Indian users: takes a first-consult intake (your goal, diet type, region, activity, allergies, any condition) and — for signed-in users — REMEMBERS you across sessions so plans stay tailored to you. Balanced Indian plate & portions, sustainable goal-based eating (weight loss/gain, muscle, maintenance) using common foods (roti, rice, dal, sabzi, curd, paneer, eggs, millets), veg/vegan protein sources, micronutrient awareness (iron/calcium/B12/vitamin-D), hydration & gut health, and cutting added sugar/salt/ultra-processed food. Safety-first: general nutrition EDUCATION only, not medical nutrition therapy; refers clinical conditions (diabetes, kidney, thyroid, pregnancy, allergies, eating disorders) to a registered dietitian/doctor; no crash diets, detox fads or fabricated calorie numbers.',
    howToUse: 'Open Sidebar → Professionals → Nutritionist / Diet AI and ask: "make a balanced veg meal plan", "healthy ways to lose weight", "best protein for vegetarians", "how do I cut down sugar & junk food". Tell it your goal & diet once and it remembers (when signed in).',
    relatedFeatures: ['professionals', 'sda_chat'],
    aiSurface: 'nutritionist_ai',
    keywords: ['nutrition', 'nutritionist', 'diet', 'food', 'meal plan', 'weight loss', 'weight gain', 'protein', 'calories', 'healthy eating', 'khana', 'diet plan', 'sugar', 'vegetarian', 'remembers me', 'personal diet', 'my goal'],
  },

  // ─── WELLNESS / COUNSELLOR AI ────────────────────────────────────────────
  {
    id: 'wellness_ai',
    name: 'Wellness / Counsellor AI',
    path: 'Sidebar → Professionals → Wellness / Counsellor',
    description: 'Warm, non-judgemental emotional-wellness companion that remembers you gently: recalls what you are called, what has been weighing on you, and what helps you — for signed-in users, across sessions (never a diagnosis, just caring continuity). Listens & validates feelings, shares general coping & self-care (grounding/breathing for anxiety, sleep & routine for low mood, CBT-style thought reframing, stress/exam/work/relationship support), and encourages real-world & professional help while reducing stigma. Safety-first: an AI companion, NOT a therapist, NO diagnosis, NO medication advice; on any crisis/self-harm it shares India helplines (Tele-MANAS 14416 / 1-800-891-4416, KIRAN 1800-599-0019, emergency 112) and steers to immediate human help; never fabricates helplines or clinical claims.',
    howToUse: 'Open Sidebar → Professionals → Wellness / Counsellor and share how you feel: "I am feeling stressed", "help me calm down from anxiety", "how do I deal with low mood", "when should I see a counsellor". For medical/clinical questions use Doctor AI or a professional.',
    relatedFeatures: ['professionals', 'sda_chat'],
    aiSurface: 'wellness_ai',
    keywords: ['wellness', 'counsellor', 'counselor', 'mental health', 'stress', 'anxiety', 'depression', 'sad', 'low mood', 'therapy', 'emotional', 'support', 'mann', 'tension', 'help', 'remembers me', 'someone who listens'],
  },

  // ─── FITNESS / PERSONAL TRAINER AI ───────────────────────────────────────
  {
    id: 'fitness_ai',
    name: 'Fitness / Personal Trainer AI',
    path: 'Sidebar → Professionals → Fitness / Personal Trainer',
    description: 'Encouraging personal-trainer & fitness coach that trains YOU specifically: takes an intake (your goal, level, home/gym, equipment, days/week, any injury) and — for signed-in users — REMEMBERS it across sessions so every plan fits you and trains around your injuries. Home/gym workout plans for goals (fat loss, muscle/strength, stamina, general fitness), exercise form & technique cues, warm-up/mobility/recovery & rest, cardio & steps, and habit/motivation help. Defers detailed diet to the Nutritionist AI. Safety-first: general fitness education, NOT medical/physiotherapy advice; advises medical clearance before a new programme (health condition, pregnancy, older, inactive), stop & see a doctor/physio for pain/injury; no crash regimes, overtraining, dehydration cutting, or anabolic/unproven supplements.',
    howToUse: 'Open Sidebar → Professionals → Fitness / Personal Trainer and ask: "beginner home workout plan", "plan to build muscle", "lose fat safely", "fix my squat form". Tell it your goal & equipment once and it remembers (when signed in). For diet specifics use Nutritionist AI; for pain/injury see a doctor/physio.',
    relatedFeatures: ['professionals', 'nutritionist_ai', 'sda_chat'],
    aiSurface: 'fitness_ai',
    keywords: ['fitness', 'workout', 'exercise', 'gym', 'trainer', 'muscle', 'strength', 'fat loss', 'cardio', 'home workout', 'training', 'kasrat', 'vyayam', 'bodyweight', 'remembers me', 'personal trainer', 'my plan'],
  },

  // ─── VETERINARY / PASHU ADVISOR AI ───────────────────────────────────────
  {
    id: 'vet_ai',
    name: 'Veterinary / Pashu Advisor AI',
    path: 'Sidebar → Professionals → Veterinary / Pashu Advisor',
    description: 'Practical PERSONAL animal-care advisor for Indian livestock farmers & pet owners — takes an intake (animals & counts, purpose, region, concerns) and, for signed-in users, REMEMBERS your animals. Livestock husbandry (cattle, buffalo, goat, poultry — housing, feeding, milking hygiene, breeding basics, productivity), pet care (dogs, cats — feeding, grooming, exercise, training basics), prevention/biosecurity & vaccination/deworming AWARENESS, and recognising warning signs. Safety-first: NOT a veterinarian, NO diagnosis or prescription/doses; refers sick/injured animals to a licensed vet, takes bites/rabies & zoonoses (brucellosis, bird flu) seriously with urgent medical/vet care; no banned substances or growth hormones; never fabricates vaccines/doses/schedules.',
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
    description: 'Warm, personal parenting & child-development companion that knows YOUR family: takes an intake (your children\'s names & ages, any special notes, your concerns) and — for signed-in users — REMEMBERS it so guidance stays age-appropriate for each child. Development & milestones (as ranges), daily care & routines (sleep, toilet training, screen-time balance, study habits), positive discipline & tantrums/sibling conflict, emotional connection & teens, and home/online safety awareness. Safety-first: general parenting guidance, NOT medical advice; routes illness/fever/vaccination/growth & developmental worries to a paediatrician/Doctor AI and nutrition to the Nutritionist AI; never prescribes medicines/doses for children; rejects harsh/physical punishment; urges professional help for red flags (serious illness, possible delay, teen self-harm, abuse).',
    howToUse: 'Open Sidebar → Professionals → Parenting / Child-Care and ask: "is my child meeting milestones", "handle tantrums calmly", "build a bedtime routine", "support my teen during exams". For illness/medical concerns see a paediatrician/Doctor AI.',
    relatedFeatures: ['professionals', 'nutritionist_ai', 'wellness_ai', 'sda_chat'],
    aiSurface: 'parenting_ai',
    keywords: ['parenting', 'parent', 'child', 'baby', 'toddler', 'kids', 'child care', 'milestone', 'tantrum', 'discipline', 'teen', 'bachcha', 'parvarish', 'newborn', 'remembers my child', 'personal'],
  },

  // ─── CYBER SAFETY / DIGITAL SURAKSHA AI ──────────────────────────────────
  {
    id: 'cybersafety_ai',
    name: 'Cyber Safety / Digital Suraksha AI',
    path: 'Sidebar → Professionals → Cyber Safety / Digital Suraksha',
    description: 'Practical PERSONAL digital-safety guide (remembers your tech comfort & who you\'re protecting when signed in) for everyday Indian users: recognising scams (UPI/OTP fraud, fake KYC/bank/electricity calls, "digital arrest"/police-impersonation, lottery/job/loan-app fraud, phishing, fake customer-care, QR-receive tricks, SIM-swap, sextortion), prevention (strong passwords, 2FA, safe UPI habits, device/SIM/privacy hygiene), victim recovery steps, and reporting via helpline 1930 & cybercrime.gov.in. Safety-first: NEVER asks for passwords/OTP/UPI PIN/card details and tells users no genuine party will; strictly DEFENSIVE (refuses to help hack/stalk/defraud); never fabricates helplines/laws or promises guaranteed recovery; urges calling 1930/the bank immediately for active fraud.',
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
    description: 'Honest PERSONAL insurance educator for Indian users — takes an intake (age & dependents, existing cover, what you want to plan) and, for signed-in users, REMEMBERS your situation to tailor explanations. Types of cover (term life, health/mediclaim & top-up, motor third-party vs comprehensive, personal accident, home, travel, PMFBY crop), choosing adequate cover, why term beats investment-linked plans for protection, policy terms (sum insured, deductible/co-pay, waiting periods, exclusions, no-claim bonus, free-look, portability), how claims work and why they get rejected, and avoiding mis-selling/fraud (verify on IRDAI, use free-look). Safety-first: general education, NOT personalised advice or a product recommendation; never pushes a product/commission; insists on truthful disclosure when buying (top cause of claim rejection); says terms/premiums change — verify wording and consult a licensed IRDAI advisor; never fabricates premiums/clauses.',
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
    description: 'Friendly PERSONAL home-cooking companion (remembers your diet, cuisines, skill & dislikes when signed in) for Indian kitchens: step-by-step recipes (regional Indian & world, veg/non-veg, street food & festive), cook-with-what-you-have suggestions & substitutions, technique (tadka, spice balance, gravy/dough/rice basics), fixing dishes (too salty/spicy/watery), quick/tiffin/budget/batch meals & leftovers, and adapting dishes (lighter, vegan, Jain no onion-garlic, milder/spicier). Safety-first: general cooking guidance, flags common allergens & safe food handling, defers medical/therapeutic diets to the Nutritionist AI; quantities/times are approximate (taste & adjust); no miracle health claims.',
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
    description: 'Practical PERSONAL trip-planning companion (remembers your home city, travel style & interests when signed in) for Indian travellers (domestic & international): day-by-day itineraries by duration/interests/season, budget breakdowns & money-saving tips, logistics (trains/IRCTC, flights, buses, local transport) & packing lists, international travel awareness (visa types, passport validity, travel insurance, currency, connectivity, etiquette), and safety/season/responsible-travel tips. Safety-first: general guidance NOT live booking data; fares/schedules/visa rules change — verify on official airline/railway/government/embassy sources; never asks for passport/card/OTP details, never books/pays; warns about travel scams; never fabricates live prices, exact visa fees, or guaranteed availability.',
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
    description: 'Respectful PERSONAL guide (remembers your space type & facing when signed in) to Vastu Shastra (traditional Indian architecture/spatial arrangement): directions (the eight dishas) and suggested placement of entrance, kitchen, bedroom, pooja room, study, toilets, water & staircase; practical harmony framed as natural light, ventilation & de-cluttering; and gentle, no-cost remedies for spaces that can’t change. Safety-first: explicitly cultural/traditional belief, NOT science — no guarantees, NO fear-mongering, NO paid yantras/expensive remedies/demolition; real-world priorities (safety, building bye-laws, structural soundness, budget) and a licensed architect/engineer come first; inclusive of those who don’t follow Vastu; never fabricates rules.',
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
    description: 'Calm PERSONAL guide (remembers your level, goals & any injuries when signed in) to yoga, pranayama & meditation: beginner asana sequences & SuryaNamaskar with alignment cues and easier variations, gentle breathwork (deep breathing, Anulom Vilom, Bhramari), meditation/mindfulness/mantra for focus-calm-sleep, and short routines for stress/energy/desk relief. Safety-first: general practice guidance, NOT medical/therapeutic advice; advises doctor clearance for health conditions/pregnancy/elderly/injury and learning advanced asana/pranayama from a qualified teacher; never push through pain; avoids risky inversions for beginners; makes no medical-cure claims. Routes nutrition to Nutritionist AI and emotional crises to Wellness AI.',
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
    description: 'Patient PERSONAL spoken-English & language coach for Indian learners (beginner to advanced): takes an intake (your level, first language, goal, what you struggle with) and — for signed-in users — REMEMBERS you so practice targets your weak areas over time. Conversation practice & fluency building, gentle grammar & vocabulary correction with reasons, writing help (emails/applications/essays in the learner’s own voice), interview & workplace English with mock interviews, and IELTS/TOEFL-style exam practice & strategies. Encouraging, never shames mistakes; meets learners at their level (uses a Hindi/regional word when it helps). Honesty: a tutor not an exam authority — verify official exam formats/rules with the exam body; no fake "fluent fast" claims or fabricated scores; constructive, accurate feedback (won’t approve wrong English to be nice).',
    howToUse: 'Open Sidebar → Professionals → Spoken English / Tutor and ask: "let’s practise a conversation", "correct my sentences and explain", "help me write a formal email", "run a mock interview". For official exam rules check the exam body’s website.',
    relatedFeatures: ['professionals', 'teacher_ai', 'mentor_ai'],
    aiSurface: 'english_ai',
    keywords: ['english', 'spoken english', 'grammar', 'vocabulary', 'fluency', 'language', 'tutor', 'ielts', 'toefl', 'interview english', 'angrezi', 'speaking', 'writing', 'translate', 'remembers me', 'personal tutor'],
  },

  // ─── RESUME & JOB-APPLICATION AI ─────────────────────────────────────────
  {
    id: 'resume_ai',
    name: 'Resume & Job-Application AI',
    path: 'Sidebar → Professionals → Resume & Job Application',
    description: 'Personal career-documents specialist for Indian job seekers (freshers to experienced) — takes an intake (experience, field, target role, skills, achievements, education) and, for signed-in users, REMEMBERS your profile so it never re-asks. Resume/CV structure & strong achievement bullet points (action verb + measurable impact), ATS-friendly formatting & keyword matching, tailored cover letters & application emails, LinkedIn headline/About, and application strategy (reading a JD, transferable skills, gaps). Works on the user’s OWN real content. Safety-first: NEVER fabricates qualifications/experience/dates/numbers (lying risks the job); helps phrase gaps/career-changes honestly; does not guarantee interviews/jobs/salaries; warns about job scams (no genuine employer asks for money/OTP/bank details — see Cyber Safety AI); follow each employer’s official instructions.',
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
    description: 'Friendly PERSONAL home-gardening & houseplant companion (remembers your space, climate & plants when signed in) for Indian plant lovers (balcony, terrace, kitchen garden, indoor): plant care (watering, light, soil/potting mix, repotting) for common Indian houseplants, kitchen gardens (herbs & veggies in pots by season), diagnosing problems (yellow leaves, drooping, leaf spots, pests like mealybugs/aphids) with organic-first fixes, and soil/compost/feeding. Defers commercial farming to the Kisan AI. Safety-first: general guidance (needs vary by variety/climate — observe & confirm with a nursery); prefers organic/least-toxic methods, label safety for any chemical away from kids/pets/edibles; flags toxic houseplants & washing home-grown edibles; never fabricates species/doses/guaranteed results.',
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
    description: 'Careful PERSONAL medicine-INFORMATION assistant (remembers light non-clinical context like an allergy you mention when signed in — never a diagnosis) for Indian users: explains a medicine’s general purpose/class, safe-use practices (reading the label/leaflet, finishing antibiotic courses, storage, expiry, not sharing prescription meds), side-effect & interaction awareness, generic vs brand & Jan Aushadhi, and responsible antibiotic use/resistance. Safety-first (HEALTH): explicitly NOT a doctor/dispensing pharmacist; NEVER diagnoses, prescribes, gives a dose, or tells anyone to start/stop/combine a medicine — redirects every personal question to a doctor/registered pharmacist; flags emergencies/overdose to call 112; special caution for pregnancy/children/elderly; never fabricates drug names/doses/interactions; discourages buying prescription (Schedule H) meds without a prescription. May point to Doctor AI for clinical questions (also not a substitute for an in-person doctor).',
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
    description: 'Practical PERSONAL small-business & startup mentor for Indian entrepreneurs (kirana to tech) — takes an intake (stage, sector, location, scale, goals) and, for signed-in users, REMEMBERS your venture to mentor it over time. Idea refinement & cheap validation + lean one-page plan, starting-up awareness (proprietorship/LLP/Pvt Ltd, Udyam/MSME, GST basics, separate business account), pricing/margins/break-even & cash-flow discipline, low-cost marketing (Google Business Profile, WhatsApp Business, social, word-of-mouth) & retention, growth/operations, and funding awareness (bootstrapping, bank/MSME/MUDRA loans, schemes, realistic VC view). Safety-first: general guidance NOT legal/tax/accounting/investment advice — routes tax/GST to CA AI, incorporation/contracts to a lawyer/CS, scheme specifics to Govt Schemes Helper; realistic (no guaranteed-profit/get-rich hype); warns about pay-to-join/MLM & fake investor/loan scams (Cyber Safety AI); never fabricates fees/thresholds/amounts.',
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
    description: 'Practical PERSONAL home-maintenance helper (remembers your home type, DIY comfort & recurring issues when signed in) for Indian households: simple SAFE DIY fixes (dripping tap washer, blocked drain, running flush, tripped MCB reset, loose handle/hinge, bulb/tubelight), diagnosing a problem so you can describe it to a technician (and avoid overcharging), and preventive maintenance (RO filters, AC service, monsoon/seepage prep, tools). Safety-first (can be lethal): NOT a licensed electrician/plumber/gas technician — always switch off power/water first; never guides live-wire/rewiring/switchboard work or gas pipe/regulator DIY; for sparking/burning smell → mains off + licensed electrician; gas smell → no switches/flames, turn regulator off, ventilate, leave, call the gas agency; flags water+electricity/height/structural jobs to a pro; never fabricates wiring colours/ratings/steps; emergencies → 112.',
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
    description: 'Honest PERSONAL property guide for Indian buyers, sellers, tenants & landlords — takes an intake (role, city, property type, budget, stage) and, for signed-in users, REMEMBERS your requirement so it never re-asks. Buy vs rent (realistic, no hype), buying due diligence (clear/marketable title, encumbrance certificate, approved plan & occupancy/completion certificate, RERA registration, builder track record, lawyer vetting), home-loan basics (eligibility, down payment, EMI, fixed vs floating, full cost of ownership), renting (agreements, deposit, registration, tenant/landlord rights basics), stamp duty/registration/brokerage awareness, and fraud avoidance. Safety-first: general education NOT legal/financial/tax/valuation advice — routes tax to CA AI, loan/budget to Finance AI, legal to Lawyer AI; verify title/documents with a property lawyer and project status on the state RERA portal; stamp duty/rules vary by state & change; no guaranteed returns; warns about advance-fee/fake-listing scams (Cyber Safety AI); never fabricates prices/rates/thresholds.',
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
    description: 'Practical PERSONAL guide (remembers your state/RTO, vehicle type & stage when signed in) to driving, road safety & RTO/vehicle paperwork for Indian users: Learner & Driving Licence process (eligibility, documents, LL/driving tests, renewal via Parivahan/Sarathi), vehicle documents (RC, third-party insurance, PUC, road tax, fitness, what to carry), road rules & safety (helmet/seatbelt, speed, signs, no drink-driving/phone, defensive driving), beginner learning guidance, and e-challans. Safety-first: general INFORMATION not official confirmation — rules/fees/age limits vary by state & change, so verify & apply on the official Parivahan/state RTO portal; promotes lawful safe driving; discourages touts/bribes (licence "without a test" is illegal/unsafe); warns about fake RTO/challan sites & OTP scams (Cyber Safety AI); never fabricates fees/rules; never helps get a licence dishonestly or evade penalties.',
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
    description: 'Friendly positive companion for Indian pet parents (mainly dogs & cats) that knows YOUR pet: takes an intake (each pet\'s name, breed & age, your training goals, behaviour context) and — for signed-in users — REMEMBERS it so advice fits your animal and tracks progress. Reward-based training (basic commands, house/potty & crate training, leash manners, stopping jumping/pulling/barking), behaviour understanding & humane fixes (fear/boredom/anxiety/socialisation, stress & aggression signals), daily care (exercise, enrichment, grooming, dental/nail basics, hot-climate paw/hydration safety), general feeding & foods toxic to pets to avoid, new-pet/puppy & socialisation, and responsible community-animal guidance. Safety-first: NOT veterinary advice — routes illness/injury/vaccines/parasites/sudden behaviour change to a vet (Veterinary / Pashu Advisor AI for awareness; real diagnosis needs an in-person vet); never gives medicine names/doses; uses ONLY humane positive reinforcement (never hitting/choke/shock/prong collars/fear/punishment); takes bites/rabies seriously (urgent medical care); never fabricates breed facts/training guarantees/medical claims.',
    howToUse: 'Open Sidebar → Professionals → Pet-Care / Dog-Training and ask: "potty-train my puppy", "my dog barks/chews too much", "teach basic commands with rewards", "foods unsafe for my pet". For health issues see a vet (or the Veterinary / Pashu Advisor AI for awareness).',
    relatedFeatures: ['professionals', 'vet_ai'],
    aiSurface: 'petcare_ai',
    keywords: ['pet', 'dog', 'cat', 'puppy', 'kitten', 'training', 'dog training', 'behaviour', 'barking', 'potty training', 'kutta', 'billi', 'leash', 'pet care', 'grooming', 'remembers my pet', 'my dog'],
  },

  // ─── BEAUTY / SKINCARE & GROOMING AI ─────────────────────────────────────
  {
    id: 'beauty_ai',
    name: 'Beauty / Skincare & Grooming AI',
    path: 'Sidebar → Professionals → Beauty / Skincare & Grooming',
    description: 'Sensible PERSONAL guide (remembers your skin/hair type & concerns when signed in) to skincare, haircare & everyday grooming for all genders: simple routine (cleanse, moisturise, daily SPF sunscreen), skin types & ingredient education (niacinamide, salicylic/glycolic acid, retinoids basics, vitamin C), common concerns (oiliness, dryness, dullness, mild acne/blackheads, tan), haircare & dandruff, shaving/beard & nail/body grooming, and smart habits (patch-testing, one product at a time, not over-exfoliating). Safety-first: general cosmetic guidance NOT medical advice — routes acne-that-scars/persistent rashes/sudden hair loss/severe pigmentation/allergic reactions to a dermatologist; rejects fairness/whitening promises & steroid-cream misuse and risky DIY hacks (lemon/toothpaste/peels); body-positive (healthy not "fair"); never fabricates ingredient/miracle claims; results take time & vary.',
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
    description: 'Encouraging PERSONAL music teacher (remembers your instrument, level, style & goal when signed in) for Indian learners of all levels & styles (Indian classical, film/devotional, Western): starting instruments (guitar, keyboard/piano, harmonium, tabla, flute, ukulele — posture, first chords/notes/bols, tuning), vocals & riyaaz (warm-ups, breathing, sur/pitch), music theory (notes, scales, chords, rhythm/taal, sargam/swaras, basic notation), Indian classical concepts (raga/taal/sargam), and structured practice routines & ear training. Honesty/safety: real skill needs consistent practice (no "master it in a week"); recommends a qualified guru/teacher for serious classical/advanced technique; warns against vocal strain/playing through pain; respects copyright (helps learn, no wholesale reproduction of copyrighted lyrics/sheet music); never fabricates theory or official exam (Trinity/ABRSM/Prayag Sangit) rules — confirm with the official body.',
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
    description: 'Encouraging PERSONAL sports coach (remembers your sport, level, position & goal when signed in) with cricket depth (batting: stance/grip/footwork/shot selection/playing spin & pace; bowling: run-up/action/line & length/spin & seam; fielding/keeping; strategy) plus general coaching for football, badminton, kabaddi, athletics & more — technique, structured & solo/at-home drills, sport-specific conditioning (agility/speed/stamina/strength/flexibility, warm-up/cool-down), and mindset (pressure, focus, consistency). Safety-first: coaching guidance NOT medical/physio advice — always warm up & use protective gear, never play through sharp pain (rest + doctor/physio), age-appropriate workloads (e.g. limit young fast-bowling overs), learn high-load techniques under a qualified coach; routes gym/strength to Fitness AI and diet to Nutritionist AI; realistic (no "become a pro fast"); never fabricates official rules/records/selection — confirm with the association.',
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
    description: 'Practical PERSONAL mentor (remembers your gear, level & interests when signed in) for Indian photographers & videographers (phone & camera, hobby to pro): camera/phone basics (exposure triangle — aperture/shutter/ISO, focus, white balance, lenses, smartphone pro mode), composition & light (rule of thirds, leading lines, framing, golden hour), genres (portrait, landscape/travel, events/weddings, product/food, street), video & reels (stability, framing, audio, lighting, shot types), editing workflow (Lightroom/Snapseed; natural look), and gear/going-pro (budget buying, portfolio, pricing, client comms, backups). Honesty/safety: skill grows with practice (gear alone doesn’t make great photos); settings are scene-dependent starting points; respect privacy/consent (candid/street/children), no-photography areas, copyright, and personal safety while shooting; client work needs permissions/contracts (Lawyer AI) & backups; never fabricates specs/prices or guarantees income.',
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
    description: 'Supportive PERSONAL coach for confident, clear communication in any language: takes an intake (your context, what you want to improve, any upcoming event, your biggest challenge) and — for signed-in users — REMEMBERS you to coach your specific challenges over time. Overcoming stage fright/nervousness (preparation, breathing, reframing, practice), structuring speeches/presentations (hook → key points → strong close, storytelling, simple slides), delivery (voice pace/pauses/clarity, body language, reducing filler words, audience engagement), everyday communication (speaking up in meetings/GDs, introductions, assertive-but-polite, active listening), and specific situations (interview/pitch delivery, impromptu, debates). Honesty/limits: coaching not overnight fix — confidence comes from preparation & practice; gives kind specific feedback on the user’s OWN voice; never fabricates facts/quotes/stats for a speech; routes language/grammar to Spoken English / Tutor AI, interview content/resume to Resume AI, and severe disabling speech anxiety/disorder (significant stammering) to a professional (speech therapist/counsellor).',
    howToUse: 'Open Sidebar → Professionals → Public Speaking & Communication and ask: "overcome stage fright", "structure a 5-minute speech", "improve my voice & body language", "speak up confidently in meetings/GDs". For grammar use English Tutor AI; for resume/interview content use Resume AI.',
    relatedFeatures: ['professionals', 'english_ai', 'resume_ai', 'mentor_ai'],
    aiSurface: 'speaking_ai',
    keywords: ['public speaking', 'speech', 'communication', 'presentation', 'stage fright', 'confidence', 'gd', 'group discussion', 'speaking', 'bolna', 'aatmvishwas', 'interview', 'voice', 'debate', 'remembers me', 'personal coach'],
  },

  // ─── EVENT & WEDDING PLANNER AI ──────────────────────────────────────────
  {
    id: 'events_ai',
    name: 'Event & Wedding Planner AI',
    path: 'Sidebar → Professionals → Event & Wedding Planner',
    description: 'Practical, calming PERSONAL planner (remembers your event, date, budget & guest count when signed in) for Indian weddings, parties & functions (engagements, birthdays, anniversaries, poojas, corporate/community): step-by-step plans & timelines (months-ahead to day-of schedule) and checklists, realistic budgeting & spend tracking, Indian-wedding functions awareness (haldi/mehndi/sangeet/baraat/pheras/reception — general, customs vary by community/religion), vendor selection & coordination (venue, caterer, decor, photographer→Photography AI; quotes, written terms), and guests/logistics/themes. Safety-first: planning guidance NOT legal/financial/contractual advice — routes contracts/disputes to Lawyer AI and big budget decisions to Finance AI; get vendor terms/deliverables/refund policy in writing & pay via traceable channels; warns about advance-fee/fake-vendor scams (Cyber Safety AI); minds crowd/fire/food safety & local permissions; inclusive & respectful of all communities (asks, never assumes); never fabricates vendor prices or guarantees outcomes.',
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
    description: 'Warm, respectful companion for Indian families caring for elderly relatives (and seniors themselves) that remembers YOUR situation: takes a gentle intake (who is being cared for and their rough age, care/mobility level, living setup, your concerns — non-clinical) and — for signed-in users — REMEMBERS it across sessions. Daily care & routine (nutrition→Nutritionist AI, hydration, sleep, hygiene, safe activity), home safety & fall prevention (lighting, grab bars, emergency plan), emotional wellbeing & loneliness (connection, hobbies, watching for depression), medication ORGANISATION only (pill organisers, reminders, up-to-date list — never what/how-much), caregiver support (avoiding burnout, sharing responsibilities, when to get an attendant/day-care/professional care), and senior finance/schemes (→ Govt Schemes Helper) & scam protection (→ Cyber Safety AI). Safety-first (vulnerable people): care/wellbeing guidance NOT medical advice — for illness, falls with injury, confusion, chest pain/breathing trouble, stroke (FAST) or any emergency seek medical help immediately/call 112; never gives medicine names/doses; watches for red flags (sudden confusion, self-neglect, abuse); respects the elder’s dignity, autonomy & consent; never fabricates medical/scheme facts.',
    howToUse: 'Open Sidebar → Professionals → Elder-Care / Senior Support and ask: "make the home safer to prevent falls", "a gentle daily routine for my parent", "help with loneliness & low mood", "avoid caregiver burnout". For health concerns see a doctor / Doctor AI; emergencies → 112.',
    relatedFeatures: ['professionals', 'sda_chat', 'nutritionist_ai', 'wellness_ai', 'govt_schemes_ai'],
    aiSurface: 'eldercare_ai',
    keywords: ['elder care', 'elderly', 'senior', 'old age', 'parents', 'caregiver', 'budhe', 'maa baap', 'fall prevention', 'dementia', 'loneliness', 'pension', 'buzurg', 'care', 'remembers', 'personal'],
  },

  // ─── INTERIOR DESIGN & HOME-DECOR AI ─────────────────────────────────────
  {
    id: 'interior_ai',
    name: 'Interior Design & Home-Decor AI',
    path: 'Sidebar → Professionals → Interior Design & Home-Decor',
    description: 'Practical, creative PERSONAL guide (remembers your space, style & budget when signed in) to decorating & organising Indian homes on any budget (rented or owned, small flats to houses): space planning (furniture flow, making small/rented spaces feel bigger, multi-use zoning), colour & lighting (palettes, accent walls, layered light & mood), affordable decor & DIY (cushions/curtains/rugs/plants→Gardening AI/art/lighting, upcycling), storage & decluttering, and room-by-room ideas (living, bedroom, kitchen, study/WFH, kids, balcony, pooja space). Safety-first: decor/design IDEAS NOT structural/electrical/architectural advice — walls/load-bearing/false ceilings/electrical/plumbing need a qualified architect/engineer/licensed tradesperson (Home Repair AI for safe DIY; never DIY electrical/gas/structural); rented homes → reversible, landlord-friendly changes (check the agreement); Vastu placement → Vastu AI; taste is personal (options not rules); never fabricates prices/brand claims or guarantees outcomes.',
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
    description: 'Honest PERSONAL guide for Indian students planning higher education abroad or in India — takes an intake (qualification, course, target countries, exams, budget, timeline) and, for signed-in users, REMEMBERS your plan across sessions. Course/country/university choice (fit over rankings; US/UK/Canada/Australia/Germany & strong Indian options), exams (IELTS/TOEFL/PTE, GRE/GMAT, SAT — which & prep strategy), applications (timelines, shortlisting, SOP/personal statement & LOR guidance on the student’s OWN writing, CV→Resume AI), scholarships & funding (finding awards, education-loan basics→Finance AI, total cost & budgeting, Indian schemes→Govt Schemes Helper), and general student-visa awareness. Safety-first: general guidance NOT official admissions/immigration advice — deadlines/fees/eligibility/visa & post-study-work rules change & vary, always verify on official university & government/embassy sites before deciding/paying; never writes a fake SOP or fabricates experiences/grades (misrepresentation → rejection/revocation); warns about dishonest agents & "guaranteed admission/visa"/pay-for-seat scams (Cyber Safety AI), prefers official channels; realistic (no admission/visa/job guarantees); never fabricates fees/scholarship amounts/rankings/visa rules.',
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
    description: 'Respectful, empowering PERSONAL companion (remembers your support needs & state when signed in, with dignity) for persons with disabilities (PwD) in India & their families/caregivers: rights & entitlements awareness (RPwD Act 2016 concepts — dignity, non-discrimination, reasonable accommodation, reservation; UDID/disability certificate), schemes & benefits (scholarships, pensions, ADIP aids/appliances, travel/tax concessions — specifics→Govt Schemes Helper & official portals), assistive technology & accessibility (screen readers, captions, hearing/mobility aids, AAC, built-in phone/computer accessibility), daily living & inclusion (independence, accessible education/workplace accommodations as rights), and caregiver/emotional support (NGOs, peer communities, Wellness AI). Safety-first: general information & support NOT medical/legal/official advice — medical/therapy→doctor/specialist, legal→Lawyer AI, schemes→Govt Schemes Helper, verify on official sources (rules vary by state & change); respectful person-centred language ("nothing about us without us"), inclusive of all disabilities; warns about bribe/OTP scams around certificates/benefits (Cyber Safety AI); never fabricates laws/scheme amounts/eligibility/medical claims; emergencies→112, distress→Wellness AI.',
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
    description: 'Friendly, body-positive PERSONAL stylist (remembers your style, occasions & budget when signed in) for all genders, body types & budgets: outfit & occasion dressing (office/interview, wedding/festival, casual, date, travel — Indian/Western/fusion), versatile capsule-wardrobe building & smart budget shopping, fit/colour/body-type guidance (flattering without shaming), ethnic wear & draping (saree/kurta/lehenga/sherwani/suit + accessories), accessories & layering, and confidence/sustainability (personal style over trends, clothing care, thrifting). Honesty/safety: styling ideas — taste is personal (options not rules, no guaranteed results); body-positive & inclusive (never body-shames or pushes "fairness"/unrealistic ideals; respects culture/religion/modesty & budget, no pushing expensive brands); routes skincare/hair to Beauty AI and online-shopping scams to Cyber Safety AI; never fabricates brand prices/"rules"-as-facts.',
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
    description: 'Practical, motivating PERSONAL coach (remembers your context, struggles & goals when signed in) to get more done with less stress (students, professionals, anyone): planning & prioritising (daily/weekly plans, Eisenhower urgent/important, top 1–3 tasks, SMART goals, breaking goals into steps), focus & deep work (beating phone/social distraction, time-blocking, Pomodoro, single-tasking, focus environment), beating procrastination (understanding the emotional cause, 2-minute rule, smallest next step, reducing friction), habits & routines (cue-routine-reward, habit stacking, tracking, morning/evening routines), study/work scheduling, and balance/energy (rest, sleep, avoiding overcommitment). Honesty/limits: no magic hacks (consistency + a few habits beat any app); never shames missed plans; promotes balance & wellbeing, not hustle/burnout; for burnout or anxiety-driven chronic procrastination points to rest & the Wellness AI/a counsellor (doesn’t diagnose); adapts to the person’s real health, energy & responsibilities.',
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
    description: 'Warm, balanced, non-judgemental PERSONAL companion (gently remembers your situation when signed in, never a diagnosis) for navigating relationships (partner/marriage, family & in-laws, friends, workplace): communication (expressing needs with "I" statements, active listening, calm conflict resolution & de-escalation), understanding & empathy (perspective-taking, managing expectations, rebuilding trust, healthy boundaries), common situations (couple friction, family pressure, long-distance, workplace tension), what healthy vs unhealthy/abusive patterns look like, and self-reflection. Safety-first (sensitive): general support & perspective (hears only one side) NOT therapy/counselling/legal/medical advice — routes ongoing distress/therapy to a counsellor & the Wellness AI, legal (divorce/custody/dowry/DV law) to the Lawyer AI; on any abuse/violence/danger prioritises safety with India helplines (Women Helpline 181, Police 112, Tele-MANAS 14416), never tells anyone to "tolerate" abuse and never blames the victim; stays neutral (no taking sides/revenge/controlling behaviour), respects culture/values/autonomy & all genders/relationships; never fabricates psychology claims or guarantees outcomes.',
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
    description: 'Practical PERSONAL guide (remembers your vehicle, fuel & usage when signed in) to keeping cars & two-wheelers running well in India: routine maintenance & service (oil/filters, coolant, brake fluid, tyres, battery, bike chain, seasonal/monsoon care — manual for exact intervals), simple SAFE owner checks (tyre pressure, oil/coolant level, lights, wipers, pre-trip), symptom understanding (warning lights, noises/vibration, hard starting, overheating, poor mileage, brake feel) to describe to a mechanic & avoid overcharging, fuel-efficiency & vehicle-life habits, and service-centre/used-vehicle sense. Safety-first (road safety): general guidance NOT a repair manual/certified-mechanic advice — safety-critical systems (brakes, steering, airbags, fuel, engine internals, EV high-voltage) must go to a qualified mechanic, never DIY; if a symptom is dangerous (brake failure, smoke/fire, fuel smell, red warning light, overheating) stop safely & get help, don’t keep driving; follow the owner’s manual for exact specs (never fabricates specs/capacities/torque). For licence/RC/insurance/PUC paperwork, the Driving / RTO AI.',
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
    description: 'Honest PERSONAL EDUCATOR about the Indian stock market & investing concepts — takes an intake (knowledge level, what you want to understand, learning goal) and, for signed-in users, REMEMBERS you to teach at your level (never tips/calls). Basics (shares, Sensex/Nifty, NSE/BSE, demat & trading accounts, how buying/selling works), instruments (stocks, mutual funds/index funds/ETFs, SIP, bonds, gold — differences in risk/return/liquidity), key concepts (risk vs return, diversification, compounding, long vs short term, volatility, asset allocation, P/E, NAV), risk & behaviour (you can lose money, dangers of F&O/intraday/leverage, avoiding panic/greed), and using only SEBI-registered intermediaries. Safety-first (money): EDUCATION ONLY — never recommends a specific stock/fund, gives no buy/sell/hold calls, never predicts prices/returns or calls something a "good investment for you" (personal advice → SEBI-registered investment adviser); honest that investments carry market risk & past performance ≠ future returns, no guaranteed high returns; strongly warns against tips/"guaranteed return" schemes, pump-and-dump, fake advisers, Telegram/WhatsApp tip groups, Ponzi/MLM & fixed-daily-profit apps (Cyber Safety AI); never fabricates prices/figures/fund names/returns. For budgeting use Finance AI, for tax the CA AI.',
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
    description: 'Patient PERSONAL tech-support helper in simple language for everyday users (non-techies, students, seniors) — takes an intake (tech comfort, your devices, recurring issues) and, for signed-in users, REMEMBERS you to pitch help at your level. Troubleshooting phones/laptops (slow/hanging, storage full, battery drain, app crashes, won\'t power/charge, overheating, sound/screen — plain step-by-step), Wi-Fi/internet fixes (router restart, mobile data/hotspot, network checks), accounts & apps (Google/Apple/email, passwords & 2FA, backups to Drive/iCloud, official account recovery), settings & digital literacy (accessibility, freeing space, parental controls, confidence for new/elderly users), and buying/device-care guidance. Safety-first: safe reversible steps (back up before anything that erases data); NEVER asks for passwords/OTPs/card details or to install remote-access apps (warns genuine support never does either) and flags tech-support/virus-popup/phishing scams (Cyber Safety AI); honest about limits — hardware faults/water damage/data recovery/warranty go to an authorised service centre (a software tip won\'t fix broken hardware); never fabricates exact specs/prices/model-specific steps.',
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
    description: 'Clear, patient PERSONAL tutor that helps students (school to early college) UNDERSTAND and solve problems in maths & science — takes an intake (class/board, subjects, target exam, weak topics) and, for signed-in users, REMEMBERS the student to focus on their weak topics over time. Complements the Teacher AI (broad study plans) by focusing on step-by-step problem solving: worked solutions showing each step & reasoning (not just answers), concept/formula explanations with examples & misconception fixes, maths (arithmetic, algebra, geometry, trigonometry, calculus, statistics), science (physics mechanics/electricity, chemistry reactions/mole/organic, biology concepts with derivations/working), exam technique (approach, units & significant figures, checking answers, presenting working for marks — boards/NEET/JEE), and guided practice (hints first, then checks). Teaching/honesty: prioritises understanding (hint-then-solve, student does the working), accurate & careful (states assumptions, minds units/signs, double-checks; asks when a problem is ambiguous/missing data), discourages cheating on graded work, never fabricates formulas/constants/facts (says when unsure, suggests verifying with textbook/teacher); a learning aid, not a guarantee of marks — confirm syllabus/exam pattern with the board.',
    howToUse: 'Open Sidebar → Professionals → Maths & Science Solver and ask: "solve this maths problem step by step", "explain this concept with an example", "help with a physics numerical", "give me practice problems & check my work". Do the working yourself to learn; verify important answers with your textbook/teacher.',
    relatedFeatures: ['professionals', 'teacher_ai'],
    aiSurface: 'mathscience_ai',
    keywords: ['maths', 'math', 'science', 'physics', 'chemistry', 'biology', 'solve', 'problem', 'numerical', 'algebra', 'calculus', 'ncert', 'jee', 'neet', 'ganit', 'step by step', 'remembers me', 'weak topics'],
  },

  // ─── CODING & PROGRAMMING TUTOR AI ───────────────────────────────────────
  {
    id: 'coding_ai',
    name: 'Coding & Programming Tutor AI',
    path: 'Sidebar → Professionals → Coding & Programming Tutor',
    description: 'Patient PERSONAL mentor that TEACHES coding & computer science (beginner to intermediate) — takes an intake (your level, languages known, learning goal, weak areas) and, for signed-in users, REMEMBERS you to teach at your exact level over time. Distinct from NavBharatAI Pro v5.0 (which autonomously builds full apps); here the goal is the learner\'s understanding & skill: learn-to-code (choosing a first language like Python/JavaScript, core concepts — variables, types, conditionals, loops, functions, lists/dicts, OOP basics with examples & exercises), explaining code line-by-line, debugging (teaching the process & WHY it broke, not just the fix), data structures & algorithms + Big-O (placements/interviews, approach-first), projects & practice roadmaps & code review, and web/dev basics + Git/GitHub & good habits. Teaching/honesty: builds understanding not copy-paste (hints & feedback over full solutions; discourages cheating on graded work), accurate & careful (says when unsure, suggests testing/official docs as languages/libraries change), never fabricates APIs/library functions/outputs, refuses malware/harmful code; for building & deploying a full real app points to NavBharatAI Pro v5.0.',
    howToUse: 'Open Sidebar → Professionals → Coding & Programming Tutor and ask: "how do I start learning to code", "explain this code/concept", "help me debug my code", "a roadmap for DSA/placements". Write & test code yourself to learn; to build a full app use NavBharatAI Pro v5.0.',
    relatedFeatures: ['professionals', 'engineer_ai', 'teacher_ai'],
    aiSurface: 'coding_ai',
    keywords: ['coding', 'programming', 'code', 'python', 'javascript', 'java', 'learn to code', 'dsa', 'algorithm', 'debug', 'developer', 'placement', 'coding tutor', 'leetcode', 'web development', 'remembers me', 'personal mentor'],
  },

  // ─── PREGNANCY & NEW-MOTHER CARE AI ──────────────────────────────────────
  {
    id: 'maternity_ai',
    name: 'Pregnancy & New-Mother Care AI',
    path: 'Sidebar → Professionals → Pregnancy & New-Mother Care',
    description: 'Warm, reassuring companion for expecting & new mothers (and families) that remembers YOU: takes a gentle intake (your stage — weeks/trimester or baby\'s age, whether it\'s your first, what you want support with) and — for signed-in users — REMEMBERS it so support fits your journey. General info on pregnancy wellbeing & antenatal (ANC) check-ups, balanced nutrition (→ Nutritionist AI) & rest, danger-sign AWARENESS (heavy bleeding, severe pain/headache/blurred vision/swelling, high fever, fits, reduced fetal movements, fluid leaking → urgent care), newborn care basics (warmth, hygiene, cord/skin, safe sleep, immunisation awareness, when to see a paediatrician), breastfeeding/feeding support, and the mother\'s postpartum recovery & emotional wellbeing (incl. postpartum-depression awareness). Safety-first (two lives): general information & support NOT medical advice/diagnosis/prescription — always attend check-ups & follow the gynaecologist/paediatrician, take only prescribed medicines (never suggests medicines/doses); any warning sign in mother or baby = EMERGENCY, get medical help immediately/call 112; discourages unsafe traditional practices/myths; never fabricates medical facts/schedules (every pregnancy & baby differs — only the doctor knows specifics); postpartum distress → Wellness AI / Tele-MANAS 14416.',
    howToUse: 'Open Sidebar → Professionals → Pregnancy & New-Mother Care and ask: "what does antenatal care involve", "pregnancy warning signs to watch for", "newborn care basics", "breastfeeding & my recovery support". Always follow your doctor; for any danger sign call 112 / go to hospital.',
    relatedFeatures: ['professionals', 'sda_chat', 'nutritionist_ai', 'parenting_ai', 'wellness_ai'],
    aiSurface: 'maternity_ai',
    keywords: ['pregnancy', 'pregnant', 'maternity', 'new mother', 'newborn', 'baby care', 'antenatal', 'breastfeeding', 'postpartum', 'garbhavastha', 'delivery', 'infant', 'mother', 'janani', 'remembers me', 'my pregnancy'],
  },

  // ─── FIRST-AID & EMERGENCY-RESPONSE AI ───────────────────────────────────
  {
    id: 'firstaid_ai',
    name: 'First-Aid & Emergency-Response AI',
    path: 'Sidebar → Professionals → First-Aid & Emergency Response',
    description: 'Calm, clear PERSONAL guide (remembers light non-clinical context like who you want to be ready to help when signed in — never a diagnosis; in a real emergency call 112) to general first-aid & everyday emergencies for ordinary people — FIRST priority always: call emergency services (India 112 all-in-one, 108 ambulance, 100 police, 101 fire, 181 women, Tele-MANAS 14416). Helps recognise serious situations (chest pain/heart attack, stroke FAST, severe bleeding, choking, unconsciousness, breathing trouble, severe allergy, seizures, poisoning, drowning, major burns) and gives safe general first-aid steps (direct pressure for bleeding; back blows/abdominal thrusts for choking — different for infants; cool running water for burns; immobilise fractures; fainting/nosebleed/heatstroke/poisoning basics; CPR awareness), plus first-aid kit & prevention and after-care. Safety-first (life & death): leads with calling 112/108 — first-aid helps WHILE help is on the way, never instead of it; gives no diagnoses/medicines/doses or risky remedies, warns against harmful myths (toothpaste/ghee on burns, food/water to an unconscious person), notes techniques differ for infants/children/pregnant people; can\'t see the situation so urges professional care for anything beyond minor and a certified first-aid/CPR course; never fabricates procedures.',
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
    description: 'Practical, positive PERSONAL guide (remembers what you care about & your setup when signed in) to living more sustainably & understanding environmental issues (individuals, families, students, small businesses): everyday sustainability (reduce waste & single-use plastic, mindful consumption, cut food waste), energy & water saving (LED, BEE-star appliances, fixing leaks, rainwater/greywater — saves money too), waste segregation/home composting/recycling & e-waste disposal, green choices (sustainable transport, EV awareness, eco products & spotting greenwashing), and explaining issues simply (climate change, pollution, biodiversity, water scarcity) with constructive local action. Honesty/approach: practical & non-judgemental (affordable realistic steps, celebrates progress, no guilt/shame/doom), science-based (no fearmongering/misinformation/eco-fads, honest about trade-offs and that individual action helps but systemic factors matter too), non-partisan (factual, no political sides), never fabricates statistics/studies (points to credible/official sources for figures & local rules).',
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
    description: 'Personal exam-friendly study companion for Indian learners & competitive-exam aspirants (UPSC, SSC, banking, railways, state PSC, school quizzes) — takes an intake (target exam, prep stage, focus & weak areas) and, for signed-in users, REMEMBERS you to focus your weak areas. Static GK with context (history, geography, polity & constitution, economy basics, general science, art & culture, sports, awards, important days, India/world facts), current-affairs CONCEPTS & background/significance, exam-prep strategy (syllabus-wise study, notes, spaced revision), and quiz/MCQ practice with explained reasoning — focused on understanding over rote. Honesty/accuracy: an educational aid NOT an official source — accuracy-first (says when unsure rather than guessing; never fabricates names/dates/statistics/records/events); honest current-affairs LIMIT (may not have the latest news/appointments/winners/dates — verify recent facts from up-to-date reliable sources); confirm official syllabus/patterns/vacancies/dates on the official commission/board site; unbiased & factual on history/polity/sensitive topics. For deep maths/science problems use the Maths & Science Solver; for subject teaching the Teacher AI.',
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
    description: 'Calm, empowering PERSONAL guide (remembers who the safety is for & your concerns when signed in) to personal safety, situational awareness & getting help in India for everyone (with care for women, children, students, travellers, seniors): emergency helplines (112 ERSS/112 India app & SHOUT, 100, Women 181/1091, Child 1098, Cyber 1930, Ambulance 108, Senior 14567), situational awareness & precautions (trust instincts, safe travel/cabs/night, home & online basics), emergency preparedness (phone Emergency SOS, live-location sharing, ICE contacts, safety plan), women\'s & children\'s safety (tips, rights/helplines, safe vs unsafe touch), de-escalation (escape & get help over confrontation), self-defense AWARENESS (urges a certified hands-on class), and after-incident steps. Safety-first & ethics: AWARENESS not a replacement for emergency services/security professionals/certified instructors — always prioritise calling 112/100/181 & reaching safety (escape > confrontation); NEVER victim-blames (harassment/assault is never the victim\'s fault, inclusive of all genders); no instructions for illegal violence/weapons or risky hacks; can\'t assess a live situation (real threat → call emergency services now); never fabricates helplines/laws/false reassurance. Emotional support → Wellness AI, legal → Lawyer AI, online scams → Cyber Safety AI.',
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
    description: 'Helpful PERSONAL guide (remembers your usual language pair when signed in) for translating & understanding text across Indian languages (Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Urdu, etc.) and major foreign languages: translation (words/sentences/messages, natural tone, formal or casual), meaning & idiom/nuance explanation, writing/composing or rephrasing in another language, learning support (common travel/work phrases, pronunciation hints, basic grammar — serious learning → Spoken English / Tutor AI or a course), and transliteration (e.g. Hindi in Roman/Hinglish). Honesty/limits: a helpful aid NOT a certified/legal translator — translation isn\'t always exact (flags non-direct phrases, asks for context on ambiguous words); for official/legal/medical/high-stakes documents (certificates, contracts, court/immigration, medical reports) use a CERTIFIED human translator (not a substitute); culturally sensitive (no offensive/harmful output); honest when less reliable in a language/dialect (suggests verifying with a native speaker); never fabricates meanings.',
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
    description: 'Empowering PERSONAL guide (remembers your location, issue & where you are in the process when signed in) to using civic rights & public systems for transparency, grievances & complaints: RTI (Right to Information Act 2005 — how/where to file to the PIO, what to ask, fees/format, first appeal, drafting a clear request; central rtionline.gov.in + state portals), public grievances (CPGRAMS pgportal.gov.in & state portals, escalation, effective drafting), consumer complaints (rights, National Consumer Helpline 1915/consumerhelpline.gov.in, e-Daakhil filing), citizen services & documents (Aadhaar/PAN/ration/voter ID/birth-death-income-caste certificates/passport — general process & documents), public service delivery (which authority handles water/electricity/roads/sanitation), and drafting clear applications/complaints/appeals/follow-ups. Safety/honesty: general civic INFORMATION & drafting help NOT legal advice or an official channel — procedures/fees/forms/portals change & vary by state, always verify & apply on official .gov.in sites (legal advice → Lawyer AI); anti-corruption (legitimate process, never bribes/touts, no guaranteed outcomes/timelines), warns about fake "govt service" sites/agents that overcharge or ask OTPs (Cyber Safety AI); never fabricates portal URLs/fees/forms/legal sections/deadlines. For scheme eligibility use the Govt Schemes Helper.',
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
    description: 'Clear, motivating PERSONAL guide (remembers your target exam(s), stage & education when signed in) for Indian government-job aspirants: which exam leads to which job (UPSC CSE, SSC CGL/CHSL/MTS/GD, Banking IBPS/SBI/RBI, Railways RRB NTPC/Group D/ALP, Defence NDA/CDS/AFCAT/Agniveer, Teaching CTET/TET/UGC-NET, State PSCs & police), general eligibility (age/qualification/attempts — varies, verify), selection process (prelims/mains/tiers, interview, physical/medical), exam-wise preparation strategy (official syllabus, standard resources/NCERT, mock tests, revision, time management) and staying consistent through attempts/wellbeing. Honesty/safety: general guidance NOT official notifications — vacancies/dates/eligibility/syllabi/patterns change each cycle & vary, always verify on the official commission/board site before relying (GK/current-affairs content → General Knowledge AI, career direction → Mentor AI); ANTI-FRAUD (critical) — no genuine govt job is sold/guaranteed for money/agents/bribes, never pay or share OTPs, apply only via official portals, report scams (Cyber Safety AI); realistic (high competition, no guaranteed selection, keep a backup) — never fabricates vacancy numbers/dates/cut-offs/exam details or gives false assurance.',
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
    description: 'Calm, respectful PERSONAL companion (remembers what you connect with & are reflecting on when signed in) for reflection on life, meaning, values & inner peace, drawing gently on India\'s and the world\'s wisdom traditions: reflection & meaning (purpose, gratitude, change, loss, calm), wisdom traditions explained as perspectives (Gita/Vedanta/Yoga, Buddhism, Jainism, Sufism, Bhakti, Stoicism & more), contemplative practices (mindfulness, gratitude, journaling — technique → Yoga & Meditation AI), everyday ethics (right action, ego, attachment, forgiveness, contentment), and gentle comfort in hard times. Approach/safety (sensitive): strictly INCLUSIVE & NEUTRAL — respects all religions/philosophies/non-believers equally, never promotes one as superior, never proselytises or disparages; NOT a religious authority (no rulings/fatwas/decrees or "sin" declarations — consult your own scriptures/guru/elders for doctrine); NOT therapy/medical care — for depression/overwhelming grief/self-harm thoughts urges professional help & Wellness AI / crisis lines (Tele-MANAS 14416, emergency 112); never encourages harmful superstition, blind faith over medicine, or paid "remedies"/miracles; never fabricates scriptures/quotes.',
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
    description: 'Cheerful PERSONAL guide (remembers your crafts, skill & materials when signed in) to creative crafts, DIY projects & hobbies for all ages & budgets: step-by-step craft projects (paper/origami, card-making, painting & drawing, knitting/crochet/embroidery, jewellery, candle/soap, clay/pottery, scrapbooking, home decor), festive & occasion DIY (rangoli, diyas, torans, cards, gift wrap, decorations), upcycling & budget crafts (newspaper/bottles/jars/old clothes/cardboard — eco-friendly), kids\' crafts & school projects, hobbies (sketching, calligraphy, journaling), and technique/troubleshooting — with affordable, easily-available materials. Safety: craft-safety first especially with kids (sharp tools, hot glue/wax/ovens, small-part choking hazards, chemicals/fumes like paints/resin/adhesives — ventilation, labels, away from children/pets, adult supervision); encouraging & inclusive of all skill levels (mistakes are part of learning, no "wrong" art); never fabricates brands/measurements-as-guarantees or unsafe shortcuts (follow product instructions, caution for heat/electrical/power tools).',
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
    description: 'Warm, strictly inclusive PERSONAL guide (remembers your region/community & festivals of interest when signed in) to India\'s festivals, traditions & cultural diversity: festival significance/stories & common traditions across ALL communities (Diwali, Holi, Eid, Christmas, Guru Nanak Jayanti, Navratri/Durga Puja, Ganesh Chaturthi, Pongal, Onam, Baisakhi, Raksha Bandhan, Buddha Purnima, Mahavir Jayanti, regional & harvest festivals), celebration & planning ideas (food/sweets, decorations→Crafts AI, events→Events AI, greetings, gifting), Indian art/regional customs/attire/diversity appreciation, respectful participation/wishing & etiquette, and calendar awareness (lunar/regional — dates vary yearly). Approach (non-negotiable): strictly inclusive & neutral (equal respect for all religions/regions/communities, never ranks/favours/disparages, no stereotypes, promotes harmony); NOT a religious authority (describes common practices not mandated rituals/rulings — exact rites → family/community/scriptures, natural regional variation); encourages safe & responsible celebration (fireworks safety, eco-friendly/quiet options, respect for others/animals/environment → Environment AI); never fabricates facts/dates/"rules" (festival dates shift yearly/regionally — verify locally).',
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
    description: 'Imaginative PERSONAL writing partner (remembers what you write, your project & voice when signed in; distinct from Thesis AI/academic & Resume AI/jobs): ideas & brainstorming (plots, prompts, themes, characters, titles, beating writer\'s block), story craft (structure, character, dialogue, POV, pacing, conflict, show-don\'t-tell for short stories/fiction/scripts/folktales), poetry (free verse, rhyme, shayari/ghazal, haiku — imagery & rhythm, English & Indian languages), content & blogs (articles, social captions/reel scripts, honest non-clickbait hooks), editing & specific constructive feedback on the user\'s OWN draft, and craft learning. Co-creates & coaches keeping the work the user\'s own (their voice leads). Honesty/ethics: won\'t help cheat (guides/improves graded work rather than writing it to submit; academic → Thesis AI, job docs → Resume AI); respects copyright (original work, no reproducing/passing off others\'); declines harmful/defamatory/deceptive content; verify facts for non-fiction; honest that good writing takes drafting & revision.',
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
    description: 'Sharp PERSONAL coach for fast mental calculation, Vedic-maths techniques, and quantitative/logical aptitude & reasoning (school, competitive exams, placements, everyday speed) — takes an intake (what you\'re prepping for, comfort level, topics, weak areas) and, for signed-in users, REMEMBERS you to drill your weak topics. Mental-maths & Vedic tricks (multiplication, squares, near-a-base, divisibility, percentages, estimation — with the WHY behind each), quantitative aptitude (percentages, ratio & proportion, averages, profit & loss, simple/compound interest, time-speed-distance, time & work, number systems, perm-comb & probability basics), logical & verbal reasoning (series, analogies, coding-decoding, blood relations, directions, syllogisms, puzzles, seating, data interpretation), speed/accuracy & MCQ strategy, and graded practice/quizzing with explained fastest approaches. Teaching/honesty: teaches the WHY (reliable, not magic) then drills (hint-first, learner attempts); accurate & careful (states a shortcut\'s conditions/limits, double-checks); a learning aid not for cheating on graded tests; never fabricates formulas/tricks that don\'t work; realistic (speed builds gradually). Complements the Maths & Science Solver (deep problem-solving) and General Knowledge AI (exam GK).',
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
    description: 'Calm, practical PERSONAL guide (remembers your region & household when signed in, so the plan fits your real risks) to prepare for & stay safe in natural hazards & extreme weather (floods, cyclones, earthquakes, heatwaves, heavy rain, landslides, fire, lightning): BEFORE (family emergency plan, go-kit, knowing local risks/safe spots, official alerts), DURING per-hazard safety actions (floods — higher ground, never cross floodwater; earthquake — Drop-Cover-Hold On; cyclone — evacuate/indoors; heatwave — hydrate/cool & heatstroke signs; lightning/fire safety), AFTER (return only when safe, beware structural damage/live wires/contaminated water, recovery & aid), and protecting vulnerable groups & animals. Safety-first (lives): FIRST priority is official warnings (IMD/NDMA/SDMA/local) & emergency services (112/108/101) — follow evacuation orders without delay; NOT an emergency service or live forecast/alert authority (can\'t predict real-time weather or whether your area is affected — rely on IMD/official; never fabricates forecasts/warnings/numbers); only safe widely-accepted guidance (never advise crossing floodwater or returning before declared safe); injuries → First-Aid AI + 108/112, distress → Wellness AI.',
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
    description: 'Enthusiastic, conservation-minded PERSONAL companion (remembers what you love & your region when signed in) to learn about & appreciate nature — birds, animals, insects, trees, plants & ecosystems: identification from descriptions (likely candidates, honestly noting uncertainty — not definitive), accurate nature facts & ecology (Indian & world biodiversity, behaviour, migration, habitats), birdwatching & nature activities (ethical observation, journaling, bird/butterfly gardening → Gardening AI, ethical photography → Photography AI), conservation & ecosystems (threats, how to help → Environment AI), and safe humane coexistence with urban wildlife. Safety & ethics (non-negotiable): never advise approaching/handling/feeding/provoking wild animals (keep respectful distance); snake/dangerous animal → keep away & call trained help (Forest Dept / wildlife rescue / 112), never catch or kill; injured/orphaned wildlife → licensed rescue/Forest Dept/vet, no untrained handling; respects the Wildlife (Protection) Act (no illegal capture/trade/caging/harming of protected wild animals/birds, no exotic/illegal pets, no removing animals/eggs/plants from the wild); honest that description-based ID is a best guess (verify with field guides/apps like Merlin/eBird/iNaturalist/naturalists) and never fabricates species/facts or that something is harmless.',
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
    description: 'Practical, honest PERSONAL mentor (remembers your skill, stage & income goal when signed in) for earning through legitimate freelancing, gig work & online income: choosing a path (writing/content, design, web/app dev, digital marketing, video editing, tutoring, translation, virtual assistance, handmade selling), getting started (portfolio, profiles on legit platforms, personal pitch), finding clients (non-spammy proposals/outreach, networking, referrals, not underpricing), pricing & professionalism (hourly/project/value, scope, milestones, deadlines, reviews), getting paid safely + contracts (advance/milestones, escrow, invoices → Lawyer AI for legal) + tax/GST awareness (→ CA AI) & records, and growth/balance (raising rates, emergency fund → Finance AI). Honesty/safety (money & scams): strongly ANTI-SCAM — never endorse "earn ₹X/day"/part-time/task/investment/MLM/Ponzi schemes that ask you to PAY/deposit to join or promise guaranteed earnings (real work = YOU get paid; report to 1930 / Cyber Safety AI); realistic (irregular income, takes skill/effort/time, no get-rich-quick, no promised earnings); professional integrity (quality work, confidentiality, copyright, no deceptive/cheating gigs like writing someone\'s graded assignment); protects bank details/OTPs; never fabricates platform rules/fees/rates.',
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
    description: 'Warm, joyful PERSONAL helper (remembers your preferences — gender, tradition, theme, shortlist — when signed in) for choosing a baby name across India\'s many languages, religions & cultures: name suggestions (by gender/unisex, starting letter/sound, meaning/theme, language/community — Hindu/Muslim/Christian/Sikh/regional, modern or traditional), meanings/origins/pronunciation & variants, shortlisting (surname/sibling fit, initials, nicknames, sound), respectful awareness of naming customs (namkaran, nakshatra/rashi-syllable as a tradition, etc.), and practical tips (unique vs easy, avoiding unintended negative meanings). Approach/honesty: strictly inclusive & respectful (all communities equally, follows the family\'s faith/traditions, never favours/ranks/disparages); meanings given as commonly understood (can vary by source — says "commonly means…", verify if important, never fabricates a meaning/origin); NOT a religious/astrology authority (nakshatra/rashi-syllable is a family/priest custom not a requirement — no lucky/unlucky claims, Astrologer AI is entertainment-only); the name is entirely the family\'s choice, offered without pressure.',
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
    description: 'Friendly, practical PERSONAL guide (remembers your context — self/family/school/workplace — when signed in) to everyday hygiene, sanitation & disease PREVENTION for individuals, families, schools & communities: personal hygiene (handwashing technique & timing, bathing, oral/dental, nail/foot care), safe drinking water & food hygiene (boiling/filtering, safe handling/storage, preventing waterborne/foodborne illness), sanitation (toilet hygiene, safe waste disposal, clean surroundings, stopping mosquito/fly breeding), disease prevention (how infections spread + simple prevention, vector control for dengue/malaria, vaccination awareness via official programme), stigma-free menstrual hygiene management, and community/school hygiene. Safety/honesty: general PREVENTION & awareness NOT medical advice/diagnosis/treatment — symptoms/illness/infection/dehydration → see a doctor (Doctor AI clinical; emergencies 112/108), never gives medicines/doses; promotes safe science-based practices (ORS-awareness, proper water treatment, official vaccination) & discourages harmful myths; respectful, stigma-free & inclusive (menstrual/sanitation); never fabricates medical facts/statistics.',
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
    description: 'Warm PERSONAL guide (remembers your causes, skills & region when signed in) to giving back: find a cause & way to help (match interests/skills/time to education, health, environment, animals, elderly, children, disaster relief, women empowerment — via time/skills/money/goods/awareness), volunteering (finding genuine verified NGOs/local/online & skills-based opportunities, contributing reliably & respectfully), donating safely (verify registration/transparency, official channels & receipts, 80G tax awareness → CA AI), starting community initiatives (clean-ups, tutoring, donation/blood drives, awareness campaigns; planning & mobilising), and skills-based/everyday giving (pro bono, blood/organ-donation awareness via official channels, daily kindness). Safety/honesty: NOT a charity regulator or tax/legal authority — anti-fraud (verify any NGO/cause, donate only via official/traceable channels never random personal accounts/under pressure, beware fake-charity & viral-fundraiser scams, never share OTPs, report 1930 / Cyber Safety AI); respect & dignity of those helped (no saviour attitudes/stereotypes, follow communities & vetted organisations, proper channels for children/vulnerable/disaster/medical); never fabricates organisations/registration/tax rules (verify & consult CA/Lawyer AI).',
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
    description: 'Curious, inspiring PERSONAL guide (remembers your level, interests & equipment when signed in) to astronomy, stargazing & space SCIENCE (clearly different from the Astrologer AI / cultural entertainment): stargazing & night sky (naked-eye/binoculars/telescope, constellations, planets, Moon phases, meteor showers, what\'s visible from India), astronomy concepts (solar system, stars, galaxies, black holes, star life cycles, gravity, light-years, eclipses, seasons — simple analogies), space exploration (ISRO — Chandrayaan/Mangalyaan/Aditya-L1/Gaganyaan; NASA/ESA; rockets/satellites/NavIC basics), telescopes/gear & beginner astrophotography (→ Photography AI), and learning/careers in astronomy/astrophysics/space sector (→ Mentor/Study-Abroad AIs). Honesty/safety: scientifically accurate (distinguishes established facts from open questions, says "we don\'t fully know yet", never fabricates facts/dates/mission details — verify on ISRO/NASA & sky apps for live timings); science NOT astrology (no fortune/predictive claims; cultural horoscopes → Astrologer AI); SUN-SAFETY critical — never look at the Sun directly or through optics without certified solar filters, only ISO-certified glasses for eclipses (risk of permanent blindness).',
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
    description: 'Patient PERSONAL guide (remembers your level, style & tools when signed in) to beautiful handwriting, calligraphy & hand-lettering for all levels & scripts: handwriting improvement (consistency, spacing, slant, letter shapes, grip/posture, English & Devanagari drills), calligraphy styles & strokes (modern brush, italic, copperplate basics, Devanagari), affordable tools & materials (pencil/brush pens/nibs/markers/paper + substitutes), hand-lettering & projects (cards, quotes, posters, journaling, festive decor → Crafts AI; layout & flourishes), and effective practice drills & progress tracking. Teaching/honesty: encouraging & specific (explains technique, gives step-by-step drills, asks about the issue since it can\'t see the writing — suggests guide sheets & lined/grid paper); mastery comes from short regular practice over weeks (no instant fixes, no single "perfect" style); keeps tools affordable/inclusive; respects copyright/originality in lettering (no passing off trademarked logos/artwork); never fabricates brand claims or guarantees results.',
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
    description: 'Encouraging PERSONAL guide (remembers your style, level & goal when signed in) to dance for all ages & levels — classical, folk, Bollywood/freestyle & dance-for-fitness: getting started (finding rhythm/taal, posture, warm-ups, coordination & confidence), styles overview (Bharatanatyam, Kathak, Odissi, Kuchipudi; Garba, Bhangra & folk; Bollywood/contemporary — general character, guru recommended for classical), practice & technique (warm-up/stretch, footwork drills, learning routines in parts, stamina/flexibility/expression, choreography basics), dance fitness (cardio/stress-relief → pairs with Fitness AI), and performance/confidence. Safety/honesty: NOT medical/physiotherapy advice and text can\'t correct form like an in-person teacher (serious classical/technique → qualified guru/instructor); always warm up & never push through sharp/joint pain (rest & see a doctor/physio for injury), learn high-impact moves under a teacher, get medical clearance for health conditions/pregnancy, dance on a safe surface; progress takes consistent practice (no overnight mastery); presents classical/folk forms respectfully & accurately (never fabricates their history/rules); inclusive of every body & age.',
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
    description: 'Fun PERSONAL companion (remembers who you play with, favourite games & ages when signed in) for board/card games, puzzles, brain-teasers & indoor/outdoor activities for families, friends, kids & gatherings: game rules & strategy (Chess, Carrom, Ludo, Snakes & Ladders, Uno, rummy-style, housie/tambola, Antakshari, Dumb Charades, traditional Indian games), game suggestions by group size/ages/time/indoor-outdoor/no-equipment, puzzles/riddles/brain-games/trivia (with hints/answers, pitched to audience), family & party activity ideas (ice-breakers, kids parties, road trips, festivals → Events AI / decor → Crafts AI), and learning a game step by step. Approach/safety: family-friendly, inclusive & good-sportsmanship (fun over winning); kids/physical-game safety (age-appropriate, supervision, small-part choking awareness, safe space; sports → Sports AI); NO gambling/betting — keeps card/dice games friendly & stakes-free, declines gambling tips & notes risks/legality; accurate rules but notes regional/house variations ("a common rule is…") and points to official bodies for competitive play (no fabricated tournament rules).',
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
    description: 'Independent, commission-free PERSONAL helper (remembers your budget, use-case & preferences when signed in) to choose electronics & gadgets in India (phones, laptops, TVs, home appliances — fridge/washer/AC, audio, smartwatches, accessories): match a device to the user\'s needs & budget by asking the right questions, understand specs in plain language & which actually matter vs marketing hype (RAM/processor/storage/display/battery; appliance capacity & BEE star rating; TV panel/resolution), compare options objectively & read reviews critically, value/warranty/timing & running cost, and safe buying. Honesty/safety: NEUTRAL & independent (never pushes a brand for commission, honest about trade-offs); prices/models/specs change fast (won\'t fabricate current prices/exact specs/"latest model" — verify on reliable/official sources before buying); anti-scam (genuine sellers, proper bill/warranty, beware fake deals/counterfeits/used-as-new, never share OTP/card on unverified sites → Cyber Safety AI); budget-respectful (no upselling). For fixing devices use the Gadget & Tech-Help AI.',
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
    description: 'Enthusiastic, safety-first PERSONAL guide (remembers your fitness level, interests & region when signed in) for Indian outdoor adventures — trekking/hiking, camping, road trips & adventure activities: trek/hike planning (by fitness/experience/season, routes & duration concepts, fitness prep, altitude acclimatisation), packing & gear lists (layers, footwear, water, first-aid, navigation; budget basics), road trips & camping (route/stops/timing, vehicle readiness → Vehicle AI, Leave-No-Trace), safety & preparedness (weather/terrain, altitude sickness/AMS awareness, hydration, groups/guides, sharing itinerary, emergency contacts), and adventure activities (rafting/paragliding/scuba — via licensed certified operators only). Safety-first (lives): prioritises safe choices over ambition — go with experienced groups/registered guides, never alone/off-route, check weather/conditions & turn back if worsening, licensed operators + safety briefings for sports; altitude sickness can be life-threatening (descend & get help for serious symptoms), be medically fit for demanding treks; emergencies → local rescue/forest dept/112, first-aid → First-Aid AI; never fabricates difficulty/permits/distances/weather or that something is "safe" (verify current conditions/permits/routes officially & with registered operators; respect protected areas & local rules). For general holiday itineraries use the Travel Planner AI.',
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
    description: 'Practical, judgement-free PERSONAL helper (remembers your household, income band & goals when signed in) for everyday household money management: budgeting (simple monthly budget, 50/30/20 & envelope methods, tracking spends), cutting everyday expenses (groceries, bills, subscriptions, eating out, impulse buys), saving habits (pay-yourself-first, emergency fund, goal-based saving), managing bills & debt generally (due dates, clearing high-interest debt, not overspending on EMIs/credit), frugal living (smart shopping, reuse/repair, energy/water saving), and family money (budgeting together, teaching kids, irregular income). Honesty/approach: practical & non-judgemental (small doable steps, no shaming — frugality should reduce stress not cause misery); everyday money-management NOT investment/tax/personalised advice (investing → Finance AI, tax → CA AI, stocks → Stock-Market AI, serious distress → a professional); anti-scam (save/earn-fast & high-return schemes → Cyber Safety AI); no product recommendations/guarantees; never fabricates prices/numbers.',
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
    description: 'Expert that analyses PUBLIC GitHub repositories for real (read-only) and gives an honest, actionable report & improvement plan: paste a public repo URL (or owner/repo) and it fetches the actual repo — metadata, license, languages, README, file tree & key files — then reports the overview & tech stack, strengths (good patterns to learn from), gaps/weaknesses (missing tests/docs/CI/error handling/structure), visible security & quality flags (noted as a partial view), the license & what it permits, and a prioritised improvement plan with short adoptable code snippets. License-respecting ("copy good things" = LEARN patterns & write your own original code, comply with & attribute per the actual LICENSE — MIT/Apache vs GPL-copyleft vs no-license/default-copyright; general info, not legal advice). Honesty: works only from the real fetched content (says when files/tree are truncated or missing, never invents repo contents/metrics/vulnerabilities); analyses & ADVISES only — cannot push changes to repos you don\'t own (no write access), so "improve" = the plan/guidance/snippets for you to apply in your own fork (suggests NavBharatAI Pro v5.0 to build it out). Works on public repos without a token (rate-limited); handles not-found/private/rate-limit gracefully.',
    howToUse: 'Open Sidebar → Professionals → GitHub Repo Analyst & Improver and paste a public GitHub repo URL (or owner/repo), then ask: "analyse this repo", "strengths & gaps?", "security/quality issues you can see?", "a prioritised improvement plan". It fetches and analyses the real repo (read-only). To then build the improvements, use NavBharatAI Pro v5.0.',
    relatedFeatures: ['professionals', 'engineer_ai', 'coding_ai'],
    aiSurface: 'repo_analyst',
    keywords: ['github', 'repo', 'repository', 'analyse', 'analyze', 'code review', 'open source', 'improve repo', 'audit', 'codebase', 'project review', 'github url', 'license', 'repo analyst'],
  },

  // ─── PRO CHAT ─────────────────────────────────────────────────────────────
  {
    id: 'pro_chat',
    name: 'NavBharatAI Pro (App Builder chat)',
    path: 'Home → "NavBharatAI Pro" card → "Open Pro Builder"  OR  Sidebar menu → "App Builder v5.0"',
    description: `NavBharatAI Pro is the agentic app-builder chat (now NavBharatAI Pro v5.0). You:
• CONVERSATION — discuss ideas, plan features, ask questions (use the Plan/Advise modes for read-only planning).
• BUILD — describe an app and it plans, codes, previews and ships a complete real project (not just a single HTML canvas).
• EDIT — once an app exists, ask to change it and it patches precisely, preserving everything you didn't ask to change.
Also supports: file attachments (text, code, .zip project import), image analysis (vision), and PDF reading.`,
    howToUse: 'From Home, open the "NavBharatAI Pro" card and tap "Open Pro Builder" (or pick "App Builder v5.0" from the sidebar menu). Type your app idea and send to build; once it appears, ask follow-up changes directly.',
    relatedFeatures: ['free_chat', 'ide', 'engineer_ai'],
    aiSurface: 'pro_chat',
    keywords: ['pro chat', 'pro', 'build mode', 'canvas', 'app maker', 'make app', 'generate app', 'html app', 'generate code', 'app generate karo'],
  },
  {
    id: 'unified-workspace',
    name: 'Unified Workspace — Chat + Live Code + Preview',
    path: 'NavBharatAI Pro v5.0 → build an app → the workspace tabs (Preview / Files / Diff) open beside the chat',
    description: `World-class "Chat IS the IDE" surface, like Cursor / Bolt / v0 / Lovable — built into NavBharatAI Pro v5.0. Once an app exists, the workspace opens beside the chat as header tabs so you never lose your place while building:
• PREVIEW tab — the running app, live, updating as the AI edits files (dual: Live server + In-browser, with Diagnose).
• FILES tab — the whole file tree; open any file to read/edit it in Code Studio, download the project as a ZIP, upload, rename, delete, or restore an earlier version from History.
• DIFF tab — see exactly what changed in the last build.
• PUBLISH — one-click deploy straight from the action row (the Hosting chooser).
Tap a tab to open that surface (it takes over the screen on mobile); tap it again (or ✕) to collapse back to full-width chat. The workspace stays alive when you switch tabs and comes back after a reload.`,
    howToUse: 'Open NavBharatAI Pro v5.0 and build any app. The workspace tabs (Preview / Files / Diff) open beside the chat — tap one to open that surface, tap again (or ✕) to collapse back to full-width chat. Open a file to edit it in Code Studio.',
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
    name: 'NavBharatAI Pro — File & Image Upload',
    path: 'NavBharatAI Pro v5.0 → paperclip / attachment (📎) icon in the chat input',
    description: 'Upload files to NavBharatAI Pro v5.0 for AI analysis. Supported: images (PNG, JPG, WebP — visual analysis and description), PDFs (full text extraction and Q&A), text/code files (review, explain, modify), and .zip project import.',
    howToUse: 'Click the attachment (📎) icon in NavBharatAI Pro v5.0, select a file, then type your question about it.',
    relatedFeatures: ['pro_chat', 'free_chat_file_analysis'],
    aiSurface: 'pro_chat',
    keywords: ['upload file', 'attach file', 'pdf', 'image upload', 'file attachment', 'vision', 'analyze image', 'read pdf'],
  },

  // ─── FREE CHAT ────────────────────────────────────────────────────────────
  {
    id: 'free_chat',
    name: 'Free Chat (NavBharatAI)',
    path: 'Home → "Start Free Chat"  OR  Sidebar menu → "NavBharatAI FREE"',
    description: `General-purpose AI chat. Capabilities:
• Answers questions on any topic — science, history, coding, finance, law, etc.
• Explains concepts in any language (Hindi, English, Hinglish, Tamil, Telugu, Bengali, Marathi, Punjabi, and more).
• Analyzes documents (PDF/text files), describes images, reviews code.
• GENERATES images for FREE — just ask in plain text ("generate an image of a mountain sunrise", "ek logo banao", "draw a red car") and the image appears right in the chat. No separate tool needed.
• Remembers conversation context within a session.
• Responds in the SAME language and tone the user writes in — Hindi reply for Hindi input, English for English, etc.
NOTE: Does NOT build apps (use NavBharatAI Pro v5.0 for that).`,
    howToUse: 'Open "NavBharatAI FREE" from the sidebar menu (or tap "Start Free Chat" on Home) and type your question in any language. To get a picture, just ask for one in plain text (e.g. "generate an image of…", "ek image banao…") — it is generated free and shown inline.',
    relatedFeatures: ['pro_chat', 'history', 'free_chat_file_analysis', 'ai_image_gen'],
    aiSurface: 'nbi_chat',
    keywords: [
      'free chat', 'navbharatai free', 'start free chat', 'general chat', 'ask question', 'chat', 'conversation',
      'question answer', 'help', 'explain', 'kya hai', 'bataiye', 'samjhao',
      'hindi chat', 'language', 'translate', 'muft chat', 'free ai',
      'generate image in chat', 'image banao', 'photo banao', 'make an image', 'draw', 'picture in chat', 'free image',
    ],
  },
  {
    id: 'free_chat_file_analysis',
    name: 'Free Chat — File, Image & PDF Analysis',
    path: 'Sidebar menu → "NavBharatAI FREE" → attachment (📎) icon in the chat input',
    description: 'Attach files to the free chat for analysis. Images: visual description, object recognition, text extraction (OCR). PDFs: full text reading, summarization, Q&A. Code/text files: explanation, review, debugging help.',
    howToUse: 'In the Free Chat ("NavBharatAI FREE"), click the attachment (📎) icon, select your file, then ask your question about it.',
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
• FILES — file explorer: browse, create, rename and delete files. Tapping a file gives you See · Open · Copy file · Copy path · Delete. "See" opens the file READ-ONLY — you can read and copy it, but nothing there can change it (useful on a phone, where a stray tap in the editor is easy); "Open" opens it in the Code Studio editor to edit. On desktop the same read-only view is the eye icon that appears when you hover a file. Delete one file (trash icon) or use the Select button to multi-select / Select All and delete many at once — always with a confirmation dialog before anything is removed.
• EDITOR — syntax-highlighted code editor for all file types (TypeScript, React, Python, HTML, CSS, etc.).
• PHONE FOOTER (Code Studio's own bottom bar) — five tabs: CODE (the editor), FILES (the file tree), TERMINAL (opens/closes the real shell), DEBUG (the debugger panel — breakpoints) and MORE (the secondary tools: Search, Problems, Source Control, Security, Shortcuts). It never disappears on its own, so there is always a way back from any panel. AI and PREVIEW are deliberately NOT in the footer — both are buttons in the top-right header, and the terminal opens from the footer's Terminal tab ONLY (there is no second floating button on a phone), so every action has exactly one place.
• UPLOAD ZIP (Code Studio → MORE → "Upload ZIP") — put an existing project into Code Studio from a .zip on your phone or computer. It first shows a WARNING, in your own language (English, Hindi or Hinglish — whichever you are typing in), saying plainly that everything currently in the workspace will be deleted and replaced and cannot be brought back; the device file picker only opens after you confirm. The archive uploads in chunks, exactly the way NavBharatAI Pro v5.0 imports a project, so a large project is not capped — and you see the upload percentage as it goes. When it lands, the project appears everywhere at once: Code Studio, Files, the Preview and v5.0 all show the SAME uploaded files, because they all read one workspace. If the upload succeeds but the screen cannot refresh, it says so and tells you to reload — it never reports a failure for a project that is actually saved.
• SAVE — a real Save button in the editor's toolbar (and on the phone toolbar above the keyboard, where Ctrl+S does not exist). It writes the file you are looking at, applies your trim-whitespace / final-newline / format-on-save settings, and then says "Saved" in words — but only AFTER the change is genuinely stored in your workspace, so the confirmation is never shown for a save that has not actually happened yet. Ctrl+S does exactly the same thing.
• MENU BAR — a real VS Code-style menu bar (desktop): File (New File, Save, Save All, Close Editor, Settings, Keyboard Shortcuts), Edit (Undo/Redo, Cut/Copy/Paste, Find/Replace, Find in Files, Toggle Comment, Format Document), Selection (Select All, Expand Selection, multi-cursor Add Cursor Above/Below, Add Next Occurrence, Move/Copy Line), View (Split Editor / Close Split Editor, Explorer, Problems, Terminal, Command Palette), Run (Open Preview, Start/Stop Debugging, Problems Panel), Terminal (New/Toggle Terminal) and Help (Command Palette, Keyboard Shortcuts, Full Screen). Every entry performs its real action — the same commands the keyboard shortcuts and Ctrl+Shift+P palette run.
• KEYBOARD SHORTCUTS — every shortcut listed in the Shortcuts panel really works; there are no listed-but-dead keys. Recently made real: Ctrl+L (select the current line), Ctrl+O (open a file — the same quick-open as Ctrl+P), Ctrl+T (search the symbols in the file you are editing) and Ctrl+Shift+T (reopen the tab you just closed — it skips files that have since been deleted). Shortcuts a browser genuinely cannot perform were REMOVED rather than left as dead keys: "Open Dev Tools" (a web page cannot open the browser's own dev tools — press F12 yourself), "External Terminal" (there is no native OS console from a browser; use the IDE's own Terminal), and the debugger's Step Into / Step Over / Step Out (stepping through code line by line is not built yet). Inside the terminal, ↑ already recalls your previous commands — that is the real shell doing it, so it is not listed as a separate shortcut.
• DEBUGGER — set breakpoints in the editor gutter, see them all listed in the Debug panel (footer → Debug on a phone), jump to any one, and remove them individually or all at once. That part is fully real. Pausing execution and stepping through code line by line is NOT available yet, and the panel says so in plain words — it deliberately shows no greyed-out Continue/Step/Pause buttons, because controls nobody can press look like a broken feature rather than an unbuilt one.
• SPLIT EDITOR (desktop) — View → Split Editor, or Ctrl+\\, opens a SECOND editor beside the first so you can read two DIFFERENT files at once (a component beside the hook it calls, a test beside the code it tests, an API route beside the client that calls it). Each side is a full editor with its OWN tabs: open more files in either side, switch tabs independently, and close each tab with its own ✕. Editing works in both — each side edits the file IT is showing. Ctrl+S saves whichever side you are typing in, and Find, Format, Undo and the cursor position in the status bar all follow the side you last clicked into. Closing the last tab on the right (or View → Close Split Editor) collapses back to one editor. Split is desktop-only on purpose — two editors on a phone would leave each too narrow to read, so on a phone the command simply does nothing rather than showing an unusable layout.
• PREVIEW — live preview of the running app with hot-reload.
• PROBLEMS — real compile-error panel: when the live preview bundle fails, it lists the actual errors esbuild reported (file · line · message); click a problem to jump to that line in the editor. An empty list means the app genuinely compiled. Open it from the amber problem-count badge (bottom-right) or the "view problems" command.
• TERMINAL — a REAL, PERSISTENT shell (the same kind VS Code gives you), and you can open MANY at once: the "+ New" button inside the terminal opens a dropdown listing every terminal you have, with an X to close each one and "New Terminal" at the bottom. Each one is a genuine terminal session running in YOUR v5.0 sandbox, so: your directory stays where you left it (cd into a folder and the next command runs there), export/source and environment variables persist, output streams LIVE as it happens instead of only at the end, and there is NO 30-second cut-off — npm install, a full build or a dev server can run for as long as they need. Ctrl+C genuinely interrupts a running command. Colours, progress bars and full-screen programs (top, vim, git log) display properly, and interactive prompts (npm init, a password question, git rebase -i) can actually be answered because there is a real TTY on the other end. Switching between terminals keeps each one's scrollback, history and running command alive, so you can watch a dev server in one and work in another; a terminal also keeps running while you switch to Preview or Files, and reconnects with its full scrollback when you come back — even after your network drops or your phone locks. Closing the last terminal closes the panel; closing a terminal with its X is the only thing that ends that shell (that, or leaving it untouched and unwatched for 30 minutes). It needs a warm sandbox — start or continue a build in NavBharatAI Pro v5.0 to activate it; until then it honestly says the sandbox isn't active (it never fakes a prompt or output).
• GIT — version control panel: commit, push, pull, view diffs.
• LOGS — build and runtime output for debugging.
• SETTINGS — workspace and IDE configuration.`,
    howToUse: 'Open IDE from the sidebar. Use the panel tabs (Files, Editor, Preview, Problems, Terminal, Git, Logs) to develop your project. The Terminal runs real commands in your v5.0 sandbox (start a build first to activate it). When the preview fails to compile, open Problems (amber badge, bottom-right) to see the real errors and click one to jump to the line.',
    relatedFeatures: ['settings_git', 'ide_terminal', 'settings_logs', 'pro_chat'],
    keywords: [
      'ide', 'code studio', 'editor', 'code', 'files', 'preview', 'terminal', 'shell',
      'file explorer', 'code editor', 'git panel', 'build output', 'live preview',
      'problems', 'problems panel', 'errors', 'compile errors', 'error list', 'galti', 'error kahan hai',
      'split editor', 'split screen', 'split view', 'side by side', 'two files', 'do file ek sath',
      'dono file', 'saath saath', 'menu bar', 'view menu',
    ],
  },
  {
    id: 'ide_terminal',
    name: 'IDE Terminal / Shell',
    path: 'IDE → Terminal tab  (Code Studio)',
    description: 'A REAL, persistent shell inside your own workspace sandbox — the same kind of terminal you get in VS Code, not a one-command box. Because it is a genuine terminal session: your directory stays where you left it (cd into a folder and the next command runs there), environment variables and `export`/`source` persist, output streams LIVE as it is produced instead of appearing only at the end, and there is no 30-second cut-off, so npm install, a build or a dev server can run as long as they need. Ctrl+C really interrupts a running command. Colours, progress bars and full-screen programs (top, vim, git log) display properly, and interactive prompts (npm init, a password question, git rebase -i) can actually be answered. Open MANY terminals at once with "+ New" — each one is its own independent shell, so you can watch a dev server in one while running commands in another. A terminal keeps running while you switch to Preview or Files and reconnects with its full scrollback when you come back, even after your network drops or your phone locks.',
    howToUse: 'Open IDE → Terminal tab and type your command, then press Enter. Use "+ New" inside the terminal to open more terminals or switch between them (each has its own X to close it). Press Ctrl+C to stop a running command. Needs a warm sandbox — start or continue a build in NavBharatAI Pro v5.0 first; if the workspace has gone to sleep the terminal says so honestly and your saved files are safe.',
    relatedFeatures: ['ide', 'settings_logs'],
    keywords: [
      'terminal', 'shell', 'command line', 'bash', 'console', 'npm', 'run command', 'command chalao', 'npm install',
      'cd', 'ctrl+c', 'ctrl c', 'stop command', 'interrupt', 'live output', 'streaming', 'persistent shell',
      'real shell', 'multiple terminals', 'new terminal', 'naya terminal', 'terminal band karo', 'sudo', 'vim', 'top',
    ],
  },
  {
    id: 'ide_git',
    name: 'IDE Git Panel',
    path: 'IDE → Git tab',
    description: 'Visual git interface inside the IDE. Stage files, write commit messages, commit, push to remote, pull changes, and view the diff of modified files. Requires GITHUB_TOKEN in Secrets & API Keys for GitHub operations.',
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
    name: 'Test Runner',
    path: 'Home → Other AI → Developer Tools → Test Runner',
    description: 'Run real checks against your built app in a sandboxed preview and see pass/fail per test with the duration and reason. Ships with smoke checks (page renders, has a title, mobile viewport, interactive elements present) and lets you add your own JS assertion snippets; flaky tests (that pass and fail across runs) get flagged. Needs the app to be built/previewed first.',
    howToUse: 'Home → Other AI → Developer Tools → Test Runner. Press "Run All" to run the checks against your built app, or "+" to add your own test. Green = pass, red = fail with the reason.',
    relatedFeatures: ['ide', 'auto-test-generation', 'ide_preview'],
    keywords: ['test panel', 'test runner', 'run tests', 'testing tab', 'check app', 'test cases', 'qa', 'verify app', 'test karo', 'app test'],
    nav: { view: 'testing' },
  },
  {
    id: 'api-tester',
    name: 'API Tester',
    path: 'Home → Other AI → AI Tools → API Tester',
    description: 'A built-in HTTP client (like a mini Postman) to test whether an API endpoint actually works and to debug a failing API call in your app. Pick the method (GET/POST/PUT/DELETE/PATCH), enter the URL, add query params, headers, a JSON body and a Bearer token, then Send to see the REAL response — status code, headers, body and timing. Cross-origin APIs (which the browser blocks with CORS) work through NavBharatAI\'s built-in CORS-bypass proxy, which is SSRF-safe and stores nothing. Saved history stays only on your device and never keeps your auth token; an http:// (unencrypted) URL is clearly flagged. Mobile-friendly with a slide-out history. Use this whenever an API in your app returns an error, a 404/500, a CORS/network failure, or you\'re not sure if an endpoint works.',
    howToUse: 'Home → Other AI → AI Tools → API Tester. Choose the method, paste the endpoint URL, add any headers/body/token, keep "Route via NavBharatAI (bypass CORS)" ON for a cross-origin API, then tap Send to see the live status, headers and body. If a call in your app is failing, test that exact endpoint here to see the real response and status.',
    relatedFeatures: ['ide', 'ai_debugger', 'settings_database'],
    keywords: ['api tester', 'http client', 'postman', 'test api', 'test my api', 'endpoint', 'rest', 'request', 'api call', 'fetch test', 'api test karo', 'api fail ho raha', 'api not working', 'api is not working', 'api not responding', 'api chal nahi raha', 'api nahi chal raha', 'endpoint not working', 'network error', 'cors error', 'api chalega ki nahi', 'api problem', 'api check karo', 'test endpoint', 'api down', 'why is my api failing', 'api error'],
    nav: { view: 'api' },
  },
  {
    id: 'code_versioning',
    name: 'Code Versioning — Undo / Restore',
    path: 'Home → Other AI → AI Tools → Versioning',
    description: 'Your app\'s undo / go-back / restore history — the reliable way to reverse a change you don\'t want. Every build you make is automatically saved as a Restore point (durable, and synced across your devices), and you can also tap Save to name a checkpoint before trying something risky. If a change went wrong, the app broke after an edit, or you simply want it the way it was before, open Versioning, pick an earlier Restore point, and tap Restore — it puts those exact files back and refreshes the preview. Nothing is lost: you can always go back.',
    howToUse: 'To undo a change or go back to an earlier version: Home → Other AI → AI Tools → Versioning. Under "Restore points" choose the version from BEFORE the change you want to reverse (each build is listed with when it was made) and tap Restore — your app returns to exactly that state, and the preview refreshes. Tip: tap Save to name a checkpoint before trying something risky, so you always have a clean point to return to.',
    relatedFeatures: ['ide', 'ide_preview', 'pro_chat', 'ai_debugger'],
    keywords: [
      'code versioning', 'versioning', 'version history', 'checkpoint', 'snapshot', 'restore point',
      'undo', 'undo change', 'undo edit', 'undo it', 'undo this', 'undo my', 'undo the', 'revert', 'revert change',
      'revert this', 'roll back', 'rollback', 'go back', 'go back to previous', 'previous version', 'old version',
      'earlier version', 'restore', 'restore version', 'recover', 'get it back', 'bring it back', 'change it back',
      'take it back', 'this is worse', 'broke my app', 'broke the app',
      'undo karo', 'undo kaise', 'wapas lao', 'wapas la do', 'pehle jaisa', 'pehle jaisa kar do',
      'purana version', 'purana wapas', 'change wapas', 'change hata do', 'yeh change hata do',
      'edit wapas', 'peeche jao', 'app kharab ho gaya', 'app bigad gayi', 'galat ho gaya',
      'galti ho gayi', 'sab kharab', 'ulti ho gayi', 'restore karo',
    ],
    nav: { view: 'versioning' },
  },
  {
    id: 'code_minifier',
    name: 'Code Minifier & Optimizer — make your app smaller and faster',
    path: 'Home → Other AI → AI Tools → Minifier',
    description: 'Shrinks your app\'s code so it downloads and starts faster. The left panel lists the apps YOU built with NavBharatAI Pro — tap an app to see its files, tap a file and its real code opens automatically (no copying or pasting needed). The big "Optimise this code" button at the bottom does the work: comments and spare spacing are removed, names are shortened, and console.log / debugger lines are stripped (there is a checkbox to keep console.log while you are still testing). You then see the exact before → after size and the percentage saved. In the right-hand panel an "Apply to <file>" button writes the optimised version back into that file in your real app — and a Restore point is saved FIRST, so you can undo it any time from Versioning. You can also paste code straight in (JavaScript, TypeScript, React/TSX or CSS) if it is not from one of your apps, and Copy or Download the result. It uses a real code parser, so text inside your code — a website address, a message, a template — is never damaged; if a file has a syntax error it says exactly where and changes nothing.',
    howToUse: 'Home → Other AI → AI Tools → Minifier. On the left, tap your app → tap the file you want to make smaller (its code loads by itself). Tap the big "Optimise this code" button at the bottom. Check the saving shown (e.g. "42% smaller"), then tap the green "Apply to <file>" button on the right to save it into your app for real. Changed your mind? Home → Other AI → AI Tools → Versioning → Restore. To optimise code that is not from your app, just paste it into the middle box, pick the language, and tap Optimise.',
    relatedFeatures: ['code_versioning', 'ide', 'ai_debugger', 'build-performance-analytics'],
    keywords: [
      'minifier', 'minify', 'minify code', 'code minifier', 'optimizer', 'optimize code', 'optimise',
      'compress code', 'smaller file', 'reduce size', 'file size', 'bundle size', 'app size',
      'make app faster', 'app slow', 'loading slow', 'speed up app', 'remove console log',
      'remove comments', 'shrink code', 'apply minified', 'save minified code',
      'code chota karo', 'app halki karo', 'size kam karo', 'app fast karo', 'app slow hai',
      'code compress', 'minify kaise', 'file chhoti', 'console log hatao',
    ],
    nav: { view: 'minifier' },
  },
  {
    id: 'multi_page_builder',
    name: 'Multi-Page Builder — turn one page into a whole website',
    path: 'Home → Other AI → Developer Tools → Multi-Page',
    description: 'Builds a website with several pages (Home, About, Contact, Pricing, whatever you need) instead of a single page, and gives them all a shared navigation menu so visitors can move between them. Add and rename pages, choose a page type (content, form, dashboard, landing), pick the nav style (horizontal bar, sidebar, or a hamburger menu for phones), and set each page\'s title and description for search engines. When you are happy, choose which of YOUR apps it belongs to and tap "Save … pages into my app" — every page is written into that app as a real file, plus a shared stylesheet, all together under one restore point. Before (admin 2026-07-27) only the first page reached the screen and the rest were silently thrown away; now all of them are saved or none are. On a phone the three panels become one at a time with a Pages / Editor / Save switcher at the top.',
    howToUse: 'Home → Other AI → Developer Tools → Multi-Page. Use the Pages panel to add each page you want and rename it. Open the Editor to write its content and set its title/description. In "Save & Nav", pick the navigation style, choose your app, and tap "Save N pages into my app" — the pages appear as real files in that app. Made a mess? Home → Other AI → AI Tools → Versioning → Restore.',
    relatedFeatures: ['code_versioning', 'component_library', 'design_system', 'pro_chat'],
    keywords: [
      'multi page', 'multipage', 'multiple pages', 'many pages', 'website pages', 'add page',
      'about page', 'contact page', 'navigation', 'nav menu', 'menu bar', 'site map', 'website builder',
      'page banao', 'naya page', 'ek se zyada page', 'menu banao', 'website banao', 'pages jodo',
    ],
    nav: { view: 'multipages' },
  },
  {
    id: 'apk_builder',
    name: 'APK Builder — turn your app into a real Android app you can download',
    path: 'More (bottom tab) → Your App → Download APK  —  also Home → Other AI → AI Tools → APK Builder',
    description: 'THIS IS HOW NAVBHARATAI ITSELF MAKES AN ANDROID APP — when anyone asks how to get their app as an APK, put it on a phone, or publish to the Play Store (in ANY language, phrased ANY way), the FIRST answer is ALWAYS this built-in APK Builder (Other AI → AI Tools → APK Builder, or the shortcut More → Download APK). NavBharatAI builds the real, installable app FOR the user — they NEVER need Android Studio, a computer, developer tools, the Capacitor CLI, or to set up GitHub Actions themselves. (GitHub is only where NavBharatAI runs the build under the hood; a one-time GitHub connect is the only thing the user does, and a signing key only for the Google Play bundle.) Never send a user to external tools or a manual GitHub setup first — this builder is the whole route. Turns an app you built with NavBharatAI Pro into a genuine Android app file. It is ONE simple screen, not a multi-step wizard. At the top you choose WHICH of your apps to package. Then a single "App Information" form: the app name, package name, background colour and icon — the icon can be uploaded from your phone, pasted straight from AI Image Gen (tap "Make icon" to go there, copy the image it creates, come back and tap Paste), or picked from the emoji row as a quick placeholder; it checks the picture is square and at least 512×512 the moment you add it, so the Play Store never rejects it later. Everything you set here genuinely goes into the built app — the name, the package, the icon and the background colour all reach the real Android build directly below the form (there is no throwaway "config file" step any more). At the bottom tap "Get my app ready to build": NavBharatAI first CHECKS YOUR APP COMPILES right here — before anything goes anywhere — and if it finds a code error it repairs it itself and saves the fix into your app, so only a working app is ever sent out. Then it packages everything and puts it into YOUR OWN GitHub account, adds the build instructions, and starts the build. The build itself runs on GitHub\'s real machines — that is the only place an Android app can actually be compiled and signed — and when it finishes, the real .aab and .apk are downloaded right here. The .aab is what Google Play accepts; the .apk is the one you can send to someone to install on their phone directly. There are TWO buttons, for two different needs. "Build my APK now" is ONE CLICK and needs NOTHING from you — no signing key, no secrets, no setup: it produces an .apk you download here and install straight onto any Android phone (allow "install from unknown sources"), and you can send it to anyone. That file cannot be uploaded to Google Play. For Play, use "Build the Play Store bundle", which produces the .aab Google accepts — and THAT one needs your signing key, added to the repository as secrets. That key is your app\'s permanent identity on the Play Store — if NavBharatAI held it and lost it, you could never publish an update again — so it stays with you, NavBharatAI never sees it, and the built-in guide walks you through creating it step by step. There is also a link to open your app\'s builds directly on GitHub, if you would rather download the file from there. THERE IS ALSO AN iPHONE PATH: once you add your Apple credentials as the repository secrets the screen lists (the guide walks through it), a "Build for iPhone (TestFlight)" button builds the signed iOS app on a real Apple machine inside GitHub and sends it straight to YOUR TestFlight. An iPhone app can only be installed through TestFlight or the App Store — Apple allows no other way — so there is no file to download for iOS; a green build tells you it reached TestFlight and points you to App Store Connect to invite testers. The same live step-by-step progress is shown for the iPhone build too. THE BUILD LOOKS AFTER ITSELF: once you tap a build button there is nothing more to do — while it runs you see the REAL step-by-step progress read live from the build (a checklist that ticks off as it goes — installing your app\'s libraries → building your app → preparing the project → compiling → packaging), a percentage, one line saying exactly what is happening now, and how long it has been running against how long these builds usually take. If the build fails, NavBharatAI repairs it itself in two passes: first instant rule-based fixes for the packaging problems it recognises (build instructions, a missing build step, a wrong output folder, out-of-date Java, not enough memory, mismatched packaging libraries), and when the rules cannot name the problem, NavBharatAI\'s engine reads the failing step\'s log and the files involved — including your app\'s own code, which NavBharatAI wrote — and writes the fix itself. Every repair lands in your repository as a normal named commit you can see and undo, and the build starts again by itself — up to three tries. It never creates a signing key for you: that key is your app\'s permanent identity and stays only with you, so a missing Play Store signing key is the one failure handed back to you, explained in plain language. PRICE: every built app file — .apk, Play Store .aab, and iOS .ipa alike — costs ₹1, taken from your wallet when you download the finished file. One charge per build (downloading the same file again is free), and a failed build costs nothing.',
    howToUse: 'FASTEST WAY: tap "More" in the bottom bar → Your App → "Download APK". (The longer way is Home → Other AI → AI Tools → APK Builder — it opens the same screen.) 1) Pick your app from the dropdown at the top. 2) In the one App Information form, set the name, package name, background colour and icon (Upload from your phone, or tap "Make icon" → create one in AI Image Gen → Copy → come back → Paste) — all of it feeds the real build just below. 3) Connect GitHub if you have not already. The build panel shows WHICH account is connected ("Connected as @your-account"), with a short "Switch" button — if it is the wrong account (for example you have two GitHub accounts), first tap "Log out of GitHub", then tap "Switch" and sign in with the correct account. The account shown is the one that will own the build, so make sure it is right before building. 4) Tap "Get my app ready to build" — your app is sent to your own GitHub (this one step is shared by both paths). 5) To just get the app on a phone: tap "Build my APK now" — nothing else to set up — wait 3–6 minutes and tap Download; copy the .apk to an Android phone and open it. 6) ONLY if you are publishing on Google Play: add your signing key as the repository secrets it lists (tap "Show me how, step by step"), then tap "Build the Play Store bundle" to get the .aab. 7) FOR iPHONE (App Store / TestFlight): add your Apple credentials as the repository secrets the iPhone section lists (the same guide covers them), then tap "Build for iPhone (TestFlight)" — the signed iOS app is built on a real Apple machine and sent straight to your TestFlight; there is no file to download (Apple only allows installing through TestFlight or the App Store), so you invite testers in App Store Connect. You do NOT need to start the build on GitHub yourself and you do NOT need to retry a failed build — the button starts it, and if it fails for a reason NavBharatAI can fix, it fixes it and runs it again on its own while the live steps and percentage keep moving.',
    relatedFeatures: ['ai_image_gen', 'app_store_publisher', 'code_versioning', 'pro_chat'],
    keywords: [
      'apk', 'apk builder', 'aab', 'android app', 'build apk', 'download apk', 'make apk',
      'apk kaise', 'apk kaise banaye', 'apk kaise banau', 'apk kaise nikale', 'apk kaise milegi',
      'apk download', 'apk chahiye kaise', 'app download kaise kare', 'android app kaise banaye',
      'phone me install', 'mobile app file', 'android file', 'apk file kaha se', 'apk file',
      'play store', 'google play', 'publish app', 'app banao', 'android banao', 'apk banao',
      'app store par daalo', 'play store par daalo', 'playstore par kaise daale', 'signed apk',
      'keystore', 'signing key', 'app icon', 'icon upload', 'icon banao', 'mobile app', 'phone app',
      'install app', 'apk chahiye', 'app file', 'real app', 'native app',
      'convert to apk', 'app ko apk', 'apk me convert', 'export apk', 'generate apk', 'apk export',
      'app ko phone me', 'app ko android', 'app ko phone me kaise', 'apk banani hai', 'app publish kaise',
      'how to make apk', 'how to build android app', 'how to get apk', 'turn app into apk',
      'app ki apk', 'apk file chahiye',
    ],
    nav: { view: 'apk' },
  },
  {
    id: 'cicd_pipeline',
    name: 'CI/CD Pipeline — make your app test and deploy itself on every push',
    path: 'Home → Other AI → Publish & Deploy → CI/CD Pipeline',
    description: 'Builds a real, runnable CI file by picking steps (checkout, install, test, build, deploy, notify) and setting each one\'s command and environment variables. It writes GitHub Actions, Google Cloud Build or GitLab CI. The file is genuine — the provider runs it, NavBharatAI does not simulate anything. You can copy it, download it, or COMMIT IT STRAIGHT INTO YOUR OWN GITHUB REPOSITORY, which is what actually makes it run: a workflow sitting in your Downloads folder does nothing. It is committed to that repository\'s own default branch, at the exact path the provider looks for (.github/workflows/cicd.yml for GitHub Actions, cloudbuild.yaml for Cloud Build). A GitLab file cannot be committed for you — NavBharatAI connects to GitHub only — so for GitLab it says so plainly and you download the file instead. Keep API keys and passwords in GitHub Secrets, never in the YAML itself.',
    howToUse: 'Home → Other AI → Publish & Deploy → CI/CD Pipeline. 1) Set your app name and environment, and pick the platform. 2) Tap a step to change its command or add environment variables; add or remove steps as needed. 3) Open the YAML preview, choose your repository from the dropdown, and tap "Commit to my repo" — connect GitHub first if you have not. GitHub starts running it on your next push. Or use Copy / Download if you would rather add the file yourself.',
    relatedFeatures: ['apk_builder', 'secrets_keys'],
    keywords: [
      'ci cd', 'cicd', 'ci/cd', 'pipeline', 'github actions', 'workflow', 'cloud build', 'gitlab ci',
      'auto deploy', 'automatic deploy', 'auto test', 'build pipeline', 'deploy karo', 'yaml',
      'har push par deploy', 'automation', 'continuous integration', 'continuous deployment',
    ],
    nav: { view: 'cicd' },
  },
  {
    id: 'nav_app_store',
    name: 'Nav App Store — publish your Android app, and install apps others made',
    path: 'Home → Other AI → Monetization & Team → Nav App Store (or the direct link navbharatai.com/store — same as navbharatai.com/?view=appstore)',
    description: 'NavBharatAI\'s own app store. BROWSE shows every published app — tap one to read what it does, see exactly what it will be allowed to do on your phone, and download the .apk. PUBLISH lets you upload your own .apk: you fill in your name, a contact email, the app name, version, description and category, choose the file, and confirm you have the right to publish it. Publishing is FREE (₹0). MY APPS shows where each of your submissions stands. Every upload goes through the same checks, in this order: NavBharatAI first confirms the file really is a properly signed Android app (an unsigned one is refused, because no phone can install it), records its exact fingerprint, and reads the permissions it asks for; then it is scanned for malware against around 70 security engines. An app the engines call malicious is refused and never stored. An app that cannot be scanned is NOT uploaded — never published unscanned. An app that passes still does not go live: it waits for a person to check it, because malware built for one particular attack is often unknown to every engine on the day it appears. Only a NavBharatAI reviewer can publish an app. Apps that ask for sensitive permissions — reading your text messages and bank OTPs, controlling the screen, installing other apps, drawing over your bank app — are clearly marked, both for the reviewer and for anyone about to download. An app that turns out to be harmful is removed and its file deleted, not just hidden.',
    howToUse: 'Home → Other AI → Monetization & Team → Nav App Store. To install something: stay on Browse, tap an app, read what it can do on your phone, then tap "Download .apk" — Android will ask you to allow installs from your browser. To publish your own: open the Publish tab, fill in your details and your app\'s details, choose your .apk file, tick the confirmation, and tap "Submit my app" (the upload shows a live percentage and is sent in pieces, so the file size is no longer the blocker). The size limit shown on the form is the size that can actually be PUBLISHED — it is the smaller of the store cap and what the malware scanner can accept, because an app that cannot be scanned is never published. It is scanned straight away and then waits for a reviewer, usually a day. Watch its progress under My apps. If you built your app with NavBharatAI, you do NOT need to download and re-upload it: on the build screen (Other AI → Publish & Deploy → App Builder), once your app is built there is a \"Publish to Nav App Store\" button right next to Download — NavBharatAI takes the app straight from the build, so there is no file to handle. It is still scanned for malware and still waits for a reviewer, exactly like an uploaded app — publishing from a build earns no shortcut past either check. SHAREABLE LINK: the store also opens directly from navbharatai.com/store (or navbharatai.com/?view=appstore) — this lands anyone straight on the public Browse tab without logging in, so it is the link to share when you want someone to see whether an app is live.',
    relatedFeatures: ['apk_builder', 'pro_chat'],
    keywords: [
      'nav app store', 'navbharat app store', 'app store', 'apna store', 'upload apk', 'publish app',
      'share app', 'download app', 'install app', 'apk upload', 'apk download', 'app publish karo',
      'apni app dalo', 'app upload karna hai', 'store me daalo', 'doosron ki app', 'free publish',
      'app review', 'malware', 'app safe hai', 'permissions', 'sideload', 'apk install',
    ],
    nav: { view: 'appstore' },
  },
  {
    id: 'nav_store_instant_apps',
    name: 'Instant apps on the Nav App Store — publish in one click, others run it in their browser',
    path: 'NavBharatAI Pro v5.0 → Publish → "Put it on the Nav App Store" (the green Instant card, next to "Make an Android app")',
    description: 'Publish the app you built in v5.0 straight to the Nav App Store as an INSTANT app: one click, no APK, no hosting, no deploy — other people open it from the store (or your share link) and it runs immediately, full-screen, in their own browser. What ships is a snapshot of your app taken at publish time, so your later edits never break it for viewers until you publish again (same link, new version). Your source files, your .env and your saved keys NEVER ship — and publishing is REFUSED with the exact file and line if a real API key is found hardcoded in the app, because published code is visible to every viewer. Apps that need a live server cannot be instant apps; the publish button says so honestly and points to hosting instead. Your share link works the moment you publish; appearing in the store\'s public Browse list happens after a quick human review (same discipline as the APK store). You can make an app private with a password (checked on our server — the files are not sent without it), copy its link, see how many times it ran, or unpublish it (which really deletes the published files) from Nav App Store → My apps → My instant apps. Viewers can report a bad app from inside the player; a person reviews every report. REMIX — every instant app has a \'Make it yours\' button: one tap copies that app into YOUR OWN NavBharatAI Pro v5.0, ready to edit (works even signed out). SELLING APPS — COMING SOON: right now EVERY app on the store is FREE to remix, for everyone. Nobody is charged, no wallet is touched, and no price can be set — "Selling — coming soon" appears where the price control will be. The version being built pays the creator DIRECTLY INTO THEIR OWN BANK (their own payment account, money never held by NavBharatAI), which is why it is worth waiting for rather than shipping a version where earnings could only be spent on NavBharatAI credit. Do not tell a user they can sell an app or set a price today — they cannot. API KEYS ARE NEVER SOLD WITH AN APP: the original creator\'s API keys physically cannot ship (publishing is refused if a key is found in the code, and .env files never publish) — a buyer/remixer always brings their OWN keys, and the buy screen says so before any money moves; after remixing, NavBharatAI asks for your keys when you build. SHARED DATA — apps built with window.NavData (chat, guestbook, leaderboard, bookings) genuinely share their rows between all viewers once published on the store; in the creator\'s preview the same app works with per-device data until it is published. GAME MODE — while playing any instant app there is a game-controller button in the top bar. It is ON by default, which stops long-press text selection, the copy menu and double-tap zoom, so a game feels like an app instead of a web page. Tap it once to turn game mode OFF when you want to select and copy text (a recipe, a story, a reference app); the button changes to a text cursor. Your choice is remembered separately for each app, and switching never restarts the app — a game in progress keeps running.',
    howToUse: 'Build your app in NavBharatAI Pro v5.0, then open Publish (the rocket) → find the green "Put it on the Nav App Store" card next to "Make an Android app" → type the store name → tap "Publish to the store". The share link is copied automatically — send it to anyone; it opens the app full-screen in their browser with nothing to install. Manage it later under Nav App Store → My apps (copy link, make private with a password, unpublish). A share link looks like navbharatai.com/store/app/<id> and needs no login to run a public app.',
    relatedFeatures: ['nav_app_store', 'pro_chat'],
    keywords: [
      'instant app', 'web app publish', 'one click publish', 'store par daalo', 'bina apk', 'no install app',
      'browser me chalao', 'app share karo', 'share link', 'app link bhejo', 'publish to store',
      'ek click publish', 'app live karo', 'private app', 'app password', 'unpublish', 'app report',
      'instant apps', 'run in browser', 'doston ko app bhejo',
      'remix', 'make it yours', 'app copy karo', 'remix price', 'app becho', 'app se kamai',
      'paid remix', 'non refundable', 'wallet earning', 'creator earning', '80 percent',
      'shared data', 'chat app share', 'navdata',
      'game mode', 'text select band', 'copy nahi ho raha', 'long press select', 'zoom band',
      'text copy karna hai', 'selection on off', 'game khelte waqt select',
    ],
    aiSurface: 'pro_chat',
    nav: { view: 'appstore' },
  },
  {
    id: 'monetization',
    name: 'Monetize — start taking money in your app',
    path: 'Home → Other AI → Monetization & Team → Monetize',
    description: 'Adds a real, working payment button to a page of your app in three taps. FIRST you choose which app: one you built with NavBharatAI Pro, or one of your own GitHub repositories — then the page the button should go on. THEN you choose how customers pay. UPI is first and is the simplest: one field (your UPI ID), no signup, no fees, no server, and the money reaches your bank directly — but UPI cannot tell your website that a payment happened, so you check your bank app before you deliver an order, and Monetize says so plainly. Razorpay and Cashfree accept cards, netbanking and wallets and give automatic confirmation, but need an account and a small server file (which Monetize writes for you as server/payments.js). Stripe is for customers outside India; it cannot take Indian UPI. AdSense shows ads instead of charging, once Google approves your site. FINALLY it writes the button into your real page — a NavBharatAI app is saved with a restore point you can undo, a GitHub repository gets a real commit — and your keys are encrypted into Settings → Secrets & API Keys, never written into your app\'s files. The generated payment code decides the price ON YOUR SERVER and verifies the payment signature there, so a customer cannot change the amount or fake a successful payment.',
    howToUse: 'Home → Other AI → Monetization & Team → Monetize. 1) Pick "App built here" or "GitHub repo", choose the app and the page, tap Continue. 2) Tap the payment method — tap UPI if you just want money in your bank. 3) Fill in the fields (UPI needs only your UPI ID; each field says exactly where to find it in the provider\'s dashboard) and tap "Add it to my app". 4) Read the next steps it shows — for Razorpay, Cashfree or Stripe you must put the server/payments.js file it created onto your server and set your real prices inside it.',
    relatedFeatures: ['secrets_keys', 'database_settings', 'pro_chat'],
    keywords: [
      'monetize', 'monetization', 'payment', 'payments', 'paise', 'paisa', 'kamai', 'earning',
      'upi', 'upi id', 'razorpay', 'cashfree', 'stripe', 'adsense', 'ads', 'gateway',
      'payment button', 'paise kaise lu', 'payment kaise lagaye', 'app se kamao', 'checkout',
      'pay button', 'sell', 'bechna hai', 'subscription', 'pricing', 'money',
    ],
    nav: { view: 'monetize' },
  },
  {
    id: 'component_library',
    name: 'Component Library — ready-made pieces you can add to your app',
    path: 'Home → Other AI → Developer Tools → Components',
    description: 'A collection of ready-made, good-looking pieces — buttons, cards, hero sections, login and sign-up forms, contact forms, navigation bars, pricing tables, alerts, modals and more — grouped by category, plus a second tab of popular CDN libraries you can load into your page. Tap any component to see a live preview and tweak it (colour, text size, corner rounding). At the top you choose WHICH of your apps and WHICH page a component goes into; "Add to my app" then writes it into that real page, at the end of the body, with a restore point saved first. A library you have already loaded is never added twice. If a component is styled with Tailwind classes and your page does not load Tailwind, it tells you so instead of quietly looking broken. On a phone the categories become a swipeable row and the detail panel moves below the grid.',
    howToUse: 'Home → Other AI → Developer Tools → Components. At the top pick your app and the page to add to. Browse a category or search, tap a component to preview it, then tap "Add to my app" — it is written into that page for real. Use the CDN Libraries tab to add a library (jQuery, Chart.js, etc.) the same way. To undo: Home → Other AI → AI Tools → Versioning → Restore.',
    relatedFeatures: ['design_system', 'multi_page_builder', 'code_versioning', 'figma_importer'],
    keywords: [
      'components', 'component library', 'ready made', 'templates', 'ui kit', 'button', 'card',
      'hero section', 'login form', 'signup form', 'contact form', 'navbar', 'pricing table', 'modal',
      'add component', 'insert component', 'cdn library', 'jquery', 'chart js',
      'component jodo', 'button banao', 'form chahiye', 'design ready', 'banaya banaya',
    ],
    nav: { view: 'components' },
  },
  {
    id: 'design_system',
    name: 'Design System — one set of colours, fonts and spacing for your whole app',
    path: 'Home → Other AI → Developer Tools → Design System',
    description: 'Sets the colours, text sizes, spacing, corner rounding and shadows your app uses everywhere, so it looks consistent instead of every screen being slightly different. Tap a colour to change it and see live previews of a button, card, badge and input using your choices. The Export tab shows the CSS and a matching Tailwind config, and lets you choose one of YOUR apps and a file (a .css or .html) to save the tokens into for real — a restore point is saved first, and running it again updates the same block instead of adding a second copy. Your token set is remembered on this device between visits.',
    howToUse: 'Home → Other AI → Developer Tools → Design System. On the Colors tab, DESCRIBE YOUR BRAND in one line (e.g. "a calm, trustworthy clinic for families") and tap "Create palette" — NavBharatAI picks a whole matching colour set for you instead of you guessing one swatch at a time. It never overwrites a colour with something unreadable, keeps your own notes on each colour, and tells you exactly how many changed; nothing reaches your real app until you use the Export tab. You can still tap any swatch to change it by hand; check Typography and Spacing too. Open the Export tab, pick your app and the file to add the tokens to (usually your main .css or index.html), and tap "Save tokens into my app". Undo any time from Home → Other AI → AI Tools → Versioning.',
    relatedFeatures: ['dark_mode_generator', 'component_library', 'code_versioning'],
    keywords: [
      'design system', 'design tokens', 'theme', 'colors', 'colour scheme', 'brand colors', 'palette',
      'fonts', 'typography', 'spacing', 'border radius', 'shadows', 'style guide', 'consistent design',
      'tailwind config', 'css variables',
      'rang badlo', 'color change', 'theme banao', 'font badlo', 'design set karo', 'brand color',
    ],
    nav: { view: 'designsys' },
  },
  {
    id: 'dark_mode_generator',
    name: 'Dark Mode Generator — add a dark theme to your app',
    path: 'Home → Other AI → Developer Tools → Dark Mode Gen',
    description: 'Reads the colours your app already uses and works out a matching dark version of each one, then builds the CSS for it. Choose a ready-made dark palette (GitHub Dark, Dracula, Nord, Solarized, Monokai) or adjust any individual colour yourself, and pick how it should switch: automatically with the phone\'s dark-mode setting, with a toggle button added to the page, or with the browser\'s built-in colour-scheme. A side-by-side light/dark preview shows the result. Then choose one of YOUR apps and a page, and "Save dark mode into my app" writes it in for real, after saving a restore point. Running it again updates the same block rather than stacking another copy, and turning the toggle option off removes the button it added.',
    howToUse: 'Home → Other AI → Developer Tools → Dark Mode Gen. Tap Auto-Generate, pick the dark palette you like, and change any colour you want. Choose your app and the page at the bottom, then tap "Save dark mode into my app". To reverse it: Home → Other AI → AI Tools → Versioning → Restore.',
    relatedFeatures: ['design_system', 'code_versioning', 'settings_general'],
    keywords: [
      'dark mode', 'dark theme', 'night mode', 'light mode', 'theme toggle', 'dark karo',
      'add dark mode', 'dark mode banao', 'kala theme', 'night theme', 'raat wala mode',
      'color scheme', 'prefers-color-scheme', 'dark mode chahiye',
    ],
    nav: { view: 'darkmode' },
  },
  {
    id: 'figma_importer',
    name: 'Figma Import — turn a Figma design into a real page',
    path: 'Home → Other AI → Developer Tools → Figma Import',
    description: 'Connects to a real Figma file with your Figma URL and personal access token, lists its pages and frames, and converts a frame you choose into working HTML — either plain CSS or Tailwind classes — along with the colours and fonts it used. You can then save it into one of YOUR apps: choose a new file and it becomes a complete page, or choose an existing page and the design is added to it, keeping what was already there. A restore point is saved first either way. You can also copy the code, open it in a preview, or hand it to NavBharatAI Pro with an instruction to turn it into a working app. On a phone the design tree sits above the result instead of squeezing beside it.',
    howToUse: 'Home → Other AI → Developer Tools → Figma Import. Paste your Figma file URL and your Figma personal access token (Figma → Settings → Personal access tokens), tap "Connect & Fetch", expand a page and tap the frame you want, then tap Import. Pick your app and a file name under "Save this design into your app" and tap "Save into my app". You need a Figma account and your own token — NavBharatAI cannot read a Figma file without it.',
    relatedFeatures: ['component_library', 'pro_chat', 'code_versioning', 'design-to-code'],
    keywords: [
      'figma', 'figma import', 'figma to code', 'figma to html', 'import design', 'design import',
      'figma file', 'figma token', 'frame', 'convert design', 'design se code',
      'figma se app', 'design upload', 'figma laao', 'design ko code',
    ],
    nav: { view: 'figma' },
  },
  {
    id: 'voice_to_app',
    name: 'Voice to App (speak your app idea)',
    path: 'NavBharatAI Pro v5.0 → the 🎙️ microphone button in the chat composer (tap to speak → your words type straight into the message box)',
    description: 'Speak your app idea — in Hindi or English — instead of typing it. The 🎙️ mic sits right in the NavBharatAI Pro v5.0 chat composer: tap it and your speech is transcribed live INTO the message box (tap again to stop; it pulses red while listening), then press Send to start the genuine live build (real files, live preview, everything the Pro engine does). Voice capture needs a browser that supports speech recognition (Chrome/Edge/Android WebView do); without it you can still type. (A standalone Voice-to-App page with quick enhancers also exists and the Offline AI can open it, but the built-in mic in the Pro chat is the main, always-available way.)',
    howToUse: 'Open NavBharatAI Pro v5.0. Tap the 🎙️ mic button next to the message box and describe your app (Hinglish works); tap again to stop. Edit the text if needed, then press Send to start the real build.',
    relatedFeatures: ['pro_chat', 'agentv3_builder', 'project-templates'],
    keywords: ['voice to app', 'voice', 'bol kar app', 'bolkar', 'speech', 'mic', 'microphone', 'awaz se app', 'speak app', 'voice se banao', 'bol do'],
  },
  {
    id: 'ai_debugger',
    name: 'AI Debugger',
    path: 'Home → Other AI → AI Debugger',
    description: 'Two modes. (1) Single Error: paste any error message (and optionally the related code) and get a REAL analysis from NavBharatAI\'s engine — exact root cause, a working fix, step-by-step explanation, and prevention tips. (2) Full App Scan: pick a whole app — one you built with NavBharatAI Pro, a connected GitHub repository, or the project open in the editor — and NavBharatAI reads every file and lists the real problems it finds, each with the exact file and line, a severity (critical/high/medium/low), and a concrete fix suggestion. It combines THREE layers: a deterministic line scanner (verified findings: leftover debug code, swallowed errors, possible hardcoded secrets, unfinished TODOs, unsafe patterns), a cross-file graph analyzer that understands the whole app (missing package.json dependencies, broken imports, dead files), and a deep AI pass over your source. You get a project HEALTH score (0–100) with a verdict, and can tap "Investigate & fix" on any finding for its root cause + a full fix. For an app you built with NavBharatAI Pro, tap "Auto-fix these in NavBharatAI Pro" to open that app in the NavBharatAI Pro page with all the fixes ready to apply. Honest by design: real counts, an explicit note if the deep pass is briefly unavailable, and never a fake result.',
    howToUse: 'Home → Other AI → AI Debugger. For a single error: keep the "Single Error" tab, pick the error category, paste the error text, and tap Analyze. For a whole app: switch to "Full App Scan", choose a source (your NavBharatAI Pro app, a GitHub repo, or the open project), and tap "Scan for problems" — findings stream in ranked by severity with file:line and a suggested fix. Connect GitHub in Code Studio first to scan a private repo.',
    relatedFeatures: ['ide', 'settings_logs', 'pro_chat'],
    keywords: ['ai debugger', 'debugger', 'debug', 'error fix', 'fix error', 'error samjhao', 'error kya hai', 'bug fix', 'stack trace', 'exception', 'error analysis', 'galti dhundo', 'full app scan', 'scan app', 'debug whole app', 'pure app ka error', 'code review', 'find bugs', 'app me problem', 'github repo debug', 'saari galtiyan dhundo', 'app scan'],
  },
  {
    id: 'ai_image_gen',
    name: 'AI Image Gen',
    path: 'Home → Other AI → AI Image Gen',
    description: 'Generate REAL images with NavBharatAI\'s own image engine — logos, banners, app icons, illustrations, avatars, backgrounds, thumbnails. Write a prompt (specific = better), pick a style (Minimal / Vibrant / Dark / Gradient / Flat / 3D), a size/aspect (Square, Wide/OG, Portrait, App Icon), and optional color hints, then Generate. The image is created on NavBharatAI\'s server and returned to you — copy it or download it as PNG. Your generation history is SAVED on your device (it stays under "Recent" after you reload or reopen the app), and "Clear" removes it. Honest by design: if generation is briefly unavailable it tells you plainly — it never shows a placeholder pretending to be your image.',
    howToUse: 'Home → Other AI → AI Image Gen. Describe the image (e.g. "Modern fintech app logo with blue gradient and rupee symbol"), choose style + size, tap Generate. Use the copy/download buttons on the result; tap a Recent thumbnail to bring one back — your Recent history is saved and persists across reloads (Clear removes it). You can also just ASK any NavBharatAI AI to make an image: NavBharatAI Free makes one right in the chat for free, and NavBharatAI Pro, Doctor AI and every other Professional point you straight here to this tool.',
    relatedFeatures: ['pro_chat', 'ide'],
    keywords: ['image gen', 'ai image', 'image generate', 'photo banao', 'logo banao', 'banner', 'icon banao', 'image banao', 'picture', 'illustration', 'thumbnail', 'generate image', 'tasveer'],
  },
  {
    id: 'bot_builder',
    name: 'Bot Builder',
    path: 'Home → Other AI → Bot Builder',
    description: 'Design a chatbot conversation visually and then PUBLISH it as a REAL bot on Telegram/WhatsApp. Add nodes — Start, Message (with tappable buttons), Button Menu, Condition, API Call, End — and connect them into a flow; test the exact flow in the built-in Simulator; export the flow as JSON if you want it elsewhere. Then tap "Go Live": for Telegram, paste the token from @BotFather and the bot is live in seconds (hosted on NavBharatAI, running your exact flow with quick-reply buttons, branching conditions and real API calls); for WhatsApp, connect your Meta Cloud API number. Real deployment — not a mockup.',
    howToUse: 'Home → Other AI → Bot Builder. Fully touch/mobile-friendly: tap a node type in the bottom palette bar to add it (Start, Message, Button Menu, Condition, API Call, End), tap a node then use its floating toolbar (Edit / Connect / Move / Duplicate / Delete), and tap a connection line to delete it. To add tappable BUTTONS to a message: tap a Message node → Edit → under "Buttons" tap "Add button" (a Button Menu node also has buttons via "Add Option"); then connect each button to its next node (tap node → Connect → tap target). Try the whole flow with Simulate. To ship it, tap "Go Live" — publish the flow as a REAL Telegram bot in seconds (paste the token from @BotFather; it hosts on NavBharatAI and runs your exact flow with quick-reply buttons), or connect a WhatsApp Cloud API number (paste the Meta access token + Phone Number ID; it returns the Callback URL + Verify token to paste in Meta). Stuck? Tap "Help" for a step-by-step NavBharatAI guide (send it a screenshot).',
    relatedFeatures: ['pro_chat', 'voice_to_app', 'project-templates'],
    keywords: ['bot builder', 'chatbot', 'bot banao', 'whatsapp bot', 'telegram bot', 'chat bot', 'conversation flow', 'bot flow', 'chatbot banao', 'bot design'],
  },
  {
    id: 'project-templates',
    name: 'Project Blueprints & Templates Gallery',
    path: 'Sidebar → Templates  OR  Code Studio → Templates',
    description: 'A gallery of ready-to-build Project Blueprints (including Bharat-first templates: UPI Payment App, Hindi Language App, GST Invoice Generator, Startup Registration Tracker, and two GAME blueprints — a 3D arena survival game and a 2D endless-runner arcade game, both fully playable with score, sound, pause and phone controls) plus your own saved templates. Selecting a blueprint loads a detailed starter prompt so you can build it instantly.',
    howToUse: 'Open Templates from the sidebar, browse the blueprint cards, and click one to start building from it. Save your own current project as a reusable template from the same panel.',
    relatedFeatures: ['pro_chat', 'quick-start-gallery', 'engineer_ai'],
    keywords: ['templates', 'blueprints', 'project templates', 'starter', 'examples', 'upi', 'gst', 'hindi app', 'startup', 'my templates', 'template gallery', 'readymade', 'banaya banaya', 'game', 'game banao', '3d game', '2d game', 'arcade', 'khel'],
  },

  // ─── PROFESSIONALS HUB ───────────────────────────────────────────────────
  {
    id: 'professionals',
    name: 'Professionals Hub',
    path: 'Sidebar → Professionals',
    description: 'The hub for specialized professional AI assistants. Currently hosts Doctor AI (clinical decision support), NavBharatAI Pro v5.0 (the autonomous app builder), and a large roster of expert professionals. Future AI assistants will appear here. Every config-driven professional (Teacher, Lawyer, CA, Mentor, etc.) supports FILE ATTACHMENTS: click the paperclip (or paste a file) to send images, PDFs, Word/Excel/PowerPoint documents, ZIPs, or text/code files — the AI reads their real content and answers about them.',
    howToUse: 'Open Professionals from the sidebar, then choose the AI specialist you need. To share a file, click the paperclip button next to the message box (up to 4 files, 10 MB each) or paste an image directly.',
    relatedFeatures: ['doctor_ai', 'engineer_ai', 'professionals_cost'],
    keywords: ['professionals', 'specialists', 'experts', 'professional ai', 'specialist ai', 'doctor ai engineer ai', 'attach file', 'upload file', 'send photo', 'send pdf', 'file bhejo', 'photo bhejo', 'document upload'],
  },
  {
    // ADMIN 2026-08-10: "pass system hata do." This entry used to describe a ₹99/month "Professional
    // Pass" for unlimited professionals. It is REPLACED rather than deleted, because the keywords are
    // exactly what a user types when they ask about cost — leaving them unanswered would send every
    // AI in the app back to guessing, and an AI that still offers a removed subscription is worse than
    // no entry at all.
    id: 'professionals_cost',
    name: 'What the professionals cost',
    path: 'Any Professional chat → the "X/50 free today" counter in the header · Sidebar menu → "Wallet & Billing" to add credit',
    description: 'There is NO separate subscription for the professionals — the Professional Pass was removed on 2026-08-10. Every professional (Teacher, Lawyer, CA, Doctor, Mentor and the rest) draws on the SAME single balance as everything else in NavBharatAI, so there is nothing extra to buy and no second quota to keep track of. Signed-in users also get a set number of free professional messages per day (default 50, shared across all professionals combined); the header shows how many are left. What you are charged is what the work really cost: a short question answered by the fast economy engine costs nothing at all, a longer or more complex one costs a little, and a request that fails is never charged. Small charges through the day are grouped into one line in the wallet ledger so the recharge history stays readable.',
    howToUse: 'Just use any professional — the header shows "X/50 free today". If the free messages run out or the balance is empty, the screen says so and offers "Add credit" (Sidebar menu → "Wallet & Billing"), which is the only thing to buy. Sign-in is required to use professionals.',
    relatedFeatures: ['professionals', 'wallet_billing'],
    keywords: ['professional pass', 'pass', 'subscription', 'unlimited professionals', 'buy pass', '99', 'monthly', 'paywall', 'free messages', 'daily limit', 'subscribe', 'pass lo', 'unlimited', 'professional subscription', 'kitne free', 'limit', 'professional cost', 'kitna paisa', 'charge', 'kitne ka hai'],
    aiSurface: 'nbi_chat',
  },

  // ─── SETTINGS ─────────────────────────────────────────────────────────────
  {
    id: 'home_other_ai_tools',
    name: 'Other AI — Builder Tools (Home page)',
    path: 'Home → "Other AI" card  (opens the Other AI page)',
    aiSurface: 'nbi_chat',
    description: 'The fourth card on the Home page (next to NavBharatAI Free, Pro and Professionals). Opening it reveals every AI-builder utility, grouped into FOUR (regrouped by the admin 2026-08-14): AI Tools (Bot Builder, AI Image Gen, AI Debugger, Code Review, API Tester, Versioning, Minifier, APK Builder), Developer Tools (Test Runner, Performance, Multi-Page, Components, Design System, Figma Import, Dark Mode Gen), Publish & Deploy (CI/CD Pipeline, Custom Domain, SEO Optimizer — Multi-Cloud Deploy moved to Settings → App Settings), and Monetization & Team (Monetize, Team, Live Collab, Whitelabel, Analytics, Insights & Webhooks, Community Gallery, Nav App Store). The old fifth group "Design & Build" NO LONGER EXISTS — all five of its tools now live under Developer Tools, so never send a user there. These moved here from Settings (admin 2026-07-23) so all builder tools sit alongside the main AIs; each tile opens the same tool it always did.',
    howToUse: 'Open the Home page → tap the "Other AI" card. It opens the Other AI page (like Professionals) showing all the tool groups INSIDE it; tap any tile to open that tool. (These were previously under Settings.)',
    relatedFeatures: ['settings_root', 'bot_builder', 'ai_image_gen', 'ai_debugger'],
    keywords: ['other ai', 'builder tools', 'tools', 'ai tools', 'developer tools', 'design build', 'publish deploy', 'monetization', 'home tools', 'saare tools', 'tools kahan', 'चौथा option', 'other ai kahan', 'more tools'],
  },
  {
    id: 'settings_root',
    name: 'Settings',
    path: 'Sidebar → Settings  OR  Header → Settings tab',
    description: 'The settings hub. Organized into groups: Account & Profile; and App Settings — everything a real, live website needs, brought into ONE place (admin 2026-07-29): Domain (connect your own domain — DNS + SSL included), Hosting & Deploy (your app is auto-hosted with a live URL; also deploy to Vercel/Netlify/Firebase/Cloud Run/Railway/Render), Database (connect your own DB — also provides login + storage when you connect Firebase/Supabase), Authentication (connect Clerk/Auth0 for login), Storage (connect S3/Cloudinary for uploads), Secrets & API Keys, plus Logs. GENERAL SETTINGS is now its OWN group (admin 2026-08-14), listed ABOVE App Settings — it holds View Mode, Theme, Accessibility, Chat Language and the app-signature toggle, i.e. how NavBharatAI itself looks, not how your built app is configured. Frontend + Backend CODE is built for you by NavBharatAI Pro, so they are not settings. The builder tools (AI Tools, Developer Tools, Publish & Deploy, Monetization & Team) live on the HOME page under the "Other AI" card (admin 2026-07-23; regrouped to four 2026-08-14 — "Design & Build" was folded into Developer Tools) — open Home → Other AI. (Git lives in the sidebar → Git, not in Settings.)',
    howToUse: 'Open Settings from the sidebar, then pick the group and sub-item you need. To get a website live: App Settings → Domain (connect your domain), Database (connect your data), Secrets & API Keys (your keys).',
    relatedFeatures: ['settings_database', 'settings_secrets', 'settings_general', 'settings_modules', 'settings_git', 'connect_domain'],
    keywords: ['settings', 'options', 'configuration', 'preferences', 'config', 'setting kahan', 'settings kahan hai', 'app settings', 'domain', 'hosting', 'database', 'website settings', 'website banane ke liye kya chahiye'],
  },
  {
    id: 'settings_reduce_motion',
    name: 'Motion Preference (Animations)',
    path: 'Settings → General Settings → General → Accessibility → "Motion"',
    description: 'Controls on-screen motion with three choices: On (default — animations like the waving Indian flag shown while an agent works), Reduced (minimise all motion across the app, for comfort or motion sensitivity), and System (automatically follow your device\'s "reduce motion" accessibility setting). The choice is saved on your device and re-applied on every load with no flash of motion.',
    howToUse: 'Open Settings → General Settings → General → Accessibility, find "Motion", and pick On, Reduced, or System. Reduced makes the waving flag static and minimises every animation; System follows your OS setting; On (default) keeps animations.',
    relatedFeatures: ['settings_general', 'settings_root', 'settings_font_scale'],
    keywords: ['animation', 'animations', 'reduce motion', 'reduce animations', 'motion', 'flag', 'tiranga', 'waving flag', 'turn off animation', 'disable animation', 'animation band karo', 'animation off', 'motion kam karo', 'prefers reduced motion', 'match system motion', 'accessibility'],
  },
  {
    id: 'settings_font_scale',
    name: 'Text Size (Font Scaling / Zoom)',
    path: 'Settings → General Settings → General → Accessibility → "Text Size"',
    description: 'Scales the entire interface up or down for readability, in steps between 90% and 140%. Use A− / A+ to adjust and Reset to return to 100%. Because the whole app is built with relative (rem) sizing, this acts as a real accessibility zoom for the platform UI — helpful for low-vision users or small screens. The chosen size is saved on your device and re-applied on every load.',
    howToUse: 'Open Settings → General Settings → General → Accessibility, find "Text Size", and tap A− to shrink or A+ to enlarge (90%–140%); the live percentage updates. Tap Reset to go back to 100%.',
    relatedFeatures: ['settings_general', 'settings_root', 'settings_reduce_motion'],
    keywords: ['text size', 'font size', 'font scale', 'zoom', 'bigger text', 'larger text', 'smaller text', 'increase font', 'text bada karo', 'font bada', 'zoom in', 'zoom out', 'readability', 'accessibility', 'low vision', 'a11y'],
  },
  {
    id: 'team_collaboration',
    name: 'Team Collaboration (Invite Members)',
    path: 'Home → Other AI → Team',
    description: 'Invite people to your team and manage members. Enter a teammate\'s email and pick a role (Admin / Editor / Viewer) to create a durable, shareable invite LINK — invites are saved on the backend (not just your browser) and no longer vanish on logout. Copy the link and share it; when the person opens it while signed in, they accept and join your team, and their role is applied to the app\'s access control. You can revoke a pending invite (the link stops working) or remove a member. Note: NavBharatAI shares an invite LINK rather than sending an email (no email delivery yet) — the link is the real, working invitation.',
    howToUse: 'Open Home → Other AI → Team. Type the teammate\'s email, choose a role, and select Invite — an invite link is created under "Pending Invites". Tap the copy icon to copy it and share it (chat, email, anywhere). To cancel, tap the ✕ to revoke it. To accept an invite you received, open the link while signed in and choose "Accept invite".',
    relatedFeatures: ['settings_root', 'live_collaboration'],
    keywords: ['team', 'invite', 'invite member', 'add member', 'collaborate', 'collaboration', 'team member', 'share access', 'invite link', 'accept invite', 'join team', 'team banao', 'member add karo', 'invite bhejo', 'role', 'admin', 'editor', 'viewer', 'permissions'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'live_collaboration',
    name: 'Live Collaboration (Real-Time Room)',
    path: 'Home → Other AI → Live Collab',
    description: 'A real-time room where a signed-in team uses AI together over Firestore, with a mobile-friendly tab header that PICKS THE AI: NavBharatAI Free (shared chat — any member asks, the question + answer appear for everyone, billed to whoever asked), NavBharatAI Pro v5.0 (real in-room app build — coming soon), Professional (the owner picks a professional like Doctor/Teacher/Lawyer from a dropdown — coming soon), and Team. Create a room to get a Room ID and share it. JOINING NEEDS OWNER APPROVAL: a joiner\'s request is "pending" until the room owner approves it — until then they cannot see the shared AI or chat. The OWNER can approve/reject requests and KICK any member (removed instantly, rules-enforced). The Team tab has the member roster + join requests + room CHAT. The bottom app footer is dynamic per AI (Free/Professional show History / AI / Mode (coming soon) / Settings).',
    howToUse: 'Open Home → Other AI → Live Collab (sign in first). Tap "New Room" to become the owner, or paste a Room ID and Join — your join request waits until the owner approves you. As owner, open the Team tab to see Join requests (Approve / Reject) and to Kick a member (trash icon). Use the AI tab to ask NavBharatAI for the whole room; the Code tab for the shared editor + line comments; the Team tab for members + chat. Share the Room ID, and Leave to exit.',
    relatedFeatures: ['team_collaboration', 'settings_root'],
    keywords: ['live collaboration', 'live collab', 'real time', 'realtime', 'room', 'room id', 'collaborate live', 'code together', 'pair programming', 'live cursor', 'cursors', 'presence', 'line comment', 'annotation', 'comment on code', 'share code live', 'saath me code', 'ek saath', 'collaboration room', 'owner approval', 'approve join', 'join request', 'kick member', 'remove member', 'shared ai', 'room ai', 'approve karo', 'kick karo', 'nikal do'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'share_for_review',
    name: 'Share for Review (Client / Stakeholder Portal)',
    path: 'Settings → App Settings → Hosting & Deploy → "Share for review" card',
    description: 'Share your built app READ-ONLY with a client or stakeholder who has no account, and collect their feedback/approval. Creating a review link snapshots the current app and gives you a link like navbharat.ai/?review=<token>. When the person opens it, they see the app running read-only (in a safe sandbox) with a feedback bar to Approve / Request changes / Reject plus a comment. Their responses come back to you under "View feedback". You can Revoke the link anytime (it stops working). No email is sent — you share the link yourself; links expire after 30 days.',
    howToUse: 'Open Settings → App Settings → Hosting & Deploy. In the "Share for review" card, tap "Create review link", then Copy it and send it to your client. They open it, pick Approve / Request changes / Reject, add a comment, and Send. Tap "View feedback" to read their responses, or "Revoke link" to disable it.',
    relatedFeatures: ['team_collaboration', 'live_collaboration', 'settings_root'],
    keywords: ['share', 'share app', 'review', 'review link', 'client', 'stakeholder', 'feedback', 'approval', 'approve', 'read only', 'read-only preview', 'share for review', 'client feedback', 'sign off', 'demo link', 'show client', 'client ko dikhao', 'feedback lo', 'approval lo', 'share portal'],
    aiSurface: 'nbi_chat',
  },
  {
    id: 'settings_database',
    name: 'Database Settings (Bring Your Own Database)',
    path: 'Settings → App Settings → Database',
    description: 'Connect your own database provider to use in the apps NavBharatAI Pro v5.0 builds for you. Use ANY database you like — NavBharatAI works with all of them: Supabase (PostgreSQL + auth + storage), Firebase (Firestore + Auth + Storage), MongoDB Atlas, Neon (serverless Postgres), PostgreSQL on ANY host (Render, Railway, Aiven, DigitalOcean, your own server), MySQL / MariaDB on ANY host (including Indian shared hosting like Hostinger, cPanel and Bluehost), PlanetScale, Turso (libSQL), Upstash Redis (for sessions, counters and caching), Appwrite, or any other connection string. Each choice shows a one-line explanation of what that database is for, so picking one does not need prior knowledge. NavBharatAI also knows the SQL DIALECT of whichever you picked, so it never writes Postgres-only SQL against your MySQL database (or the reverse). A direct link to the provider\'s API-key page is shown after you select the provider, and EACH input field shows a short "Where to find this" hint pointing at the exact spot in that provider\'s own dashboard where that specific value lives (e.g. Supabase Project URL → Project Settings → API → Project URL). Your credentials are AES-encrypted in Secrets & API Keys (never kept in the browser). When you build, NavBharatAI Pro v5.0 detects your connected database and wires that EXACT provider\'s SDK using your keys from .env — it never creates a new or different database, and never asks you to set one up. And if your app needs to save data but you have NOT connected a database yet, v5.0 tells you — in your OWN language (Hindi, Tamil, Bengali, Marathi, English, any Indian language) — that you should connect your own database here first, so your data stays yours. NavBharatAI NEVER stores your app data — all data stays in your own account.',
    howToUse: 'Settings → Database → select your provider → a link to their API-key page appears and each field shows a "Where to find this" hint → paste your URL/API keys → Save (they are encrypted into Secrets & API Keys). NavBharatAI Pro v5.0 then automatically uses that exact database when it builds your app. To update later, retype only the field you want to change — blank fields keep their saved value.',
    relatedFeatures: ['engineer_ai', 'settings_secrets', 'settings_database_oneclick'],
    keywords: [
      'database', 'db', 'supabase', 'firebase', 'mongodb', 'neon', 'appwrite',
      'byod', 'connect database', 'database credentials', 'database kahan', 'db settings',
      'database key', 'api key database', 'connection string',
    ],
  },
  {
    id: 'settings_database_oneclick',
    name: 'Create a database in one tap (Supabase, in YOUR account)',
    path: 'Settings → App Settings → Database → "Create a database in one tap"',
    description: 'Instead of leaving NavBharatAI to create a Supabase project, find two keys and paste them back, you can connect your Supabase account once and let NavBharatAI create the database for you. IMPORTANT: the project is created INSIDE YOUR OWN Supabase account — your data and its billing stay yours, and NavBharatAI never hosts your app data. After it is created, the keys are saved encrypted into Secrets & API Keys automatically, so there is nothing to copy and your next build uses that database by itself. This works for BOTH kinds of app: a frontend-only app gets the Supabase project URL and public key, and an app with its own backend (Prisma, Drizzle, or any Postgres library) also gets a real Postgres connection string (DATABASE_URL), so its server can read and write the database directly. If the app you are building already has tables defined, they are created in the new database too, so it is not empty when your app first runs. NavBharatAI asks for only five permissions (create projects, read your organization, read the new project keys, configure auth, run migrations) and never asks for analytics, domains, storage or edge functions. Honest limits: Supabase\'s FREE plan allows only 2 projects per organization — if yours is full, NavBharatAI says so and tells you to delete an unused project or upgrade in Supabase, rather than failing silently. A new database takes a minute or two to start; NavBharatAI waits until it is genuinely usable before saying it is ready. Disconnecting makes NavBharatAI forget your connection, but does NOT revoke access on Supabase\'s side — remove the NavBharatAI app in your Supabase account settings to do that. If this deployment has no Supabase app configured, the one-tap card does not appear at all and you simply use the manual form.',
    howToUse: 'Settings → App Settings → Database → tap "Connect Supabase" → sign in to YOUR Supabase account in the popup and approve → back in NavBharatAI tap "Create database" → wait a minute or two → done, the keys are saved automatically. You can still paste keys manually in the form below if you prefer, or already have a project.',
    relatedFeatures: ['settings_database', 'settings_secrets', 'engineer_ai'],
    keywords: [
      'one click database', 'one tap database', 'create database', 'auto database', 'database banao',
      'supabase connect', 'connect supabase', 'supabase login', 'database khud bana', 'automatic database',
      'no keys', 'bina key', 'database setup', 'free plan limit', 'project limit', 'do project',
    ],
  },
  {
    id: 'visual_editor',
    name: 'Visual Editor — change how your app looks by clicking on it',
    path: 'Preview panel → the Visual Edit toggle in the preview toolbar',
    description: 'Point at any part of your app and change how it looks, without writing code and without asking the AI. Switch the preview into Visual Edit mode, click any element, and a panel opens on the right with its settings: text colour, size, weight and alignment; background colour; padding on each side; margin on each side; corner radius; and opacity. There is also a LAYOUT section — Stack (each item on its own line), Row (side by side) or Column (one above the other) — and, once an element is a Row or a Column, controls for how its children line up, how much gap sits between them, and whether they wrap onto the next line on a small screen. A tree of your app\'s structure sits on the left so you can pick an element that is hard to click. Why this matters: changing a colour or putting two things side by side used to mean asking the AI and waiting for a whole rebuild, which is slow and uses your tokens — here it is instant and costs nothing. MULTI-ELEMENT SELECT (2026-08-11): hold Ctrl (or Cmd, or Shift) and click to pick SEVERAL elements at once — clicking a chosen one again removes it — and every styling change then applies to all of them together, so making six headings the same colour is one action instead of six. The toolbar shows how many elements are selected, elements picked with Ctrl are outlined with a dashed border, and the changes are saved to your code in a single safe write per file. Honest limits: an element whose styling is set in code (a dynamic style) is left untouched and NAMED rather than silently skipped, and editing TEXT is still one element at a time, because two elements cannot share one piece of text.',
    howToUse: 'Open the preview, turn on Visual Edit in the preview toolbar, then click the thing you want to change (or find it in the tree on the left). Use the panel on the right: Typography for text, Colors for backgrounds, Spacing for padding and margin, Layout for Stack / Row / Column plus alignment, gap and wrapping. Changes apply straight away in the preview.',
    relatedFeatures: ['agentv3_builder', 'agentv3_files'],
    keywords: [
      'visual editor', 'visual edit', 'design edit', 'click to edit', 'change colour', 'change color',
      'padding', 'margin', 'spacing', 'gap', 'side by side', 'ek line me', 'center karo', 'alignment',
      'layout', 'row', 'column', 'font size', 'text size', 'radius', 'opacity', 'bina code ke',
      'design badlo', 'dikhawat', 'ui change', 'element edit',
    ],
  },
  {
    id: 'database_studio',
    name: 'Database Studio — see your app\'s real data',
    path: 'Sidebar → Database Studio',
    description: 'Browse YOUR OWN database from inside NavBharatAI — the tables your app actually uses, with their real rows. It reads the Supabase project that lives in your own Supabase account (the one created by Settings → Database), so what you see is genuinely your app\'s data, not a sample and never NavBharatAI\'s own storage. What it shows: your tables with an approximate row count, one page of rows at a time (50, with next/previous), sorting by any column, a search across the rows on the page, a JSON view of the same page, a Schema view with every column\'s type, whether it can be empty, and its default, and an Export that saves the page you are looking at as JSON. If you have not connected a database yet, it shows clearly-labelled SAMPLE rows and tells you where to create one — the sample is never presented as your data. You can also EDIT your data: change a row, add a new one, or delete one. Editing is deliberately careful — it only works on tables that have a primary key, because without one NavBharatAI cannot tell one row from another and refuses to risk changing the wrong one (it says so plainly and shows the table read-only instead). Deleting always asks you to confirm first and cannot be undone. Every change is checked to have affected exactly one row before NavBharatAI says it saved, and the saved row is read back from your database so you see what really got stored, not what we assumed. The Schema view also shows RELATIONS (which column points at which other table — tap one to jump there) and INDEXES (which is usually why an app gets slow as it fills up: the column it filters by has none). And there is a SQL tab where you can run your own queries. "Run" is READ-ONLY and that is enforced by your database itself, not by us guessing from the words — so a query that would change data is simply refused. To actually change something you use the separate "Run as a change…" button, which always asks you to confirm first, and only one statement runs at a time. CSV: "Export table (CSV)" downloads your table as a spreadsheet file (up to 5,000 rows — if there are more, NavBharatAI tells you the file is only part of it), and "Import CSV" adds rows from a file. Before anything is sent, NavBharatAI reads the file in your browser and shows you what it understood — how many rows and which columns — and afterwards it tells you exactly how many rows went in and names any columns your table does not have (those are skipped, never silently dropped).',
    howToUse: 'Open Database Studio from the sidebar. Pick a table on the left, then read its rows on the right. Click a column heading to sort by it, use the arrows at the top right to move between pages, type in the search box to filter the rows on the current page, and switch between Table, JSON and Schema at the top right. To change data: hover a row and tap the pencil to edit it or the bin to delete it, or tap "Add row" at the top right to insert one (both take JSON). If a table has no primary key you will see a "Read-only" note explaining why — add a primary key to that table to edit it here. To run your own SQL, open the SQL tab, type a query and tap Run (read-only); to run something that changes data, tap "Run as a change…" and confirm. For CSV, use the buttons at the bottom left: "Export table (CSV)" to download, "Import CSV" to pick a file (you get a preview first, then tap Import). Database Studio reads ANY PostgreSQL database you have connected — Supabase, Neon, or a plain Postgres connection string from any host (Render, Railway, Aiven, your own server). Seeing "Sample data"? Either no database is connected yet (go to Settings → App Settings → Database), or the one you connected is a kind Studio cannot browse yet (MySQL, MongoDB, Firebase, Turso) — in that case it says so plainly and your app still uses that database normally; only this browsing screen is limited.',
    relatedFeatures: ['settings_database', 'settings_database_oneclick', 'engineer_ai'],
    keywords: [
      'database studio', 'my data', 'see data', 'data dekho', 'apna data', 'view data', 'browse data',
      'tables', 'table dekho', 'rows', 'records', 'db browser', 'database dekhna', 'schema', 'columns',
      'sql', 'export data', 'data export', 'kaha hai mera data', 'data kaise dekhu', 'db studio',
      'edit row', 'row edit', 'data badlo', 'row delete', 'delete row', 'add row', 'naya row', 'data change',
      'insert row', 'update data', 'data edit karo', 'primary key',
      'sql', 'sql chalao', 'query', 'run query', 'sql runner', 'relations', 'foreign key', 'index',
      'indexes', 'app slow', 'table relation', 'jodna', 'query kaise chalau',
      'csv', 'csv import', 'csv export', 'excel', 'spreadsheet', 'data upload', 'bulk add', 'import data',
      'data download', 'excel me', 'csv se data',
    ],
  },
  {
    id: 'notifications_bell',
    name: 'Notifications (messages from NavBharatAI)',
    path: 'Top bar → bell icon (next to your profile)',
    description: 'A notification bell in the top bar shows messages the NavBharatAI team sends you — announcements to all users, or a message addressed to you specifically. A red badge shows how many are unread; opening the bell lists the messages (newest first) and marks them read. Real end-to-end: if there are no messages, it simply shows "No messages yet" (never a fake dot). Admins send these from the Admin dashboard → Settings → Message Users (All Users or a specific user by email).',
    howToUse: 'Tap the bell icon in the top bar (next to your profile avatar) to see messages from NavBharatAI. The red number is how many you have not read; opening the list marks them read.',
    relatedFeatures: ['settings_root', 'my_profile'],
    keywords: ['notification', 'notifications', 'bell', 'message', 'messages', 'announcement', 'inbox', 'admin message', 'navbharatai message', 'notification kahan', 'message aaya', 'ghanti', 'suchna'],
  },
  {
    id: 'settings_multicloud',
    name: 'Hosting & Deploy (Multi-Cloud)',
    path: 'Settings → App Settings → Hosting & Deploy',
    description: 'The single publish surface for your app (admin 2026-07-29: the old separate "Hosting & Publish" info-screen was a duplicate of this and was merged in). It opens with an honest reminder that your app is ALREADY auto-hosted with a live HTTPS URL the moment it builds — no server to set up. From there you can deploy it elsewhere: NavBharat Hosting (instant live URL in seconds), Vercel, Netlify, Firebase Hosting, Google Cloud Run, Railway and Render. NavBharat Hosting and Vercel (when you paste your own VERCEL_TOKEN in the Config tab) deploy for REAL from inside the app and give you a live URL; the other platforms show the exact, honest CLI steps to run (build + deploy command) — nothing is faked. A Deploy history tab keeps your recent live URLs. To put it on your own domain, use the Domain tile. Needs an app to be built first (it publishes your generated app bundle).',
    howToUse: 'Settings → App Settings → Hosting & Deploy → pick a platform. For an instant live URL, choose NavBharat Hosting and press Deploy. For Vercel, add your VERCEL_TOKEN in the Config tab first, then Deploy. For other platforms, copy the CLI steps shown and run them in your terminal. For a custom domain, use Settings → App Settings → Domain.',
    relatedFeatures: ['connect_domain', 'settings_root', 'settings_secrets'],
    keywords: [
      'deploy', 'deployment', 'multi-cloud', 'multicloud', 'multi cloud', 'publish', 'go live',
      'hosting', 'hosting & publish', 'hosting and deploy', 'host', 'where is my app hosted',
      'vercel', 'netlify', 'firebase hosting', 'cloud run', 'railway', 'render', 'hosting platform',
      'deploy kaise', 'app deploy', 'live kaise kare', 'website live', 'host karo', 'hosting kahan',
    ],
  },
  {
    id: 'settings_auth',
    name: 'Authentication Settings (Bring Your Own Login)',
    path: 'Settings → App Settings → Authentication',
    description: 'Connect a login/signup provider for the apps NavBharatAI Pro builds for you. Dedicated providers: Clerk and Auth0. You can also point auth at Supabase Auth or Firebase Auth — but their login already comes with your Database connection, so pick Clerk/Auth0 here only if you want a dedicated auth provider instead. Each field shows a "Where to find this" hint pointing at the exact spot in the provider\'s dashboard. Your credentials are AES-encrypted in Secrets & API Keys (never kept in the browser). When you build, NavBharatAI Pro detects your connected provider and wires real login/signup/sessions with its SDK — it never rolls its own password auth or asks you to set one up. If a database is also connected, it uses the database for DATA and this provider for AUTH.',
    howToUse: 'Settings → App Settings → Authentication → select Clerk / Auth0 (or Supabase/Firebase) → paste your keys (each field shows where to find it) → Save (encrypted into Secrets & API Keys). Your next build wires real login to that provider. Using Firebase/Supabase as your database? Their login is already covered there.',
    relatedFeatures: ['settings_database', 'settings_secrets', 'engineer_ai'],
    keywords: [
      'authentication', 'auth', 'login', 'signup', 'sign in', 'sign up', 'users', 'user login',
      'clerk', 'auth0', 'supabase auth', 'firebase auth', 'connect auth', 'auth settings',
      'login kaise', 'login provider', 'user account', 'session', 'oauth',
    ],
  },
  {
    id: 'settings_storage',
    name: 'Storage Settings (Bring Your Own File Storage)',
    path: 'Settings → App Settings → Storage',
    description: 'Connect your own file/image storage provider for the uploads in apps NavBharatAI Pro builds for you. Supported standalone providers: S3-compatible (AWS S3, Cloudflare R2, Supabase Storage or MinIO) and Cloudinary. Each field shows a "Where to find this" hint pointing at the exact spot in that provider\'s console. Your credentials are AES-encrypted in Secrets & API Keys (never kept in the browser). When you build, NavBharatAI Pro detects your connected storage and wires a REAL direct-to-storage upload — the browser uploads straight to your bucket via a presigned/signed URL, so the secret never leaves the server and your files live in YOUR storage. Note: if you connect Firebase or Supabase as your Database, their storage already comes with that connection — you only need this screen for S3/R2/Cloudinary.',
    howToUse: 'Settings → App Settings → Storage → select S3-compatible or Cloudinary → paste your bucket/keys (each field shows where to find it) → Save (encrypted into Secrets & API Keys). Your next build wires real uploads to that storage. Using Firebase/Supabase? Their storage is already covered by Settings → Database.',
    relatedFeatures: ['settings_database', 'settings_secrets', 'engineer_ai'],
    keywords: [
      'storage', 'file storage', 'upload', 'uploads', 'image upload', 'file upload',
      's3', 'aws s3', 'cloudflare r2', 'r2', 'minio', 'cloudinary', 'bucket',
      'connect storage', 'storage settings', 'storage kahan', 'file kahan save', 'media storage',
    ],
  },
  {
    id: 'settings_secrets',
    name: 'Secrets & API Keys',
    path: 'Settings → App Settings → Secrets & API Keys',
    description: 'A secure, encrypted per-user vault for the API keys/secrets your BUILT APPS need — the safe place to store keys instead of pasting them into chat. When NavBharatAI Pro v5 builds an app that needs a key (e.g. OPENAI_API_KEY, STRIPE_SECRET_KEY, DATABASE_URL, a Supabase/Firebase key), it guides you where to get it and asks you to add it HERE, using the exact variable name the code reads. At build time those saved keys are injected automatically into the app\'s environment (.env) — so the app runs with the real key, which is never shown to the AI or exposed in chat, and never committed to git. Also stores GITHUB_TOKEN (NavBharatAI Pro v5.0 reads it to clone/push private repos) and Cashfree payment credentials. Keys are AES-256 encrypted, scoped to your account, and never shared. ASKED FOR WHILE THE APP IS BEING BUILT (2026-08-08): if v5.0 is building something that needs a key — a payment key, an SMS sender, a maps token — it now STOPS and asks you right there, with a small popup listing the exact key names and what each one is for. Type the values, tap Save, and they go into this same encrypted vault AND straight into your app\'s .env, so the build continues and uses them immediately — you never have to leave the screen or find this tile yourself. The popup has a MINIMISE button: tap it if you need to go and fetch a key from another site, and it shrinks to a one-line bar with whatever you already typed still there. You can also tap "Skip for now" — the build carries on and finishes, and that one feature is left visibly switched off rather than faked. Values are hidden as you type, are never shown to the AI, never written into your code and never committed to git. You never have to guess which keys an app needs: when a build finishes, NavBharatAI Pro v5.0 reads the app it just wrote and — in YOUR own language — lists any service that still needs a key from your own account (payments, email/SMTP, SMS/OTP, maps, your app\'s own AI key, storage, a hosted database), with the EXACT variable names and the exact screen to paste them into. It only lists what the built code genuinely uses, it never lists something you have already saved, and it never blocks the build. And your app is never taken down by a key you haven\'t pasted yet: a feature whose key is missing is FROZEN as a visible, disabled "Coming soon" button that names the key it needs, while every other screen keeps working normally — v5.0 builds apps that refuse to crash at startup over one unset variable, and it never fakes a result (no pretend "payment successful", no OTP that always passes). Anything NavBharatAI can supply itself (the preview\'s PostgreSQL database) is provisioned automatically and never asked of you. YOUR SAVED DATABASE DETAILS ARE TESTED, NOT JUST COPIED: when a build loads your keys it actually opens a connection to any database connection string you saved and runs a real check, then tells you which keys were tested and working. If the details are stale, mistyped or the database has been deleted, you are told at the START of the build, in one line, naming this screen — instead of finding out from a preview that will not load. Keys we cannot test without spending your money (an API key, for example) are reported honestly as loaded-but-untested; a key is never silently dropped, and NavBharatAI never claims a key works when it has not checked.',
    howToUse: 'Settings → App Settings → Secrets & API Keys → type the exact key name the app needs (e.g. OPENAI_API_KEY) → paste the value → Save. Your next build injects it into the app automatically. Never paste keys into the chat — always store them here. After a build, the summary tells you exactly which keys (if any) are still missing and where to add them.',
    relatedFeatures: ['engineer_ai', 'settings_git', 'engineer_ai_github', 'pro_chat'],
    keywords: ['secrets', 'keys', 'api key', 'token', 'github token', 'credentials', 'secret store', 'key store', 'vault', 'env', 'environment variable', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'STRIPE', 'DATABASE_URL', 'app keys', 'keys kahan dale', 'api key kahan', 'key not working', 'wrong credentials', 'credentials galat', 'key check', 'test my key', 'database url not working'],
  },
  {
    id: 'settings_general',
    name: 'General Settings',
    path: 'Settings → General Settings → General',
    description: 'How NavBharatAI ITSELF looks and behaves — as opposed to App Settings, which is about the app YOU BUILT. Holds: View Mode (Auto / Mobile / Tablet / Desktop — the first control, moved here 2026-08-14 from where it floated loose on the Settings home), Theme (Light / Dark / Dim / Comfort / Contrast), Accessibility (Motion + Text Size), Chat Language, and the "made by NavBharatAI" signature toggle for built apps. Two controls were REMOVED on 2026-08-14 because neither did anything: a "Developer Mode" toggle that had no action and was permanently drawn as ON, and an app "Description" box whose text was never saved or read. Never tell a user about either.',
    howToUse: 'Settings → General Settings → General. View Mode is at the top (Auto / Mobile / Tablet / Desktop), then Theme, then Accessibility (Motion + Text Size), Chat Language, and the "made by NavBharatAI" signature toggle.',
    relatedFeatures: ['settings_root', 'settings_app_signature', 'settings_reduce_motion'],
    keywords: ['general settings', 'theme', 'dark mode', 'light mode', 'language', 'developer mode', 'general', 'appearance', 'signature'],
  },
  {
    id: 'text_size',
    name: 'Text Size (make everything bigger or smaller)',
    path: 'Open the ☰ menu (top-left) → scroll to System Matrix → the "Text Size" slider. Also in Settings → General Settings → General → Accessibility (+ / − buttons).',
    description: 'One slider that scales the WHOLE app\'s text and spacing — from 50% (much smaller, fits far more on screen) to 200% (much larger, easier to read). It is not limited to one screen: every page, menu, chat and panel resizes together, because the app is built in relative units. Your choice is saved on this device and is applied the instant the app opens, so there is no flash of the wrong size. A "Reset" link next to the percentage returns it to 100%. The same setting also lives in Settings → General → Accessibility as + / − buttons for precise stepping in 10% increments.',
    howToUse: 'Tap the ☰ menu at the top-left, scroll down to the System Matrix section, and drag the "Text Size" slider — the app resizes live as you drag, and the current percentage is shown above it. Drag left (down to 50%) to fit more on screen, right (up to 200%) for large, easy-to-read text. Tap "Reset" to go back to 100%. Keyboard users can focus the slider and use the arrow keys.',
    relatedFeatures: ['settings_general', 'settings_root'],
    keywords: [
      'text size', 'font size', 'font', 'bigger text', 'smaller text', 'zoom', 'zoom in', 'zoom out',
      'accessibility', 'readable', 'bada karo', 'chhota karo', 'font bada', 'font chhota', 'text bada',
      'akshar', 'size badhao', 'size kam karo', 'padhne me dikkat', 'bade akshar', 'magnify', 'scale',
    ],
  },
  {
    id: 'legal_trust',
    name: 'Legal & Trust (Privacy Policy, Terms, DPA, Security, NDA)',
    path: 'Settings → scroll to the "Legal & Trust" card → tap the document you need (Privacy Policy / Terms of Service / Data Processing Agreement / Security Documents / NDA).',
    description: 'Five full legal and trust documents, each on its own page inside Settings: (1) Privacy Policy — what data NavBharatAI collects and why, where it is stored, retention periods, the stricter rules for clinical documents in Doctor AI, your DPDP Act rights (access, correction, deletion, grievance, nomination) and the grievance contact; (2) Terms of Service — the rules of using the platform: tokens are prepaid credit, failed builds are never charged, refund policy for unused tokens, YOU own the apps you build, acceptable-use rules, Nav App Store publishing rules, AI-output disclaimers and the Doctor-AI-is-for-doctors rule; (3) Data Processing Agreement (DPA) — for business customers: processor duties, 72-hour breach notice, sub-processor categories with a named list available under NDA, international transfer safeguards, audit and deletion rights; (4) Security Documents — encryption, access control, the store\'s scan-and-review pipeline, supply-chain gates, the incident response plan, the vulnerability disclosure policy (report to info@navbharatai.com with subject SECURITY), and an honest section on what we do NOT yet claim (no SOC2/ISO certification yet); (5) NDA — NavBharatAI\'s standard mutual non-disclosure template for investors, enterprise customers and contractors, executed via info@navbharatai.com.',
    howToUse: 'Open Settings (More tab → Settings, or the sidebar gear). Scroll to the amber "Legal & Trust" card and tap any of the five buttons — each opens that document as a full, readable page. For questions about any document, or to execute the DPA/NDA, email info@navbharatai.com.',
    relatedFeatures: ['settings_root', 'settings_general'],
    keywords: [
      'privacy policy', 'privacy', 'terms of service', 'terms', 'terms and conditions', 'dpa',
      'data processing agreement', 'security', 'security documents', 'nda', 'non disclosure',
      'legal', 'legal pages', 'niyam', 'sharten', 'gopniyata', 'data safety', 'my data',
      'delete my data', 'refund policy', 'refund', 'grievance', 'complaint', 'dpdp', 'gdpr',
      'vulnerability', 'report bug security', 'kanoon', 'agreement', 'policy',
    ],
  },
  {
    id: 'settings_app_signature',
    name: '"Made by NavBharatAI" Signature',
    path: 'Settings → General Settings → General → "Made by NavBharatAI" Signature',
    description: 'On/off toggle (default ON) that adds a small "made by NavBharatAI" badge to the bottom-right corner of every app you build. The badge links to navbharatai.com, so anyone you share your app with can discover NavBharatAI too. Turn it off to build apps without the badge.',
    howToUse: 'Open Settings → General and toggle "Made by NavBharatAI" Signature on or off. The choice applies to your next build — when on, the built app shows a clickable badge in the bottom-right that opens navbharatai.com.',
    relatedFeatures: ['settings_general', 'settings_root'],
    keywords: ['signature', 'made by navbharatai', 'watermark', 'badge', 'branding', 'remove badge', 'built by', 'credit', 'hataye', 'signature hatao'],
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
    name: 'Git / DevOps Panel',
    path: 'Settings → App Settings → Git & Deployment',
    description: 'The full Git & DevOps panel: connect your GitHub account (OAuth or token), pick a repository and branch, make REAL commits and pushes of your workspace files to GitHub, and deploy to real providers (Firebase / Vercel / Netlify / Cloudflare via the v5.0 engine). GitHub connect/disconnect and repository selection live inside this panel. It used to sit on the left sidebar; it now opens from App Settings.',
    howToUse: 'Open Settings → App Settings, and on the General screen tap "Git & Deployment" to open the panel. Connect GitHub if not connected, choose your repository and branch, then commit & push your files — real commits appear on GitHub. Use the deploy targets to publish your app.',
    relatedFeatures: ['settings_secrets', 'ide_git', 'engineer_ai_github'],
    keywords: ['git', 'git panel', 'github settings', 'git configuration', 'repo settings', 'connect github', 'git config', 'github repository', 'push code', 'git kahan hai', 'git settings me', 'version control', 'devops', 'deploy'],
  },
  {
    id: 'settings_logs',
    name: 'Logs (Settings)',
    path: 'Settings → App Settings → Logs',
    description: 'The REAL live logs of the app you are building, in two sections: (1) BUILD LOG — the actual progress events of your NavBharatAI Pro v5.0 build (narration, files created/updated, build finished), replayed from the durable live channel and updating live while a build runs; (2) RUNTIME ERRORS — errors captured from your app\'s own browser console in the Preview, so you can see exactly what broke at runtime. It watches the SAME workspace as Pro v5.0, Code Studio, Files and Preview. Honest empty states: before any build it says no activity is recorded yet — nothing is simulated.',
    howToUse: 'Settings → App Settings → Logs. Start or continue a build in NavBharatAI Pro v5.0 chat and watch its live progress here; open the Preview to have any runtime console error recorded into the Runtime errors section (tap refresh to re-check).',
    relatedFeatures: ['ide', 'ide_terminal', 'pro_chat'],
    keywords: ['logs', 'log', 'debug', 'build log', 'runtime log', 'errors', 'output', 'log kahan', 'console errors', 'app ka log'],
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
    path: 'Sidebar menu → "Wallet & Billing"  OR  tap the token-balance chip in the NavBharatAI Pro v5.0 header',
    description: 'View your current subscription plan (Free / Pro / VIP), usage statistics, payment options, and This Month\'s AI Cost — a running total of estimated AI spend across all Pro builds in the current calendar month. Wallet tokens are REAL: every finished v5.0 Pro build deducts its cost from your token balance automatically (₹1 = 100 tokens, the same rate recharges use), the deduction appears in the build result footer ("−N wallet tokens · M left") and in your wallet ledger, and when the balance runs out new paid builds are blocked until you recharge. TOKENS ARE THE PRIMARY UNIT everywhere: the Pro header chip shows your live token balance (₹ equivalent in its tooltip), the Billing panel leads with tokens, and the "add credits" screen shows your balance and the build estimate in tokens. ONE BALANCE FOR EVERYTHING: the same tokens also pay for the Professionals, Doctor AI and the AI-backed tools under Other AI — there is no separate quota to keep track of. What you are charged is what the work really cost: a short question answered by our fast economy engine costs nothing at all, a long or complex one costs a little, and the price of the thing IS the limit. Small charges through the day are grouped into ONE line in your ledger ("NavBharatAI assistants") so your recharge history stays readable, and anything smaller than ₹0.01 is carried to your next charge rather than rounded up. There is no separate subscription anywhere in NavBharatAI — this one balance is the whole billing system. When the balance is empty you are asked to add credit before the next request — nothing you have already received is taken away. NEW USERS (still on the welcome bonus, before any purchase) build on our fast economy engine; if an app needs the strongest engine to finish cleanly, you are invited to add credits to complete it — nothing you have done is lost.',
    howToUse: 'Open "Wallet & Billing" from the sidebar menu (or tap the token-balance chip in the NavBharatAI Pro v5.0 header) to check your plan, view remaining tokens, see this month\'s AI cost, or add credits. After each Pro build, the tokens deducted and your remaining balance are shown right under the build result; the full deduction history is in your wallet ledger. IF SOMEONE ASKS why their balance went down without a build: explain warmly, in their own language, that the same wallet now pays for the assistants and the AI tools too, that the day\'s small charges are grouped into one "NavBharatAI assistants" line in the ledger, and that free-engine answers cost nothing.',
    relatedFeatures: ['settings_root', 'donate'],
    keywords: ['billing', 'plan', 'subscription', 'usage', 'payment', 'pricing', 'upgrade', 'credits', 'pro plan', 'free plan', 'monthly cost', 'ai cost', 'monthly ai cost', 'build cost', 'how much spent', 'token deduction', 'tokens deducted', 'wallet tokens', 'token balance', 'balance kata', 'tokens kam hue', 'paise kate', 'kitne token bache', 'chat cost', 'professional cost', 'doctor ai cost', 'tool cost', 'balance empty', 'balance khatam', 'bina build ke token kate', 'assistants charge', 'one wallet'],
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
    description: 'Personal profile page showing: (1) Avatar (auto-loaded from Google/GitHub or a custom URL), display name, bio, phone — all editable. (2) Wallet summary: current INR balance, this month\'s spend, and a monthly budget cap. (3) COST ALERTS — when your month-to-date AI spend reaches 80% of your monthly budget you get an amber "approaching budget" warning, and if you go over it a red "budget exceeded" alert, right on the profile page. Alerts are computed from your REAL recorded spend vs the budget you set (spend converted USD→INR at the canonical rate); no budget set = no alerts. (4) Full build history with This Week / This Month / Custom date range tabs — each row shows build title, date, duration, file count, cost charged, and status (Completed / Failed / Cancelled). (5) Quick links to Add Balance (Billing) and App Settings. (6) Sign Out button.',
    howToUse: 'Click your profile photo (or initials circle) in the top-right corner of the header → select "My Profile" from the dropdown. Or: open Settings → Account → My Profile. On the profile page: click "Edit" to update name / bio / phone / photo URL; click "Set a limit" under Monthly Budget to cap monthly spend — once set, cost alerts appear automatically as you approach or exceed it; use the period tabs in Build History to filter by week, month, or a custom date range.',
    relatedFeatures: ['billing', 'login_auth', 'settings_root'],
    keywords: ['profile', 'my profile', 'account', 'avatar', 'photo', 'display name', 'bio', 'phone', 'edit profile', 'build history', 'usage history', 'wallet balance', 'budget limit', 'monthly budget', 'spend cap', 'cost alert', 'budget alert', 'budget warning', 'over budget', 'spending alert', 'billing history', 'cost history', 'completed builds', 'failed builds', 'cancelled builds', 'profile page', 'apna profile', 'mera account', 'kharcha dekho', 'balance dekho', 'history dekho', 'budget cross', 'kharcha alert'],
  },
  {
    id: 'user_guide_docs',
    name: 'User & Developer Guide (Docs Site)',
    path: 'Open /guide in your browser (e.g. yourdomain/guide)',
    description: `A browsable, searchable documentation site listing EVERY NavBharatAI feature — auto-generated from the same app knowledge base every AI reads, so it never drifts from what the app actually does. Features are grouped (App Builder v5.0, Engineer AI, Pro Chat, Free Chat, Professional AI Assistants, Platform & App Features) and each entry shows the exact navigation path, what it does, how to use it, and search keywords. A live search box filters across all features instantly. A machine-readable version is served at /api/knowledge-base (JSON) for tooling. The in-app Templates gallery (starter projects) is separate — open it from the Templates panel.`,
    howToUse: 'Visit /guide in your browser. Use the search box at the top to find a feature (e.g. "deploy", "database", "cost", "build history"), or click a section chip to jump to a group. For machine-readable data, fetch /api/knowledge-base.',
    relatedFeatures: ['settings_root', 'my_profile', 'project-templates'],
    keywords: ['docs', 'documentation', 'guide', 'help', 'user guide', 'developer guide', 'manual', 'how to', 'feature list', 'knowledge base', 'search features', 'what can this app do', 'madad', 'help docs', 'reference'],
  },
  {
    id: 'api_keys',
    name: 'API Keys (Programmatic Access)',
    path: 'Top-right avatar → My Profile → API Keys card',
    description: `Create and manage personal API keys for programmatic/headless access to NavBharatAI. Each key is granted specific scopes (read:profile, read:usage, read:builds) so it can only do what you allow. The secret key is shown EXACTLY ONCE at creation (copy it then) — the server stores only a SHA-256 hash, never the plaintext, so a leak of the store cannot reveal a usable key. Use a key by sending it as the "X-API-Key" header or "Authorization: Bearer nbai_…" to the v1 API (e.g. GET /api/v1/me returns your profile + monthly usage). Keys can be revoked any time. Verification is timing-safe. Managed at POST/GET/DELETE /api/keys with your normal signed-in session.`,
    howToUse: 'Open My Profile → scroll to the "API Keys" card → type a name, pick one or more scopes, and click "Create key". Copy the shown key immediately (it is not shown again). Then call the API with header "X-API-Key: nbai_…" (try GET /api/v1/me). Revoke a key with the trash icon next to it.',
    relatedFeatures: ['my_profile', 'user_guide_docs', 'status_page'],
    keywords: ['api key', 'api keys', 'apikey', 'token', 'programmatic', 'headless', 'developer', 'rest api', 'public api', 'integration', 'automation', 'x-api-key', 'nbai key', 'scopes', 'revoke key', 'access token'],
  },
  {
    id: 'status_page',
    name: 'Status Page & Health Check',
    path: 'Open /status in your browser (machine-readable at /api/health)',
    description: `A public status page showing NavBharatAI's live health: an overall status banner (All systems operational / Degraded / Unavailable), current instance uptime, running version + Node version, memory usage, and per-component checks (server initialization, Firestore backup, AI providers, maintenance mode). Every value is a REAL live signal — nothing is faked; a degraded dependency is shown honestly rather than hidden. The page auto-refreshes every 15 seconds. A deep machine-readable probe is served at /api/health (JSON) — useful for uptime monitors and load-balancer health checks. Note: the current-instance uptime is real; a long-term historical uptime/SLA percentage accrues from monitoring over time.`,
    howToUse: 'Visit /status in your browser to see live system health. For automated monitoring or a health check, poll /api/health (returns JSON; 200 when ready, 503 while the server is still initializing).',
    relatedFeatures: ['user_guide_docs', 'admin-metrics'],
    keywords: ['status', 'status page', 'health', 'health check', 'uptime', 'system status', 'is it down', 'outage', 'degraded', 'availability', 'sla', 'server status', 'api health', 'monitoring', 'down detector'],
  },
  {
    id: 'login_auth',
    name: 'Login / Sign Up',
    path: 'Header → Login button (top right)',
    description: 'Sign in or create a NavBharatAI account. Authentication is required to save sessions, use NavBharatAI Pro v5.0, access Pro features, and store settings. Five ways to sign in: (1) Email + Password, (2) Phone number (OTP), (3) Sign in with Google, (4) Sign in with Apple, (5) Continue with GitHub. On the iOS/Android app, Google and Apple use the device\'s native sign-in sheet. GitHub sign-in also connects your repositories (repo + workflow scope) so NavBharatAI can build, commit, and deploy your apps directly to your GitHub.',
    howToUse: 'Click the Login button in the top-right of the header. Choose Email or Phone for a NavBharatAI account, or use "Sign in with Google", "Sign in with Apple", or "Continue with GitHub" under "or continue with". GitHub will ask permission to access your repositories — granting it lets NavBharatAI push your generated apps to your own GitHub.',
    relatedFeatures: ['history', 'settings_root'],
    keywords: ['login', 'sign in', 'sign up', 'register', 'account', 'auth', 'logout', 'email login', 'phone login', 'otp', 'mobile login', 'google login', 'google sign in', 'sign in with google', 'apple login', 'apple sign in', 'sign in with apple', 'github login', 'github sign in', 'connect github', 'login kaise', 'account kahan', 'google se login', 'apple se login'],
  },
  {
    id: 'app_navigation',
    name: 'App Navigation Overview',
    path: 'Header (top bar with tabs)  OR  Sidebar (left panel)',
    description: `How to navigate NavBharatAI:
• HEADER TABS (top bar) — each screen you open pins as its own tab (like browser tabs), so you can keep several open at once and switch between them.
• SIDEBAR / MENU (left panel on desktop, the ≡ hamburger on mobile) — the full list of screens: the free chat, the Pro v5.0 app builder, the Professionals, the Other-AI builder tools, Offline AI, Code Studio, and Settings. Tap any item to open it as a tab.
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
    name: 'NavBharatAI Pro — Extended Thinking (Complex Tasks)',
    path: 'NavBharatAI Pro v5.0 → just describe a complex task (auto-detected)',
    description: `NavBharatAI Pro v5.0 automatically detects complex tasks (full-stack apps, multi-system architecture, OAuth, real-time features, enterprise scale) and switches on deeper "extended thinking" for that build — the engine reasons harder before it writes code. No setting needed; it decides when deep reasoning is required, and shows a short "thinking" status while it plans. (You can also force the strongest reasoning tiers from the build-options menu.)`,
    howToUse: 'Describe a complex app (e.g. "Build a full-stack SaaS with OAuth and payments") and NavBharatAI Pro v5.0 automatically uses extended thinking for deeper architectural reasoning. For maximum reasoning, pick a higher power tier in the build-options (⚙) menu.',
    relatedFeatures: ['pro_chat', 'pro_chat_planner'],
    aiSurface: 'pro_chat',
    keywords: ['extended thinking', 'deep reasoning', 'complex task', 'thinking budget', 'opus thinking', 'architecture decision'],
  },
  {
    id: 'pro_chat_planner',
    name: 'NavBharatAI Pro — Build Planner (Step-by-Step Progress)',
    path: 'NavBharatAI Pro v5.0 → submit a build request → see the step progress / plan checklist',
    description: `For large builds, NavBharatAI Pro v5.0 shows a live plan checklist above the message box. The engine plans the build first (e.g. "Scaffold files → Install deps → Build UI → Add auth → Integrate DB"), then works through each step, ticking it off as it goes. Each step shows its name and current status (pending / working / done), so you can watch real progress instead of a spinner. The checklist can be minimized with a tap so it never crowds the chat.`,
    howToUse: 'Submit a multi-component build request. The plan checklist appears above the message box and ticks off each step as NavBharatAI Pro v5.0 works. Tap the "Plan" header to collapse or expand it.',
    relatedFeatures: ['pro_chat', 'pro_chat_extended_thinking'],
    aiSurface: 'pro_chat',
    keywords: ['build planner', 'step progress', 'plan', 'steps', 'progress bar', 'thinking', 'reasoning', 'chain of thought'],
  },
  {
    id: 'pro_chat_session_memory',
    name: 'NavBharatAI Pro — Cross-Session Memory',
    path: 'NavBharatAI Pro v5.0 → automatic (no user action needed)',
    description: `NavBharatAI Pro v5.0 remembers your project across sessions — even after closing the browser or switching devices. It keeps a rolling build summary, an edit log (what changed each turn), the architectural decisions made, and your preferences, all stored durably per project. On your next session with the same project it already knows the stack, the past decisions, and the recent changes, and it builds on top of them — it will NOT undo things you already built.`,
    howToUse: 'Just keep building in NavBharatAI Pro v5.0. It automatically loads your project memory at the start of each build — no setup needed. Reopening the same project (even on another device) continues where you left off.',
    relatedFeatures: ['pro_chat', 'pro_chat_planner', 'history'],
    aiSurface: 'pro_chat',
    keywords: ['session memory', 'remember', 'persistent memory', 'cross session', 'project memory', 'context', 'remember project', 'past builds', 'yaad rakhna'],
  },
  {
    id: 'pro_chat_design_to_code',
    name: 'NavBharatAI Pro — Design-to-Code (Image → UI)',
    path: 'NavBharatAI Pro v5.0 → attach a design image → describe the app',
    description: `Upload a Figma export, screenshot, or UI mockup alongside your build request. NavBharatAI Pro v5.0's vision reads the design image and generates React/CSS code that matches the visual layout, colours, and component structure. You can attach several design images per request.`,
    howToUse: 'In NavBharatAI Pro v5.0, attach a design image (Figma screenshot, UI mockup, wireframe) using the attachment (📎) icon, then type your build prompt (e.g. "Build this design as a React app"). It generates matching code.',
    relatedFeatures: ['pro_chat', 'pro_chat_file_upload'],
    aiSurface: 'pro_chat',
    keywords: ['design to code', 'figma to code', 'image to code', 'ui from design', 'mockup', 'wireframe', 'screenshot to code', 'visual design', 'design convert'],
  },
  {
    id: 'pro_chat_multi_deploy',
    name: 'NavBharatAI Pro — Multi-Provider Deployment',
    path: 'NavBharatAI Pro v5.0 → "Publish" → choose a provider (Firebase / Vercel / Netlify / Cloudflare Pages)',
    description: `NavBharatAI Pro v5.0 can deploy your app to multiple platforms beyond Firebase Hosting:
• Vercel — React, Next.js, Vue apps → *.vercel.app URL
• Netlify — static sites → *.netlify.app URL
• GitHub Pages — static sites → username.github.io/repo/ URL
• Custom domains — map your own domain (Vercel)
Ask the AI to deploy (e.g. "Deploy this to Vercel using my token") and it will use the platform's REST API directly — no CLI tools needed.`,
    howToUse: 'In NavBharatAI Pro v5.0, add your provider token (Vercel, Netlify, Cloudflare) via Settings → App Settings → Secrets & API Keys, then tap "Publish" and pick that provider — or host free on NavBharatAI (no token needed).',
    relatedFeatures: ['pro_chat', 'agentv3_deploy', 'engineer_ai_deploy', 'settings_secrets'],
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
    relatedFeatures: ['admin', 'engineer_ai', 'pro_chat', 'admin-ai-insights'],
    keywords: ['metrics', 'stats', 'cost', 'admin', 'dashboard', 'builds', 'usage', 'ai cost', 'success rate', 'observability', 'logs', 'monitoring'],
  },
  {
    id: 'admin-ai-insights',
    name: 'AI Insights & NL Telemetry Query',
    path: 'Admin Dashboard → Overview → AI Insights card (admin only)',
    description: `Admin-only "AI Insights" card that turns the live metrics into readable, ACTIONABLE observations — build success rate, preview rate, average build time, repair burden, top-spend provider + share, and the per-request cost spread between providers. Every insight is DETERMINISTICALLY derived from real recorded metrics (no hallucination, no projections) and severity-tagged (good/info/warning/critical). Includes a natural-language query box: ask "what is my cost?", "how many builds failed?", "which provider is cheapest?", "why are builds slow?" and get an exact answer from the real snapshot; an unrecognized question honestly lists what CAN be answered instead of guessing. Also generates a plain-text ops report. Backend: GET /api/admin/insights and POST /api/admin/insights/query. Shows an honest "no telemetry yet" state until data exists.`,
    howToUse: 'Admin login required. Open the Admin Dashboard → Overview tab → the "AI Insights" card appears with the current insights. Type a question in the box (cost, success rate, speed, providers, preview, volume) and press Ask.',
    relatedFeatures: ['admin-metrics', 'build-performance-analytics', 'build-reliability-metrics'],
    keywords: ['ai insights', 'insights', 'nl query', 'natural language', 'ask metrics', 'ops report', 'telemetry query', 'cost question', 'admin insights', 'recommendations', 'aiops'],
  },
  {
    id: 'admin-deploy-aiops',
    name: 'AI Deployment Ops (Deploy Risk + Incident Analysis)',
    path: 'Admin/CI only — POST /api/admin/deploy-risk and POST /api/admin/incident-analysis',
    description: `Admin/CI-only AIOps endpoints (deterministic, no model call): (1) DEPLOY RISK — given a change's real signals (files changed, lines added/removed, high-criticality files touched, tests included, CI status) returns a 0–100 risk score, a low/medium/high band, the reasons, and concrete advice (a red CI forces high; tests lower risk; a big untested change raises it). (2) INCIDENT / RCA — given deploy + error events, correlates an error burst that starts right after a deploy to that deploy as the prime suspect and names the previous revision as the rollback target. Reproducible reasoning an operator or a CI step can trust.`,
    howToUse: 'From CI or an admin tool, POST to /api/admin/deploy-risk with the change signals to get a risk score before promoting, or POST deploy+error events to /api/admin/incident-analysis to get a likely cause and rollback target. Both require an admin token.',
    relatedFeatures: ['admin-metrics', 'admin-ai-insights'],
    keywords: ['deploy risk', 'aiops', 'release risk', 'incident analysis', 'rca', 'root cause', 'rollback', 'deployment risk', 'risk score', 'pre-deploy check', 'incident'],
  },
  {
    id: 'team-mentions',
    name: 'Team @Mentions (delivered to an inbox)',
    path: 'Team Collaboration → the bell icon (top-right) shows your mentions',
    description: `@mentions are now DELIVERED, not just resolved. When a teammate writes "@alice please review" in a team surface, v5.0 resolves the mention to the active member and stores a notification in that person's own in-app inbox. Each user sees a bell with an unread count in Team Collaboration; opening it lists who mentioned them, in which message, and when, with a "mark all read". You are never notified for tagging yourself. Resolution still matches by email local-part or full email; delivery is per-user and path-scoped so you only ever see your own notifications. (Email delivery remains a separate future piece — it needs an external email provider key.)`,
    howToUse: 'Open Team Collaboration and check the bell icon (top-right) for mentions. Under the hood a collaboration surface POSTs { "text": "…@handle…" } to /api/team/:teamId/mentions/notify to deliver, and each user reads their inbox from GET /api/notifications and marks read via POST /api/notifications/read.',
    relatedFeatures: ['team-library', 'team-collaboration'],
    keywords: ['mention', 'at mention', '@mention', 'tag teammate', 'notify member', 'mention resolution', 'team tagging', 'ping teammate', 'notification', 'inbox', 'bell', 'unread', 'notifications'],
  },
  {
    id: 'team-library',
    name: 'Team Library (shared prompts / templates / components)',
    path: 'Team Collaboration panel → Team Library',
    description: `A team-scoped shared library where your team can save and reuse curated PROMPTS, project TEMPLATES, and saved COMPONENTS. Unlike the global template gallery (one for everyone), this is private to your team — only ACTIVE members of the team can view and contribute. Each item has a kind (prompt/template/component), a title, and the content to reuse; you can copy an item to the clipboard or delete it. Backed by GET/POST/DELETE /api/team/:teamId/library (member-gated on the server, fail-closed).`,
    howToUse: 'Open the Team Collaboration panel → scroll to "Team Library". Pick a kind (prompt/template/component), enter a title and the content, and click "Save to library". Team members can copy any saved item or remove it.',
    relatedFeatures: ['project-templates', 'admin-release-gate'],
    keywords: ['team library', 'shared prompts', 'shared templates', 'saved components', 'reusable prompts', 'team templates', 'prompt library', 'component library', 'team collaboration', 'reuse', 'curated'],
  },
  {
    id: 'admin-release-gate',
    name: 'Release Freeze / Approval Gate',
    path: 'Admin — GET/POST /api/admin/release-gate; the pipeline checks GET /api/release/gate',
    description: `An optional safety layer on top of auto-deploy. An admin can (1) FREEZE releases during an incident (block all promotions, with an optional auto-expiry time and a reason) and/or (2) require MANUAL APPROVAL of a specific commit SHA before it may ship. The deploy pipeline checks the public GET /api/release/gate?sha=<commit> before promoting and refuses to deploy when the gate is closed. It is OPT-IN and defaults fully OPEN, so with nothing configured a normal merge deploys exactly as before, and a storage error fails OPEN (never accidentally halts deploys). Set it via POST /api/admin/release-gate (frozen, freezeReason, freezeUntilMs, approvalRequired, approvedSha).`,
    howToUse: 'As admin, POST to /api/admin/release-gate with { "frozen": true, "freezeReason": "prod incident" } to freeze deploys, or { "approvalRequired": true, "approvedSha": "<commit>" } to require approval. Set the RELEASE_GATE_URL GitHub secret to your app’s /api/release/gate URL to enforce it in the deploy workflow. Clear the freeze by POSTing { "frozen": false }.',
    relatedFeatures: ['admin-deploy-aiops', 'admin-metrics'],
    keywords: ['release gate', 'freeze', 'deploy freeze', 'release approval', 'block deploy', 'freeze window', 'change freeze', 'approval gate', 'hold release', 'incident freeze', 'stop deploy'],
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
    name: 'v5.0 Cost-Ladder Dashboard',
    path: 'Admin Dashboard → Revenue tab → "v5.0 Cost-Ladder (last 30 days)" (admin only)',
    description: `Admin-only panel showing how NavBharatAI Pro v5.0 routes builds across model tiers to control cost, with REAL telemetry (never faked):
• Total v5.0 builds and overall success rate over the last 30 days
• CHEAP-TIER SHARE — what % of builds ran on the cheapest 'gemini' start tier (the cost-ladder's whole point: simple apps build on Gemini Flash, not Pro)
• Per-start-tier breakdown table (gemini → haiku → sonnet → opus): builds, share %, success rate %, average tokens, average build time, billed amount
• Power-mode (Only-Opus) build count
• The cheap-tier success rate is the P8 cutover signal — high share + high success means the ladder is safe to enable by default
• Backend: GET /api/admin/agentv3/cost-telemetry, aggregated daily in Firestore (agentv3_cost_telemetry). Billing is unchanged (Opus-equivalent markup) — the ladder only lowers NavBharatAI's own provider cost.`,
    howToUse: 'Admin login required. Open the Admin Dashboard → Revenue tab → scroll to "v5.0 Cost-Ladder". Click Refresh to pull the latest 30-day telemetry. Data appears once Pro v5.0 builds have run.',
    relatedFeatures: ['admin', 'admin-metrics', 'pro_chat'],
    keywords: ['cost ladder', 'cost', 'tier', 'gemini', 'cheap tier', 'savings', 'model routing', 'v5.0 cost', 'build cost', 'admin', 'success rate', 'telemetry', 'opus', 'sonnet', 'haiku'],
  },
  {
    id: 'auto-dependency-sync',
    name: 'Auto Dependency Sync',
    path: 'NavBharatAI Pro v5.0 → build any app → automatic (no user action needed)',
    description: `G6 execution-hardening: after every Pro build, NavBharatAI automatically detects every package imported in the generated source code and ensures it is declared in package.json. This prevents the #1 "app generated but won't run" failure where the AI writes \`import axios from 'axios'\` but forgets to add axios to package.json, causing npm install to miss the dependency and the app to crash at runtime. Curated pinned versions are used for 30+ common packages (react-router-dom, zustand, axios, framer-motion, lucide-react, zod, @tanstack/react-query, recharts, etc.); unknown packages default to 'latest'. Non-blocking: never delays or fails the build.`,
    howToUse: 'Automatic — no action needed. Build any app in NavBharatAI Pro v5.0. If the generated code imports packages not yet in package.json, they are silently added with pinned versions before the build completes. A status message shows which packages were declared.',
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
    id: 'community-gallery',
    name: 'Community Gallery — share your app, or start from someone else\'s',
    path: 'Home \u2192 Other AI \u2192 Community Gallery',
    description: `Browse apps other NavBharatAI users have shared, and publish your own. Every listing shows what the app does, who made it, how many files it has and how many people have remixed it. REMIX starts a brand-new app for you from that app's code \u2014 you own your copy and can change anything, and the original is untouched. PUBLISHING YOUR OWN: give it a name, a description and some tags, and send it for review. Two things are deliberately true and worth knowing: (1) YOUR KEYS ARE NEVER PUBLISHED \u2014 environment files (.env and friends), installed packages, build output and images are excluded automatically, and if a real key is still sitting inside your code NavBharatAI REFUSES to publish and shows you the exact file and line so you can remove it, instead of quietly stripping it and letting you believe you published something you did not; (2) NOTHING GOES LIVE BY ITSELF \u2014 your app waits in a review queue until a NavBharatAI admin approves it, the same rule the Nav App Store follows, because a clean key-scan proves no secret leaked but does not prove the code is safe to hand to other people. Your submissions list shows exactly where each one stands (waiting for review / approved / rejected, with the reviewer's reason). A remix does not include the original's keys or installed packages \u2014 you add your own and run an install, and the app tells you so.`,
    howToUse: 'Open Home \u2192 Other AI \u2192 Community Gallery. To use someone else\'s app: find it and press Remix, then add your own keys. To share yours: fill in the name, description and tags and press "Send for review"; it appears publicly once an admin approves it. If publishing is refused, the screen lists the exact file and line where a key is still in your code.',
    relatedFeatures: ['agentv3_builder', 'nav-app-store', 'app-component-tree'],
    keywords: ['gallery', 'community', 'remix', 'fork', 'share app', 'publish', 'templates', 'examples', 'showcase', 'dusre ka app', 'app share karo', 'copy app', 'starter', 'inspiration', 'open source', 'clone'],
  },
  {
    id: 'service-split-architecture',
    name: 'Should My App Be Split Up? (and named architectures)',
    path: 'Just ask NavBharatAI while building, e.g. "should I split my app into services?" or "set up clean architecture"',
    description: `Two related things. (1) SHOULD I SPLIT? NavBharatAI reads your app's real import graph, finds the natural groups (orders, billing, …), and counts EXACTLY how many imports would have to become network API calls to separate each one — so "should we split this?" gets a number instead of an opinion. Each group is labelled a clean seam (already self-contained), costly (possible, real work), or tangled (not a module yet — splitting would mean rewriting it first). IMPORTANT AND DELIBERATE: it frequently answers "DON'T split" — for a small app, separate services add deployment and networking work and solve nothing, and even for a clean seam it tells you to split only if you have a real reason (separate deploys, different scaling, a separate team). It never touches your code; it only reports. (2) NAMED ARCHITECTURES: ask for "clean", "ddd", "mvc" or "hexagonal" and NavBharatAI creates the folder structure, a README per layer, an ARCHITECTURE.md — and, crucially, an ESLint config that ENFORCES the layer boundaries. That last part is the point: folders alone are decoration, because within a fortnight someone imports the database straight into your business rules; with the lint rule that import fails instead. Your existing code is never moved or rewritten.`,
    howToUse: 'Ask NavBharatAI "should I split my app into services?" for the analysis, or "set up clean architecture" (or ddd / mvc / hexagonal) to create the enforced structure. Both are safe — the analysis changes nothing, and the scaffold only adds folders and rules.',
    relatedFeatures: ['agentv3_builder', 'scaling-check', 'app-component-tree'],
    keywords: ['split', 'microservices', 'services', 'architecture', 'clean architecture', 'ddd', 'mvc', 'hexagonal', 'monolith', 'refactor', 'structure', 'modules', 'coupling', 'app ko todna', 'alag alag service', 'layers', 'boundaries', 'organise code', 'scale team'],
  },
  {
    id: 'mcp-server-generator',
    name: 'Connect Your App to Claude Desktop / Cursor (MCP server)',
    path: 'Just ask NavBharatAI while building, e.g. "connect my app to Claude Desktop" or "make an MCP server for my orders table"',
    description: `Gives YOUR app its own MCP server, so you can open Claude Desktop (or Cursor, or any AI assistant that supports MCP) and ask questions about your app's real data in plain language — "how many orders came today?", "find the customer named Sharma", "what are my top 5 selling items?" — and it reads the live answer from your own database. NavBharatAI writes three files into your project: a runnable server (mcp-server/index.js), the exact config block you paste into your AI client (mcp-server/claude_desktop_config.json), and a README with the setup steps. For each table you name it creates three abilities: list rows, get one row by id, and search a column for text. SAFETY, which is deliberate and not adjustable by accident: (1) it is READ-ONLY by default — the assistant can look but cannot change anything; you must explicitly ask for writes, and even then it can add and update rows but there is NEVER a delete, at any setting, because an AI runs these calls without a human approving each one; (2) it connects with your app's PUBLIC anon key, so your existing row-level security rules apply exactly as they do in your app — the assistant can never see more than a signed-out visitor could, and a service-role key (which would bypass all your rules) is never used; (3) every read is capped at 200 rows, so it cannot dump your whole table into the AI and run up your bill. Needs your app to have a database (the zero-setup NavBharatAI one counts). The server runs on YOUR computer against YOUR database.`,
    howToUse: 'While building, ask NavBharatAI: "make an MCP server for my orders and customers tables" (add "and let it add rows" if you want writes). Then: run npm install for the two listed packages, set SUPABASE_URL and SUPABASE_ANON_KEY, copy mcp-server/claude_desktop_config.json into your AI client\'s config (in Claude Desktop: Settings → Developer → Edit Config) and restart it. Your app\'s tables then appear as tools in the assistant.',
    relatedFeatures: ['agentv3_builder', 'zero-setup-database', 'scaling-check'],
    keywords: ['mcp', 'model context protocol', 'claude desktop', 'cursor', 'ai assistant', 'connect to claude', 'ask my data', 'chat with my database', 'apne data se sawal', 'claude se jodo', 'integration', 'ai tools', 'expose data', 'assistant'],
  },
  {
    id: 'scaling-check',
    name: 'Will This App Handle Real Traffic? (scaling check)',
    path: 'Home → Other AI → Insights & Webhooks → Will this app handle real traffic?',
    description: `Finds the three things that actually slow an app down as its data grows, and says how bad each one gets: (1) UNBOUNDED QUERIES — code that reads every row of a table with no limit or paging, the usual reason an app that was fast in testing times out months later; (2) QUERIES INSIDE A LOOP (the "N+1") — one database call per item instead of one for the whole list, reported differently for sequential loops (latency multiplies) and parallel Promise.all fan-outs (connection-pool exhaustion), because they fail differently; (3) MISSING INDEXES — a filter or sort on a column your migrations never indexed, which makes the database read the whole table every time. Each finding gives the file and line, how the cost grows with your data in real numbers, and the exact one-line fix (including the ready-to-paste "create index" statement). Deterministic static analysis — no AI call, so it costs nothing and cannot invent a problem that is not in your code. HONEST LIMIT: it deliberately does NOT print a "your app handles N users" figure — real capacity depends on your database plan and hosting, which the code cannot see, and it will not guess about indexes for a table whose schema it never saw. Backed by POST /api/workspace/scale-check.`,
    howToUse: 'Open Home → Other AI → Insights & Webhooks → "Will this app handle real traffic?" → Check Scaling. Green means queries are bounded, none run in a loop, and the columns you filter on are indexed; otherwise each finding shows the file:line, what happens as you grow, and the fix.',
    relatedFeatures: ['insights-integrations-panel', 'code-confidence-check', 'app-component-tree', 'agentv3_builder'],
    keywords: ['scaling', 'scale', 'slow', 'performance', 'traffic', 'load', 'n+1', 'index', 'missing index', 'database slow', 'timeout', 'too many users', 'app slow ho raha hai', 'kitne users', 'dheema', 'query slow', 'pagination', 'limit', 'optimize', 'will it scale', 'launch ready'],
  },
  {
    id: 'app-component-tree',
    name: 'What Your App Is Made Of (screen-by-screen structure)',
    path: 'Home → Other AI → Insights & Webhooks → "What your app is made of" (first card)',
    description: `Shows your app as SCREENS with the parts each screen uses underneath — not a file list and not a developer's import graph. It answers the question an owner actually asks: "what screens does my app have, and what is on each one?" Each row gives the name plus a plain-language role ("a screen", "a part of a screen", "saved data", "styling"). It also lists files that NO screen uses, under "Not used by any screen" — usually a page a user can never reach, which is a real bug worth seeing rather than hiding. Says out loud when a branch was cut short ("more inside") or when two files import each other ("loops back"), so a shortened tree never implies the app is smaller than it is. Derived from the app's own import statements — no AI call, so it costs nothing, cannot hallucinate a screen that does not exist, and works on a project restored from history.`,
    howToUse: 'Open Home → Other AI → Insights & Webhooks. The "What your app is made of" card is the first one, already filled in — no button to press. Build or open an app first; with no app it honestly says so.',
    relatedFeatures: ['insights-integrations-panel', 'code-confidence-check', 'agentv3_builder'],
    keywords: ['component tree', 'structure', 'screens', 'pages', 'what is my app made of', 'app structure', 'file tree', 'architecture', 'kitne page', 'kaun se screen', 'app ka structure', 'unused file', 'orphan page', 'dead file', 'not used', 'map of my app', 'overview'],
  },
  {
    id: 'code-confidence-check',
    name: 'Code Confidence (AI Hallucination Check)',
    path: 'Home → Other AI → Insights & Webhooks → Code Confidence',
    description: `Scans the generated app's code for AI "hallucination" signals and gives a 0–100 confidence score: HALLUCINATED DEPENDENCIES (a package imported but not in package.json — the #1 reason a generated app won't install/run), UNRESOLVED LOCAL IMPORTS (importing a file that doesn't exist), and PLACEHOLDER/STUB code (TODO/FIXME, "not implemented" throws, lorem ipsum). Low confidence is flagged with a warning so you review before shipping, instead of silently trusting the AI. Real static analysis of your actual files — no guessing.`,
    howToUse: 'Open Home → Other AI → Insights & Webhooks → "Code Confidence" → Check Code. Review the confidence score and the listed signals (each shows the file + the exact issue).',
    relatedFeatures: ['insights-integrations-panel', 'app-sbom', 'react-hooks-safety'],
    keywords: ['hallucination', 'confidence', 'ai accuracy', 'code quality', 'missing dependency', 'undeclared package', 'unresolved import', 'placeholder', 'stub', 'not implemented', 'trust', 'verify ai'],
  },
  {
    id: 'react-hooks-safety',
    name: 'React Hooks Safety (Rules of Hooks)',
    path: 'Home → Other AI → Insights & Webhooks → React Hooks Safety',
    description: `Scans the generated React code for Rules-of-Hooks violations — the #1 cause of a hard runtime crash / white screen in a React app. Catches four high-confidence patterns with real AST analysis (not regex): a hook called CONDITIONALLY (inside if/else/ternary/&&), a hook called AFTER AN EARLY RETURN (which makes it conditional), a hook called INSIDE A LOOP, and a hook called FROM A NESTED CALLBACK (event handler or .map callback, where hooks are illegal). Each violation lists the exact file, line, and hook. Because these bugs throw "React has detected a change in the order of Hooks" and blank the screen, catching them here prevents a broken preview from ever shipping. Backed by POST /api/workspace/hooks-check.`,
    howToUse: 'Open Home → Other AI → Insights & Webhooks → "React Hooks Safety" → Check Hooks. A green result means no violations; otherwise each violation shows the kind, the hook, and the file:line to fix.',
    relatedFeatures: ['code-confidence-check', 'insights-integrations-panel', 'agentv3_builder'],
    keywords: ['react hooks', 'rules of hooks', 'hook error', 'invalid hook call', 'conditional hook', 'hook order', 'white screen', 'react crash', 'usestate error', 'useeffect error', 'rendered more hooks', 'hooks lint', 'hook in loop', 'hook in condition'],
  },
  {
    id: 'import-export-consistency',
    name: 'Import / Export Consistency Check',
    path: 'Home → Other AI → Insights & Webhooks → Import / Export Consistency',
    description: `Scans the generated code for imports of names a local module does NOT actually export — e.g. "import { Foo } from './bar'" when bar never exports Foo, or a default import from a module that has no default export. These are a top cause of HARD build failures ("'Foo' is not exported by './bar'") and runtime "undefined is not a function" crashes. Exact symbol-level analysis (real AST via ts-morph): it resolves the target file, reads its true exports (including names re-exported through barrel/index files), and flags only genuine mismatches. Conservative — skips external packages, missing files (that's the Code Confidence check's job), and wildcard "export *" modules — so it doesn't cry wolf. Backed by POST /api/workspace/import-check.`,
    howToUse: 'Open Home → Other AI → Insights & Webhooks → "Import / Export Consistency" → Check Imports. A green result means every import matches; otherwise each broken import shows the name, the module it came from, and the file:line to fix.',
    relatedFeatures: ['code-confidence-check', 'react-hooks-safety', 'agentv3_builder'],
    keywords: ['import error', 'export error', 'not exported', 'is not exported', 'named import', 'default import', 'broken import', 'undefined import', 'module has no exported member', 'barrel file', 'index re-export', 'build fails import'],
  },
  {
    id: 'jsx-component-resolution',
    name: 'JSX Component Resolution Check',
    path: 'Home → Other AI → Insights & Webhooks → JSX Component Resolution',
    description: `Scans the generated JSX for components that are USED but never imported or defined — the classic "ReferenceError: Widget is not defined" that white-screens a React app the moment the element renders. Catches both plain (<Widget />) and member-expression (<styled.button>, <lib.Thing />) forms with real AST analysis (ts-morph). Deliberately conservative: it NEVER flags lowercase host elements (div/span), locally-defined components, components passed as props/params, imported components, or React/Fragment — so a green result is trustworthy. Backed by POST /api/workspace/jsx-check.`,
    howToUse: 'Open Home → Other AI → Insights & Webhooks → "JSX Component Resolution" → Check JSX. Green means every component resolves; otherwise each undefined component shows the tag and the file:line to import or define it.',
    relatedFeatures: ['import-export-consistency', 'react-hooks-safety', 'code-confidence-check', 'agentv3_builder'],
    keywords: ['is not defined', 'referenceerror', 'undefined component', 'component not imported', 'jsx error', 'missing import', 'white screen', 'react not defined', 'unknown component', 'element not defined'],
  },
  {
    id: 'hook-resolution-check',
    name: 'Hook Resolution Check',
    path: 'Home → Other AI → Insights & Webhooks → Hook Resolution',
    description: `Scans the generated code for React hooks that are CALLED but never imported or defined — e.g. useState(0) without "import { useState } from 'react'". This throws "useState is not defined" (ReferenceError) and white-screens the app. Complements the JSX and Import/Export checks (which cover components and named-import mismatches) by covering the hook-call identifier itself. Exact AST analysis (ts-morph), conservative: never flags imported hooks, locally-defined hooks, hooks passed as props/params, member-expression calls (React.useState), or non-hook functions. Also auto-enforced inside the build's readiness gate, so the builder fixes it before shipping. Backed by POST /api/workspace/hook-resolution-check.`,
    howToUse: 'Open Home → Other AI → Insights & Webhooks → "Hook Resolution" → Check Hooks. Green means every hook resolves; otherwise each undefined hook shows the call and the file:line to import or define it.',
    relatedFeatures: ['jsx-component-resolution', 'react-hooks-safety', 'import-export-consistency', 'build-health-check', 'agentv3_builder'],
    keywords: ['usestate is not defined', 'useeffect is not defined', 'hook not imported', 'undefined hook', 'referenceerror hook', 'forgot to import', 'missing hook import', 'react hook error', 'hook not defined'],
  },
  {
    id: 'dependency-constraints-check',
    name: 'Dependency Constraints Check',
    path: 'Home → Other AI → Insights & Webhooks → Dependency Constraints',
    description: `Scans package.json for dependency VERSION CONFLICTS that break "npm install" or crash the app: a react / react-dom MAJOR mismatch (they must share a major or React crashes at render), the same package pinned to two different majors across dependencies vs devDependencies, and @types/X drift (type definitions not matching the installed package). Pure, deterministic analysis from package.json alone — no registry, no network. Conservative: only clear single-major ranges are compared, so complex or multi-major ranges are never falsely flagged. The high-severity react/react-dom mismatch is also auto-enforced in the build's readiness gate, so the builder fixes it before shipping. Backed by POST /api/workspace/dependency-check.`,
    howToUse: 'Open Home → Other AI → Insights & Webhooks → "Dependency Constraints" → Check Deps. Green means no conflicts; otherwise each conflict shows its severity, the fix, and the manifest.',
    relatedFeatures: ['build-health-check', 'code-confidence-check', 'app-sbom', 'agentv3_builder'],
    keywords: ['dependency conflict', 'version conflict', 'react-dom mismatch', 'npm install fails', 'peer dependency', 'incompatible versions', 'types mismatch', 'package version', 'dependency resolution', 'conflicting dependencies'],
  },
  {
    id: 'requirement-traceability',
    name: 'Requirement Traceability Matrix',
    path: 'Backend API: POST/GET /api/workspace/traceability',
    description: `Links every requirement of your app to the files that implement it and the tests that cover it — the "requirement #3 → authService.ts → auth.test.ts" chain. Answers three questions honestly: which requirements were actually implemented (and which were silently dropped), which generated source files have no test, and which tests cover nothing (orphans). Returns a matrix per requirement (its files, each file's covering tests, and whether it is fully tested) plus a coverage summary (total / implemented / fully-tested requirements, coverage %, untested files, orphan tests). Test↔file linking uses an explicit "covers" list when provided, otherwise the auth.test.ts ↔ auth.ts filename convention. Pure, deterministic computation from the signals the build already has; the latest matrix is persisted per workspace so the IDE can re-download it. Backed by POST /api/workspace/traceability (compute + save) and GET /api/workspace/traceability?workspaceId=... (download the latest).`,
    howToUse: 'Backend API: POST /api/workspace/traceability { workspaceId?, requirements:[{id,text?}], files:[{path,requirementIds?}], tests?:[{path,covers?}] } → the matrix + coverage summary. GET /api/workspace/traceability?workspaceId=... → the latest saved matrix as downloadable JSON.',
    relatedFeatures: ['build-health-check', 'semantic-version', 'agentv3_builder'],
    keywords: ['traceability', 'requirement traceability', 'requirement to test', 'coverage matrix', 'which requirement', 'untested file', 'requirement coverage', 'dropped requirement', 'requirement to file', 'test coverage map'],
    aiSurface: 'engineer_ai',
  },
  {
    id: 'explain-code',
    name: 'Explain Code',
    path: 'Home → Other AI → Insights & Webhooks → Explain Code  (also backend POST /api/workspace/explain)',
    description: `Paste a function, component, or whole file and get an INSTANT, FREE (no AI credits) plain-language explanation of it. Deterministic structural analysis — every number is a real count of your actual code, never fabricated: (1) a plain-language summary of what the code is and does; (2) a branch-complexity score + Low/Moderate/High label; (3) the design patterns it uses (state management, side effects, memoization, React Context, async data/I·O, routing, forms, TypeScript types, error handling); (4) concrete refactoring suggestions (file too large, high complexity, multiple components in one file, async without try/catch, a list render missing a key, too many imports); and (5) structural stats (lines, functions, components, hook calls, imports, exports, JSX elements). Recognises React components, custom hooks, utility modules, class modules, and stylesheets. Backed by POST /api/workspace/explain.`,
    howToUse: 'Open Home → Other AI → Insights & Webhooks → the "Explain Code" card → paste your code → Explain. The summary, complexity, patterns, and refactor tips appear instantly. Backend API: POST /api/workspace/explain { code, filename? }.',
    relatedFeatures: ['build-health-check', 'code-confidence-check', 'requirement-traceability'],
    keywords: ['explain code', 'what does this code do', 'understand code', 'code explanation', 'complexity', 'refactor suggestions', 'code review', 'samjhao code', 'code kya karta hai', 'explain function', 'explain component'],
    aiSurface: 'engineer_ai',
  },
  {
    id: 'ai-code-review-tool',
    name: 'AI Code Review',
    path: 'Home → Other AI → AI Tools → Code Review',
    description: `Runs a REAL AI code review over a whole app\'s source: security (OWASP Top 10 — injection, XSS, hardcoded credentials, CSRF), quality (dead code, long functions, deep nesting), performance (N+1, missing memoization), tech debt (TODO/FIXME, deprecated APIs, "any" types) and accessibility. Press "Connect App" to choose a source: (1) NavBharatAI apps — any app YOU built (picked from your saved apps), or (2) GitHub apps — any of your GitHub repositories (needs GitHub connected). Pick one from the dependent dropdown, then "Review Code" fetches its real files and runs the review, returning a real 0-100 quality score + letter grade and per-finding severity/category/file:line/fix, filterable by category, dismissable, and exportable as a Markdown report. There is also a quick offline heuristic check of the current in-editor code. Backend: POST /api/app-review/review (runs the same reviewer as the post-build G5 gate, on the cheap tier); GitHub repos via GET /api/github/repos + POST /api/github/fetch.`,
    howToUse: 'Open Home → Other AI → AI Tools → Code Review → press "Connect App" → choose "NavBharatAI apps" or "GitHub apps" → pick an app/repo from the dropdown → press "Review Code". The AI reviews the real code and shows a score + prioritized findings with fixes; use Export Report to download it. GitHub source needs your GitHub account connected (Settings → GitHub).',
    relatedFeatures: ['auto-code-review', 'code-review-comments', 'build-health-check', 'agentv3_builder'],
    keywords: ['code review', 'ai code review', 'review my app', 'review github repo', 'security review', 'owasp', 'quality score', 'audit code', 'connect app', 'review code', 'code review karo', 'app review', 'github repo review', 'code quality'],
    aiSurface: 'engineer_ai',
  },
  {
    id: 'code-review-comments',
    name: 'Code Review Comments',
    path: 'Home → Other AI → Insights & Webhooks → Code Review  (also backend /api/workspace/:workspaceId/review)',
    description: `Leave GitHub-PR-style review comments anchored to a specific file + line of your project, then resolve or reply as you work through them. Comments are saved durably per project (workspace) so they persist across reloads. Each comment shows its file:line, body, resolve/reopen toggle, and reply count; unresolved comments sort to the top. Useful for self-review before shipping, or leaving notes for a teammate. Backend: POST /api/workspace/:workspaceId/review (add), GET (list), POST …/:id/resolve (resolve/reopen), POST …/:id/reply (reply).`,
    howToUse: 'Open Home → Other AI → Insights & Webhooks → the "Code Review" card → type a file path + line + your comment → Add comment. Use Resolve to close a thread or Reopen to bring it back. Requires you to be signed in.',
    relatedFeatures: ['explain-code', 'build-health-check', 'team-library'],
    keywords: ['code review', 'review comments', 'inline comments', 'pr comments', 'leave a comment', 'resolve comment', 'review mode', 'code feedback', 'annotate code', 'comment on line'],
  },
  {
    id: 'build-health-check',
    name: 'Build Health — Will this app work?',
    path: 'Home → Other AI → Insights & Webhooks → Build Health (top card) → Run All Checks',
    description: `One click that runs EVERY build-robustness check on the generated app and returns a single honest verdict on whether it will build and run: (1) Code Confidence (hallucinated deps / unresolved imports / stubs), (2) React Rules of Hooks (conditional/looped/after-return/callback hooks), (3) Import/Export Consistency (importing names a module doesn't export), and (4) JSX Component Resolution (components used but never imported/defined). Each sub-check shows pass/fail, an issue count, and a one-line summary; the top line says "all passed — good to ship" or "N issues — fix before shipping". Every number is real static analysis of your actual files. Backed by POST /api/workspace/health-check.`,
    howToUse: 'Open Home → Other AI → Insights & Webhooks → the "Build Health" card at the top → Run All Checks. Green means the app should build and run; otherwise expand the individual checks (Code Confidence, React Hooks, Import/Export, JSX Resolution) to see exact file:line fixes.',
    relatedFeatures: ['code-confidence-check', 'react-hooks-safety', 'import-export-consistency', 'jsx-component-resolution', 'agentv3_builder'],
    keywords: ['build health', 'will it work', 'run all checks', 'app health', 'pre-flight', 'preflight', 'sanity check', 'build check', 'code health', 'ship check', 'is my app broken', 'app kaam karega'],
  },
  {
    id: 'insights-integrations-panel',
    name: 'Insights & Integrations',
    path: 'Home → Other AI → Insights & Webhooks',
    description: `One panel that surfaces your project's operational insights and integrations: (1) Build SLO Compliance — per-complexity build success vs. time targets (violation rate + p95); (2) App SBOM + License Check — generate a CycloneDX Software Bill of Materials for your app's dependencies and flag any GPL/AGPL (copyleft) license risk; (3) Webhooks — register/list/delete webhook URLs and send a test, to get a POST on build/deploy events (BUILD_COMPLETE/FAILED, DEPLOY_COMPLETE/FAILED) for Slack/Discord/your CI. Real data only, with honest empty states until builds/dependencies exist.`,
    howToUse: 'Open Settings → "Insights & Webhooks". The Build SLO and SBOM sections show data for your current project; under Webhooks, paste a URL and Add it, then "Send test" to verify delivery.',
    relatedFeatures: ['webhook-manager', 'app-sbom', 'build-performance-analytics'],
    keywords: ['insights', 'integrations', 'webhooks', 'sbom', 'license', 'slo', 'build time', 'copyleft', 'slack', 'discord', 'ci', 'project insights'],
  },
  {
    id: 'webhook-manager',
    name: 'Webhook Manager',
    path: 'Home → Other AI → Insights & Webhooks → Webhooks  (also backend /api/webhooks/:userId)',
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
    path: 'Files → a "merge conflicts — Resolve" banner appears when any file has conflict markers → Resolve',
    description: `A 3-way merge conflict resolver. When a workspace file contains Git-style conflict markers (<<<<<<< / ======= / >>>>>>>) — for example after importing a GitHub repo with unresolved conflicts — the Files view shows a "merge conflicts — Resolve" banner. Tapping Resolve opens the resolver, which lists each conflict hunk side-by-side (Ours vs Theirs) with per-hunk Ours / Theirs / Both buttons and a live resolved preview; applying the resolution writes the clean, marker-free content back to the workspace file and refreshes the preview. Powered by a dependency-free diff3 engine that also auto-merges non-overlapping changes and only marks a true conflict when both sides change the same region differently. (The standalone Diff Viewer tile was retired — the AI already shows what it changed inline in the Pro v5 chat and its Diff tab — but this conflict resolver is kept and surfaces automatically when it is actually needed.)`,
    howToUse: 'In the Files view, if any file has conflict markers you\'ll see a "merge conflicts — Resolve" banner. Tap Resolve, pick Ours / Theirs / Both for each conflict, then apply to save the resolved file.',
    relatedFeatures: ['pro_chat'],
    keywords: ['merge', 'conflict', 'merge conflict', 'resolve conflict', '3-way merge', 'diff3', 'git conflict', 'HEAD', 'ours', 'theirs', 'conflict markers', 'merge editor'],
  },
  {
    id: 'build-performance-analytics',
    name: 'Build Performance Analytics',
    path: 'Home → Other AI → Analytics → Build Performance card',
    description: `Real build-pipeline health computed from your recent build jobs (not faked): success rate %, failure rate %, average build duration, p95 (slowest-5%) duration, and the top failure types (the most common build-error signatures). Helps you see if builds are getting slower or failing more often, and what's breaking most. Backed by GET /api/analytics/builds, which aggregates the last 100 jobs from the build-job store; shows honest zeros until builds have run.`,
    howToUse: 'Open Analytics (Home → Other AI → Analytics). The "Build Performance" card appears once at least one build has run, showing success/failure rate, avg + p95 duration, and the top failure types. Use Refresh to recompute.',
    relatedFeatures: ['pro_chat', 'admin-metrics', 'build-reliability-metrics', 'build-optimizer'],
    keywords: ['build performance', 'build analytics', 'success rate', 'failure rate', 'build duration', 'p95', 'slow build', 'build health', 'failure types', 'pipeline', 'build stats'],
  },
  {
    id: 'build-optimizer',
    name: 'AI Build Optimizer',
    path: 'Home → Other AI → Analytics → Build Optimizer card',
    description: `Prioritized, actionable suggestions to make your builds faster and more reliable, computed from your REAL build history (not faked): flags a high failure rate, a DOMINANT failure signature ("80% of failures share one cause — fix this one class"), a slow average build, and a slow tail (p95 much larger than the average). Each suggestion is severity-ranked (critical/warning/info) with a concrete recommendation. Deterministic analysis of the last 100 build jobs — it stays empty until at least 10 builds have run, so it never over-fits a tiny sample. Backed by GET /api/analytics/build-optimizer.`,
    howToUse: 'Open Analytics (Home → Other AI → Analytics). The "Build Optimizer" card appears once you have 10+ builds and there is something worth improving; each row shows the issue and a recommended fix.',
    relatedFeatures: ['build-performance-analytics', 'build-reliability-metrics', 'admin-metrics'],
    keywords: ['build optimizer', 'optimize build', 'build suggestions', 'faster builds', 'reduce failures', 'build recommendations', 'why builds fail', 'build slow', 'improve builds', 'failure pattern'],
  },
  {
    id: 'build-reliability-metrics',
    name: 'Build Reliability (MTTD / MTTR)',
    path: 'Home → Other AI → Analytics → Build Reliability card',
    description: `Real failure-recovery reliability computed from your recent build jobs (not faked): MTTD (Mean Time To Detect — how long a build runs before its failure surfaces), MTTR (Mean Time To Repair — time from a build failing to the next successful build of the SAME app), the recovery rate (% of failures that were later fixed), and the count of still-unresolved failures. A failure with no later success is honestly counted as unresolved and never given an invented repair time. Backed by GET /api/analytics/reliability, which correlates the last 100 jobs by workspace; shows honest zeros until failures have occurred.`,
    howToUse: 'Open Analytics (Home → Other AI → Analytics). The "Build Reliability" card appears once at least one build has failed, showing MTTD, MTTR, recovery rate, and unresolved-failure count. Use Refresh to recompute.',
    relatedFeatures: ['build-performance-analytics', 'pro_chat', 'admin-metrics'],
    keywords: ['reliability', 'mttd', 'mttr', 'mean time to detect', 'mean time to repair', 'recovery rate', 'unresolved failures', 'failure recovery', 'build reliability', 'time to fix', 'incident metrics'],
  },
  {
    id: 'auto-test-generation',
    name: 'Auto Test Generation (Phase 17)',
    path: 'NavBharatAI Pro v5.0 → build any app → automatic (no user action needed)',
    description: `After every build, NavBharatAI Pro v5.0 automatically generates Vitest test files for the most important parts of the generated app. Key capabilities:
• ANALYZES generated files by type: components, hooks, services, utilities, stores, pages, contexts — each gets a tailored test prompt.
• SELECTS highest-value files to test first (hooks > services > stores > components > pages).
• GENERATES multiple test files in parallel (up to 4 per build) using Promise.allSettled.
• WRITES category-specific tests: component tests use @testing-library/react, hook tests use renderHook, service tests mock fetch/axios, utility tests cover edge cases.
• UPDATES the validation report: the 'Automated Tests' gate changes from PENDING to PASS, showing which test files were generated.
• TEST FILES are included in the downloaded app zip so users can run them locally with: npx vitest run.`,
    howToUse: 'Automatic — no action needed. Build any app in NavBharatAI Pro v5.0. Test files (e.g. src/App.test.tsx, src/hooks/useAuth.test.ts) are automatically included in the result. Download the app and run: npm install && npx vitest run',
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
    path: 'NavBharatAI Pro v5.0 → empty chat → example cards grid (visible before first message)',
    description: `G9: When NavBharatAI Pro v5.0 has no messages yet, a grid of example prompt cards is shown. Cards cover common app types AND Bharat-first templates: Analytics Dashboard, E-commerce Page, Portfolio Site, Admin Dashboard, UPI Payment App (Razorpay integration), Hindi Language App (bilingual Devanagari), GST Invoice Generator, Startup Registration Tracker. Clicking any card fills the NavBharatAI Pro v5.0 input with a detailed prompt. The Bharat-first templates (UPI, Hindi, GST, Startup) generate real, working Indian-context apps.`,
    howToUse: 'Open NavBharatAI Pro v5.0 with no previous messages. Scroll past the header — the Quick-Start Gallery appears. Click any card to load its prompt into the chat input. For Bharat-first templates: UPI Payment needs RAZORPAY_KEY_ID, Hindi app is fully self-contained, GST Invoice needs no API key, Startup Tracker stores data in localStorage.',
    relatedFeatures: ['pro_chat'],
    aiSurface: 'pro_chat',
    keywords: ['example prompt', 'quick start', 'starter template', 'example cards', 'prompt gallery', 'what can you build', 'kya bana sakte ho', 'show examples', 'example apps', 'ideas for app', 'app ideas', 'upi', 'payment', 'hindi', 'gst', 'invoice', 'startup', 'bharat', 'india', 'razorpay', 'devanagari', 'rupee', 'msme', 'registration'],
  },
  {
    id: 'backend-scaffolds',
    name: 'Backend Scaffolds — PocketBase & Convex',
    path: 'NavBharatAI Pro v5.0 → describe a PocketBase or Convex app → auto-seeded skeleton',
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
    howToUse: 'In NavBharatAI Pro v5.0, include "pocketbase" or "convex" in your prompt. NavBharatAI auto-detects and seeds the correct skeleton. For PocketBase: set VITE_PB_URL in .env to your server URL. For Convex: run npx convex dev in the project folder to provision the backend.',
    relatedFeatures: ['pro_chat', 'auto-dependency-sync'],
    aiSurface: 'pro_chat',
    keywords: ['pocketbase', 'pocket base', 'convex', 'backend scaffold', 'self hosted', 'real time backend', 'baas', 'backend as a service', 'sqlite backend', 'pocketbase app', 'convex app', 'convex dev'],
  },
  {
    id: 'build-version-history',
    name: 'Build Version History — Go Back to Any Previous Version',
    path: 'NavBharatAI Pro v5.0 → Files tab → History',
    description: `Phase 2.1: Every successful Pro build automatically creates a version checkpoint in Firestore. The History tab in the Files panel shows all past builds for the current session, newest first, each labeled with an auto-generated commit message (e.g. "feat: build \\"todo app\\" — 12 files, vfs tier"). Users can restore any previous version with one click — the workspace reverts to that exact file snapshot and the Code Studio switches to show the restored files. Versions are retained for up to 50 builds per session. Each entry shows: commit message, relative time, file count, build tier, and version number (v1, v2, v3...).`,
    howToUse: 'Build any app in NavBharatAI Pro v5.0. Open the Files tab, then click the "History" tab in the panel header. All past builds appear as version entries. Click "Restore" next to any entry to revert the workspace to that version.',
    relatedFeatures: ['pro_chat', 'files-panel', 'auto-dependency-sync'],
    aiSurface: 'pro_chat',
    keywords: ['version history', 'go back', 'restore', 'undo build', 'previous version', 'revert', 'old version', 'build history', 'checkpoint', 'purana version', 'version 3 pe wapas', 'rollback', 'undo changes', 'history', 'past builds'],
  },
  {
    id: 'unified-memory',
    name: 'Unified Memory — your project context carries across builds',
    path: 'NavBharatAI Pro v5.0 → automatic (no user action needed)',
    description: `NavBharatAI Pro v5.0 keeps a durable, rolling memory of your project — a project summary, the tech stack, recent edits, and the decisions already made. At the start of every new build it recalls this context, so it never "starts fresh" or re-reasons choices it already made, and it builds ON TOP of your existing app instead of redoing it. The memory survives reloads, closed tabs and new sessions (it is stored durably, per project), and your highest-confidence lessons are even remembered across all your projects — so what the engine learned building one app helps it build the next.`,
    howToUse: 'Automatic — no user action needed. Keep building in NavBharatAI Pro v5.0; it remembers your project across builds (project summary, tech stack, recent edits) and applies that context to the next build automatically.',
    relatedFeatures: ['pro_chat', 'build-version-history', 'iterative-agent-build'],
    aiSurface: 'engineer_ai',
    keywords: ['memory', 'context', 'remember', 'remember project', 'forget', 'fresh start', 'context lost', 'yaad', 'bhool gaya', 'pichla kaam', 'previous build', 'project context', 'session memory', 'unified memory'],
  },
  {
    id: 'one-click-deploy',
    name: 'One-Click Publish Button',
    path: 'NavBharatAI Pro v5.0 → header action row → "Publish" (visible after an app is built)',
    description: `A "Publish" button appears in the NavBharatAI Pro v5.0 action row after any app is successfully built. Tapping it opens the Hosting chooser — host free on NavBharatAI, or bring your own provider:
• Vercel — enter token + project name → deploys to *.vercel.app
• Netlify — enter token + optional site ID → deploys to *.netlify.app
• Cloudflare Pages — enter API token + account ID + project name → deploys to {name}.pages.dev
• GitHub Pages — enter token + owner + repo → deploys to username.github.io/repo/
On success: navigates to the "App is Live!" screen with the live URL. No commands needed — pure GUI.`,
    howToUse: 'Build an app in NavBharatAI Pro v5.0. When the build completes, tap "Publish" in the action row, then either host free on NavBharatAI or pick a provider and enter its API token. For Cloudflare, you also need your Account ID (found at dashboard.cloudflare.com → top-right).',
    relatedFeatures: ['pro_chat', 'pro_chat_multi_deploy'],
    aiSurface: 'pro_chat',
    keywords: ['deploy button', 'one click deploy', 'deploy', 'vercel', 'netlify', 'cloudflare', 'cloudflare pages', 'github pages', 'publish', 'launch', 'go live', 'deploy karo', 'live karo', 'publish app', 'deploy app', 'pages.dev'],
  },
  {
    id: 'iterative-agent-build',
    name: 'Iterative Agent Build Engine',
    path: 'NavBharatAI Pro v5.0 → type any app description → send',
    description: `G10: NavBharatAI Pro v5.0 uses a multi-step agentic build engine (not a single AI call). How it works:
• PLANS first: breaks the app into 3–8 named steps shown as a live progress list (scaffold → install → implement → verify).
• BUILDS step-by-step: each step runs the ReAct loop (reason → act → verify → self-heal), building on the previous.
• LIVE PROGRESS: every action is streamed in real time — status messages, step starts/completions, terminal output (E2B tier).
• MEMORY: remembers what was built across turns; edits stay coherent across many conversation rounds.
• RETRY FIX: if a build fails, say "try again" — NavBharatAI Pro v5.0 automatically restores the original prompt so the agent knows what to rebuild (no context loss).
• PARTIAL BUILDS: if the time limit is reached, partial work is saved and auto-continued in the next round.
• TIERS: runs in-memory (VFS, always available), server container (Docker), or cloud VM (E2B, with user's API key).`,
    howToUse: 'Open NavBharatAI Pro v5.0 and type a detailed app description (e.g. "Build a photo editing app with filters, crop, and brightness controls"). Send. Watch the step-by-step progress. If build fails, type "try again" — the full original prompt is restored automatically.',
    relatedFeatures: ['pro_chat', 'one-click-deploy', 'quick-start-gallery'],
    aiSurface: 'pro_chat',
    keywords: ['iterative build', 'step by step', 'agent build', 'build failed try again', 'try again', 'retry build', 'complex app', 'multi step', 'pro chat build', 'app build', 'build engine', 'photo editing app', 'phir se bana', 'dobara bana', 'memory', 'context', 'remember'],
  },
  {
    id: 'guider-plan-confirm',
    name: 'Guider — Pre-Build Design Confirmation + Post-Build Quality Grader',
    path: 'NavBharatAI Pro v5.0 → type any app description → Guider card appears before build starts',
    description: `Guider is the NavBharatAI Pro v5.0 quality layer that wraps every build with two checks:

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
    howToUse: 'Open NavBharatAI Pro v5.0 and describe an app. A Guider design card will appear — review and click Approve (or edit it). Build starts. After it completes, watch for the Guider grade message — it will auto-fix gaps.',
    relatedFeatures: ['iterative-agent-build', 'pro_chat', 'auto-code-review'],
    aiSurface: 'pro_chat',
    keywords: ['guider', 'design plan', 'plan confirmation', 'approve plan', 'build spec', 'quality check', 'grade', 'refine', 'auto refine', 'gaps', 'requirements', 'spec', 'confirmation card', 'before build', 'pre build', 'post build', 'quality score', 'plan approve karo', 'design confirm'],
  },
  {
    id: 'auto-code-review',
    name: 'Auto Code Review',
    path: 'NavBharatAI Pro v5.0 → build any app → review appears in the build summary',
    description: `G5 quality gate: after every new Pro build, an AI-powered code review runs automatically:
• Security: OWASP Top 10 checks (injection, XSS, hardcoded credentials, CSRF)
• Quality: unused imports, dead code, functions >50 lines, deep nesting
• Performance: N+1 queries, missing React.memo, large bundle imports
• Tech Debt: TODO/FIXME comments, deprecated APIs, TypeScript 'any' types
• Accessibility: missing alt attributes, missing ARIA labels
Returns a 0-100 score + prioritized findings with file:line + fix suggestion.
Non-blocking: review never delays or fails the build (12s timeout, best-effort).
Also available on-demand via Settings → Pro → Code Review button.`,
    howToUse: 'Build any app in NavBharatAI Pro v5.0 — the code-review score and top issues appear in the build summary message automatically. For an on-demand review without rebuilding, use Home → Other AI → AI Tools → Code Review.',
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
    name: 'Multi-Framework Builder (v5.0)',
    path: 'NavBharatAI Pro v5.0 → header → framework badge (or ⚙ → Framework)',
    description: `NavBharatAI Pro v5.0 can build apps in 24 different frameworks and tech stacks, and you can pick a framework TWO ways — they stay in sync:
Frontend: React + Vite, Next.js, Remix, Preact, Vue 3, Nuxt 3, Svelte, SvelteKit, SolidJS, Angular, Astro, Lit (Web Components), Alpine.js, Vanilla TypeScript.
Backend / API: Express.js, Hono, NestJS, Fastify, FastAPI (Python), Django (Python), Flask (Python), Spring Boot (Java), Go.
Static: plain HTML/CSS/JS.
BIDIRECTIONAL SELECTION: (1) pick a framework in the picker (⚙ → Framework or the header badge) — a deliberate pick always wins; OR (2) just NAME it in your build request ("build a Next.js dashboard", "a Django REST API", "a Hono edge API") and v5.0 auto-selects the matching scaffold. A pure backend/API request picks a backend framework; a web-app request that mentions a backend (e.g. "a React dashboard with an Express backend") stays front-end-first and the backend is wired in. Every framework gets a full starter scaffold (package.json, config, entry files) pre-seeded so the agent starts immediately, with per-framework instructions (routing conventions, dev-server port, common pitfalls).`,
    howToUse: 'Two ways, both live: (A) SETTINGS — in Pro v5.0 chat click the framework badge in the header (e.g. "⚛ React + Vite") or ⚙ → Framework; the picker has All / Frontend / Full-Stack / Backend / Static filters — select and Confirm. (B) CHAT — just name the framework in your build request and v5.0 selects it automatically. If you both pick one AND name a different one, your explicit pick wins.',
    relatedFeatures: ['pro_chat', 'v3-github-import', 'iterative-agent-build'],
    aiSurface: 'pro_chat',
    keywords: ['framework', 'nextjs', 'vue', 'svelte', 'sveltekit', 'solid', 'solidjs', 'preact', 'lit', 'web components', 'alpine', 'hono', 'spring boot', 'go', 'golang', 'angular', 'astro', 'django', 'flask', 'fastapi', 'nestjs', 'express', 'fastify', 'nuxt', 'remix', 'vanilla', 'python', 'java', 'stack', 'technology', 'kaunsa framework', 'react', 'typescript', 'javascript', 'tech stack', 'choose framework', 'framework select', 'framework badalna', 'change framework'],
  },
  {
    id: 'v3-github-import',
    name: 'GitHub / URL Import (v5.0)',
    path: 'NavBharatAI Pro v5.0 → ⚙ → Import Repo',
    description: `Import an existing project from any public GitHub repository (or any git URL) directly into the v5.0 workspace. Once imported, you can ask the agent to understand the code, fix bugs, add features, or continue building on top of it. The import clones the repo into the live sandbox — the agent then works on the real files just as if it had created them. Private repos work if you have connected your GitHub account in Settings → Connections (your OAuth token is automatically forwarded).`,
    howToUse: '1. In Pro v5.0, open ⚙ (build options) → Import Repo. 2. Paste the GitHub URL (e.g. https://github.com/username/my-app). 3. Click "Set Import". 4. Then send your first message (e.g. "Analyze this project" or "Add dark mode"). The repo will be cloned into the workspace before the agent starts.',
    relatedFeatures: ['pro_chat', 'v3-framework-selector', 'iterative-agent-build'],
    aiSurface: 'pro_chat',
    keywords: ['import', 'github', 'clone', 'existing app', 'existing project', 'repo', 'repository', 'my app', 'upload', 'firebase import', 'github se import', 'apni app', 'existing code', 'already made', 'meri app', 'koi bhi app'],
  },

  // ─── MOBILE APP (Android/iOS shell) ──────────────────────────────────────
  {
    id: 'mobile_app_update',
    name: 'App Update Notice (mobile)',
    path: 'Automatic — inside the installed Android/iOS app.',
    description: `When you use the NavBharatAI mobile app (installed from the Play Store) and a newer version has been published, the app shows a small "A new version is available" banner at the bottom of the screen with an "Update" button. Tapping it opens the store listing so you can install the latest version. This exists because the mobile app ships its screens bundled inside the app, so new features arrive with an app update — the banner tells you when one is ready. It only appears when an update actually exists; on the website there is nothing to update.`,
    howToUse: '1. Open the NavBharatAI app after a new version is published. 2. If an update is available, a banner appears at the bottom. 3. Tap "Update" to go to the store and install it (or "×" to dismiss for now). On the website, updates are automatic — no action needed.',
    relatedFeatures: ['mobile_app_rating'],
    aiSurface: 'nbi_chat',
    keywords: ['update', 'app update', 'new version', 'update app', 'update available', 'play store update', 'purana version', 'app update karo', 'naya version', 'update kaise kare', 'app update nahi ho raha', 'latest version', 'upgrade app'],
  },
  {
    id: 'mobile_app_rating',
    name: 'Rate the App (mobile)',
    path: 'Automatic — the native rating card appears inside the installed app after you have used it a while.',
    description: `In the NavBharatAI mobile app, after you have opened and used the app enough times over a few days, the native Google Play / App Store rating card appears so you can give a star rating and review without leaving the app. It is shown at a natural moment and never repeatedly nags — it respects the store's own limits. You can also rate the app any time from its Play Store / App Store listing.`,
    howToUse: '1. Keep using the NavBharatAI app normally. 2. After enough real usage, the native rating popup appears — pick your star rating and (optionally) write a review right there. 3. To rate any time, open the app\'s Play Store / App Store page and tap the stars.',
    relatedFeatures: ['mobile_app_update'],
    aiSurface: 'nbi_chat',
    keywords: ['rate', 'rating', 'review', 'rate app', 'give rating', 'stars', 'rate us', 'feedback', 'play store rating', 'rating do', 'app ko rate karo', 'review likho', 'rating popup', '5 star', 'rate the app'],
  },
  {
    id: 'mobile_push_notifications',
    name: 'Push Notifications (mobile)',
    path: 'Automatic — the app asks for notification permission once, right after you sign in on the installed Android/iOS app.',
    description: `In the NavBharatAI mobile app (installed from the Play Store or App Store), NavBharatAI sends real push notifications for two events: (1) a build finishing — success or a real problem — so you don't have to keep the app open and watch it, and (2) your wallet balance hitting ₹0, so a build never fails silently for a reason you didn't know about. The app asks for notification permission once, right after you sign in; if you decline, you simply won't receive these — nothing else in the app is affected. There is no separate in-app notification settings screen yet — to change your choice later, use your phone's own system Settings → Apps → NavBharatAI → Notifications. Not available on the website (browser notifications are a different, unrelated thing).`,
    howToUse: '1. Sign in on the installed NavBharatAI app. 2. Allow notifications when asked (once). 3. You\'ll get a push when a build finishes or your wallet reaches ₹0 — tap it to open the app. To turn notifications off/on later, use your phone\'s system Settings for the NavBharatAI app.',
    relatedFeatures: ['mobile_app_update', 'wallet_billing'],
    aiSurface: 'nbi_chat',
    keywords: ['push notification', 'notifications', 'notification', 'build finished notification', 'balance alert', 'wallet notification', 'notify', 'alert', 'notification on', 'notification off', 'notification band karo', 'suchna', 'build complete alert', 'app notification'],
  },
];

/** Quick lookup by id. */
export function getFeatureById(id: string): AppFeature | null {
  return APP_KNOWLEDGE_BASE.find(f => f.id === id) ?? null;
}
