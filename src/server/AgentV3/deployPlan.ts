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
 * Does this project really import a Node server framework in its own source? Checked the same way
 * `pythonServer` below checks Python — by a real import/require statement in a real file.
 */
function importsNodeServer(files: Record<string, string>): [string, string] | null {
  for (const [path, content] of Object.entries(files)) {
    if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(path) || typeof content !== 'string') continue;
    for (const [dep, name] of NODE_SERVER_DEPS) {
      const escaped = dep.replace(/[/@.-]/g, '\\$&');
      // An import or require of the module itself — not a mention of its name in prose, a variable or
      // a longer package name (`express-rate-limit` is middleware for somebody else's server).
      const imported = new RegExp(`(^|\\n)\\s*import[^\\n]*['"\`]${escaped}['"\`]`).test(content)
        || new RegExp(`require\\(\\s*['"\`]${escaped}['"\`]\\s*\\)`).test(content);
      if (imported) return [dep, name];
    }
  }
  return null;
}

/**
 * 🔒 A SERVER FRAMEWORK IN devDependencies IS NOT, ON ITS OWN, A SERVER (admin report 2026-08-25).
 *
 * The old rule read `dependencies` and `devDependencies` as one set. A frontend-only app that merely
 * carried `express` as a DEV dependency — which our own builder scaffolds, and which `npm ci
 * --omit=dev` does not even install in production — was therefore classified as having a server half,
 * and publish REFUSED it. The user was told their website could not go on website hosting.
 *
 * The asymmetry with `pythonServer` was the tell: Python was always established from a manifest OR a
 * real import in a real file, while Node was established from package.json alone. So the rule is now
 * the same on both sides, and it is still POSITIVE EVIDENCE ONLY:
 *   • a PRODUCTION dependency  ⇒ a server (a real Express app declares it there), or
 *   • a real import/require in the app's own source ⇒ a server, wherever it was declared, or even
 *     if it was never declared at all — which is strictly MORE detection than before, not less.
 * A dev-only dependency that nothing imports is what it looks like: a dev-time tool. PURE.
 */
function nodeServer(pkg: Pkg | null, files: Record<string, string>): BackendPart | null {
  const prod = new Set(Object.keys(pkg?.dependencies ?? {}));
  const hit = NODE_SERVER_DEPS.find(([d]) => prod.has(d)) ?? importsNodeServer(files);
  if (!hit) return null;
  return { runtime: 'node', startCommand: script(pkg, 'start') || '', framework: hit[1] };
}

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
  const backend: BackendPart | null = nodeServer(pkg, files) ?? pythonServer(files);

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

/**
 * WHAT THE DOMAIN SCREEN MAY SAY — because "press Publish" is the wrong instruction for some apps.
 *
 * 🔒 THE LOOP THIS ENDS (admin 2026-08-24). A connected domain whose site has no release makes the
 * connect screen say, correctly, "Connected — one last step: press Publish." For an app with a server
 * half that is an instruction that CANNOT succeed: the publish route refuses it — rightly, since
 * uploading an Express app to a static CDN produces exactly the broken site the user is complaining
 * about. So the screen sends them at a button, the button refuses, the screen says press it again.
 *
 * That is the same failure as the three-day "waiting for DNS" on a permanent conflict: telling someone
 * to do a thing that will never work is not a wrong label, it is wasted days. So the screen is given
 * the app's shape and says the true next step instead.
 *
 * Returns '' when static hosting IS sufficient — the ordinary case, where "press Publish" is right and
 * nothing should be added. PURE.
 */
export function domainPublishBlockNote(plan: DeployPlan): string {
  if (plan.staticHostingSufficient) return '';
  /**
   * 🔒 FULLSTACK IS DELIBERATELY SILENT, and getting this wrong would have been worse than the bug.
   *
   * A fullstack app is not always refused: when the user has a backend host configured AND its own
   * code says it can be split, the publish route deploys the server, bakes the address into the build
   * and publishes the website half — a path that genuinely works. Telling that user "pressing Publish
   * will not put anything on your domain" would be a confident, wrong instruction that stops a
   * working feature, which is a worse failure than the loop this function exists to end.
   *
   * Only a shape with NO website half at all is unambiguous: no configuration, key or wiring makes a
   * bare server servable by static hosting, so the refusal is certain and can be stated up front. For
   * fullstack the publish route decides with the facts this poll does not have, and its refusal is now
   * shown on this very screen (see NbaiDomainConnect's publishResult) rather than swallowed.
   */
  if (plan.shape !== 'node-server' && plan.shape !== 'python-server') return '';
  const what = plan.backend?.framework ?? 'server';
  return `Your app is a ${what} that has to keep running, not a website made of files, so a domain on `
    + 'NavBharatAI cannot serve it on its own. Deploy the server part first. Pressing Publish before '
    + 'that will not put anything on your domain.';
}

/** What the server can actually do about a backend right now — supplied by the caller, never assumed. */
export interface BackendCapability {
  /** A real deploy can run this instant (a Render key resolved, the user's or the server's). */
  canDeploy: boolean;
  /** The honest one-liner about WHOSE account it lands in — comes from `renderRequirement`. */
  requirement: string;
  /**
   * Is splitting this app the right move? Supplied by the caller from `analyzeApiWiring`, because
   * only the app's own code can answer it — see the note in the fullstack branch for why `false`
   * (ship whole) is both the safe default and, for a relative-path app, the correct answer.
   * Undefined ⇒ no verdict was formed, and the split wording stands as before.
   */
  splitAdvised?: boolean;
  /** The wiring analysis's own plain sentence, used when we recommend shipping whole. */
  wholeAppNote?: string;
}

export interface DeployDecision {
  /** May the static publish proceed? */
  proceed: boolean;
  /** What the user is told. '' when publish simply proceeds. */
  message: string;
  /** A machine code the client can branch on to show the right button. */
  code: '' | 'needs-server-hosting' | 'backend-deploy-available';
}

/**
 * THE ONE PLACE THAT TURNS "WE CANNOT HOST THIS" INTO "HERE IS HOW WE WILL".
 *
 * 🔒 WHY THIS EXISTS, AND AN INACCURACY OF MINE IT CORRECTS. `staticHostingRefusal` above tells the
 * user "backend hosting is coming to NavBharatAI". When it was written that was true of the publish
 * path — but it is NOT true of the product: `renderDeploy.ts` is a real, wired backend deploy, and it
 * has been for weeks. So the refusal was about to teach users that something they already have does
 * not exist, which is the same class of dishonesty as claiming something works when it does not — it
 * simply errs in the other direction. Both waste the user's time on a false picture.
 *
 * 🔒 CAPABILITY IS PASSED IN, NOT DETECTED HERE. This module stays pure and knows nothing about
 * Render, keys or env; the caller resolves what is genuinely available and hands it over. That keeps
 * every rule below testable, and means adding a second backend host later changes the CALLER, not this
 * decision.
 *
 * The `requirement` string is reproduced verbatim rather than reworded, because it is the line that
 * names WHOSE ACCOUNT GETS THE BILL — the one fact a user must not have paraphrased at them.
 */
export function deployDecision(plan: DeployPlan, backend: BackendCapability): DeployDecision {
  if (plan.staticHostingSufficient) return { proceed: true, message: '', code: '' };
  if (!backend.canDeploy) {
    return { proceed: false, message: staticHostingRefusal(plan), code: 'needs-server-hosting' };
  }
  const what = plan.backend?.framework ?? 'server';
  if (plan.shape === 'fullstack') {
    /**
     * 🔒 SPLITTING IS AN OPTIMISATION, NOT A REQUIREMENT — and for most fullstack apps it is the
     * WRONG one. See apiWiring.ts: an app whose frontend calls `/api/…` works only because one
     * server serves both halves, so splitting it produces a site whose every button fails silently.
     * The caller supplies that verdict (this module stays pure), and `'whole'` — the safe default —
     * means we say so plainly instead of recommending a split that would break the app.
     */
    if (backend.splitAdvised === false) {
      return {
        proceed: false,
        code: 'backend-deploy-available',
        message: `${backend.wholeAppNote || plan.summary} Use “Deploy backend” to put the whole app somewhere it `
          + `can run — website and ${what} server together, exactly as it works now. ${backend.requirement}`,
      };
    }
    return {
      proceed: false,
      code: 'backend-deploy-available',
      message: `${plan.summary} Deploy the ${what} server first, then publish the website half here so it can `
        + `reach it. ${backend.requirement}`,
    };
  }
  return {
    proceed: false,
    code: 'backend-deploy-available',
    message: `${plan.summary} Use “Deploy backend” to put it somewhere it can run. ${backend.requirement}`,
  };
}
