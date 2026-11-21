// A BROWSER WITH NO GPU STARTS AT THE BOTTOM (failedbr #2487 + #2488: the open-world city drew 1–3 frames a second in the
// build's software-rendered browser; "Play" could not be pressed within the explorer's 4 s, and the playtest ran out of time
// without ever playing). Measured on the real generated kit in Chromium + SwiftShader, 1280×720: start screen 5 → 12.75 fps,
// playing 1.25 → 5.75 fps, pressing Play 5.2 s → 2.1 s.
// 🧬 Class: a quality governor that steps down only after measuring — on a renderer that is known to be software from the
// first frame it must not start at the top. Same rule as the lite detail tier (surfaces.ts softwareRenderer, autopsy 61279465).
import { describe, it, expect } from 'vitest';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';

const pool = recipeFilePool();
const file = (p: string) => pool.get(p)!.content;

describe('the kit reads the renderer once and starts at the bottom on software GL', () => {
  it('the shell: Auto quality on a software renderer draws the low tier from the start', () => {
    const game = file('src/game/Game.ts');
    expect(game).toContain("import { groundScene, softwareRenderer } from './three/surfaces';");
    expect(game).toMatch(/const q = this\.autoQuality \? \(softwareRenderer\(\) \? 'low' : steppedQuality\(this\.chosenQuality, this\.perf\.drop\)\) : this\.chosenQuality;/);
  });
  it('the open world: the map\'s phone tier on a software renderer; a game can still ask for any tier', () => {
    const ow = file('src/game/play/openWorld.ts');
    expect(ow).toContain("import { softwareRenderer } from '../three/surfaces';");
    expect(ow).toMatch(/quality: softwareRenderer\(\) \? 'phone' : 'mid', skyOptions: \{ lights: false \}, \.\.\.mapOptions/);
  });
  it('the detector is the one the detail tier already uses (one reader, not a second guess)', () => {
    expect(file('src/game/three/surfaces.ts')).toMatch(/SOFTWARE_GL = \/swiftshader\|llvmpipe\|softpipe\|software\|basic render\/i\.test\(name\)/);
  });
});
