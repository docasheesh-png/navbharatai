// WHAT SHAPE IS THIS APP, AND WHAT DOES SHIPPING IT ACTUALLY REQUIRE?
//
// ADMIN 2026-08-23: *"mai dono chahta hu. user koi bhi app le kar aye, hamara platform sabhi apps ko
// welcome kare, kisi bhi format me."*
//
// 🔒 THE BUG THAT MADE THIS NECESSARY. An Express app was imported and published. Publish assumes
// every app is a folder of static files, so it uploaded a Node server to a static CDN and reported
// success. The domain then served Firebase's own "Page Not Found — there was no index.html". Nothing
// errored; the user simply got a broken site and no reason. That is precisely the failure the second
// absolute rule exists to prevent: it LOOKED done and was not.
//
// 🔒 WHY A PLAN AND NOT ANOTHER BOOLEAN. `detectBackendPresence` already answers "can the in-browser
// preview run this?" — a yes/no aimed at the preview. Publishing needs a different, richer question,
// and answering it with one more flag is how a codebase ends up with five overlapping flags that
// disagree. An app is not backend-or-not; it is a SHAPE, and each shape has its own requirements:
//
//   • static        — hand-written HTML/CSS/JS. Upload as-is.
//   • spa           — a frontend that must be BUILT first; the built folder is what ships.
//   • node-server   — an Express/Fastify/Nest process. A CDN cannot run it, ever.
//   • python-server — Flask/FastAPI/Django. Same.
//   • fullstack     — BOTH, and the interesting case: it is two deployables, not one.
//
// 🔒 FULLSTACK IS THE ONE WORTH GETTING RIGHT, and it is where competitors stop. A React app served by
// an Express API is not "a backend app" — it is a frontend that belongs on a CDN (fast, cached at the
// edge, effectively free) and an API that belongs on a Node host. Shipping the whole thing to one or
// the other is either broken or needlessly slow and expensive. Splitting them is the right answer and
// nobody does it automatically, because it requires knowing which files are which — which is exactly
// what this module works out.
//
// PURE and deterministic: files in, plan out. No network, no env, no I/O — so every rule is testable,
// and the same app always yields the same plan.

export type AppShape = 'static' | 'spa' | 'node-server' | 'python-server' | 'fullstack' | 'unknown';

export interface FrontendPart {
  /** The command that produces the shippable folder, when one is needed ('' for plain static). */
  buildCommand: string;
  /** Where the shippable files land. For plain static this is the project root. */
  outputDir: string;
}

export interface BackendPart {
  runtime: 'node' | 'python';
  /** How the server is started, as declared by the project itself when it says so. */
  startCommand: string;
  /** The framework we recognised, for an honest human-readable explanation. */
  framework: string;
}

export interface DeployPlan {
  shape: AppShape;
  /** Present when something can be served from a static CDN. */
  frontend: FrontendPart | null;
  /** Present when something needs a RUNNING PROCESS — a CDN can never satisfy this. */
  backend: BackendPart | null;
  /**
   * 🔒 THE FIELD THAT FIXES THE REPORTED BUG. False means static hosting alone cannot deliver a
   * working app, so publish must refuse and say why rather than upload files that cannot work.
   */
  staticHostingSufficient: boolean;
  /** One plain sentence for a non-technical user, naming the shape and what happens next. */
  summary: string;
}

const NODE_SERVER_DEPS: Array<[string, string]> = [
  ['express', 'Express'], ['fastify', 'Fastify'], ['koa', 'Koa'],
  ['@nestjs/core', 'NestJS'], ['@hapi/hapi', 'Hapi'], ['hapi', 'Hapi'],
  ['apollo-server', 'Apollo Server'], ['@apollo/server', 'Apollo Server'],
];
const PY_SERVER_MARKERS: Array<[string, string]> = [
  ['fastapi', 'FastAPI'], ['flask', 'Flask'], ['django', 'Django'],
  ['uvicorn', 'Uvicorn'], ['gunicorn', 'Gunicorn'],
];
/** Frontend build tools whose OUTPUT is what ships, not their source. */
const SPA_BUILD_DEPS: Array<[string, string]> = [
  ['vite', 'dist'], ['@angular/cli', 'dist'], ['react-scripts', 'build'],
  ['parcel', 'dist'], ['webpack', 'dist'],
];

interface Pkg {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  main?: unknown;
}

function readPkg(raw: string | undefined): Pkg | null {
  if (typeof raw !== 'string') return null;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? (p as Pkg) : null;
  } catch {
    return null;
  }
}

const depNames = (pkg: Pkg | null): Set<string> => new Set([
  ...Object.keys(pkg?.dependencies ?? {}),
  ...Object.keys(pkg?.devDependencies ?? {}),
]);

const script = (pkg: Pkg | null, name: string): string => {
  const v = pkg?.scripts?.[name];
  return typeof v === 'string' ? v : '';
};

/**
 * Does any file look like a Python server? Checked by IMPORT, not just by a requirements file, so an
 * app that vendors its dependencies is still recognised.
 */
function pythonServer(files: Record<string, string>): BackendPart | null {
  const reqs = `${files['requirements.txt'] ?? ''}\n${files['pyproject.toml'] ?? ''}\n${files['Pipfile'] ?? ''}`.toLowerCase();
  for (const [marker, name] of PY_SERVER_MARKERS) {
    if (reqs.includes(marker)) return { runtime: 'python', startCommand: '', framework: name };
  }
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith('.py') || typeof content !== 'string') continue;
    const lower = content.toLowerCase();
    for (const [marker, name] of PY_SERVER_MARKERS) {
      if (new RegExp(`(^|\\n)\\s*(from|import)\\s+${marker}\\b`).test(lower)) {
        return { runtime: 'python', startCommand: '', framework: name };
      }
    }
  }
  return null;
}

/**
 * Work out what this app IS and what shipping it needs. PURE.
 *
 * 🔒 THE DEFAULT IS THE SAFE ONE. An app we cannot classify is `unknown` with
 * `staticHostingSufficient: true` — i.e. it is treated as ordinary static files, which is exactly
 * today's behaviour. This matters: a classifier that guessed "probably a backend" on something it did
 * not recognise would start REFUSING to publish working static sites, turning a diagnostic improvement
 * into an outage. We only ever refuse on POSITIVE evidence of a server we cannot run.
 */
export function planDeployment(files: Record<string, string>): DeployPlan {
  const safeDefault: DeployPlan = {
    shape: 'unknown',
    frontend: { buildCommand: '', outputDir: '.' },
    backend: null,
    staticHostingSufficient: true,
    summary: 'Your app will be published as a website.',
  };
  if (!files || typeof files !== 'object' || Object.keys(files).length === 0) return safeDefault;

  const pkg = readPkg(files['package.json']);
  const deps = depNames(pkg);
  const paths = Object.keys(files);

  // ── A server process? ────────────────────────────────────────────────────────────────────────
  let backend: BackendPart | null = null;
  const nodeHit = NODE_SERVER_DEPS.find(([d]) => deps.has(d));
  if (nodeHit) {
    backend = { runtime: 'node', startCommand: script(pkg, 'start') || '', framework: nodeHit[1] };
  } else {
    backend = pythonServer(files);
  }

  // ── Something to serve from a CDN? ───────────────────────────────────────────────────────────
  let frontend: FrontendPart | null = null;
  const spaHit = SPA_BUILD_DEPS.find(([d]) => deps.has(d));
  const hasIndexHtml = paths.some((p) => /(^|\/)index\.html$/i.test(p));
  if (spaHit) {
    frontend = { buildCommand: script(pkg, 'build') || 'npm run build', outputDir: spaHit[1] };
  } else if (hasIndexHtml) {
    // Plain static: the files ARE the site. No build step to run, nothing to get wrong.
    frontend = { buildCommand: '', outputDir: '.' };
  }

  // ── The shape, and the one thing that decides whether publish may proceed ────────────────────
  if (backend && frontend) {
    return {
      shape: 'fullstack',
      frontend,
      backend,
      staticHostingSufficient: false,
      summary: `This app has two halves: a website, and a ${backend.framework} server that powers it. `
        + 'The website part can go live on NavBharatAI; the server part needs somewhere it can actually run.',
    };
  }
  if (backend) {
    return {
      shape: backend.runtime === 'node' ? 'node-server' : 'python-server',
      frontend: null,
      backend,
      staticHostingSufficient: false,
      summary: `This is a ${backend.framework} server, not a website. It needs somewhere it can keep running — `
        + 'website hosting can only serve files, so it cannot start a server.',
    };
  }
  if (spaHit) {
    return {
      shape: 'spa',
      frontend,
      backend: null,
      staticHostingSufficient: true,
      summary: 'Your app will be built and published as a website.',
    };
  }
  if (hasIndexHtml) {
    return {
      shape: 'static',
      frontend,
      backend: null,
      staticHostingSufficient: true,
      summary: 'Your app will be published as a website.',
    };
  }
  return safeDefault;
}

/**
 * What to TELL the user when static hosting cannot deliver their app — instead of publishing a site
 * that will answer "Page Not Found".
 *
 * 🔒 IT NAMES THE SHAPE, THE REASON, AND THE NEXT STEP. A refusal without a next step is a dead end,
 * and this codebase keeps deleting those. It also never blames the user: they did nothing wrong by
 * bringing a backend — we simply have not finished the path that runs one, and saying so plainly is
 * more useful (and more honest) than a generic failure.
 */
export function staticHostingRefusal(plan: DeployPlan): string {
  if (plan.staticHostingSufficient) return '';
  const what = plan.backend?.framework ?? 'server';
  if (plan.shape === 'fullstack') {
    return `${plan.summary} Publishing only the website half would put a page online that cannot reach its `
      + `${what} server, so it would look broken. Backend hosting is coming to NavBharatAI — until then you can `
      + 'deploy the server to your own provider and publish the website half here.';
  }
  return `${plan.summary} Backend hosting is coming to NavBharatAI — until then you can deploy it to your own `
    + 'provider. Nothing has been published, so nothing is broken.';
}
