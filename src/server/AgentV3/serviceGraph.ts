// The SERVICE GRAPH — which processes a project is actually made of.
//
// WHY THIS EXISTS. An 84-point directive was cross-checked against the codebase and almost everything
// it asked for already existed. Multi-service support (§32) was one of the two things that genuinely
// did not, and the shape of the gap is precise: the platform can already DETECT structure
// (`detectMonorepo`), CLASSIFY files (`partitionFrontendBackend`) and ROUTE a command into a package
// (`routePackageCommand`) — but nothing anywhere answers the three questions a multi-service project
// turns on:
//
//   1. WHICH processes does this project consist of?
//   2. WHAT does each one need to run, and on which port?
//   3. In WHAT ORDER must they start?
//
// Without those, a project with an API and a web app is treated as one dev server, and the other half
// simply never runs.
//
// THE FAILURE MODES THIS ENCODES, each of which is specific and each of which we have already seen a
// version of:
//   • PORT COLLISION. Two services both defaulting to 3000: the second fails to bind, and the error it
//     prints (EADDRINUSE) blames a port the user never chose.
//   • WRONG START ORDER. Bring the frontend up first and its opening API calls hit nothing. The app
//     then renders an error state that looks exactly like a broken build, and the repair loop starts
//     rewriting perfectly good code.
//   • WAITING FOR A PORT THAT WILL NEVER OPEN. A worker or a cron job has no port. Treating it as a web
//     service means polling for a listener until the timeout — which is precisely the shape of the
//     "dev server did not come up and its log had no recognisable error" dead end.
//
// AND THE MISTAKE THAT WOULD BE WORSE THAN THE GAP: inventing services. A plain Vite app with one
// package.json is ONE service. Splitting it into "frontend + backend" because a file lives in `server/`
// would start a process that does not exist and report a failure that is not real. Detection is
// deliberately conservative — see the tests, where most of the cases assert that nothing is invented.
//
// PURE + dependency-free → fully unit-testable without a sandbox.

import { delegatesTo, portsInCommand, walkScript } from './npmScripts';

export type ServiceKind = 'frontend' | 'backend' | 'worker' | 'cron';

export interface Service {
  /** Stable id — the package dir, or 'root' for a single-package project. */
  id: string;
  name: string;
  kind: ServiceKind;
  /** Directory the command runs in, relative to the project root ('' = root). */
  dir: string;
  /** The script to run (already the package's own script name, not a full command). */
  script: string;
  /**
   * The port it listens on. NULL for a worker/cron — and that null is load-bearing: it is what stops
   * the runner waiting for a listener that will never appear.
   */
  port: number | null;
  /** Services that must be up first. A frontend waits for its backend, never the reverse. */
  dependsOn: string[];
}

export interface ServiceGraph {
  services: Service[];
  /** Start order, dependencies first. Empty when there is nothing to start. */
  startOrder: string[];
  /** True only when the project genuinely has more than one process to run. */
  multiService: boolean;
  /** One honest line for the build report. */
  summary: string;
}

/** Default ports, chosen so the common pair (web 5173 + api 3001) never collides. */
const DEFAULT_PORTS: Record<'frontend' | 'backend', number> = { frontend: 5173, backend: 3001 };

const readJson = (raw: string | undefined): Record<string, any> | null => {
  if (!raw) return null;
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch { return null; }
};

/**
 * What kind of process does this script start?
 *
 * Ordered deliberately: worker/cron are checked FIRST, because a worker's script often also mentions
 * "start", and mistaking it for a web service is the expensive error (waiting for a port forever).
 */
export function classifyScript(
  scriptName: string,
  command: string,
  pkg: Record<string, any> | null,
  /**
   * Skip the "is this an entry script?" NAME gate.
   *
   * That gate exists to FIND the runnable script among all of a package's scripts, where `build` and
   * `lint` must not be mistaken for processes. Inside a fan-out the question is already answered — the
   * author wrote `run-p api web`, so `api` and `web` ARE the processes — and applying the gate there
   * rejects every real-world name (`api`, `web`, `client`, `server`). Worker/cron detection is
   * deliberately still ahead of this, so `run-p web worker` still classifies the worker as one.
   */
  assumeRunnable = false,
): ServiceKind | null {
  const n = String(scriptName || '').toLowerCase();
  const c = String(command || '').toLowerCase();
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) } as Record<string, string>;
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);

  if (/\b(cron|schedule[rd]?)\b/.test(n) || has('node-cron') && /\bcron\b/.test(n)) return 'cron';
  if (/\b(worker|queue|consumer|job[s]?)\b/.test(n)) return 'worker';
  // A queue library in the command is a strong signal even when the script is named oddly.
  if (/\b(bullmq|bull|agenda|bee-queue|celery)\b/.test(c)) return 'worker';

  if (assumeRunnable || /\b(dev|start|serve|preview)\b/.test(n)) {
    // Bundler/dev-server tooling ⇒ frontend. A bare node/tsx entry ⇒ backend.
    if (/\b(vite|next|nuxt|astro|remix|ng serve|react-scripts|svelte-kit|webpack|parcel)\b/.test(c)) return 'frontend';
    if (/\b(nodemon|ts-node|tsx|node|bun run|deno run|fastify|nest)\b/.test(c)) return 'backend';
    // `dev` with an unrecognised command in a package that clearly serves a UI.
    if (has('react') || has('vue') || has('svelte') || has('@angular/core')) return 'frontend';
    if (has('express') || has('fastify') || has('koa') || has('@nestjs/core') || has('hono')) return 'backend';
    return 'frontend'; // a lone `dev` script in an unrecognised project is far more often a web app
  }
  return null;
}

/** The port a service should use: what it explicitly asks for, else the default for its kind. */
export function portForService(kind: ServiceKind, command: string, taken: ReadonlySet<number>): number | null {
  if (kind === 'worker' || kind === 'cron') return null; // no listener — never wait for one
  // Via the shared parser, so this and `declaredPort` can never disagree about what a flag says.
  const explicit = portsInCommand(String(command || ''))[0];
  let port = typeof explicit === 'number' ? explicit : DEFAULT_PORTS[kind];
  // Two services asking for the same port is the collision this exists to prevent; step off it.
  while (taken.has(port)) port += 1;
  return port;
}

/**
 * A delegating entry script is a FAN-OUT, not one process.
 *
 * 🔴 WHY (autopsy `1a7f4a58`, 2026-09-18). "Qiikr" is a Vite web app plus an Express API in one
 * package, started by `"dev": "concurrently \"npm run dev:server\" \"npm run dev:client\""`. The graph
 * read only `dev`, found no port in it, and reported **`Single service: qiikr (frontend on port
 * 5173)`** — where 5173 came from `DEFAULT_PORTS`, not from the app. It was right by coincidence
 * (Vite's default happens to equal the app's pin) and wrong about everything else: one service instead
 * of two, and a guessed port presented as a fact.
 *
 * In the same report the supersede logic concluded the app was on 3001 and killed 5173. Two
 * subsystems, one report, opposite conclusions — so the graph now READS the fan-out instead of
 * defaulting past it.
 *
 * 🔒 CONSERVATIVE, because this file's own header says the mistake worse than the gap is INVENTING a
 * service. Expansion needs the author to have written the fan-out themselves: at least two delegated
 * scripts that exist, classify, and come out as at least two DISTINCT kinds. Two backends behind one
 * script stay one service — a miss, and the safe direction.
 */
function expandDelegated(
  scripts: Record<string, string>,
  best: { script: string; kind: ServiceKind; command: string },
  pkg: Record<string, any> | null,
): Array<{ script: string; kind: ServiceKind; command: string }> | null {
  if (delegatesTo(best.command).length < 2) return null;
  const parts: Array<{ script: string; kind: ServiceKind; command: string }> = [];
  const seen = new Set<string>([best.script]);
  for (const name of delegatesTo(best.command)) {
    walkScript(scripts, name, (script, command) => {
      const kind = classifyScript(script, command, pkg, true);
      if (kind && !parts.some((p) => p.script === script)) parts.push({ script, kind, command });
    }, seen);
  }
  if (parts.length < 2) return null;
  if (new Set(parts.map((p) => p.kind)).size < 2) return null;
  return parts;
}

/**
 * Derive the service graph from the project's files.
 *
 * `packageDirs` comes from detectMonorepo — reused rather than re-derived so a project cannot be a
 * monorepo to one subsystem and a single package to another.
 */
export function buildServiceGraph(opts: {
  contents: Record<string, string>;
  /** Package directories with their own package.json ('' for the root package). */
  packageDirs?: readonly string[];
}): ServiceGraph {
  const contents = opts.contents || {};
  const dirs = new Set<string>(['', ...(opts.packageDirs ?? []).map((d) => String(d || '').replace(/\/+$/, ''))]);

  const found: Service[] = [];
  const taken = new Set<number>();

  for (const dir of [...dirs].sort()) {
    const pkgPath = dir ? `${dir}/package.json` : 'package.json';
    const pkg = readJson(contents[pkgPath]);
    if (!pkg) continue;
    const scripts = (pkg.scripts || {}) as Record<string, string>;

    // ONE service per package: the best runnable script, not every script it happens to have.
    // A package with `dev`, `start` and `build` is one process, not three.
    let best: { script: string; kind: ServiceKind; command: string } | null = null;
    for (const [script, command] of Object.entries(scripts)) {
      const kind = classifyScript(script, String(command ?? ''), pkg);
      if (!kind) continue;
      // Prefer `dev` over `start` — it is the one meant to run in a sandbox with reload.
      const better = !best || (script.toLowerCase() === 'dev' && best.script.toLowerCase() !== 'dev');
      if (better) best = { script, kind, command: String(command ?? '') };
    }
    if (!best) continue;

    const name = String(pkg.name || dir || 'app');
    const parts = expandDelegated(scripts, best, pkg) ?? [best];
    // Claim EXPLICIT ports before defaulted ones, so a default can never squat on a port the app
    // actually asked for and push it off by one.
    const ordered = [...parts].sort((a, b) => portsInCommand(b.command).length - portsInCommand(a.command).length);
    for (const part of ordered) {
      const port = portForService(part.kind, part.command, taken);
      if (port != null) taken.add(port);
      found.push({
        id: parts.length > 1 ? `${dir || 'root'}:${part.script}` : (dir || 'root'),
        name: parts.length > 1 ? `${name} (${part.script})` : name,
        kind: part.kind,
        dir,
        script: part.script,
        port,
        dependsOn: [],
      });
    }
  }

  // A frontend depends on every backend in the project: bring the API up first, or the web app's
  // opening requests fail and the result looks like a broken build.
  const backends = found.filter((s) => s.kind === 'backend').map((s) => s.id);
  for (const s of found) {
    if (s.kind === 'frontend') s.dependsOn = [...backends];
  }

  // Start order: backends, then workers/cron (they usually need the API/db), then frontends last.
  const rank: Record<ServiceKind, number> = { backend: 0, worker: 1, cron: 1, frontend: 2 };
  const startOrder = [...found]
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.id.localeCompare(b.id))
    .map((s) => s.id);

  const multiService = found.length > 1;
  return { services: found, startOrder, multiService, summary: describeGraph(found, multiService) };
}

function describeGraph(services: readonly Service[], multiService: boolean): string {
  if (services.length === 0) return 'No runnable service detected — nothing declares a dev/start script.';
  if (!multiService) {
    const s = services[0];
    return `Single service: ${s.name} (${s.kind}${s.port ? ` on port ${s.port}` : ', no port'}).`;
  }
  const parts = services.map((s) => `${s.name} — ${s.kind}${s.port ? ` :${s.port}` : ' (no port)'}`);
  return `${services.length} services: ${parts.join('; ')}. Start order: ${
    services.length > 1 ? 'backends first, then workers, then the frontend' : 'n/a'
  }.`;
}

/**
 * Services that must NOT be port-polled. Handing this to the runner is what stops it waiting for a
 * listener a worker will never open — the same dead end as "the dev server did not come up".
 */
export function portlessServices(graph: ServiceGraph): Service[] {
  return graph.services.filter((s) => s.port == null);
}
