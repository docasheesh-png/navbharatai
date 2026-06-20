/**
 * Phase 73 — Complexity detection for Pro builds.
 *
 * Scores a task prompt to decide whether extended thinking (larger budget)
 * should be used. Complex tasks — those involving multiple systems, ambiguous
 * requirements, or deep architectural decisions — benefit most from additional
 * reasoning tokens before generating code.
 *
 * Scoring is keyword-based (fast, zero model calls). The result is a simple
 * 'simple' | 'complex' label used to set the AnthropicProvider thinking budget.
 */

const COMPLEX_SIGNALS: { pattern: RegExp; weight: number }[] = [
  // Multiple systems / layers
  { pattern: /\b(full[- ]?stack|fullstack)\b/i, weight: 3 },
  { pattern: /\b(microservice|micro.service)\b/i, weight: 3 },
  { pattern: /\b(backend|api|server).{1,60}(frontend|ui|client)\b/i, weight: 2 },
  { pattern: /\b(frontend|ui|client).{1,60}(backend|api|server)\b/i, weight: 2 },
  // Auth / security complexity
  { pattern: /\b(oauth|saml|sso|jwt|auth(?:entication|orization)?)\b/i, weight: 2 },
  { pattern: /\b(rbac|role.based|permission|access.control)\b/i, weight: 2 },
  // Database / storage
  { pattern: /\b(relational|foreign.key|migration|schema)\b/i, weight: 1 },
  { pattern: /\b(real.?time|websocket|sse|event.?stream)\b/i, weight: 2 },
  // Architecture decisions
  { pattern: /\b(architect|design.pattern|ddd|cqrs|event.?sourcing)\b/i, weight: 3 },
  { pattern: /\b(scalab|high.availab|load.balanc|replac|cache)\b/i, weight: 2 },
  // Multi-file complexity signals
  { pattern: /\b(dashboard|admin.panel|crm|erp|saas)\b/i, weight: 2 },
  { pattern: /\b(payment|stripe|billing|subscription)\b/i, weight: 2 },
  { pattern: /\b(multi.?tenant|tenant)\b/i, weight: 3 },
  // Ambiguous or open-ended
  { pattern: /\b(complex|sophisticated|enterprise|production.?ready)\b/i, weight: 2 },
  { pattern: /\b(like\s+(?:uber|airbnb|twitter|netflix|github|slack|notion|discord))\b/i, weight: 4 },
];

/** Returns true when the prompt is complex enough to warrant extended thinking. */
export function isComplexTask(prompt: string): boolean {
  let score = 0;
  for (const { pattern, weight } of COMPLEX_SIGNALS) {
    if (pattern.test(prompt)) score += weight;
  }
  return score >= 4;
}

/**
 * Thinking budget in tokens for the task complexity level.
 * - simple: thinking disabled (0 → no budget needed)
 * - complex: 16k tokens — allows deep reasoning for multi-system architecture
 */
export function thinkingBudgetFor(prompt: string): number {
  return isComplexTask(prompt) ? 16_000 : 8_000;
}
