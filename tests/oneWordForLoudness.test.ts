// ONE WORD FOR LOUDNESS ACROSS THE GAME KIT (admin 2026-11-20, game audit 2, item #7). failedbr #2435 spent three turns
// on `TS2353 'volume' does not exist in type 'PlayOptions'`: the sound effects (audio.play) and the music (playMusic)
// take `volume`, but the melody player's own PlayOptions said `gain`. It now takes `volume` too (gain still works).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateMelody } from '../src/server/lib/MelodyGenerator';

const DIR = join(__dirname, `.tmp-loudness-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let M: any; let TUNES: any;
class Param { value = 1; setValueAtTime(v: number) { this.value = v; } linearRampToValueAtTime(v: number) { this.value = v; } exponentialRampToValueAtTime(v: number) { this.value = v; } setTargetAtTime(v: number) { this.value = v; } cancelScheduledValues() { /* none */ } }
class FakeCtx {
  currentTime = 0; sampleRate = 44100; destination = {}; state = 'running';
  createGain() { return { gain: new Param(), connect: (n: unknown) => n, disconnect() {} }; }
  createOscillator() { return { type: 'sine', frequency: new Param(), detune: new Param(), connect: (n: unknown) => n, start() {}, stop() {}, disconnect() {}, onended: null }; }
  resume() { return Promise.resolve(); }
}

beforeAll(async () => {
  (globalThis as any).window = { AudioContext: FakeCtx, addEventListener() {}, removeEventListener() {} };
  for (const [p, c] of Object.entries(generateMelody().files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  M = await import(join(DIR, 'src/audio/melody.ts'));
  TUNES = (await import(join(DIR, 'src/audio/tunes.ts'))).TUNES;
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).window; });

function heard(options: any): number[] {
  const levels: number[] = [];
  class Spy extends M.MelodyPlayer { setVolume(v: number) { levels.push(v); super.setVolume(v); } }
  const p = new Spy();
  (p as any).unlock?.();
  const tune = Object.values(TUNES)[0];
  expect(p.play(tune, options)?.notes.length).toBeGreaterThan(0);
  (p as any).stop?.();
  return levels;
}

describe('🔊 the melody player speaks the kit\'s word for loudness', () => {
  it('🔴 volume — the word audio.play and playMusic use — sets the level', () => {
    expect(heard({ volume: 0.3 })).toContain(0.3);
  });
  it('gain still works, and volume wins when both are given', () => {
    expect(heard({ gain: 0.4 })).toContain(0.4);
    const both = heard({ volume: 0.2, gain: 0.9 });
    expect(both).toContain(0.2);
    expect(both).not.toContain(0.9);
  });
  it('the emitted type declares volume, so `{ volume }` type-checks', () => {
    expect(generateMelody().files['src/audio/melody.ts']).toMatch(/\n\s*volume\?: number;/);
  });
});
