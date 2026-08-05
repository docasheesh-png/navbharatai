// AgentV3 — the "Cannot GET /customer/home" class, caught deterministically (ROADMAP #1 Phase 4.1).
//
// THE BUG. A full-stack app has an Express server and a client-side router. The user opens the app,
// it renders, they click through to /customer/home, and then they RELOAD — or share the link. Now the
// browser asks the SERVER for /customer/home. Express has a route for /api/… and nothing else, so it
// answers "Cannot GET /customer/home". The app is not broken; the server was simply never told that
// every non-API path belongs to the client. It is the single most common way a working full-stack
// build looks broken to its owner, and it has been reported to this engine more than once.
//
// WHY A DETERMINISTIC CHECK AND NOT A PROMPT LINE. Both, actually — the prompt now requires the
// fallback (prevention, which is the half that matters), and this is the net underneath: an
// invariant that can be checked exactly, with no model judgement, has no reason to be left to a
// model. The check is pure text analysis over the file map, so it costs nothing per build and is
// tested against real generated shapes rather than assumed.
//
// IT ONLY FIRES WHEN THE BUG IS REAL. Three conditions must hold together: there is an Express
// server, there is a client router, and there is no fallback. An API-only service has no client
// routes to serve and must never be nagged; a Vite dev server already handles this itself, so a
// project with no Express server is silent too.

export interface SpaFallbackFinding {
  /** The server file that needs the fallback. */
  file: string;
  /** Where the client router was found — evidence the app HAS client routes to serve. */
  routerFile: string;
  /** True when the server already serves static files, so only the catch-all is missing. */
  servesStatic: boolean;
  message: string;
}

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

/** An Express app is being created here. */
const EXPRESS_RE = /\b(?:express\s*\(\s*\)|require\s*\(\s*['"]express['"]\s*\))/;
/** …and it is actually listening, i.e. this file is the server rather than a router module. */
const LISTEN_RE = /\.listen\s*\(/;

/**
 * A client-side router that owns paths the server will be asked for.
 *
 * Deliberately narrow: hash routing (`createHashRouter`, `HashRouter`) is EXCLUDED because the path
 * after `#` never reaches the server, so those apps do not have this bug and flagging them would be
 * a false positive that teaches people to ignore the check.
 */
const CLIENT_ROUTER_RE = /\b(?:BrowserRouter|createBrowserRouter|useNavigate|react-router|vue-router|createWebHistory|@tanstack\/react-router|svelte-routing)\b/;
const HASH_ROUTER_RE = /\b(?:HashRouter|createHashRouter|createWebHashHistory)\b/;

/** The server hands out the built client's files. */
const STATIC_RE = /express\.static\s*\(/;

/**
 * A catch-all that returns the client's index.html.
 *
 * Covers the shapes people actually write — `app.get('*')`, the Express 5 `'/*splat'` and named
 * wildcards, `app.use((req,res)=>…sendFile)`, and `connect-history-api-fallback` — because a check
 * that only knows one spelling reports a bug in code that is already correct, which is worse than
 * not checking at all.
 */
const FALLBACK_RES = [
  /app\.(?:get|all|use)\s*\(\s*['"`](?:\*|\/\*[\w]*|\/\{\*[\w]*\})['"`]/,
  /app\.(?:get|all|use)\s*\(\s*\/\^?\.\*/,                     // a regex route: app.get(/.*/ , …)
  /connect-history-api-fallback|history\s*\(\s*\)/,
  /app\.use\s*\(\s*\(\s*(?:req|_req)[^)]*\)\s*=>\s*[\s\S]{0,120}?sendFile/,
];

function hasFallback(source: string): boolean {
  return FALLBACK_RES.some((re) => re.test(source));
}

/** Strip comments so a commented-out fallback is not mistaken for a real one. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * Find the missing-SPA-fallback bug, if it is genuinely present.
 *
 * Returns at most one finding: the app has one server, and repeating the same advice per file would
 * bury it. Pure — the caller supplies the files.
 */
export function analyzeSpaFallback(files: Record<string, string>): SpaFallbackFinding | null {
  const entries = Object.entries(files ?? {}).filter(([p, c]) => CODE_RE.test(p) && typeof c === 'string');

  // Is there a client router at all? Without one there is nothing for the server to fall back TO.
  let routerFile = '';
  for (const [path, raw] of entries) {
    const src = stripComments(raw);
    if (HASH_ROUTER_RE.test(src)) return null;  // hash routes never reach the server
    if (!routerFile && CLIENT_ROUTER_RE.test(src)) routerFile = path;
  }
  if (!routerFile) return null;

  for (const [path, raw] of entries) {
    const src = stripComments(raw);
    if (!EXPRESS_RE.test(src) || !LISTEN_RE.test(src)) continue;
    if (hasFallback(src)) return null;   // already correct — say nothing
    const servesStatic = STATIC_RE.test(src);
    return {
      file: path,
      routerFile,
      servesStatic,
      message: servesStatic
        ? `${path} serves the built client but has no catch-all route, so opening or reloading a page like /dashboard asks the server for a path it does not know and gets "Cannot GET". Add a catch-all that returns index.html, AFTER the API routes.`
        : `${path} runs the API but never serves the built client, so any page other than the entry URL returns "Cannot GET". Serve the client's build folder and add a catch-all returning index.html, AFTER the API routes.`,
    };
  }
  return null;
}

/**
 * The exact code to add, as a repair instruction.
 *
 * "AFTER the API routes" is not a style note: a catch-all registered first swallows every `/api/…`
 * request and returns HTML to the app's own fetch calls — which turns a routing bug into a broken
 * API, a strictly worse failure than the one being fixed.
 */
export function spaFallbackSnippet(finding: SpaFallbackFinding): string {
  const staticLine = finding.servesStatic
    ? ''
    : "app.use(express.static(path.join(__dirname, '../dist')));\n";
  return [
    '// Serve the built client and let IT handle its own routes.',
    '// MUST come after every app.use(\'/api\', …) — registered first, this catch-all would answer',
    '// the app\'s own API calls with HTML.',
    staticLine + "app.get(/.*/, (_req, res) => {",
    "  res.sendFile(path.join(__dirname, '../dist/index.html'));",
    '});',
  ].join('\n');
}
