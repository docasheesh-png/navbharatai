/**
 * Guider — the control loop. See GuiderTypes.ts for the contract and product rules.
 *
 * Usage (caller = Pro build route or EngineerAI route):
 *   const guider = new Guider({ callModel, generate, onProgress });
 *   const plan = await guider.plan(userPrompt);
 *   // → caller shows plan.designProposal + plan.clarifyingQuestions to the user
 *   //   IN plan.language, and gets explicit confirmation.
 *   const result = await guider.run(plan, { confirmed: true });
 *
 * Hard rules enforced here:
 *  - run() THROWS if the plan needs confirmation and the caller didn't pass
 *    `confirmed: true` — the guider never implements its own design unconfirmed.
 *  - The loop is budget-capped and stops honestly (budget_exhausted / no_progress)
 *    — it never reports a fake "passed".
 */
import { languageDirective, detectLanguage } from './LanguageDetect';
import type {
  GuiderPlan, GuiderSpec, GuiderGrade, GenResult, GuiderRunResult, GuiderProgress,
} from './GuiderTypes';

export interface GuiderDeps {
  /** Provider-agnostic model call used for interpret + grade. */
  callModel: (system: string, user: string) => Promise<string>;
  /** The real builder (Pro's build / EngineerAI's loop). `attempt` is 1-based. */
  generate: (prompt: string, attempt: number) => Promise<GenResult>;
  onProgress?: (p: GuiderProgress) => void;
  /** Max build→grade→refine iterations (default 4). Bounds cost + time. */
  maxIterations?: number;
  /** Score (0–100) at/above which the result is accepted (default 85). */
  passScore?: number;
}

const DEFAULT_MAX_ITERS = 4;
const DEFAULT_PASS_SCORE = 85;

/** Extract the first balanced JSON object from a model response (fence-tolerant). */
export function extractJsonObject(text: string): string {
  const s = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return s;
  return s.slice(start, end + 1);
}

/** Parse the interpret-stage model output into a GuiderPlan (robust to bad JSON). */
export function parsePlanResponse(raw: string, userPrompt: string): GuiderPlan {
  const heuristicLang = detectLanguage(userPrompt);
  const fallback: GuiderPlan = {
    language: heuristicLang,
    spec: {
      summary: userPrompt.slice(0, 200),
      requirements: [userPrompt.slice(0, 200)],
      acceptanceCriteria: [{ id: 'c1', text: userPrompt.slice(0, 200) }],
      outOfScope: [],
    },
    designProposal: userPrompt.slice(0, 200),
    confirmationRequired: true,
    clarifyingQuestions: [],
  };
  try {
    const p = JSON.parse(extractJsonObject(raw)) as Record<string, any>;
    const reqs = Array.isArray(p.requirements) ? p.requirements.filter((x: any) => typeof x === 'string') : [];
    const acRaw = Array.isArray(p.acceptanceCriteria) ? p.acceptanceCriteria : [];
    const acceptanceCriteria = acRaw
      .map((x: any, i: number) => (typeof x === 'string'
        ? { id: `c${i + 1}`, text: x }
        : (x && typeof x.text === 'string' ? { id: String(x.id || `c${i + 1}`), text: x.text } : null)))
      .filter(Boolean) as GuiderSpec['acceptanceCriteria'];
    const spec: GuiderSpec = {
      summary: typeof p.summary === 'string' ? p.summary : fallback.spec.summary,
      requirements: reqs.length ? reqs : fallback.spec.requirements,
      acceptanceCriteria: acceptanceCriteria.length ? acceptanceCriteria : fallback.spec.acceptanceCriteria,
      outOfScope: Array.isArray(p.outOfScope) ? p.outOfScope.filter((x: any) => typeof x === 'string') : [],
    };
    return {
      language: typeof p.language === 'string' && p.language ? p.language : heuristicLang,
      spec,
      designProposal: typeof p.designProposal === 'string' && p.designProposal ? p.designProposal : fallback.designProposal,
      // Default to requiring confirmation; only an explicit `false` skips the gate.
      confirmationRequired: p.confirmationRequired !== false,
      clarifyingQuestions: Array.isArray(p.clarifyingQuestions)
        ? p.clarifyingQuestions.filter((x: any) => typeof x === 'string')
        : [],
    };
  } catch {
    return fallback;
  }
}

/** Parse the grade-stage model output into a GuiderGrade (robust to bad JSON). */
export function parseGradeResponse(raw: string, spec: GuiderSpec, passScore: number): GuiderGrade {
  try {
    const g = JSON.parse(extractJsonObject(raw)) as Record<string, any>;
    const score = Math.max(0, Math.min(100, Number(g.score) || 0));
    const gaps = Array.isArray(g.gaps)
      ? g.gaps
          .map((x: any) => (x && typeof x === 'object'
            ? { criterionId: String(x.criterionId || x.id || '?'), issue: String(x.issue || x.text || '') }
            : (typeof x === 'string' ? { criterionId: '?', issue: x } : null)))
          .filter(Boolean) as GuiderGrade['gaps']
      : [];
    const pass = typeof g.pass === 'boolean' ? g.pass : (score >= passScore && gaps.length === 0);
    return { pass, score, gaps, summary: typeof g.summary === 'string' ? g.summary : '' };
  } catch {
    // Could not grade → conservative: not a pass, so the loop keeps trying (bounded).
    return { pass: false, score: 0, gaps: spec.acceptanceCriteria.map(c => ({ criterionId: c.id, issue: 'Could not verify — grader output was unreadable.' })), summary: 'Grader output unreadable.' };
  }
}

/** Build the (re)generation prompt from the spec and the latest gaps (pure). */
export function composePrompt(spec: GuiderSpec, gaps: GuiderGrade['gaps'], attempt: number): string {
  const reqs = spec.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n');
  const ac = spec.acceptanceCriteria.map(c => `- [${c.id}] ${c.text}`).join('\n');
  const oos = spec.outOfScope.length ? `\n\nOut of scope (do NOT build):\n${spec.outOfScope.map(x => `- ${x}`).join('\n')}` : '';
  if (attempt <= 1 || gaps.length === 0) {
    return `${spec.summary}\n\nRequirements:\n${reqs}\n\nAcceptance criteria (every one must be satisfied):\n${ac}${oos}`;
  }
  const gapText = gaps.map(g => `- [${g.criterionId}] ${g.issue}`).join('\n');
  return `Continue improving the existing app from its current state — do NOT restart or remove working features.\n\n` +
    `These acceptance criteria are still NOT satisfied — fix exactly these:\n${gapText}\n\n` +
    `Full acceptance criteria for reference:\n${ac}${oos}`;
}

/**
 * Grade one built result against a spec (standalone so a route can grade without
 * driving the whole loop). Robust: an unreadable grade is a conservative non-pass.
 */
export async function gradeAgainstSpec(
  callModel: (system: string, user: string) => Promise<string>,
  spec: GuiderSpec,
  gradeContext: string,
  passScore = DEFAULT_PASS_SCORE,
): Promise<GuiderGrade> {
  const system =
    'You are a strict QA reviewer. Given the acceptance criteria and a description of what was built, ' +
    'decide which criteria are satisfied. Respond with ONE JSON object, no fences:\n' +
    '{ "pass": <bool>, "score": <0-100>, "gaps": [{"criterionId":"c1","issue":"<what is missing/wrong>"}], "summary": "<short>" }\n' +
    'Only set pass=true when EVERY acceptance criterion is genuinely satisfied. Be honest — never pass incomplete work.';
  const ac = spec.acceptanceCriteria.map(c => `[${c.id}] ${c.text}`).join('\n');
  const user = `Acceptance criteria:\n${ac}\n\nWhat was built:\n${gradeContext.slice(0, 12000)}`;
  let raw = '';
  try { raw = await callModel(system, user); } catch { /* unreadable → conservative grade */ }
  return parseGradeResponse(raw, spec, passScore);
}

export class Guider {
  private maxIterations: number;
  private passScore: number;

  constructor(private deps: GuiderDeps) {
    this.maxIterations = Math.max(1, deps.maxIterations ?? DEFAULT_MAX_ITERS);
    this.passScore = deps.passScore ?? DEFAULT_PASS_SCORE;
  }

  private emit(p: GuiderProgress) { try { this.deps.onProgress?.(p); } catch { /* progress is best-effort */ } }

  /**
   * Stage 1 — understand the request and PROPOSE a design (in the user's language).
   * Never implements anything. The caller confirms before calling run().
   */
  async plan(userPrompt: string): Promise<GuiderPlan> {
    const language = detectLanguage(userPrompt);
    this.emit({ phase: 'interpreting', message: 'Understanding your request…' });
    const system =
      'You are a senior software architect and requirements analyst. Read the user request and produce a build plan.\n' +
      `${languageDirective(language)} IMPORTANT: "designProposal" and "clarifyingQuestions" MUST be written in that language so the user understands them. Keep "requirements" and "acceptanceCriteria" in English for the builder.\n` +
      'Respond with ONE JSON object, no markdown fences:\n' +
      '{\n' +
      '  "language": "<bcp-like tag e.g. hi|en|hinglish>",\n' +
      '  "summary": "<one-line English summary>",\n' +
      '  "requirements": ["<English>", ...],\n' +
      '  "acceptanceCriteria": [{"id":"c1","text":"<English, checkable>"}, ...],\n' +
      '  "outOfScope": ["<English>", ...],\n' +
      '  "designProposal": "<the plan, in the USER\'S language>",\n' +
      '  "confirmationRequired": true,\n' +
      '  "clarifyingQuestions": ["<in the USER\'S language>", ...]\n' +
      '}\n' +
      'Always set confirmationRequired to true for build/modify tasks: the user must approve the design before it is implemented.';
    let raw = '';
    try { raw = await this.deps.callModel(system, userPrompt); } catch { /* fall back to heuristic plan */ }
    const plan = parsePlanResponse(raw, userPrompt);
    this.emit({ phase: 'awaiting_confirmation', message: 'Proposed a design — waiting for your confirmation.' });
    return plan;
  }

  /** Grade one generated result against the spec. */
  private async grade(spec: GuiderSpec, result: GenResult): Promise<GuiderGrade> {
    return gradeAgainstSpec(this.deps.callModel, spec, result.gradeContext, this.passScore);
  }

  /**
   * Stage 2 — build → grade → refine until the spec is met or the budget runs out.
   * Enforces the confirmation gate: the guider never implements an unconfirmed design.
   */
  async run(plan: GuiderPlan, opts?: { confirmed?: boolean }): Promise<GuiderRunResult> {
    if (plan.confirmationRequired && !opts?.confirmed) {
      throw new Error('Guider: user confirmation is required before implementing the proposed design.');
    }

    let best: { grade: GuiderGrade; output: GenResult } | undefined;
    let prevScore = -1;
    let stagnantRounds = 0;

    for (let attempt = 1; attempt <= this.maxIterations; attempt++) {
      const prompt = composePrompt(plan.spec, best?.grade.gaps ?? [], attempt);

      this.emit({ phase: attempt === 1 ? 'generating' : 'refining', message: attempt === 1 ? 'Building…' : `Refining to meet the remaining requirements…`, iteration: attempt });
      const output = await this.deps.generate(prompt, attempt);

      this.emit({ phase: 'grading', message: 'Checking the result against your requirements…', iteration: attempt });
      const grade = await this.grade(plan.spec, output);

      if (!best || grade.score > best.grade.score) best = { grade, output };

      this.emit({ phase: 'grading', message: grade.pass ? 'All requirements met.' : `Met ${grade.score}/100 — ${grade.gaps.length} item(s) left.`, iteration: attempt, score: grade.score });

      if (grade.pass) {
        this.emit({ phase: 'done', message: 'Done — your requirements are fully met.', iteration: attempt, score: grade.score });
        return { status: 'passed', iterations: attempt, finalGrade: grade, output };
      }

      // Stop early if two consecutive rounds make no real progress (avoid loop-fighting).
      if (grade.score <= prevScore) {
        stagnantRounds++;
        if (stagnantRounds >= 2) {
          this.emit({ phase: 'stopped', message: 'Stopped — extra rounds were no longer improving the result.', iteration: attempt, score: best.grade.score });
          return { status: 'no_progress', iterations: attempt, finalGrade: best.grade, output: best.output };
        }
      } else {
        stagnantRounds = 0;
      }
      prevScore = grade.score;
    }

    this.emit({ phase: 'stopped', message: `Reached the ${this.maxIterations}-round limit. Returning the best result so far (${best?.grade.score ?? 0}/100).`, score: best?.grade.score });
    return { status: 'budget_exhausted', iterations: this.maxIterations, finalGrade: best?.grade, output: best?.output };
  }
}
