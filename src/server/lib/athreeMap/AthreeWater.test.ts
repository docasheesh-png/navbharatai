// ATHREE MAP phase 2a — the OCEAN. These tests run the emitted code: the wave table's physics, the CPU surface a boat floats on against an
// independent forward evaluation, the GLSL generated from the SAME table, and the ocean mesh with real three.js (snapping, floating origin,
// depth baking). What they cannot prove — how it LOOKS and whether the shader compiles on a GPU — is checked by a headless-Chromium render.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadAthree } from '../../../../tests/helpers/loadAthree';

const A = loadAthree();

function forward(field: any, px: number, pz: number, t: number, s: number) {
  let hx = 0; let hz = 0; let y = 0;
  for (const c of field.components) {
    const th = c.k * (c.dx * px + c.dz * pz) - c.w * t + c.phase;
    hx += c.q * c.a * s * c.dx * Math.cos(th);
    hz += c.q * c.a * s * c.dz * Math.cos(th);
    y += c.a * s * Math.sin(th);
  }
  return { x: px + hx, z: pz + hz, y };
}

describe('the wave table (physics)', () => {
  const f = A.createWaveField(5, 0.4);
  it('has eight waves from 5.5 m to 180 m, deterministic by seed', () => {
    expect(f.components).toHaveLength(8);
    expect(f.components.map((c: any) => c.wavelength)).toEqual([180, 110, 70, 42, 26, 15, 9, 5.5]);
    expect(A.createWaveField(5, 0.4).components).toEqual(f.components);
    expect(A.createWaveField(6, 0.4).components).not.toEqual(f.components);
  });
  it('obeys deep-water dispersion: omega^2 = g k', () => {
    for (const c of f.components) expect(c.w * c.w).toBeCloseTo(A.GRAVITY * c.k, 9);
  });
  it('can never loop over itself: sum q k a stays under 1 even in a storm', () => {
    const storm = f.ampScale(30);
    expect(storm).toBeLessThanOrEqual(1.2);
    const sum = f.components.reduce((n: number, c: any) => n + c.q * c.k * c.a * storm, 0);
    expect(sum).toBeLessThan(1);
  });
  it('travels roughly with the wind (within 35 degrees)', () => {
    for (const c of f.components) expect(Math.abs(Math.atan2(c.dz, c.dx) - 0.4)).toBeLessThanOrEqual(0.6 + 1e-9);
  });
  it('every direction is a unit vector', () => {
    for (const c of f.components) expect(Math.hypot(c.dx, c.dz)).toBeCloseTo(1, 12);
  });
});

describe('the sea state follows the wind', () => {
  const f = A.createWaveField(2, 0);
  it('amplitude scale is calm at no wind, bigger in wind, and capped', () => {
    expect(f.ampScale(0)).toBeCloseTo(0.35, 12);
    expect(f.ampScale(5)).toBeGreaterThan(f.ampScale(1));
    expect(f.ampScale(100)).toBe(1.2);
  });
  it('a stronger wind makes taller waves, never beyond the sum of amplitudes', () => {
    let calm = 0; let storm = 0;
    for (let i = 0; i < 400; i++) { const x = i * 7.3; const z = i * 3.1; calm = Math.max(calm, Math.abs(f.heightAt(x, z, 9, 0))); storm = Math.max(storm, Math.abs(f.heightAt(x, z, 9, 12))); }
    expect(storm).toBeGreaterThan(calm);
    const cap = f.components.reduce((n: number, c: any) => n + c.a, 0) * 1.2;
    expect(storm).toBeLessThanOrEqual(cap + 1e-9);
  });
});

describe('the CPU surface a boat floats on', () => {
  const f = A.createWaveField(9, 1);
  it('agrees with an independent forward evaluation of the same surface point (within 2 cm)', () => {
    const s = f.ampScale(7);
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      const px = (i * 37.7) % 900 - 450; const pz = (i * 19.3) % 700 - 350; const t = (i % 11) * 1.3;
      const p = forward(f, px, pz, t, s);
      worst = Math.max(worst, Math.abs(f.heightAt(p.x, p.z, t, 7) - p.y));
    }
    expect(worst).toBeLessThan(0.02);
  });
  it('moves with time (a wave is not frozen) and is the same twice', () => {
    expect(f.heightAt(10, 20, 0)).not.toBeCloseTo(f.heightAt(10, 20, 3), 3);
    expect(f.heightAt(10, 20, 3)).toBe(f.heightAt(10, 20, 3));
  });
  it('dropping the short waves changes the height by no more than their amplitudes', () => {
    const dropped = f.components.filter((c: any) => c.wavelength < 26).reduce((n: number, c: any) => n + c.a, 0) * f.ampScale(6);
    for (let i = 0; i < 60; i++) expect(Math.abs(f.heightAt(i * 11, i * 5, 4) - f.heightAt(i * 11, i * 5, 4, 6, 26))).toBeLessThanOrEqual(dropped * 2 + 0.1);
  });
  it('surfaceAt returns a unit normal that points up and matches the slope', () => {
    for (let i = 0; i < 50; i++) {
      const s = f.surfaceAt(i * 13, i * 7, 2.5, 6);
      expect(Math.hypot(s.nx, s.ny, s.nz)).toBeCloseTo(1, 9);
      expect(s.ny).toBeGreaterThan(0.5);
      expect(s.y).toBe(f.heightAt(i * 13, i * 7, 2.5, 6));
    }
  });
});

describe('the GLSL is generated from the SAME table (one sea, not two)', () => {
  const f = A.createWaveField(3, 0.7);
  const src: string = f.glsl();
  const rows = (name: string): number[][] => {
    const block = src.slice(src.indexOf(name), src.indexOf(');', src.indexOf(name)));
    return [...block.matchAll(/vec4\(([^)]*)\)/g)].map((m) => m[1].split(',').map(Number));
  };
  it('carries every component\'s numbers exactly', () => {
    const a = rows('const vec4 WAVE_A'); const b = rows('const vec4 WAVE_B');
    expect(a).toHaveLength(8); expect(b).toHaveLength(8);
    f.components.forEach((c: any, i: number) => {
      expect(a[i]).toEqual([c.dx, c.dz, c.k, c.a]);
      expect(b[i]).toEqual([c.q, c.w, c.phase, c.wavelength]);
    });
  });
  it('defines the displacement and normal functions the shaders call', () => {
    expect(src).toContain('vec3 gerstnerDisplace(vec2 p, float t, float s, float minWl)');
    expect(src).toContain('vec3 gerstnerNormal(vec2 p, float t, float s)');
    expect(A.oceanVertexShader(f, 42)).toContain('gerstnerDisplace(p0, uTime, uAmp, 42.0)');
    expect(A.oceanFragmentShader(f)).toContain('gerstnerNormal(vP0, uTime, uAmp)');
  });
  it('is a different table for a different seed', () => {
    expect(A.createWaveField(4, 0.7).glsl()).not.toBe(src);
  });
});

describe('quality: the ocean fits the budget with the terrain', () => {
  it('terrain + ocean triangles stay inside each tier\'s budget', () => {
    for (const t of ['phone', 'mid', 'desktop']) {
      const total = A.maxTriangles(A.QUALITY[t]) + A.oceanTriangles(A.OCEAN_TIERS[t]);
      expect(total, t).toBeLessThanOrEqual(A.QUALITY[t].budgetTriangles);
    }
  });
  it('waves too short for the mesh are shaded, not displaced: the cut-off is wider than two grid cells', () => {
    for (const t of ['phone', 'mid', 'desktop']) {
      const tier = A.OCEAN_TIERS[t];
      expect(tier.minWavelength).toBeGreaterThanOrEqual((tier.extent / tier.grid) * 2.5);
    }
  });
});

describe('the ocean mesh (real three.js)', () => {
  const world = A.createAthreeWorld({ seed: 1 });
  it('is a transparent shader mesh with every uniform its shaders read', () => {
    const o = A.createOcean(THREE, world, 'mid');
    const u = o.mesh.material.uniforms;
    for (const name of ['uTime', 'uAmp', 'uCenter', 'uSea', 'uDepth', 'uDepthCenter', 'uDepthSize', 'uSun', 'uSky']) expect(u[name], name).toBeDefined();
    expect(o.mesh.material.transparent).toBe(true);
    for (const name of ['uTime', 'uAmp', 'uCenter', 'uSea', 'uDepth', 'uDepthCenter', 'uDepthSize', 'uSun', 'uSky']) {
      expect(o.mesh.material.vertexShader + o.mesh.material.fragmentShader, name).toContain(name);
    }
    o.dispose();
  });
  it('follows the camera in whole grid steps, so its vertices never swim', () => {
    const o = A.createOcean(THREE, world, 'mid');
    for (const [x, z] of [[0, 0], [12.3, 4.4], [999.9, -2345.6], [-31.1, 77.7]]) {
      o.update(x, z, 1, { x: 0, z: 0 });
      expect(o.mesh.position.x % o.step).toBeCloseTo(0, 6);
      expect(o.mesh.material.uniforms.uCenter.value.x % o.step).toBeCloseTo(0, 6);
      expect(Math.abs(o.mesh.position.x - x)).toBeLessThanOrEqual(o.step / 2 + 1e-9);
    }
    o.dispose();
  });
  it('keeps the WAVE PHASE in world metres when the render origin re-bases', () => {
    const o = A.createOcean(THREE, world, 'mid');
    o.update(5000, 3000, 2, { x: 0, z: 0 });
    const centerBefore = o.mesh.material.uniforms.uCenter.value.clone();
    o.update(5000, 3000, 2, { x: 4864, z: 2816 });
    expect(o.mesh.material.uniforms.uCenter.value.x).toBe(centerBefore.x);
    expect(o.mesh.material.uniforms.uCenter.value.z).toBe(centerBefore.z);
    expect(o.mesh.position.x).toBeCloseTo(centerBefore.x - 4864, 6);
    o.dispose();
  });
  it('time and wind reach the shader', () => {
    const o = A.createOcean(THREE, world, 'phone');
    o.update(0, 0, 12.5, { x: 0, z: 0 });
    expect(o.mesh.material.uniforms.uTime.value).toBe(12.5);
    expect(o.mesh.material.uniforms.uAmp.value).toBeCloseTo(o.waves.ampScale(world.windAt(0, 0, 12.5).speed), 12);
    o.dispose();
  });
  it('floatAt is the wave field\'s surface at the sea level', () => {
    const o = A.createOcean(THREE, world, 'mid');
    const f = o.floatAt(120, -40, 7);
    const s = o.waves.surfaceAt(120, -40, 7, world.windAt(120, -40, 7).speed);
    expect(f).toEqual({ y: world.seaLevel + s.y, nx: s.nx, ny: s.ny, nz: s.nz });
    o.dispose();
  });
});

describe('the shore-depth texture', () => {
  const world = A.createAthreeWorld({ seed: 1 });
  // A place where the open-world seed-1 coast is: find water within reach of land so depth varies.
  function coast(): { x: number; z: number } {
    for (let i = 0; i < 4000; i++) {
      const x = ((i * 977) % 60000) - 30000; const z = ((i * 619) % 60000) - 30000;
      if (world.heightAt(x, z) < -3 && world.heightAt(x + 400, z) > 2) return { x, z };
    }
    throw new Error('no coast found');
  }
  it('bakes a few rows per update, swaps in whole, and encodes depth with land as zero', () => {
    const o = A.createOcean(THREE, world, 'phone');
    const tier = A.OCEAN_TIERS.phone;
    const c = coast();
    const tex = o.mesh.material.uniforms.uDepth.value;
    const initial = Uint8Array.from(tex.image.data);
    o.update(c.x, c.z, 0, { x: 0, z: 0 });
    // one update: only depthRowsPerUpdate rows were baked, so the visible texture has NOT changed yet
    expect(Array.from(tex.image.data)).toEqual(Array.from(initial));
    let calls = 1;
    while (o.mesh.material.uniforms.uDepthCenter.value.x === 0 && calls < 200) { o.update(c.x, c.z, 0, { x: 0, z: 0 }); calls++; }
    expect(calls).toBe(Math.ceil(tier.depthRes / tier.depthRowsPerUpdate));
    const center = o.mesh.material.uniforms.uDepthCenter.value;
    const cell = tier.depthSize / tier.depthRes;
    let land = 0; let water = 0;
    for (let row = 0; row < tier.depthRes; row += 5) for (let col = 0; col < tier.depthRes; col += 5) {
      const wx = center.x + (col + 0.5) * cell - tier.depthSize / 2;
      const wz = center.y + (row + 0.5) * cell - tier.depthSize / 2;
      const depth = Math.max(0, -world.heightAt(wx, wz));
      const expected = Math.min(255, Math.round((depth / 40) * 255));
      expect(tex.image.data[(row * tier.depthRes + col) * 4]).toBe(expected);
      if (depth === 0) land++; else water++;
    }
    expect(land).toBeGreaterThan(0);
    expect(water).toBeGreaterThan(0);
    o.dispose();
  });
});

describe('the API: one update() moves terrain and sea together', () => {
  it('createAthreeMap gives the ocean, replaces the placeholder sea, and update() returns the origin shift', () => {
    const map = A.createAthreeMap({ seed: 1, three: THREE, quality: 'phone', vegetation: false });
    expect(map.ocean).not.toBeNull();
    const meshes: any[] = [];
    map.chunks.group.traverse((o: any) => { if (o.isMesh) meshes.push(o); });
    expect(meshes.filter((m) => m.material.isShaderMaterial)).toHaveLength(1); // the ocean (the plants are switched off here)
    expect(meshes.some((m) => m.material.transparent && !m.material.isShaderMaterial)).toBe(false); // the flat placeholder is gone
    for (let i = 0; i < 60; i++) map.update(0, 0, i * 0.1);
    const shift = map.update(4500, 0, 7);
    expect(shift).not.toBeNull();
    expect(map.ocean.mesh.material.uniforms.uTime.value).toBe(7);
    map.dispose();
  });
  it('without three.js there is no ocean and update() is harmless', () => {
    const bare = A.createAthreeMap({ seed: 2 });
    expect(bare.ocean).toBeNull();
    expect(bare.update(0, 0, 0)).toBeNull();
  });
});
