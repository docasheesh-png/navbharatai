// THE WORLD HAS A DAY, AND WEATHER (2026-10-05, the game-engine taxonomy: sky, weather, world systems).
//
// Every NavBharatAI 3D game was lit by ONE fixed preset: the same noon (or the same sunset) for ever, no
// clouds, no rain, no night. atmosphere.ts runs a clock and the weather over the lights applyLighting made.
// These tests drive the GENERATED module with real three.js through a whole day and every weather.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';

const DIR = join(__dirname, `.tmp-game3d-atmo-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let A: any; let L: any;

beforeAll(async () => {
  for (const r of [generateGame3D(['atmosphere']), generateGameRuntime()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  A = await import(join(DIR, 'src/game/three/atmosphere.ts'));
  L = await import(join(DIR, 'src/game/three/lighting.ts'));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); });

function world(opts: Record<string, unknown> = {}) {
  const scene = new THREE.Scene();
  const renderer = { toneMappingExposure: 1 } as unknown as THREE.WebGLRenderer;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  camera.position.set(0, 2, 10);
  const lighting = L.applyLighting(scene, renderer, 'day');
  const atmo = A.createAtmosphere({ scene, renderer, camera, lighting, reflections: false, dayLength: 0, ...opts });
  return { scene, renderer, camera, lighting, atmo };
}
const run = (atmo: any, seconds: number, dt = 1 / 30) => { for (let i = 0; i < Math.round(seconds / dt); i++) atmo.update(dt); };
const elevation = (w: any) => w.lighting.key.position.clone().sub(w.lighting.key.target.position).normalize().y;

describe('the clock and the sun', () => {
  it('runs at dayLength seconds a day, wraps at midnight, and stops at dayLength 0', () => {
    const w = world({ hour: 23, dayLength: 240 });      // 10 real seconds = 1 hour
    run(w.atmo, 15);
    expect(w.atmo.hour).toBeCloseTo(0.5, 1);          // past midnight, wrapped to the small side
    run(w.atmo, 25);
    expect(w.atmo.hour).toBeCloseTo(3, 1);
    w.atmo.dayLength = 0; run(w.atmo, 30);
    expect(w.atmo.hour).toBeCloseTo(3, 1);
  });

  it('the sun rises in the east, is high at noon, sets in the west; at night the key is a dim blue moon', () => {
    const at = (h: number) => { const w = world({ hour: h }); return w; };
    const m8 = at(8), noon = at(12), e16 = at(16), mid = at(0);
    expect(m8.lighting.key.position.x).toBeGreaterThan(m8.lighting.key.target.position.x);
    expect(e16.lighting.key.position.x).toBeLessThan(e16.lighting.key.target.position.x);
    expect(elevation(noon)).toBeGreaterThan(0.85);
    expect(elevation(mid), 'the moon is UP at midnight — the key never lights from below').toBeGreaterThan(0.5);
    expect(mid.lighting.key.intensity).toBeLessThan(noon.lighting.key.intensity * 0.3);
    expect(mid.lighting.key.color.b).toBeGreaterThan(mid.lighting.key.color.r);
  });

  it('daylight and light levels follow the day: night < dawn < morning < noon', () => {
    const level = (h: number) => world({ hour: h }).lighting.key.intensity;
    expect(level(2)).toBeLessThan(level(6));
    expect(level(6)).toBeLessThan(level(8));
    expect(level(8)).toBeLessThan(level(12));
    expect(world({ hour: 12 }).atmo.daylight).toBeCloseTo(1, 1);
    expect(world({ hour: 1 }).atmo.daylight).toBeCloseTo(0, 2);
  });

  it('the sky shows the colours it was given — converted to linear ONCE (a double conversion made sunsets blood-red)', () => {
    const w = world({ hour: 12 });
    const u = (w.atmo.sky.material as THREE.ShaderMaterial).uniforms;
    const want = new THREE.Color(0xbfd9f2);              // noon's horizon, as authored
    const got = u.uHorizon.value as THREE.Color;
    for (const ch of ['r', 'g', 'b'] as const) expect(got[ch]).toBeCloseTo(want[ch], 2);
    expect((w.atmo.sky.material as THREE.ShaderMaterial).fragmentShader).toContain('#include <colorspace_fragment>');
  });

  it('a sunset is orange and a dawn is warm', () => {
    const k = world({ hour: 18.3 }).lighting.key.color;
    expect(k.r).toBeGreaterThan(k.g * 1.4);
    expect(k.r).toBeGreaterThan(k.b * 2);
    const d = world({ hour: 6 }).lighting.key.color;
    expect(d.r).toBeGreaterThan(d.b);
  });

  it('announces dawn, day, dusk and night — once each, in order', () => {
    const w = world({ hour: 3, dayLength: 120 });
    const seen: string[] = [];
    w.atmo.onPhase = (p: string) => seen.push(p);
    run(w.atmo, 120, 1 / 20);
    expect(seen).toEqual(['dawn', 'day', 'dusk', 'night']);
  });
});

describe('the fog is the horizon, always', () => {
  it('at every hour and in every weather the fog colour equals the sky\'s horizon (no seam where the world ends)', () => {
    for (const weather of ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'dust']) {
      for (const hour of [0, 5.5, 6.5, 9, 12, 17, 18.5, 19.5, 22]) {
        const w = world({ hour, weather });
        const horizon = (w.atmo.sky.material as THREE.ShaderMaterial).uniforms.uHorizon.value as THREE.Color;
        const fog = w.scene.fog as THREE.Fog;
        expect(fog.color.equals(horizon), `${weather} at ${hour}`).toBe(true);
        expect(fog.far).toBeGreaterThan(fog.near);
      }
    }
  });
});

describe('weather', () => {
  it('blends in over its time: dimmer light, closer fog, rain falling', () => {
    const w = world({ hour: 12 });
    const clear = w.lighting.key.intensity, far = (w.scene.fog as THREE.Fog).far;
    const heard: string[] = []; w.atmo.onWeather = (k: string) => heard.push(k);
    w.atmo.setWeather('rain', 4);
    expect(heard).toEqual(['rain']);
    run(w.atmo, 2);
    const mid = w.lighting.key.intensity;
    expect(mid).toBeLessThan(clear);
    run(w.atmo, 3);
    expect(w.lighting.key.intensity).toBeLessThan(mid);
    expect(w.lighting.key.intensity).toBeCloseTo(clear * 0.35, 1);
    expect((w.scene.fog as THREE.Fog).far).toBeLessThan(far * 0.7);
    const rain = w.scene.getObjectByName('atmosphere-rain') as THREE.LineSegments;
    expect(rain.visible).toBe(true);
    expect((rain.material as THREE.ShaderMaterial).uniforms.uAmount.value).toBeGreaterThan(0.6);
    expect(w.scene.getObjectByName('atmosphere-snow')!.visible).toBe(false);
  });

  it('the road gets wet in the rain — darker and glossier — and dries after it', () => {
    const w = world({ hour: 12 });
    const road = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 });
    w.atmo.wet([road]);
    w.atmo.setWeather('rain', 1);
    run(w.atmo, 30);
    expect(w.atmo.wetness).toBeGreaterThan(0.95);
    expect(road.roughness).toBeLessThan(0.4);
    expect(road.color.r).toBeLessThan(new THREE.Color(0x555555).r * 0.8);
    w.atmo.setWeather('clear', 1);
    run(w.atmo, 90);
    expect(w.atmo.wetness).toBeLessThan(0.05);
    expect(road.roughness).toBeGreaterThan(0.85);
  });

  it('a storm strikes lightning every few seconds — flash, then thunder after distance / 343 — and the same seed repeats it', () => {
    const strikes = (seed: number) => {
      const w = world({ hour: 14, weather: 'storm', seed });
      const got: Array<[number, number]> = [];
      w.atmo.onLightning = (d: number, delay: number) => got.push([d, delay]);
      let peak = 0;
      for (let i = 0; i < 120 * 30; i++) { w.atmo.update(1 / 30); peak = Math.max(peak, w.atmo.flash); }
      return { got, peak, last: w.atmo.flash };
    };
    const a = strikes(3), b = strikes(3);
    expect(a.got.length).toBeGreaterThanOrEqual(8);
    expect(a.got.length).toBeLessThanOrEqual(40);
    for (const [d, delay] of a.got) { expect(d).toBeGreaterThanOrEqual(300); expect(delay).toBeCloseTo(d / 343, 6); }
    expect(a.got).toEqual(b.got);
    expect(a.peak).toBeGreaterThan(0.8);
    expect(world({ hour: 14, weather: 'rain' }).atmo.flash).toBe(0);
  });

  it('a flash lights the world for a moment and is gone within 0.6 s', () => {
    const w = world({ hour: 14, weather: 'storm', seed: 5 });
    let struck = false;
    w.atmo.onLightning = () => { struck = true; };
    while (!struck) w.atmo.update(1 / 60);
    const lit = w.renderer.toneMappingExposure;
    run(w.atmo, 0.7, 1 / 60);
    expect(w.atmo.flash).toBe(0);
    expect(w.renderer.toneMappingExposure).toBeLessThan(lit);
  });

  it('a storm sky is darker than a rainy one, which is darker than a clear one', () => {
    const lum = (weather: string) => { const c = (world({ hour: 14, weather }).atmo.sky.material as THREE.ShaderMaterial).uniforms.uTop.value as THREE.Color; return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722; };
    expect(lum('storm')).toBeLessThan(lum('rain') * 0.7);
    expect(lum('rain')).toBeLessThan(lum('cloudy'));
  });

  it('snow, fog and dust each look like themselves', () => {
    const snow = world({ hour: 12, weather: 'snow' });
    expect(snow.scene.getObjectByName('atmosphere-snow')!.visible).toBe(true);
    const fog = world({ hour: 12, weather: 'fog' });
    expect((fog.scene.fog as THREE.Fog).far).toBeLessThan((world({ hour: 12 }).scene.fog as THREE.Fog).far * 0.25);
    const dust = world({ hour: 12, weather: 'dust' });
    expect(dust.scene.getObjectByName('atmosphere-dust')!.visible).toBe(true);
    const h = (dust.scene.fog as THREE.Fog).color;
    expect(h.r).toBeGreaterThan(h.b);                   // a brown sky, not a blue one
  });
});

describe('the world reacts to the night', () => {
  it('a street lamp and a lit window are off by day and on at night', () => {
    const w = world({ hour: 12, dayLength: 240 });
    const lamp = new THREE.PointLight(0xffd28a, 3, 20);
    const windowMat = new THREE.MeshStandardMaterial({ emissive: 0xffc870 });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), windowMat);
    w.atmo.addNightLight(lamp);
    w.atmo.addNightLight(pane, 1.2);
    w.atmo.update(0);
    expect(lamp.intensity).toBe(0);
    expect(windowMat.emissiveIntensity).toBe(0);
    w.atmo.setHour(0); w.atmo.update(0);
    expect(lamp.intensity).toBeCloseTo(3, 5);
    expect(windowMat.emissiveIntensity).toBeCloseTo(1.2, 5);
    w.atmo.setHour(14); w.atmo.setWeather('storm', 0); w.atmo.update(0);
    expect(lamp.intensity, 'a dark storm afternoon switches the lamps on too').toBeGreaterThan(1);
  });

  it('the sky follows the camera and is drawn behind everything; dispose removes all of it', () => {
    const w = world({ hour: 12, weather: 'rain' });
    w.camera.position.set(120, 5, -40);
    w.atmo.update(1 / 60);
    expect(w.atmo.sky.position.x).toBeCloseTo(120, 5);
    expect(w.atmo.sky.renderOrder).toBeLessThan(0);
    expect(((w.atmo.sky.material as THREE.ShaderMaterial).vertexShader)).toContain('p.xyww');
    w.atmo.dispose();
    for (const n of ['atmosphere-sky', 'atmosphere-rain', 'atmosphere-snow', 'atmosphere-dust']) expect(w.scene.getObjectByName(n)).toBeUndefined();
  });

  it('lite draws a third of the rain', () => {
    const count = (detail: string) => (world({ hour: 12, detail }).scene.getObjectByName('atmosphere-rain') as THREE.LineSegments).geometry.getAttribute('aSeed').count;
    expect(count('lite') * 3).toBe(count('real'));
  });
});
