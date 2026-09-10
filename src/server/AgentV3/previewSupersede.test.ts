import { describe, it, expect } from 'vitest';
import { decideSupersede } from './previewSupersede';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A PORT BEING UP IS NOT PROOF OF IDENTITY (admin build report 2026-09-10).
 *
 * The exact sequence, replayed: an imported Express app whose `server/index.ts` serves on 5000. At
 * minute 2 the agent called `update_preview :3000` — the framework DEFAULT, not the app's port — a
 * dev server left by a PREVIOUS session in the resumed sandbox answered there, so `portReady` went
 * true and this function was handed `newPort: 3000` with a recipe naming 5000.
 *
 * It then killed 5000: the real app's own server, to bless a leftover. The narration said it out loud,
 * backwards. Twenty minutes of failing screenshots followed; the agent read `server/index.ts` at minute
 * 22, corrected itself, and the build hit its 30-minute cap eight minutes later.
 */
describe("🔒 the app's own declared port is a VETO, not another port to free", () => {
  const recipe = { port: 5000 } as never;

  it('🔒 REPLAYS THE REPORT: the real app\'s port is no longer killed to bless a leftover', () => {
    const d = decideSupersede({ newPort: 3000, recipe, sourceDeclaredPort: 5000 });
    expect(d.staleports).not.toContain(5000);
    expect(d.staleports).toEqual([]);
  });

  it('🔒 and the recipe that AGREES with the app is not retired either', () => {
    // Retiring it would re-point the preview door at the leftover for every later view — the half of
    // the bug that outlived the build itself.
    expect(decideSupersede({ newPort: 3000, recipe, sourceDeclaredPort: 5000 }).retireRecipe).toBe(false);
  });

  it('the durable declaredPort record is vetoed too, not just the recipe', () => {
    const d = decideSupersede({ newPort: 3000, recipe: null, declaredPort: 5000, sourceDeclaredPort: 5000 });
    expect(d.staleports).toEqual([]);
  });

  it('a genuinely stale OTHER port is still freed — the veto is narrow', () => {
    // The app declares 5000 and is verified on 5000; a leftover on 5173 is still the previous app.
    const d = decideSupersede({ newPort: 5000, recipe: { port: 5173 } as never, sourceDeclaredPort: 5000 });
    expect(d.staleports).toEqual([5173]);
    expect(d.retireRecipe).toBe(true);
  });

  it('🔒 an app that declares NOTHING behaves exactly as before', () => {
    const before = decideSupersede({ newPort: 3000, recipe });
    const after = decideSupersede({ newPort: 3000, recipe, sourceDeclaredPort: null });
    expect(after).toEqual(before);
    expect(after.staleports).toEqual([5000]); // today's behaviour, unchanged
  });

  it('the app verified ON its declared port supersedes normally', () => {
    const d = decideSupersede({ newPort: 5000, recipe: { port: 3000 } as never, sourceDeclaredPort: 5000 });
    expect(d.staleports).toEqual([3000]);
    expect(d.retireRecipe).toBe(true);
    expect(d.note).toContain('5000');
  });
});

describe('🔒 the wiring — a veto nobody passes is not a veto', () => {
  const dispatcher = readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');

  it('update_preview reads the app\'s own declared port before superseding', () => {
    const at = dispatcher.indexOf('const decision = decideSupersede(');
    expect(at).toBeGreaterThan(-1);
    // Read BEFORE the decision, not after — the decision is what consumes it.
    const before = dispatcher.slice(Math.max(0, at - 2000), at);
    expect(before).toContain('declaredPortFrom(portFiles)');
    expect(before).toContain('DECLARED_PORT_FILES');
  });

  it('and passes it into the decision', () => {
    expect(dispatcher).toContain('decideSupersede({ newPort: port, recipe, declaredPort: record?.declaredPort, sourceDeclaredPort })');
  });

  it('🔒 a failed read leaves it NULL — a port hint must never break a build', () => {
    const at = dispatcher.indexOf('let sourceDeclaredPort: number | null = null;');
    expect(at).toBeGreaterThan(-1);
    const body = dispatcher.slice(at, at + 900);
    expect(body).toContain('catch');
    expect(body).toContain('withTimeout(');
  });
});
