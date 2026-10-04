// Autopsy 0311186f (2026-10-04). A forex-scalper app was decomposed into 8 modules, and the first two
// turns built constants, types and mock services: no app existed yet, and the "App Shell" module that
// assembles it was the plan's last. Each turn still told the user "I could not verify this one end to
// end … open the preview", "The live preview didn't start automatically — open the Preview tab", and
// "I could not confirm your app running here … send a follow-up and I will get it running", and the
// admin report carried three "nothing proven to run" warnings. The module-turn fix of 2026-09-30
// (autopsy 6a5fb04b) taught the starter blocker, the preview and the reviewer about a module turn; the
// release gate, the runtime record, the recap and the bill sentence were never hunted. This locks them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseGate } from '../src/server/AgentV3/releaseGate';
import { runtimeUncheckedRecord } from '../src/server/AgentV3/AutoFix';
import { summarizeProject } from '../src/server/AgentV3/ProjectSummary';
import { decideMarkupOnProof } from '../src/server/AgentV3/previewEarnsMarkup';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const SHELL = 'App Shell';

describe('a module turn is judged as a module', () => {
  it('the release gate says "not judged yet", naming the shell', () => {
    const v = releaseGate({ buildOk: true, preview: 'not-run', pages: 'not-run', journeys: 'not-run', typecheck: 'passed', tests: 'not-run', awaitingShell: SHELL } as never,
      { blockers: 0, highSeverity: 0, warnings: 0 });
    expect(v.state).toBe('unknown');
    expect(v.headline).toMatch(/Not judged yet/);
    expect(v.headline).toContain(SHELL);
    const whole = releaseGate({ buildOk: true, preview: 'not-run', pages: 'not-run', journeys: 'not-run', typecheck: 'passed', tests: 'not-run' } as never,
      { blockers: 0, highSeverity: 0, warnings: 0 });
    expect(whole.headline).toMatch(/Cannot say whether this works/);
  });

  it('the runtime record is information, not an open warning', () => {
    const r = runtimeUncheckedRecord({ previewRendered: false, awaitingShell: SHELL });
    expect(r.severity).toBe('info');
    expect(r.autoResolved).toBe(true);
    expect(r.message).toContain(SHELL);
    expect(runtimeUncheckedRecord({ previewRendered: false }).severity).toBe('warning');
  });

  it('the recap says there is nothing to open yet, never "open the Preview tab"', () => {
    const graph = { files: ['src/config/constants.ts', 'src/types/core.ts', 'package.json'], components: ['App'], routes: [], deps: ['react', 'vite'] } as never;
    const text = summarizeProject(graph, 'x', { previewLive: false, changedFiles: 2, editMode: false, changedPaths: ['src/config/constants.ts', 'src/types/core.ts'], awaitingShell: SHELL });
    expect(text).toMatch(/Built one part of your app/);
    expect(text).toContain(SHELL);
    expect(text).not.toMatch(/Preview tab|didn't start|Here's what I built/);
  });

  it('the bill sentence names the module, not an app that failed to run', () => {
    const d = decideMarkupOnProof({ decidedBilledUsd: 0.34, realCostUsd: 0.08, sandboxUsd: 0.005, previewProven: false, expectsArtifacts: true, awaitingShell: SHELL });
    expect(d.billedUsd).toBeCloseTo(0.085);
    expect(d.userMessage).toContain(SHELL);
    expect(d.userMessage).not.toMatch(/could not confirm your app running|get it running/);
  });

  it('our own 🧾 money notice is a step, never an error in the problems list', () => {
    const d = new BuildDiagnostics();
    d.ingestEvent({ type: 'narration', agent: 'architect', text: '🧾 I could not confirm your app running here, so you have been charged only what this build actually cost to run.', ts: 1 } as never);
    const issue = d.report().issues.find((i) => /🧾/.test(i.message));
    expect(issue?.code).toBe('AGENT_STEP');
    expect(issue?.severity).toBe('info');
  });

  it('the route threads the module fact into every one of these readers', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/if \(moduleAwaitsShell\) gateEvidence\.awaitingShell = moduleAwaitsShell;/);
    expect(route).toMatch(/if \(gate\.state === 'unknown' && result\.ok && !moduleAwaitsShell\) \{/);
    expect(route).toMatch(/runtimeUncheckedRecord\(\{ previewRendered: renderProvenNow\(\), awaitingShell: moduleAwaitsShell \}\)/);
    expect(route).toMatch(/const summaryText = summarizeProject\([^\n]*awaitingShell: moduleAwaitsShell \}\)/);
    const billCalls = route.match(/decideMarkupOnProof\(\{[\s\S]*?\}\);/g) || [];
    expect(billCalls.length).toBe(2); // the settle and the deadline finalizer
    for (const c of billCalls) expect(c).toMatch(/awaitingShell: moduleAwaitsShell/);
  });
});
