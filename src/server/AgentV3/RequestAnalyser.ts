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

  score = Math.max(0, Math.min(100, Math.round(score)));
  const startTier = scoreToTier(score);
  const escalationPath = NORMAL_LADDER.slice(NORMAL_LADDER.indexOf(startTier));
  const ambiguous = isNearBoundary(score);

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
    reasoning: `${reasons.join('; ')} → score ${score} → ${startTier}${ambiguous ? ' (borderline)' : ''}`,
    features,
  };
}
