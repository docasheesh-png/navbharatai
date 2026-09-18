import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildServiceGraph } from '../src/server/AgentV3/serviceGraph';
import { appPortsFrom, previewPortFor, isSecondaryAppPort } from '../src/server/AgentV3/appPorts';
import { decideSupersede } from '../src/server/AgentV3/previewSupersede';
import { sweepFoundSummary } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/portSweep';

/**
 * ADMIN-MANDATED 2026-09-18, on autopsy `1a7f4a58`: *"ab yeh nahi ana chahiye"* —
 *
 *     SERVICE_GRAPH_SINGLE  "Single service: qiikr (frontend on port 5173)."
 *     (supersede)           "superseded now that the current app is verified on port 3001"
 *
 * Two subsystems, one report, opposite conclusions, and the wrong one held the kill switch.
 */

/** The REAL package.json from the report (its own `cat package.json | head -50` output). */
const QIIKR_PKG = JSON.stringify({
  name: 'qiikr',
  private: true,
  type: 'module',
  scripts: {
    dev: 'concurrently "npm run dev:server" "npm run dev:client"',
    'dev:client': 'vite --host 0.0.0.0 --port 5173',
    'dev:server': 'tsx watch server/src/index.ts',
    build: 'tsc && vite build',
    preview: 'vite preview',
  },
  dependencies: { react: '^19.0.0', express: '^5.2.1' },
});
const QIIKR_ENV = 'DATABASE_URL=postgresql://localhost:5432/qiikr\nPORT=3001\nCLIENT_URL=http://localhost:5173\n';
const QIIKR = { 'package.json': QIIKR_PKG, '.env.example': QIIKR_ENV };

describe('🔴 the graph now READS the app instead of defaulting past it', () => {
  it('a delegating dev script is a fan-out, not one process', () => {
    const graph = buildServiceGraph({ contents: { 'package.json': QIIKR_PKG } });
    expect(graph.multiService).toBe(true);
    expect(graph.services).toHaveLength(2);
  });

  it('🔒 5173 is now READ from the app, not taken from DEFAULT_PORTS', () => {
    // The old answer was right by coincidence — Vite's default happens to equal this app's pin — and
    // a guessed port presented as a fact is exactly what let the contradiction go unnoticed.
    const graph = buildServiceGraph({ contents: { 'package.json': QIIKR_PKG } });
    const fe = graph.services.find((s) => s.kind === 'frontend');
    expect(fe?.port).toBe(5173);
    expect(fe?.script).toBe('dev:client'); // the port came from THAT script's own --port flag

    // Proof it is read, not defaulted: change the app's pin and the answer follows it.
    const moved = JSON.parse(QIIKR_PKG);
    moved.scripts['dev:client'] = 'vite --host 0.0.0.0 --port 4321';
    const g2 = buildServiceGraph({ contents: { 'package.json': JSON.stringify(moved) } });
    expect(g2.services.find((s) => s.kind === 'frontend')?.port).toBe(4321);
  });

  it('the API is seen too, and started first', () => {
    const graph = buildServiceGraph({ contents: { 'package.json': QIIKR_PKG } });
    expect(graph.services.find((s) => s.kind === 'backend')?.port).toBe(3001);
    expect(graph.startOrder[0]).toContain('dev:server'); // backends before the web app
  });

  it('🔒 it does NOT invent services — this file\'s own warning', () => {
    // A plain Vite app is ONE service, however many scripts it has.
    const plain = JSON.stringify({ name: 'x', scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' } });
    expect(buildServiceGraph({ contents: { 'package.json': plain } }).multiService).toBe(false);
    // A fan-out to two services of the SAME kind stays one — a miss, and the safe direction.
    const twoFe = JSON.stringify({ name: 'x', scripts: { dev: 'run-p a b', a: 'vite --port 3000', b: 'vite --port 3002' } });
    expect(buildServiceGraph({ contents: { 'package.json': twoFe } }).multiService).toBe(false);
    // A delegation to a script that does not exist expands nothing.
    const ghost = JSON.stringify({ name: 'x', scripts: { dev: 'npm run ghost && npm run phantom' } });
    expect(buildServiceGraph({ contents: { 'package.json': ghost } }).services.length).toBeLessThanOrEqual(1);
  });
});

describe('🔒 THE CONTRADICTION GUARD — the two subsystems cannot disagree by construction', () => {
  it('🔒 the graph\'s preview port and the supersede veto come from ONE derivation', () => {
    const map = appPortsFrom(QIIKR);
    const graph = buildServiceGraph({ contents: QIIKR as Record<string, string> });

    // One answer about which port a person looks at.
    expect(map.preview).toBe(5173);
    expect(previewPortFor(graph)).toBe(map.preview);

    // And the veto holds BOTH of the app's ports, so neither is ever "the previous app".
    expect(map.all).toEqual(expect.arrayContaining([5173, 3001]));
    const decision = decideSupersede({ newPort: 3001, recipe: { port: 5173 } as never, sourceDeclaredPorts: map.all });
    expect(decision.staleports).toEqual([]);
    expect(decision.retireRecipe).toBe(false);

    // 🔴 THE EXACT PAIR THE ADMIN QUOTED: the graph said 5173, the supersede said 3001 and killed it.
    // Now the graph's frontend port is a port the supersede refuses to free — by the same function.
    expect(map.all).toContain(previewPortFor(graph));
  });

  it('🔒 the sweep no longer announces a move when a second process of the app comes up', () => {
    const map = appPortsFrom(QIIKR);
    const line = sweepFoundSummary(5173, 3001, map);
    expect(line).toContain('Nothing has moved');
    expect(line).toContain('5173');
    expect(line).not.toContain('Your app is running on port 3001');
  });

  it('a genuine move is still reported as one', () => {
    // An app with ONE service really did come up somewhere else — that sentence was never wrong.
    const single = appPortsFrom({ 'package.json': JSON.stringify({ name: 'x', scripts: { dev: 'vite' } }) });
    expect(isSecondaryAppPort(single, 3000)).toBe(false);
    expect(sweepFoundSummary(5173, 3000, single)).toContain('Your app is running on port 3000');
  });

  it('🔒 no port map ⇒ the old wording exactly — an unreadable package.json changes nothing', () => {
    expect(sweepFoundSummary(5173, 3000, null)).toBe(sweepFoundSummary(5173, 3000));
    expect(sweepFoundSummary(5173, 3000)).toContain("this project's framework normally uses");
  });
});

describe('previewPortFor — which port is the one a person should see', () => {
  const g = (scripts: Record<string, string>, deps: Record<string, string> = {}) =>
    buildServiceGraph({ contents: { 'package.json': JSON.stringify({ name: 'x', scripts, dependencies: deps }) } });

  it('a frontend always wins — the API is its dependency, not the page', () => {
    expect(previewPortFor(g({ dev: 'run-p api web', api: 'tsx server.ts --port 8080', web: 'vite --port 4321' }))).toBe(4321);
  });

  it('a bare API project previews its only service', () => {
    expect(previewPortFor(g({ dev: 'tsx server.ts --port 8080' }, { express: '^5' }))).toBe(8080);
  });

  it('a project with nothing runnable answers null, never a default', () => {
    expect(previewPortFor(g({ build: 'tsc' }))).toBeNull();
    expect(appPortsFrom({}).preview).toBeNull();
    expect(appPortsFrom({ 'package.json': '{ not json' }).all).toEqual([]);
  });
});

describe('🔒 the wiring — one derivation, actually read', () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const dispatcher = strip(readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8'));
  const actuator = strip(readFileSync(join(process.cwd(), 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8'));

  it('update_preview feeds the veto from appPortsFrom, not from a second derivation', () => {
    const at = dispatcher.indexOf('const decision = decideSupersede(');
    expect(at).toBeGreaterThan(-1);
    const before = dispatcher.slice(Math.max(0, at - 2000), at);
    expect(before).toContain('appPortsFrom(portFiles)');
    expect(before).toContain('sourceDeclaredPorts = appPortMap.all');
  });

  it('and tells the agent when the port it published is not the web page', () => {
    expect(dispatcher).toContain('isSecondaryAppPort(appPortMap, port)');
  });

  it('the sweep passes the app\'s own ports into its summary', () => {
    expect(actuator).toContain('sweepFoundSummary(boundPort, found, appPorts)');
    expect(actuator).toContain('appPortsFrom(');
  });

  it('🔒 REVERSION GUARD: the graph walks delegation rather than reading one command', () => {
    const graph = strip(readFileSync(join(process.cwd(), 'src/server/AgentV3/serviceGraph.ts'), 'utf8'));
    expect(graph).toContain('expandDelegated(');
    expect(graph).toContain("from './npmScripts'");
    // The private regex copy must not come back beside the shared parser.
    expect(graph).not.toContain('--port[= ](\\d{2,5})|PORT=');
  });
});
