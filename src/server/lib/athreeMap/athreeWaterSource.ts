// ATHREE MAP — phase 2a: the OCEAN (the emitted source of src/game/athree/water.ts and ocean.ts).
//
// 100% ours. Technique: a sum of Gerstner waves (the classic trochoidal wave model: each component moves a surface point on a small circle,
// so crests sharpen and troughs flatten the way real swell does), phase speed from deep-water dispersion (omega^2 = g k), amplitude
// scaled by the shared wind. The SAME component table feeds the CPU function a boat floats on and the GLSL a GPU draws, so there is one
// sea, not two. Shore foam comes from a coarse depth texture baked from the terrain's own height function.
//
// PURE source strings; the generator writes them.

export const WATER = `// Athree map — the wave field.
// Technique: Gerstner waves (trochoidal), deep-water dispersion omega^2 = g * k, amplitude scaled by wind. Own implementation.

import { mulberry32 } from './noise';

export const GRAVITY = 9.81;

export interface WaveComponent {
  /** Unit direction of travel. */
  dx: number;
  dz: number;
  wavelength: number;
  /** Wave number 2 pi / wavelength. */
  k: number;
  /** Base amplitude in metres (before the wind scale). */
  a: number;
  /** Steepness factor: horizontal motion is q * a * cos, chosen so crests never loop. */
  q: number;
  /** Angular frequency from deep-water dispersion. */
  w: number;
  phase: number;
}

export interface WaveSurface {
  y: number;
  nx: number;
  ny: number;
  nz: number;
}

export interface WaveField {
  readonly seed: number;
  readonly components: readonly WaveComponent[];
  /** The calm-to-storm amplitude scale for a wind speed in m/s. */
  ampScale(windSpeed: number): number;
  /** Height of the sea surface at a fixed place (inverts the horizontal motion). minWavelength drops the shortest waves. */
  heightAt(x: number, z: number, t: number, windSpeed?: number, minWavelength?: number): number;
  /** Height and unit normal at a fixed place: what a boat sits on. */
  surfaceAt(x: number, z: number, t: number, windSpeed?: number): WaveSurface;
  /** The GLSL the GPU draws with, generated from THIS table. */
  glsl(): string;
}

const WAVELENGTHS = [180, 110, 70, 42, 26, 15, 9, 5.5];
/** Sum of q * k * a over the components: below 1, no crest ever loops over itself. */
const LOOP_BUDGET = 0.7;

export function createWaveField(seed: number, windDirection = 0): WaveField {
  const rng = mulberry32((seed | 0) ^ 0x5eed);
  const n = WAVELENGTHS.length;
  const components: WaveComponent[] = WAVELENGTHS.map((wavelength) => {
    const ang = windDirection + (rng() - 0.5) * 1.2;
    const k = (Math.PI * 2) / wavelength;
    const a = 0.014 * wavelength;
    return { dx: Math.cos(ang), dz: Math.sin(ang), wavelength, k, a, q: LOOP_BUDGET / (k * a * n), w: Math.sqrt(GRAVITY * k), phase: rng() * Math.PI * 2 };
  });

  const ampScale = (windSpeed: number): number => Math.min(1.2, Math.max(0.35, 0.35 + 0.08 * windSpeed));

  // The point of the surface that starts at (px, pz) is at (px + hx, pz + hz).
  function horizontal(px: number, pz: number, t: number, s: number, minWl: number): { hx: number; hz: number } {
    let hx = 0;
    let hz = 0;
    for (const c of components) {
      if (c.wavelength < minWl) continue;
      const cs = Math.cos(c.k * (c.dx * px + c.dz * pz) - c.w * t + c.phase);
      hx += c.q * c.a * s * c.dx * cs;
      hz += c.q * c.a * s * c.dz * cs;
    }
    return { hx, hz };
  }

  function heightAt(x: number, z: number, t: number, windSpeed = 6, minWavelength = 0): number {
    const s = ampScale(windSpeed);
    let px = x;
    let pz = z;
    for (let i = 0; i < 4; i++) {
      const h = horizontal(px, pz, t, s, minWavelength);
      px = x - h.hx;
      pz = z - h.hz;
    }
    let y = 0;
    for (const c of components) {
      if (c.wavelength < minWavelength) continue;
      y += c.a * s * Math.sin(c.k * (c.dx * px + c.dz * pz) - c.w * t + c.phase);
    }
    return y;
  }

  function surfaceAt(x: number, z: number, t: number, windSpeed = 6): WaveSurface {
    const e = 0.5;
    const y = heightAt(x, z, t, windSpeed);
    const dx = heightAt(x + e, z, t, windSpeed) - heightAt(x - e, z, t, windSpeed);
    const dz = heightAt(x, z + e, t, windSpeed) - heightAt(x, z - e, t, windSpeed);
    const len = Math.hypot(dx, 2 * e, dz);
    return { y, nx: -dx / len, ny: (2 * e) / len, nz: -dz / len };
  }

  function glsl(): string {
    const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));
    const rowA = components.map((c) => 'vec4(' + [c.dx, c.dz, c.k, c.a].map(f).join(', ') + ')').join(',\\n    ');
    const rowB = components.map((c) => 'vec4(' + [c.q, c.w, c.phase, c.wavelength].map(f).join(', ') + ')').join(',\\n    ');
    return [
      'const int WAVE_N = ' + n + ';',
      'const vec4 WAVE_A[WAVE_N] = vec4[WAVE_N](\\n    ' + rowA + '\\n);',
      'const vec4 WAVE_B[WAVE_N] = vec4[WAVE_N](\\n    ' + rowB + '\\n);',
      '// Displacement of the surface point that starts at p (world metres): xyz = (dx, height, dz). Waves shorter than minWl are skipped.',
      'vec3 gerstnerDisplace(vec2 p, float t, float s, float minWl) {',
      '  vec3 d = vec3(0.0);',
      '  for (int i = 0; i < WAVE_N; i++) {',
      '    if (WAVE_B[i].w < minWl) continue;',
      '    float th = WAVE_A[i].z * dot(WAVE_A[i].xy, p) - WAVE_B[i].y * t + WAVE_B[i].z;',
      '    float qa = WAVE_B[i].x * WAVE_A[i].w * s;',
      '    d.x += qa * WAVE_A[i].x * cos(th);',
      '    d.z += qa * WAVE_A[i].y * cos(th);',
      '    d.y += WAVE_A[i].w * s * sin(th);',
      '  }',
      '  return d;',
      '}',
      '// Unit normal of the surface at the point that starts at p (all waves).',
      'vec3 gerstnerNormal(vec2 p, float t, float s) {',
      '  vec3 nrm = vec3(0.0, 1.0, 0.0);',
      '  for (int i = 0; i < WAVE_N; i++) {',
      '    float th = WAVE_A[i].z * dot(WAVE_A[i].xy, p) - WAVE_B[i].y * t + WAVE_B[i].z;',
      '    float ka = WAVE_A[i].z * WAVE_A[i].w * s;',
      '    nrm.x -= WAVE_A[i].x * ka * cos(th);',
      '    nrm.z -= WAVE_A[i].y * ka * cos(th);',
      '    nrm.y -= WAVE_B[i].x * ka * sin(th);',
      '  }',
      '  return normalize(nrm);',
      '}',
    ].join('\\n');
  }

  return { seed, components, ampScale, heightAt, surfaceAt, glsl };
}
`;

export const OCEAN = `// Athree map — the ocean surface: a camera-following wave mesh with depth-driven colour and shore foam.
// Technique: one grid that follows the camera in whole-cell steps (so its vertices never swim), displaced on the GPU by the long waves of the
// wave table; every wave shades the normal; colour runs shallow to deep from a coarse depth texture baked from the terrain's own height
// function (rows are filled a few per frame, then swapped in whole), foam gathers where the water is shallow. Own implementation.

import { OCEAN_TIERS, type AthreeQuality } from './config';
import { createWaveField, type WaveField } from './water';
import type { AthreeWorld } from './world';

// three.js is passed in by the caller (import * as THREE from 'three'); it is typed loosely here on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThreeLike = any;

const DEPTH_FULL = 40;

export interface Ocean {
  readonly mesh: ThreeLike;
  readonly waves: WaveField;
  /** Call every frame. The camera and origin are in WORLD metres; time in seconds. */
  update(cameraX: number, cameraZ: number, time: number, origin: { x: number; z: number }): void;
  /** What a boat floats on: the surface height and its unit normal, at a place and time (the long waves the mesh draws plus the short ones). */
  floatAt(x: number, z: number, time: number): { y: number; nx: number; ny: number; nz: number };
  /** The wave-mesh grid spacing in metres. */
  readonly step: number;
  dispose(): void;
}

export function oceanVertexShader(waves: WaveField, minWavelength: number): string {
  return [
    waves.glsl(),
    'uniform float uTime; uniform float uAmp; uniform vec2 uCenter; uniform float uSea;',
    'varying vec2 vP0; varying vec3 vView; varying float vAmp;',
    'void main() {',
    '  vec2 p0 = position.xz + uCenter;',
    '  vec3 d = gerstnerDisplace(p0, uTime, uAmp, ' + minWavelength.toFixed(1) + ');',
    '  vec3 local = vec3(position.x + d.x, uSea + d.y, position.z + d.z);',
    '  vec4 mv = modelViewMatrix * vec4(local, 1.0);',
    '  vView = -mv.xyz; vP0 = p0; vAmp = uAmp;',
    '  gl_Position = projectionMatrix * mv;',
    '}',
  ].join('\\n');
}

export function oceanFragmentShader(waves: WaveField): string {
  return [
    waves.glsl(),
    'uniform float uTime; uniform float uAmp; uniform sampler2D uDepth; uniform vec2 uDepthCenter; uniform float uDepthSize;',
    'uniform vec3 uSun; uniform vec3 uSky;',
    'varying vec2 vP0; varying vec3 vView; varying float vAmp;',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'void main() {',
    '  vec3 n = gerstnerNormal(vP0, uTime, uAmp);',
    '  vec3 v = normalize(vView);',
    '  vec2 uv = (vP0 - uDepthCenter) / uDepthSize + 0.5;',
    '  float depth = texture2D(uDepth, uv).r * ' + DEPTH_FULL.toFixed(1) + ';',
    '  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);',
    '  vec3 shallow = vec3(0.12, 0.55, 0.62); vec3 deep = vec3(0.02, 0.17, 0.33);',
    '  vec3 col = mix(shallow, deep, smoothstep(0.0, 25.0, depth));',
    '  col = mix(col, uSky, fres * 0.6);',
    '  vec3 h = normalize(uSun + v); col += pow(max(dot(n, h), 0.0), 140.0) * vec3(1.0, 0.95, 0.8) * 0.9;',
    '  float wob = vnoise(vP0 * 0.45 + uTime * 0.6) * 0.8;',
    '  float foam = smoothstep(1.7, 0.0, depth + wob) * smoothstep(0.0, 0.25, depth + 0.2);',
    '  foam += smoothstep(0.78, 1.0, vnoise(vP0 * 0.3 - uTime * 0.2) * (0.7 + 0.5 * vAmp)) * 0.18;',
    '  col = mix(col, vec3(0.95, 0.97, 1.0), clamp(foam, 0.0, 1.0));',
    '  float alpha = mix(0.55, 0.96, smoothstep(0.0, 6.0, depth));',
    '  gl_FragColor = vec4(col, alpha);',
    '}',
  ].join('\\n');
}

export function createOcean(THREE: ThreeLike, world: AthreeWorld, quality: AthreeQuality = 'mid'): Ocean {
  const tier = OCEAN_TIERS[quality];
  const wind0 = world.windAt(0, 0, 0);
  const waves = createWaveField(world.seed, Math.atan2(wind0.z, wind0.x));
  const step = tier.extent / tier.grid;

  const depthRes = tier.depthRes;
  const depthData = new Uint8Array(depthRes * depthRes * 4);
  const staging = new Uint8Array(depthRes * depthRes * 4);
  const depthTex = new THREE.DataTexture(depthData, depthRes, depthRes, THREE.RGBAFormat);
  depthTex.magFilter = THREE.LinearFilter;
  depthTex.minFilter = THREE.LinearFilter;
  depthTex.needsUpdate = true;
  let center = { x: Infinity, z: Infinity };
  let pending: { x: number; z: number; row: number } | null = null;

  function bakeRows(rows: number): void {
    if (!pending) return;
    const cell = tier.depthSize / depthRes;
    for (let r = 0; r < rows && pending.row < depthRes; r++, pending.row++) {
      for (let col = 0; col < depthRes; col++) {
        const wx = pending.x + (col + 0.5) * cell - tier.depthSize / 2;
        const wz = pending.z + (pending.row + 0.5) * cell - tier.depthSize / 2;
        const depth = Math.max(0, -world.heightAt(wx, wz));
        const i = (pending.row * depthRes + col) * 4;
        staging[i] = Math.min(255, Math.round((depth / DEPTH_FULL) * 255));
        staging[i + 3] = 255;
      }
    }
    if (pending.row >= depthRes) {
      depthData.set(staging);
      depthTex.needsUpdate = true;
      center = { x: pending.x, z: pending.z };
      uniforms.uDepthCenter.value.set(center.x, center.z);
      pending = null;
    }
  }

  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: 1 },
    uCenter: { value: new THREE.Vector2(0, 0) },
    uSea: { value: world.seaLevel },
    uDepth: { value: depthTex },
    uDepthCenter: { value: new THREE.Vector2(0, 0) },
    uDepthSize: { value: tier.depthSize },
    uSun: { value: new THREE.Vector3(-0.5, 0.8, 0.3).normalize() },
    uSky: { value: new THREE.Color(0x9ec7e8) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: oceanVertexShader(waves, tier.minWavelength),
    fragmentShader: oceanFragmentShader(waves),
    transparent: true,
    depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(tier.extent, tier.extent, tier.grid, tier.grid);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  function update(cameraX: number, cameraZ: number, time: number, origin: { x: number; z: number }): void {
    const snapX = Math.round(cameraX / step) * step;
    const snapZ = Math.round(cameraZ / step) * step;
    mesh.position.set(snapX - origin.x, 0, snapZ - origin.z);
    uniforms.uCenter.value.set(snapX, snapZ);
    uniforms.uTime.value = time;
    uniforms.uAmp.value = waves.ampScale(world.windAt(cameraX, cameraZ, time).speed);
    if (!pending && Math.hypot(cameraX - center.x, cameraZ - center.z) > tier.depthSize * 0.2) {
      const cell = tier.depthSize / depthRes;
      pending = { x: Math.round(cameraX / cell) * cell, z: Math.round(cameraZ / cell) * cell, row: 0 };
    }
    bakeRows(tier.depthRowsPerUpdate);
  }

  function floatAt(x: number, z: number, time: number): { y: number; nx: number; ny: number; nz: number } {
    const s = waves.surfaceAt(x, z, time, world.windAt(x, z, time).speed);
    return { y: world.seaLevel + s.y, nx: s.nx, ny: s.ny, nz: s.nz };
  }

  function dispose(): void {
    geometry.dispose();
    material.dispose();
    depthTex.dispose();
  }

  return { mesh, waves, update, floatAt, step, dispose };
}
`;
