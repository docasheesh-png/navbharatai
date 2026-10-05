// A GAME IS NEVER SILENT (found 2026-10-05 while choosing the next game-engine item).
//
// The feedback table fires a sound by NAME on every hit, jump and pickup — audio.play('shoot'). The audio
// manager could only play a FILE loaded under that name, and a generated game ships no sound files. So
// every one of those calls found nothing, returned quietly, and every game NavBharatAI built was silent.
// The prompt's answer (generate_melody) makes tunes and chimes, not a gunshot or a thud. The particle half
// of the table had a test that every preset it names exists; the sound half had no such test, which is how
// a whole column of it could point at nothing.
//
// Now every name has a voice synthesised from code (fx/synth.ts). These tests run the GENERATED modules.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';

const DIR = join(__dirname, `.tmp-game-meta-sound-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let SY: any; let AU: any;
const fx = generateGameVfxAudio().files;

// A Web Audio stand-in that records what the manager asks of it.
class FakeBuffer { data: Float32Array; constructor(public channels: number, public length: number, public sampleRate: number) { this.data = new Float32Array(length); } getChannelData() { return this.data; } }
const started: FakeBuffer[] = [];
class FakeCtx {
  sampleRate = 48000; destination = {}; listener = {};
  createGain() { return { gain: { value: 1 }, connect: () => undefined }; }
  createBuffer(c: number, n: number, sr: number) { return new FakeBuffer(c, n, sr); }
  createBufferSource() { const src: any = { buffer: null, loop: false, detune: { value: 0 }, connect: () => undefined, start: () => started.push(src.buffer), stop: () => { src.stopped = true; } }; return src; }
  createPanner() { return { positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 }, connect: () => undefined }; }
  resume() { return Promise.resolve(); }
  decodeAudioData() { return Promise.resolve(new FakeBuffer(1, 10, 48000)); }
}

beforeAll(async () => {
  (globalThis as any).window = { AudioContext: FakeCtx, addEventListener: () => undefined, removeEventListener: () => undefined };
  for (const r of [generateGameVfxAudio(), generateGameRuntime()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  SY = await import(join(DIR, 'src/game/fx/synth.ts'));
  AU = await import(join(DIR, 'src/game/fx/audio.ts'));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).window; });

const SR = 44100;
const rms = (x: Float32Array, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const crossings = (x: Float32Array, a: number, b: number) => { let n = 0; for (let i = a + 1; i < b; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++; return n / ((b - a) / SR); };

describe('every sound a game asks for has a voice', () => {
  it('CENSUS: every sound the feedback table names is a built-in voice', () => {
    const table = fx['src/game/fx/feedback.ts'];
    const named = [...table.matchAll(/sound: '(\w+)'/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThanOrEqual(18);
    for (const n of named) expect(SY.SYNTH_RECIPES[n], `"${n}" is fired by the table and has no voice — the game would be silent there`).toBeTruthy();
  });

  it('CENSUS: every audio.play(\'…\') in the generated game layers names a built-in voice', () => {
    const all = [generateGameVfxAudio(), generateGameRuntime(), generateGameShell(), generateGameSystems()].flatMap((r) => Object.values(r.files));
    const named = new Set(all.flatMap((src) => [...src.matchAll(/audio\.play\('(\w+)'/g)].map((m) => m[1])));
    for (const n of named) expect(SY.SYNTH_RECIPES[n], n).toBeTruthy();
  });
});

describe('each voice is a real, clean sound', () => {
  it('audible, never clipping, finite, and no click at either end', () => {
    for (const name of SY.SYNTH_NAMES) {
      const x: Float32Array = SY.synthesize(name, SR);
      expect(x.length, name).toBeGreaterThan(SR * 0.02);
      let peak = 0; for (const v of x) { expect(Number.isFinite(v), name).toBe(true); peak = Math.max(peak, Math.abs(v)); }
      expect(peak, `${name} peak`).toBeLessThanOrEqual(1);
      expect(peak, `${name} is audible`).toBeGreaterThan(0.3);
      expect(rms(x), `${name} has body, not one spike`).toBeGreaterThan(0.01);
      if (!SY.SYNTH_RECIPES[name].loop) {
        expect(Math.abs(x[0]), `${name} starts at silence`).toBeLessThan(0.01);
        expect(Math.abs(x[x.length - 1]), `${name} ends at silence`).toBeLessThan(0.01);
      }
    }
  });

  it('each lasts as long as its kind: a shot is short, a cue is quick, thunder rolls', () => {
    const secs = (n: string) => SY.synthesize(n, SR).length / SR;
    for (const n of ['shoot', 'hit', 'impact', 'jump', 'land', 'step', 'click', 'empty']) expect(secs(n), n).toBeLessThan(0.5);
    for (const n of ['pickup', 'coin', 'combo', 'newbest', 'levelup', 'achievement']) expect(secs(n), n).toBeLessThan(1.3);
    expect(secs('thunder')).toBeGreaterThan(2.5);
    expect(secs('explosion')).toBeGreaterThan(secs('shoot'));
    expect(secs('boss_die')).toBeGreaterThan(secs('explosion'));
    for (const n of SY.SYNTH_NAMES) expect(secs(n), n).toBeLessThanOrEqual(4.6);
  });

  it('pitch moves the right way: a jump rises, a death falls, an explosion sits low', () => {
    const half = (n: string) => { const x = SY.synthesize(n, SR); const k = Math.floor(x.length * 0.45); return [crossings(x, 0, k), crossings(x, k, Math.floor(x.length * 0.9))]; };
    const [j0, j1] = half('jump'); expect(j1).toBeGreaterThan(j0 * 1.4);
    const [d0, d1] = half('die'); expect(d1).toBeLessThan(d0 * 0.8);
    const boom = SY.synthesize('explosion', SR), shot = SY.synthesize('shoot', SR);
    expect(crossings(boom, 0, Math.floor(SR * 0.3))).toBeLessThan(crossings(shot, 0, Math.floor(SR * 0.1)));
  });

  it('the same name gives the same sound, and an unknown name gives none', () => {
    expect(Array.from(SY.synthesize('hit', SR))).toEqual(Array.from(SY.synthesize('hit', SR)));
    expect(SY.synthesize('no-such-sound', SR)).toBeNull();
  });

  it('a loop (rain, wind) is exactly its length and seamless at the join', () => {
    for (const name of ['rain', 'wind']) {
      const x: Float32Array = SY.synthesize(name, SR);
      expect(x.length, name).toBe(Math.round(SY.SYNTH_RECIPES[name].loop * SR));
      let typical = 0; for (let i = 1; i < x.length; i++) typical = Math.max(typical, Math.abs(x[i] - x[i - 1]));
      expect(Math.abs(x[0] - x[x.length - 1]), `${name}: the wrap is no bigger than any step inside it`).toBeLessThanOrEqual(typical);
      // Steady: no quarter of the loop is near-silent (that would pulse every few seconds).
      const q = Math.floor(x.length / 4);
      for (let k = 0; k < 4; k++) expect(rms(x, k * q, (k + 1) * q), `${name} quarter ${k}`).toBeGreaterThan(rms(x) * 0.35);
    }
  });
});

describe('the audio manager plays the voice when there is no file', () => {
  it('THE BUG: play("shoot") with nothing loaded now starts a sound', () => {
    const a = new AU.AudioManager();
    started.length = 0;
    a.play('shoot');
    expect(started).toHaveLength(1);
    expect(started[0].length).toBeGreaterThan(1000);
    expect(started[0].sampleRate).toBe(48000);          // rendered at the context's own rate
    expect(a.has('shoot')).toBe(true);
    expect(a.has('no-such-sound')).toBe(false);
    a.play('no-such-sound');
    expect(started).toHaveLength(1);                    // an unknown name stays quiet — and says nothing played
  });

  it('a file loaded under the same name wins over the built-in voice', async () => {
    const a = new AU.AudioManager();
    (globalThis as any).fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(8) });
    await a.load('shoot', '/sfx/shoot.mp3');
    started.length = 0;
    a.play('shoot');
    expect(started[0].length).toBe(10);                 // the decoded file, not the 0.2 s voice
    delete (globalThis as any).fetch;
  });

  it('a voice is rendered once and reused; a loop hands back its stop', () => {
    const a = new AU.AudioManager();
    started.length = 0;
    a.play('hit'); a.play('hit');
    expect(started[0]).toBe(started[1]);
    const stop = a.play('rain', 'sfx', { loop: true });
    expect(typeof stop).toBe('function');
    stop(); stop();                                     // stopping twice is harmless
  });

  it('the feedback table puts rewards on the UI bus and covers the weapon cycle', () => {
    const table = fx['src/game/fx/feedback.ts'];
    for (const ev of ['NEW_BEST', 'LEVEL_UP', 'ACHIEVEMENT_UNLOCKED', 'COMBO_MILESTONE']) expect(table).toMatch(new RegExp(ev + ":\\s*\\{[^}]*category: 'ui'"));
    for (const ev of ['WEAPON_EMPTY', 'WEAPON_RELOADED', 'MELEE_SWING', 'MELEE_HIT']) expect(table).toMatch(new RegExp(ev + ':\\s*\\{[^}]*sound:'));
    expect(table).toContain("audio.play(spec.sound, spec.category ?? 'sfx'");
  });
});
