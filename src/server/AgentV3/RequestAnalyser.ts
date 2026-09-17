// AgentV3 — Request Analyser (multi-model cost routing, phase 2).
//
// The "brain" of the cost ladder: given a request, decide the CHEAPEST capable tier to
// START on (Gemini → Haiku → Sonnet → Opus). It never generates content — it only scores
// complexity, detects task type, and picks a start tier + escalation path. The escalation
// orchestrator (phase 3) then runs that tier and, if the objective evaluate-gate fails,
// climbs the path.
//
// HYBRID by design: this module is the DETERMINISTIC core — fast, free, debuggable, and
// fully unit-testable — covering the ~90% of requests that classify cleanly. It marks the
// genuinely ambiguous ones (`ambiguous: true`) so a caller MAY refine them with a cheap LLM
// analyser; the deterministic verdict is always a safe default.
//
// Bias: simple apps (calculator/clock/ludo/todo/…) score LOW → Gemini on purpose. A wrong
// cheap start costs ~₹0 and the evaluate-gate catches failures and escalates, so leaning
// cheap is safe AND is the whole point (a new user's calculator must not cost a fortune).

import { isComplexAppPrompt } from '../lib/appComplexitySignals';

export type StartTier = 'gemini' | 'haiku' | 'sonnet' | 'opus';

/**
 * What a `StartTier` actually MEANS, in words a reader can act on.
 *
 * 🔴 THE NAMES ARE HISTORICAL AND THE REPORT WAS PRESENTING THEM AS FACTS (autopsy 2b0a3ed5,
 * 2026-09-17). A build report carried `requestAnalysis.startTier: "gemini"` — and since the
 * three-ladder rewrite (2026-09-14) **Gemini is on no build ladder at all**. Nothing routed to
 * Gemini; nothing could have. An admin reading that line is being told a provider served a build it
 * never touched, which is the same class of wrong label as a timeout filed against the planned model
 * id on a build that never called it (4efab9d7).
 *
 * ⚠️ THE VALUES ARE DELIBERATELY NOT RENAMED. They are a COMPLEXITY BAND, and they are real: the
 * one-shot and simple lanes branch on them (`classifyForOneShot`, `classifyForSimpleLane`), and the
 * cost telemetry has months of rows keyed by these exact strings — renaming would split that history
 * into before and after for no gain. What was wrong is that a band was printed where a provider name
 * was expected. So the band keeps its key and gains a label, and the report prints the label.
 */
export function startBandLabel(tier: StartTier | string | null | undefined): string {
  switch (String(tier ?? '').trim()) {
    case 'gemini': return 'cheapest band';
    case 'haiku': return 'light band';
    case 'sonnet': return 'standard band';
    case 'opus': return 'heaviest band';
    default: return 'unknown band';
  }
}

export type TaskType =
  | 'chat'
  | 'translate'
  | 'summary'
  | 'simple_app'
  | 'coding'
  | 'debugging'
  | 'complex_app'
  | 'architecture';

export interface AnalyserInput {
  prompt: string;
  /** Number of prior conversation turns (more history → slightly more context/complexity). */
  historyTurns?: number;
  /** Number of files in the workspace (large project → higher complexity). */
  fileCount?: number;
  /** Whether the request includes image attachments. */
  hasImages?: boolean;
  /**
   * PAID pinned tier (admin: mini/medium/max pin their model). When true the ladder is
   * bypassed — no cheap start, no escalation; the build runs on the tier's pinned model.
   * NORMAL mode tops out at Sonnet.
   */
  powerMode?: boolean;
  /**
   * WHICH model the tier pins (admin tier→model redefinition 2026-07-13): 'sonnet' for
   * Strong ('mini'), 'opus' for Powerful/Full Team. Only read when powerMode is true;
   * absent (legacy callers) falls back to 'opus' — the old power semantics.
   */
  pinnedModel?: 'sonnet' | 'opus';
}

export type FeaturePriority = 'CORE' | 'IMPORTANT' | 'NICE';

export interface FeatureRanking {
  /** CORE: auth, core CRUD, navigation (must-have for MVP) */
  core: string[];
  /** IMPORTANT: primary feature set (should-have, high-value) */
  important: string[];
  /** NICE: analytics, reports, advanced filters (nice-to-have, drop if token budget tight) */
  nice: string[];
}

export interface AnalysisResult {
  complexityScore: number; // 0-100
  taskType: TaskType;
  startTier: StartTier;
  escalationPath: StartTier[]; // startTier → … → opus
  ambiguous: boolean; // near a tier boundary → a caller may LLM-refine
  /**
   * The signals could not read this request at all — see `signalsCouldNotRead`. Reported as its own
   * fact rather than folded into `ambiguous`, because "borderline between two bands" and "written in
   * a script none of my patterns cover" are different states and a reader may care which.
   *
   * 🔒 It ADDS information; it removes none. `taskType`, `startTier` and `escalationPath` are
   * unchanged by it, so a caller that ignores this field behaves exactly as it did before the field
   * existed — the score is the only thing an unreadable request moves, and only ever upward, and
   * only on the script-neutral evidence in `scriptNeutralFloor`.
   */
  unreadable: boolean;
  reasoning: string;
  features?: FeatureRanking; // intelligent scoping: prioritized feature list (Phase B)
}

// NORMAL-mode ladder tops out at Sonnet — Opus is POWER-only (admin decision, 2026-06-24):
// keeps normal-mode billing flat/predictable (Sonnet-equivalent × 2, no surprise Opus bill)
// and the margin safe (Sonnet-equivalent × 5 ≈ Opus break-even). Sonnet is the backstop.
const NORMAL_LADDER: StartTier[] = ['gemini', 'haiku', 'sonnet'];

// ── Keyword signals (lowercased, word-ish boundaries kept loose for Hinglish) ──────
const RE = {
  greeting: /\b(hi|hello|hey|namaste|namaskar|kaise ho|how are you|thanks|thank you|dhanyaiwad|shukriya|good morning|good evening)\b/i,
  translate: /\b(translate|translation|anuvad|in hindi|in english|convert to)\b/i,
  summary: /\b(summar(y|ize|ise)|tl;?dr|in short|key points|gist)\b/i,
  // Simple, self-contained apps cheap models build reliably.
  simpleApp: /\b(calculator|calc|clock|stopwatch|stop-watch|timer|todo|to-do|to do list|counter|dice|ludo|tic[\s-]?tac[\s-]?toe|snake game|memory game|quiz|flashcard|stopwatch|weather widget|color picker|qr code|bouncing ball|3d ball|landing page|portfolio page|single page|simple website|note app|notes app)\b/i,
  coding: /\b(function|component|html|css|javascript|typescript|react|vue|svelte|sql query|regex|snippet|small (fix|bug|utility)|api example|documentation|readme)\b/i,
  debugging: /\b(debug|error|not working|doesn'?t work|broken|crash|exception|stack trace|fix the bug|failing test|why is)\b/i,
  architecture: /\b(architecture|architect|system design|scalable|microservice|micro-service|refactor (the|entire|whole)|design pattern|high[- ]availability|distributed|infrastructure|migrate the|production[- ]grade|enterprise)\b/i,
  hardSignal: /\b(production|secure|security|scalable|optimi[sz]e|performance|concurrency|multi[- ]tenant)\b/i,
};

function detectTaskType(p: string): TaskType {
  // Order matters: most-specific / highest-complexity wins when multiple match.
  if (RE.architecture.test(p)) return 'architecture';
  // SHARED complex-app verdict (single source of truth with the pipeline-DEPTH/ETA estimator, so the
  // two can never route the same prompt two different ways). Page-deliverable-aware: a category THEME
  // word on a one-page ask ("SaaS landing page") no longer forces complex_app — the 29-min bug.
  if (isComplexAppPrompt(p)) return 'complex_app';
  if (RE.debugging.test(p)) return 'debugging';
  if (RE.simpleApp.test(p)) return 'simple_app';
  if (RE.summary.test(p)) return 'summary';
  if (RE.translate.test(p)) return 'translate';
  if (RE.coding.test(p)) return 'coding';
  if (RE.greeting.test(p)) return 'chat';
  return 'chat';
}

/** Base complexity by task type (before feature adjustments). */
const BASE_SCORE: Record<TaskType, number> = {
  chat: 5,
  translate: 10,
  summary: 10,
  simple_app: 15, // cheap models handle these → Gemini
  coding: 30, // small coding → Haiku
  debugging: 45, // Sonnet by default; trivial cases adjust down
  complex_app: 58, // Sonnet
  architecture: 80, // Opus
};

/**
 * 🔴 EVERY SIGNAL ABOVE IS ASCII — AND THIS MODULE USED TO CLAIM CONFIDENCE ANYWAY.
 *
 * `simpleApp`, `coding`, `debugging`, `architecture`, `hardSignal`, `greeting`, and the shared
 * `isComplexAppPrompt` are all English (or romanized) patterns. A request written in Devanagari,
 * Telugu, Bengali, Tamil, Gujarati, Kannada, Malayalam, Punjabi, Odia, Urdu or Arabic matches NONE
 * of them, falls through `detectTaskType`'s final `return 'chat'`, and scores **5** — the same 5 as
 * the word "hi". A Telugu request for a hospital app with doctor logins, patient records,
 * appointments and billing was indistinguishable from a greeting.
 *
 * ⚠️ THE SCORE WAS NOT THE WORST OF IT. `ambiguous` exists — this file's own opening docblock says
 * so — precisely to mark "a caller MAY refine this with a cheap LLM analyser". It was returned
 * **false**, i.e. *"I am confident"*, in the one case where this module had read nothing at all. A
 * confident wrong answer is worse than an admitted unknown, and every downstream reader of
 * `analyzeRequest` (the start band, the step ceiling, the one-shot lane, the report's
 * `requestAnalysis`, the `modelPerformance` rows) was told the confident version.
 *
 * 🔒 THE CLAIM BELONGS HERE, WITH THE SIGNALS IT IS ABOUT. `complexityRouting.ts` reached the same
 * finding on 2026-09-17 and answered it with a private copy of this test, because the module that
 * could not read was still insisting it could. That fixed ONE reader's question and left the other
 * five believing the score. This is the same shape as the four drifted copies of `safeRelPath` that
 * CLAUDE.md records: one shared, tested implementation, owned by the module the fact is about.
 * `complexityRouting` now imports it from here.
 */
export const UNREADABLE_LETTER_SHARE = 0.25;

/** Below this many letters there is nothing to judge a script by — two words are not a sample. */
export const MIN_LETTERS_TO_JUDGE_SCRIPT = 12;

/**
 * PURE. Could the signals in `RE` (and `isComplexAppPrompt`) read this request at all?
 *
 * True when a real share of the request's LETTERS sit outside the Latin range every pattern above is
 * written in. Deliberately script-AGNOSTIC rather than a Devanagari test — India is not one script,
 * and an ASCII regex is equally blind to all of them. Romanized Hinglish stays FALSE on purpose: the
 * patterns really do read "banao ek todo app", and one Hindi word inside an English sentence
 * ("call it मेरा ऐप") is not an unread request.
 */
export function signalsCouldNotRead(prompt: string): boolean {
  const letters = String(prompt ?? '').match(/\p{L}/gu) ?? [];
  if (letters.length < MIN_LETTERS_TO_JUDGE_SCRIPT) return false;
  const nonLatin = letters.filter((c) => !/[A-Za-z]/.test(c)).length;
  return nonLatin / letters.length >= UNREADABLE_LETTER_SHARE;
}

/**
 * How many separate things the request enumerates — counted WITHOUT reading a single word.
 *
 * A comma, a semicolon, a newline and a bullet marker mean "and another one" in every script this
 * repo serves; the words between them do not have to be understood for the COUNT to be evidence.
 * This is the only kind of evidence available once `signalsCouldNotRead` is true, so it is the only
 * kind used.
 *
 * Segments shorter than two letters are dropped, so trailing punctuation and "1." style numbering
 * do not inflate the count.
 */
export function enumeratedParts(prompt: string): number {
  return String(prompt ?? '')
    .split(/[\n,;·•]|(?:^|\s)[-*]\s|\d{1,3}[.)]\s/u)
    .filter((part) => (part.match(/\p{L}/gu) ?? []).length >= 2)
    .length;
}

/**
 * How many separately-named things make an app a MULTI-FEATURE app.
 *
 * 🔒 NOT A NEW NUMBER, AND IT IS THE SAME MEASUREMENT. `BuildTimeEstimator.complexityFromPrompt`
 * already floors a complex-app prompt's `featureCount` at **6** — this repo's own existing answer to
 * "how many features before this is a complex app", counted the same way (list separators). Borrowing
 * `ProjectPlan.MEGA_BULLETS_WITH_NOUN` (8) was considered and rejected: that one counts BULLET LINES
 * beside a big-software noun, a strictly stronger signal, and a constant borrowed across two
 * different measurements is how a shared number stops meaning one thing.
 */
export const FLOOR_PARTS_MANY = 6;

/**
 * ⚠️ THE ONE NUMBER HERE THAT IS CHOSEN RATHER THAN BORROWED, said plainly: half of the line above.
 * Three separately-named things is more than one screen's worth of app, and the floor it buys is only
 * `BASE_SCORE.coding` — out of the cheapest band and nowhere near the heaviest, which is also why
 * getting it slightly wrong is cheap (the light band keeps the one-shot and simple lanes and the same
 * 80-step ceiling; only the score-58 band changes any of those). Conservative on purpose: too low
 * sends a real app to the weakest engine, which is paid twice — once in the wasted call, once in the
 * heal — while too high spends a little more on a small app.
 */
export const FLOOR_PARTS_FEW = 3;

/**
 * PURE. The score an unreadable request deserves on SCRIPT-NEUTRAL evidence alone — 0 when there is
 * none, in which case nothing is floored and a short foreign-script request stays as cheap as it is
 * today.
 *
 * 🔒 IT LANDS ON BANDS THAT ALREADY EXIST, and that is the whole correctness argument. Both values
 * are `BASE_SCORE` entries, so an unreadable multi-feature spec is treated EXACTLY as its English
 * equivalent already is (`complex_app` → standard band) rather than being given a new path nobody
 * has exercised. No new branch, no new combination of flags.
 *
 * ⚠️ IT ONLY EVER RAISES. A floor that could lower a score would let a long foreign-script
 * ARCHITECTURE request (which `isComplexAppPrompt` may still have caught through a Latin brand name
 * or a code block) be talked back down by a word count.
 */
export function scriptNeutralFloor(prompt: string): number {
  const text = String(prompt ?? '');
  const parts = enumeratedParts(text);
  if (parts >= FLOOR_PARTS_MANY || text.length > 800) return BASE_SCORE.complex_app;
  if (parts >= FLOOR_PARTS_FEW || text.length > 300) return BASE_SCORE.coding;
  return 0;
}

/** Normal-mode tier from score. Tops at Sonnet (Opus is power-only). */
function scoreToTier(score: number): StartTier {
  if (score <= 20) return 'gemini';
  if (score <= 40) return 'haiku';
  return 'sonnet';
}

/** True when the score sits within `margin` of a normal-mode tier boundary (20/40). */
function isNearBoundary(score: number, margin = 3): boolean {
  return [20, 40].some((b) => Math.abs(score - b) <= margin);
}

/**
 * Intelligent Scoping (Phase B): rank features by priority (CORE/IMPORTANT/NICE).
 * CORE features (auth, core CRUD, nav) are non-negotiable for MVP. NICE features
 * (analytics, reports, advanced filtering) are gracefully dropped if token budget runs low.
 * Pure — no I/O, deterministic keyword analysis only.
 */
export function rankFeatures(prompt: string): FeatureRanking {
  const p = prompt.toLowerCase();

  // Core patterns: auth, basic CRUD, navigation, core flow
  const corePatterns = [
    /auth|login|sign\s?in|sign\s?up|register|password|user account/i,
    /dashboard|home|main page|landing/i,
    /create|add|new|form submission/i,
    /delete|remove|trash/i,
    /list|table|view all/i,
    /navigation|sidebar|menu|routing/i,
    /error handling|validation|required field/i,
  ];

  // Important patterns: primary features, business logic
  const importantPatterns = [
    /search|filter|sort/i,
    /export|download|csv|pdf/i,
    /notification|alert|message/i,
    /profile|user settings|preference/i,
    /api|backend|server|database/i,
    /real-time|live update|sync/i,
    /appointment|scheduling|booking/i,
  ];

  // Nice patterns: analytics, advanced, polish
  const nicePatterns = [
    /analytic|metric|chart|graph|dashboard stat|kpi|report/i,
    /dark mode|theme|customiz|styling|animation/i,
    /advanced filter|complex query|aggregat/i,
    /schedule|cron|background job|async/i,
    /multi-language|i18n|locali[sz]ation/i,
    /performance optim|cache|lazy load/i,
  ];

  const core: string[] = [];
  const important: string[] = [];
  const nice: string[] = [];

  // Split on sentence boundaries and commas (more flexible for comma-separated feature lists)
  let phrases = prompt.split(/[.!?]/).flatMap(s => s.split(/,/)).map(s => s.trim()).filter(s => s.length > 0);

  for (const phrase of phrases) {
    // Categorize by pattern matching — highest-priority pattern wins
    let categorized = false;

    for (const pattern of corePatterns) {
      if (pattern.test(phrase)) {
        core.push(phrase.slice(0, 80));
        categorized = true;
        break;
      }
    }
    if (categorized) continue;

    for (const pattern of importantPatterns) {
      if (pattern.test(phrase)) {
        important.push(phrase.slice(0, 80));
        categorized = true;
        break;
      }
    }
    if (categorized) continue;

    for (const pattern of nicePatterns) {
      if (pattern.test(phrase)) {
        nice.push(phrase.slice(0, 80));
        break;
      }
    }
  }

  // Deduplicate
  return {
    core: [...new Set(core)],
    important: [...new Set(important)],
    nice: [...new Set(nice)],
  };
}

/**
 * Deterministically analyse a request and pick the cheapest start tier + escalation path.
 * PURE — no I/O. `ambiguous` flags borderline cases for optional LLM refinement.
 */
export function analyzeRequest(input: AnalyserInput): AnalysisResult {
  const prompt = (input?.prompt ?? '').toString();
  const p = prompt.toLowerCase();
  const taskType = detectTaskType(p);

  // A PAID pinned tier bypasses the ladder entirely: the build runs on the tier's pinned model,
  // no cheap start, no escalation. Strong ('mini') pins SONNET (admin 2026-07-13); Powerful/Full
  // Team pin Opus. Legacy callers that pass powerMode without pinnedModel keep the old Opus path.
  if (input?.powerMode) {
    const pinned = input.pinnedModel === 'sonnet' ? 'sonnet' : 'opus';
    return {
      complexityScore: 100,
      taskType,
      startTier: pinned,
      escalationPath: [pinned],
      ambiguous: false,
      // Recorded honestly even here. A pinned tier bypasses the ladder, so the flag changes no
      // routing — but a report should not say the scorer read a request it could not read.
      unreadable: signalsCouldNotRead(prompt),
      reasoning: pinned === 'sonnet'
        ? `STRONG tier → Sonnet pinned 100% (task=${taskType}, ladder bypassed)`
        : `POWER tier → Opus 4.8 pinned (task=${taskType}, ladder bypassed)`,
    };
  }

  let score = BASE_SCORE[taskType];
  const reasons: string[] = [`task=${taskType} (base ${score})`];

  // Feature adjustments.
  const hasCode = /```|<\/?[a-z][\s\S]*>|\bfunction\b|=>/.test(prompt);
  if (hasCode && taskType !== 'simple_app') {
    score += 5;
    reasons.push('+5 code present');
  }
  if (prompt.length > 800) {
    score += 10;
    reasons.push('+10 long prompt');
  } else if (prompt.length > 300) {
    score += 5;
    reasons.push('+5 medium prompt');
  }
  const fileCount = Math.max(0, input?.fileCount ?? 0);
  if (fileCount > 20) {
    score += 12;
    reasons.push('+12 large project');
  } else if (fileCount > 5) {
    score += 6;
    reasons.push('+6 multi-file project');
  }
  if (RE.hardSignal.test(p)) {
    score += 15;
    reasons.push('+15 production/security/perf signal');
  }
  if ((input?.historyTurns ?? 0) > 12) {
    score += 5;
    reasons.push('+5 long conversation');
  }

  // A simple-app request stays cheap even if other words sneak in — that's the goal.
  if (taskType === 'simple_app') {
    score = Math.min(score, 20);
    reasons.push('capped ≤20 (simple app → Gemini)');
  }

  /**
   * 🔴 A REQUEST NONE OF THE SIGNALS CAN READ IS NOT A GREETING (autopsy d98dae01, 2026-09-17).
   *
   * Applied LAST, after every English-driven adjustment and after the simple-app cap, because it is
   * a FLOOR on the evidence that survives when there is no readable evidence — not another
   * adjustment competing with them. It cannot interact with the cap above: `simple_app` is decided
   * by an ASCII pattern, so a request this test calls unreadable can never have that task type.
   *
   * 🔒 A LATIN-SCRIPT PROMPT IS BYTE-IDENTICAL TO BEFORE. `signalsCouldNotRead` is false for
   * English and for romanized Hinglish, so this whole block is skipped on the common path — no new
   * cost, no new branch, nothing to regress.
   */
  const unreadable = signalsCouldNotRead(prompt);
  if (unreadable) {
    const floor = scriptNeutralFloor(prompt);
    if (floor > score) {
      score = floor;
      reasons.push(`floor ${floor} — the signals cannot read this script; ${enumeratedParts(prompt)} enumerated part(s), ${prompt.length} chars`);
    } else {
      reasons.push('the signals cannot read this script; no script-neutral size evidence either');
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const startTier = scoreToTier(score);
  const escalationPath = NORMAL_LADDER.slice(NORMAL_LADDER.indexOf(startTier));
  /**
   * ⚠️ `unreadable` MUST make this true, and this is the half that was a lie rather than a gap. A
   * caller asking "is it worth buying a second opinion on this?" was told NO for the one request
   * this module had understood nothing of. The floor above is the honest DETERMINISTIC answer; this
   * flag is what lets a caller do better than deterministic when a cheap classifier is available.
   */
  const ambiguous = isNearBoundary(score) || unreadable;

  // Intelligent Scoping (Phase B): rank features by priority for checkpoint loop.
  // Only rank for app builds (not chat/coding) to avoid noise.
  const features = (taskType === 'simple_app' || taskType === 'complex_app')
    ? rankFeatures(prompt)
    : undefined;

  return {
    complexityScore: score,
    taskType,
    startTier,
    escalationPath,
    ambiguous,
    unreadable,
    reasoning: `${reasons.join('; ')} → score ${score} → ${startTier}${ambiguous ? ' (borderline)' : ''}`,
    features,
  };
}
