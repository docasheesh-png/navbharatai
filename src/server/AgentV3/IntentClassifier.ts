// AgentV3 (Vargen 3.0) — intent classification for cost routing + surgical edit detection.
//
// Every v5.0 message currently runs the full Claude native-tool-use agent loop,
// which is expensive even for a plain "hello". This pure classifier lets the
// route answer clearly social/conversational turns cheaply via the existing
// non-Claude free router and reserve the premium Claude build loop for real
// build/engineering requests — WITHOUT changing the user experience.
//
// SAFETY: every CLEAR signal (explicit build/edit verbs, a comparison/informational question, a
// "something isn't working" report, a continuation phrase, a long/code-bearing message, or any of the
// broader BUILD_SIGNALS tech-noun catch-all) is resolved deterministically and takes priority — a real
// build/edit request is never answered conversationally. Only the TRUE last-resort default (no signal
// matched at all — a narrow, rare corner case) now prefers 'chat' over 'new_build' (admin decision,
// 2026-07-01: "text reply > build app" — a real report showed a ~9-minute build start for what was
// only a question). The chat reply itself is prompted to offer to build/edit when that seems meant, so
// this never becomes "it refuses to build" — it just asks first instead of assuming. Pure and
// deterministic (no I/O), so it is trivially unit-testable.
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
// The ONE dependency this otherwise self-contained classifier takes: a pure, I/O-free constants
// module shared with the client, so the platform's own generated prompt has a single definition.
import { isPlatformFixRequest, looksLikeMachineError } from '../../lib/platformFixRequest';

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
 * "Something isn't working" problem reports — the user is describing a BROKEN existing project
 * (preview/build/feature), not making small talk. These are almost always SHORT (≤3 words, e.g.
 * "preview nahi chala") and contain a bare negation word ("nahi", "not", "no") that the
 * SOCIAL_PATTERNS check below would otherwise misread as a standalone chit-chat acknowledgement
 * ("nahi" as a lone reply to a yes/no question) — routing a genuine bug report to a sympathetic
 * chat reply instead of an actual fix, and losing the project/file context an edit gets. Checked
 * BEFORE SOCIAL_PATTERNS so a real complaint always wins. Erring toward edit_existing is safe here
 * for the same reason as CONTINUATION_SIGNALS above: worst case is running the memory-aware edit
 * path on a fresh workspace, never dismissing a bug report as chit-chat.
 */
const PROBLEM_SIGNALS: readonly string[] = [
  // English — "it isn't working" family
  "doesn't work", 'does not work', "isn't working", 'is not working', 'not working',
  "won't load", 'will not load', 'not loading', "isn't loading", 'is not loading',
  'not showing', "isn't showing", 'stopped working', 'is broken', "isn't opening",
  'is not opening', 'not opening', 'blank screen', 'blank page', 'not rendering',
  // Hindi / Hinglish — "kaam/chal/ho/khul nahi raha" family
  'nahi chala', 'nhi chala', 'chal nahi raha', 'chalu nahi', 'kaam nahi kar raha',
  'kaam nahi kar rha', 'kaam nahi kiya', 'nahi ho raha', 'nhi ho raha', 'nahi hua',
  'nahi aa raha', 'nhi aa raha', 'nahi aaya', 'nahi dikh raha', 'nhi dikh raha',
  'nahi dikha', 'nahi khul raha', 'nhi khul raha', 'nahi khula', 'band ho gaya',
  'kharab ho gaya', 'chal nhi raha',
];

/**
 * Comparison / explanation questions — the user wants an ANSWER, not a build. These often mention a
 * build-flavored noun in passing — e.g. "compare v5.0 and Claude Code" contains "code", a BUILD_SIGNALS
 * keyword — which previously fell through to the low-confidence 'new_build' default and spent a real
 * ~9-minute build cycle answering what should have been an instant chat reply (confirmed from a real
 * report: the message classified as `{ intent: 'new_build', confidence: 'low', signal: 'build-signal' }`
 * purely because of the word "code" inside "Claude Code"). Checked BEFORE the generic BUILD_SIGNALS
 * catch-all (exactly what "code" matched) but AFTER the explicit new-build/edit verbs above, so
 * "build X and compare it to Y" still correctly builds. High confidence so the LLM upgrade can't be
 * talked into a build by an ambiguous reply.
 */
const INFORMATIONAL_SIGNALS: readonly string[] = [
  'compare', 'comparison', 'campair', // "campair" — a common Hinglish misspelling of "compare"
  'vs', 'versus',
  'difference between', "what's the difference", 'what is the difference',
  'pros and cons', 'which is better', 'which one is better',
  // Hindi / Hinglish
  'compare karo', 'tulna karo', 'kya farak hai', 'farak kya hai', 'antar kya hai',
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
 * True when the message is an EXPLICIT request to build a COMPLETE, whole application — not a
 * targeted edit. This must WIN over the "non-empty workspace ⇒ treat as edit" heuristic.
 *
 * Real report (2026-07-07): "Create a complete Hospital OPD Management System" with a full feature
 * spec was downgraded to a surgical edit because a handful of scaffold/test files had been restored
 * from history (projectExists=true) — so the engine "edited" the app page-by-page over 3 junk files
 * (26 min, 146 steps, incomplete app, wrong "Editing your existing app" message). An explicit
 * "create a complete <app/system>" request is unambiguously a fresh build regardless of stray files.
 *
 * Strict by design so it can NEVER reclassify a genuine edit ("add a logout button", "fix the
 * header") as a rebuild: it requires a build VERB, a whole-application NOUN, AND either the
 * "complete/full/production-ready <app>" construction or a sizeable structured brief (a real spec —
 * feature list + length — never a one-line edit instruction). Pure.
 */
export function isExplicitCompleteBuild(message: string): boolean {
  if (typeof message !== 'string' || !message.trim()) return false;
  const m = message.toLowerCase();
  const BUILD_VERB = /\b(create|build|generate|develop|design|make|banao|bana\s?do|bana\s?de)\b/;
  if (!BUILD_VERB.test(m)) return false;
  const APP_NOUN =
    '(app|application|web\\s?app|website|site|system|platform|dashboard|portal|saas|software|tool|clone|management\\s+system)';
  // "a complete / full / production-ready <app/system>" — the build-a-whole-app construction, where
  // the completeness word sits just before the application noun ("a complete Hospital OPD Management
  // System"). Reverse phrasings ("make the dashboard complete") deliberately do NOT match.
  const completeApp = new RegExp(
    '\\b(complete|full|entire|whole|production[-\\s]?ready|end[-\\s]?to[-\\s]?end|comprehensive)\\b[\\s\\S]{0,40}\\b' +
      APP_NOUN +
      '\\b',
  );
  if (completeApp.test(m)) return true;
  // Or a build-verb + app-noun request carrying a sizeable structured brief (a genuine spec), which
  // a short edit instruction never has.
  const hasAppNoun = new RegExp('\\b' + APP_NOUN + '\\b').test(m);
  const hasSpec =
    message.length > 220 &&
    /\b(features?|requirements?|modules?|pages?|screens?|technolog(?:y|ies)|tech\s+stack)\b/i.test(message);
  return hasAppNoun && hasSpec;
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

/**
 * True if `lower` contains `signal` as a whole word at ANY position (word-boundary-ish, kept loose
 * for Hinglish). ROOT-CAUSE of a real mis-route: the old logic (duplicated in THREE places) looked
 * up only the FIRST occurrence via `indexOf` — so when the first hit was embedded in a longer word
 * (e.g. `add` inside "l**add**er", `change` inside "ex**change**"), the boundary check failed and the
 * signal was abandoned, even though a valid STANDALONE occurrence appeared later. A genuine
 * build/edit request then fell through to the chat default. This scans every occurrence, so a later
 * whole-word hit still counts. Centralized so the fix lives in ONE place, not three. Pure.
 */
function containsSignalWord(lower: string, signal: string): boolean {
  for (let idx = lower.indexOf(signal); idx !== -1; idx = lower.indexOf(signal, idx + 1)) {
    const before = idx === 0 ? '' : lower[idx - 1];
    const after = idx + signal.length >= lower.length ? '' : lower[idx + signal.length];
    const beforeOk = before === '' || !/[a-z0-9]/.test(before);
    const afterOk = after === '' || !/[a-z0-9]/.test(after);
    if (beforeOk && afterOk) return true;
  }
  return false;
}

/** The FIRST signal in `signals` that appears as a whole word in `lower`, or undefined. Pure. */
function firstSignalWord(lower: string, signals: readonly string[]): string | undefined {
  for (const signal of signals) {
    if (containsSignalWord(lower, signal)) return signal;
  }
  return undefined;
}

/** Returns true if the lowercased message contains any signal using word-boundary-ish matching. */
function matchesSignal(lower: string, signals: readonly string[]): boolean {
  return firstSignalWord(lower, signals) !== undefined;
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
/**
 * ANSWER-ONLY OVERRIDE — the user EXPLICITLY said "don't build / just tell me". Checked FIRST,
 * above every build signal, because a negated build verb previously did the OPPOSITE: the word
 * "build" inside "build mat karna, bas yeh batao!" hit NEW_BUILD_SIGNALS as high-confidence
 * new_build and started a rebuild while the user was asking where their files went (admin,
 * 2026-07-07: "query/question ka answer hi dena hai! har bat par build karna theek nahi"). An
 * explicit negation is an INSTRUCTION, not a keyword to weigh. Pure + tested.
 */
const ANSWER_ONLY_PATTERNS: readonly RegExp[] = [
  /\b(?:build|bana\w*|banao|create|change|edit|code)\s+(?:mat|na)\b/,          // "build mat karna", "banao mat"
  /\bmat\s+(?:banao|bana\w*|build|badlo)\b/,                                   // "mat banao", "mat bana" (bare "mat karo" stays ambiguous — not matched)
  /\b(?:don'?t|do\s+not|never)\s+(?:build|create|change|modify|rebuild|touch|edit)\b/,
  /\bno\s+(?:code\s+)?changes?\b/,
  /\b(?:bas|sirf|keval)\s+(?:yeh?\s+|ye\s+)?(?:batao|bata|jawab|answer|explain)\b/, // "bas yeh batao", "sirf batao"
  /\bjust\s+(?:tell|answer|explain|say)\b/,
  /\banswer\s+only\b|\bonly\s+(?:tell|answer|explain)\b/,
];

/**
 * PROJECT-STATE QUESTIONS — "where did my files go?", "kitni files bani?", "what happened?" — the
 * user wants an ANSWER about the project's state/history, never a build. Narrow by design: broad
 * "why is X broken" stays a PROBLEM_SIGNALS edit (a fix request), but state/whereabouts/count
 * questions are pure queries.
 */
const STATE_QUESTION_SIGNALS: readonly string[] = [
  // Hindi / Hinglish
  'kaha gayi', 'kaha gaya', 'kahan gayi', 'kahan gaya', 'kaha gayin', 'kidhar gayi', 'kidhar gaya',
  'kya hua', 'kyu hua', 'kaise hua', 'kitni file', 'kitne file', 'kitni files', 'kitne files',
  'file kaha', 'files kaha', 'file kahan', 'files kahan',
  // English
  'where did', 'where are my', 'where is my', 'what happened', 'how many files', 'how many pages',
];

/**
 * Words that ALWAYS open a question, in either language. A wh-word is interrogative whether or not the
 * user bothered with a question mark, and plenty of real users do not.
 */
const WH_OPENERS =
  /^(?:what|whats|what's|how|why|which|who|whom|whose|when|where|kya|kaise|kaisa|kaisi|kyun|kyu|kyon|kaun|kab|kahan|kahaan|kitna|kitne|kitni|konsa|konsi)\b/;

/**
 * Auxiliaries that open a question OR an order, and cannot be told apart on their own.
 *
 * 🔴 THIS DISTINCTION IS NOT PEDANTRY — it was a real regression, caught by the existing suite before
 * this shipped. **"do it again"** is a retry, and treating `do` as interrogative turned a continuation
 * into small talk — re-opening the "please continue" amnesia this repo has already fixed once. So an
 * auxiliary counts as a question only with a question mark, or when a SECOND-PERSON subject follows it
 * ("can you …", "kya aap …"), which is the one shape that is never an order.
 */
const AUX_OPENERS = /^(?:can|could|would|will|shall|should|do|does|did|is|are|am|may|might)\b/;
const AUX_ASKS_US = /^(?:can|could|would|will|do|does|did|are)\s+(?:you|u|aap|tum)\b/;

/**
 * "kya main/mai/aap/tum/hum/hume …" — the Hindi/Hinglish "should I…?" / "may I…?" construction.
 *
 * 🔴 UNANCHORED ON PURPOSE (autopsy 2026-09-16). Every other line in `readsAsQuestion` requires the
 * message to OPEN with a question word — but Hindi places "kya" right before the verb it questions as
 * often as at the sentence's start, so a long lead-in statement followed by a short trailing question
 * ("मैं एक अलार्म ऐप बनाना चाहता हूं … क्या मैं prompt डालूं?" — "I want to build an alarm app… should I
 * paste the prompt?") asks its real question at the END. The old `^`-anchored version could not see
 * past the declarative opening clause, so the message hard-locked to a build order at HIGH confidence,
 * skipped the LLM upgrade entirely (see `classifyIntentSmart`), and ran a real, billed weak-tier build
 * for a question that wanted a one-line "haan, bhej dijiye" in reply.
 *
 * Devanagari included deliberately, and — for now — ONLY this one pattern: the reported message was
 * typed in native script, where every OTHER signal in this file (WH_OPENERS, NEW_BUILD_SIGNALS, …) is
 * Romanized-only and therefore blind to it (recorded as a separate, larger open item in PROGRESS.md —
 * this is not a general Devanagari pass). This one phrase is safe to add on its own: Devanagari has no
 * other reading of "kya main/aap/tum/hum", so the risk of a false positive is the same as the Romanized
 * form already carried. `\b` is not used around the Devanagari half — under a non-`u` JS regex it does
 * not fire correctly across non-ASCII script boundaries, so whitespace/string edges do the job instead.
 */
/**
 * THE HINDI QUESTION THAT ENDS WITH ITS QUESTION WORD — "yeh main kaise karu?", typed without the "?".
 *
 * 🔴 THE REPORT (cc8c9075, 2026-09-17). A user typed **"Tumnay jo app banana use main open kase karu"**
 * — *"the app you were to build, how do I open it?"* — a pure question about an app they already had.
 * `banana` is a NEW_BUILD_SIGNAL, so it returned **new_build at HIGH confidence**, which by design
 * skips the LLM intention reader. `userAskedForAnAppToBeBuilt` then said TRUE, which cancelled the
 * edit-mode exemption in `shouldRetryEmptyBuild` — so the engine, having already ANSWERED the question
 * correctly at minute 2.5 with a live clickable preview URL, called that answer an empty build and
 * **re-ran the entire build one rung higher**. The second answer was WORSE: it told the user to run
 * `npm run dev` and open `localhost:5173`, a URL on a machine they do not have.
 *
 * WHY EVERY EXISTING RULE MISSED IT. Hindi is verb-final, so its question word sits before the verb —
 * near the END. `WH_OPENERS` is `^`-anchored per clause; `MIDSENTENCE_KYA_QUESTION` was unanchored for
 * exactly this reason (autopsy 2026-09-16) but covers only `kya` + a pronoun. "kase karu" is neither.
 * This is that autopsy's own finding — *"Hindi places its question particle anywhere in the sentence"*
 * — applied to the rest of the question words instead of just one.
 *
 * 🔒 WHY IT CANNOT SWALLOW AN ORDER, and this is the whole safety argument: it requires a FIRST-PERSON
 * verb. A Hindi order is second person (`karo`, `banao`, `do`, `dena`); "what shall **I** do" is
 * `karu`/`karun`. The two are different grammatical persons, so no imperative can match — the same
 * structural distinction `AUX_ASKS_US` already uses for "can **you**" versus "can I". The verb list is
 * explicit rather than a `-u$` suffix rule on purpose: "you", "run", "sun" and "gun" all end that way.
 */
const HI_FIRST_PERSON_VERB =
  /\b(?:karu|karun|karoon|karunga|karungi|banau|banaun|banaoon|kholu|kholun|dalu|dalun|likhu|likhun|dekhu|dekhun|lagau|lagaun|bheju|bhejun|rakhu|rakhun|jau|jaun|lu|lun|du|dun|paun|samjhu|samjhun|chalau|chalaun|laun|puchu|puchun|kharidu|kharidun|milega|milegi|hoga|hogi)\b/;

/** The Hindi/Hinglish question words, unanchored — they are as likely to end a clause as open one. */
const HI_WH_ANYWHERE =
  /\b(?:kya|kaise|kase|kaisay|kaisi|kaisa|kahan|kaha|kahaan|kidhar|kab|kaun|kon|konsa|konsi|kitna|kitne|kitni|kyun|kyu|kyon)\b/;

const MIDSENTENCE_KYA_QUESTION =
  /(?:^|[\s,.!])kya\s+(?:aap|tum|main|mai|hum|hume)\b|(?:^|[\s,।!])क्या\s+(?:मैं|मई|आप|तुम|हम|हमें)(?:\s|$|[।,.!?])/;

/**
 * Connectives that JOIN a clause to the one before it without changing its mood.
 *
 * Stripped before a clause is judged, because "or how to create apk" is the same question as "how to
 * create apk" — and every opener test in this file is `^`-anchored, so a two-letter conjunction in
 * front of the question word hides it completely.
 */
const LEADING_CONNECTIVE = /^(?:or|and|but|so|then|also|plus|aur|ya|phir|lekin|aur phir)\s+/;

/** Sentence boundaries. `।` is the Devanagari full stop; newlines end a clause as surely as a period. */
const CLAUSE_BOUNDARY = /[.!?;।\n]+/;

/** Does ONE clause read as a question? The opener rules, applied to a clause instead of the message. */
function clauseReadsAsQuestion(raw: string): boolean {
  const text = raw.trim().replace(LEADING_CONNECTIVE, '').trim();
  if (!text) return false;
  if (WH_OPENERS.test(text)) return true;
  // 🔴 `&&`, NOT AN EARLY `return`. This line used to read
  //     `if (AUX_OPENERS.test(text)) return AUX_ASKS_US.test(text);`
  // so a clause opening with ANY auxiliary that was not followed by a second-person subject returned
  // FALSE **without ever reaching `MIDSENTENCE_KYA_QUESTION` below** — the Hindi mid-sentence rule was
  // unreachable for every message beginning "can i …", "should i …", "do i …". The auxiliary
  // distinction itself is unchanged, so "do it again" is still an order, not a question.
  if (AUX_OPENERS.test(text) && AUX_ASKS_US.test(text)) return true;
  if (MIDSENTENCE_KYA_QUESTION.test(text)) return true;
  // The verb-final Hindi question: a question word anywhere, and a FIRST-PERSON verb to go with it.
  // Both are required — the wh-word alone appears in plenty of statements ("kya baat hai"), and the
  // verb alone appears in plenty of plans ("main banau"). Together they are only ever a question.
  return HI_WH_ANYWHERE.test(text) && HI_FIRST_PERSON_VERB.test(text);
}

/**
 * Does this message READ as a question — a request for an answer rather than an order to act? Pure.
 *
 * 🔴 IT READS EVERY CLAUSE, NOT JUST THE OPENING (autopsy 2026-09-17, build 2c61f648). A real user
 * typed **"Can I use it. Or how to create apk"** about a project they already had. Both halves
 * classify as `chat` on their own. Joined, the message became a **HIGH-confidence `new_build`**, which
 * by design skips the LLM intention reader entirely — and the engine ran a 7.3-minute agentic build
 * on their existing 51-file app, changed three of their files, and left it failing `tsc`.
 *
 * The mechanism, exactly: `WH_OPENERS` is `^`-anchored, so "how" in the SECOND sentence was invisible;
 * `AUX_OPENERS` matched the leading "can", and the old early `return` handed back `AUX_ASKS_US`
 * ("can i" ≠ "can you") — **false** — without any later test running. One sentence decided the whole
 * message.
 *
 * 🔴 AND THIS FILE HAD ALREADY DIAGNOSED IT, ONE DAY EARLIER. `MIDSENTENCE_KYA_QUESTION`'s own comment
 * (autopsy 2026-09-16) states it in as many words: *"Every other line in `readsAsQuestion` requires the
 * message to OPEN with a question word."* That autopsy unanchored the **Hindi** pattern and stopped —
 * the identical defect in the English openers was never hunted. This is that sibling, failing in
 * production the next day. The lesson is the repo's own rule 3, and it is now structural: openers are
 * applied per CLAUSE, so no single pattern has to remember to be unanchored.
 *
 * ⚠️ WHAT DELIBERATELY DOES NOT CHANGE. An ORDER is still an order: "build a notes app" and
 * "create apk" contain no question clause and stay HIGH-confidence builds, so the common path pays
 * nothing. "do it again" is still a retry (the auxiliary rule above). And a question that DOES name a
 * deliverable still keeps its build intent — it only loses the hard lock, which is the whole point.
 */
export function readsAsQuestion(lower: string): boolean {
  const text = lower.trim();
  if (!text) return false;
  if (text.endsWith('?')) return true;
  for (const clause of text.split(CLAUSE_BOUNDARY)) {
    if (clauseReadsAsQuestion(clause)) return true;
  }
  return false;
}

/**
 * Does the message name a SPECIFIC thing to produce — an article + noun ("a todo app"), something of
 * the user's ("my site"), something pointed at ("this page"), or something asked for on their behalf
 * ("build me …", "mere liye")?
 *
 * This is the line between *asking about* app-building and *asking for* an app. "Can you build me a
 * todo app?" is a question in form and an order in substance; "Can you generate images?" is neither.
 * Pure.
 */
export function namesSpecificDeliverable(lower: string): boolean {
  const text = lower.trim();
  if (!text) return false;
  if (/\b(?:a|an|the|my|our|your|this|that|these|those|ek|mera|meri|mere|hamara|hamari|apna|apni|yeh|ye|is|iska|isko)\b/.test(text)) return true;
  if (/\b(?:me|us|humein|hume|mujhe)\b/.test(text)) return true;
  if (/\bfor (?:me|us)\b|\bmere liye\b|\bhamare liye\b/.test(text)) return true;
  return false;
}

/**
 * Does this text contain native Devanagari script (Hindi, Marathi, …)?
 *
 * 🔴 THE GUARD THIS FUNCTION EXISTS FOR (autopsy 2026-09-16, alarm-app build). Every keyword array in
 * this file — `NEW_BUILD_SIGNALS`, `EDIT_SIGNALS`, `BUILD_SIGNALS`, `WH_OPENERS`, `ANSWER_ONLY_PATTERNS`,
 * `STATE_QUESTION_SIGNALS` — is Romanized-only (confirmed by scanning the whole file for this Unicode
 * block: zero hits before this change). So a message typed in NATIVE Hindi script cannot earn a
 * confident classification from ANY of them; the only thing that can make one look confident is an
 * ACCIDENT — a stray Romanized/English word inside it tripping a keyword array (`BUILD_SIGNALS` matches
 * "css", "api", "login", …), or the char-count `LONG_MESSAGE_THRESHOLD` (which Devanagari's matras and
 * conjuncts inflate well past the same sentence's length in Roman script, for no reason connected to
 * the message's actual complexity).
 *
 * The fix is NOT translating every array into Hindi — that is a much larger, riskier project (recorded
 * separately in PROGRESS.md as an open item) and this file's own keyword approach does not scale to a
 * language whose question particle can land anywhere in the sentence (see `MIDSENTENCE_KYA_QUESTION`).
 * Instead: a classifier that cannot read a script must never CLAIM confidence about text in it. Any
 * message containing Devanagari is capped at LOW confidence below, however it was otherwise classified
 * — which is what sends it to the LLM upgrade (`classifyIntentSmart`) instead of hard-locking on a
 * coincidence. A message that mixes scripts (Hindi with an English technical word, the common case) is
 * still read for whatever Romanized signal it carries — this only ever REMOVES an unearned HIGH, never
 * invents an intent.
 */
export function containsDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

export function classifyIntentWithConfidence(message: string): IntentWithConfidence {
  const result = classifyIntentWithConfidenceCore(message);
  if (result.confidence === 'high' && containsDevanagari(message)) {
    return { ...result, confidence: 'low' };
  }
  return result;
}

function classifyIntentWithConfidenceCore(message: string): IntentWithConfidence {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return { intent: 'new_build', confidence: 'low' };

  const lower = text.toLowerCase();

  // Step 0 — the user explicitly said DON'T build / just answer, or asked a pure state question.
  // Absolute priority: an instruction/question must never be out-voted by a keyword inside it.
  for (const pattern of ANSWER_ONLY_PATTERNS) {
    if (!pattern.test(lower)) continue;
    // 🔴 A NEGATION CAN BE A CONSTRAINT INSIDE AN ORDER, NOT A REFUSAL OF IT (report cc8c9075).
    // The real message was *"Tum mujhe as a app bana kar do … koi quiz app **mat banana**"* — "build
    // me an app … just don't make a quiz app". `mat banana` is the SHAPE this rule was written for,
    // and here it narrows an order rather than cancelling one. Firing at HIGH would hard-lock the
    // whole build request to chat on the strength of its own caveat.
    //
    // 🔒 The verdict does NOT flip — only the lock goes, which is the 2026-09-13 asymmetry applied
    // here: chat costs one message, a wrongly-started build costs a whole build. LOW is what sends
    // the sentence to the intention reader, which can see both halves at once.
    // The original case is untouched: strip "build mat karna" out of "build mat karna, bas yeh
    // batao" and nothing buildable is left, so it keeps its HIGH.
    const withoutNegation = lower.replace(pattern, ' ');
    const orderSurvives = !!firstSignalWord(withoutNegation, NEW_BUILD_SIGNALS)
      || matchesSignal(withoutNegation, BUILD_SIGNALS);
    return { intent: 'chat', confidence: orderSurvives ? 'low' : 'high', signal: 'answer-only' };
  }
  if (matchesSignal(lower, STATE_QUESTION_SIGNALS)) {
    return { intent: 'chat', confidence: 'high', signal: 'state-question' };
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Step 0b — READ THE MOOD BEFORE OBEYING A KEYWORD (admin-mandated 2026-09-13, after autopsy
  // 5abad374). Admin, verbatim: *"simple question ka just simple answer dena chahiye — app banane ki
  // yahan jarurat hi kahan hai. Direct app mat bana do! Yeh system control karo — pehle dekhu user ka
  // mood kya hai, kya woh sirf answer chahta hai, ya app banwana chahta hai."*
  //
  // WHAT WENT WRONG. A user typed **"Can you generate images?"**. `generate` is a build verb, so the
  // scanner below returned new_build at HIGH confidence — and HIGH confidence SKIPS the LLM upgrade
  // entirely (`classifyIntentSmart` returns before asking it). The engine built an "AI Image Studio"
  // for 29 minutes, hit the wall-clock cap, and told the user their app was not ready. At minute 8 it
  // had already ANSWERED the question in plain text, and kept building anyway.
  //
  // It was never one sentence. Measured across ordinary phrasings, ALL of these hard-locked to
  // "build an app" without the intention reader ever being consulted:
  //     "can I make money from this?"      "what can you generate?"
  //     "how do I make a login page?"      "should I create a react app or next js?"
  // A pricing question built an app. That is the class, and the keyword is not the bug — the HARD LOCK
  // is: one matched word ending a decision that the sentence's own grammar contradicts.
  //
  // THE RULE, IN TWO PARTS, AND THE ASYMMETRY THAT JUSTIFIES IT.
  // Being wrong toward CHAT costs one extra message — and the chat reply is already prompted to offer
  // to build, so the user answers "yes" and the build starts. Being wrong toward BUILD costs what this
  // autopsy measured: 29 minutes, a failed app, real money, and a user who never asked for any of it.
  const question = readsAsQuestion(lower);
  //   (a) A question that names NOTHING to produce is a question. Answer it.
  if (question && !namesSpecificDeliverable(lower)) {
    return { intent: 'chat', confidence: 'low', signal: 'question-no-deliverable' };
  }

  // Steps 1–4 → high confidence (strong, explicit signals). Uses the shared whole-word scanner so an
  // embedded first occurrence can't hide a valid standalone one later (the mis-route root cause).
  //   (b) A question that DOES name something to produce ("can you build me a todo app?") keeps its
  //       intent — but never its HARD LOCK. Dropping to LOW is what finally sends the sentence to the
  //       intention reader, which sees the project and the conversation that a keyword cannot.
  //       ⚠️ The INTENT is unchanged, so nothing regresses when the reader is slow or down: the
  //       keyword answer still stands. All this buys is that the question gets READ. And an ORDER
  //       ("build a notes app", "ek billing app banao") is not a question, so it stays HIGH and
  //       instant — the common path pays nothing for this.
  const nbSignal = firstSignalWord(lower, NEW_BUILD_SIGNALS);
  if (nbSignal) return { intent: 'new_build', confidence: question ? 'low' : 'high', signal: nbSignal };
  const editSignal = firstSignalWord(lower, EDIT_SIGNALS);
  if (editSignal) return { intent: 'edit_existing', confidence: question ? 'low' : 'high', signal: editSignal };
  // A comparison/explanation ask ("compare X and Y") → chat, even if it mentions a build-flavored
  // noun in passing. High confidence so length/code-heuristics below can't override it either.
  if (matchesSignal(lower, INFORMATIONAL_SIGNALS)) {
    return { intent: 'chat', confidence: 'high', signal: 'informational' };
  }
  if (text.length > LONG_MESSAGE_THRESHOLD) {
    return { intent: 'new_build', confidence: 'high', signal: 'long-message' };
  }
  if (hasCodeOrPathOrUrl(text)) {
    return { intent: 'new_build', confidence: 'high', signal: 'code-or-url' };
  }
  if (matchesSignal(lower, BUILD_SIGNALS)) {
    // AMBIGUOUS tech-noun / weak-verb signals ('app', 'react', 'button', 'add', 'install', …):
    // keep new_build as the safe FALLBACK, but mark it LOW confidence so the smart classifier
    // consults the LLM (with project + conversation context) instead of HARD-LOCKING on the
    // wording. This is the "understand the user's intention, don't keyword-lock" fix — e.g.
    // "why does my notes app crash?" is a question, not a request to build a new app.
    return { intent: 'new_build', confidence: 'low', signal: 'build-signal' };
  }
  // Continuation of an interrupted/in-progress build → resume the existing project (with memory),
  // NOT the amnesiac chat path. High confidence so the LLM upgrade can't downgrade it to chat.
  if (matchesSignal(lower, CONTINUATION_SIGNALS)) {
    return { intent: 'edit_existing', confidence: 'high', signal: 'continuation' };
  }
  // A "something isn't working" bug report → edit_existing, not chat. Checked BEFORE
  // SOCIAL_PATTERNS: a short complaint like "preview nahi chala" contains the bare word "nahi",
  // which SOCIAL_PATTERNS alone would misread as a standalone chit-chat acknowledgement.
  if (matchesSignal(lower, PROBLEM_SIGNALS)) {
    return { intent: 'edit_existing', confidence: 'high', signal: 'problem-report' };
  }

  // Steps 5–7 → low confidence (social pattern, short message, or default)
  for (const pattern of SOCIAL_PATTERNS) {
    if (pattern.test(lower)) return { intent: 'chat', confidence: 'low', signal: 'social' };
  }
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  if (wordCount <= SHORT_WORD_COUNT) return { intent: 'chat', confidence: 'low', signal: 'short' };
  // TRUE last-resort default (admin decision, 2026-07-01: "preference text reply > build app" — a
  // real report showed a build starting a ~9-minute cycle for what was actually just a question).
  // Nothing above matched: no build/edit verb, no informational/problem/continuation phrase, not
  // short, not social — a genuinely ambiguous message with no build-flavored word at all (BUILD_SIGNALS
  // would already have caught anything mentioning an app/page/component/etc., so this default is a
  // narrow, rare corner). Was 'new_build'; now 'chat' — LOW confidence, so the LLM upgrade (which sees
  // full project/conversation context) still gets the final say when it's available and fast. This is
  // ONLY the safety net for when that LLM call itself fails/times out — the actual disambiguation
  // happens in the chat reply itself (it is prompted to offer to build/edit if that's what's meant),
  // so a real build request phrased unusually is never permanently stuck as "just chat" — the user's
  // very next message (or their reply to the clarifying question) resolves it via the normal signals.
  return { intent: 'chat', confidence: 'low', signal: 'default' };
}

/** Context that lets the smart classifier judge INTENTION instead of isolated wording. */
export interface IntentContext {
  /** True when the workspace already holds a built project → a request is far more likely an EDIT. */
  projectExists?: boolean;
  /** The user's most recent prior requests (oldest→newest) — conversational context. */
  recentRequests?: string[];
}

/**
 * The gatekeeper: upgrade a NON-high-confidence keyword result by asking a lightweight LLM what the
 * user actually WANTS — reading intention, not matching wording — with the conversation/project
 * context the keyword pass can't see. Only ambiguous cases reach the LLM (clear greetings, explicit
 * "build me X" / "fix the Y", continuations, code/URLs stay high-confidence and instant). If the LLM
 * returns an unrecognised value or throws, the keyword result stands — so it never blocks or breaks.
 */
export interface SmartIntent {
  /** Which lane runs this turn. Never a new value — every existing caller keeps its three answers. */
  intent: BuildIntent;
  /**
   * The reader concluded the user wants something MADE but has not said WHAT to make.
   *
   * 🔴 THE MISSING FOURTH ANSWER (admin build report d6d664e6, 2026-09-17). The prompt was one word,
   * `"Bnao"` — *"make it"*. The keyword pass got it right and said LOW confidence, which is exactly
   * what sends a message here. **The reader was then offered three choices — chat / build / edit —
   * and answered `build`. It was not wrong either: "make it" IS an order to build.** The true answer,
   * *"they have not told me WHAT"*, was not on the menu. The engine built for 29 minutes, delivered
   * nothing, and named the app it invented after the instruction word itself.
   *
   * `buildableInput.ts` answers this deterministically for the shapes a word list can enumerate
   * ("banao", "app banao"). This is the half a word list can never reach: a typo, a mixed-language
   * sentence, an unusual phrasing. Admin's instruction, on being shown the first fix: *"user ka har
   * woh message jo ek limit se chota hai ya unclear hai, hamesha LLM call karo — woh bata dega."*
   * The call was already being made; what it lacked was somewhere to put this answer.
   *
   * 🔒 `intent` IS DELIBERATELY LEFT AT THE KEYWORD RESULT when this is true, so a caller that ignores
   * this flag behaves EXACTLY as it does today. The flag adds an option; it removes none.
   */
  unclear: boolean;
}

/**
 * The gatekeeper, with its fourth answer. See `SmartIntent.unclear` for why that answer exists.
 *
 * `classifyIntentSmart` below is this function with the flag discarded — one ladder, not two, the
 * same way `classifyIntent` delegates to `classifyIntentWithConfidence`.
 */
export async function classifyIntentSmartDetailed(
  message: string,
  llmCall: (prompt: string) => Promise<string>,
  context?: IntentContext,
): Promise<SmartIntent> {
  const { intent, confidence } = classifyIntentWithConfidence(message);
  if (confidence === 'high') return { intent, unclear: false };

  const ctxLines: string[] = [];
  if (context?.projectExists !== undefined) {
    ctxLines.push(
      context.projectExists
        ? 'Context: the user ALREADY has a working project in this session. A request to add, change, '
          + 'or finish something is almost always an EDIT of that project — only a fresh BUILD if they '
          + 'clearly ask to start over. A question about the app is "chat".'
        : 'Context: there is NO project yet in this session, so creating something is a fresh BUILD.',
    );
  }
  if (context?.recentRequests?.length) {
    ctxLines.push('Recent user messages (oldest first):');
    for (const r of context.recentRequests.slice(-3)) ctxLines.push(`  - "${r.slice(0, 160)}"`);
  }

  const prompt = [
    'Decide what the user actually WANTS — read their intention, do NOT just match keywords.',
    // The admin's rule, stated to the reader in the reader's own terms: a question deserves an answer.
    // Building an app for someone who asked a question wastes their time and ours, and the reply is
    // already free to OFFER to build — so "chat" is never a refusal, only a faster first response.
    'If they are ASKING something, the answer is "chat" — even when their sentence contains a word like',
    'build, make, create or generate. Choose "build" only when they want an app produced NOW.',
    'Choose exactly one of four categories:',
    '  chat    — plain conversation, a greeting, a question, thanks, or asking how something works',
    '  build   — create a NEW app / feature / component from scratch',
    '  edit    — fix, modify, add to, or finish something that ALREADY exists',
    '  unclear — they DO want something made, but have not said WHAT to make',
    // The fourth answer, spelled out. Without this the reader must pick one of the other three, and
    // for "make it" / "build an app" it reasonably picks "build" — which is how one word became a
    // 29-minute build for an app nobody described (report d6d664e6).
    'Answer "unclear" when they are asking for something to be made but their message does not say',
    'what: "make it", "build an app", "banao", "kuch bana do". Never guess a product for them —',
    'answering "unclear" lets us ask one short question instead of building the wrong thing.',
    ...(ctxLines.length ? ['', ...ctxLines] : []),
    '',
    `User message: "${message.slice(0, 300)}"`,
    '',
    'Reply with ONLY one word: chat, build, edit, or unclear.',
  ].join('\n');

  try {
    const raw = (await llmCall(prompt)).trim().toLowerCase().split(/\s/)[0] ?? '';
    if (raw === 'chat') return { intent: 'chat', unclear: false };
    if (raw === 'build') return { intent: 'new_build', unclear: false };
    if (raw === 'edit') return { intent: 'edit_existing', unclear: false };
    // ⚠️ The INTENT stays at the keyword result here, on purpose — see `SmartIntent.unclear`. A
    // caller that does not read the flag must be byte-identical to before this answer existed.
    if (raw === 'unclear') return { intent, unclear: true };
  } catch {
    /* LLM call failed — fall back to keyword result */
  }
  return { intent, unclear: false };
}

/**
 * The three-way gatekeeper every existing caller uses: `classifyIntentSmartDetailed` with the
 * fourth answer discarded. Delegating rather than duplicating — this file has already paid once for
 * two hand-maintained copies of one ladder (see `classifyIntent`).
 */
export async function classifyIntentSmart(
  message: string,
  llmCall: (prompt: string) => Promise<string>,
  context?: IntentContext,
): Promise<BuildIntent> {
  return (await classifyIntentSmartDetailed(message, llmCall, context)).intent;
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
  // ONE LADDER, NOT TWO. This used to be a second, hand-maintained copy of the rules below, and the
  // copies had already drifted: the confidence version uses the whole-word scanner that fixed a real
  // mis-route, while this one still used the substring matcher. On 2026-09-13 the capability-question
  // fix would have had to be written twice — exactly the duplication that let the July zombie-write fix
  // reach one of its two lanes and not the other. Delegating removes the class: there is now a single
  // place where intent is decided, and the confidence tier is simply discarded here.
  return classifyIntentWithConfidence(message).intent;
}

/**
 * Did the user ask for an APP TO BE PRODUCED — as opposed to asking us to CONTINUE, FINISH or REPAIR
 * one that already exists?
 *
 * 🔴 THE REPORT THIS EXISTS FOR (697b38ee, 2026-09-14), and the reason it is infuriating: the prompt
 * was *"Continue from where you left off and finish/fix the build so the app works end-to-end."* —
 * **the byte-identical sentence already quoted in `shouldRetryEmptyBuild`'s own doc comment** as the
 * Shiv Medical Store case that must never be retried. The guard written on 2026-08-10 to protect that
 * exact sentence did not fire, and the whole 6-minute build re-ran on a second model. 13.1 minutes for
 * work that was finished at 6.2.
 *
 * WHY IT DID NOT FIRE. The route asked `intent === 'new_build'`, and the keyword ladder answers that
 * question with `firstSignalWord(lower, NEW_BUILD_SIGNALS)`. The word it matched was **the noun
 * "build"** in *"fix the build"* — the thing being repaired, not a verb ordering one. HIGH confidence,
 * Step 1, returned long before Step 4.5 would have seen `continue`.
 *
 * 🔒 THE CLASS, NOT THE INSTANCE: `intent` answers "which lane runs this turn?", which is a routing
 * question. `userAskedToBuildAnApp` answers "may a zero-file outcome be called a failure?", which is a
 * judgement about what the user WANTED. Reusing one verdict for both is what let a six-day-old
 * widening (build 5b4f9b63, 2026-08-16) silently cancel a six-day-old narrowing (2026-08-10) without a
 * single test failing — because both were tested against each other's FLAG and neither against the
 * SENTENCE. This predicate is the second question, asked separately.
 *
 * ⚠️ ASYMMETRY, and it runs the same way as every other guard here: a continuation misread as a build
 * request costs a wasted second build (this report). A build request misread as a continuation costs a
 * missed retry on a turn that produced nothing — which the honest empty-build summary still reports.
 * So a continuation or problem phrase wins; everything else keeps exactly today's answer.
 *
 * Pure.
 */
export function userAskedForAnAppToBeBuilt(message: string): boolean {
  if (typeof message !== 'string' || !message.trim()) return false;
  const lower = message.toLowerCase();
  // "continue", "finish it", "retry", "dobara karo" — and "preview nahi chala", "it isn't working".
  // Both families describe work ALREADY STARTED. Neither is a request for a new app, whatever nouns
  // they happen to contain.
  if (matchesSignal(lower, CONTINUATION_SIGNALS)) return false;
  if (matchesSignal(lower, PROBLEM_SIGNALS)) return false;
  // 🔴 NavBharatAI composed this message ITSELF — the preview "Fix error" button. A request we wrote
  // is never a request for a new app, and it must not be guessed at: the template and this test share
  // one string (lib/platformFixRequest.ts), so they cannot drift. Autopsy f5351721 — our own wording
  // ("failed to BUILD … so the app BUILDS and runs") matched no PROBLEM_SIGNAL and read as new_build
  // at HIGH confidence, so a correct zero-file answer was called a failure and the whole build re-ran:
  // 23 wasted minutes on top of the 12 it had already finished in.
  if (isPlatformFixRequest(message)) return false;
  // The same class typed by hand — pasted toolchain output. PROBLEM_SIGNALS is human prose only.
  if (looksLikeMachineError(message)) return false;
  // 🔴 HIGH IS REQUIRED, NOT JUST THE INTENT (report cc8c9075, 2026-09-17). This used to read
  // `.intent === 'new_build'` and discard the confidence — so a LOW-confidence GUESS that a message
  // might be a build request was enough to cancel `shouldRetryEmptyBuild`'s edit-mode exemption and
  // re-run a whole build on a stronger model.
  //
  // That is the wrong thing to spend a guess on, and this function's own doc says why: `intent`
  // answers "which lane runs this turn?", where a LOW guess is cheap and self-correcting; THIS
  // question is "may a correct zero-file answer be called a failure?", where a LOW guess buys a
  // duplicate build. LOW confidence is precisely the classifier reporting that it could not tell —
  // and "I could not tell" must never authorise the expensive branch.
  //
  // ⚠️ It also makes the 2026-09-13 question rule finally BITE here. That rule demotes a question to
  // LOW rather than flipping its intent, deliberately, so nothing regresses when the LLM reader is
  // down — but a reader that is down then left this predicate reading the undemoted intent and
  // answering TRUE anyway. Reading the confidence is what connects the two.
  //
  // The asymmetry is unchanged and still runs the safe way: a missed retry is reported honestly by
  // `emptyBuildFailureSummary`; a wrongly-taken one is a whole second build nobody asked for.
  const verdict = classifyIntentWithConfidence(withoutNounisedBuildWords(message));
  return verdict.intent === 'new_build' && verdict.confidence === 'high';
}

/**
 * Determiners that turn a creation VERB into the NAME OF A THING: "fix **the build**", "**the
 * install** failed", "**this design** is off". NEW_BUILD_SIGNALS is a list of verbs, and every one of
 * these readings is a report about something that already exists.
 */
const NOUNISED_BUILD_WORD =
  /\b(the|this|that|these|those|my|our|your|its|last|previous|current|first|whole|entire)\s+(build|create|make|design|render|install|setup|deploy|migrate)\b/g;

/**
 * The message with determiner+verb pairs removed, so the ladder judges what is left.
 *
 * Used ONLY by `userAskedForAnAppToBeBuilt`, never by `intent` itself — routing a repair turn through
 * the edit lane is already what happens and is correct; the narrower question here is whether a
 * zero-file outcome may be called a failure. Keeping the blast radius to that one question is
 * deliberate: this is a heuristic, and a heuristic belongs where a wrong answer costs one retry rather
 * than a whole lane.
 */
function withoutNounisedBuildWords(message: string): string {
  return message.replace(NOUNISED_BUILD_WORD, ' ');
}
