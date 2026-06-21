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
  // ─── ENGINEER AI ─────────────────────────────────────────────────────────
  {
    id: 'engineer_ai',
    name: 'Engineer AI',
    path: 'Header → Engineer AI tab  OR  Sidebar → Professionals → Engineer AI',
    description: `Autonomous full-stack AI coding agent. Complete capabilities:
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
    description: 'Clinical decision-support AI for qualified doctors. Capabilities: structured history taking (one focused question at a time), red-flag screening, differential diagnosis, investigation guidance, and clinical note maintenance. IMPORTANT: assists the treating physician — does not replace clinical judgment.',
    howToUse: 'Open Doctor AI and describe the case (start with patient demographics and chief complaint). It asks one focused question at a time and builds a clinical note.',
    relatedFeatures: ['professionals', 'history'],
    aiSurface: 'sda_chat',
    // IMPORTANT: keywords must be app-navigation terms only (what a user types to FIND the feature),
    // NOT clinical content terms (those appear in real doctor-patient conversations and must not trigger injection).
    keywords: ['doctor ai', 'senior doctor', 'medical ai', 'clinical ai', 'doctor assistant', 'sda chat', 'doctor screen', 'open doctor'],
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
• FILES — file explorer: browse, create, rename, delete files and folders in your project.
• EDITOR — syntax-highlighted code editor for all file types (TypeScript, React, Python, HTML, CSS, etc.).
• PREVIEW — live preview of the running app with hot-reload.
• TERMINAL — bash shell to run any command (npm install, git, curl, etc.).
• GIT — version control panel: commit, push, pull, view diffs.
• LOGS — build and runtime output for debugging.
• SETTINGS — workspace and IDE configuration.`,
    howToUse: 'Open IDE from the sidebar. Use the panel tabs (Files, Editor, Preview, Terminal, Git, Logs) to develop your project.',
    relatedFeatures: ['settings_git', 'settings_terminal', 'settings_logs', 'pro_chat'],
    keywords: [
      'ide', 'code studio', 'editor', 'code', 'files', 'preview', 'terminal', 'shell',
      'file explorer', 'code editor', 'git panel', 'build output', 'live preview',
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

  // ─── PROFESSIONALS HUB ───────────────────────────────────────────────────
  {
    id: 'professionals',
    name: 'Professionals Hub',
    path: 'Sidebar → Professionals',
    description: 'The hub for specialized professional AI assistants. Currently hosts Doctor AI (clinical decision support) and Engineer AI (autonomous app builder). Future AI assistants will appear here.',
    howToUse: 'Open Professionals from the sidebar, then choose the AI specialist you need.',
    relatedFeatures: ['doctor_ai', 'engineer_ai'],
    keywords: ['professionals', 'specialists', 'experts', 'professional ai', 'specialist ai', 'doctor ai engineer ai'],
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
    id: 'login_auth',
    name: 'Login / Sign Up',
    path: 'Header → Login button (top right)',
    description: 'Sign in or create a NavBharatAI account. Authentication is required to save sessions, use Engineer AI, access Pro features, and store settings. Login with email/password or Google sign-in.',
    howToUse: 'Click the Login button in the top-right of the header. Create an account or sign in with an existing account.',
    relatedFeatures: ['history', 'settings_root'],
    keywords: ['login', 'sign in', 'sign up', 'register', 'account', 'auth', 'logout', 'google login', 'login kaise', 'account kahan'],
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
• Refresh button to pull the latest snapshot from the server
• Backend: persisted daily to Firestore (metrics_snapshots) — survives Cloud Run restarts
• Historical data available via GET /api/admin/metrics/history
• Structured server logs queryable via GET /api/admin/logs`,
    howToUse: 'Admin login required. Open Settings → App Settings → scroll to bottom → Live Metrics button (visible only when logged in as admin). Click Refresh Metrics to update.',
    relatedFeatures: ['admin', 'engineer_ai', 'pro_chat'],
    keywords: ['metrics', 'stats', 'cost', 'admin', 'dashboard', 'builds', 'usage', 'ai cost', 'success rate', 'observability', 'logs', 'monitoring'],
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
];

/** Quick lookup by id. */
export function getFeatureById(id: string): AppFeature | null {
  return APP_KNOWLEDGE_BASE.find(f => f.id === id) ?? null;
}
