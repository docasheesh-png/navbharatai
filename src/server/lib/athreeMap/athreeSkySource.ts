// ATHREE MAP — phase 4: DESERT DUNES, SKY, CLOUDS, DAY AND NIGHT, WEATHER (the emitted source of src/game/athree/dunes.ts and sky.ts).
//
// 100% ours. Techniques (public ideas, own code): dunes are an asymmetric saw profile (a gentle windward slope, a steep lee face) laid across
// the wind and warped by noise, with whole-number wave vectors so a 100 km loop still wraps exactly; the sun's place comes from the standard
// hour-angle formula; sky colour is a blend between a day, a night and a twilight palette driven by the sun's height; clouds are a fractal
// noise layer projected onto a plane overhead and carried by the shared wind; weather is a small set of targets the state eases towards;
// rain is a ring of streaks that fall in the vertex shader around the camera.
//
// dunes.ts and the pure half of sky.ts (sun, colours, weather) need no three.js, so every rule is unit-testable.
//
// PURE source strings; the generator writes them. Rule for editing: no backticks and no dollar-brace inside the strings below.

export const DUNES = `// Athree map — desert dunes (pure).
// Technique: an asymmetric saw profile laid across the wind and warped by periodic noise; whole-number wave vectors on a loop world.
// Own implementation.

import { fieldNoise } from './noise';

export interface Dunes {
  /** How much of a desert this place is, 0 (none) to 1 (all of it). A continuous version of the biome rule. */
  desertness(x: number, z: number, baseHeight: number): number;
  /** The extra height the dunes add here, in metres (zero outside deserts). */
  heightAt(x: number, z: number, baseHeight: number): number;
}

export interface DuneOptions {
  seed: number;
  /** Loop period in metres, or 0 for a bounded world. */
  period: number;
  /** The biome scale of the world (bounded islands change biome faster). */
  biomeScale: number;
  mountainLine: number;
}

export const DUNE_WAVELENGTH = 140;

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The steep side faces away from the wind: p in [0, 1) climbs over 72 percent of a wavelength and drops over 28 percent. */
export function duneProfile(p: number): number {
  const s = p < 0.72 ? p / 0.72 : (1 - p) / 0.28;
  return s * s * (3 - 2 * s);
}

export function createDunes(o: DuneOptions): Dunes {
  const angle = ((o.seed * 2654435761) % 6283) / 1000;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const P = o.period;
  // On a loop the wave vector is a pair of whole numbers of waves per period, so the dunes are exactly periodic.
  const waves = P > 0 ? P / DUNE_WAVELENGTH : 0;
  const kx = Math.round(waves * ca);
  const kz = Math.round(waves * sa);

  function desertness(x: number, z: number, baseHeight: number): number {
    if (baseHeight < 4 || baseHeight > o.mountainLine) return 0;
    const moisture = fieldNoise(x, z, o.seed + 4, 4, 9000 / o.biomeScale, P);
    if (moisture > 0.44) return 0;
    const temp = fieldNoise(x, z, o.seed + 5, 3, 16000 / o.biomeScale, P);
    const d = smoothstep(0.44, 0.36, moisture) * smoothstep(0.42, 0.5, temp);
    return d * smoothstep(4, 14, baseHeight) * (1 - smoothstep(o.mountainLine * 0.8, o.mountainLine, baseHeight));
  }

  function heightAt(x: number, z: number, baseHeight: number): number {
    const d = desertness(x, z, baseHeight);
    if (d <= 0) return 0;
    // Hardpan: about a third of a desert is a flat, firm plain (as real deserts have), where dunes do not rise, so vehicles and planes have room.
    const pan = smoothstep(0.3, 0.45, fieldNoise(x, z, o.seed + 22, 2, 2500, P));
    if (pan <= 0) return 0;
    const phase = P > 0 ? (kx * x + kz * z) / P : (x * ca + z * sa) / DUNE_WAVELENGTH;
    const warp = (fieldNoise(x, z, o.seed + 20, 2, 260, P) - 0.5) * 0.9;
    const u = phase + warp;
    const amp = 3 + 5 * fieldNoise(x, z, o.seed + 21, 2, 900, P);
    return d * pan * amp * duneProfile(u - Math.floor(u));
  }

  return { desertness, heightAt };
}
`;

export const SKY = `// Athree map — sky, clouds, day and night, weather, rain, lighting (the first half is pure: no three.js).
// Technique: hour-angle sun position; palette blend driven by the sun's height; fractal clouds projected on a plane and carried by the
// wind; weather targets eased towards; a ring of rain streaks falling in the vertex shader. Own implementation.

import { type AthreeQuality } from './config';
import { mulberry32 } from './noise';
import type { AthreeWorld } from './world';

// three.js is passed in by the caller (import * as THREE from 'three'); it is typed loosely here on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThreeLike = any;

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';
export const WEATHERS: readonly Weather[] = ['clear', 'cloudy', 'rain', 'storm', 'fog'];

export interface WeatherState {
  /** 0 clear sky, 1 overcast. */
  cloud: number;
  /** 0 dry, 1 downpour. */
  rain: number;
  /** 0 clear air, 1 thick fog. */
  fog: number;
  /** How much the light is dimmed and greyed. */
  gloom: number;
  /** Extra wind, 0 to 1. */
  wind: number;
  /** A lightning flash, 0 to 1, decaying. */
  flash: number;
}

export const WEATHER_TARGETS: Record<Weather, Omit<WeatherState, 'flash'>> = {
  clear: { cloud: 0.12, rain: 0, fog: 0, gloom: 0, wind: 0 },
  cloudy: { cloud: 0.7, rain: 0, fog: 0.1, gloom: 0.35, wind: 0.2 },
  rain: { cloud: 0.9, rain: 0.7, fog: 0.35, gloom: 0.6, wind: 0.4 },
  storm: { cloud: 1, rain: 1, fog: 0.5, gloom: 0.85, wind: 1 },
  fog: { cloud: 0.5, rain: 0, fog: 1, gloom: 0.3, wind: 0 },
};

export function initialWeather(w: Weather): WeatherState {
  return { ...WEATHER_TARGETS[w], flash: 0 };
}

/** Ease the weather towards a target: about a fifth of the way per second, never overshooting. */
export function stepWeather(s: WeatherState, target: Weather, dt: number): WeatherState {
  const t = WEATHER_TARGETS[target];
  const k = 1 - Math.exp(-0.2 * Math.max(0, dt));
  const ease = (a: number, b: number): number => Math.min(1, Math.max(0, a + (b - a) * k));
  return { cloud: ease(s.cloud, t.cloud), rain: ease(s.rain, t.rain), fog: ease(s.fog, t.fog), gloom: ease(s.gloom, t.gloom), wind: ease(s.wind, t.wind), flash: s.flash };
}

/** The weather a world has at a time: five-minute spells chosen by a hash of the seed, always clear to begin with. */
export function weatherAtTime(seed: number, seconds: number): Weather {
  const block = Math.floor(Math.max(0, seconds) / 300);
  if (block === 0) return 'clear';
  const r = mulberry32(Math.imul(seed | 0, 2654435761) ^ Math.imul(block, 40503))();
  if (r < 0.4) return 'clear';
  if (r < 0.65) return 'cloudy';
  if (r < 0.82) return 'rain';
  if (r < 0.9) return 'storm';
  return 'fog';
}

export const LATITUDE = 0.45;
export const DECLINATION = 0.2;

/**
 * The direction TOWARDS the sun at a time of day (hours 0 to 24, noon at 12): x is east, y is up, z is south. Standard hour-angle
 * formula for a place at 26 degrees north in late spring: a long day, the sun high at noon, below the horizon at night.
 */
export function sunDirection(hours: number): { x: number; y: number; z: number } {
  const H = ((hours - 12) / 24) * Math.PI * 2;
  const sinL = Math.sin(LATITUDE);
  const cosL = Math.cos(LATITUDE);
  const sinD = Math.sin(DECLINATION);
  const cosD = Math.cos(DECLINATION);
  const up = sinL * sinD + cosL * cosD * Math.cos(H);
  const east = -cosD * Math.sin(H);
  const north = cosL * sinD - sinL * cosD * Math.cos(H);
  return { x: east, y: up, z: -north };
}

type Rgb = [number, number, number];

export interface SkyColors {
  zenith: Rgb;
  horizon: Rgb;
  /** The sun's light on the ground. */
  sun: Rgb;
  ambient: Rgb;
  fog: Rgb;
  /** 0 night, 1 full day. */
  daylight: number;
}

const mixc = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scalec = (a: Rgb, s: number): Rgb => [a[0] * s, a[1] * s, a[2] * s];

function smooth(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Palette for a sun height (sunY, the sine of its elevation) and the weather. Every channel is in 0..1 and changes smoothly. */
export function skyColors(sunY: number, w: WeatherState): SkyColors {
  const daylight = smooth(-0.12, 0.25, sunY);
  const twilight = Math.exp(-Math.pow(sunY / 0.14, 2));
  let zenith = mixc([0.012, 0.02, 0.055], [0.16, 0.38, 0.78], daylight);
  let horizon = mixc([0.03, 0.04, 0.09], [0.62, 0.78, 0.92], daylight);
  horizon = mixc(horizon, [0.95, 0.5, 0.25], twilight * 0.55 * (1 - w.gloom));
  const grey: Rgb = scalec([0.5, 0.52, 0.56], 0.12 + 0.88 * daylight);
  zenith = mixc(zenith, grey, w.gloom * 0.8);
  horizon = mixc(horizon, grey, w.gloom * 0.8);
  const low = smooth(0.45, 0.02, sunY);
  let sun = scalec(mixc([1, 0.96, 0.88], [1, 0.55, 0.3], low), daylight);
  sun = scalec(sun, 1 - 0.75 * w.gloom);
  const ambient = mixc([0.11, 0.13, 0.22], mixc([0.42, 0.46, 0.5], [0.34, 0.36, 0.4], w.gloom), daylight);
  const fog = mixc(horizon, grey, w.fog * 0.6);
  return { zenith, horizon, sun, ambient, fog, daylight };
}

/** Fog distances for a fog amount: clear air sees about two kilometres, thick fog about two hundred metres. */
export function fogRange(fog: number): { near: number; far: number } {
  return { near: 200 - 185 * fog, far: 2400 - 2200 * fog };
}

export interface SkyTier {
  domeRadius: number;
  domeSegments: number;
  /** Rain streaks, and the half-width of the box they fall in. */
  rainDrops: number;
  rainRadius: number;
}

export const SKY_TIERS: Record<AthreeQuality, SkyTier> = {
  phone: { domeRadius: 3500, domeSegments: 20, rainDrops: 600, rainRadius: 30 },
  mid: { domeRadius: 3500, domeSegments: 28, rainDrops: 2000, rainRadius: 45 },
  desktop: { domeRadius: 3500, domeSegments: 40, rainDrops: 5000, rainRadius: 60 },
};

/** Triangles of the sky dome: a sphere of n by n/2 segments, without the degenerate triangles at the poles. */
export function domeTriangles(t: SkyTier): number {
  const w = t.domeSegments;
  const h = Math.floor(w / 2);
  return w * h * 2 - 2 * w;
}

export function skyVertexShader(): string {
  return [
    'varying vec3 vDir;',
    'void main() {',
    '  vDir = normalize(position);',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_Position.z = gl_Position.w * 0.9999;',
    '}',
  ].join('\\n');
}

export function skyFragmentShader(): string {
  return [
    'uniform vec3 uSun; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunTint;',
    'uniform float uDaylight; uniform float uCloud; uniform float uTime; uniform vec2 uDrift; uniform float uFlash;',
    'varying vec3 vDir;',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }',
    'float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'float fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }',
    'void main() {',
    '  vec3 d = normalize(vDir);',
    '  float up = max(d.y, 0.0);',
    '  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));',
    '  if (d.y < 0.0) col = mix(uHorizon, uHorizon * 0.55, smoothstep(0.0, 0.25, -d.y));',
    '  float cs = dot(d, uSun);',
    '  col += uSunTint * (pow(max(cs, 0.0), 6.0) * 0.18 + pow(max(cs, 0.0), 220.0) * 0.8) * uDaylight;',
    '  col += uSunTint * smoothstep(0.99955, 0.99975, cs) * 3.0 * uDaylight;',
    '  float ms = dot(d, -uSun);',
    '  col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, ms) * (1.0 - uDaylight) * 1.2;',
    '  float night = (1.0 - uDaylight) * (1.0 - uCloud * 0.9) * smoothstep(0.0, 0.15, d.y);',
    '  float star = step(0.9955, hash3(floor(d * 260.0)));',
    '  col += vec3(1.0) * star * night * (0.5 + 0.5 * hash3(floor(d * 260.0) + 3.0));',
    '  if (d.y > 0.0) {',
    '    vec2 p = d.xz / (d.y + 0.14) * 1.6 + uDrift * uTime * 0.01;',
    '    float n = fbm(p);',
    '    float thr = mix(0.72, 0.22, uCloud);',
    '    float c = smoothstep(thr, thr + 0.28, n) * smoothstep(0.0, 0.12, d.y);',
    '    vec3 lit = mix(uHorizon * 0.9 + vec3(0.1), uSunTint * 0.9 + vec3(0.2), uDaylight * 0.7);',
    '    vec3 shade = mix(uHorizon * 0.55, vec3(0.35, 0.38, 0.45), uDaylight);',
    '    vec3 cc = mix(lit, shade, smoothstep(thr, thr + 0.6, n) * (0.4 + 0.5 * uCloud));',
    '    cc *= mix(0.3, 1.0, max(uDaylight, 0.15));',
    '    col = mix(col, cc, c * 0.95);',
    '  }',
    '  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + 0.6 * up);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}',
  ].join('\\n');
}

export function rainVertexShader(): string {
  return [
    'attribute vec4 aDrop; attribute float aEnd;',
    'uniform float uTime; uniform vec2 uSlant; uniform float uRadius; uniform float uHeight; uniform float uSpeed;',
    'varying float vFade;',
    'void main() {',
    '  float t = fract(aDrop.z - uTime * uSpeed / uHeight);',
    '  float y = (t - 0.5) * uHeight;',
    '  vec3 p = vec3(aDrop.x * uRadius, y, aDrop.y * uRadius);',
    '  p.xz += uSlant * (t - 0.5) * uHeight * 0.12;',
    '  p.y += aEnd * 0.9;',
    '  p.xz += uSlant * aEnd * 0.12;',
    '  vFade = (0.3 + 0.7 * aDrop.w) * smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.9, t);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '}',
  ].join('\\n');
}

export function rainFragmentShader(): string {
  return [
    'uniform float uAmount; uniform vec3 uColor;',
    'varying float vFade;',
    'void main() { gl_FragColor = vec4(uColor, vFade * uAmount * 0.55); }',
  ].join('\\n');
}

export interface SkyReading {
  hours: number;
  sun: { x: number; y: number; z: number };
  colors: SkyColors;
  weather: WeatherState;
  /** The named weather being eased towards. */
  target: Weather;
}

export interface Ambience {
  wind: number;
  rain: number;
  thunder: number;
  night: number;
  /** 1 on the shore, falling to 0 six hundred metres inland. */
  waves: number;
  birds: number;
}

export interface SkyOptions {
  /** Add a sun light and a sky light to the group and drive them. Default true. */
  lights?: boolean;
  /** Start time of day, 0 to 24. Default 9. */
  hours?: number;
  /** Start weather. Default clear. */
  weather?: Weather;
  /** Seconds of play per game day; 0 freezes the clock. Default 0. */
  dayLength?: number;
  /** Let the weather follow weatherAtTime(seed, time). Default false. */
  auto?: boolean;
}

export interface Sky {
  readonly group: ThreeLike;
  reading(): SkyReading;
  setTimeOfDay(hours: number): void;
  setWeather(w: Weather): void;
  /** Call every frame. The camera and origin are in WORLD metres; time in seconds. */
  update(cameraX: number, cameraZ: number, time: number, origin: { x: number; z: number }, cameraY?: number): void;
  /** Put the sky's fog and background colour on a scene. */
  applyTo(scene: ThreeLike): void;
  /** Levels (0 to 1) for the game's own audio: wind, rain, thunder, night, waves on the shore, birdsong. */
  ambience(cameraX: number, cameraZ: number): Ambience;
  stats(): { domeTriangles: number; rainDrops: number };
  dispose(): void;
}

export function createSky(THREE: ThreeLike, world: AthreeWorld, quality: AthreeQuality = 'mid', options: SkyOptions = {}): Sky {
  const tier = SKY_TIERS[quality];
  const group = new THREE.Group();
  let hours = ((options.hours ?? 9) % 24 + 24) % 24;
  let target: Weather = options.weather ?? 'clear';
  let weather = initialWeather(target);
  const dayLength = options.dayLength ?? 0;
  let lastTime = 0;
  let started = false;
  const flashRng = mulberry32(world.seed ^ 0x51ab);
  let nextFlash = 4;
  let sun = sunDirection(hours);
  let colors = skyColors(sun.y, weather);

  const skyUniforms = {
    uSun: { value: new THREE.Vector3(sun.x, sun.y, sun.z) },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunTint: { value: new THREE.Color() },
    uDaylight: { value: 1 },
    uCloud: { value: 0 },
    uTime: { value: 0 },
    uDrift: { value: new THREE.Vector2(1, 0) },
    uFlash: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(tier.domeRadius, tier.domeSegments, Math.floor(tier.domeSegments / 2)),
    new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: skyVertexShader(), fragmentShader: skyFragmentShader(), side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  group.add(dome);

  const rainUniforms = {
    uTime: { value: 0 },
    uSlant: { value: new THREE.Vector2(0, 0) },
    uRadius: { value: tier.rainRadius },
    uHeight: { value: 28 },
    uSpeed: { value: 14 },
    uAmount: { value: 0 },
    uColor: { value: new THREE.Color(0.75, 0.8, 0.88) },
  };
  const n = tier.rainDrops;
  const drop = new Float32Array(n * 2 * 4);
  const end = new Float32Array(n * 2);
  const rng = mulberry32(world.seed ^ 0x7a1);
  for (let i = 0; i < n; i++) {
    const x = rng() * 2 - 1;
    const z = rng() * 2 - 1;
    const phase = rng();
    const bright = rng();
    for (let k = 0; k < 2; k++) {
      drop.set([x, z, phase, bright], (i * 2 + k) * 4);
      end[i * 2 + k] = k;
    }
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
  rainGeometry.setAttribute('aDrop', new THREE.BufferAttribute(drop, 4));
  rainGeometry.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const rain = new THREE.LineSegments(
    rainGeometry,
    new THREE.ShaderMaterial({ uniforms: rainUniforms, vertexShader: rainVertexShader(), fragmentShader: rainFragmentShader(), transparent: true, depthWrite: false, fog: false }),
  );
  rain.frustumCulled = false;
  rain.visible = false;
  group.add(rain);

  let sunLight: ThreeLike = null;
  let skyLight: ThreeLike = null;
  if (options.lights !== false) {
    sunLight = new THREE.DirectionalLight(0xffffff, 1);
    skyLight = new THREE.HemisphereLight(0xffffff, 0x5b4a30, 0.9);
    group.add(sunLight);
    group.add(skyLight);
  }

  const setRgb = (c: ThreeLike, v: Rgb): void => { c.setRGB(v[0], v[1], v[2]); };
  let seaCheck = { x: Infinity, z: Infinity, waves: 0 };

  function refresh(): void {
    sun = sunDirection(hours);
    colors = skyColors(sun.y, weather);
    skyUniforms.uSun.value.set(sun.x, sun.y, sun.z);
    setRgb(skyUniforms.uZenith.value, colors.zenith);
    setRgb(skyUniforms.uHorizon.value, colors.horizon);
    setRgb(skyUniforms.uSunTint.value, mixc(colors.sun, [1, 1, 1], 0.15));
    skyUniforms.uDaylight.value = colors.daylight;
    skyUniforms.uCloud.value = weather.cloud;
    skyUniforms.uFlash.value = weather.flash;
    rainUniforms.uAmount.value = weather.rain;
    rain.visible = weather.rain > 0.02;
    if (sunLight) {
      const moon = sun.y < -0.05;
      const dir = moon ? { x: -sun.x, y: -sun.y, z: -sun.z } : sun;
      sunLight.position.set(dir.x * 1000, Math.max(dir.y, 0.05) * 1000, dir.z * 1000);
      setRgb(sunLight.color, moon ? [0.45, 0.52, 0.8] : colors.sun);
      sunLight.intensity = moon ? 0.45 * (1 - weather.gloom) : Math.max(0.0, colors.daylight * 1.6 * (1 - 0.6 * weather.gloom));
      setRgb(skyLight.color, mixc(colors.horizon, colors.zenith, 0.5));
      skyLight.intensity = 0.45 + 0.45 * colors.daylight + 0.3 * weather.flash;
    }
  }
  refresh();

  function update(cameraX: number, cameraZ: number, time: number, origin: { x: number; z: number }, cameraY = 0): void {
    const dt = started ? Math.min(0.25, Math.max(0, time - lastTime)) : 0;
    started = true;
    lastTime = time;
    if (dayLength > 0) hours = (hours + (dt * 24) / dayLength) % 24;
    if (options.auto) target = weatherAtTime(world.seed, time);
    weather = stepWeather(weather, target, dt);
    let flash = Math.max(0, weather.flash - dt * 4);
    if (target === 'storm' && weather.rain > 0.6 && time >= nextFlash) {
      flash = 0.6 + 0.4 * flashRng();
      nextFlash = time + 6 + 14 * flashRng();
    }
    weather = { ...weather, flash };
    const wind = world.windAt(cameraX, cameraZ, time);
    skyUniforms.uTime.value = time;
    skyUniforms.uDrift.value.set(wind.x, wind.z);
    rainUniforms.uTime.value = time;
    rainUniforms.uSlant.value.set(wind.x * (0.4 + weather.wind), wind.z * (0.4 + weather.wind));
    refresh();
    dome.position.set(cameraX - origin.x, cameraY, cameraZ - origin.z);
    rain.position.set(cameraX - origin.x, cameraY, cameraZ - origin.z);
  }

  function applyTo(scene: ThreeLike): void {
    const r = fogRange(weather.fog);
    if (!scene.fog) scene.fog = new THREE.Fog(0xffffff, r.near, r.far);
    setRgb(scene.fog.color, colors.fog);
    scene.fog.near = r.near;
    scene.fog.far = r.far;
    scene.background = new THREE.Color(colors.fog[0], colors.fog[1], colors.fog[2]);
  }

  function ambience(cameraX: number, cameraZ: number): Ambience {
    if (Math.hypot(cameraX - seaCheck.x, cameraZ - seaCheck.z) > 20) {
      let nearest = Infinity;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        for (const d of [60, 150, 300, 500, 700]) {
          if (world.heightAt(cameraX + Math.cos(a) * d, cameraZ + Math.sin(a) * d) < -1) { nearest = Math.min(nearest, d); break; }
        }
      }
      seaCheck = { x: cameraX, z: cameraZ, waves: nearest === Infinity ? 0 : Math.max(0, 1 - nearest / 700) };
    }
    const biome = world.biomeAt(cameraX, cameraZ);
    const green = biome === 'forest' ? 1 : biome === 'grassland' ? 0.7 : 0.15;
    const speed = world.windAt(cameraX, cameraZ, lastTime).speed;
    return {
      wind: Math.min(1, speed / 14 + weather.wind * 0.5),
      rain: weather.rain,
      thunder: weather.flash > 0.2 ? weather.flash : 0,
      night: 1 - colors.daylight,
      waves: seaCheck.waves,
      birds: colors.daylight * (1 - weather.rain) * (1 - weather.fog * 0.5) * green,
    };
  }

  function dispose(): void {
    dome.geometry.dispose();
    dome.material.dispose();
    rainGeometry.dispose();
    rain.material.dispose();
    if (sunLight) { group.remove(sunLight); group.remove(skyLight); }
  }

  return {
    group,
    reading: () => ({ hours, sun, colors, weather, target }),
    setTimeOfDay: (h: number) => { hours = ((h % 24) + 24) % 24; refresh(); },
    setWeather: (w: Weather) => { target = w; },
    update,
    applyTo,
    ambience,
    stats: () => ({ domeTriangles: dome.geometry.index ? dome.geometry.index.count / 3 : dome.geometry.attributes.position.count / 3, rainDrops: n }),
    dispose,
  };
}
`;
