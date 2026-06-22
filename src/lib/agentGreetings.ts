/**
 * Per-agent greeting lines + selection logic.
 * Pure data + helpers extracted from App.tsx so greeting selection is testable.
 */

export const NBI_GREETINGS = [
  "Welcome to navBharatAI Workspace! What advanced platform shall we design today?",
  "navBharatAI orchestrator is live. General queries or full-stack builds — let's innovate!",
  "navBharatAI core cognitive system is active. Your enterprise specifications are welcome here.",
  "navBharatAI online. Let's craft scalable architectures with deep, robust logic today.",
];

export const BASIC_GREETINGS = [
  "Vishwakarma Basic active. Security audit protocols loaded and ready for code analysis.",
  "Vishwakarma Basic online. Let's identify structural vulnerabilities and build secure pages.",
  "Vishwakarma Basic analysis engine is fully operational. Ready for your coding needs.",
];

export const PRO_GREETINGS = [
  "Vishwakarma Pro ready. Previous architecture context restored. Ready to build highly optimized premium SaaS workflows!",
  "Welcome back. Continuing your last high-fidelity development session with Vishwakarma Pro configurations.",
  "Pro level authorized. Let's design premium microservices, database structures, and high-performance assets.",
];

export const VIP_GREETINGS = [
  "VIP orchestration initialized. Sovereign multi-model cognitive routing is actively online.",
  "Sovereign VIP Agent active. Enterprise platforms, AI scaling, and zero-trust security matrices initialized.",
  "Welcome to VIP Workspace! Highly tuned LLM orchestrators and stateful agents are ready to assist you.",
];

/** Return the greeting pool for a given agent id. */
export function greetingsForAgent(agent: string): string[] {
  if (agent === 'vishwakarma_vip') return VIP_GREETINGS;
  if (agent === 'vishwakarma_pro') return PRO_GREETINGS;
  if (agent === 'vishwakarma_basic') return BASIC_GREETINGS;
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
