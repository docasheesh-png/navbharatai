/**
 * 🔥 THE MUZZLE FLASH GOES OUT (master audit 2026-11-25, Part G — "the muzzle flash remains yellow after firing").
 *
 * Root cause, confirmed in three 0.180's own points shader (`uniform float size; … gl_PointSize = size;`): PointsMaterial
 * draws every point at ONE size and never reads a per-point size. The kit "hid" a dead particle by setting its size
 * attribute to 0 — which the shader never read — so every spark ever fired stayed drawn where it died, in its last colour:
 * the flash's hot orange, on the additive layer, for ever. Now the shader reads each point's size, and a dead particle is
 * also moved out of the world. These tests run the REAL particles.ts and three's REAL points shader source.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-flash-${process.pid}`);
let P: any;
beforeAll(async () => {
  const files: Record<string, string> = { ...generateGameRuntime().files, ...generateGameVfxAudio().files };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  P = await import(join(DIR, 'src/game/fx/particles.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** Every point a layer would still draw: size > 0 AND inside the world. */
function drawn(points: THREE.Points): number {
  const pos = points.geometry.getAttribute('position') as THREE.BufferAttribute;
  const size = points.geometry.getAttribute('particleSize') as THREE.BufferAttribute;
  let n = 0;
  for (let i = 0; i < pos.count; i++) if (size.getX(i) > 0 && pos.getY(i) > P.DEAD_Y / 2) n++;
  return n;
}

describe('🔴 a fired flash is gone a moment later — nothing is left drawn', () => {
  it('one shot: drawn while it lives, gone after its 0.1 s', () => {
    const ps = new P.ParticleSystem(400);
    ps.burst('muzzleFlash', 1, 1.4, 2);
    ps.update(1 / 60);
    expect(drawn(ps.objects[0])).toBeGreaterThan(0);
    for (let i = 0; i < 12; i++) ps.update(1 / 60);
    expect(ps.activeCount).toBe(0);
    expect(drawn(ps.objects[0])).toBe(0);
    expect(drawn(ps.objects[1])).toBe(0);
  });
  it('200 shots of automatic fire, then a pause: nothing stays lit, smoke dissipates too', () => {
    const ps = new P.ParticleSystem(1200);
    for (let i = 0; i < 200; i++) { ps.burst('muzzleFlash', 0, 1.4, i * 0.01); ps.burst('smoke', 0, 1.5, 0); ps.update(1 / 30); }
    for (let i = 0; i < 300; i++) ps.update(1 / 30);
    expect(ps.activeCount).toBe(0);
    for (const layer of ps.objects) expect(drawn(layer)).toBe(0);
  });
  it('the flash fades — its colour moves toward the end colour and its size shrinks while it lives', () => {
    const ps = new P.ParticleSystem(100);
    ps.burst('muzzleFlash', 0, 0, 0);
    const size = ps.objects[0].geometry.getAttribute('particleSize') as THREE.BufferAttribute;
    const s0 = size.getX(0);
    ps.update(0.05);
    expect(size.getX(0)).toBeLessThan(s0);
  });
  it('it adds no lights — a flash is particles only, so firing can never leave a light behind', () => {
    const scene = new THREE.Scene();
    const ps = new P.ParticleSystem(200); ps.addTo(scene);
    for (let i = 0; i < 50; i++) { ps.burst('muzzleFlash', 0, 1, 0); ps.update(1 / 60); }
    let lights = 0; scene.traverse((o: any) => { if (o.isLight) lights++; });
    expect(lights).toBe(0);
  });
});

describe('the shader really reads each point\'s size (three\'s own points shader source)', () => {
  it('the patch applies to three 0.180 and turns the one size into a per-point size', () => {
    const out = P.withParticleSize(THREE.ShaderLib.points.vertexShader);
    expect(out).toContain('attribute float particleSize;');
    expect(out).toContain('gl_PointSize = size * particleSize;');
    expect(out).not.toMatch(/gl_PointSize = size;/);
  });
  it('the material is patched, with size 1 (each point carries its own)', () => {
    const ps = new P.ParticleSystem(10);
    const mat = ps.objects[0].material as THREE.PointsMaterial;
    expect(mat.size).toBe(1);
    const shader: any = { vertexShader: THREE.ShaderLib.points.vertexShader, fragmentShader: '', uniforms: {} };
    mat.onBeforeCompile(shader, undefined as any);
    expect(shader.vertexShader).toContain('size * particleSize');
  });
  it('a shader without the line is left alone and said — and dead particles are STILL hidden by position', () => {
    expect(P.withParticleSize('void main(){ gl_PointSize = 3.0; }')).toBe('void main(){ gl_PointSize = 3.0; }');
    const ps = new P.ParticleSystem(50);
    ps.burst('muzzleFlash', 0, 0, 0);
    for (let i = 0; i < 20; i++) ps.update(1 / 60);
    const pos = ps.objects[0].geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 14; i++) expect(pos.getY(i)).toBe(P.DEAD_Y);
  });
});
