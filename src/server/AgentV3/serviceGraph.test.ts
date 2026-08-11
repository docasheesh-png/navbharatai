import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildServiceGraph, classifyScript, portForService, portlessServices } from './serviceGraph';

/**
 * THE MISTAKE THAT WOULD BE WORSE THAN THE GAP IS INVENTING SERVICES.
 *
 * A plain Vite app is ONE process. Splitting it into "frontend + backend" because a file sits in
 * `server/` would start something that does not exist and then report a failure that is not real —
 * turning a working build into a broken one. So the majority of these cases assert that nothing is
 * invented, and only a minority assert that a genuine second service is found.
 */
const pkg = (o: Record<string, unknown>) => JSON.stringify(o);

describe('it does NOT invent services', () => {
  it('a plain Vite app is ONE service', () => {
    const g = buildServiceGraph({
      contents: { 'package.json': pkg({ name: 'web', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '^18' } }) },
    });
    expect(g.services).toHaveLength(1);
    expect(g.multiService).toBe(false);
    expect(g.services[0].kind).toBe('frontend');
  });

  it('a package with dev AND start AND build is still ONE service', () => {
    // Three scripts is not three processes.
    const g = buildServiceGraph({
      contents: { 'package.json': pkg({ name: 'web', scripts: { dev: 'vite', start: 'vite preview', build: 'vite build' } }) },
    });
    expect(g.services).toHaveLength(1);
    expect(g.services[0].script).toBe('dev'); // dev is preferred — it is the one meant for a sandbox
  });

  it('a project with server/ files but ONE package.json stays one service', () => {
    // File layout is not a service boundary. Only a package with its own runnable script is.
    const g = buildServiceGraph({
      contents: {
        'package.json': pkg({ name: 'app', scripts: { dev: 'vite' } }),
        'server/index.ts': 'export const x = 1;',
        'server/routes/api.ts': 'export const y = 2;',
      },
    });
    expect(g.services).toHaveLength(1);
    expect(g.multiService).toBe(false);
  });

  it('a package with no runnable script contributes nothing', () => {
    const g = buildServiceGraph({
      contents: { 'package.json': pkg({ name: 'lib', scripts: { build: 'tsc', test: 'vitest' } }) },
    });
    expect(g.services).toHaveLength(0);
    expect(g.summary).toContain('No runnable service');
  });

  it('unreadable or missing package.json never throws', () => {
    expect(() => buildServiceGraph({ contents: { 'package.json': '{ broken' } })).not.toThrow();
    expect(buildServiceGraph({ contents: {} }).services).toHaveLength(0);
  });
});

describe('a genuine multi-service project', () => {
  const monorepo = {
    contents: {
      'apps/web/package.json': pkg({ name: 'web', scripts: { dev: 'vite' }, dependencies: { react: '^18' } }),
      'apps/api/package.json': pkg({ name: 'api', scripts: { dev: 'tsx watch src/index.ts' }, dependencies: { express: '^4' } }),
    },
    packageDirs: ['apps/web', 'apps/api'],
  };

  it('finds both services and classifies each correctly', () => {
    const g = buildServiceGraph(monorepo);
    expect(g.multiService).toBe(true);
    expect(g.services.map((s) => `${s.name}:${s.kind}`).sort()).toEqual(['api:backend', 'web:frontend']);
  });

  it('STARTS THE BACKEND FIRST — a frontend brought up first hits nothing', () => {
    // The app then renders an error state that looks exactly like a broken build, and the repair loop
    // starts rewriting perfectly good code.
    const g = buildServiceGraph(monorepo);
    expect(g.startOrder.indexOf('apps/api')).toBeLessThan(g.startOrder.indexOf('apps/web'));
  });

  it('records the dependency, and only in one direction', () => {
    const g = buildServiceGraph(monorepo);
    const web = g.services.find((s) => s.name === 'web')!;
    const api = g.services.find((s) => s.name === 'api')!;
    expect(web.dependsOn).toEqual(['apps/api']);
    expect(api.dependsOn).toEqual([]); // a backend never waits for its frontend
  });

  it('gives them DIFFERENT ports', () => {
    const g = buildServiceGraph(monorepo);
    const ports = g.services.map((s) => s.port);
    expect(new Set(ports).size).toBe(ports.length);
  });
});

describe('port assignment — the collision nobody chose', () => {
  it('honours an explicitly requested port', () => {
    expect(portForService('backend', 'node server.js --port 4000', new Set())).toBe(4000);
    expect(portForService('backend', 'PORT=8080 node server.js', new Set())).toBe(8080);
  });

  it('steps off a port already taken instead of colliding', () => {
    // Two services both defaulting to 3000: the second fails to bind, and EADDRINUSE blames a port the
    // user never chose.
    expect(portForService('backend', 'node a.js --port 3000', new Set([3000]))).toBe(3001);
    expect(portForService('backend', 'node a.js --port 3000', new Set([3000, 3001]))).toBe(3002);
  });

  it('two packages both asking for 3000 end up on different ports', () => {
    const g = buildServiceGraph({
      contents: {
        'a/package.json': pkg({ name: 'a', scripts: { dev: 'node a.js --port 3000' }, dependencies: { express: '^4' } }),
        'b/package.json': pkg({ name: 'b', scripts: { dev: 'node b.js --port 3000' }, dependencies: { express: '^4' } }),
      },
      packageDirs: ['a', 'b'],
    });
    const ports = g.services.map((s) => s.port);
    expect(new Set(ports).size).toBe(2);
  });
});

describe('workers and cron — the port that will never open', () => {
  it('a worker gets NO port', () => {
    // Polling for a listener a worker never opens is exactly the "dev server did not come up and its
    // log had no recognisable error" dead end.
    expect(portForService('worker', 'node worker.js', new Set())).toBeNull();
    expect(portForService('cron', 'node cron.js', new Set())).toBeNull();
  });

  it('recognises a worker by its script name', () => {
    for (const name of ['worker', 'queue', 'consumer', 'jobs']) {
      expect(classifyScript(name, 'node index.js', null), name).toBe('worker');
    }
  });

  it('recognises a worker by its QUEUE LIBRARY even when the script is named "start"', () => {
    expect(classifyScript('start', 'tsx src/bullmq-consumer.ts', null)).toBe('worker');
  });

  it('recognises cron', () => {
    expect(classifyScript('cron', 'node tasks.js', null)).toBe('cron');
    expect(classifyScript('scheduler', 'node tasks.js', null)).toBe('cron');
  });

  it('a worker is checked BEFORE web scripts, so "start" cannot steal it', () => {
    // A worker's script often also mentions start; mistaking it for a web service is the expensive
    // error, so the ordering matters and is asserted rather than assumed.
    expect(classifyScript('worker:start', 'node w.js', null)).toBe('worker');
  });

  it('portlessServices hands the runner exactly what it must not poll', () => {
    const g = buildServiceGraph({
      contents: {
        'api/package.json': pkg({ name: 'api', scripts: { dev: 'tsx src/index.ts' }, dependencies: { express: '^4' } }),
        'worker/package.json': pkg({ name: 'worker', scripts: { worker: 'tsx src/worker.ts' } }),
      },
      packageDirs: ['api', 'worker'],
    });
    expect(portlessServices(g).map((s) => s.name)).toEqual(['worker']);
  });

  it('workers start after backends but before the frontend', () => {
    const g = buildServiceGraph({
      contents: {
        'web/package.json': pkg({ name: 'web', scripts: { dev: 'vite' } }),
        'api/package.json': pkg({ name: 'api', scripts: { dev: 'tsx src/index.ts' }, dependencies: { express: '^4' } }),
        'worker/package.json': pkg({ name: 'worker', scripts: { worker: 'tsx w.ts' } }),
      },
      packageDirs: ['web', 'api', 'worker'],
    });
    expect(g.startOrder).toEqual(['api', 'worker', 'web']);
  });
});

describe('classification of ordinary web services', () => {
  it('bundler tooling is a frontend', () => {
    for (const cmd of ['vite', 'next dev', 'nuxt dev', 'astro dev', 'react-scripts start', 'ng serve']) {
      expect(classifyScript('dev', cmd, null), cmd).toBe('frontend');
    }
  });

  it('a bare node/tsx entry is a backend', () => {
    for (const cmd of ['tsx watch src/index.ts', 'nodemon server.js', 'node dist/main.js', 'ts-node src/api.ts']) {
      expect(classifyScript('dev', cmd, null), cmd).toBe('backend');
    }
  });

  it('falls back to the DEPENDENCIES when the command is unrecognised', () => {
    expect(classifyScript('dev', 'run-something', { dependencies: { express: '^4' } })).toBe('backend');
    expect(classifyScript('dev', 'run-something', { dependencies: { react: '^18' } })).toBe('frontend');
  });

  it('a lone unrecognised dev script defaults to frontend — the commoner case', () => {
    expect(classifyScript('dev', 'run-something', null)).toBe('frontend');
  });

  it('a non-runnable script is not a service', () => {
    for (const name of ['build', 'test', 'lint', 'typecheck']) {
      expect(classifyScript(name, 'whatever', null), name).toBeNull();
    }
  });
});

describe('the summary is honest about what it found', () => {
  it('says single when it is single', () => {
    const g = buildServiceGraph({ contents: { 'package.json': pkg({ name: 'web', scripts: { dev: 'vite' } }) } });
    expect(g.summary).toContain('Single service');
    expect(g.summary).toContain('port 5173');
  });

  it('names every service and its port when there are several', () => {
    const g = buildServiceGraph({
      contents: {
        'web/package.json': pkg({ name: 'web', scripts: { dev: 'vite' } }),
        'api/package.json': pkg({ name: 'api', scripts: { dev: 'tsx i.ts' }, dependencies: { express: '^4' } }),
      },
      packageDirs: ['web', 'api'],
    });
    expect(g.summary).toContain('2 services');
    expect(g.summary).toContain('api — backend');
    expect(g.summary).toContain('web — frontend');
  });

  it('says plainly when there is nothing to run, rather than implying a service', () => {
    expect(buildServiceGraph({ contents: {} }).summary).toContain('No runnable service');
  });
});

/**
 * THE WIRING — and the honesty that has to travel with it.
 */
describe('the build actually computes it, and says what it does NOT do', () => {
  const src = readFileSync(join(__dirname, '../routes/agentv3.ts'), 'utf8');

  it('the build computes the graph from the files it wrote', () => {
    expect(src).toContain('buildServiceGraph({ contents: sgFiles, packageDirs: mono.packageDirs })');
  });

  it('it reuses detectMonorepo rather than re-deriving the package list', () => {
    // A project must not be a monorepo to one subsystem and a single package to another.
    expect(src).toContain('detectMonorepo(sgPaths, sgFiles)');
  });

  it('a multi-service project is recorded DISTINCTLY, so it can be counted', () => {
    // The point of recording it before building the runner: find out how often it actually happens.
    expect(src).toContain("'SERVICE_GRAPH_MULTI'");
    expect(src).toContain("'SERVICE_GRAPH_SINGLE'");
  });

  it('it STATES that the other services are not started — a green build must not imply they ran', () => {
    expect(src).toContain('Only the primary service is started today');
  });

  it('it can never affect a build', () => {
    const at = src.indexOf('const sgFiles = Object.fromEntries(writtenFiles);');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 1600)).toContain('the service graph is advisory');
  });
});
