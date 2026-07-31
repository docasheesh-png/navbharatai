// AgentV3 — SELF-SOURCE GUARD (contamination autopsy 2026-07-31).
//
// ROOT CAUSE it closes: a real build workspace's durable store held NavBharatAI's OWN 2576-file platform
// source (src/server/AgentV3/…, routes/agentv3.ts, the internal design doc). The prompt "make this app"
// then made the engine try to BUILD AND RUN OUR OWN PLATFORM as if it were the user's app — 31 minutes of
// npm installs, dependency-corruption `rm -rf` hacks and `tsx server.ts` boot attempts that never
// converged (ok:null). Building the platform itself as a user app is NEVER a valid operation, so the
// engine must recognise it up front and stop honestly instead of grinding to the wall-clock wall.
//
// This does NOT explain HOW the platform source got into a user workspace (that is a separate storage /
// isolation concern to investigate) — it makes the damage impossible regardless of how it got there, and
// surfaces the condition so it can be found.
//
// FALSE-POSITIVE-PROOF: it fires only when the file set contains AT LEAST TWO highly-specific internal
// platform paths (paths a normal user app would essentially never have, let alone two of). Pure; total.

/** Paths that are unique to the NavBharatAI PLATFORM repo — a user's generated app never ships these. */
const PLATFORM_SIGNATURE_PATHS: readonly string[] = [
  'NAVBHARATAI_PRO_V3_DESIGN.md',
  'src/server/routes/agentv3.ts',
  'src/server/AgentV3/BuildDiagnostics.ts',
  'src/server/AgentV3/AgentRunner.ts',
  'src/server/AgentV3/ToolDispatcher.ts',
  'src/server/AppContext/AppKnowledgeBase.ts',
];

/** How many signature paths must be present to declare the workspace the platform's own source. */
const MIN_SIGNATURE_HITS = 2;

function norm(p: string): string {
  return p.replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

/**
 * True when the given file paths are (unmistakably) NavBharatAI's OWN platform source, not a user app.
 * Requires ≥2 highly-specific internal paths so a normal app — even a full-stack one that happens to have
 * a `src/server` folder — can never trip it. Pure; never throws.
 */
export function looksLikePlatformSource(paths: readonly string[] | undefined | null): boolean {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  const set = new Set(paths.map(norm));
  let hits = 0;
  for (const sig of PLATFORM_SIGNATURE_PATHS) {
    if (set.has(sig)) hits++;
    if (hits >= MIN_SIGNATURE_HITS) return true;
  }
  return false;
}

/** The honest, user-facing message when a build is refused because the workspace is the platform's source. */
export const PLATFORM_SOURCE_REFUSAL =
  "This workspace contains NavBharatAI's own platform code, not a normal app — so I can't build or run it " +
  'as your app. Start a new app in a fresh workspace (or open one of your real projects). This has been ' +
  'flagged for review.';
