/**
 * When the library has no model for what the user asked, one model call designs a simple object
 * (boxes, spheres, cylinders — data, never code). The object is placed with standOnGround.
 */
import { noteProviderCall } from '../../AI/ProviderHealth/trafficHealth';
import { validateObjectPlan, type ObjectPlan } from '../../lib/proceduralObjects/validatePlan';
import { searchGameLibrary } from './gameLibrary';

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

export async function generateStandIn(subject: string, ask: StandInAsk): Promise<
  | { kind: 'library'; id: string }
  | { kind: 'generated'; id: string; path: string; source: string; triangles: number }
  | { kind: 'none' }
> {
  const query = subject.trim().slice(0, 80);
  if (!query) return { kind: 'none' };
  const found = searchGameLibrary({ query, limit: 1 });
  if (found.entries.length > 0 && found.missing.length === 0) return { kind: 'library', id: found.entries[0].id };
  const asked = await ask(standInPrompt(query));
  if (!asked?.text) return { kind: 'none' };
  const start = asked.text.indexOf('{');
  const end = asked.text.lastIndexOf('}');
  if (start < 0 || end <= start) return { kind: 'none' };
  let checked: ReturnType<typeof validateObjectPlan>;
  try { checked = validateObjectPlan(asked.text.slice(start, end + 1), 'phone'); } catch { return { kind: 'none' }; }
  const id = slug(query);
  const path = `src/game/generatedObjects/${id}.ts`;
  return { kind: 'generated', id, path, source: standInSource(id, checked.plan), triangles: checked.triangles };
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
