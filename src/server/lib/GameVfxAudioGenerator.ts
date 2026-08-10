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
  private playing = new Set<AudioBufferSourceNode>();
  private unlocked = false;
  private seed = 987;
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
  }

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

  play(name: string, category: SoundCategory = 'sfx', options: PlayOptions = {}): void {
    this.init();
    const buffer = this.buffers.get(name);
    if (!this.ctx || !buffer || !this.buses[category]) return;
    if (this.playing.size >= this.maxVoices) return; // refuse rather than mud the mix

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
  }
}

export const audio = new AudioManager();
`;

const FEEDBACK = `import { events, type GameEvent } from '../core/events';
import type { GameFeel } from '../core/feel';
import type { ParticleSystem, ParticlePreset } from './particles';
import { audio } from './audio';

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
  /** 0..1 — light hit ~0.2, heavy ~0.5, explosion ~0.9. */
  trauma?: number;
  /** Seconds of frozen simulation. 0.05 is a punch, 0.12 is a kill. */
  hitStop?: number;
}

/** The default reactions. Tuned so a small event is felt and a big one is not overwhelming. */
export const FEEDBACK: Partial<Record<GameEvent, FeedbackSpec>> = {
  WEAPON_FIRED:   { particle: 'muzzleFlash', sound: 'shoot',    trauma: 0.14, hitStop: 0.02 },
  PROJECTILE_HIT: { particle: 'impact',      sound: 'impact',   trauma: 0.10 },
  ENEMY_DAMAGED:  { particle: 'blood',       sound: 'hit',      trauma: 0.12, hitStop: 0.04 },
  ENEMY_DIED:     { particle: 'explosion',   sound: 'die',      trauma: 0.35, hitStop: 0.09, particleScale: 0.8 },
  PLAYER_DAMAGED: { particle: 'blood',       sound: 'hurt',     trauma: 0.45, hitStop: 0.07 },
  PLAYER_DIED:    { particle: 'explosion',   sound: 'death',    trauma: 0.85, hitStop: 0.16 },
  PLAYER_JUMPED:  { sound: 'jump' },
  PLAYER_LANDED:  { particle: 'dust',        sound: 'land',     trauma: 0.06, particleScale: 0.6 },
  ITEM_COLLECTED: { particle: 'pickup',      sound: 'pickup' },
  PLAYER_HEALED:  { particle: 'heal',        sound: 'heal' },
  BOSS_DEFEATED:  { particle: 'explosion',   sound: 'boss_die', trauma: 1.0,  hitStop: 0.25, particleScale: 2 },
};

export interface FeedbackContext {
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
      if (spec.sound) audio.play(spec.sound, 'sfx', pos ? { position: pos } : {});
      if (ctx.feel) {
        if (spec.trauma) ctx.feel.addTrauma(spec.trauma);
        if (spec.hitStop) ctx.feel.addHitStop(spec.hitStop);
      }
    }));
  }
  return () => { for (const off of offs) off(); };
}
`;

const FILES: Record<string, string> = {
  'src/game/fx/particles.ts': PARTICLES,
  'src/game/fx/audio.ts': AUDIO,
  'src/game/fx/feedback.ts': FEEDBACK,
};

export const GAME_FX_MODULES: readonly string[] = ['particles', 'audio', 'feedback'];

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
      files['src/game/fx/particles.ts'] = FILES['src/game/fx/particles.ts'];
      files['src/game/fx/audio.ts'] = FILES['src/game/fx/audio.ts'];
    }
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
      "await audio.load('shoot', '/sfx/shoot.mp3');\n" +
      'const unbind = bindGameFeedback({ particles, feel, positionOf: (p) => p?.position ?? null });\n' +
      '// in the FIXED update: particles.update(dt); audio.setListener(cam.x, cam.y, cam.z);\n' +
      '```\n' +
      'WHY IT FEELS LIKE FORCE:\n' +
      '- ONE table maps each event to particle + sound + trauma + hit-stop. Author reactions THERE, never\n' +
      '  inline in gameplay — scattered, they drift and half the game ends up feeling weaker.\n' +
      '- Gameplay only emits events; it must not import particles or audio.\n' +
      '- audio.unlock() on a real gesture is the single most common reason a web game has no sound.\n' +
      '- Sound files are yours to supply. A missing one logs a warning and plays silently — the game\n' +
      "  never breaks over audio, and it never pretends a sound played that didn't.\n" +
      '- particles.update(dt) belongs in the FIXED update. The whole system is TWO draw calls: one\n' +
      '  additive layer (fire, sparks) and one normal layer (smoke, dust, blood). A preset picks its own\n' +
      '  layer, so smoke can never come out glowing.',
  };
}
