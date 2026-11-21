// WHAT NAVBHARATAI PRO CAN BUILD, TOLD TO EVERY PLANNER (admin 2026-11-21: "Planner ko pura navbharatai pro me jo jo hai
// sab batao — app / game builder kya kya kar sakte hai, sab batao").
//
// 🔑 WHY. failedbr #2481: the big-app planner did not know the game kit exists, told the user a big map "needs dedicated
// backend infrastructure", and planned a cube on a plane. The game half was fixed first (gamePlannerCapability); this is
// the same fix for the CLASS: a planner that decides what an app's steps are, and what is "beyond a normal build", without
// knowing what the platform's builder already has ready. Three planners decide scope (the mega-app roadmap, Software Project
// Mode's module planner and its replan, and plan mode) and none was told.
//
// 🧬 ONE SOURCE OF TRUTH. The digest is built from the tool catalog itself — every built-in recipe the builder can run, one
// line each, from the recipe's own description. A recipe added to the catalog reaches every planner with no second list to
// keep in step; tests/thePlannerKnowsWhatThePlatformHas.test.ts fails if a recipe is missing from the digest.
import { defaultToolCatalog, RECIPE_TOOLS } from './ToolCatalog';

/** Housekeeping recipes: real, but never a step of an app's plan (docs, ignore files, config the platform adds itself). */
const NOT_A_PLAN_STEP: ReadonlySet<string> = new Set([
  'generate_readme', 'generate_architecture_docs', 'generate_dev_guide', 'generate_env_example', 'generate_gitignore',
  'generate_app_defaults', 'generate_api_docs', 'generate_openapi',
]);

/** A recipe is a catalog tool that writes a ready capability into the app: `generate_*`, or one listed in RECIPE_TOOLS. */
export function plannerCapabilityNames(): string[] {
  const listed = new Set<string>(RECIPE_TOOLS as readonly string[]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of defaultToolCatalog()) {
    if (seen.has(t.name) || NOT_A_PLAN_STEP.has(t.name)) continue;
    if (!t.name.startsWith('generate_') && !listed.has(t.name)) continue;
    seen.add(t.name); out.push(t.name);
  }
  return out;
}

/** AI products a recipe's own description may name; a planner must never repeat one to the user (White-Label Law). */
const AI_PRODUCT_NAMES = /\b(?:Claude(?:\s+Desktop)?|Anthropic|OpenAI|ChatGPT|GPT-?\d*|Gemini|Grok|Cursor|Copilot)\b,?\s*(?:or\s+)?/g;

/** One line of a recipe's own description: its first sentence, without file paths, capped. */
function firstClause(text: string, max = 110): string {
  const s = String(text ?? '').replace(/\s+/g, ' ')
    .replace(/\s*\((?:server|src)\/[^)]*\)/g, '')
    .replace(AI_PRODUCT_NAMES, '')
    .trim();
  const cut = s.search(/\.(\s|$)/);
  const one = (cut > 0 ? s.slice(0, cut) : s).trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

let cached: string | null = null;

/**
 * The block every scope-deciding planner is given. PURE (the catalog is static), computed once.
 * `GAME` capabilities are in here too (the game recipes are catalog recipes); the game-specific planning rules stay in
 * `gamePlannerCapability`, which is said only for a game.
 */
export function platformCapabilityDigest(): string {
  if (cached !== null) return cached;
  const byName = new Map(defaultToolCatalog().map((t) => [t.name, t]));
  const lines = plannerCapabilityNames().map((n) => `- ${n}: ${firstClause(byName.get(n)?.description ?? '')}`);
  cached = [
    'WHAT THE PLATFORM\'S BUILDER ALREADY HAS (ready, tested building blocks it runs by name — each writes real, working code into the app; where a service is involved it runs on the user\'s own keys):',
    ...lines,
    'HOW TO PLAN WITH THIS LIST:',
    '- Anything on it is a NORMAL build step. Never call it impossible, "beyond a normal build" or infrastructure, and never plan a hand-written or simplified substitute for it.',
    '- A step\'s build instruction may name the block it uses (for example "use generate_booking"); user-facing text (titles, goals, messages) never shows these names — say what the user will see working.',
    '- The list is what is READY, not a limit: the builder also writes any ordinary screen, form, list, chart or logic itself.',
    '- A block that needs the user\'s own account (payments, SMS, email, sign-in providers, a database) is real once the user adds their key; until then the app shows an honest "not connected yet" state. That is not a ceiling either.',
  ].join('\n');
  return cached;
}
