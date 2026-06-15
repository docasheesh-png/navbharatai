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
  | 'home' | 'chat' | 'nbi_chat' | 'nbi_pro_chat' | 'asc_chat' | 'sda_chat'
  | 'files' | 'history' | 'preview' | 'shell' | 'git' | 'logs' | 'settings'
  | 'deploy' | 'templates' | 'entertainment' | 'donation' | 'studio' | 'report'
  | 'security' | 'about' | 'admin' | 'billing' | 'secrets' | 'testing' | 'api'
  | 'diff' | 'database' | 'voice' | 'botbuilder' | 'cost' | 'screenshot'
  | 'multipages' | 'analytics' | 'debugger' | 'performance' | 'components'
  | 'seo' | 'apk' | 'figma' | 'domain' | 'team' | 'pwa' | 'minifier'
  | 'darkmode' | 'monetize' | 'imagegen' | 'versioning' | 'apimarket'
  | 'appstore' | 'collab' | 'aitesting' | 'localization' | 'codereview'
  | 'dbstudio' | 'cicd' | 'plugins' | 'whitelabel' | 'projectmgr'
  | 'cloudeploy' | 'designsys' | 'healthmon' | 'engine_builder';

export type SettingsScreen =
  | 'root' | 'general' | 'modules' | 'secrets' | 'connections'
  | 'github_repos' | 'sharing' | 'deploy' | 'access' | 'shell'
  | 'git' | 'logs' | 'report';

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
