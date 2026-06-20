/**
 * Phase 21 — App Self-Awareness: NavBharatAI Brain.
 *
 * A single, machine-readable map of every NavBharatAI feature, screen, and
 * setting. Every AI surface (Engineer AI, Doctor AI, Pro chat) consults this
 * via AppContextInjector so it can answer "where is X?" / "how do I do Y?"
 * with the exact navigation path — instead of guessing.
 *
 * SOURCE OF TRUTH: when a new user-facing feature, screen, or setting ships,
 * add its entry here in the same PR. A feature not listed here is invisible to
 * every AI in NavBharatAI.
 */

export interface AppFeature {
  /** Stable identifier (snake_case). */
  id: string;
  /** Human-readable feature name. */
  name: string;
  /** How to navigate there, e.g. "Sidebar → Settings → Database". */
  path: string;
  /** What it does. */
  description: string;
  /** Step-by-step usage for an end user. */
  howToUse: string;
  /** Related feature ids (for "what else is connected to this"). */
  relatedFeatures: string[];
  /** Which AI owns this surface, if any (e.g. "engineer_ai", "sda_chat"). */
  aiSurface?: string;
  /** Lowercase keywords that should trigger this entry in a user's question. */
  keywords: string[];
}

export const APP_KNOWLEDGE_BASE: AppFeature[] = [
  {
    id: 'engineer_ai',
    name: 'Engineer AI',
    path: 'Sidebar → Professionals → Engineer AI',
    description: 'Autonomous AI agent that builds, runs, tests, and deploys full web apps in a real cloud sandbox. It can see the running app, drive the browser, clone GitHub repos, and deploy to a permanent URL.',
    howToUse: 'Open Engineer AI, describe the app you want in plain language, and it builds it step by step — showing a live preview you can watch.',
    relatedFeatures: ['settings_database', 'settings_secrets', 'history'],
    aiSurface: 'engineer_ai',
    keywords: ['engineer', 'build app', 'autonomous', 'agent', 'deploy', 'sandbox', 'code agent'],
  },
  {
    id: 'doctor_ai',
    name: 'Doctor AI (Senior Doctor Assistant)',
    path: 'Sidebar → Professionals → Doctor AI',
    description: 'Clinical decision-support AI for qualified doctors — clinical reasoning, structured history taking (one question at a time), red-flag screening, differentials, and investigation guidance. Assists, never replaces, the treating physician.',
    howToUse: 'Open Doctor AI and describe the case (start with demographics). It guides you through the workup one focused question at a time and maintains a clinical note.',
    relatedFeatures: ['history'],
    aiSurface: 'sda_chat',
    keywords: ['doctor', 'clinical', 'medical', 'sda', 'patient', 'diagnosis', 'consultant'],
  },
  {
    id: 'pro_chat',
    name: 'NavBharatAI Pro Chat (Build Mode)',
    path: 'Home → Pro Chat',
    description: 'The Pro app-maker chat. Describe any web app and it generates a complete working app instantly, with planning, auto-build, and conversation modes.',
    howToUse: 'From Home, open Pro Chat, describe your app idea, and switch to Build Mode to generate the actual app.',
    relatedFeatures: ['free_chat', 'ide', 'engineer_ai'],
    aiSurface: 'pro_chat',
    keywords: ['pro chat', 'pro', 'build mode', 'app maker', 'make app', 'generate app'],
  },
  {
    id: 'free_chat',
    name: 'Free Chat (Reports)',
    path: 'Sidebar → Reports',
    description: 'General-purpose free AI chat for questions, explanations, and document analysis.',
    howToUse: 'Open Reports from the sidebar and type your question.',
    relatedFeatures: ['pro_chat', 'history'],
    aiSurface: 'nbi_chat',
    keywords: ['free chat', 'reports', 'general chat', 'ask question'],
  },
  {
    id: 'ide',
    name: 'IDE / Code Studio',
    path: 'Sidebar → IDE',
    description: 'A full in-browser code editor (Code Studio) with file explorer, live preview, terminal/shell, git, logs, and a suite of developer tools.',
    howToUse: 'Open IDE from the sidebar to edit files, run a preview, use the terminal, and access developer tools.',
    relatedFeatures: ['settings_git', 'settings_terminal', 'pro_chat'],
    keywords: ['ide', 'code studio', 'editor', 'code', 'files', 'preview', 'terminal', 'shell'],
  },
  {
    id: 'settings_root',
    name: 'Settings',
    path: 'Sidebar → Settings',
    description: 'The settings hub, organized into groups: App Settings (General, Secrets & Keys, Database, Connections, Terminal, Logs, Git), AI Tools, Developer Tools, Design & Build, Publish & Deploy, and Monetization & Team.',
    howToUse: 'Open Settings from the sidebar, then pick a group and the specific item you need.',
    relatedFeatures: ['settings_database', 'settings_secrets', 'settings_general', 'settings_modules'],
    keywords: ['settings', 'options', 'configuration', 'preferences', 'config'],
  },
  {
    id: 'settings_database',
    name: 'Database Settings (Bring Your Own Database)',
    path: 'Sidebar → Settings → App Settings → Database',
    description: 'Where users connect their own database provider (Supabase, Firebase, MongoDB, Neon, Appwrite, or Other). Credentials stay in the user\'s own account — NavBharatAI never stores user app data on its own backend.',
    howToUse: 'Settings → Database → choose your provider → a direct link to that provider\'s API-key page appears → paste your URL/keys → Save. Engineer AI then scaffolds the SDK setup for that provider automatically.',
    relatedFeatures: ['engineer_ai', 'settings_secrets'],
    keywords: ['database', 'db', 'supabase', 'firebase', 'mongodb', 'neon', 'appwrite', 'byod', 'connect database', 'backend'],
  },
  {
    id: 'settings_secrets',
    name: 'Secrets & Keys',
    path: 'Sidebar → Settings → App Settings → Secrets & Keys',
    description: 'A secure store for API keys and tokens (e.g. GITHUB_TOKEN used by Engineer AI to clone and push repos). Keys are scoped to the user.',
    howToUse: 'Settings → Secrets & Keys → add a key name and value → Save. Engineer AI reads relevant secrets (like GITHUB_TOKEN) automatically.',
    relatedFeatures: ['engineer_ai', 'settings_git'],
    keywords: ['secrets', 'keys', 'api key', 'token', 'github token', 'credentials'],
  },
  {
    id: 'settings_general',
    name: 'General Settings',
    path: 'Sidebar → Settings → App Settings → General',
    description: 'App name, device/preview mode, app description, developer mode, and language preferences.',
    howToUse: 'Settings → General to change the app name, language, device mode, or enable developer mode.',
    relatedFeatures: ['settings_root'],
    keywords: ['general', 'app name', 'language', 'developer mode', 'device mode'],
  },
  {
    id: 'settings_modules',
    name: 'Brain Engine / Modules (AI Provider Keys)',
    path: 'Sidebar → Settings → Modules',
    description: 'Configure your own AI provider credentials (Gemini, OpenAI, Groq, DeepSeek, OpenRouter, Claude) and toggle workspace panels.',
    howToUse: 'Settings → Modules → paste the API key for the AI provider you want to use.',
    relatedFeatures: ['settings_secrets'],
    keywords: ['modules', 'brain engine', 'ai keys', 'gemini', 'openai', 'claude', 'groq', 'deepseek', 'openrouter', 'provider'],
  },
  {
    id: 'settings_git',
    name: 'Git',
    path: 'Sidebar → Settings → App Settings → Git',
    description: 'Git integration for connecting GitHub repositories and managing version control.',
    howToUse: 'Settings → Git to connect a repository. Pair it with a GITHUB_TOKEN in Secrets & Keys for private repos.',
    relatedFeatures: ['settings_secrets', 'ide'],
    keywords: ['git', 'github', 'version control', 'repo', 'repository', 'commit', 'push'],
  },
  {
    id: 'settings_terminal',
    name: 'Terminal / Shell',
    path: 'Sidebar → Settings → App Settings → Terminal (also available in the IDE)',
    description: 'A command-line shell into the workspace for running commands.',
    howToUse: 'Open Terminal from Settings or the IDE to run shell commands in your workspace.',
    relatedFeatures: ['ide', 'settings_logs'],
    keywords: ['terminal', 'shell', 'command line', 'console', 'bash'],
  },
  {
    id: 'settings_logs',
    name: 'Logs',
    path: 'Sidebar → Settings → App Settings → Logs',
    description: 'View build and runtime logs for debugging.',
    howToUse: 'Settings → Logs to inspect recent build and runtime output.',
    relatedFeatures: ['ide', 'settings_terminal'],
    keywords: ['logs', 'log', 'debug output', 'build log', 'runtime log'],
  },
  {
    id: 'history',
    name: 'History',
    path: 'Sidebar → History',
    description: 'Your saved chat and build sessions so you can return to earlier work.',
    howToUse: 'Open History from the sidebar to find and resume a previous session.',
    relatedFeatures: ['engineer_ai', 'doctor_ai', 'pro_chat'],
    keywords: ['history', 'past chats', 'previous session', 'old chat', 'resume'],
  },
  {
    id: 'billing',
    name: 'Billing',
    path: 'Sidebar → Settings → Billing',
    description: 'Your current plan and usage.',
    howToUse: 'Open Billing to view your plan and usage details.',
    relatedFeatures: ['settings_root'],
    keywords: ['billing', 'plan', 'subscription', 'usage', 'payment', 'pricing'],
  },
  {
    id: 'donate',
    name: 'Donate',
    path: 'Sidebar → Donate',
    description: 'Support NavBharatAI through a donation.',
    howToUse: 'Open Donate from the sidebar to contribute.',
    relatedFeatures: [],
    keywords: ['donate', 'donation', 'support', 'contribute'],
  },
  {
    id: 'professionals',
    name: 'Professionals',
    path: 'Sidebar → Professionals',
    description: 'The hub for specialized professional AI assistants, including Doctor AI and Engineer AI.',
    howToUse: 'Open Professionals from the sidebar to choose a specialized AI (Doctor AI, Engineer AI).',
    relatedFeatures: ['doctor_ai', 'engineer_ai'],
    keywords: ['professionals', 'specialists', 'experts', 'professional ai'],
  },
];

/** Quick lookup by id. */
export function getFeatureById(id: string): AppFeature | null {
  return APP_KNOWLEDGE_BASE.find(f => f.id === id) ?? null;
}
