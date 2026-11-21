// THE GAME CAN BE TUNED IN THE PREVIEW (admin 2026-11-21: "a tuning panel in the preview: sliders for speed, difficulty
// and so on, without prompting again"). Runs the REAL generated core/tuning.ts: a game declares its adjustable numbers,
// the saved values win, only the preview window may set a value, and Save writes exactly the file the kit reads.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { readTuneList, tuningValuesFile, tuneSetMessage, MAX_TUNABLES, TUNING_VALUES_PATH } from '../src/lib/gameTuning';
import { TuningPanel } from '../src/components/agentv3/TuningPanel';
import { gameKitHandoffBlock, TUNING_RULE } from '../src/server/AgentV3/gameKitSeed';

/* eslint-disable @typescript-eslint/no-explicit-any */
const dirs: string[] = [];
let loads = 0;   // module paths must never repeat: the test runner caches a module by its path
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); delete (globalThis as any).window; });

/** A fresh copy of the generated module (its registry is module-level), with an optional saved values file. */
async function load(saved?: Record<string, number>): Promise<any> {
  const dir = join(__dirname, `.tmp-tuning-${process.pid}-${loads++}`);
  dirs.push(dir);
  const files = generateGameRuntime(['tuning']).files;
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
  if (saved) {
    const T = await import(join(dir, 'src/game/core/tuning.ts'));
    writeFileSync(join(dir, TUNING_VALUES_PATH), T.tuningFile(saved));
    const dir2 = dir + '-b'; dirs.push(dir2);
    for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir2, p)), { recursive: true }); writeFileSync(join(dir2, p), c); }
    writeFileSync(join(dir2, TUNING_VALUES_PATH), T.tuningFile(saved));
    return import(join(dir2, 'src/game/core/tuning.ts'));
  }
  return import(join(dir, 'src/game/core/tuning.ts'));
}

describe('🎚️ the kit side', () => {
  it('a declared number starts at its default, stays in range, and can be set', async () => {
    const T = await load();
    const speed = T.tunable('speed', 10, { label: 'Speed', min: 4, max: 30, step: 0.5 });
    expect(speed.value).toBe(10);
    expect(T.tunable('speed', 99, { min: 0, max: 1 })).toBe(speed);   // the same handle, first declaration wins
    expect(T.setTunable('speed', 50)).toBe(true);
    expect(speed.value).toBe(30);
    expect(T.setTunable('nope', 1)).toBe(false);
    expect(T.setTunable('speed', Number.NaN)).toBe(false);
    expect(T.tunables()).toEqual([{ key: 'speed', label: 'Speed', min: 4, max: 30, step: 0.5, value: 30, fallback: 10 }]);
    expect(() => T.tunable('bad key!', 1, { min: 0, max: 2 })).toThrow(/key/);
  });

  it('a value saved by the Tune panel wins over the default (still kept in range)', async () => {
    const T = await load({ speed: 22, gravity: 999 });
    expect(T.tunable('speed', 10, { min: 4, max: 30 }).value).toBe(22);
    expect(T.tunable('gravity', 9.8, { min: 1, max: 30 }).value).toBe(30);
    expect(T.tunable('fresh', 3, { min: 0, max: 5 }).value).toBe(3);
  });

  it('inside the preview only the parent window may set a value; the game announces its sliders to it', async () => {
    const listeners: Array<(e: any) => void> = [];
    const posted: any[] = [];
    const parent = { postMessage: (m: any) => posted.push(m) };
    (globalThis as any).window = { parent, addEventListener: (_t: string, fn: any) => listeners.push(fn) };
    const T = await load();
    const h = T.tunable('jump', 1.5, { min: 0.5, max: 3 });
    await Promise.resolve();
    expect(posted.at(-1)).toEqual({ nbTuneList: [expect.objectContaining({ key: 'jump', value: 1.5 })] });
    listeners.forEach((fn) => fn({ source: { evil: true }, data: { nbTuneSet: { key: 'jump', value: 2.5 } } }));
    expect(h.value).toBe(1.5);                                   // not from the preview: ignored
    listeners.forEach((fn) => fn({ source: parent, data: { nbTuneSet: { key: 'jump', value: 2.5 } } }));
    expect(h.value).toBe(2.5);
  });
});

describe('🎚️ the preview side', () => {
  it('reads only a well-formed slider list from the frame', () => {
    const good = { key: 'speed', label: 'Speed', min: 1, max: 9, step: 0.5, value: 4, fallback: 4 };
    expect(readTuneList({ nbTuneList: [good] })).toEqual([good]);
    expect(readTuneList({ nbTuneList: [{ ...good, key: 'x y' }, { ...good, max: 0 }, { ...good, value: 'a' }, { ...good, step: 0 }] })).toEqual([]);
    expect(readTuneList({ nbTuneList: Array.from({ length: 50 }, (_, i) => ({ ...good, key: 'k' + i })) })!.length).toBe(MAX_TUNABLES);
    expect(readTuneList({ other: 1 })).toBeNull();
    expect(readTuneList(null)).toBeNull();
    expect(tuneSetMessage('speed', 7)).toEqual({ nbTuneSet: { key: 'speed', value: 7 } });
  });

  it('Save writes byte-for-byte the file the kit reads', async () => {
    const T = await load();
    const values = { speed: 12.5, gravity: 9.8, enemies: 6 };
    expect(tuningValuesFile(values)).toBe(T.tuningFile(values));
    expect(tuningValuesFile({})).toBe(generateGameRuntime(['tuning']).files[TUNING_VALUES_PATH]);   // the kit's empty file too
  });

  it('the panel shows a slider per number, Save and Reset', () => {
    const html = renderToStaticMarkup(createElement(TuningPanel, {
      items: [{ key: 'speed', label: 'Speed', min: 1, max: 9, step: 0.5, value: 4, fallback: 4 }, { key: 'enemies', label: 'Enemies', min: 0, max: 20, step: 1, value: 5, fallback: 5 }],
      onChange: () => undefined, onSave: async () => 'ok', onClose: () => undefined,
    }));
    expect((html.match(/type="range"/g) ?? []).length).toBe(2);
    expect(html).toMatch(/Speed/);
    expect(html).toMatch(/Save/);
    expect(html).toMatch(/Reset/);
  });

  it('the preview listens only to its own frames, sends each change to the game, and saves through the owner\'s file import', () => {
    const src = readFileSync(join(__dirname, '../src/components/agentv3/PreviewSurface.tsx'), 'utf8');
    expect(src).toMatch(/if \(!isFromOurPreviewFrame\(e, \[liveIframeRef\.current\?\.contentWindow, inBrowserIframeRef\.current\?\.contentWindow\]\)\) return;\n\s*const list = readTuneList\(e\.data\);/);
    expect(src).toMatch(/onChange=\{\(key, value\) => postToPreview\(tuneSetMessage\(key, value\)\)\}/);
    expect(src).toMatch(/fetch\('\/api\/agentv3\/import-files'[\s\S]{0,200}files: \{ \[TUNING_VALUES_PATH\]: content \}/);
    expect(src).toMatch(/onFileEdited\?\.\(TUNING_VALUES_PATH, content\)/);
  });
});

describe('🎚️ games declare what is tunable', () => {
  it('the runner starter has a Game speed slider that scales the whole run', () => {
    const runner = generateGameShell().files['src/game/LaneRunnerGame.tsx'];
    expect(runner).toMatch(/tunable\('gameSpeed', 1, \{ label: 'Game speed', min: 0\.5, max: 2, step: 0\.05 \}\)/);
    expect(runner).toMatch(/const t = dt \* pace\.value;/);
  });

  it('the builder is told to make the numbers worth adjusting tunable, when the runtime kit is on disk', () => {
    expect(gameKitHandoffBlock([{ recipe: 'generate_game_runtime', ok: true, content: 'Created src/game/core/tuning.ts' }])).toContain(TUNING_RULE);
    expect(gameKitHandoffBlock([{ recipe: 'generate_board_games', ok: true, content: 'x' }])).not.toContain(TUNING_RULE);
  });
});
