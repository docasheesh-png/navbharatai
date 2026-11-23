/**
 * When the library has no model for what the user asked, one model call designs a simple object
 * (boxes, spheres, cylinders — data, never code). The object is placed with standOnGround.
 */
import { noteProviderCall } from '../../AI/ProviderHealth/trafficHealth';
import { validateObjectPlan, type ObjectPlan } from '../../lib/proceduralObjects/validatePlan';
import { searchGameLibrary } from './gameLibrary';
import { ownModelGuide } from './modelSourcesGuide';

export type StandInAsk = (prompt: string) => Promise<{ text: string } | null>;

const PLAN = '{"version":1,"label":"short name","parts":[{"id":"body","geometry":{"kind":"box","size":[1,1,1]},"position":[0,0.5,0],"rotation":[0,0,0],"color":"#888888","roughness":0.6,"metalness":0.1}]}';

export function standInPrompt(subject: string): string {
  return [
    'Design ONE simple original low-poly object as JSON. No prose.',
    'Use only box, sphere, or cylinder parts. Phone budget: at most 8 parts.',
    `Shape: ${PLAN}`,
    'The origin is the centre. The lowest point will be sat on the ground by the game.',
    `Object: ${subject.slice(0, 80)}`,
  ].join('\n');
}

export function standInSource(id: string, plan: ObjectPlan): string {
  const parts = plan.parts.map((part) => {
    const g = part.geometry;
    const geo = g.kind === 'box'
      ? `new THREE.BoxGeometry(${g.size.join(', ')})`
      : g.kind === 'sphere'
        ? `new THREE.SphereGeometry(${g.radius}, ${g.segments}, ${g.rings})`
        : g.kind === 'cylinder'
          ? `new THREE.CylinderGeometry(${g.top}, ${g.bottom}, ${g.height}, ${g.segments})`
          : `new THREE.LatheGeometry([${g.points.map((p) => `new THREE.Vector2(${p[0]}, ${p[1]})`).join(', ')}], ${g.segments})`;
    return [
      `  { const mesh = new THREE.Mesh(${geo}, new THREE.MeshStandardMaterial({ color: ${JSON.stringify(part.color)}, roughness: ${part.roughness}, metalness: ${part.metalness} }));`,
      `    mesh.name = ${JSON.stringify(part.id)}; mesh.position.set(${part.position.join(', ')}); mesh.rotation.set(${part.rotation.join(', ')}); group.add(mesh); }`,
    ].join('\n');
  }).join('\n');
  return `import * as THREE from 'three';
import { standOnGround } from '../three/surfaces';

/** A simple stand-in. Its lowest point sits on the ground. */
export function create${id.replace(/(^|-)([a-z])/g, (_m, _d, c) => c.toUpperCase())}(): THREE.Group {
  const group = new THREE.Group();
  group.name = ${JSON.stringify(plan.label)};
${parts}
  return standOnGround(group);
}
`;
}

function slug(subject: string): string {
  const s = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  return /^[a-z]/.test(s) ? s : 'object';
}

const COLOURS: Record<string, string> = { red: '#b91c1c', blue: '#1d4ed8', green: '#15803d', yellow: '#ca8a04', black: '#171717', white: '#f8fafc', brown: '#92400e', orange: '#ea580c', purple: '#7e22ce', pink: '#db2777' };
const TEXTURES = ['wood', 'metal', 'stone', 'cloth', 'brick', 'grass'];

export interface LibraryAdjustment {
  kind: 'adjusted';
  id: string;
  path: string;
  source: string;
  libraryId: string;
  scale: number;
  color: string | null;
  texture: string | null;
  parts: string[];
}
export interface GeneratedObject {
  kind: 'generated';
  id: string;
  path: string;
  source: string;
  triangles: number;
  fromModel: boolean;
  /** Shown with the object. The build does not stop to wait for an upload. */
  guide: string;
}

function requestWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
}

function fittedSource(id: string, fit: { libraryId: string; scale: number; color: string | null; texture: string | null; parts: string[] }): string {
  return `import type { Object3D } from 'three';
import { standOnGround } from '../three/surfaces';

/** Closest library object, adjusted. scale, colour, texture and extra parts. */
export const libraryFit = ${JSON.stringify({ ...fit, id })};
export function placeFitted(root: Object3D): Object3D {
  root.scale.multiplyScalar(${fit.scale});
  const tint = ${JSON.stringify(fit.color)};
  if (tint) root.traverse((node) => {
    const mesh = node as { material?: { color?: { set: (hex: string) => void } } };
    if (mesh.material?.color) mesh.material.color.set(tint);
  });
  return standOnGround(root);
}
`;
}

/** Step 1. The closest library model, resized, recoloured, retextured, and combined with other hits. */
export function adjustClosest(request: string): LibraryAdjustment | null {
  const query = request.trim().slice(0, 200);
  if (!query) return null;
  const found = searchGameLibrary({ query, limit: 5 });
  const models = found.entries.filter((entry) => entry.kind === 'reviewed-model');
  if (!models.length) return null;
  const primary = models[0];
  const words = new Set(requestWords(query));
  const parts = models.slice(1).filter((entry) => entry.subjects.some((subject) => words.has(subject))).map((entry) => entry.id).slice(0, 3);
  const scale = /\b(large|big|huge|giant)\b/i.test(query) ? 1.5 : /\b(small|tiny|little)\b/i.test(query) ? 0.6 : 1;
  const colorWord = requestWords(query).find((word) => COLOURS[word]);
  const texture = words.has('wood') || words.has('wooden') ? 'wood' : (TEXTURES.find((name) => words.has(name)) ?? null);
  const id = slug(primary.subjects[0] || 'object');
  const fit = { libraryId: primary.id, scale, color: colorWord ? COLOURS[colorWord] : null, texture, parts };
  return { kind: 'adjusted', id, path: `src/game/generatedObjects/${id}-fit.ts`, source: fittedSource(id, fit), ...fit };
}

const FALLBACK = (label: string): ObjectPlan => ({
  version: 1, label: label.slice(0, 40) || 'Object',
  parts: [{ id: 'body', geometry: { kind: 'box', size: [1, 1, 1] }, position: [0, 0.5, 0], rotation: [0, 0, 0], color: '#888888', roughness: 0.7, metalness: 0 }],
});

/**
 * Steps 2 and 3 together. A model call designs the object. If that call does not answer, a simple
 * shape is still written so the build does not stop, and the user is told where to get a better file.
 */
export async function generateStandIn(subject: string, ask: StandInAsk): Promise<LibraryAdjustment | GeneratedObject | { kind: 'none' }> {
  const query = subject.trim().slice(0, 80);
  if (!query) return { kind: 'none' };
  const fitted = adjustClosest(query);
  if (fitted) return fitted;
  let checked: ReturnType<typeof validateObjectPlan> | null = null;
  let fromModel = false;
  const asked = await ask(standInPrompt(query));
  if (asked?.text) {
    const start = asked.text.indexOf('{');
    const end = asked.text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { checked = validateObjectPlan(asked.text.slice(start, end + 1), 'phone'); fromModel = true; } catch { checked = null; }
    }
  }
  if (!checked) checked = validateObjectPlan(JSON.stringify(FALLBACK(query)), 'phone');
  const id = slug(query);
  return {
    kind: 'generated', id, path: `src/game/generatedObjects/${id}.ts`, source: standInSource(id, checked.plan),
    triangles: checked.triangles, fromModel, guide: ownModelGuide([query]),
  };
}

/** The live call. No key, or a failed call, means no stand-in — never a pretended object. */
export async function askStandIn(prompt: string): Promise<{ text: string } | null> {
  const key = (process.env.GROQ_API_KEY || process.env.FREE_CHAIN_GROQ_API_KEY || '').split(',')[0].trim();
  if (!key) return null;
  const started = Date.now();
  const model = process.env.FREE_CHAIN_GROQ_MODEL || 'llama-3.1-8b-instant';
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
    const text = data?.choices?.[0]?.message?.content ?? '';
    noteProviderCall({ provider: 'GROQ', surface: 'builder', ok: response.ok && !!text, totalMs: Date.now() - started, model, error: response.ok ? undefined : new Error(`HTTP ${response.status}`) });
    return response.ok && text ? { text } : null;
  } catch (error) {
    noteProviderCall({ provider: 'GROQ', surface: 'builder', ok: false, totalMs: Date.now() - started, error });
    return null;
  }
}
