// VFX, audio, and the thing that ties them together — phase 4 of game building.
//
// Phase 1 gave the runtime, phase 2 the look, phase 3 the movement. This is the layer that makes an
// action feel like it HAPPENED.
//
// THE INSIGHT THAT MAKES THIS WORTH A PHASE. A hit that plays only an animation reads as a glitch. The
// same hit with a particle, a sound, a frame of hit-stop and a nudge of camera shake reads as force —
// and nothing about the geometry changed. That combination is not four features; it is ONE feature,
// and it has to be authored in one place or it drifts: the sound gets added, the shake does not, and
// three months later half the game feels weaker than the other half for no nameable reason.
//
// So the centre of this file is not the particle system. It is `bindGameFeedback` — one table mapping
// each game event to its full reaction.
//
// THE MISTAKES IT AVOIDS, each of which is specific and common:
//   • ONE MESH PER PARTICLE. A thousand sparks as a thousand meshes is a thousand draw calls. One
//     THREE.Points with a pooled buffer is one.
//   • ADDITIVE PARTICLES THAT WRITE DEPTH. Fire and sparks must not occlude each other — with
//     depthWrite on, the nearest particle punches a hole in the ones behind it and the effect flickers.
//   • <audio> ELEMENTS. They carry tens of milliseconds of latency and browsers cap how many can play
//     at once; a gunshot arrives after the muzzle flash. Web Audio is the only correct choice.
//   • NOT UNLOCKING AUDIO ON A GESTURE. Every browser suspends the AudioContext until a user gesture.
//     This is THE reason "there is no sound in my web game", and it needs one line — which is missing
//     from almost every hand-rolled attempt.
//   • THE SAME SAMPLE AT THE SAME PITCH. Footsteps and hits repeat constantly; identical playback reads
//     as a machine. A few percent of random detune is what makes them read as real.
//   • NO VOICE LIMIT. Fifty simultaneous explosions clip the master and turn the mix to mud.
//
// PURE builder → the caller writes the files.

export interface GameVfxAudioResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const PARTICLES = `import * as THREE from 'three';

/**
 * A pooled GPU particle system — one THREE.Points, one draw call, zero allocation per burst.
 *
 * The naive version spawns a Mesh per particle. A thousand sparks is then a thousand draw calls and a
 * thousand objects for the garbage collector; the frame rate is gone long before the effect looks good.
 * Here every particle is a slot in one preallocated buffer, and a burst just wakes up slots.
 *
 * ADDITIVE EFFECTS MUST NOT WRITE DEPTH. Fire, sparks and magic are additive, and with depthWrite on
 * the nearest particle punches a hole in the ones behind it — the effect flickers and looks broken.
 */
export type ParticlePreset =
  | 'muzzleFlash' | 'impact' | 'dust' | 'explosion' | 'smoke' | 'sparks' | 'heal' | 'pickup' | 'blood';

export interface ParticleSpec {
  count: number;
  color: number;
  colorEnd?: number;
  size: number;
  sizeEnd?: number;
  life: number;
  speed: number;
  spread: number;
  gravity: number;
  additive: boolean;
  drag?: number;
}

export const PARTICLE_PRESETS: Record<ParticlePreset, ParticleSpec> = {
  muzzleFlash: { count: 14, color: 0xfff3c4, colorEnd: 0xff8a00, size: 0.30, sizeEnd: 0.02, life: 0.10, speed: 9,  spread: 0.35, gravity: 0,    additive: true,  drag: 6 },
  impact:      { count: 18, color: 0xffd9a0, colorEnd: 0xff6a2a, size: 0.14, sizeEnd: 0.01, life: 0.35, speed: 6,  spread: 1.4,  gravity: -9,   additive: true,  drag: 2 },
  dust:        { count: 22, color: 0xcfc3ad, colorEnd: 0xcfc3ad, size: 0.30, sizeEnd: 0.80, life: 0.80, speed: 1.6, spread: 1.8, gravity: 0.4,  additive: false, drag: 3 },
  explosion:   { count: 60, color: 0xfff1b8, colorEnd: 0xd0350a, size: 0.55, sizeEnd: 0.05, life: 0.70, speed: 14, spread: 2.2,  gravity: -3,   additive: true,  drag: 1.6 },
  smoke:       { count: 26, color: 0x50504e, colorEnd: 0x9a9a98, size: 0.45, sizeEnd: 1.60, life: 1.60, speed: 1.2, spread: 1.0, gravity: 1.1,  additive: false, drag: 1.2 },
  sparks:      { count: 26, color: 0xffe9a8, colorEnd: 0xff5a00, size: 0.06, sizeEnd: 0.01, life: 0.55, speed: 11, spread: 2.6,  gravity: -16,  additive: true,  drag: 0.6 },
  heal:        { count: 18, color: 0xa8ffc4, colorEnd: 0x2ad17a, size: 0.16, sizeEnd: 0.02, life: 0.90, speed: 1.8, spread: 0.7, gravity: 2.2,  additive: true,  drag: 1 },
  pickup:      { count: 14, color: 0xffe97a, colorEnd: 0xffa300, size: 0.14, sizeEnd: 0.01, life: 0.50, speed: 3.2, spread: 1.2, gravity: 1.4,  additive: true,  drag: 1.4 },
  blood:       { count: 16, color: 0xa8161b, colorEnd: 0x4a0a0c, size: 0.12, sizeEnd: 0.03, life: 0.60, speed: 5,  spread: 1.5,  gravity: -14,  additive: false, drag: 1 },
};

interface Slot { life: number; maxLife: number; vx: number; vy: number; vz: number; spec: ParticleSpec; }

/**
 * One buffer, one blend mode, one draw call.
 *
 * There are TWO of these because a blend mode belongs to the MATERIAL, not the particle. Fire and
 * sparks must add light; smoke, dust and blood must not — run them all through one additive material
 * and the smoke glows like neon. Two layers is still only two draw calls.
 */
class ParticleLayer {
  readonly points: THREE.Points;
  private readonly slots: Slot[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly max: number;
  private cursor = 0;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      this.slots.push({ life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, spec: PARTICLE_PRESETS.impact });
      this.sizes[i] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.2,
      sizeAttenuation: true,
      transparent: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      // The line that stops additive particles punching holes in each other.
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false; // bursts appear anywhere; culling by the initial bounds hides them
  }

  spawn(spec: ParticleSpec, x: number, y: number, z: number, scale: number, rand: () => number): void {
    const count = Math.max(1, Math.round(spec.count * scale));
    const c = new THREE.Color(spec.color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const s = this.slots[i];
      s.spec = spec;
      s.life = spec.life;
      s.maxLife = spec.life;
      const speed = spec.speed * (0.5 + rand()) * scale;
      s.vx = (rand() - 0.5) * spec.spread * speed;
      s.vy = (rand() - 0.2) * spec.spread * speed;
      s.vz = (rand() - 0.5) * spec.spread * speed;
      this.positions[i * 3] = x; this.positions[i * 3 + 1] = y; this.positions[i * 3 + 2] = z;
      this.colors[i * 3] = c.r; this.colors[i * 3 + 1] = c.g; this.colors[i * 3 + 2] = c.b;
      this.sizes[i] = spec.size * scale;
    }
  }

  update(delta: number): void {
    const col = new THREE.Color();
    const end = new THREE.Color();
    for (let i = 0; i < this.max; i++) {
      const s = this.slots[i];
      if (s.life <= 0) continue;
      s.life -= delta;
      if (s.life <= 0) { this.sizes[i] = 0; continue; }
      const t = 1 - s.life / s.maxLife;

      const drag = Math.exp(-(s.spec.drag ?? 1) * delta);
      s.vx *= drag; s.vz *= drag;
      s.vy = s.vy * drag + s.spec.gravity * delta;
      this.positions[i * 3] += s.vx * delta;
      this.positions[i * 3 + 1] += s.vy * delta;
      this.positions[i * 3 + 2] += s.vz * delta;

      // Fading COLOUR as well as size is what stops a burst looking like it is switched off at the end.
      col.setHex(s.spec.color);
      end.setHex(s.spec.colorEnd ?? s.spec.color);
      col.lerp(end, t);
      this.colors[i * 3] = col.r; this.colors[i * 3 + 1] = col.g; this.colors[i * 3 + 2] = col.b;
      this.sizes[i] = s.spec.size + ((s.spec.sizeEnd ?? s.spec.size) - s.spec.size) * t;
    }
    const geo = this.points.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
  }

  get activeCount(): number { return this.slots.reduce((n, s) => n + (s.life > 0 ? 1 : 0), 0); }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

export class ParticleSystem {
  private readonly additive: ParticleLayer;
  private readonly normal: ParticleLayer;
  private seed = 12345;

  constructor(max = 1200) {
    // Additive effects are the frequent, high-count ones (sparks, fire, explosions), so they get the
    // larger share of the budget.
    this.additive = new ParticleLayer(Math.max(1, Math.ceil(max * 0.7)), true);
    this.normal = new ParticleLayer(Math.max(1, Math.ceil(max * 0.3)), false);
  }

  /** Both layers. Add them ALL — adding one is how half your effects end up invisible. */
  get objects(): THREE.Points[] { return [this.additive.points, this.normal.points]; }

  /** Prefer this over adding the objects by hand: it cannot add only one layer. */
  addTo(parent: THREE.Object3D): void { for (const o of this.objects) parent.add(o); }

  private rand(): number {
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 0xffffffff;
  }

  /** Fire a burst. Oldest slots are recycled when full — a burst is never dropped silently. */
  burst(preset: ParticlePreset, x: number, y: number, z: number, scale = 1): void {
    const spec = PARTICLE_PRESETS[preset] ?? PARTICLE_PRESETS.impact;
    // The preset chooses its own blend mode. Smoke must never be routed through the additive layer.
    const layer = spec.additive ? this.additive : this.normal;
    layer.spawn(spec, x, y, z, scale, () => this.rand());
  }

  /** Call from the FIXED update. */
  update(delta: number): void {
    this.additive.update(delta);
    this.normal.update(delta);
  }

  get activeCount(): number { return this.additive.activeCount + this.normal.activeCount; }

  dispose(): void { this.additive.dispose(); this.normal.dispose(); }
}
`;

const SYNTH = `/**
 * Game sounds made from CODE — the reason a NavBharatAI game is never silent.
 *
 * The audio manager plays a sound by NAME ('shoot', 'hit', 'jump'…), and the feedback table fires those
 * names on every hit and pickup. A generated game ships no sound files, so before this every one of those
 * calls found nothing to play and every game was silent. Each name now has a RECIPE here: a few layers of
 * oscillator or noise, each with a pitch sweep, a filter sweep and an envelope — the way the classic arcade
 * sound tools work. They are rendered to samples once, on first use, and cached.
 *
 * Pure: no DOM, no AudioContext. \`synthesize(name, sampleRate)\` returns the samples, so the same sound
 * can be checked in a test exactly as the player hears it. A file loaded under the same name always wins.
 */
export type Wave = 'sine' | 'square' | 'saw' | 'triangle' | 'noise' | 'brown';

export interface SynthLayer {
  wave: Wave;
  /** Start → end frequency in Hz, swept exponentially. Ignored by noise. */
  freq?: [number, number];
  /** Seconds after the sound starts. */
  start?: number;
  attack?: number;
  hold?: number;
  /** Seconds from full level to −60 dB. */
  decay: number;
  gain?: number;
  /** One-pole low-pass, start → end cutoff in Hz (applied twice: 12 dB per octave). */
  lowpass?: [number, number];
  /** Square-wave duty cycle, 0..1. */
  duty?: number;
  /** An arpeggio: semitone offsets stepped every \`step\` seconds. */
  notes?: number[];
  step?: number;
  /** [rate Hz, depth semitones] */
  vibrato?: [number, number];
  /** Tremolo, [rate Hz, depth 0..1]. */
  am?: [number, number];
}

export interface SynthRecipe {
  layers: SynthLayer[];
  /** A seamless loop of this many seconds (rain, wind). Play it with { loop: true }. */
  loop?: number;
  /** Peak level after normalising. */
  level?: number;
}

const shot = (body: number, tail: number): SynthLayer[] => [
  { wave: 'noise', decay: tail, lowpass: [7000, 700], gain: 1 },
  { wave: 'square', freq: [240, 55], decay: tail * 0.7, duty: 0.5, lowpass: [2400, 600], gain: 0.45 },
  { wave: 'brown', decay: body, lowpass: [500, 140], gain: 0.9 },
];
const boom = (len: number): SynthLayer[] => [
  { wave: 'brown', decay: len, lowpass: [900, 110], gain: 1 },
  { wave: 'noise', decay: len * 0.45, lowpass: [3200, 220], gain: 0.7 },
  { wave: 'sine', freq: [95, 32], decay: len * 0.5, gain: 0.8 },
];

export const SYNTH_RECIPES: Record<string, SynthRecipe> = {
  // Weapons
  shoot:       { layers: shot(0.22, 0.18) },
  shotgun:     { layers: shot(0.45, 0.34) },
  laser:       { layers: [{ wave: 'square', freq: [1500, 170], decay: 0.2, duty: 0.25, lowpass: [6000, 1500], gain: 0.7 }] },
  empty:       { layers: [{ wave: 'noise', decay: 0.03, lowpass: [8000, 5000], gain: 0.6 }, { wave: 'square', freq: [2600, 2200], decay: 0.025, gain: 0.25 }], level: 0.5 },
  reload:      { layers: [{ wave: 'noise', decay: 0.06, lowpass: [3500, 1500], gain: 0.8 }, { wave: 'noise', start: 0.2, decay: 0.08, lowpass: [2600, 900], gain: 1 }, { wave: 'square', start: 0.21, freq: [700, 500], decay: 0.04, gain: 0.25 }], level: 0.6 },
  swing:       { layers: [{ wave: 'noise', attack: 0.06, decay: 0.2, lowpass: [700, 2600], gain: 1 }], level: 0.55 },
  // Hits and bodies
  impact:      { layers: [{ wave: 'noise', decay: 0.09, lowpass: [3500, 400], gain: 0.8 }, { wave: 'sine', freq: [170, 60], decay: 0.12, gain: 0.7 }] },
  hit:         { layers: [{ wave: 'noise', decay: 0.1, lowpass: [2600, 300], gain: 0.8 }, { wave: 'triangle', freq: [210, 80], decay: 0.14, gain: 0.8 }] },
  hurt:        { layers: [{ wave: 'square', freq: [460, 170], decay: 0.24, duty: 0.5, lowpass: [2200, 900], gain: 0.7 }, { wave: 'noise', decay: 0.08, lowpass: [1600, 400], gain: 0.35 }] },
  die:         { layers: [{ wave: 'saw', freq: [420, 60], decay: 0.55, lowpass: [2600, 500], gain: 0.8 }, { wave: 'noise', decay: 0.3, lowpass: [900, 200], gain: 0.4 }] },
  death:       { layers: [{ wave: 'saw', freq: [320, 40], decay: 1.2, lowpass: [1800, 260], gain: 0.7 }, { wave: 'brown', decay: 1.1, lowpass: [320, 90], gain: 0.8 }, { wave: 'square', freq: [330, 330], notes: [0, -3, -7, -12], step: 0.18, decay: 0.95, duty: 0.5, lowpass: [2000, 900], gain: 0.25 }] },
  explosion:   { layers: boom(1.3) },
  boss_die:    { layers: [...boom(2.2), ...boom(1.6).map((l) => ({ ...l, start: 0.35 }))] },
  // Movement
  jump:        { layers: [{ wave: 'square', freq: [190, 560], decay: 0.17, duty: 0.25, lowpass: [3200, 3200], gain: 0.6 }], level: 0.55 },
  land:        { layers: [{ wave: 'brown', decay: 0.13, lowpass: [520, 120], gain: 1 }, { wave: 'noise', decay: 0.05, lowpass: [1300, 500], gain: 0.3 }], level: 0.6 },
  step:        { layers: [{ wave: 'noise', decay: 0.05, lowpass: [1000, 400], gain: 1 }], level: 0.35 },
  // Rewards
  pickup:      { layers: [{ wave: 'square', freq: [988, 988], notes: [0, 5], step: 0.07, decay: 0.32, duty: 0.5, lowpass: [5200, 5200], gain: 0.55 }], level: 0.55 },
  coin:        { layers: [{ wave: 'square', freq: [988, 988], notes: [0, 5], step: 0.07, decay: 0.32, duty: 0.5, lowpass: [5200, 5200], gain: 0.55 }], level: 0.55 },
  heal:        { layers: [{ wave: 'sine', freq: [523, 523], notes: [0, 4, 7, 12], step: 0.08, decay: 0.6, vibrato: [6, 0.15], gain: 0.7 }, { wave: 'triangle', freq: [261.6, 261.6], notes: [0, 4, 7, 12], step: 0.08, decay: 0.6, gain: 0.35 }], level: 0.55 },
  powerup:     { layers: [{ wave: 'square', freq: [300, 1250], decay: 0.48, duty: 0.5, vibrato: [14, 0.6], lowpass: [4200, 4200], gain: 0.6 }], level: 0.55 },
  combo:       { layers: [{ wave: 'square', freq: [660, 660], notes: [0, 7], step: 0.05, decay: 0.2, duty: 0.25, lowpass: [5000, 5000], gain: 0.5 }], level: 0.45 },
  newbest:     { layers: [{ wave: 'square', freq: [523, 523], notes: [0, 4, 7, 12], step: 0.1, decay: 0.85, duty: 0.5, lowpass: [4200, 4200], gain: 0.45 }, { wave: 'triangle', freq: [261.6, 261.6], notes: [0, 4, 7, 12], step: 0.1, decay: 0.85, gain: 0.45 }], level: 0.6 },
  levelup:     { layers: [{ wave: 'triangle', freq: [392, 392], notes: [0, 4, 7, 12, 16], step: 0.09, decay: 0.95, vibrato: [5, 0.12], gain: 0.7 }, { wave: 'sine', freq: [784, 784], notes: [0, 4, 7, 12, 16], step: 0.09, decay: 0.8, gain: 0.3 }], level: 0.6 },
  achievement: { layers: [{ wave: 'triangle', freq: [784, 784], notes: [0, 7, 12], step: 0.12, decay: 0.75, gain: 0.7 }, { wave: 'sine', freq: [1568, 1568], start: 0.24, decay: 0.5, vibrato: [7, 0.1], gain: 0.35 }], level: 0.55 },
  // Interface
  click:       { layers: [{ wave: 'sine', freq: [1800, 1500], decay: 0.035, gain: 0.6 }, { wave: 'noise', decay: 0.012, lowpass: [6000, 6000], gain: 0.2 }], level: 0.35 },
  error:       { layers: [{ wave: 'square', freq: [200, 200], notes: [0, -1], step: 0.12, decay: 0.3, duty: 0.5, lowpass: [1500, 1500], gain: 0.6 }], level: 0.45 },
  // Weather and world
  thunder:     { layers: [{ wave: 'noise', decay: 0.3, lowpass: [4200, 600], gain: 0.7 }, { wave: 'brown', start: 0.05, attack: 0.25, decay: 3.6, lowpass: [280, 120], am: [3.2, 0.5], gain: 1 }], level: 0.9 },
  rain:        { loop: 3, layers: [{ wave: 'noise', hold: 3, decay: 0, lowpass: [5200, 5200], gain: 0.5 }, { wave: 'brown', hold: 3, decay: 0, lowpass: [420, 420], gain: 0.45 }], level: 0.4 },
  wind:        { loop: 4, layers: [{ wave: 'brown', hold: 4, decay: 0, lowpass: [520, 520], am: [0.5, 0.6], gain: 1 }], level: 0.45 },
};

export const SYNTH_NAMES: readonly string[] = Object.keys(SYNTH_RECIPES);

/** One-shots are capped so a mistyped recipe can never allocate a minute of audio. */
const MAX_SECONDS = 4.5;

function layerLength(l: SynthLayer): number {
  return (l.start ?? 0) + (l.attack ?? 0) + (l.hold ?? 0) + l.decay;
}

/**
 * Render a named sound to mono samples in -1..1, or null for a name with no recipe. Deterministic: the
 * same name, rate and seed give the same samples.
 */
export function synthesize(name: string, sampleRate = 44100, seed = 1): Float32Array | null {
  const recipe = SYNTH_RECIPES[name];
  if (!recipe) return null;
  const sr = Math.max(8000, sampleRate);
  const loop = recipe.loop ?? 0;
  // A loop renders a little extra and folds it back over its start, so the seam is a crossfade, not a click.
  const fold = loop ? Math.min(0.3, loop / 4) : 0;
  const seconds = loop ? loop + fold : Math.min(MAX_SECONDS, Math.max(...recipe.layers.map(layerLength)) + 0.01);
  const n = Math.max(1, Math.round(seconds * sr));
  const out = new Float32Array(n);
  let s = (seed * 2654435761) >>> 0 || 1;
  const rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 0xffffffff) * 2 - 1; };

  for (const l of recipe.layers) {
    const start = Math.round((l.start ?? 0) * sr);
    const attack = (l.attack ?? 0) * sr, hold = (l.hold ?? 0) * sr, decay = l.decay * sr;
    const len = loop ? n : Math.min(n - start, Math.ceil(attack + hold + decay));
    const [f0, f1] = l.freq ?? [440, 440];
    const [c0, c1] = l.lowpass ?? [0, 0];
    let phase = 0, brown = 0, lp1 = 0, lp2 = 0;
    const gain = l.gain ?? 1;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const u = len > 1 ? i / (len - 1) : 0;
      let env: number;
      if (i < attack) env = i / attack;
      else if (i < attack + hold || decay <= 0) env = 1;
      else env = Math.exp(-6.9 * (i - attack - hold) / decay);
      if (l.am) env *= 1 - l.am[1] * 0.5 * (1 + Math.sin(2 * Math.PI * l.am[0] * t));
      let semis = 0;
      if (l.notes && l.notes.length) semis += l.notes[Math.min(l.notes.length - 1, Math.floor(t / (l.step ?? 0.1)))];
      if (l.vibrato) semis += l.vibrato[1] * Math.sin(2 * Math.PI * l.vibrato[0] * t);
      const f = f0 * Math.pow(f1 / f0, u) * Math.pow(2, semis / 12);
      phase = (phase + f / sr) % 1;
      let v: number;
      switch (l.wave) {
        case 'sine': v = Math.sin(2 * Math.PI * phase); break;
        case 'square': v = phase < (l.duty ?? 0.5) ? 1 : -1; break;
        case 'saw': v = 2 * phase - 1; break;
        case 'triangle': v = 1 - 4 * Math.abs(phase - 0.5); break;
        case 'noise': v = rand(); break;
        default: brown = (brown + 0.02 * rand()) / 1.02; v = brown * 3.5;
      }
      if (c0 > 0) {
        const c = c0 * Math.pow(Math.max(1, c1) / c0, u);
        const a = 1 - Math.exp((-2 * Math.PI * Math.min(c, sr * 0.45)) / sr);
        lp1 += a * (v - lp1); lp2 += a * (lp1 - lp2); v = lp2;
      }
      out[start + i] += v * env * gain;
    }
  }

  let samples = out;
  if (loop) {
    const L = Math.round(loop * sr), X = n - L;
    samples = out.slice(0, L);
    for (let i = 0; i < X; i++) {
      const w = i / X;                                  // equal-power crossfade of the tail into the head
      samples[i] = out[i] * Math.sin(w * Math.PI / 2) + out[L + i] * Math.cos(w * Math.PI / 2);
    }
  } else {
    // 3 ms in and out: a sound that starts or stops on a non-zero sample clicks.
    const edge = Math.min(Math.floor(samples.length / 4), Math.round(0.003 * sr));
    for (let i = 0; i < edge; i++) { const w = i / edge; samples[i] *= w; samples[samples.length - 1 - i] *= w; }
  }
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const k = peak > 0 ? (recipe.level ?? 0.8) / peak : 0;
  for (let i = 0; i < samples.length; i++) samples[i] *= k;
  return samples;
}
`;

const AUDIO = `/**
 * Audio through the Web Audio API.
 *
 * NOT <audio> ELEMENTS. They carry tens of milliseconds of latency and browsers cap how many can play
 * at once, so a gunshot lands after its muzzle flash and the tenth footstep is silent. For a game,
 * Web Audio is the only correct choice.
 *
 * THE ONE LINE EVERY HAND-ROLLED ATTEMPT MISSES: every browser suspends the AudioContext until a user
 * gesture. That is THE reason "there is no sound in my web game" — the code is fine and the context was
 * never resumed. \`unlock()\` is wired to the first pointer/key event and is the difference between a
 * game with sound and one without.
 */
import { synthesize, SYNTH_NAMES } from './synth';
import { renderMusic, musicLoops } from './music';

export type SoundCategory = 'music' | 'sfx' | 'ui';

export interface PlayOptions {
  volume?: number;
  /** Random detune in cents, ±. Repeating a sample at the SAME pitch is what makes it sound robotic. */
  detune?: number;
  loop?: boolean;
  /** World position for 3D falloff. Omit for a 2D sound. */
  position?: { x: number; y: number; z: number };
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<SoundCategory, GainNode | null> = { music: null, sfx: null, ui: null };
  private buffers = new Map<string, AudioBuffer>();
  /** Built-in voices rendered from synth.ts, kept apart so a file loaded later still wins. */
  private synthesized = new Map<string, AudioBuffer>();
  private playing = new Set<AudioBufferSourceNode>();
  private unlocked = false;
  private seed = 987;
  /** The music: one track at a time, crossfaded, through a duck gain so pauses and dialogue can lower it. */
  private music: { name: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private musicDuck: GainNode | null = null;
  private ducked = false;
  /** Hard voice cap: fifty simultaneous explosions clip the master and turn the mix to mud. */
  private readonly maxVoices: number;

  constructor(maxVoices = 32) { this.maxVoices = maxVoices; }

  /**
   * MUST be called from a real user gesture. Safe to call repeatedly; the listeners remove themselves.
   */
  unlock(): void {
    if (this.unlocked) return;
    const resume = () => {
      if (!this.ctx) this.init();
      void this.ctx?.resume();
      this.unlocked = true;
      this.prewarm();
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      window.removeEventListener('touchstart', resume);
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    window.addEventListener('touchstart', resume);
  }

  private init(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return; // no Web Audio: the game must still run, just silent
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);
    for (const cat of ['music', 'sfx', 'ui'] as SoundCategory[]) {
      const g = this.ctx.createGain();
      g.gain.value = cat === 'music' ? 0.6 : 0.85;
      g.connect(this.master);
      this.buses[cat] = g;
    }
    this.musicDuck = this.ctx.createGain();
    this.musicDuck.gain.value = 1;
    this.musicDuck.connect(this.buses.music!);
  }

  /** The buffer for a mood: a file loaded as 'music:<name>', else the track music.ts writes. */
  private musicBuffer(name: string): AudioBuffer | undefined {
    if (!this.ctx) return undefined;
    const file = this.buffers.get('music:' + name);
    if (file) return file;
    const key = 'music:' + name;
    const ready = this.synthesized.get(key);
    if (ready) return ready;
    const samples = renderMusic(name, this.ctx.sampleRate);
    if (!samples) return undefined;
    const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    this.synthesized.set(key, buffer);
    return buffer;
  }

  /** What is playing now (null for silence). */
  get musicName(): string | null { return this.music?.name ?? null; }
  get musicDucked(): boolean { return this.ducked; }

  /**
   * Play a music mood (calm, action, tense, victory, defeat, or any name loaded as 'music:<name>'), crossfading from
   * whatever was playing. The same mood already playing carries on — a restart does not jolt the music.
   */
  playMusic(name: string, options: { fade?: number; volume?: number } = {}): void {
    this.init();
    if (!this.ctx || !this.musicDuck) return;
    if (this.music?.name === name) return;
    const buffer = this.musicBuffer(name);
    if (!buffer) return;
    const fade = Math.max(0.01, options.fade ?? 1.2);
    this.stopMusic(fade);
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = this.buffers.has('music:' + name) ? true : musicLoops(name);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(options.volume ?? 1, now + fade);
    src.connect(gain);
    gain.connect(this.musicDuck);
    const track = { name, src, gain };
    src.onended = () => { if (this.music === track) this.music = null; };
    src.start();
    this.music = track;
  }

  /** Fade the music out. */
  stopMusic(fade = 0.8): void {
    const m = this.music;
    this.music = null;
    if (!m || !this.ctx) return;
    const now = this.ctx.currentTime;
    m.gain.gain.cancelScheduledValues(now);
    m.gain.gain.setValueAtTime(m.gain.gain.value, now);
    m.gain.gain.linearRampToValueAtTime(0, now + fade);
    try { m.src.stop(now + fade + 0.05); } catch { /* already ended */ }
  }

  /** Lower the music (a pause, a conversation) or bring it back. */
  duckMusic(on: boolean, level = 0.3): void {
    this.init();
    this.ducked = on;
    if (!this.ctx || !this.musicDuck) return;
    this.musicDuck.gain.setTargetAtTime(on ? level : 1, this.ctx.currentTime, 0.12);
  }

  /**
   * The built-in voice for a name with no loaded file, rendered once and cached. Undefined for a name
   * synth.ts has no recipe for.
   */
  private voice(name: string): AudioBuffer | undefined {
    if (!this.ctx) return undefined;
    const ready = this.synthesized.get(name);
    if (ready) return ready;
    const samples = synthesize(name, this.ctx.sampleRate);
    if (!samples) return undefined;
    const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    this.synthesized.set(name, buffer);
    return buffer;
  }

  /**
   * Render every built-in voice ahead of time, one per tick, so the first gunshot does not pay for its
   * own synthesis mid-fight. Runs by itself after unlock().
   */
  prewarm(names: readonly string[] = SYNTH_NAMES): void {
    const queue = names.filter((n) => !this.buffers.has(n) && !this.synthesized.has(n));
    const next = () => { const n = queue.shift(); if (!n) return; this.voice(n); setTimeout(next, 0); };
    setTimeout(next, 0);
  }

  /** True when a name will make a sound: a loaded file or a built-in voice. */
  has(name: string): boolean { return this.buffers.has(name) || SYNTH_NAMES.includes(name); }

  async load(name: string, url: string): Promise<boolean> {
    this.init();
    if (!this.ctx) return false;
    try {
      const res = await fetch(url);
      const raw = await res.arrayBuffer();
      this.buffers.set(name, await this.ctx.decodeAudioData(raw));
      return true;
    } catch {
      // A missing sound must never break the game — it plays silently and says so in the console.
      console.warn('[audio] could not load ' + name + ' from ' + url);
      return false;
    }
  }

  private rand(): number {
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 0xffffffff;
  }

  /**
   * Play a sound by name. A file loaded under that name plays; otherwise its built-in voice from
   * synth.ts does — so a game with no sound files is still never silent. Returns a stop function (for a
   * loop: rain, wind), which does nothing once the sound has ended.
   */
  play(name: string, category: SoundCategory = 'sfx', options: PlayOptions = {}): () => void {
    const none = () => undefined;
    this.init();
    const buffer = this.buffers.get(name) ?? this.voice(name);
    if (!this.ctx || !buffer || !this.buses[category]) return none;
    if (this.playing.size >= this.maxVoices) return none; // refuse rather than mud the mix

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!options.loop;
    // ±detune cents of variation: the same footstep at the same pitch every step sounds mechanical.
    const spread = options.detune ?? (category === 'sfx' ? 120 : 0);
    if (spread > 0) src.detune.value = (this.rand() * 2 - 1) * spread;

    const gain = this.ctx.createGain();
    gain.gain.value = options.volume ?? 1;

    let tail: AudioNode = gain;
    if (options.position) {
      const panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 4;
      panner.maxDistance = 90;
      panner.positionX.value = options.position.x;
      panner.positionY.value = options.position.y;
      panner.positionZ.value = options.position.z;
      gain.connect(panner);
      tail = panner;
    }
    src.connect(gain);
    tail.connect(this.buses[category]!);

    this.playing.add(src);
    // Without this the set grows forever and the voice cap silences the game after a few minutes.
    src.onended = () => { this.playing.delete(src); };
    src.start();
    return () => { try { src.stop(); } catch { /* already ended */ } this.playing.delete(src); };
  }

  setVolume(category: SoundCategory | 'master', value: number): void {
    this.init();
    const v = Math.max(0, Math.min(1, value));
    if (category === 'master') { if (this.master) this.master.gain.value = v; return; }
    const bus = this.buses[category];
    if (bus) bus.gain.value = v;
  }

  /** Move the LISTENER with the camera, or 3D audio pans from the wrong place. */
  setListener(x: number, y: number, z: number): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) { l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z; }
  }

  stopAll(): void {
    for (const src of [...this.playing]) { try { src.stop(); } catch { /* already ended */ } }
    this.playing.clear();
    if (this.music) { try { this.music.src.stop(); } catch { /* already ended */ } this.music = null; }
  }
}

export const audio = new AudioManager();
`;

const MUSIC_FILE = `/**
 * MUSIC WRITTEN BY CODE (admin 2026-11-19 game-gap audit: "background music nahi" — the music bus and the music volume
 * slider existed and nothing ever played on them). Five moods, rendered once into a buffer on first use: no file, no
 * download, so a game is never musically silent. A file loaded as 'music:<mood>' replaces a mood.
 *
 *   calm    — the start screen          action  — playing           tense — a boss is up
 *   victory — a short sting on a win    defeat  — a short sting on a loss
 * The loops are seamless: a note that rings past the end is folded back over the start, so there is no click.
 */
export type MusicMood = 'calm' | 'action' | 'tense' | 'victory' | 'defeat';
export const MUSIC_MOODS: readonly MusicMood[] = ['calm', 'action', 'tense', 'victory', 'defeat'];

interface Style {
  bpm: number; bars: number; root: number; minor: boolean;
  /** One scale degree per bar: the chord. */
  prog: number[];
  drums: 'none' | 'light' | 'full';
  /** Arpeggio notes per beat (0 = none). */
  arp: number;
  loop: boolean; level: number;
}

const STYLES: Record<MusicMood, Style> = {
  calm:    { bpm: 84,  bars: 8, root: 57, minor: false, prog: [0, 5, 3, 4, 0, 5, 3, 4], drums: 'none',  arp: 2, loop: true,  level: 0.5 },
  action:  { bpm: 128, bars: 8, root: 50, minor: true,  prog: [0, 5, 2, 6, 0, 5, 3, 4], drums: 'full',  arp: 2, loop: true,  level: 0.62 },
  tense:   { bpm: 140, bars: 4, root: 52, minor: true,  prog: [0, 0, 1, 0],             drums: 'full',  arp: 4, loop: true,  level: 0.62 },
  victory: { bpm: 132, bars: 2, root: 60, minor: false, prog: [0, 4],                   drums: 'light', arp: 4, loop: false, level: 0.7 },
  defeat:  { bpm: 72,  bars: 2, root: 57, minor: true,  prog: [0, 5],                   drums: 'none',  arp: 0, loop: false, level: 0.55 },
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
const note = (st: Style, degree: number, octave = 0): number => {
  const scale = st.minor ? MINOR : MAJOR;
  const d = ((degree % 7) + 7) % 7;
  return st.root + scale[d] + 12 * (octave + Math.floor(degree / 7));
};

type Wave = 'sine' | 'tri' | 'saw' | 'square';

/** Render one musical moment into the track. */
function tone(out: Float32Array, sr: number, wrap: boolean, at: number, dur: number, freq: number, wave: Wave, gain: number, attack: number, release: number, cutoff = 1): void {
  const start = Math.floor(at * sr), len = Math.floor((dur + release) * sr), a = Math.max(1, attack * sr), sus = dur * sr, rel = Math.max(1, release * sr);
  let phase = 0, lp = 0;
  const step = freq / sr;
  for (let i = 0; i < len; i++) {
    phase += step; phase -= Math.floor(phase);
    let v = wave === 'sine' ? Math.sin(phase * 2 * Math.PI)
      : wave === 'tri' ? 1 - 4 * Math.abs(phase - 0.5)
      : wave === 'saw' ? 2 * phase - 1
      : phase < 0.5 ? 1 : -1;
    lp += (v - lp) * cutoff; v = lp;
    const env = i < a ? i / a : i < sus ? 1 : Math.max(0, 1 - (i - sus) / rel);
    let k = start + i;
    if (k >= out.length) { if (!wrap) break; k %= out.length; }
    out[k] += v * env * env * gain;
  }
}

function drum(out: Float32Array, sr: number, wrap: boolean, at: number, kind: 'kick' | 'snare' | 'hat', seedBox: { s: number }): void {
  const rnd = (): number => { let x = seedBox.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; seedBox.s = x; return ((x >>> 0) / 0xffffffff) * 2 - 1; };
  const len = Math.floor((kind === 'kick' ? 0.32 : kind === 'snare' ? 0.18 : 0.05) * sr);
  const start = Math.floor(at * sr);
  let phase = 0, prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr, env = Math.pow(1 - i / len, kind === 'hat' ? 3 : 2);
    let v: number;
    if (kind === 'kick') { phase += (45 + 75 * Math.exp(-t * 30)) / sr; v = Math.sin(phase * 2 * Math.PI) * 0.9; }
    else if (kind === 'snare') { phase += 185 / sr; v = rnd() * 0.5 + Math.sin(phase * 2 * Math.PI) * 0.3; }
    else { const n = rnd(); v = (n - prev) * 0.25; prev = n; }
    let k = start + i;
    if (k >= out.length) { if (!wrap) break; k %= out.length; }
    out[k] += v * env;
  }
}

/** Render a mood. A loop is exactly \`bars\` long; a sting gets a short tail to ring out. Deterministic. */
export function renderMusic(mood: string, sampleRate: number): Float32Array | null {
  const st = STYLES[mood as MusicMood];
  if (!st || !(sampleRate > 0)) return null;
  const beat = 60 / st.bpm, bar = beat * 4, total = st.bars * bar;
  const out = new Float32Array(Math.round((st.loop ? total : total + 1.2) * sampleRate));
  const wrap = st.loop, seed = { s: 12345 };
  st.prog.forEach((degree, b) => {
    const t0 = b * bar;
    const chord = [note(st, degree), note(st, degree + 2), note(st, degree + 4)];
    // Pad: a soft chord across the bar.
    for (const m of chord) tone(out, sampleRate, wrap, t0, bar * 0.92, hz(m), 'saw', 0.05, 0.25, 0.4, 0.06);
    // Bass: the root on every beat (a sting holds it).
    if (st.loop) for (let q = 0; q < 4; q++) tone(out, sampleRate, wrap, t0 + q * beat, beat * 0.7, hz(chord[0] - 12), 'tri', 0.22, 0.01, 0.08);
    else tone(out, sampleRate, wrap, t0, bar * 0.9, hz(chord[0] - 12), 'tri', 0.22, 0.01, 0.6);
    // Arpeggio: up the chord, an octave higher.
    if (st.arp > 0) {
      const n = st.arp * 4, each = bar / n;
      for (let i = 0; i < n; i++) tone(out, sampleRate, wrap, t0 + i * each, each * 0.6, hz(chord[i % 3] + 12), st.loop ? 'square' : 'tri', 0.06, 0.005, 0.12, 0.2);
    }
    if (st.drums !== 'none') {
      for (let q = 0; q < 4; q++) {
        const t = t0 + q * beat;
        if (q % 2 === 0 || st.drums === 'full') drum(out, sampleRate, wrap, t, 'kick', seed);
        if (q % 2 === 1 && st.drums === 'full') drum(out, sampleRate, wrap, t, 'snare', seed);
        drum(out, sampleRate, wrap, t + beat / 2, 'hat', seed);
      }
    }
  });
  if (mood === 'defeat') {
    // A falling line over the chords: the round is over.
    [7, 5, 4, 2, 0].forEach((d, i) => tone(out, sampleRate, wrap, i * beat * 1.5, beat * 1.3, hz(note(st, d, 1)), 'tri', 0.12, 0.02, 0.3));
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) { const k = st.level / peak; for (let i = 0; i < out.length; i++) out[i] *= k; }
  return out;
}

/** True when the mood loops (play it with loop on); stings play once. */
export function musicLoops(mood: string): boolean { return STYLES[mood as MusicMood]?.loop ?? true; }
`;

const FEEDBACK = `import { events, type GameEvent } from '../core/events';
import type { GameFeel } from '../core/feel';
import type { ParticleSystem, ParticlePreset } from './particles';
import { audio, type SoundCategory } from './audio';
import { buzz } from '../core/meta';

/**
 * ONE TABLE, ONE PLACE — the reason a hit feels like force instead of a state change.
 *
 * A hit that plays only an animation reads as a glitch. The same hit with a particle, a sound, a frame
 * of hit-stop and a nudge of camera shake reads as WEIGHT — and nothing about the geometry changed.
 *
 * That combination is one feature, not four, so it is authored here rather than scattered through
 * gameplay code. Scattered, it drifts: someone adds the sound and forgets the shake, and half the game
 * ends up feeling weaker than the other half for no reason anyone can name.
 *
 * Gameplay stays clean — it emits an event and knows nothing about particles or audio.
 */
export interface FeedbackSpec {
  particle?: ParticlePreset;
  particleScale?: number;
  sound?: string;
  /** The bus it plays on. Rewards belong on 'ui', so a player can turn effects down and still hear them. */
  category?: SoundCategory;
  /** 0..1 — light hit ~0.2, heavy ~0.5, explosion ~0.9. */
  trauma?: number;
  /** Seconds of frozen simulation. 0.05 is a punch, 0.12 is a kill. */
  hitStop?: number;
  /**
   * A phone vibration (ms, or a pattern) — felt in the hand, the one sense a phone game had left unused (admin
   * 2026-11-19 audit: vibration fired only on rewards, never on a hit). buzz() obeys the player's Vibration setting.
   */
  haptic?: number | number[];
}

/** The default reactions. Tuned so a small event is felt and a big one is not overwhelming. */
export const FEEDBACK: Partial<Record<GameEvent, FeedbackSpec>> = {
  WEAPON_FIRED:   { particle: 'muzzleFlash', sound: 'shoot',    trauma: 0.14, hitStop: 0.02 },
  PROJECTILE_HIT: { particle: 'impact',      sound: 'impact',   trauma: 0.10, haptic: 12 },
  ENEMY_DAMAGED:  { particle: 'blood',       sound: 'hit',      trauma: 0.12, hitStop: 0.04 },
  ENEMY_DIED:     { particle: 'explosion',   sound: 'die',      trauma: 0.35, hitStop: 0.09, particleScale: 0.8, haptic: 30 },
  PLAYER_DAMAGED: { particle: 'blood',       sound: 'hurt',     trauma: 0.45, hitStop: 0.07, haptic: [45, 30, 45] },
  PLAYER_DIED:    { particle: 'explosion',   sound: 'death',    trauma: 0.85, hitStop: 0.16, haptic: [90, 50, 160] },
  PLAYER_JUMPED:  { sound: 'jump' },
  PLAYER_LANDED:  { particle: 'dust',        sound: 'land',     trauma: 0.06, particleScale: 0.6, haptic: 10 },
  ITEM_COLLECTED: { particle: 'pickup',      sound: 'pickup' },
  PLAYER_HEALED:  { particle: 'heal',        sound: 'heal' },
  BOSS_DEFEATED:  { particle: 'explosion',   sound: 'boss_die', trauma: 1.0,  hitStop: 0.25, particleScale: 2, haptic: [80, 40, 80, 40, 200] },
  // A weapon's whole cycle is heard, not only the bang: the dry click is what tells a player to reload.
  WEAPON_EMPTY:   { sound: 'empty' },
  WEAPON_RELOADED: { sound: 'reload' },
  MELEE_SWING:    { sound: 'swing' },
  MELEE_HIT:      { sound: 'hit',      trauma: 0.2,  hitStop: 0.05, haptic: 25 },
  // The rewards that bring a player back are HEARD as well as shown (meta.ts) — on the UI bus.
  COMBO_MILESTONE: { sound: 'combo',   category: 'ui' },
  NEW_BEST:       { sound: 'newbest',  category: 'ui' },
  LEVEL_UP:       { sound: 'levelup',  category: 'ui' },
  ACHIEVEMENT_UNLOCKED: { sound: 'achievement', category: 'ui' },
  GOAL_COMPLETED: { sound: 'coin',     category: 'ui' },
  DAILY_REWARD:   { sound: 'coin',     category: 'ui' },
};

/**
 * THE MUSIC FOLLOWS THE GAME: the start screen is calm, play is action, a boss is tense, a win or a loss gets its
 * sting; a pause or a conversation lowers it. A mood name plays it; 'duck' / 'unduck' lower and restore it.
 */
export type MusicCue = string | 'duck' | 'unduck' | null;
export const MUSIC: Partial<Record<GameEvent, MusicCue>> = {
  GAME_MENU: 'calm',
  GAME_STARTED: 'action',
  GAME_PAUSED: 'duck',
  GAME_RESUMED: 'unduck',
  BOSS_SPAWNED: 'tense',
  BOSS_DEFEATED: 'action',
  GAME_WON: 'victory',
  GAME_OVER: 'defeat',
  DIALOGUE_STARTED: 'duck',
  DIALOGUE_ENDED: 'unduck',
};

export interface FeedbackContext {
  /** false = no music; a table replaces (merges over) the default cues. */
  music?: false | Partial<Record<GameEvent, MusicCue>>;
  particles?: ParticleSystem;
  feel?: GameFeel;
  /** Where the effect happens. Payloads that omit it get no particle rather than one at the origin. */
  positionOf?: (payload: any) => { x: number; y: number; z: number } | null;
}

/**
 * Subscribe every reaction. Returns an unsubscribe — a scene torn down without it leaks its handlers
 * and the NEXT scene plays two sounds per hit.
 */
export function bindGameFeedback(ctx: FeedbackContext, table = FEEDBACK): () => void {
  const offs: Array<() => void> = [];
  for (const [event, spec] of Object.entries(table)) {
    if (!spec) continue;
    offs.push(events.on(event, (payload) => {
      const pos = ctx.positionOf ? ctx.positionOf(payload) : (payload?.position ?? null);
      // No position means no particle. A burst at the world origin is worse than none — it looks like
      // a bug happening somewhere else in the level.
      if (spec.particle && ctx.particles && pos) {
        ctx.particles.burst(spec.particle, pos.x, pos.y, pos.z, spec.particleScale ?? 1);
      }
      if (spec.sound) audio.play(spec.sound, spec.category ?? 'sfx', pos ? { position: pos } : {});
      if (ctx.feel) {
        if (spec.trauma) ctx.feel.addTrauma(spec.trauma);
        if (spec.hitStop) ctx.feel.addHitStop(spec.hitStop);
      }
      if (spec.haptic) buzz(spec.haptic);
    }));
  }
  if (ctx.music !== false) {
    const cues = { ...MUSIC, ...(ctx.music ?? {}) };
    for (const [event, cue] of Object.entries(cues)) {
      if (!cue) continue;
      offs.push(events.on(event, () => {
        if (cue === 'duck') audio.duckMusic(true);
        else if (cue === 'unduck') audio.duckMusic(false);
        else { audio.duckMusic(false); audio.playMusic(cue); }
      }));
    }
    offs.push(() => audio.stopMusic(0.3));
  }
  return () => { for (const off of offs) off(); };
}
`;

const FILES: Record<string, string> = {
  'src/game/fx/particles.ts': PARTICLES,
  'src/game/fx/synth.ts': SYNTH,
  'src/game/fx/music.ts': MUSIC_FILE,
  'src/game/fx/audio.ts': AUDIO,
  'src/game/fx/feedback.ts': FEEDBACK,
};

export const GAME_FX_MODULES: readonly string[] = ['particles', 'synth', 'music', 'audio', 'feedback'];

/**
 * Generate the VFX/audio layer. `feedback` imports both siblings, so a subset that would not compile is
 * completed. Pure; never throws.
 */
export function generateGameVfxAudio(include?: string[]): GameVfxAudioResult {
  const wanted = Array.isArray(include) && include.length
    ? new Set(include.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
    : null;

  let files: Record<string, string>;
  if (!wanted) {
    files = { ...FILES };
  } else {
    files = {};
    for (const [path, content] of Object.entries(FILES)) {
      const base = (path.split('/').pop() || '').replace(/\.ts$/i, '').toLowerCase();
      if (wanted.has(base)) files[path] = content;
    }
    if (files['src/game/fx/feedback.ts']) {
      // feedback.ts vibrates through core/meta's buzz(), which the runtime recipe writes.
      files['src/game/fx/particles.ts'] = FILES['src/game/fx/particles.ts'];
      files['src/game/fx/audio.ts'] = FILES['src/game/fx/audio.ts'];
    }
    // audio.ts imports its built-in voices; without synth.ts it would not compile.
    if (files['src/game/fx/audio.ts']) { files['src/game/fx/synth.ts'] = FILES['src/game/fx/synth.ts']; files['src/game/fx/music.ts'] = FILES['src/game/fx/music.ts']; }
    if (Object.keys(files).length === 0) files = { ...FILES };
  }

  return {
    files,
    dependencies: [], // particles use the `three` the 3D layer declares; audio is the browser's own API
    instructions:
      `Added VFX + audio (${Object.keys(files).length} files under src/game/fx).\n` +
      '```ts\n' +
      'const particles = new ParticleSystem();\n' +
      'particles.addTo(scene);              // adds BOTH blend layers; adding one hides half your effects\n' +
      "audio.unlock();                       // MUST happen; browsers suspend audio until a gesture\n" +
      "// Every sound the table names already has a built-in voice (synth.ts). A file only REPLACES one:\n" +
      "// await audio.load('shoot', '/sfx/shoot.mp3');\n" +
      "const stopRain = audio.play('rain', 'sfx', { loop: true, volume: 0.5 });   // loops return a stop\n" +
      'const unbind = bindGameFeedback({ particles, feel, positionOf: (p) => p?.position ?? null });\n' +
      '// in the FIXED update: particles.update(dt); audio.setListener(cam.x, cam.y, cam.z);\n' +
      '```\n' +
      'WHY IT FEELS LIKE FORCE:\n' +
      '- ONE table maps each event to particle + sound + trauma + hit-stop. Author reactions THERE, never\n' +
      '  inline in gameplay — scattered, they drift and half the game ends up feeling weaker.\n' +
      '- Gameplay only emits events; it must not import particles or audio.\n' +
      '- audio.unlock() on a real gesture is the single most common reason a web game has no sound.\n' +
      '- A game is NEVER silent: every name in the table (shoot, hit, jump, explosion, pickup, levelup…)\n' +
      '  has a voice synthesised from code in synth.ts — no file, no download. A file loaded under the\n' +
      '  same name replaces it; a file that fails to load logs a warning and the built-in voice plays.\n' +
      '  Extra built-ins: shotgun, laser, swing, reload, empty, step, coin, powerup, combo, newbest,\n' +
      '  achievement, click, error, thunder, and the loops rain and wind.\n' +
      '- particles.update(dt) belongs in the FIXED update. The whole system is TWO draw calls: one\n' +
      '  additive layer (fire, sparks) and one normal layer (smoke, dust, blood). A preset picks its own\n' +
      '  layer, so smoke can never come out glowing.',
  };
}
