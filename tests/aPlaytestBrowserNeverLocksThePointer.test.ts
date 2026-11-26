// NO POINTER LOCK UNDER AUTOMATION (Q-3380, 2026-11-26). Measured on #4552: the playtest clicked the game canvas, the
// game asked for pointer lock, and in the automated headless browser that flooded the page with synthetic input
// (108,052 messages in 3 s) — the game drew 1–4 fps because of our browser, not its own code (4 → 15 fps with the lock
// stubbed). #4552 makes the kit shell skip the lock under navigator.webdriver; this locks the class for EVERY game a
// platform browser clicks (games the builder wrote itself, older kit copies): the browsers that click canvases install
// the stub before any app code runs.
import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import { gamePlaytestScript } from '../src/server/AgentV3/gamePlaytest';
import { clickExplorerScript } from '../src/server/AgentV3/clickExplorer';

describe('🖱️ a platform browser never lets a game lock the pointer', () => {
  it('the game playtest installs the stub on its desktop page before the app runs', () => {
    const script = gamePlaytestScript('http://127.0.0.1:5173/');
    const install = script.indexOf('await ctx.addInitScript(noPointerLock);');
    expect(install).toBeGreaterThan(0);
    expect(install).toBeLessThan(script.indexOf('const page = await ctx.newPage();'));
    expect(script).toContain('Element.prototype.requestPointerLock = stub;');
  });

  it('the click explorer installs it on every fresh page', () => {
    const script = clickExplorerScript('http://127.0.0.1:5173/', { blockWrites: true });
    expect(script).toMatch(/await page\.addInitScript\(\(\) => \{ try \{ Element\.prototype\.requestPointerLock = function \(\) \{ return Promise\.resolve\(\); \};/);
  });

  it('the stub really replaces the lock and keeps a game that awaits it working', async () => {
    const script = gamePlaytestScript('http://127.0.0.1:5173/');
    const src = script.slice(script.indexOf('const noPointerLock = () => {'), script.indexOf('// Frames are counted by DISTINCT timestamps'));
    let locked = false;
    class Element { requestPointerLock() { locked = true; return Promise.resolve(); } }
    const sandbox: Record<string, unknown> = { Element, Promise };
    runInNewContext(`${src}\nnoPointerLock();`, sandbox);
    const canvas = new Element();
    await expect(canvas.requestPointerLock()).resolves.toBeUndefined();
    expect(locked).toBe(false);
  });
});
