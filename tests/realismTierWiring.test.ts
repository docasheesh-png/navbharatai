import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { realismIntent } from '../src/server/lib/realismIntent';

/**
 * REALISM-TIER WIRING — the half of the decision that lives outside the tested function.
 *
 * `realismIntent` is pure and covered on its own (src/server/lib/realismIntent.test.ts). But a pure
 * decision nobody calls is worth nothing: the build route has to (a) call it, (b) only for prompts that
 * are actually about 3D, and (c) put the answer into the prompt the model receives.
 *
 * IF THE CALL IS EVER DROPPED, NOTHING FAILS. No error, no failing build — the model simply stops being
 * told which tier the user asked for, and quietly picks for itself. A user who typed "bilkul asli" gets
 * the flat scene they were complaining about, and a user who typed "simple 3d game" gets a heavyweight
 * render their phone stutters on. Both are silent, and both are one deleted line away.
 *
 * These assertions are SOURCE-LEVEL, and that trade is named honestly: the code sits inside a
 * ~12,000-line route closure that cannot be imported or exercised in a unit test. The decision itself is
 * executed for real below; the wiring is pinned by reading the source — weaker than execution, chosen
 * over no check at all.
 */

const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

describe('the tier decision reaches the model', () => {
  it('the route imports and calls the shared decision — not its own regex', () => {
    expect(route).toContain("from '../lib/realismIntent'");
    expect(route).toMatch(/realismIntent\(prompt\)/);
  });

  it('the decided tier is prepended to the prompt the builder receives', () => {
    // The literal the model reads. If the block stops being written into buildPrompt, the whole
    // decision is inert.
    expect(route).toContain('OBJECT DETAIL TIER');
    expect(route).toMatch(/buildPrompt = `OBJECT DETAIL TIER/);
    expect(route).toContain("setDetailLevel('${realism.tier}')");
  });

  it('it is gated to 3D prompts, so a to-do app never carries a paragraph about dune slip faces', () => {
    /**
     * The gate is the reason this block is affordable at all: it is added to every build's prompt, and
     * a prompt is billed tokens. Without the gate every CRUD app would pay for game guidance.
     */
    const gate = route.match(/if \((\/[^\n]*?\/i)\.test\(prompt\)\) \{\n\s*const realism = realismIntent/);
    expect(gate, 'the 3D gate immediately before realismIntent() has moved or gone').toBeTruthy();
    const re = new RegExp(gate![1].slice(1, -2), 'i');
    expect(re.test('make me a 3d racing game')).toBe(true);
    expect(re.test('ek 3D game banao')).toBe(true);
    expect(re.test('a todo list app with dark mode')).toBe(false);
  });

  it('the REAL tier is told to say "real-looking", never "photorealistic"', () => {
    /**
     * The honesty half. What ships is unmistakably a car/tree/mountain with real proportions, PBR
     * surfaces and shadows — it is not a photograph, because scanned-quality assets come from a
     * scanner. The model must not promise the user something the engine cannot deliver.
     */
    expect(route).toContain('real-looking');
    expect(route).toContain('never "photorealistic"');
  });
});

describe('the decision itself, executed — what the wiring above is carrying', () => {
  it('an explicit realism ask reaches the heavy tier', () => {
    expect(realismIntent('bilkul asli car banao 3d game me').tier).toBe('real');
    expect(realismIntent('make a realistic 3d driving game').tier).toBe('real');
  });

  it('a plain 3D ask stays light — the admin\'s own default', () => {
    expect(realismIntent('ek 3d game banao').tier).toBe('lite');
  });

  it('"real-time multiplayer" is about latency, not looks', () => {
    expect(realismIntent('a 3d game with real-time multiplayer').tier).toBe('lite');
  });
});
