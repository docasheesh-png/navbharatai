/**
 * 🚓 A CRIME BRINGS REAL POLICE (master audit 2026-11-25, Part I — "Police aa gayi" was only text).
 *
 * The admin's report: "when any crime happens, police should arrive" produced a game that SAID "Police aa gayi" and showed
 * nobody. Root cause, confirmed: the kit had no crime, wanted or dispatch system at all — police existed only as a word in a
 * feature example and as a car asset — so the builder had nothing to call and wrote the sentence instead. A police car model
 * is not a police dispatch.
 *
 * `src/game/systems/dispatch.ts` is the system, built on Entities (systems/entities.ts):
 *   • Dispatch.call(service, target) — any service: police, ambulance, fire, security, military. It resolves a spawn point
 *     (out of the camera's view when it can, inside the map and on ground the game allows), drives a REAL car there with
 *     the kit's own driveVehicle (wheels on the ground, sirens flashing), unloads REAL officers (Entities.spawn, verified),
 *     and they walk to the target. It says "dispatched" only after the car and crew exist, and "arrived" only when an
 *     officer is really at the target (ENTITY_ARRIVED). No valid spawn point, or a spawn that fails, is said as a failure.
 *   • Wanted — crimes the player really did (ENTITY_HURT / ENTITY_DIED with byPlayer) raise a 0–5 star level; each star
 *     brings officers; they pursue, ARREST the player who stays in reach (PLAYER_ARRESTED), and from wantedToFight stars
 *     they fight. Unseen long enough, the level cools and the police stand down and leave.
 */
export const GAME_DISPATCH_PATH = 'src/game/systems/dispatch.ts';

export const GAME_DISPATCH = String.raw`import * as THREE from 'three';
import { events } from '../core/events';
import { createCar, createVehicleState, driveVehicle, watchVehicles, type VehicleState } from '../three/objects';
import { groundHeightAt } from '../three/surfaces';
import type { HumanoidOptions } from '../three/humanoid';
import type { Entities, Entity, EntityHost } from './entities';
import type { Vec2 } from './ai';

export interface ServiceSpec {
  /** The entities' kind — entities.alive('police') finds them. */
  kind: string;
  /** The crew's look (a kit person). */
  uniform: HumanoidOptions;
  /** The car they come in, or false to come on foot. */
  car: { color: number; lights: [number, number] } | false;
  /** Crew per car. */
  crew: number;
}

/** The services the kit knows. Add your own: dispatch.services.guard = { … }. */
export const SERVICES: Record<string, ServiceSpec> = {
  police: { kind: 'police', uniform: { shirt: 0x1e3a8a, trousers: 0x111827, hair: 0x111111 }, car: { color: 0xf8fafc, lights: [0xef4444, 0x3b82f6] }, crew: 2 },
  ambulance: { kind: 'paramedic', uniform: { shirt: 0xf8fafc, trousers: 0x1f2937 }, car: { color: 0xf8fafc, lights: [0xef4444, 0xf8fafc] }, crew: 2 },
  fire: { kind: 'firefighter', uniform: { shirt: 0xb91c1c, trousers: 0x1f2937 }, car: { color: 0xb91c1c, lights: [0xef4444, 0xfacc15] }, crew: 2 },
  security: { kind: 'guard', uniform: { shirt: 0x111827, trousers: 0x111827 }, car: false, crew: 2 },
  military: { kind: 'soldier', uniform: { shirt: 0x4d5d3a, trousers: 0x3f4a2f }, car: { color: 0x4d5d3a, lights: [0xfacc15, 0xfacc15] }, crew: 3 },
};

export type CallStatus = 'en-route' | 'unloading' | 'on-scene' | 'arrived' | 'failed' | 'stood-down';

export interface DispatchCall {
  readonly id: string;
  readonly service: string;
  status: CallStatus;
  /** The crew, once they exist (verified spawns only). */
  readonly units: Entity[];
  /** The car, while it exists. */
  car: THREE.Object3D | null;
  /** Why it failed, when it did. */
  failure?: string;
  /** Where they are going; a function follows a moving target (the player). */
  target: Vec2 | (() => Vec2);
}

export interface DispatchOptions {
  /** How far from the target a crew starts, metres. Default 35–60. */
  minDistance?: number;
  maxDistance?: number;
  /** The playable area; a spawn outside it is never used. */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** The game's own rule for where something may appear (a road, not inside a house). */
  isValidSpawn?: (x: number, z: number) => boolean;
  /** For "out of the player's view". Default ctx.camera when the host has one. */
  camera?: THREE.Camera | null;
  /** What the HUD says (in the player's language). */
  say?: { dispatched?: (service: string) => string; arrived?: (service: string) => string; failed?: (service: string, why: string) => string };
}

interface InnerCall extends DispatchCall {
  state: VehicleState | null;
  from: Vec2;
  stuckFor: number;
  lastDistance: number;
  siren: THREE.Mesh[];
  sirenClock: number;
  spec: ServiceSpec;
  crewSize: number;
  disposables: Array<{ dispose: () => void }>;
}

let nextCall = 1;
const at = (t: DispatchCall['target']): Vec2 => (typeof t === 'function' ? t() : t);

export class Dispatch {
  readonly services: Record<string, ServiceSpec> = { ...SERVICES };
  private readonly calls: InnerCall[] = [];
  private readonly off: (() => void) | null;
  private readonly options: DispatchOptions;

  constructor(private readonly host: EntityHost & { camera?: THREE.Camera }, private readonly entities: Entities, options: DispatchOptions = {}) {
    this.options = options;
    this.off = host.onStep ? host.onStep((dt) => this.update(dt)) : null;
  }

  /** The calls still running (en route, unloading, on scene, arrived). */
  get active(): readonly DispatchCall[] { return this.calls.filter((c) => c.status !== 'failed' && c.status !== 'stood-down'); }

  /**
   * Send a service to a target. Returns the call — check call.status: 'failed' (with call.failure) when no valid spawn point
   * exists or the car or crew could not be created. Nothing is said as dispatched until the car (or crew on foot) exists.
   */
  call(service: string, target: DispatchCall['target'], crew?: number): DispatchCall {
    const spec = this.services[service];
    const call: InnerCall = {
      id: service + '-call-' + nextCall++, service, status: 'en-route', units: [], car: null, target,
      state: null, from: { x: 0, z: 0 }, stuckFor: 0, lastDistance: Infinity, siren: [], sirenClock: 0,
      spec: spec ?? SERVICES.police, crewSize: Math.max(1, crew ?? spec?.crew ?? 2), disposables: [],
    };
    if (!spec) return this.fail(call, 'unknown service "' + service + '"');
    const point = this.spawnPoint(at(target));
    if (!point) return this.fail(call, 'no valid spawn point near the target');
    call.from = point;
    this.calls.push(call);
    if (spec.car) {
      try {
        const car = createCar({ color: spec.car.color });
        car.name = service + ' car';
        const toTarget = Math.atan2(at(target).x - point.x, at(target).z - point.z);
        car.position.set(point.x, groundHeightAt(point.x, point.z), point.z);
        car.rotation.y = toTarget;
        for (const [i, color] of spec.car.lights.entries()) {
          const geometry = new THREE.BoxGeometry(0.35, 0.14, 0.22);
          const material = new THREE.MeshBasicMaterial({ color });
          const light = new THREE.Mesh(geometry, material);
          light.position.set(i ? 0.25 : -0.25, 1.55, -0.1);
          light.userData.noAim = true;
          car.add(light); call.siren.push(light); call.disposables.push(geometry, material);
        }
        this.host.scene.add(car);
        // Out of the shell's sight: a service car is not a vehicle the game drives for the player.
        call.state = watchVehicles(() => undefined, () => createVehicleState(car, { startSpeed: 0 }));
        call.car = car;
        if (!inScene(car, this.host.scene)) return this.fail(call, 'the car was not added to the scene');
      } catch (error) {
        return this.fail(call, 'the car could not be created: ' + String((error as { message?: string })?.message ?? error).slice(0, 120));
      }
    } else if (!this.unload(call, point)) {
      return call;
    }
    events.emit('DISPATCHED', { id: call.id, service, from: point, car: !!call.car, crew: call.units.map((u) => u.id) });
    this.say(this.options.say?.dispatched?.(service) ?? (label(service) + ' dispatched'));
    return call;
  }

  /** Stand a call down: the crew walks back and the call is cleared away. */
  standDown(call: DispatchCall): void {
    const c = call as InnerCall;
    if (c.status === 'failed' || c.status === 'stood-down') return;
    c.status = 'stood-down';
    for (const u of c.units) {
      if (!u.alive) continue;
      u.hostile = false;
      u.goTo(c.car ? { x: c.car.position.x, z: c.car.position.z } : c.from, (e) => e.remove());
    }
    events.emit('DISPATCH_STOOD_DOWN', { id: c.id, service: c.service });
  }

  /** Every step: drive, unload, follow the target, say arrival once, clear what is over. ctx.onStep calls it. */
  update(delta: number): void {
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(delta) ? delta : 0));
    if (dt === 0) return;
    for (const c of [...this.calls]) {
      c.sirenClock += dt;
      const flash = Math.floor(c.sirenClock * 4) % 2 === 0;
      c.siren.forEach((m, i) => { m.visible = c.status === 'stood-down' ? false : (i % 2 === 0) === flash; });
      if (c.status === 'en-route' && c.car && c.state) this.drive(c, dt);
      else if (c.status === 'on-scene' || c.status === 'arrived') {
        // They keep following a moving target (the player) after arriving — that is the pursuit. A fighting officer is
        // left to its AI (Entities), which chases and attacks.
        for (const u of c.units) if (u.alive && !u.hostile) u.goTo(at(c.target), () => this.arrived(c));
      }
      if (c.status === 'stood-down' && c.units.every((u) => !u.alive || !this.entities.all.includes(u))) this.clear(c);
    }
  }

  /** Remove every call, car and crew, and stop ticking. */
  dispose(): void {
    for (const c of [...this.calls]) { for (const u of c.units) u.remove(); this.clear(c); }
    this.off?.();
  }

  private drive(c: InnerCall, dt: number): void {
    const car = c.car!;
    const t = at(c.target);
    const dx = t.x - car.position.x;
    const dz = t.z - car.position.z;
    const d = Math.hypot(dx, dz);
    // Steer toward the target (left is axis.x = -1, which turns the nose to the driver's left), brake to a stop near it.
    let turn = Math.atan2(dx, dz) - c.state!.heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const stopping = d < 10;
    const axis = { x: THREE.MathUtils.clamp(-turn * 2, -1, 1), y: stopping ? (c.state!.speed > 0.5 ? 1 : 0) : -1 };
    c.state = watchVehicles(() => undefined, () => driveVehicle(car, c.state!, axis, dt, { maxSpeed: 18 }));
    // A car that stops getting closer (a wall, a tree) has its crew get out and walk — they still come.
    c.stuckFor = d < c.lastDistance - 0.02 ? 0 : c.stuckFor + dt;
    c.lastDistance = Math.min(c.lastDistance, d);
    if ((stopping && Math.abs(c.state!.speed) < 0.6) || c.stuckFor > 4) {
      c.state = { ...c.state!, speed: 0 };
      this.unload(c, { x: car.position.x, z: car.position.z });
    }
  }

  /** Crew out (verified spawns); the call is on scene. False when no crew member could be created. */
  private unload(c: InnerCall, where: Vec2): boolean {
    c.status = 'unloading';
    const side = c.car ? c.car.rotation.y + Math.PI / 2 : 0;
    for (let i = 0; i < c.crewSize; i++) {
      const offset = (i % 2 === 0 ? 1 : -1) * (1.6 + Math.floor(i / 2) * 0.9);
      const x = where.x + Math.sin(side) * offset;
      const z = where.z + Math.cos(side) * offset;
      const e = this.entities.spawn({ x, z, kind: c.spec.kind, hostile: false, body: c.spec.uniform, patrolRadius: 0, ai: 'melee' });
      if (e) c.units.push(e);
    }
    if (!c.units.length) { this.fail(c, 'no crew member could be created'); return false; }
    c.status = 'on-scene';
    return true;
  }

  private arrived(c: InnerCall): void {
    if (c.status !== 'on-scene') return;
    c.status = 'arrived';
    events.emit('DISPATCH_ARRIVED', { id: c.id, service: c.service, crew: c.units.map((u) => u.id) });
    this.say(this.options.say?.arrived?.(c.service) ?? (label(c.service) + ' arrived'));
  }

  private fail(c: InnerCall, why: string): DispatchCall {
    c.status = 'failed';
    c.failure = why;
    this.clear(c);
    events.emit('DISPATCH_FAILED', { id: c.id, service: c.service, reason: why });
    console.warn('[dispatch] ' + c.service + ' could not be sent: ' + why);
    this.say(this.options.say?.failed?.(c.service, why) ?? (label(c.service) + ' could not come: ' + why));
    return c;
  }

  private clear(c: InnerCall): void {
    if (c.car) { this.host.scene.remove(c.car); c.car = null; }
    for (const d of c.disposables) { try { d.dispose(); } catch { /* never throws */ } }
    c.disposables.length = 0; c.siren.length = 0;
    const i = this.calls.indexOf(c);
    if (i >= 0) this.calls.splice(i, 1);
  }

  private say(text: string): void { events.emit('HINT', { text, seconds: 3 }); }

  /** A point min–max metres from the target, inside the map and allowed — out of the camera's view if any such point exists. */
  private spawnPoint(target: Vec2): Vec2 | null {
    const min = this.options.minDistance ?? 35;
    const max = Math.max(min, this.options.maxDistance ?? 60);
    const b = this.options.bounds;
    const camera = this.options.camera ?? this.host.camera ?? null;
    const ok: Array<{ p: Vec2; hidden: boolean }> = [];
    for (const r of [min, (min + max) / 2, max]) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const p = { x: target.x + Math.sin(a) * r, z: target.z + Math.cos(a) * r };
        if (b && (p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ)) continue;
        if (!Number.isFinite(groundHeightAt(p.x, p.z))) continue;
        if (this.options.isValidSpawn && !this.options.isValidSpawn(p.x, p.z)) continue;
        ok.push({ p, hidden: !inView(camera, p) });
      }
    }
    return (ok.find((o) => o.hidden) ?? ok[0])?.p ?? null;
  }
}

function label(service: string): string { return service.charAt(0).toUpperCase() + service.slice(1); }

function inScene(object: THREE.Object3D, scene: THREE.Scene): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (o === scene) return true;
  return false;
}

/** Is the ground point in front of the camera, inside its view cone? No camera ⇒ treated as hidden. */
function inView(camera: THREE.Camera | null, p: Vec2): boolean {
  if (!camera) return false;
  const eye = new THREE.Vector3(); camera.getWorldPosition(eye);
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const to = new THREE.Vector3(p.x - eye.x, 0, p.z - eye.z);
  forward.y = 0;
  if (to.lengthSq() < 1e-6 || forward.lengthSq() < 1e-6) return false;
  const fov = (camera as THREE.PerspectiveCamera).fov ?? 60;
  return forward.normalize().dot(to.normalize()) > Math.cos(THREE.MathUtils.degToRad(fov * 0.75));
}

export interface WantedOptions {
  /** Stars a crime adds. Defaults: assault 1, murder 2, killed-officer 3, theft 1. game.commit('arson') adds 1 unless listed. */
  crimes?: Record<string, number>;
  maxStars?: number;
  /** Officers per star (capped by maxOfficers). Default 2. */
  perStar?: number;
  maxOfficers?: number;
  /** From this many stars the police fight (with the Entities' playerHealth). Default 3. */
  wantedToFight?: number;
  /** Seconds unseen before one star cools. Default 15. */
  coolSeconds?: number;
  /** How close and how long an officer must hold the player to arrest. Default 1.6 m, 2 s. */
  arrestRadius?: number;
  arrestSeconds?: number;
  /** How far an officer sees the player. Default 25 m. */
  sight?: number;
  onArrest?: () => void;
}

const DEFAULT_CRIMES: Record<string, number> = { assault: 1, theft: 1, murder: 2, 'killed-officer': 3 };

/** Crimes → a wanted level → real police (through Dispatch). Listens to the entities' own events; game code adds more with commit(). */
export class Wanted {
  level = 0;
  private unseen = 0;
  private holding = 0;
  private readonly offs: Array<() => void> = [];
  private readonly options: WantedOptions;

  constructor(private readonly host: EntityHost, private readonly entities: Entities, private readonly dispatch: Dispatch, options: WantedOptions = {}) {
    this.options = options;
    // Only what the PLAYER did is a crime (byPlayer); an enemy hurting a villager is not the player's.
    // A blow that kills is the murder (ENTITY_DIED), not an assault as well — one crime, counted once.
    this.offs.push(events.on('ENTITY_HURT', (p: { kind: string; hostile: boolean; byPlayer: boolean; died?: boolean }) => {
      if (p.byPlayer && !p.hostile && !p.died && this.level === 0) this.commit('assault');
    }));
    this.offs.push(events.on('ENTITY_DIED', (p: { kind: string; hostile: boolean; byPlayer: boolean }) => {
      if (!p.byPlayer) return;
      if (p.kind === 'police') this.commit('killed-officer');
      else if (!p.hostile) this.commit('murder');
    }));
    if (host.onStep) this.offs.push(host.onStep((dt) => this.update(dt)));
  }

  /** The officers on duty now. */
  get officers(): Entity[] { return this.entities.alive('police'); }

  /** The player did something wrong: raise the level and send police. */
  commit(crime: string): void {
    const stars = (this.options.crimes ?? {})[crime] ?? DEFAULT_CRIMES[crime] ?? 1;
    this.set(Math.min(this.options.maxStars ?? 5, this.level + stars), crime);
    this.unseen = 0;
  }

  update(delta: number): void {
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(delta) ? delta : 0));
    if (dt === 0 || this.level === 0) return;
    const p = this.host.player.object.position;
    const officers = this.officers;
    const sight = this.options.sight ?? 25;
    const seen = officers.some((o) => Math.hypot(o.object.position.x - p.x, o.object.position.z - p.z) < sight);
    this.unseen = seen ? 0 : this.unseen + dt;
    if (this.unseen > (this.options.coolSeconds ?? 15)) { this.unseen = 0; this.set(this.level - 1, 'cooled'); return; }
    // Fight from wantedToFight stars, otherwise pursue to arrest.
    const fight = this.level >= (this.options.wantedToFight ?? 3);
    for (const o of officers) o.hostile = fight;
    const reach = this.options.arrestRadius ?? 1.6;
    const near = officers.some((o) => Math.hypot(o.object.position.x - p.x, o.object.position.z - p.z) <= reach);
    this.holding = near ? this.holding + dt : 0;
    if (this.holding >= (this.options.arrestSeconds ?? 2)) {
      this.holding = 0;
      events.emit('PLAYER_ARRESTED', { level: this.level });
      events.emit('HINT', { text: 'Arrested', seconds: 3 });
      this.set(0, 'arrested');
      this.options.onArrest?.();
    }
  }

  dispose(): void { for (const off of this.offs) off(); this.offs.length = 0; }

  private set(level: number, why: string): void {
    const next = Math.max(0, Math.round(level));
    if (next === this.level) return;
    const was = this.level;
    this.level = next;
    events.emit('WANTED_LEVEL_CHANGED', { level: next, was, why });
    events.emit('HINT', { text: next ? 'Wanted ' + '★'.repeat(next) + '☆'.repeat((this.options.maxStars ?? 5) - next) : 'No longer wanted', seconds: 2 });
    if (next === 0) { for (const c of this.dispatch.active) if (c.service === 'police') this.dispatch.standDown(c); return; }
    // Enough officers for the level: on duty + on their way.
    const want = Math.min(this.options.maxOfficers ?? 10, next * (this.options.perStar ?? 2));
    const coming = this.dispatch.active.filter((c) => c.service === 'police' && (c.status === 'en-route' || c.status === 'unloading')).length * (this.dispatch.services.police.crew || 2);
    let missing = want - this.officers.length - coming;
    const player = () => ({ x: this.host.player.object.position.x, z: this.host.player.object.position.z });
    while (missing > 0) {
      const crew = Math.min(this.dispatch.services.police.crew || 2, missing);
      const call = this.dispatch.call('police', player, crew);
      if (call.status === 'failed') break;
      missing -= crew;
    }
  }
}
`;
