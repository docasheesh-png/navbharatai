/**
 * Admin 2026-11-19: the best game experience at the lowest cost. New games get RECORDED sounds from a pinned,
 * hash-checked, CC BY 4.0 library in place of the code-made voices of the same names; every sound stays changeable
 * (own file, volume, back to built-in) and nothing about sound can break a game.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { SOUND_LIBRARY, SOUND_LIBRARY_LICENCE } from '../src/server/AgentV3/gameAssets/soundLibraryCatalogue';
import { SOUND_BUDGET, gameSoundLibraryEnabled, generateSoundCustomizations, generateSoundLibraryModule, prepareGameSounds, soundsForPrompt, GAME_SOUND_LIBRARY_PATH } from '../src/server/AgentV3/gameAssets/soundSeed';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { contentTypeFor } from '../src/server/AgentV3/bucketPublish';

const names = (prompt: string) => soundsForPrompt(prompt).map((s) => s.name);
const core = SOUND_LIBRARY.filter((s) => s.core).map((s) => s.name);

describe('the recorded sound catalogue', () => {
  it('is pinned, hashed, CC BY 4.0 with its credit, and replaces real built-in voices', () => {
    expect(SOUND_LIBRARY.length).toBe(47);
    expect(SOUND_LIBRARY_LICENCE.spdx).toBe('CC-BY-4.0');
    expect(SOUND_LIBRARY_LICENCE.attribution).toMatch(/Oculus Audio Pack 01.*CC BY 4\.0/);
    for (const s of SOUND_LIBRARY) {
      expect(s.url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/facebookincubator\/Meta-open-sound\/[0-9a-f]{40}\/corpora\/oculus-audio-pack\/ogg\//);
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.gain).toBeGreaterThan(0); expect(s.gain).toBeLessThanOrEqual(1);
      expect(s.duration).toBeGreaterThan(0.05);
    }
    expect(new Set(SOUND_LIBRARY.map((s) => s.name)).size).toBe(SOUND_LIBRARY.length);
    // Every sound was downloaded live from its pinned URL, hash-matched and decoded (scripts/library/admitSoundLibrary.mts).
    const admitted = new Map((JSON.parse(readFileSync('docs/game-engine/asset-candidates/sound-library-admission.json', 'utf8')) as { results: { name: string; verdict: string; sha256: string }[] }).results.map((r) => [r.name, r]));
    for (const s of SOUND_LIBRARY) { expect(admitted.get(s.name)?.verdict, s.name).toBe('admitted'); expect(admitted.get(s.name)!.sha256).toBe(s.sha256); }
    // Every core sound is a name the game already plays, so it is heard without the builder doing anything.
    const synth = generateGameVfxAudio().files['src/game/fx/synth.ts'];
    for (const name of core) expect(synth, name).toMatch(new RegExp(`^  ${name}:\\s+\\{`, 'm'));
  });
});

describe('choosing sounds for a game', () => {
  it('every game gets the core set; a prompt adds what it names', () => {
    expect(names('a puzzle game')).toEqual(core);
    expect(names('a racing game in the rain')).toEqual(expect.arrayContaining(['rain', 'car_engine', 'car_engine_fast', ...core]));
    expect(names('horror game in a graveyard at night')).toEqual(expect.arrayContaining(['amb_horror', 'amb_night']));
    expect(names('gaon ka farm game')).toEqual(expect.arrayContaining(['amb_farm', 'step_dirt']));
  });
  it('stays inside the per-game budget even when the prompt names everything', () => {
    const all = soundsForPrompt(SOUND_LIBRARY.flatMap((s) => s.words).join(' '));
    expect(all.length).toBeLessThanOrEqual(SOUND_BUDGET.maxSounds);
    expect(all.reduce((n, s) => n + s.bytes, 0)).toBeLessThanOrEqual(SOUND_BUDGET.maxBytes);
    expect(all.filter((s) => s.loop).length).toBeLessThanOrEqual(SOUND_BUDGET.maxLoops);
    for (const name of core) expect(all.map((s) => s.name)).toContain(name);
  });
  it('is on by default and has a kill switch', () => {
    expect(gameSoundLibraryEnabled({})).toBe(true);
    expect(gameSoundLibraryEnabled({ AGENTV3_GAME_SOUND_LIBRARY: 'off' })).toBe(false);
  });
});

describe('seeding the sounds into a new game', () => {
  const rig = () => {
    const binary = new Map<string, string>(); const text = new Map<string, string>(); const disk = new Map<string, string>();
    return {
      binary, text, disk,
      workspace: { writeFile: async (_: string, p: string, c: string) => { disk.set(p, c); }, writeBinaryFile: async (_: string, p: string, c: string) => { disk.set(p, c); }, runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
      persistence: {
        saveBinary: async (_: string, f: Record<string, string>) => { for (const [p, c] of Object.entries(f)) binary.set(p, c); },
        readBinary: async (_: string, p: string) => binary.has(p) ? Buffer.from(binary.get(p)!.split(',')[1], 'base64') : null,
        saveText: async (_: string, f: Record<string, string>) => { for (const [p, c] of Object.entries(f)) text.set(p, c); },
      },
    };
  };
  // A fake library whose bytes are real Ogg headers, so the hash/size/magic checks run for real.
  const fake = (name: string, core: boolean, words: string[] = []) => {
    const bytes = Buffer.concat([Buffer.from('OggS'), Buffer.from(name.repeat(20))]);
    return { sound: { ...SOUND_LIBRARY[0], name, core, words, loop: false, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, bytes };
  };
  it('persists verified sounds, skips a tampered one (its built-in voice stays), and writes loader, customizations and credits', async () => {
    const a = fake('step', true), b = fake('click', true), c = fake('rain', false, ['rain']);
    const r = rig();
    const result = await prepareGameSounds({
      prompt: 'game in the rain', workspaceId: 'w', workspace: r.workspace, persistence: r.persistence, signal: new AbortController().signal, env: {},
      library: [a.sound, b.sound, c.sound], store: null,
      download: async (s) => s.name === 'click' ? Buffer.from('tampered') : s.name === 'step' ? a.bytes : c.bytes,
    });
    expect(result.status).toBe('prepared');
    expect(result.prepared).toEqual(['step', 'rain']);
    expect(result.skipped).toEqual(['click']);
    expect([...r.binary.keys()].sort()).toEqual(['public/sfx/library/rain.ogg', 'public/sfx/library/step.ogg']);
    expect(r.disk.get(GAME_SOUND_LIBRARY_PATH)).toContain('"step"');
    expect(r.disk.get(GAME_SOUND_LIBRARY_PATH)).not.toContain('"click"');
    expect(r.disk.get('public/sfx/library/SOUND_CREDITS.txt')).toContain('CC BY 4.0');
    expect(result.handoff).toMatch(/soundCustomizations\.ts/);
  });
  it('downloads ONE at a time (the per-origin limit refused 17 of 18 parallel fetches), retries a refused one once, and serves repeats from the shared cache', async () => {
    const lib = ['step', 'click', 'hit', 'swing', 'land'].map((n) => fake(n, true));
    let inFlight = 0; let maxInFlight = 0; let refusedOnce = false; let downloads = 0;
    const download = async (s: { name: string }) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); downloads++;
      try {
        if (inFlight > 1) throw new Error('Provider rate limit');
        if (s.name === 'hit' && !refusedOnce) { refusedOnce = true; throw new Error('Provider rate limit'); }
        await new Promise((r) => setTimeout(r, 5));
        return lib.find((l) => l.sound.name === s.name)!.bytes;
      } finally { inFlight--; }
    };
    const cache = new Map<string, Uint8Array>();
    const store = { read: async (k: string) => cache.get(k) ?? null, write: async (k: string, b: Uint8Array) => { cache.set(k, b); } };
    const r = rig();
    const first = await prepareGameSounds({ prompt: 'x', workspaceId: 'w', workspace: r.workspace, persistence: r.persistence, signal: new AbortController().signal, env: {}, library: lib.map((l) => l.sound), download, store });
    expect(first.prepared).toEqual(['step', 'click', 'hit', 'swing', 'land']);
    expect(first.skipped).toEqual([]);
    expect(maxInFlight).toBe(1);
    expect(cache.size).toBe(5);
    const before = downloads;
    const second = await prepareGameSounds({ prompt: 'x', workspaceId: 'w2', workspace: rig().workspace, persistence: rig().persistence, signal: new AbortController().signal, env: {}, library: lib.map((l) => l.sound), download, store });
    expect(second.prepared.length).toBe(5);
    expect(downloads).toBe(before);
  }, 20_000);
  it('a cached copy with the wrong bytes is ignored, never served', async () => {
    const a = fake('step', true);
    const store = { read: async () => Buffer.from('OggS-not-the-right-bytes'), write: async () => {} };
    const r = rig();
    const out = await prepareGameSounds({ prompt: 'x', workspaceId: 'w', workspace: r.workspace, persistence: r.persistence, signal: new AbortController().signal, env: {}, library: [a.sound], download: async () => a.bytes, store });
    expect(out.prepared).toEqual(['step']);
    expect(r.binary.get('public/sfx/library/step.ogg')).toContain(a.bytes.toString('base64'));
  });
  it('does nothing when switched off, and reports none when every download fails', async () => {
    const r = rig();
    expect((await prepareGameSounds({ prompt: 'x', workspaceId: 'w', workspace: r.workspace, persistence: r.persistence, signal: new AbortController().signal, env: { AGENTV3_GAME_SOUND_LIBRARY: 'off' } })).status).toBe('off');
    const failed = await prepareGameSounds({ prompt: 'x', workspaceId: 'w', workspace: r.workspace, persistence: r.persistence, signal: new AbortController().signal, env: {}, library: [fake('step', true).sound], download: async () => { throw new Error('offline'); }, store: null });
    expect(failed.status).toBe('none'); expect(failed.skipped).toEqual(['step']); expect(r.disk.size).toBe(0);
  });
});

describe('the generated game code', () => {
  const dir = join(__dirname, `.tmp-sounds-${process.pid}`);
  const loads: Array<[string, string, number]> = []; const plays: string[] = [];
  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    vi.stubGlobal('__soundSpy', { loads, plays });
  });
  afterAll(() => { vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true }); });
  const game = async (name: string, customizations: string) => {
    const d = join(dir, name); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'audio.ts'), `export type SoundCategory = 'music' | 'sfx' | 'ui';
export const audio = { load: async (n: string, u: string, g: number) => { (globalThis as any).__soundSpy.loads.push([n, u, g]); return true; }, play: (n: string) => { (globalThis as any).__soundSpy.plays.push(n); return () => {}; } };`);
    const lib = SOUND_LIBRARY.filter((s) => ['step', 'click', 'amb_forest'].includes(s.name));
    writeFileSync(join(d, 'soundLibrary.ts'), generateSoundLibraryModule(lib));
    if (customizations) writeFileSync(join(d, 'soundCustomizations.ts'), generateSoundCustomizations(lib).replace('= {};', `= ${customizations};`));
    loads.length = 0; plays.length = 0;
    return await import(join(d, 'soundLibrary.ts')) as { loadSoundLibrary: () => void; startAmbience: () => () => void };
  };
  it('loads every library sound at its levelled gain', async () => {
    const m = await game('plain', ''); m.loadSoundLibrary(); m.loadSoundLibrary();
    expect(loads.map((l) => l[0]).sort()).toEqual(['amb_forest', 'click', 'step']);
    expect(loads.find((l) => l[0] === 'step')![2]).toBe(SOUND_LIBRARY.find((s) => s.name === 'step')!.gain);
    m.startAmbience(); expect(plays).toEqual(['amb_forest']);
  });
  it('applies the game\'s own changes: built-in, own file, volume, a brand-new sound; ignores unsafe paths', async () => {
    const m = await game('custom', `{ click: { source: 'built-in' }, step: { volume: 0.5 }, amb_forest: { source: { file: 'public/sfx/jungle.mp3' } }, roar: { source: { file: 'sfx/roar.ogg' } }, bad: { source: { file: '../x.ogg' } }, worse: { source: { file: 'https://evil.example/x.ogg' } } }`);
    m.loadSoundLibrary();
    const byName = Object.fromEntries(loads.map((l) => [l[0], l]));
    expect(byName.click).toBeUndefined();
    expect(byName.step[2]).toBeCloseTo(SOUND_LIBRARY.find((s) => s.name === 'step')!.gain * 0.5, 6);
    expect(byName.amb_forest[1]).toMatch(/sfx\/jungle\.mp3$/); expect(byName.amb_forest[2]).toBe(1);
    expect(byName.roar[1]).toMatch(/sfx\/roar\.ogg$/);
    expect(byName.bad).toBeUndefined(); expect(byName.worse).toBeUndefined();
  });
  it('the audio module, shell and sound library all compile; the shell loads the library once, after unlock', () => {
    const files = { ...generateGameVfxAudio().files, ...generateGameShell().files, ['seeded/' + GAME_SOUND_LIBRARY_PATH]: generateSoundLibraryModule(SOUND_LIBRARY.slice(0, 3)) };
    for (const [path, src] of Object.entries(files)) {
      if (!/\.tsx?$/.test(path)) continue;
      const out = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
      expect(out.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error), path).toEqual([]);
    }
    const shell = Object.values(generateGameShell().files).find((src) => src.includes("from './fx/soundLibrary'"))!;
    expect(shell).toContain("import { loadSoundLibrary } from './fx/soundLibrary';");
    expect(shell.indexOf('audio.unlock();')).toBeLessThan(shell.indexOf('loadSoundLibrary();'));
    // The kit always ships the stand-in, so the shell's import resolves in a game seeded without recorded sounds.
    const stub = generateGameVfxAudio(['audio']).files['src/game/fx/soundLibrary.ts'];
    expect(stub).toContain('export function loadSoundLibrary(): void {}');
    expect(stub).not.toContain('import.meta');
    // The real loader keeps the stand-in's exports, so nothing that imports it can break when it is replaced.
    for (const name of ['loadSoundLibrary', 'startAmbience']) expect(generateSoundLibraryModule(SOUND_LIBRARY.slice(0, 2))).toContain(`export function ${name}(`);
    const audio = Object.entries(files).find(([p]) => p.endsWith('fx/audio.ts'))![1];
    expect(audio).toContain('this.gains.get(name)');
  });
  it('published games serve recorded audio with an audio content type', () => {
    expect(contentTypeFor('public/sfx/library/step.ogg')).toBe('audio/ogg');
    expect(contentTypeFor('x.m4a')).toBe('audio/mp4');
    expect(contentTypeFor('x.mp3')).toBe('audio/mpeg');
  });
});
