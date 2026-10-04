// Autopsy 31254f9a (2026-10-01). The calculator starter chip, on Weak, stopped by the user at 23 s.
//
// The report said "Complexity: simple (score 15, scaffold) — a tested template for this exact request is
// seeded", and then planned nine files from scratch. No GOLDEN_SCAFFOLD line, because the template was
// never written: setup had just put our own starter into the empty workspace (#3435, the same morning),
// and the pre-seed refused to run whenever `src/` held any file at all. The same report also called a
// user's Stop an unresolved ERROR, a fast-lane BUILD_FAILED "handed off to the full builder", and a
// contract that "came back with nothing usable"; and a 6-second domain lookup sat unrecorded before the
// first build call.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  holdsOnlyOurStarter, srcHoldsOnlyOurStarter, starterCompletedNote, platformSeedTemplates, starterTemplates,
} from '../src/server/AgentV3/starterFragment';
import { TemplateRegistry } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/TemplateRegistry';
import { goldenScaffoldForPrompt, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { BUILD_STOPPED_MESSAGE } from '../src/server/AgentV3/stopSignal';
import { runSimpleBuild, stoppedLaneSummary } from '../src/server/AgentV3/SimpleBuilder';
import { fastLanePhaseSummary } from '../src/server/AgentV3/fastLanePhases';
import { describeLadderDepth } from '../src/server/AgentV3/ladderDepth';

const VITE = new TemplateRegistry().getProvider('vite-react').getFiles([]);
const CALC_PROMPT = 'Build a calculator app with the standard operations (+ − × ÷ %), a clear and a delete key, decimal support, keyboard input, and a running history of recent calculations. Big, tappable buttons; light/dark mode.';
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const route = strip(readFileSync('src/server/routes/agentv3.ts', 'utf8'));
const srcOf = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith('src/')));

describe('§1 the template pre-seed asks "is anybody\'s work here?", not "is src/ empty?"', () => {
  it('🔴 the report: src/ holds our untouched starter — the template may be seeded', () => {
    expect(holdsOnlyOurStarter(srcOf(VITE))).toBe(true);
  });

  it('an empty src/ and an untouched chip template are ours too', () => {
    expect(holdsOnlyOurStarter({})).toBe(true);
    const calc = goldenScaffoldForPrompt(CALC_PROMPT)!;
    expect(calc).toBeTruthy();
    expect(holdsOnlyOurStarter(srcOf(goldenScaffoldFiles(calc)))).toBe(true);
  });

  it('PRECISION: an edited starter file, a file of the user\'s, or an unreadable one is somebody\'s work', () => {
    expect(holdsOnlyOurStarter({ ...srcOf(VITE), 'src/App.tsx': 'export default function App(){return <h1>My shop</h1>}' })).toBe(false);
    expect(holdsOnlyOurStarter({ ...srcOf(VITE), 'src/Cart.tsx': 'export const Cart = 1;' })).toBe(false);
    expect(holdsOnlyOurStarter({ 'src/App.tsx': null })).toBe(false);
  });

  it('reads through the given reader; a failed read or too many files never says "nobody\'s"', async () => {
    const paths = Object.keys(srcOf(VITE));
    expect(await srcHoldsOnlyOurStarter(paths, async (p) => VITE[p])).toBe(true);
    expect(await srcHoldsOnlyOurStarter(paths, async () => { throw new Error('read failed'); })).toBe(false);
    const many = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`);
    expect(await srcHoldsOnlyOurStarter(many, async () => '')).toBe(false);
  });

  it('the seed set is every framework starter plus every chip template', () => {
    expect(platformSeedTemplates().length).toBeGreaterThan(starterTemplates().length);
  });

  it('SOURCE: the route seeds on "nobody\'s work here", and SAYS when it does not', () => {
    expect(route).toMatch(/const nobodysWorkHere = existingSrc\.length === 0 \|\| await srcHoldsOnlyOurStarter\(/);
    expect(route).toMatch(/if \(nobodysWorkHere\) \{/);
    expect(route).not.toMatch(/if \(existingSrc\.length === 0\) \{/);
    expect((route.match(/code: 'GOLDEN_SCAFFOLD_SKIPPED'/g) ?? []).length).toBe(2);
  });
});

describe('§2 a stopped build leaves our starter saved — the retry is still a FRESH build', () => {
  it('SOURCE: the rebuild guard reads the saved files and stands down on our own untouched starter', () => {
    expect(route).toMatch(/let durableSourceCount = appSourceFileCount\(durableFilePaths\);/);
    expect(route).toMatch(/holdsOnlyOurStarter\(contents\)\) \{\s*durableStarterOnlyCount = codePaths\.length;[^}]*durableSourceCount = 0;/);
    // a partial read keeps the protective count
    expect(route).toMatch(/Object\.keys\(contents\)\.length === codePaths\.length && holdsOnlyOurStarter\(contents\)/);
    // both guards read the one corrected count
    expect(route).toMatch(/rebuildGuardFlipsToEdit\(\{\s*intent,\s*isEditMode,\s*durableSourceCount,/);
    expect(route).toMatch(/hasImportIntent,\s*durableSourceCount,\s*\}\)\) \{\s*const srcCount = durableSourceCount;/);
  });
});

describe('§3 setup says what it did, and saves the WHOLE starter', () => {
  it('🔴 an empty workspace is not "a piece of our starter"', () => {
    expect(starterCompletedNote(11, 0)).toBe(' · starter=wrote our 11-file starter into an empty workspace');
    expect(starterCompletedNote(10, 1)).toContain('(1 were already there) — the workspace held only a piece of our own starter');
    expect(starterCompletedNote(10)).toContain('the workspace held only a piece of our own starter');
    expect(starterCompletedNote(0, 0)).toBe('');
  });

  function fakeSandbox(present: Record<string, string>) {
    const written: string[] = [];
    return {
      written,
      sandbox: {
        files: {
          exists: async (p: string) => p === '/home/user/workspace' || Object.keys(present).some((k) => p === `/home/user/workspace/${k}`),
          read: async (p: string) => present[p.replace('/home/user/workspace/', '')],
          writeFiles: async (files: Array<{ path: string }>) => { written.push(...files.map((f) => f.path.replace('/home/user/workspace/', ''))); },
        },
        commands: { run: async () => ({ stdout: Object.keys(present).map((k) => `/home/user/workspace/${k}`).join('\n'), exitCode: 0 }) },
      },
    };
  }
  function actuatorOn(sandbox: unknown): E2BActuator {
    const act = new E2BActuator('test-key');
    const a = act as unknown as Record<string, unknown>;
    a.getSandbox = async () => sandbox;
    a._kickoffPlaywright = () => { /* no browser in a unit test */ };
    return act;
  }

  it('🔴 a completed fragment is saved with the piece that was already there (index.html)', async () => {
    const frag = fakeSandbox({ 'index.html': VITE['index.html'] });
    const act = actuatorOn(frag.sandbox);
    await act.ensureWorkspace('ws-frag', 'vite-react');
    expect(frag.written).not.toContain('index.html');
    const saved = act.takeSeededScaffold('ws-frag')!;
    expect(Object.keys(saved).sort()).toEqual(Object.keys(VITE).sort());
    expect(act.starterPresentBefore('ws-frag')).toBe(1);
  });

  it('an empty workspace (the image already made the folder) reports 0 present', async () => {
    const empty = fakeSandbox({});
    const act = actuatorOn(empty.sandbox);
    await act.ensureWorkspace('ws-empty', 'vite-react');
    expect(act.starterCompletedCount('ws-empty')).toBe(Object.keys(VITE).length);
    expect(act.starterPresentBefore('ws-empty')).toBe(0);
  });
});

describe('§4 a Stop is reported as a Stop', () => {
  const diag = () => new BuildDiagnostics({ buildId: 'b1', workspaceId: 'w1', sessionId: 's1', prompt: 'p', startedAt: 1 });

  it('🔴 a model call cancelled by the Stop is not an unresolved ERROR', () => {
    const d = diag();
    d.recordLlmCall({ ts: 2, model: 'unknown', provider: 'unknown', ok: false, error: BUILD_STOPPED_MESSAGE, promptChars: 1, responseChars: 0, toolCalls: 0, latencyMs: 5650 } as never);
    const r = d.report();
    expect(r.issues.map((i) => i.code)).not.toContain('LLM_CALL_FAILED');
    const stopped = r.issues.find((i) => i.code === 'LLM_CALL_STOPPED')!;
    expect(stopped.severity).toBe('info');
    expect(stopped.autoResolved).toBe(true);
    expect(stopped.message).not.toMatch(/unknown/);
    expect(r.counts.errors).toBe(0);
  });

  it('an ordinary failure is still an error (the stop rule is narrow)', () => {
    const d = diag();
    d.recordLlmCall({ ts: 2, model: 'glm-4.7-flashx', provider: 'glm', ok: false, error: '500 internal server error', promptChars: 1, responseChars: 0, toolCalls: 0, latencyMs: 9 } as never);
    expect(d.report().issues.some((i) => i.code === 'LLM_CALL_FAILED' && i.severity === 'error')).toBe(true);
  });

  it('🔴 a Stop during the shared contract ends the lane: nothing more is announced or generated', async () => {
    const ac = new AbortController();
    const logs: string[] = [];
    const generated: string[] = [];
    const sb = await runSimpleBuild({
      prompt: CALC_PROMPT, framework: 'vite-react', scaffoldPaths: ['src/App.tsx'], shareContract: true, signal: ac.signal,
      log: (m: string) => { logs.push(m); },
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/components/Calculator.tsx :: the calculator';
        if (user.includes('The complete file list')) { ac.abort(); return ''; }
        generated.push(user.slice(0, 40));
        return '<<<FILE src/App.tsx>>>\nexport default function App(){return null}\n<<<ENDFILE>>>';
      },
      writeFiles: async () => { /* nothing should be written */ },
    });
    expect(sb.stopped).toBe(true);
    expect(sb.filesWritten).toBe(0);
    expect(generated).toEqual([]);
    expect(logs.some((m) => /^Building \d+ file/.test(m))).toBe(false);
    expect(sb.summary).toBe('Stopped, as asked — no file had been written yet.');
    expect(sb.phases?.contractOutcome).toBe('stopped');
    expect(fastLanePhaseSummary(sb.phases!)).toContain('the build was stopped while it ran, so no file was written');
    expect(fastLanePhaseSummary(sb.phases!)).not.toContain('came back with nothing usable');
  });

  it('the stop summary counts what was saved', () => {
    expect(stoppedLaneSummary(0)).toBe('Stopped, as asked — no file had been written yet.');
    expect(stoppedLaneSummary(3)).toBe('Stopped, as asked — the 3 file(s) finished so far are saved.');
  });

  it('SOURCE: no "handed off to the full builder" after a Stop; the stopped gate is not left open', () => {
    expect(route).toMatch(/sb\.ok \? 'SIMPLE_BUILD_SUCCESS' : sb\.stopped \? 'SIMPLE_BUILD_STOPPED' : 'SIMPLE_BUILD_FALLBACK'/);
    expect(route).toMatch(/if \(sb\.outcome && !sb\.stopped\) \{/);
    // A module turn's not-yet-due gate is closed too (autopsy 0311186f); the Stop clause is unchanged.
    expect(route).toMatch(/autoResolved: gate\.state === 'green' \|\| gateEvidence\.stoppedByUser === true(?: \|\| \(gate\.state === 'unknown' && !!moduleAwaitsShell\))?,/);
  });

  it('the ladder line describes routing, never how much was built', () => {
    const line = describeLadderDepth({ depth: 1, rungCount: 5, matched: 1, unmatched: 0 } as never);
    expect(line).toContain('every answer came from the lead rung');
    expect(line).not.toContain('delivered the whole build');
  });
});

describe('§5 the domain lookup runs beside setup and is measured', () => {
  it('SOURCE: started before setup, skipped for a seeded chip, its wait recorded', () => {
    const start = route.indexOf('const domainKnowledgeEarly');
    const setup = route.indexOf('const ensureT0 = Date.now();');
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(setup);
    expect(route).toMatch(/const domainKnowledgeEarly[^=]*=\s*!scaffoldWillSeed &&/);
    expect(route).toMatch(/!smallScope && !scaffoldWillSeed\) \{\s*const waitT0 = Date\.now\(\);\s*const learned = await \(domainKnowledgeEarly \?\? learnDomain\(prompt\)\);/);
    expect(route).toMatch(/code: 'DOMAIN_KNOWLEDGE'/);
  });
});
