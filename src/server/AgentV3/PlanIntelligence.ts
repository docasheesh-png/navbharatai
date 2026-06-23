// AgentV3 — Strategic Intelligence: plan review (Layer 54 v1).
//
// In plan mode the Architect proposes a build plan (a todo list) and then BLOCKS
// for the user's approval. Before the user approves blind, this PURE, deterministic
// analyser reviews the proposed plan for strategic gaps that commonly cause a build
// to "finish" but not actually be done: no step that verifies the work, no setup
// before features, a deploy was asked for but never planned, a one-line under-scoped
// plan, or vague unactionable steps. The findings are surfaced next to the plan so
// the user (and the agent) can strengthen it up front — planning months ahead, not
// just the next keystroke.
//
// Conservative by design: each rule fires only on a clear, high-precision signal so
// a solid plan is never nagged.

export type PlanRiskLevel = 'high' | 'medium' | 'low';

export interface PlanFinding {
  level: PlanRiskLevel;
  message: string;
}

export interface PlanTodo {
  title: string;
}

const RE = {
  testing: /\b(test|tests|testing|verify|verif|validate|validation|qa|lint|typecheck|type-check|e2e|unit|smoke)\b/,
  setup: /\b(set ?up|scaffold|init|initiali|install|dependenc|configure|configuration|project structure|boilerplate|environment)\b/,
  deployReq: /\b(deploy|launch|host|hosting|publish|go live|production|ship it)\b/,
  deployStep: /\b(deploy|host|publish|release|production build|launch|ship)\b/,
  genericStep: /^(build|code|finish|done|implement|create|make|setup|start|work|continue)$/,
};

/**
 * Review a proposed plan for strategic gaps. PURE & deterministic. `request` is the
 * user's original ask (used only to detect intent like "deploy"). Returns [] for a
 * plan with no detected gaps.
 */
export function analyzePlan(todos: PlanTodo[], request = ''): PlanFinding[] {
  const titles = (todos || [])
    .map((t) => (t && typeof t.title === 'string' ? t.title.trim() : ''))
    .filter(Boolean);
  const n = titles.length;
  if (n === 0) return []; // no plan to review (caller handles the empty case)

  const joined = titles.join(' | ').toLowerCase();
  const req = (request || '').toLowerCase();
  const findings: PlanFinding[] = [];

  // No verification step — the single most common reason a build "looks done"
  // but isn't. Only meaningful once the plan has a couple of steps.
  if (n >= 2 && !RE.testing.test(joined)) {
    findings.push({ level: 'high', message: 'No testing/verification step — add a step that confirms the build actually works before it is called done.' });
  }

  // Jumps into features with no setup/scaffolding.
  if (n >= 3 && !RE.setup.test(joined)) {
    findings.push({ level: 'medium', message: 'No setup/scaffolding step — the plan starts on features without establishing the project structure or dependencies.' });
  }

  // Deploy was requested but never planned.
  if (RE.deployReq.test(req) && !RE.deployStep.test(joined)) {
    findings.push({ level: 'medium', message: 'The request mentions deploying/launching, but the plan has no deploy/release step.' });
  }

  // Under-scoped: a single step for a real request.
  if (n === 1) {
    findings.push({ level: 'medium', message: 'The plan has only one step — it is likely under-scoped; break it into clear, verifiable stages.' });
  }

  // Over-scoped: too many steps to track progress against.
  if (n > 20) {
    findings.push({ level: 'low', message: `The plan has ${n} steps — consider grouping related steps so progress stays trackable.` });
  }

  // Vague, unactionable step titles.
  const vague = titles.filter((t) => RE.genericStep.test(t.toLowerCase()));
  if (vague.length > 0) {
    findings.push({ level: 'low', message: `${vague.length} step(s) are too vague to act on (e.g. "${vague[0]}") — make them specific.` });
  }

  return findings;
}

/** A short, honest plan-review block to surface beside the plan before approval. */
export function planAnalysisSummary(todos: PlanTodo[], request = ''): string {
  const n = (todos || []).filter((t) => t && typeof t.title === 'string' && t.title.trim()).length;
  const findings = analyzePlan(todos, request);
  if (findings.length === 0) {
    return `Plan review (${n} step${n === 1 ? '' : 's'}): ✓ no strategic gaps detected.`;
  }
  const order: Record<PlanRiskLevel, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level]);
  const head = `Plan review (${n} step${n === 1 ? '' : 's'}) — ${findings.length} point${findings.length === 1 ? '' : 's'} to consider before approving:`;
  const body = sorted.map((f) => `  ⚠ ${f.message}`);
  return [head, ...body].join('\n');
}
