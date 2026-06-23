// AgentV3 (Vargen 3.0) — intent classification for cost routing.
//
// Every v3.0 message currently runs the full Claude native-tool-use agent loop,
// which is expensive even for a plain "hello". This pure classifier lets the
// route answer clearly social/conversational turns cheaply via the existing
// non-Claude free router and reserve the premium Claude build loop for real
// build/engineering requests — WITHOUT changing the user experience.
//
// SAFETY: this is conservative by design. It returns 'chat' ONLY for messages
// that are clearly social; on any doubt it returns 'build', so a real build
// request is NEVER answered conversationally. Pure and deterministic (no I/O),
// so it is trivially unit-testable.

/** Whether a message is plain conversation ('chat') or a real build request ('build'). */
export type BuildIntent = 'chat' | 'build';

/**
 * Build/engineering signal words and verbs (English + common Hindi/Hinglish
 * forms). ANY of these in the message forces 'build' — these take precedence
 * over every social pattern, so "thanks now build me a login page" stays a build.
 */
const BUILD_SIGNALS: readonly string[] = [
  // English verbs / nouns
  'build', 'create', 'make', 'add', 'fix', 'change', 'edit', 'update',
  'implement', 'code', 'develop', 'design', 'refactor', 'deploy', 'debug',
  'generate', 'remove', 'delete', 'rename', 'install', 'integrate', 'connect',
  'configure', 'setup', 'set up', 'wire', 'render', 'style', 'migrate',
  'website', 'site', 'webpage', 'app', 'application', 'page', 'screen',
  'component', 'button', 'form', 'api', 'backend', 'frontend', 'database',
  'db', 'login', 'signup', 'sign up', 'auth', 'authentication', 'feature',
  'function', 'script', 'endpoint', 'route', 'navbar', 'header', 'footer',
  'dashboard', 'table', 'chart', 'modal', 'sidebar', 'layout', 'theme',
  'todo app', 'landing', 'css', 'html', 'react', 'next.js', 'nextjs',
  // Hindi / Hinglish forms
  'banao', 'bana do', 'banade', 'bana de', 'banade do', 'banana',
  'jodo', 'jod do', 'add karo', 'theek karo', 'thik karo', 'badlo', 'badal do',
  'hatao', 'hata do', 'banwao', 'sudharo', 'sahi karo', 'likho', 'likh do',
  'bana dena', 'bana doge', 'design karo', 'fix karo', 'update karo',
];

/**
 * Clear social/conversational patterns. A message matches 'chat' only if it has
 * NO build signal AND hits one of these (or is a very short, signal-free message).
 */
const SOCIAL_PATTERNS: readonly RegExp[] = [
  // Greetings (English + Hinglish)
  /\b(hi+|he+y|hello+|helo+|hii+|yo|sup|namaste|namaskar|namaskaram|salaam|hola)\b/,
  // "how are you" family
  /\bhow\s+are\s+you\b/,
  /\bhow'?s\s+it\s+going\b/,
  /\bwhat'?s\s+up\b/,
  /\bkaise\s+ho\b/,
  /\bkaise\s+hain?\b/,
  /\bkaisa\s+hai\b/,
  /\bkya\s+haal\b/,
  /\bkya\s+chal\s+raha\b/,
  // Thanks
  /\bthanks?\b/,
  /\bthank\s+you\b/,
  /\bthank\s*u\b/,
  /\bthx\b/,
  /\bty\b/,
  /\bdhanyavaad\b/,
  /\bdhanyawad\b/,
  /\bshukriya\b/,
  // Identity / capability small-questions
  /\bwho\s+are\s+you\b/,
  /\bwhat\s+are\s+you\b/,
  /\bwhat\s+can\s+you\s+do\b/,
  /\bwhat\s+do\s+you\s+do\b/,
  /\bwhat\s+is\s+your\s+name\b/,
  /\btum\s+kaun\s+ho\b/,
  /\baap\s+kaun\s+ho\b/,
  /\btum\s+kya\s+kar\s+sakte\s+ho\b/,
  /\baap\s+kya\s+kar\s+sakte\s+ho\b/,
  /\bkya\s+kya\s+kar\s+sakte\s+ho\b/,
  /\btumhara\s+naam\b/,
  // Short acknowledgements
  /\b(ok|okay|okey|k|nice|great|cool|wow|good|awesome|amazing|perfect|fine|alright|nope|yep|yes|no|haan|haa|nahi|theek|thik|achha|acha|accha|badhiya|bye|byee|goodbye|see\s+ya|ttyl|good\s+night|good\s+morning|gn|gm|lol|haha|hehe)\b/,
];

/** Strip a trailing fenced code block check / file path / URL detection helper. */
function hasCodeOrPathOrUrl(message: string): boolean {
  if (message.includes('```')) return true; // fenced code block
  if (/https?:\/\//i.test(message)) return true; // URL
  if (/[\w-]+\/[\w./-]+\.[a-z0-9]{1,8}\b/i.test(message)) return true; // file path with extension
  return false;
}

const LONG_MESSAGE_THRESHOLD = 120;
const SHORT_WORD_COUNT = 3;

/**
 * Classify a message as plain conversation ('chat') or a real build request
 * ('build'). Pure and deterministic. Conservative: defaults to 'build' on any
 * doubt, so a real build request is never answered conversationally.
 */
export function classifyIntent(message: string): BuildIntent {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return 'build'; // safe default — never treat an empty/odd input as chat

  const lower = text.toLowerCase();

  // 1) Build signals take precedence — any build/engineering cue → 'build'.
  for (const signal of BUILD_SIGNALS) {
    // Word-boundary-ish match: signal surrounded by non-letters (handles
    // punctuation and Hinglish multi-word phrases). Avoids matching inside
    // unrelated longer words where possible.
    const idx = lower.indexOf(signal);
    if (idx === -1) continue;
    const before = idx === 0 ? '' : lower[idx - 1];
    const after = idx + signal.length >= lower.length ? '' : lower[idx + signal.length];
    const beforeOk = before === '' || !/[a-z0-9]/.test(before);
    const afterOk = after === '' || !/[a-z0-9]/.test(after);
    if (beforeOk && afterOk) return 'build';
  }

  // 2) Long messages, code blocks, file paths or URLs → a real task → 'build'.
  if (text.length > LONG_MESSAGE_THRESHOLD) return 'build';
  if (hasCodeOrPathOrUrl(text)) return 'build';

  // 3) Clear social patterns (no build signal present) → 'chat'.
  for (const pattern of SOCIAL_PATTERNS) {
    if (pattern.test(lower)) return 'chat';
  }

  // 4) Very short, signal-free messages (<= 3 words) are treated as chit-chat.
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  if (wordCount <= SHORT_WORD_COUNT) return 'chat';

  // 5) Default: when unsure, treat as a build request (never risk it).
  return 'build';
}
