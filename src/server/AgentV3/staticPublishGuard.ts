// DOES THIS APP NEED A SERVER THAT A STATIC HOST CANNOT RUN? (admin autopsy 2026-09-01)
//
// THE BUILD THAT CAUSED THIS. A user asked for an ad-blocker browser. It was built as TWO processes:
// `server.ts`, an Express proxy on :3001 that fetches pages and strips the ads — the entire product —
// and a Vite frontend on :5173 whose dev-server proxy forwarded `/api` to it. Inside the sandbox both
// ran and the platform PROVED it: `curl :3001/health` returned ok, and `curl :3001/api/fetch` returned
// a real fetched page.
//
// Then it published. `npm run build` produced static files, those went to Firebase Hosting, and the
// summary told the user: "Aapka browser ab ready hai — koi bhi website open karein aur ads/trackers
// automatically block ho jayenge!"
//
// Both halves of that were impossible on the published link:
//   • A Vite `server.proxy` is a DEV-SERVER feature. After `vite build` it does not exist, so the
//     app's `/api/...` calls have nothing to reach.
//   • `server.ts` was never deployed anywhere. Static hosting cannot run a Node process, so the
//     ad-blocking backend existed only inside a sandbox that later went to sleep.
//
// The user's own words for what they saw: the site worked while it was being built and stopped working
// once it was "finished". Nothing broke. The working half was never published.
//
// WHY NOTHING CAUGHT IT. The publish gates all asked "did files come out?" — dist was non-empty and was
// not the starter page, so `publishableVerdict` passed, correctly. Nobody asked the different question:
// "can what we are publishing actually RUN where we are putting it?"
//
// WHAT THIS IS AND IS NOT. It is a WARNING with named evidence, never a block. The frontend really was
// published and the link really does load — refusing the publish would take away something that works.
// What must not survive is the CLAIM that the whole app works. So this returns a sentence the deploy
// result carries back, and the build report records it.

export type ServerNeedKind =
  | 'server-entry'      // a runnable server file sits in the project
  | 'dev-only-proxy'    // the frontend reaches its backend through a dev-server proxy
  | 'server-script'     // package.json has a script that starts a long-running server
  | 'api-calls';        // the frontend calls a same-origin /api path at runtime

export interface ServerNeedFinding {
  kind: ServerNeedKind;
  /** The exact thing seen, so the user can check it themselves rather than trust a verdict. */
  detail: string;
}

export interface ServerNeedVerdict {
  needsServer: boolean;
  findings: ServerNeedFinding[];
  /** The honest line to hand the user. Empty when nothing was found. */
  note: string;
}

/** Root-level server entries. Deliberately root-ish only: a `server.ts` inside `src/components` is a
 *  component, and `functions/` belongs to a platform that deploys it for us. */
const SERVER_ENTRY = /^(?:src\/)?(?:server|app|api|backend|index)\.(?:ts|js|mjs|cjs)$|^(?:server|backend|api)\/(?:index|server|main|app)\.(?:ts|js|mjs|cjs)$/i;

/** Frameworks whose own build output IS the server, so a static publish is either correct or is the
 *  platform's own concern — flagging them would be noise on an app that is fine. */
/** ⚠️ Matches SCOPED names too. A first version anchored `^remix$` and so missed `@remix-run/node`,
 *  which is what Remix apps actually depend on — the exemption would have silently not applied and
 *  every Remix app would have been warned about a server its own framework deploys. */
const SSR_FRAMEWORK = /^(?:next|nuxt3?|astro|gatsby|@remix-run\/[a-z-]+|remix|@sveltejs\/kit|sveltekit|@nuxt\/[a-z-]+)$/i;

function isSsrProject(packageJson: string | undefined): boolean {
  if (!packageJson) return false;
  try {
    const pkg = JSON.parse(packageJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    return Object.keys(deps).some((d) => SSR_FRAMEWORK.test(d));
  } catch {
    return false;
  }
}

/** Scripts that start a server process (as opposed to building or testing one). */
function serverScripts(packageJson: string | undefined): string[] {
  if (!packageJson) return [];
  try {
    const pkg = JSON.parse(packageJson) as { scripts?: Record<string, string> };
    const out: string[] = [];
    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
      if (typeof cmd !== 'string') continue;
      // `tsx server.ts`, `node server.js`, `nodemon`, `ts-node src/server.ts`
      if (/\b(?:tsx|ts-node|node|nodemon|bun)\b[^&|]*\b(?:server|api|backend)\b/i.test(cmd)) {
        out.push(`${name}: ${cmd.slice(0, 80)}`);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Decide whether the app being published needs a server the static host will not run.
 *
 * Everything is optional so a caller that can only cheaply supply paths still gets the main signal,
 * and a caller with more gets a sharper answer. PURE — no I/O, so it can never delay or fail a publish.
 */
export function detectServerNeed(opts: {
  /** Every source path in the workspace — NOT just this turn's writes. The whole point is that the
   *  backend is usually written in an EARLIER turn and untouched by the one that publishes. */
  sourcePaths?: string[];
  /** Raw package.json, when the caller has it. */
  packageJson?: string;
  /** Raw vite/webpack config, when the caller has it. */
  buildConfig?: string;
  /** Frontend source text, for the `/api` call signal. Any subset is fine. */
  frontendSources?: string[];
}): ServerNeedVerdict {
  const findings: ServerNeedFinding[] = [];
  const paths = (opts.sourcePaths ?? []).filter((p) => typeof p === 'string');

  // An SSR framework builds and deploys its own server — this check has nothing useful to say there.
  if (isSsrProject(opts.packageJson)) return { needsServer: false, findings: [], note: '' };

  for (const p of paths) {
    const norm = p.replace(/^\.\//, '');
    if (SERVER_ENTRY.test(norm)) {
      findings.push({ kind: 'server-entry', detail: norm });
      break; // one is the signal; a list of them is noise
    }
  }

  // A dev-server proxy is the clearest evidence of all: the frontend was WIRED to a backend in a way
  // that exists only while `vite dev` is running, and disappears the moment the app is built.
  const cfg = opts.buildConfig ?? '';
  if (/\bserver\s*:\s*\{[\s\S]{0,400}?\bproxy\s*:/.test(cfg) || /\bproxy\s*:\s*\{[\s\S]{0,200}?['"`]\/api/.test(cfg)) {
    findings.push({ kind: 'dev-only-proxy', detail: 'the build config proxies /api to a local server (development only)' });
  }

  for (const s of serverScripts(opts.packageJson)) {
    findings.push({ kind: 'server-script', detail: s });
    break;
  }

  for (const src of opts.frontendSources ?? []) {
    if (typeof src !== 'string') continue;
    if (/\bfetch\s*\(\s*[`'"]\/api\//.test(src) || /\baxios\.[a-z]+\s*\(\s*[`'"]\/api\//.test(src)) {
      findings.push({ kind: 'api-calls', detail: 'the frontend calls /api/… on its own origin' });
      break;
    }
  }

  // ONE signal alone is not enough to warn on. A stray `api.ts` or an unused script would nag a user
  // whose app is completely fine, and a warning that cries wolf gets ignored on the day it is right.
  // Two independent signals is the bar: something server-shaped EXISTS and something actually USES it.
  const kinds = new Set(findings.map((f) => f.kind));
  const needsServer = kinds.size >= 2;

  return { needsServer, findings, note: needsServer ? buildNote(findings) : '' };
}

/**
 * The sentence the user gets. It states what was published, what was NOT, and what to do — and it
 * never says the app is broken, because the part that was published genuinely works.
 */
function buildNote(findings: ServerNeedFinding[]): string {
  const entry = findings.find((f) => f.kind === 'server-entry');
  const server = entry ? `\`${entry.detail}\`` : 'a server file';
  return [
    `⚠️ This app has a SERVER PART (${server}) and the published link is static hosting, which cannot run it.`,
    'The pages will load, but anything that calls the server will not work on that link.',
    'To make the whole app work, its server has to be deployed too — otherwise say so plainly rather than',
    'describing the published link as a fully working app.',
  ].join(' ');
}

/** The build-report line. Kept separate from the user note so the report can be blunter. */
export function serverNeedReportLine(v: ServerNeedVerdict): string {
  if (!v.needsServer) return '';
  const ev = v.findings.map((f) => `${f.kind} (${f.detail})`).join('; ');
  return `Published to a STATIC host, but this project needs a running server — ${ev}. `
    + 'The frontend is live; the server side of the app is not deployed anywhere. '
    + 'Any summary that describes the published link as fully working is unsupported.';
}
