/**
 * ✨ ANY EFFECT THE USER IMAGINES IS DRAWN BY THE KIT (admin 2026-11-24: "navbharatai api call se user ki sabhi ulti sidhi
 * imagination ko real banaye"). Class: the particles could only play nine fixed presets; "aag ka bawandar" had no form. Now an
 * effect is a checked ParticleSpec saved as src/game/effects/<name>.ts, which the kit reads by itself, and compose_effect
 * designs one with ONE model call. Runs the REAL kit file.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { composeEffect, effectPrompt, KIT_EFFECTS, validateEffect } from '../src/server/AgentV3/gameAssets/composeEffect';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-any-effect-${process.pid}`);
let P: any;
beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGameVfxAudio(['particles']).files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  const made = await composeEffect('fire tornado', 'a spinning column of fire', async () => ({ text: '{"name":"fire tornado","count":80,"color":"#fff1a8","colorEnd":"#d0350a","size":0.4,"sizeEnd":0.05,"life":1.2,"speed":6,"spread":1,"gravity":4,"additive":true}' }));
  if (made.kind !== 'made') throw new Error('compose');
  mkdirSync(dirname(join(DIR, made.path)), { recursive: true }); writeFileSync(join(DIR, made.path), made.source);
  P = await import(join(DIR, 'src/game/fx/particles.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('the kit plays an effect the user imagined', () => {
  it('🔴 "aag ka bawandar": the saved effect file is read by itself and burst by its name, with its own particle count', () => {
    expect(P.effectNames()).toContain('fire-tornado');
    const ps = new P.ParticleSystem();
    ps.burst('fire-tornado', 0, 1, 0);
    expect(ps.activeCount).toBe(80);
  });
  it('registerEffect works from code; an unknown name plays impact (never nothing)', () => {
    expect(P.registerEffect('rainbow trail', { count: 30, color: 0xff00ff, size: 0.2, life: 0.8, speed: 2, spread: 1, gravity: 0, additive: true })).toBe(true);
    const ps = new P.ParticleSystem();
    ps.burst('rainbow-trail', 0, 0, 0);
    expect(ps.activeCount).toBe(30);
    ps.burst('no-such-effect', 0, 0, 0);
    expect(ps.activeCount).toBe(30 + 18); // impact
    expect(P.registerEffect('bad', { count: 5 })).toBe(false);
  });
  it('census: the server\'s list of kit effects is exactly the kit\'s presets', () => {
    const src = generateGameVfxAudio(['particles']).files['src/game/fx/particles.ts'];
    const kit = [...src.matchAll(/^\s+(\w+):\s+\{ count:/gm)].map((m) => m[1]);
    expect(kit.sort()).toEqual([...KIT_EFFECTS].sort());
  });
});

describe('compose_effect', () => {
  it('a kit effect asks no model', async () => {
    let asked = 0;
    expect(await composeEffect('Smoke', '', async () => { asked++; return null; })).toEqual({ kind: 'library', name: 'smoke' });
    expect(asked).toBe(0);
  });
  it('a new one is designed, clamped to what a phone can draw, and written', async () => {
    let prompt = '';
    const made = await composeEffect('poison cloud', 'green and slow', async (p) => { prompt = p; return { text: '{"count":5000,"color":"#33ff66","size":9,"life":30,"speed":1,"spread":2,"gravity":0.5}' }; });
    expect(prompt).toBe(effectPrompt('poison-cloud', 'green and slow'));
    expect(made.kind).toBe('made');
    if (made.kind !== 'made') return;
    expect(made.spec).toMatchObject({ name: 'poison-cloud', count: 200, size: 3, life: 5, color: 0x33ff66, additive: false });
    expect(made.path).toBe('src/game/effects/poison-cloud.ts');
    expect(made.source).toContain("ctx.particles.burst('poison-cloud', x, y, z)");
  });
  it('no answer or no colour is refused; nothing guessed', async () => {
    expect((await composeEffect('x', '', async () => null)).kind).toBe('refused');
    expect((await composeEffect('x', '', async () => ({ text: '{"count":5}' }))).kind).toBe('refused');
    expect(validateEffect({ name: 'a', color: 'red', count: 1, size: 1, life: 1, speed: 1, spread: 1, gravity: 0 })).toBeNull();
  });
  it('the builder is told', () => {
    expect(generateGameShell(['game']).instructions).toMatch(/compose_effect/);
  });
});
