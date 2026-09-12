/**
 * Per-agent greeting lines + selection logic.
 * Pure data + helpers extracted from App.tsx so greeting selection is testable.
 *
 * The Vishwakarma Basic / Pro / VIP pools were removed on 2026-09-12 when Vishwakarma itself was
 * deleted (admin: "Vishwakarma ab delete karne layak hai … permanently delete kar do"). One pool
 * remains because there is one chat identity left, and `greetingsForAgent` keeps its signature so
 * a legacy session whose stored agent id is `vishwakarma_pro` still gets a greeting rather than
 * an empty string.
 */

export const NBI_GREETINGS = [
  "Welcome to navBharatAI Workspace! What advanced platform shall we design today?",
  "navBharatAI orchestrator is live. General queries or full-stack builds — let's innovate!",
  "navBharatAI core cognitive system is active. Your enterprise specifications are welcome here.",
  "navBharatAI online. Let's craft scalable architectures with deep, robust logic today.",
];

/**
 * Return the greeting pool for a given agent id.
 *
 * Every agent now resolves to the same pool. The parameter is kept so callers (and the stored agent
 * id on an old session) need no change, and so a future second identity has somewhere to hook in.
 */
export function greetingsForAgent(_agent: string): string[] {
  return NBI_GREETINGS;
}

/**
 * Pick a greeting line for an agent. `pick` lets callers inject a deterministic
 * selector (defaults to random) — keeps the choice testable.
 */
export function pickGreetingForAgent(
  agent: string,
  pick: (arr: string[]) => string = (arr) => arr[Math.floor(Math.random() * arr.length)],
): string {
  return pick(greetingsForAgent(agent));
}
