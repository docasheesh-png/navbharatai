// EVERY MODEL RUNNER HEARS STOP (Q-129, 2026-10-04).
//
// The Gemini/Vertex runner never read the build's stop signal, so a Stop pressed during its call waited
// out the whole call. The Claude and OpenAI-shaped runners had it; the third family was missed because
// nothing listed the families. This census does: a class that implements `TurnRunner` must read
// `params.signal`, or CI fails — so a fourth family cannot be added deaf.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';

const root = join(__dirname, '..');

describe('every TurnRunner implementation honours the build stop signal', () => {
  const runners = globSync('src/server/**/*.ts', { cwd: root })
    .filter((f) => !/\.test\.ts$/.test(f))
    .filter((f) => /class \w+ implements TurnRunner\b/.test(readFileSync(join(root, f), 'utf8')));

  it('finds the three provider families', () => {
    expect(runners.length).toBeGreaterThanOrEqual(3);
  });

  it.each(runners)('%s reads params.signal', (file) => {
    expect(readFileSync(join(root, file), 'utf8')).toMatch(/params\.signal/);
  });
});
