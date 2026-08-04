// B5 (roadmap Tier 2A) — runtime-error CLASSIFIER for the auto-fix loop.
//
// The browser daemon captures runtime errors and the auto-fix loop (AutoFix.ts) feeds them to a repair
// pass. Today that pass gets a FLAT, uncategorized dump of error strings, so the model must re-derive the
// nature of each failure every time — the "→ auto-fix is limited" weakness the roadmap flags. This module
// classifies each captured error into a root-cause CATEGORY with a targeted, actionable repair hint (and,
// where relevant, the exact NavBharatAI recipe/tool to reach for), then groups + prioritises them. Higher
// signal in → fewer repair iterations out (the fifth rule's "make a struggle a smooth path").
//
// PURE + deterministic (string classification only) — no infra, no sandbox, fully unit-tested. Advisory:
// it only shapes the repair prompt; it never blocks a build and never invents a fix.

export interface RuntimeErrorCategory {
  /** Stable id for the category. */
  id: string;
  /** Human label shown in the grouped repair guidance. */
  label: string;
  /** Priority — lower runs first (app-crashing classes before cosmetic/external). */
  priority: number;
  /** The targeted repair hint handed to the repair pass. */
  hint: string;
}

// Ordered most-specific → most-general; the FIRST match wins (so 'cors' beats the generic 'network').
// Priority orders the grouped output: crash-class defects first, then network, then env/hydration, then
// the catch-all. Each hint tells the repair pass WHAT the class means and HOW to fix it (recipe when apt).
interface Rule {
  category: RuntimeErrorCategory;
  match: RegExp;
}

const RULES: Rule[] = [
  {
    category: {
      id: 'react-render', label: 'React render crash', priority: 1,
      hint: 'A React render threw. Common causes: calling setState during render, returning a non-primitive as a child, or an infinite update loop. Move state updates into an effect/handler, render primitives (or map to elements), and break the update cycle.',
    },
    match: /Objects are not valid as a React child|Maximum update depth exceeded|Too many re-?renders|Cannot update a component .*while rendering/i,
  },
  {
    category: {
      id: 'react-hooks', label: 'React hooks violation', priority: 1,
      hint: 'Hooks must run unconditionally, in the same order, every render. Move the hook above any early return / condition, and never call hooks in a loop or callback.',
    },
    match: /Invalid hook call|Rendered (more|fewer) hooks than|change in the order of Hooks|Rendered more hooks than during the previous render/i,
  },
  {
    category: {
      id: 'null-undefined-access', label: 'Null / undefined access', priority: 2,
      hint: 'A value was undefined/null when read. Guard the access (optional chaining `a?.b`, a default, or a loading check) AND fix the data path that was supposed to populate it — a guard alone can hide a real missing-data bug.',
    },
    match: /Cannot read propert(y|ies) of (undefined|null)|Cannot destructure|of (undefined|null) \(reading/i,
  },
  {
    category: {
      id: 'not-a-function', label: 'Not a function', priority: 2,
      hint: 'Something called as a function is not one — usually a wrong or misspelled import, a default-vs-named import mix-up, or a missing method on an object. Check the import and the actual shape of the value.',
    },
    match: /is not a function|is not a constructor/i,
  },
  {
    category: {
      id: 'module-import', label: 'Module / import failure', priority: 2,
      hint: 'A module failed to load or an export is missing. Fix the import path (case-sensitive) or the named export; for a dynamic import, ensure the target file exists and builds.',
    },
    match: /Failed to (resolve|load|fetch) .*module|does not provide an export named|Cannot find module|Failed to fetch dynamically imported module|Importing a module script failed/i,
  },
  {
    category: {
      id: 'cors', label: 'CORS blocked', priority: 3,
      hint: 'A cross-origin request was blocked by the browser. Add a correct CORS config on the BACKEND that allows the frontend origin (the generate_cors recipe does this safely — allowlist, no wildcard with credentials). Do not "fix" this on the frontend.',
    },
    match: /blocked by CORS|Access-Control-Allow-Origin|CORS policy|Cross-Origin Request Blocked/i,
  },
  {
    category: {
      id: 'http-status', label: 'API returned an error status', priority: 3,
      hint: 'The server responded with a 4xx/5xx. Check the endpoint path, method, and request body; a 401/403 usually means auth is missing, a 404 a wrong URL, a 5xx a backend bug. For a captured "HTTP 5xx from <url>" the request itself succeeded but the backend threw — fix the failing route/handler (and its error handling), not the client call.',
    },
    // Matches app messages ("...status of 500", "500 (") AND the browser-daemon capture ("HTTP 500 from <url>").
    match: /status(?: code)? of (4\d\d|5\d\d)|\b(4\d\d|5\d\d) \(|request failed with status|\bHTTP (4\d\d|5\d\d)\b/i,
  },
  {
    category: {
      id: 'network-fetch', label: 'Network request failed', priority: 3,
      hint: 'A fetch/XHR could not reach the server. Verify the API URL is correct and absolute where needed, the backend/dev-server is running, and the request is not blocked. Wrap the call so a failure is handled, not thrown.',
    },
    match: /Failed to fetch|NetworkError|ERR_(CONNECTION|NAME_NOT_RESOLVED|INTERNET)|net::ERR|Load failed|fetch failed/i,
  },
  {
    category: {
      id: 'hydration', label: 'SSR/CSR hydration mismatch', priority: 4,
      hint: 'The server and client rendered different markup. Make the first client render match the server output exactly — avoid Date.now()/random/`typeof window` branches during the initial render; defer client-only content to an effect.',
    },
    match: /Hydration failed|Text content does not match|did not match|hydrat/i,
  },
  {
    category: {
      id: 'env-config', label: 'Missing / misused env or config', priority: 4,
      hint: 'An env/config value is missing or accessed the wrong way. In a Vite app use import.meta.env.VITE_* (not process.env) on the client, and make sure the key is defined in .env. See generate_env_validation to fail fast on a missing key.',
    },
    match: /process is not defined|import\.meta\.env|Missing .*(env|key|config)|undefined.*API[_ ]?KEY/i,
  },
  {
    category: {
      id: 'syntax-runtime', label: 'Runtime parse/syntax error', priority: 4,
      hint: 'A value failed to parse at runtime — most often JSON.parse() on a non-JSON response (an HTML error page), or a malformed template. Check the response content-type/status before parsing.',
    },
    match: /Unexpected token .*in JSON|Unexpected end of JSON|SyntaxError|Unexpected token/i,
  },
];

const FALLBACK: RuntimeErrorCategory = {
  id: 'uncaught', label: 'Uncaught runtime error', priority: 5,
  hint: 'An uncaught error at runtime. Read the message + stack, locate the source file/line, and apply the smallest targeted fix; add a guard or error boundary only if the underlying cause is genuinely external.',
};

/** Classify a single runtime-error message into its root-cause category. Pure; always returns a category. */
export function classifyRuntimeError(text: string): RuntimeErrorCategory {
  const t = typeof text === 'string' ? text : '';
  for (const rule of RULES) {
    if (rule.match.test(t)) return rule.category;
  }
  return FALLBACK;
}

export interface RuntimeErrorGroup {
  category: RuntimeErrorCategory;
  errors: string[];
}

/**
 * Group a list of captured runtime-error texts by category, ordered by priority (crash-class first) then
 * by how many errors fall in each group. Pure. Empty/junk input → []. Deduplicates identical texts.
 */
export function groupRuntimeErrors(texts: string[]): RuntimeErrorGroup[] {
  if (!Array.isArray(texts)) return [];
  const byId = new Map<string, RuntimeErrorGroup>();
  const seen = new Set<string>();
  for (const raw of texts) {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const category = classifyRuntimeError(text);
    let g = byId.get(category.id);
    if (!g) { g = { category, errors: [] }; byId.set(category.id, g); }
    g.errors.push(text);
  }
  return [...byId.values()].sort(
    (a, b) => a.category.priority - b.category.priority || b.errors.length - a.errors.length,
  );
}

/** Category ids that mean "an API/endpoint call is failing" — the trigger to point the user at the API Tester. */
export const API_PROBLEM_CATEGORY_IDS = new Set(['cors', 'http-status', 'network-fetch']);

/**
 * A user-facing, white-label hint pointing to the API Tester — returned ONLY when the captured runtime
 * errors include an API/network/CORS/HTTP-status failure. Lets v5 proactively tell the user "an API call
 * is failing — test that endpoint in the API Tester" (admin 2026-07-24). Pure; '' when no API-class error
 * is present, so the nudge fires only when it is genuinely relevant. Names no underlying provider.
 */
export function apiTesterHintFor(texts: string[]): string {
  const apiGroups = groupRuntimeErrors(texts).filter((g) => API_PROBLEM_CATEGORY_IDS.has(g.category.id));
  if (apiGroups.length === 0) return '';
  const labels = apiGroups.map((g) => g.category.label).join(', ');
  return `🔌 It looks like an API call in your app is failing (${labels}). You can test that exact endpoint yourself in the API Tester — open Home → Other AI → Developer Tools → API Tester, paste the URL (keep "Route via NavBharatAI" on to bypass CORS), and Send to see the real status and response.`;
}

/**
 * Render categorized, prioritised repair guidance for the repair prompt: each group as a labelled block
 * with its hint and the (capped) errors under it. Pure. '' when there is nothing to render.
 */
export function renderRepairGuidance(texts: string[], maxPerGroup = 5): string {
  const groups = groupRuntimeErrors(texts);
  if (groups.length === 0) return '';
  const blocks = groups.map((g) => {
    const lines = g.errors.slice(0, maxPerGroup).map((e) => `    - ${e}`);
    const more = g.errors.length > maxPerGroup ? [`    …and ${g.errors.length - maxPerGroup} more`] : [];
    return [`▸ ${g.category.label} (${g.errors.length}) — ${g.category.hint}`, ...lines, ...more].join('\n');
  });
  return blocks.join('\n\n');
}
