// failedbr #2495 (2026-11-22): the user said "aapne asmaan kala kar diya hai, isko natural karo" — the sky turned black.
// The open world's sky is the Athree map's sky dome (src/game/athree/sky.ts), a ShaderMaterial whose palette is LINEAR.
// Without three's output colour-space step a ShaderMaterial is written to the screen raw: measured in the sandbox's
// browser, the night sky came out rgb(4, 6, 16) and the day sky darker than its own palette. Game3DGenerator's
// atmosphere.ts had already learned this; the Athree sky had not.
// 🧬 Class: a kit ShaderMaterial that draws COLOUR to the screen without the output step. This census reads every kit
// file and fails on a new one; the ones listed below are known and owned (each with why it is not yet converted).
import { describe, it, expect } from 'vitest';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';

// Known raw shaders, by kit path. Shrink this list; never grow it without a reason a reviewer can check.
const KNOWN_RAW: Record<string, string> = {
  'src/game/three/environment.ts': 'renders into a PMREM render target (linear by design), never to the screen',
  'src/game/athree/ocean.ts': 'open: surface palette tuned in raw output; converting needs a visual review (BUILD_REPORT_QUEUE Q-3282)',
  'src/game/athree/riverwater.ts': 'open: as ocean.ts (Q-3282)',
  'src/game/athree/plants.ts': 'open: as ocean.ts (Q-3282)',
  'src/game/athree/roadmesh.ts': 'open: as ocean.ts (Q-3282)',
};

describe('kit shaders that draw colour to the screen use the output colour space', () => {
  const pool = recipeFilePool();
  const raw: string[] = [];
  for (const [path, f] of pool) {
    if (!/^src\/game\/.*\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path)) continue;
    if (!/gl_FragColor/.test(f.content)) continue;
    if (!/#include <colorspace_fragment>/.test(f.content)) raw.push(path);
  }

  it('the open world sky (athree/sky.ts) ends its fragment shader with the colour-space step', () => {
    const sky = pool.get('src/game/athree/sky.ts')?.content ?? '';
    expect(sky).toMatch(/gl_FragColor = vec4\(col, 1\.0\);',\s*\n(?:\s*\/\/[^\n]*\n)*\s*'\s*#include <colorspace_fragment>'/);
    expect(raw).not.toContain('src/game/athree/sky.ts');
  });

  it('no NEW raw shader appears in the kit', () => {
    expect(raw.filter((p) => !(p in KNOWN_RAW))).toEqual([]);
  });

  it('a listed file that has been converted is taken off the list', () => {
    expect(Object.keys(KNOWN_RAW).filter((p) => pool.has(p) && !raw.includes(p))).toEqual([]);
  });
});
