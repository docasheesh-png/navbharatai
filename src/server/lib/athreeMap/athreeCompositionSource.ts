/** Runtime module composition for the existing Athree recipe. No external assets or eval. */
export const COMPOSITION = `// Technique: validated declarative requests compose the existing seeded world, with bounded dynamic objects and lifecycle ownership.
import { createAthreeMap, type AthreeMap, type AthreeMapOptions } from './index';

export type ObjectKind = 'human' | 'dog' | 'cow' | 'horse' | 'deer' | 'goat' | 'tiger' | 'car' | 'motorcycle';
export interface WorldComposition {
  seed: number;
  profile: 'open-world' | 'racing' | 'battle-royale' | 'flight' | 'explore';
  widthKm: number;
  quality: 'phone' | 'mid' | 'desktop';
  rivers: boolean;
  vegetation: boolean;
}
const profiles = ['open-world', 'racing', 'battle-royale', 'flight', 'explore'];
const qualities = ['phone', 'mid', 'desktop'];
const kinds: readonly string[] = ['human', 'dog', 'cow', 'horse', 'deer', 'goat', 'tiger', 'car', 'motorcycle'];
export function validateComposition(input: WorldComposition): WorldComposition {
  if (!input || !Number.isInteger(input.seed) || input.seed < -2147483648 || input.seed > 2147483647) throw new Error('A finite integer seed is required.');
  if (!profiles.includes(input.profile) || !qualities.includes(input.quality)) throw new Error('Unsupported world profile or quality.');
  if (!Number.isFinite(input.widthKm) || input.widthKm < 1 || input.widthKm > 1000) throw new Error('World width must be 1–1000 km.');
  if (input.widthKm > 100) throw new Error('Worlds above 100 km require additional runtime and device validation; not enabled.');
  if (typeof input.rivers !== 'boolean' || typeof input.vegetation !== 'boolean') throw new Error('Explicit river/vegetation choices are required.');
  return { seed: input.seed, profile: input.profile, widthKm: input.widthKm, quality: input.quality, rivers: input.rivers, vegetation: input.vegetation };
}
/** An adapter owns its resources. Object placement remains in world metres; it must apply origin consistently to graphics AND physics. */
export interface RuntimeObject {
  place(x: number, y: number, z: number, origin: { x: number; z: number }): void;
  update(dt: number): void;
  dispose(): void;
}
export interface ObjectModuleAdapter {
  create(kind: ObjectKind): RuntimeObject;
}
export interface ObjectRequest { id: string; kind: ObjectKind; x: number; z: number }
const limits = { phone: 16, mid: 32, desktop: 64 };
export function createComposedWorld(input: WorldComposition, options: Pick<AthreeMapOptions, Extract<keyof AthreeMapOptions, 'three' | 'skyOptions'>> = {}, adapter?: ObjectModuleAdapter) {
  const spec = Object.freeze(validateComposition(input));
  const map: AthreeMap = createAthreeMap({ ...options, ...spec, sizeMeters: spec.widthKm * 1000 });
  const objects = new Map<string, { request: ObjectRequest; object: RuntimeObject }>();
  let disposed = false;
  let origin = { x: 0, z: 0 };
  function add(request: ObjectRequest): void {
    if (disposed) throw new Error('World disposed.');
    if (!adapter) throw new Error('No object module adapter installed.');
    if (!request || typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.id) || !kinds.includes(request.kind)) throw new Error('Unsupported object request.');
    if (objects.has(request.id)) throw new Error('Object id already exists.');
    if (objects.size >= limits[spec.quality]) throw new Error('Active object budget reached.');
    if (!Number.isFinite(request.x) || !Number.isFinite(request.z) || Math.abs(request.x) > 1000000 || Math.abs(request.z) > 1000000) throw new Error('Invalid object coordinates.');
    const half = spec.widthKm * 500;
    if (map.world.mode === 'bounded' && (Math.abs(request.x) >= half || Math.abs(request.z) >= half)) throw new Error('Object outside bounded world.');
    const y = map.world.heightAt(request.x, request.z);
    if (!Number.isFinite(y) || y <= map.world.seaLevel || map.world.waterAt(request.x, request.z) || map.world.normalAt(request.x, request.z).y < 0.8) throw new Error('Object needs a dry, safe ground position.');
    const object = adapter.create(request.kind);
    try { object.place(request.x, y, request.z, origin); } catch (error) { try { object.dispose(); } catch { /* Preserve placement failure. */ } throw error; }
    objects.set(request.id, { request: { ...request }, object });
  }
  function remove(id: string): void {
    const entry = objects.get(id); if (!entry) return;
    objects.delete(id); entry.object.dispose();
  }
  function update(x: number, z: number, time: number, dt: number, y = 0): void {
    if (disposed) throw new Error('World disposed.');
    if (![x,z,time,dt,y].every(Number.isFinite) || dt < 0 || Math.abs(x) > 1000000 || Math.abs(z) > 1000000) throw new Error('Invalid frame input.');
    map.update(x,z,time,y);
    origin = map.chunks ? { ...map.chunks.origin } : { x: 0, z: 0 };
    for (const {request,object} of objects.values()) {
      object.place(request.x, map.world.heightAt(request.x,request.z), request.z, origin);
      object.update(Math.min(dt,0.1));
    }
  }
  function dispose(): void {
    if (disposed) return; disposed=true;
    try { for (const id of [...objects.keys()]) { try { remove(id); } catch { /* Continue teardown of owned objects. */ } } }
    finally { map.dispose(); }
  }
  return { map, spec, add, remove, update, dispose, objectCount: () => objects.size };
}
`;
