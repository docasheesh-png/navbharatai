import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { firstPaintEvents, makeFirstPaintHandler } from '../src/server/AgentV3/streamingFirstPaint';

/**
 * AUTOPSY 2b0a3ed5 (2026-09-17) — the working app the user never saw.
 *
 * The prompt was a plain, correctly-classified build order: *"Build a calculator app with the standard
 * operations … Big, tappable buttons; light/dark mode."* At **second 6.7** the golden-scaffold pre-seed
 * put a tested, CI-proven, working Calculator on disk — 12 files, durably saved.
 *
 * Then nothing happened on screen for **56 seconds**: one `glm-4.7-flashx` call, 26,569 input tokens
 * in, **27 tokens out**, `latencyMs: 55723`. The user pressed **Stop at 64 s** and was charged
 * (`CANCELLED_BUILD_CHARGED`, 50%, ₹0.65). `RELEASE_GATE` recorded it exactly: *"no live preview was
 * ever available, so nothing here was proven to RUN"*. Sandbox: 1.1 min up, **98% idle**.
 *
 * 🔑 The app they asked for existed, complete and working, at second 7. We showed them a spinner.
 *
 * ⚠️ The slow-rung bench could not have saved this build and is NOT the fix: it requires 3 calls AND
 * 90 s of observed time before it may retire a rung, and this build had ONE call at 55.7 s. Those
 * thresholds are right — retiring a provider on one unlucky call would be worse — which is precisely
 * why the answer is to stop making the user wait for the model at all when the app already works.
 */

const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
/** Comments stripped — the comment at the call site quotes the code it explains. */
const routeCode = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('firstPaintEvents — one definition of the wire contract', () => {
  it('builds the event the client already listens for, one per path', () => {
    const out = firstPaintEvents(['src/App.tsx', 'index.html'], () => 42);
    expect(out).toEqual([
      { type: 'file_changed', agent: 'architect', change: { path: 'src/App.tsx', kind: 'create' }, ts: 42 },
      { type: 'file_changed', agent: 'architect', change: { path: 'index.html', kind: 'create' }, ts: 42 },
    ]);
  });

  it('skips a malformed path rather than emitting a broken event', () => {
    expect(firstPaintEvents(['', 'ok.ts', null as never, 7 as never], () => 1).map((e) => e.change.path))
      .toEqual(['ok.ts']);
  });

  it('an empty or absent list emits nothing', () => {
    expect(firstPaintEvents([])).toEqual([]);
    expect(firstPaintEvents(undefined as never)).toEqual([]);
  });

  it('🔒 the streaming handler uses this same builder, so the two can never drift', () => {
    const emitted: unknown[] = [];
    const handler = makeFirstPaintHandler('w1', {
      merge: async () => undefined,
      emit: (e) => emitted.push(e),
      now: () => 9,
    }, true);
    handler!([{ path: 'a.ts', content: 'x' }]);
    expect(emitted).toEqual(firstPaintEvents(['a.ts'], () => 9));
  });
});

describe('🔴 the pre-seeded scaffold is shown the moment it exists', () => {
  it('the golden-scaffold block emits first-paint events', () => {
    const at = routeCode.indexOf('goldenPreseeded = true;');
    expect(at).toBeGreaterThan(0);
    const block = routeCode.slice(Math.max(0, at - 700), at);
    expect(block).toContain('firstPaintEvents(Object.keys(goldenFiles))');
    expect(block).toContain('events.emit(e)');
  });

  it('…AFTER the durable save, so a render can never precede the files it reads', () => {
    const at = routeCode.indexOf('goldenPreseeded = true;');
    const block = routeCode.slice(Math.max(0, at - 700), at);
    expect(block.indexOf('saveWorkspaceFiles(workspaceId, goldenFiles)'))
      .toBeLessThan(block.indexOf('firstPaintEvents('));
  });

  it('it rides the SAME flag, so "off" is byte-identical to before', () => {
    const at = routeCode.indexOf('firstPaintEvents(Object.keys(goldenFiles))');
    expect(at).toBeGreaterThan(0);
    expect(routeCode.slice(at - 200, at)).toContain('streamingFirstPaintEnabled()');
  });

  it('🔒 NO dev server is started here — racing the agent’s own would fight for port 5173', () => {
    const at = routeCode.indexOf('firstPaintEvents(Object.keys(goldenFiles))');
    const block = routeCode.slice(at - 400, at + 400);
    expect(block).not.toContain('npm run dev');
    expect(block).not.toContain('runCommand');
    expect(block).not.toContain('getPortUrl');
  });

  it('the scaffold still keeps its own awaited durable save — this adds, never replaces', () => {
    expect(routeCode).toContain('await saveWorkspaceFiles(workspaceId, goldenFiles)');
  });
});
