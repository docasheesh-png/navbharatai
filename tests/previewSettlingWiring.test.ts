import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decidePreviewReload } from '../src/components/agentv3/previewReloadPolicy';

/**
 * "BUILD HOTI HI RAHTI HAI, AUR CHALTI HUYI APP TUT JATI HAI" — the wiring behind the fix.
 *
 * The pure policy has its own tests. These pin the chain that makes it real: the engine must SAY when
 * it stops writing an app and starts settling one that runs, that word must reach the reducer, the
 * reducer must reach the preview, and the build's END must release whatever was held.
 *
 * Break any link and nothing fails — the preview simply goes back to hard-remounting a running app
 * under the person using it, which is a bug reported weeks later by a user, not by a test.
 */
const types = readFileSync(join(process.cwd(), 'src/server/AgentV3/types.ts'), 'utf8');
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
const simpleBuilder = readFileSync(join(process.cwd(), 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8');
const reducer = readFileSync(join(process.cwd(), 'src/components/agentv3/agentV3Reducer.ts'), 'utf8');
const panel = readFileSync(join(process.cwd(), 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');

describe('the engine says what it is doing', () => {
  it('the wire format carries the phase', () => {
    expect(types).toContain("type: 'build_phase'");
  });

  it('BOTH build lanes announce settling, so behaviour does not depend on which lane ran', () => {
    expect(simpleBuilder).toContain('deps.onSettling?.()');
    expect(route).toContain('onSettling: emitSettlingPhase');
    expect(route).toContain('emitSettlingPhase();'); // the agentic tsc gate's own announcement
  });

  it('the fast lane announces it at the verify gate — the moment writing becomes repairing', () => {
    const settle = simpleBuilder.indexOf('deps.onSettling?.()');
    const repair = simpleBuilder.indexOf('await deps.repair(');
    expect(settle).toBeGreaterThan(-1);
    expect(settle).toBeLessThan(repair);
  });

  it('the end is announced from the FINALLY, not the happy path', () => {
    // A deferral released only on success would leave a user staring at a stale app after any failure
    // — the exact failure mode the deferral exists to prevent.
    const fin = route.indexOf('clearInterval(diagHeartbeatTimer);');
    expect(fin).toBeGreaterThan(-1);
    expect(route.slice(fin, fin + 700)).toContain("phase: 'idle'");
  });
});

describe('the word reaches the preview', () => {
  it('the reducer stores it', () => {
    expect(reducer).toContain("case 'build_phase':");
    expect(reducer).toContain('buildPhase: event.phase');
  });

  it('the panel passes it down', () => {
    expect(panel).toContain('buildPhase={state.buildPhase}');
  });

  it('the preview decides with the shared pure rule, never an inline condition', () => {
    expect(surface).toContain('decidePreviewReload({ mode, phase: buildPhase ?? \'idle\', everRendered: everRenderedRef.current })');
  });

  it('a held update is released when the build ends', () => {
    expect(surface).toContain('shouldFlushOnBuildEnd({');
  });

  it('the hold is never silent — the user is told and can take it', () => {
    expect(surface).toContain('deferredReloadNote(heldReloads)');
    expect(surface).toContain('Refresh now');
  });

  it('"has it rendered" is set from the iframe actually loading, not assumed', () => {
    expect(surface).toContain('everRenderedRef.current = true;');
  });
});

describe('the invariant this change had to respect', () => {
  it('the held-updates bar is NOT inside ResponsiveFrame', () => {
    // ResponsiveFrame keeps a constant tree depth precisely so the iframe is never reparented, and
    // reparenting an iframe IS a reload — the very thing this bar exists to prevent. Putting the bar
    // inside it would have made the fix cause the bug.
    const frame = surface.indexOf('<ResponsiveFrame viewport={viewport}>');
    const close = surface.indexOf('</ResponsiveFrame>', frame);
    expect(frame).toBeGreaterThan(-1);
    expect(surface.slice(frame, close)).not.toContain('deferredReloadNote');
  });
});

describe('the guarantee, executed rather than grepped', () => {
  it('a rendered live app is not reloaded while settling, and is once idle', () => {
    expect(decidePreviewReload({ mode: 'live', phase: 'settling', everRendered: true }).reload).toBe(false);
    expect(decidePreviewReload({ mode: 'live', phase: 'idle', everRendered: true }).reload).toBe(true);
  });
});
