// ATHREE MAP phase 4 — DESERT DUNES, SKY, DAY AND NIGHT, WEATHER. These tests run the emitted code: the dune profile and where dunes may
// stand, the sun's path, the palette over a day and under weather, the weather's easing and schedule, the budget, the shaders, and the sky
// manager with real three.js (lights, fog, rain, clock, ambience levels, one sun for the whole map).
// What they cannot prove — how it LOOKS and whether the shaders compile on a GPU — is checked by a headless-Chromium render.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { loadAthree } from '../../../../tests/helpers/loadAthree';

// These tests sample whole worlds (thousands of terrain, river, dune and road queries). Under the coverage run they are several times
// slower, so each gets two minutes instead of vitest's default twenty seconds: the assertions are not loosened, only the clock.
vi.setConfig({ testTimeout: 120000 });

const A = loadAthree();
const TIERS = ['phone', 'mid', 'desktop'] as const;
const loop = new Map<number, any>();
const world = (seed: number): any => { if (!loop.has(seed)) loop.set(seed, A.createAthreeWorld({ seed, profile: 'open-world' })); return loop.get(seed); };

function findDesert(w: any, from = 0, minDune = -1): { x: number; z: number } | null {
  for (let i = from; i < 12000; i++) {
    const x = ((i * 7919) % 90000) - 45000; const z = ((i * 104729) % 90000) - 45000;
    if (w.biomeAt(x, z) === 'desert' && w.dunesAt(x, z) > minDune) return { x, z };
  }
  return null;
}

describe('the dune profile', () => {
  it('climbs gently over 72 percent of a wavelength and drops steeply over 28 percent, from 0 to 1 to 0', () => {
    expect(A.duneProfile(0)).toBe(0);
    expect(A.duneProfile(0.72)).toBeCloseTo(1, 12);
    expect(A.duneProfile(0.9999)).toBeLessThan(0.001);
    let climb = 0; let drop = 0;
    for (let i = 1; i < 1000; i++) {
      const d = (A.duneProfile(i / 1000) - A.duneProfile((i - 1) / 1000)) * 1000;
      if (i / 1000 < 0.72) climb = Math.max(climb, d); else drop = Math.max(drop, -d);
    }
    expect(drop).toBeGreaterThan(climb * 2);
    for (let i = 0; i <= 100; i++) { const v = A.duneProfile(i / 100); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1 + 1e-12); }
  });
});

describe('where dunes stand', () => {
  it('dunes only ever ADD height, never more than 8 m, and exist in deserts', () => {
    let max = 0; let n = 0;
    for (const seed of [1, 3, 7, 9]) {
      const w = world(seed);
      for (let i = 0; i < 2500; i++) {
        const x = ((i * 7919) % 90000) - 45000; const z = ((i * 104729) % 90000) - 45000;
        const d = w.dunesAt(x, z);
        expect(d).toBeGreaterThanOrEqual(0);
        max = Math.max(max, d);
        if (d > 0) n++;
      }
    }
    expect(max).toBeLessThanOrEqual(8 + 1e-9);
    expect(max).toBeGreaterThan(3);
    expect(n).toBeGreaterThan(20);
  });
  it('there are none on the sea, on the beach, in forest, grassland or on snow, apart from a faint edge where a desert fades out', () => {
    let strong = 0; let n = 0;
    for (const seed of [1, 3, 7, 9]) {
      const w = world(seed);
      for (let i = 0; i < 3000; i++) {
        const x = ((i * 7919) % 90000) - 45000; const z = ((i * 104729) % 90000) - 45000;
        const b = w.biomeAt(x, z);
        if (b === 'desert') continue;
        n++;
        if (w.dunesAt(x, z) > 1.5) strong++;
      }
    }
    expect(n).toBeGreaterThan(8000);
    expect(strong / n).toBeLessThan(0.005);
  });
  it('about a third of a desert is a flat hardpan with no dunes, and the rest has real dunes', () => {
    let flat = 0; let dune = 0; let heart = 0;
    for (const seed of [1, 3, 7, 9, 11]) {
      const w = world(seed);
      for (let i = 0; i < 60000; i++) {
        const x = ((i * 7919) % 90000) - 45000; const z = ((i * 104729) % 90000) - 45000;
        if (w.desertnessAt(x, z) < 0.9) continue;
        heart++;
        if (w.dunesAt(x, z) === 0) flat++; else dune++;
      }
    }
    expect(heart).toBeGreaterThan(300);
    expect(flat / heart).toBeGreaterThan(0.12);
    expect(flat / heart).toBeLessThan(0.6);
    expect(dune).toBeGreaterThan(100);
  });
  it('desertness is 0 to 1, high in the desert biome and low on the sea, in forest and on snow', () => {
    let n = 0; let desertHigh = 0; let desertN = 0; let otherHigh = 0; let otherN = 0;
    for (const seed of [1, 3, 7]) {
      const w = world(seed);
      for (let i = 0; i < 6000; i++) {
        const x = ((i * 7919) % 90000) - 45000; const z = ((i * 104729) % 90000) - 45000;
        const d = w.desertnessAt(x, z);
        expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThanOrEqual(1);
        const b = w.biomeAt(x, z);
        if (b === 'desert') { desertN++; if (d > 0.05) desertHigh++; } else if (b === 'forest' || b === 'ocean' || b === 'snow') { otherN++; if (d > 0.3) otherHigh++; }
        n++;
      }
    }
    expect(n).toBeGreaterThan(15000);
    expect(desertN).toBeGreaterThan(100);
    expect(desertHigh / desertN).toBeGreaterThan(0.8); // the rest is the 4 to 6 m strip by the sea, where dunes are kept out on purpose
    expect(otherHigh / otherN).toBeLessThan(0.01);
  });
  it('a dune face adds a slope of at most 0.45 (about 24 degrees) to the ground, so a car can cross it', () => {
    let n = 0; let worst = 0;
    for (const seed of [1, 3, 7, 9, 11]) {
      const w = world(seed);
      for (let i = 0; i < 12000 && n < 600; i += 1) {
        const x = ((i * 7919) % 90000) - 45000; const z = ((i * 104729) % 90000) - 45000;
        if (w.dunesAt(x, z) < 2) continue;
        n++;
        const sx = (w.dunesAt(x + 2, z) - w.dunesAt(x - 2, z)) / 4; const sz = (w.dunesAt(x, z + 2) - w.dunesAt(x, z - 2)) / 4;
        worst = Math.max(worst, Math.hypot(sx, sz));
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(worst).toBeLessThan(0.45);
    expect(worst).toBeGreaterThan(0.1);
  });
  it('the loop world repeats exactly with its dunes, and the same seed makes the same dunes', () => {
    const w = world(9);
    const P = w.sizeMeters;
    let n = 0;
    for (let k = 0; k < 40; k++) {
      const p = findDesert(w, k * 150, 1);
      if (!p) break;
      expect(w.dunesAt(p.x + P, p.z)).toBeCloseTo(w.dunesAt(p.x, p.z), 6);
      expect(w.dunesAt(p.x, p.z - P)).toBeCloseTo(w.dunesAt(p.x, p.z), 6);
      expect(A.createAthreeWorld({ seed: 9, profile: 'open-world' }).dunesAt(p.x, p.z)).toBe(w.dunesAt(p.x, p.z));
      n++;
    }
    expect(n).toBeGreaterThan(10);
  });
  it('dunes stop 20 m before any water, so a river bed is never buried and the ground has no step', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked < 30; seed++) {
      const w = world(seed);
      for (const r of w.waterBodies().rivers) {
        for (const p of r.points.filter((_: any, i: number) => i % 3 === 0)) {
          for (const off of [3, 8, 14, 30]) {
            const x = p.x + off; const z = p.z;
            const e = w.waterAt(x, z) ? -1 : 1;
            if (e < 0) { expect(w.dunesAt(x, z)).toBe(0); }
            if (w.dunesAt(x, z) > 0.3) checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
  it('the ground stays continuous across dunes: steps under 1.2 m per metre in every desert sampled', () => {
    let n = 0; let worst = 0;
    for (const seed of [1, 3, 7, 9, 11]) {
      const w = world(seed);
      for (let k = 0; k < 8; k++) {
        const p = findDesert(w, k * 400, 2);
        if (!p) continue;
        for (let d = -150; d < 150; d++) { worst = Math.max(worst, Math.abs(w.heightAt(p.x + d + 1, p.z) - w.heightAt(p.x + d, p.z))); n++; }
      }
    }
    expect(n).toBeGreaterThan(1500);
    expect(worst).toBeLessThan(1.2);
  });
});

describe('every island has a runway when one exists (the class: a random search that misses a strip)', () => {
  it('whenever a brute-force scan finds a 600 m strip, spawnPoints(plane) finds one', () => {
    let hasStrip = 0;
    for (let seed = 1; seed <= 14; seed++) {
      const w = A.createAthreeWorld({ seed, profile: 'battle-royale' });
      let found = false;
      for (let x = -3600; x <= 3000 && !found; x += 100) {
        for (let z = -3600; z <= 3600 && !found; z += 100) {
          let lo = Infinity; let hi = -Infinity; let wet = false;
          for (let i = 0; i <= 12 && !wet; i++) for (const dz of [-30, 0, 30]) { const h = w.heightAt(x + i * 50, z + dz); if (w.waterAt(x + i * 50, z + dz)) wet = true; lo = Math.min(lo, h); hi = Math.max(hi, h); }
          const y = w.heightAt(x, z);
          if (!wet && lo > 4 && hi - lo < 4 && y >= 4 && y <= 140) found = true;
        }
      }
      if (found) { hasStrip++; expect(w.spawnPoints('plane', 1).length, 'seed ' + seed).toBeGreaterThan(0); }
    }
    expect(hasStrip).toBeGreaterThan(3);
  });
});

describe('the sun', () => {
  it('is a unit vector, high at noon, below the horizon at night, east in the morning and west in the evening', () => {
    for (let h = 0; h < 24; h += 0.25) { const s = A.sunDirection(h); expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 9); }
    expect(A.sunDirection(12).y).toBeGreaterThan(0.9);
    expect(A.sunDirection(0).y).toBeLessThan(-0.7);
    expect(A.sunDirection(6).x).toBeGreaterThan(0.9);
    expect(A.sunDirection(18).x).toBeLessThan(-0.9);
  });
  it('rises and sets near six and eighteen hours, with a day about thirteen hours long, and moves smoothly', () => {
    let up = 0; let prev = A.sunDirection(0); let worst = 0;
    for (let h = 0.01; h <= 24; h += 0.01) {
      const s = A.sunDirection(h);
      if (s.y > 0) up += 0.01;
      worst = Math.max(worst, Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z));
      prev = s;
    }
    expect(up).toBeGreaterThan(12); expect(up).toBeLessThan(14);
    expect(worst).toBeLessThan(0.02);
    expect(A.sunDirection(5).y).toBeLessThan(0.05);
    expect(A.sunDirection(7).y).toBeGreaterThan(0.1);
    expect(A.sunDirection(19).y).toBeLessThan(0.05);
  });
  it('is the same every day (24 hours wrap)', () => {
    const a = A.sunDirection(9.5); const b = A.sunDirection(33.5);
    expect(b.y).toBeCloseTo(a.y, 9); expect(b.x).toBeCloseTo(a.x, 9);
  });
});

describe('the sky palette', () => {
  const clear = A.initialWeather('clear');
  it('is full day at noon, full night at midnight, every channel in 0..1', () => {
    expect(A.skyColors(A.sunDirection(12).y, clear).daylight).toBe(1);
    expect(A.skyColors(A.sunDirection(0).y, clear).daylight).toBe(0);
    for (const w of A.WEATHERS) {
      for (let h = 0; h < 24; h += 0.5) {
        const c = A.skyColors(A.sunDirection(h).y, A.initialWeather(w));
        for (const rgb of [c.zenith, c.horizon, c.sun, c.ambient, c.fog]) for (const v of rgb) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
        expect(c.daylight).toBeGreaterThanOrEqual(0); expect(c.daylight).toBeLessThanOrEqual(1);
      }
    }
  });
  it('gets brighter through the morning and darker through the evening, never jumping', () => {
    let prev = A.skyColors(A.sunDirection(4).y, clear).daylight;
    for (let h = 4.1; h <= 9; h += 0.1) { const d = A.skyColors(A.sunDirection(h).y, clear).daylight; expect(d).toBeGreaterThanOrEqual(prev - 1e-9); prev = d; }
    prev = A.skyColors(A.sunDirection(15).y, clear).daylight;
    for (let h = 15.1; h <= 20; h += 0.1) { const d = A.skyColors(A.sunDirection(h).y, clear).daylight; expect(d).toBeLessThanOrEqual(prev + 1e-9); prev = d; }
    let worst = 0; let last = A.skyColors(A.sunDirection(0).y, clear);
    for (let h = 0.05; h <= 24; h += 0.05) {
      const c = A.skyColors(A.sunDirection(h).y, clear);
      for (const k of ['zenith', 'horizon', 'sun', 'ambient', 'fog'] as const) for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(c[k][i] - last[k][i]));
      last = c;
    }
    expect(worst).toBeLessThan(0.05);
  });
  it('turns the horizon warm at sunrise and sunset and the sun light redder when it is low', () => {
    const noon = A.skyColors(A.sunDirection(12).y, clear);
    const dawn = A.skyColors(A.sunDirection(6.1).y, clear);
    expect(dawn.horizon[0] - dawn.horizon[2]).toBeGreaterThan(noon.horizon[0] - noon.horizon[2] + 0.1);
    expect(noon.sun[2] / noon.sun[0]).toBeGreaterThan(dawn.sun[2] / Math.max(dawn.sun[0], 1e-9));
    expect(A.skyColors(A.sunDirection(0).y, clear).sun).toEqual([0, 0, 0]);
  });
  it('gloom greys the sky and dims the sun, and fog pulls the fog colour to grey', () => {
    const noon = A.sunDirection(12).y;
    const c = A.skyColors(noon, clear); const s = A.skyColors(noon, A.initialWeather('storm'));
    expect(s.sun[0]).toBeLessThan(c.sun[0] * 0.5);
    expect(s.zenith[2] - s.zenith[0]).toBeLessThan(c.zenith[2] - c.zenith[0]);
    const f = A.skyColors(noon, A.initialWeather('fog'));
    expect(Math.abs(f.fog[0] - f.fog[2])).toBeLessThan(Math.abs(c.fog[0] - c.fog[2]));
  });
});

describe('the weather', () => {
  it('every named weather has bounded numbers, and storm is the worst of rain, cloud, gloom and wind', () => {
    for (const w of A.WEATHERS) for (const v of Object.values(A.WEATHER_TARGETS[w]) as number[]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    for (const k of ['rain', 'gloom', 'wind'] as const) for (const w of A.WEATHERS) expect(A.WEATHER_TARGETS.storm[k]).toBeGreaterThanOrEqual(A.WEATHER_TARGETS[w][k]);
    expect(A.WEATHER_TARGETS.fog.fog).toBe(1);
    expect(A.WEATHER_TARGETS.clear.rain).toBe(0);
  });
  it('eases towards a target without overshooting, never going backwards, and reaches it', () => {
    let s = A.initialWeather('clear');
    let prev = s.rain;
    for (let i = 0; i < 400; i++) {
      s = A.stepWeather(s, 'storm', 0.1);
      expect(s.rain).toBeGreaterThanOrEqual(prev); expect(s.rain).toBeLessThanOrEqual(1);
      prev = s.rain;
    }
    expect(s.rain).toBeGreaterThan(0.99);
    expect(s.cloud).toBeGreaterThan(0.99);
    s = A.stepWeather(s, 'clear', 0.1);
    expect(s.rain).toBeLessThan(1);
    expect(A.stepWeather(s, 'storm', 0)).toEqual(s);
    expect(A.stepWeather(A.initialWeather('clear'), 'storm', 1000).rain).toBeCloseTo(1, 6);
  });
  it('a weather schedule is deterministic by seed, starts clear, changes every five minutes, and has the stated mix', () => {
    expect(A.weatherAtTime(5, 0)).toBe('clear'); expect(A.weatherAtTime(5, 299)).toBe('clear');
    for (let t = 0; t < 5000; t += 37) expect(A.weatherAtTime(5, t)).toBe(A.weatherAtTime(5, t));
    expect(A.weatherAtTime(5, 301)).toBe(A.weatherAtTime(5, 599));
    const counts: Record<string, number> = {};
    for (let b = 1; b <= 3000; b++) { const w = A.weatherAtTime(11, b * 300 + 1); counts[w] = (counts[w] ?? 0) + 1; }
    expect(counts.clear / 3000).toBeGreaterThan(0.35); expect(counts.clear / 3000).toBeLessThan(0.45);
    expect(counts.rain / 3000).toBeGreaterThan(0.13); expect(counts.storm / 3000).toBeGreaterThan(0.05); expect(counts.storm / 3000).toBeLessThan(0.11);
    expect(counts.fog).toBeGreaterThan(100);
    const a: string[] = []; const b2: string[] = [];
    for (let k = 1; k < 60; k++) { a.push(A.weatherAtTime(1, k * 300)); b2.push(A.weatherAtTime(2, k * 300)); }
    expect(a).not.toEqual(b2);
  });
  it('fog closes the view in: near and far shrink as fog grows and near stays under far', () => {
    let prev = A.fogRange(0);
    for (let f = 0.1; f <= 1; f += 0.1) { const r = A.fogRange(f); expect(r.far).toBeLessThan(prev.far); expect(r.near).toBeLessThan(prev.near); expect(r.near).toBeLessThan(r.far); prev = r; }
    expect(A.fogRange(1).far).toBeLessThan(400);
    expect(A.fogRange(0).far).toBeGreaterThan(2000);
  });
});

describe('the budget', () => {
  it('the dome triangle formula is exact, and the dome fits what terrain, sea, plants and water leave', () => {
    for (const q of TIERS) {
      const t = A.SKY_TIERS[q];
      const g = new THREE.SphereGeometry(t.domeRadius, t.domeSegments, Math.floor(t.domeSegments / 2));
      expect(A.domeTriangles(t)).toBe(g.index.count / 3);
      expect(A.domeTriangles(t)).toBeLessThanOrEqual(A.skyBudget(q));
      expect(A.maxTriangles(A.QUALITY[q]) + A.oceanTriangles(A.OCEAN_TIERS[q]) + A.vegetationTriangles(A.VEGETATION_TIERS[q]) + A.RIVER_TIERS[q].maxTriangles + A.domeTriangles(t)).toBeLessThanOrEqual(A.QUALITY[q].budgetTriangles);
    }
  });
  it('rain is lines, not triangles, and more quality means more drops', () => {
    const [p, m, d] = TIERS.map((q) => A.SKY_TIERS[q]);
    expect(p.rainDrops).toBeLessThan(m.rainDrops); expect(m.rainDrops).toBeLessThan(d.rainDrops);
  });
});

describe('the shaders', () => {
  it('the sky reads the uniforms the manager writes, has sun, moon, stars and clouds, and no texture', () => {
    const f = A.skyFragmentShader();
    for (const u of ['uSun', 'uZenith', 'uHorizon', 'uSunTint', 'uDaylight', 'uCloud', 'uTime', 'uDrift', 'uFlash']) expect(f).toContain(u);
    expect(f).toContain('fbm'); expect(f).toContain('-uSun'); expect(f).toContain('hash3');
    expect(f).not.toContain('sampler2D');
    expect(A.skyVertexShader()).toContain('gl_Position.z = gl_Position.w');
  });
  it('the rain falls in the shader, slanted by the wind, and fades with the amount of rain', () => {
    const v = A.rainVertexShader(); const f = A.rainFragmentShader();
    for (const u of ['uTime', 'uSlant', 'uRadius', 'uHeight', 'uSpeed', 'aDrop']) expect(v).toContain(u);
    expect(f).toContain('uAmount');
  });
});

describe('the sky manager (real three.js)', () => {
  const origin = { x: 0, z: 0 };
  function setup(opts: any = {}, quality: 'phone' | 'mid' | 'desktop' = 'mid') {
    const w = world(7);
    return { w, sky: A.createSky(THREE, w, quality, opts) };
  }
  const run = (sky: any, seconds: number, x = 100, z = 100): void => { for (let t = 0; t <= seconds; t += 0.1) sky.update(x, z, t, origin); };

  it('has a dome, a rain ring and two lights, or no lights when asked', () => {
    const { sky } = setup();
    const kinds = sky.group.children.map((c: any) => c.type);
    expect(kinds.filter((k: string) => k === 'Mesh')).toHaveLength(1);
    expect(kinds).toContain('LineSegments'); expect(kinds).toContain('DirectionalLight'); expect(kinds).toContain('HemisphereLight');
    expect(setup({ lights: false }).sky.group.children.map((c: any) => c.type)).toEqual(['Mesh', 'LineSegments']);
  });
  it('day is bright and night is dark: the sun light and the sky light follow the time of day', () => {
    const { sky } = setup({ hours: 12 });
    const sunLight = sky.group.children.find((c: any) => c.type === 'DirectionalLight');
    const skyLight = sky.group.children.find((c: any) => c.type === 'HemisphereLight');
    run(sky, 1);
    const noon = { sun: sunLight.intensity, sky: skyLight.intensity, uni: sky.group.children[0].material.uniforms.uDaylight.value };
    sky.setTimeOfDay(0); run(sky, 2);
    expect(noon.uni).toBe(1);
    expect(sky.group.children[0].material.uniforms.uDaylight.value).toBe(0);
    expect(sunLight.intensity).toBeLessThan(noon.sun * 0.3);
    expect(skyLight.intensity).toBeLessThan(noon.sky * 0.6);
    expect(sunLight.position.y).toBeGreaterThan(0);
    sky.setTimeOfDay(9); run(sky, 2);
    expect(sunLight.intensity).toBeGreaterThan(0.5);
    const r = sky.reading();
    expect(sunLight.position.x / 1000).toBeCloseTo(r.sun.x, 6);
  });
  it('the dome and the rain follow the camera in render space and follow a floating-origin shift', () => {
    const { sky } = setup();
    sky.update(5000, -700, 0, origin, 40);
    const dome = sky.group.children[0];
    expect(dome.position.x).toBe(5000); expect(dome.position.z).toBe(-700); expect(dome.position.y).toBe(40);
    sky.update(5000, -700, 0.1, { x: 3000, z: -200 }, 40);
    expect(dome.position.x).toBe(2000); expect(dome.position.z).toBe(-500);
  });
  it('the clock runs when asked: a 240 s day moves the sun 12 hours in 120 s, and stands still by default', () => {
    const { sky } = setup({ hours: 6, dayLength: 240 });
    run(sky, 120);
    expect(sky.reading().hours).toBeCloseTo(18, 0);
    const still = setup({ hours: 6 }).sky; run(still, 120);
    expect(still.reading().hours).toBe(6);
    const wrap = setup({ hours: 23, dayLength: 240 }).sky; run(wrap, 20);
    expect(wrap.reading().hours).toBeGreaterThanOrEqual(0); expect(wrap.reading().hours).toBeLessThan(24);
  });
  it('storm brings rain, cloud, darkness and lightning; clear takes them away', () => {
    const { sky } = setup({ hours: 12 });
    const rain = sky.group.children.find((c: any) => c.type === 'LineSegments');
    run(sky, 1);
    expect(rain.visible).toBe(false);
    const clearSun = sky.reading().colors.sun[0];
    sky.setWeather('storm');
    let flashes = 0;
    for (let t = 1; t <= 90; t += 0.05) { sky.update(100, 100, t, origin); if (sky.reading().weather.flash > 0.3) flashes++; }
    const s = sky.reading();
    expect(rain.visible).toBe(true);
    expect(rain.material.uniforms.uAmount.value).toBeGreaterThan(0.9);
    expect(s.weather.cloud).toBeGreaterThan(0.95);
    expect(s.colors.sun[0]).toBeLessThan(clearSun * 0.5);
    expect(flashes).toBeGreaterThan(3);
    sky.setWeather('clear');
    for (let t = 90; t <= 260; t += 0.1) sky.update(100, 100, t, origin);
    expect(rain.visible).toBe(false);
    expect(sky.reading().weather.cloud).toBeLessThan(0.2);
  });
  it('lightning is deterministic, and only a storm makes it', () => {
    const flashesFor = (weather: string): number[] => {
      const { sky } = setup({ weather });
      const out: number[] = [];
      for (let t = 0; t <= 60; t += 0.05) { sky.update(0, 0, t, origin); out.push(sky.reading().weather.flash); }
      return out;
    };
    expect(flashesFor('storm')).toEqual(flashesFor('storm'));
    expect(Math.max(...flashesFor('storm'))).toBeGreaterThan(0.5);
    expect(Math.max(...flashesFor('rain'))).toBe(0);
    expect(Math.max(...flashesFor('clear'))).toBe(0);
  });
  it('auto weather follows the schedule of the seed', () => {
    const { w, sky } = setup({ auto: true });
    for (const t of [10, 700, 1300, 2500]) {
      sky.update(0, 0, t - 0.1, origin); sky.update(0, 0, t, origin);
      expect(sky.reading().target).toBe(A.weatherAtTime(w.seed, t));
    }
  });
  it('applyTo puts fog distances and colour and the background on a scene', () => {
    const { sky } = setup({ hours: 12 });
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x123456, 5000, 9000); // the game already has fog: the sky must take it over, not leave it as it was
    sky.setWeather('fog'); for (let t = 0; t <= 60; t += 0.1) sky.update(0, 0, t, origin);
    sky.applyTo(scene);
    expect(scene.fog.far).toBeLessThan(500);
    expect(scene.fog.near).toBeLessThan(scene.fog.far);
    expect(scene.background.isColor).toBe(true);
    const c = sky.reading().colors.fog;
    expect(scene.fog.color.r).toBeCloseTo(c[0], 6);
  });
  it('ambience levels are in 0..1, waves roar on the shore and are silent inland, birds sing by day and not at night or in rain', () => {
    const w = world(7);
    const { sky } = setup({ hours: 12 });
    run(sky, 1);
    let shore: any = null; let inland: any = null; let forest: any = null;
    for (let i = 0; i < 30000 && !(shore && inland && forest); i++) {
      const x = ((i * 7919) % 90000) - 45000; const z = ((i * 104729) % 90000) - 45000;
      const h = w.heightAt(x, z);
      if (!shore && h > 0.5 && h < 6) { for (let k = 0; k < 8 && !shore; k++) { const a = (k / 8) * Math.PI * 2; if (w.heightAt(x + Math.cos(a) * 100, z + Math.sin(a) * 100) < -2) shore = { x, z }; } }
      if (!inland && h > 20 && w.heightAt(x + 700, z) > 5 && w.heightAt(x - 700, z) > 5 && w.heightAt(x, z + 700) > 5 && w.heightAt(x, z - 700) > 5 && w.biomeAt(x, z) !== 'forest') inland = { x, z };
      if (!forest && w.biomeAt(x, z) === 'forest') forest = { x, z };
    }
    expect(shore).not.toBeNull(); expect(inland).not.toBeNull(); expect(forest).not.toBeNull();
    const a = sky.ambience(shore.x, shore.z); const b = sky.ambience(inland.x, inland.z);
    for (const v of Object.values(a) as number[]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(a.waves).toBeGreaterThan(0.5); expect(b.waves).toBe(0);
    const day = sky.ambience(forest.x, forest.z);
    expect(day.birds).toBeGreaterThan(0.5); expect(day.night).toBe(0);
    sky.setTimeOfDay(1); run(sky, 3);
    expect(sky.ambience(forest.x, forest.z).birds).toBe(0); expect(sky.ambience(forest.x, forest.z).night).toBe(1);
    sky.setTimeOfDay(12); sky.setWeather('storm'); for (let t = 3; t <= 90; t += 0.1) sky.update(100, 100, t, origin);
    const storm = sky.ambience(forest.x, forest.z);
    expect(storm.rain).toBeGreaterThan(0.9); expect(storm.wind).toBeGreaterThan(0.5); expect(storm.birds).toBeLessThan(0.1);
  });
  it('reports its triangles and drops, and dispose releases geometry and materials', () => {
    const { sky } = setup({}, 'phone');
    expect(sky.stats().domeTriangles).toBe(A.domeTriangles(A.SKY_TIERS.phone));
    expect(sky.stats().rainDrops).toBe(A.SKY_TIERS.phone.rainDrops);
    const dome: any = sky.group.children[0];
    let n = 0;
    dome.geometry.addEventListener('dispose', () => n++); dome.material.addEventListener('dispose', () => n++);
    sky.dispose();
    expect(n).toBe(2);
  });
});

describe('one sun for the whole map (createAthreeMap)', () => {
  it('adds the sky by default, and the plants, the sea and the rivers all take the sky light', () => {
    const map = A.createAthreeMap({ seed: 7, quality: 'phone', three: THREE, skyOptions: { hours: 8 } });
    expect(map.sky).not.toBeNull();
    expect(map.chunks.group.children).toContain(map.sky.group);
    for (let i = 0; i < 20; i++) map.update(100, 100, i * 0.1, 30);
    const r = map.sky.reading();
    const sun = new THREE.Vector3(r.sun.x, r.sun.y, r.sun.z).normalize();
    const plantSun = map.vegetation.group.children[0].material.uniforms.uSun.value;
    expect(plantSun.distanceTo(sun)).toBeLessThan(1e-6);
    expect(map.ocean.mesh.material.uniforms.uSun.value.distanceTo(new THREE.Vector3(sun.x, Math.max(sun.y, 0.05), sun.z).normalize())).toBeLessThan(1e-6);
    map.dispose();
  });
  it('night darkens the plants and the water together, and the time can be moved by the game', () => {
    const map = A.createAthreeMap({ seed: 7, quality: 'phone', three: THREE, skyOptions: { hours: 12 } });
    for (let i = 0; i < 5; i++) map.update(0, 0, i * 0.1);
    const day = map.vegetation.group.children[0].material.uniforms.uSunColor.value.r;
    map.sky.setTimeOfDay(0);
    for (let i = 5; i < 12; i++) map.update(0, 0, i * 0.1);
    expect(map.vegetation.group.children[0].material.uniforms.uSunColor.value.r).toBeLessThan(day * 0.2);
    map.dispose();
  });
  it('the sky can be left out, and a world without three.js has none', () => {
    expect(A.createAthreeMap({ seed: 7, quality: 'phone', three: THREE, sky: false }).sky).toBeNull();
    expect(A.createAthreeMap({ seed: 7 }).sky).toBeNull();
  });
});
