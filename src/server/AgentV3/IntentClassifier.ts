// AgentV3 (Vargen 3.0) — intent classification for cost routing + surgical edit detection.
//
// Every v3.0 message currently runs the full Claude native-tool-use agent loop,
// which is expensive even for a plain "hello". This pure classifier lets the
// route answer clearly social/conversational turns cheaply via the existing
// non-Claude free router and reserve the premium Claude build loop for real
// build/engineering requests — WITHOUT changing the user experience.
//
// SAFETY: this is conservative by design. It returns 'chat' ONLY for messages
// that are clearly social; on any doubt it returns 'new_build', so a real build
// request is NEVER answered conversationally. Pure and deterministic (no I/O),
// so it is trivially unit-testable.
//
// EDIT DETECTION: distinguishes 'new_build' (create something fresh) from
// 'edit_existing' (modify what is already there). When 'edit_existing' is
// detected the route injects the current file tree and the surgical-edit system
// prompt, preventing the agent from rebuilding everything from scratch.

/**
 * Three-way intent classification:
 *  'chat'          — plain social / conversational turn (greeting, thanks, …)
 *  'new_build'     — creating a fresh app / feature from scratch
 *  'edit_existing' — modifying / fixing / refactoring something that already exists
 */
export type BuildIntent = 'chat' | 'new_build' | 'edit_existing';

// ── Signal arrays ─────────────────────────────────────────────────────────────

/**
 * Signals that clearly indicate CREATING something new.
 * If any of these appear, the intent is 'new_build' regardless of EDIT_SIGNALS
 * (so "build a new page and fix the footer" stays 'new_build').
 */
const NEW_BUILD_SIGNALS: readonly string[] = [
  // English creation verbs
  'build', 'create', 'make', 'generate', 'develop', 'design', 'deploy',
  'implement', 'scaffold', 'launch', 'migrate', 'install', 'integrate',
  'connect', 'configure', 'setup', 'set up', 'wire', 'style', 'render',
  // Hindi/Hinglish creation
  'banao', 'bana do', 'banade', 'bana de', 'banade do', 'banana',
  'banwao', 'likho', 'likh do', 'bana dena', 'bana doge', 'design karo',
];

/**
 * Signals that clearly indicate MODIFYING something that already exists.
 * Triggers 'edit_existing' ONLY when no NEW_BUILD_SIGNAL is also present.
 */
const EDIT_SIGNALS: readonly string[] = [
  // English modification verbs
  'fix', 'debug', 'update', 'change', 'edit', 'modify', 'refactor',
  'remove', 'delete', 'rename', 'correct', 'tweak', 'adjust', 'repair',
  'improve', 'replace', 'patch', 'revert', 'undo', 'rewrite',
  // Hindi/Hinglish modification
  'theek karo', 'thik karo', 'badlo', 'badal do', 'sudharo', 'sahi karo',
  'hatao', 'hata do', 'fix karo', 'update karo',
];

/**
 * Catch-all build signals — tech nouns and ambiguous verbs (e.g. 'add',
 * 'code', 'script') that mean "a real engineering task" without clearly
 * indicating new creation vs modification. Anything matched here (and not
 * matched by the two arrays above) is conservatively treated as 'new_build'.
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
 * Continuation phrases: the user is asking to CONTINUE / FINISH an in-progress or interrupted build
 * (e.g. after a timeout). These are short and carry no build/edit verb, so without an explicit check
 * they fall through to the "short message → 'chat'" default — which routes them to the cheap chat
 * path that has NO project context/memory, producing the "please continue" → "remind me what we were
 * doing?" AMNESIA. Treat them as continuing the existing project (the build/edit path injects the
 * file tree + conversation recall + memory). Erring toward 'edit_existing' is safe: the worst case
 * is running the memory-aware build path on a fresh workspace, never answering a build as chit-chat.
 */
const CONTINUATION_SIGNALS: readonly string[] = [
  'continue', 'go on', 'keep going', 'keep building', 'carry on', 'resume',
  'proceed', 'go ahead', 'finish it', 'finish the', 'complete it', 'complete the',
  'do the rest', 'rest of it', 'next step', 'carry it on',
  // Retry / redo after a timeout or failure — the "retry" button sends one of these, and they
  // must resume the SAME project (with memory), not fall to the amnesiac chat path that replies
  // "what would you like me to try again?".
  'retry', 'try again', 'try it again', 'do it again', 'do over', 'redo', 'redo it',
  'rebuild', 'build it again', 'another go', 'give it another go', 'one more time',
  'once more', 'once again', 'again please',
  // Hindi / Hinglish
  'aage badho', 'aage badhao', 'aage karo', 'aage chalo', 'jaari rakho',
  'continue karo', 'continue kardo', 'poora karo', 'pura karo', 'puura karo',
  'baaki karo', 'baki karo', 'finish karo', 'khatam karo', 'complete karo',
  // Hinglish retry / redo
  'dobara', 'dubara', 'phir se', 'fir se', 'dobara karo', 'dubara karo',
  'phir se karo', 'fir se karo', 'retry karo', 'wapas karo', 'wapas try',
];

/**
 * Explicit "throw the current project away and start fresh" phrases. These are the ONLY case in
 * which a build-intent turn should rebuild from scratch even though the workspace already has an
 * app (one project per session). Everything else on a non-empty workspace is an EDIT — this is
 * what stops "add a dashboard" from wiping and rebuilding the existing project. Kept to STRONG,
 * unambiguous signals so a normal feature request is never mistaken for a reset.
 */
const FRESH_START_SIGNALS: readonly string[] = [
  'start over', 'start fresh', 'start again from scratch', 'from scratch', 'from the scratch',
  'new project', 'brand new app', 'brand new project', 'scrap this', 'scrap it', 'scrap everything',
  'delete everything', 'clear everything', 'reset everything', 'wipe everything', 'wipe it',
  'rebuild from scratch', 'rebuild it from scratch', 'throw this away', 'throw it away',
  'fresh start', 'blank slate', 'start from zero',
  // Hindi / Hinglish
  'naya project', 'naye sire se', 'naye sire', 'sab kuch hata', 'sab kuch delete',
  'sab delete kar', 'fir se shuru karo', 'phir se shuru karo', 'scratch se shuru',
  'bilkul naya banao', 'sab mita',
];

/**
 * True only when the user EXPLICITLY asked to discard the current project and start fresh.
 * Used to override the "non-empty workspace ⇒ treat as edit" rule so a genuine reset still
 * rebuilds. Conservative by design — ambiguous phrasing is NOT a fresh start.
 */
export function wantsFreshStart(message: string): boolean {
  if (typeof message !== 'string' || !message.trim()) return false;
  return matchesSignal(message.toLowerCase(), FRESH_START_SIGNALS);
}

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

/** Returns true if the lowercased message contains any signal using word-boundary-ish matching. */
function matchesSignal(lower: string, signals: readonly string[]): boolean {
  for (const signal of signals) {
    const idx = lower.indexOf(signal);
    if (idx === -1) continue;
    const before = idx === 0 ? '' : lower[idx - 1];
    const after = idx + signal.length >= lower.length ? '' : lower[idx + signal.length];
    const beforeOk = before === '' || !/[a-z0-9]/.test(before);
    const afterOk = after === '' || !/[a-z0-9]/.test(after);
    if (beforeOk && afterOk) return true;
  }
  return false;
}

/** Strip a trailing fenced code block check / file path / URL detection helper. */
function hasCodeOrPathOrUrl(message: string): boolean {
  if (message.includes('```')) return true; // fenced code block
  if (/https?:\/\//i.test(message)) return true; // URL
  if (/[\w-]+\/[\w./-]+\.[a-z0-9]{1,8}\b/i.test(message)) return true; // file path with extension
  return false;
}

const LONG_MESSAGE_THRESHOLD = 120;
const SHORT_WORD_COUNT = 3;

// ── Level 1: confidence-annotated classification ─────────────────────────────

/**
 * Classification result including a confidence level.
 *  'high' — a clear signal drove the decision (strong keyword match).
 *  'low'  — the classifier defaulted (short message, no signals, or social pattern
 *            only) and an LLM call could produce a better result.
 */
export interface IntentWithConfidence {
  intent: BuildIntent;
  confidence: 'high' | 'low';
  /** The first signal that triggered the decision, if any. */
  signal?: string;
}

/**
 * Same as classifyIntent but also returns a confidence level so callers can
 * optionally upgrade borderline results with an LLM call.
 */
export function classifyIntentWithConfidence(message: string): IntentWithConfidence {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return { intent: 'new_build', confidence: 'low' };

  const lower = text.toLowerCase();

  // Steps 1–4 → high confidence (strong, explicit signals)
  for (const signal of NEW_BUILD_SIGNALS) {
    const idx = lower.indexOf(signal);
    if (idx === -1) continue;
    const before = idx === 0 ? '' : lower[idx - 1];
    const after = idx + signal.length >= lower.length ? '' : lower[idx + signal.length];
    if ((before === '' || !/[a-z0-9]/.test(before)) && (after === '' || !/[a-z0-9]/.test(after))) {
      return { intent: 'new_build', confidence: 'high', signal };
    }
  }
  for (const signal of EDIT_SIGNALS) {
    const idx = lower.indexOf(signal);
    if (idx === -1) continue;
    const before = idx === 0 ? '' : lower[idx - 1];
    const after = idx + signal.length >= lower.length ? '' : lower[idx + signal.length];
    if ((before === '' || !/[a-z0-9]/.test(before)) && (after === '' || !/[a-z0-9]/.test(after))) {
      return { intent: 'edit_existing', confidence: 'high', signal };
    }
  }
  if (text.length > LONG_MESSAGE_THRESHOLD) {
    return { intent: 'new_build', confidence: 'high', signal: 'long-message' };
  }
  if (hasCodeOrPathOrUrl(text)) {
    return { intent: 'new_build', confidence: 'high', signal: 'code-or-url' };
  }
  if (matchesSignal(lower, BUILD_SIGNALS)) {
    return { intent: 'new_build', confidence: 'high', signal: 'build-signal' };
  }
  // Continuation of an interrupted/in-progress build → resume the existing project (with memory),
  // NOT the amnesiac chat path. High confidence so the LLM upgrade can't downgrade it to chat.
  if (matchesSignal(lower, CONTINUATION_SIGNALS)) {
    return { intent: 'edit_existing', confidence: 'high', signal: 'continuation' };
  }

  // Steps 5–7 → low confidence (social pattern, short message, or default)
  for (const pattern of SOCIAL_PATTERNS) {
    if (pattern.test(lower)) return { intent: 'chat', confidence: 'low', signal: 'social' };
  }
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  if (wordCount <= SHORT_WORD_COUNT) return { intent: 'chat', confidence: 'low', signal: 'short' };
  return { intent: 'new_build', confidence: 'low', signal: 'default' };
}

/**
 * Upgrade a low-confidence classification by calling a lightweight LLM.
 * `llmCall` receives a short prompt and must return one of: 'chat', 'build', 'edit'.
 * If the LLM returns an unrecognised value or throws, the original intent is kept.
 * Best-effort — never throws to the caller.
 */
export async function classifyIntentSmart(
  message: string,
  llmCall: (prompt: string) => Promise<string>,
): Promise<BuildIntent> {
  const { intent, confidence } = classifyIntentWithConfidence(message);
  if (confidence === 'high') return intent;

  const prompt = [
    'Classify this user message into exactly one of three categories:',
    '  chat    — plain conversation, greeting, question, thanks',
    '  build   — create a new app / feature / component from scratch',
    '  edit    — fix, modify, or update something that already exists',
    '',
    `Message: "${message.slice(0, 300)}"`,
    '',
    'Reply with ONLY one word: chat, build, or edit.',
  ].join('\n');

  try {
    const raw = (await llmCall(prompt)).trim().toLowerCase().split(/\s/)[0] ?? '';
    if (raw === 'chat') return 'chat';
    if (raw === 'build') return 'new_build';
    if (raw === 'edit') return 'edit_existing';
  } catch {
    /* LLM call failed — fall back to keyword result */
  }
  return intent;
}

/**
 * Classify a message as plain conversation ('chat'), a fresh build ('new_build'),
 * or a modification of an existing app ('edit_existing').
 *
 * Pure and deterministic. Conservative: defaults to 'new_build' on any doubt,
 * so a real build request is never answered conversationally, and a creation
 * request is never misidentified as an edit.
 */
export function classifyIntent(message: string): BuildIntent {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return 'new_build'; // safe default — never treat an empty/odd input as chat

  const lower = text.toLowerCase();

  // 1) NEW_BUILD signals take TOP priority — any "build/create/make/generate/…" → 'new_build'.
  //    This ensures "build a page AND fix the footer" stays 'new_build', not 'edit_existing'.
  if (matchesSignal(lower, NEW_BUILD_SIGNALS)) return 'new_build';

  // 2) Pure edit signals (fix, debug, update, change, refactor, …) → 'edit_existing'.
  //    Only fires when no new-build signal was found above.
  if (matchesSignal(lower, EDIT_SIGNALS)) return 'edit_existing';

  // 3) Long messages, code blocks, file paths or URLs → likely a real task → 'new_build'.
  if (text.length > LONG_MESSAGE_THRESHOLD) return 'new_build';
  if (hasCodeOrPathOrUrl(text)) return 'new_build';

  // 4) Remaining build signals (tech nouns: 'app', 'react', 'button', etc., and
  //    ambiguous verbs like 'add', 'install') → conservative 'new_build'.
  if (matchesSignal(lower, BUILD_SIGNALS)) return 'new_build';

  // 4.5) Continuation of an interrupted/in-progress build ("continue", "go on", "finish it",
  //      "aage badho", …): short + signal-free, so without this they fall to the short-message →
  //      'chat' default and lose ALL build context/memory (the "please continue" → amnesia bug).
  //      Route them to the memory-aware edit/continuation path instead.
  if (matchesSignal(lower, CONTINUATION_SIGNALS)) return 'edit_existing';

  // 5) Clear social patterns (no build signal present) → 'chat'.
  for (const pattern of SOCIAL_PATTERNS) {
    if (pattern.test(lower)) return 'chat';
  }

  // 6) Very short, signal-free messages (≤ 3 words) are treated as chit-chat.
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  if (wordCount <= SHORT_WORD_COUNT) return 'chat';

  // 7) Default: when unsure, treat as a new build (never risk answering a build request as chat).
  return 'new_build';
}
