// THE GAME HAS MUSIC, AND IT FOLLOWS THE GAME (admin 2026-11-19 game-gap audit, P1: the music bus and the music volume
// slider existed and nothing ever played on them). These run the REAL generated fx/music.ts, fx/audio.ts and
// fx/feedback.ts against a recording AudioContext: moods are written by code and loop without a seam, the start screen
// is calm, play is action, a boss is tense, a win/loss gets its sting, a pause or a conversation lowers it — and the
// shell announces the start screen even when the status was already 'menu'.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

const DIR = join(__dirname, `.tmp-music-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let MUSIC: any; let AUDIO: any; let FB: any; let EV: any; let STATE: any;

class Param { value = 1; setValueAtTime(v: number) { this.value = v; } linearRampToValueAtTime(v: number) { this.value = v; } setTargetAtTime(v: number) { this.value = v; } cancelScheduledValues() { /* none */ } }
const sources: any[] = [];
class FakeCtx {
  sampleRate = 8000; currentTime = 0; destination = {}; listener = {};
  createGain() { return { gain: new Param(), connect: (n: unknown) => n }; }
  createBufferSource() {
    const s: any = { buffer: null, loop: false, detune: new Param(), started: false, stoppedAt: null, onended: null, connect: (n: unknown) => n,
      start() { s.started = true; }, stop(t = 0) { s.stoppedAt = t; } };
    sources.push(s); return s;
  }
  createBuffer(_c: number, len: number) { const d = new Float32Array(len); return { length: len, getChannelData: () => d }; }
  createPanner() { return { connect: (n: unknown) => n, positionX: new Param(), positionY: new Param(), positionZ: new Param() }; }
  resume() { return Promise.resolve(); }
}

beforeAll(async () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  (globalThis as any).window = { AudioContext: FakeCtx, addEventListener() {}, removeEventListener() {} };
  for (const r of [generateGameRuntime(), generateGameVfxAudio()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  MUSIC = await import(join(DIR, 'src/game/fx/music.ts'));
  AUDIO = await import(join(DIR, 'src/game/fx/audio.ts'));
  FB = await import(join(DIR, 'src/game/fx/feedback.ts'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  STATE = await import(join(DIR, 'src/game/core/state.ts'));
}, 60_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).window; delete (globalThis as any).localStorage; });

describe('🎼 music written by code', () => {
  const SR = 8000;
  it('every mood renders: audible, never clipping, deterministic', () => {
    for (const mood of MUSIC.MUSIC_MOODS) {
      const a = MUSIC.renderMusic(mood, SR);
      expect(a, mood).not.toBeNull();
      let peak = 0, energy = 0;
      for (const v of a) { peak = Math.max(peak, Math.abs(v)); energy += v * v; }
      expect(peak, mood).toBeGreaterThan(0.3);
      expect(peak, mood).toBeLessThanOrEqual(1);
      expect(Math.sqrt(energy / a.length), mood).toBeGreaterThan(0.02);
      expect(MUSIC.renderMusic(mood, SR)).toEqual(a);
    }
    expect(MUSIC.renderMusic('nope', SR)).toBeNull();
    expect(MUSIC.renderMusic('calm', 0)).toBeNull();
  });
  it('a loop is exactly its bars long and joins without a click; a sting is short and rings out', () => {
    const action = MUSIC.renderMusic('action', SR);
    expect(action.length).toBe(Math.round(8 * 4 * (60 / 128) * SR));     // 8 bars at 128 bpm
    const seam = Math.abs(action[0] - action[action.length - 1]);
    let typical = 0;
    for (let i = 1; i < action.length; i++) typical += Math.abs(action[i] - action[i - 1]);
    typical /= action.length - 1;
    expect(seam).toBeLessThan(typical * 4);       // no click: the join is no bigger than an ordinary step
    expect(MUSIC.musicLoops('action')).toBe(true);
    expect(MUSIC.musicLoops('victory')).toBe(false);
    const sting = MUSIC.renderMusic('victory', SR);
    expect(sting.length / SR).toBeLessThan(6);
  });
  it('the moods are different music: each at its own tempo, and not the same signal', () => {
    const calm = MUSIC.renderMusic('calm', SR), action = MUSIC.renderMusic('action', SR), tense = MUSIC.renderMusic('tense', SR);
    expect(calm.length).toBe(Math.round(8 * 4 * (60 / 84) * SR));
    expect(tense.length).toBe(Math.round(4 * 4 * (60 / 140) * SR));
    const corr = (x: Float32Array, y: Float32Array) => {
      const n = Math.min(x.length, y.length); let xy = 0, xx = 0, yy = 0;
      for (let i = 0; i < n; i++) { xy += x[i] * y[i]; xx += x[i] * x[i]; yy += y[i] * y[i]; }
      return xy / Math.sqrt(xx * yy);
    };
    expect(Math.abs(corr(calm, action))).toBeLessThan(0.3);
    expect(Math.abs(corr(action, tense))).toBeLessThan(0.3);
  });
});

describe('🔊 the audio manager plays one track at a time', () => {
  it('crossfades to a new mood, keeps the same mood going, ducks, and stopAll silences it', () => {
    const a = new AUDIO.AudioManager();
    a.playMusic('calm');
    expect(a.musicName).toBe('calm');
    const calm = sources.at(-1);
    expect(calm.started).toBe(true);
    expect(calm.loop).toBe(true);
    const n = sources.length;
    a.playMusic('calm');
    expect(sources.length).toBe(n);                 // no restart
    a.playMusic('action');
    expect(a.musicName).toBe('action');
    expect(calm.stoppedAt).not.toBeNull();          // faded out and stopped
    a.playMusic('victory');
    expect(sources.at(-1).loop).toBe(false);        // a sting plays once
    a.duckMusic(true); expect(a.musicDucked).toBe(true);
    a.duckMusic(false); expect(a.musicDucked).toBe(false);
    a.playMusic('not-a-mood');
    expect(a.musicName).toBe('victory');
    a.stopAll();
    expect(a.musicName).toBeNull();
  });
});

describe('🎬 the music follows the game', () => {
  it('menu → calm, play → action, pause ducks, resume restores, boss → tense, talk ducks, win → victory, loss → defeat', () => {
    const off = FB.bindGameFeedback({});
    const music = () => [AUDIO.audio.musicName, AUDIO.audio.musicDucked];
    EV.events.emit('GAME_MENU'); expect(music()).toEqual(['calm', false]);
    EV.events.emit('GAME_STARTED'); expect(music()).toEqual(['action', false]);
    EV.events.emit('GAME_PAUSED'); expect(music()).toEqual(['action', true]);
    EV.events.emit('GAME_RESUMED'); expect(music()).toEqual(['action', false]);
    EV.events.emit('BOSS_SPAWNED'); expect(music()).toEqual(['tense', false]);
    EV.events.emit('DIALOGUE_STARTED'); expect(music()[1]).toBe(true);
    EV.events.emit('DIALOGUE_ENDED'); expect(music()[1]).toBe(false);
    EV.events.emit('BOSS_DEFEATED'); expect(music()[0]).toBe('action');
    EV.events.emit('GAME_WON'); expect(music()[0]).toBe('victory');
    EV.events.emit('GAME_STARTED'); EV.events.emit('GAME_OVER'); expect(music()[0]).toBe('defeat');
    off();
    expect(AUDIO.audio.musicName).toBeNull();       // unbinding fades it out
  });
  it('the real status changes drive it (setStatus), and music: false means none; a table changes a cue', () => {
    let off = FB.bindGameFeedback({ music: { GAME_STARTED: 'tense' } });
    STATE.setStatus('playing'); expect(AUDIO.audio.musicName).toBe('tense');
    STATE.setStatus('paused'); expect(AUDIO.audio.musicDucked).toBe(true);
    STATE.setStatus('playing'); expect(AUDIO.audio.musicDucked).toBe(false);
    off();
    STATE.setStatus('menu');
    off = FB.bindGameFeedback({ music: false });
    STATE.setStatus('playing');
    expect(AUDIO.audio.musicName).toBeNull();
    off();
  });
});

describe('the shell announces the start screen even from an already-menu status', () => {
  const game = generateGameShell().files['src/game/Game.ts'];
  it('start() and toMenu() emit GAME_MENU when the status is already menu (resetRun sets it silently)', () => {
    const start = game.slice(game.indexOf('  start(): void {'), game.indexOf('  play(): void {'));
    const toMenu = game.slice(game.indexOf('  toMenu(): void {'));
    expect(start).toMatch(/if \(state\.status === 'menu'\) events\.emit\('GAME_MENU'\); else setStatus\('menu'\);/);
    expect(toMenu.slice(0, 800)).toMatch(/if \(state\.status === 'menu'\) events\.emit\('GAME_MENU'\); else setStatus\('menu'\);/);
    expect(game).toMatch(/music: options\.music as FeedbackContext\['music'\],/);
  });
});
