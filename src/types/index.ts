// Central type definitions — extracted from App.tsx (Phase 1 Task 1.1)
// All types are exported so any module can import them without going through App.tsx.

import type { AgentMode } from '../components/ide/ModeSelector';
export type { AgentMode };

export interface MessageAttachment {
  name: string;
  type: string;   // MIME type
  dataUrl?: string; // base64 data URL for display/zoom
}

export interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date | string;
  modelUsed?: string;
  meta?: Record<string, unknown>;
  attachments?: MessageAttachment[];
}

export interface FileSystem {
  [path: string]: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  files: FileSystem;
  lastUpdated: Date | string;
  isPinned?: boolean;
  mode?: AgentMode;
  agent?: string;
  uci?: string;
  originalAgent?: string;
  currentAgent?: string;
  memorySummary?: string;
  /** Claude-Code-style log of changes made in this build session (newest last). */
  editLog?: string[];
  continuationChain?: string[];
  restoredMessages?: Message[];
}

export interface ApiKeys {
  gemini: string;
  groq: string;
  deepseek: string;
  openai: string;
  openrouter: string;
  claude: string;
}

export interface AppSecret {
  id: string;
  label: string;
  value: string;
  provider: string;
  masked: boolean;
}

export interface BrainConfig {
  engine: string;
  model: string;
  keys: ApiKeys;
}

export type ViewType =
  | 'home' | 'chat' | 'nbi_chat' | 'nbi_pro_chat' | 'asc_chat' | 'sda_chat' | 'offline_ai'
  | 'files' | 'history' | 'preview' | 'shell' | 'git' | 'logs' | 'settings'
  | 'deploy' | 'templates' | 'donation' | 'studio' | 'report'
  | 'security' | 'about' | 'admin' | 'billing' | 'secrets' | 'testing' | 'api'
  | 'diff' | 'database' | 'voice' | 'botbuilder' | 'cost' | 'screenshot'
  | 'multipages' | 'analytics' | 'debugger' | 'performance' | 'components'
  | 'seo' | 'apk' | 'figma' | 'domain' | 'team' | 'pwa' | 'minifier' | 'sharereview'
  | 'darkmode' | 'monetize' | 'imagegen' | 'versioning' | 'apimarket'
  | 'appstore' | 'collab' | 'aitesting' | 'localization' | 'codereview'
  | 'dbstudio' | 'cicd' | 'plugins' | 'whitelabel'
  | 'designsys' | 'healthmon' | 'engine_builder' | 'professionals'
  | 'my_profile' | 'insights' | 'other_ai' | 'gallery'
  | 'engineer_ai' | 'connect_domain' | 'teacher_ai' | 'mentor_ai' | 'thesis_ai' | 'accountant_ai' | 'lawyer_ai' | 'finance_ai' | 'astrologer_ai' | 'govt_schemes_ai' | 'kisan_ai' | 'nutritionist_ai' | 'wellness_ai' | 'fitness_ai' | 'vet_ai' | 'parenting_ai' | 'cybersafety_ai' | 'insurance_ai' | 'chef_ai' | 'travel_ai' | 'vastu_ai' | 'yoga_ai' | 'english_ai' | 'resume_ai' | 'gardening_ai' | 'pharmacist_ai' | 'business_ai' | 'homerepair_ai' | 'realestate_ai' | 'driving_ai' | 'petcare_ai' | 'beauty_ai' | 'music_ai' | 'sports_ai' | 'photography_ai' | 'speaking_ai' | 'events_ai' | 'eldercare_ai' | 'interior_ai' | 'studyabroad_ai' | 'disability_ai' | 'fashion_ai' | 'productivity_ai' | 'relationship_ai' | 'vehicle_ai' | 'stocks_ai' | 'techhelp_ai' | 'mathscience_ai' | 'coding_ai' | 'maternity_ai' | 'firstaid_ai' | 'environment_ai' | 'gk_ai' | 'safety_ai' | 'translate_ai' | 'civic_ai' | 'sarkari_ai' | 'spiritual_ai' | 'crafts_ai' | 'festival_ai' | 'writing_ai' | 'aptitude_ai' | 'disaster_ai' | 'nature_ai' | 'freelance_ai' | 'babynames_ai' | 'hygiene_ai' | 'volunteer_ai' | 'astronomy_ai' | 'calligraphy_ai' | 'dance_ai' | 'games_ai' | 'techbuy_ai' | 'adventure_ai' | 'budget_ai' | 'repo_analyst';

export type SettingsScreen =
  // 'modules' REMOVED 2026-08-14 — an unreachable screen (nothing ever set it) that hid the only
  // Git & Deployment button. Keeping a member nothing can navigate to invites the same bug back.
  | 'root' | 'general' | 'secrets' | 'database' | 'connections'
  | 'github_repos' | 'sharing' | 'deploy' | 'access'
  | 'git' | 'logs' | 'report' | 'metrics' | 'profile'
  // "Your Website" hub (admin 2026-07-29): the real-website essentials, brought into App Settings.
  // 'hosting' was merged into 'cloudeploy' as a duplicate (2026-07-29); 'cloudeploy' itself was then
  // REMOVED 2026-08-20 — the v5.0 Publish sheet already deploys to the user's own Vercel/Netlify/
  // Cloudflare, while that screen still read the retired v2.0 channel and so could not see a v5.0 app
  // at all. Same lesson as 'modules' above: a duplicate surface is where this bug class comes back.
  | 'domain' | 'auth' | 'storage'
  // Legal & Trust pages (admin 2026-08-08): one screen per document, driven by the legal registry.
  | 'legal_privacy' | 'legal_terms' | 'legal_dpa' | 'legal_security' | 'legal_nda';

export type ErrorType = 'AUTH' | 'QUOTA' | 'NETWORK' | 'CONFIG' | 'UNKNOWN';

export interface ErrorContext {
  type: ErrorType;
  message: string;
  provider?: string;
  lastInput?: string;
}

export interface Log {
  id: string;
  text: string;
  type: 'info' | 'error' | 'success' | 'warn';
  timestamp: Date;
}

export const PROVIDER_CONFIG: Record<string, { label: string; link: string; icon: string }> = {
  gemini:      { label: 'Sovereign Cognitive Engine',       link: 'https://aistudio.google.com/app/apikey',         icon: 'Google' },
  openai:      { label: 'Semantic Orchestration Core',      link: 'https://platform.openai.com/api-keys',            icon: 'OpenAI' },
  groq:        { label: 'Ultra-Low-Latency Stream Core',    link: 'https://console.groq.com/keys',                   icon: 'Groq' },
  deepseek:    { label: 'Hyper-Inference Matrix Core',      link: 'https://platform.deepseek.com/api_keys',          icon: 'DeepSeek' },
  openrouter:  { label: 'Sovereign Logic Router',           link: 'https://openrouter.ai/keys',                      icon: 'OpenRouter' },
  claude:      { label: 'Deep Reasoning Logic Core',        link: 'https://console.anthropic.com/settings/keys',     icon: 'Anthropic' },
};
