// OBJECT FORGE — CUSTOMISE: the user says what to change, in their own words, and the object changes.
//
// Admin 2026-11-15: *"auto customiser banao — user ke bas bolte bhar se jo chahe edit ho jaye."* Two things make that true, and a third thing
// is kept honest:
//   1. UNDERSTAND: `parseCustomisation` turns a sentence in English, Hinglish or Hindi ("dress ka rang neela karo, baal bade karo, thoda
//      lamba") into a small list of typed edits — recolour a part, scale the object, set a parameter — plus whatever it could not read.
//   2. APPLY to a Forge object: a recolour edits a material (or splits one off for a single named node, so "door ka rang lal" does not
//      repaint every wooden thing); a scale wraps the object; and for the PERSON, every structural wish — a woman, a dress, long hair, a
//      sturdier build — is a PARAMETER, because the person is regenerated from parameters (`personSpecFor`), so edits compound.
//   3. BE HONEST: an edit that cannot be done (a hair length on an object that has no hair, a gender on a house) comes back in
//      `unsupported` with the reason, never silently skipped and never reported as done.
// A baked model (a downloaded .glb with a skin and one mesh) cannot change shape from words; src/game/forge/customise.ts (the kit file)
// does the part that IS possible on one — recolour by material name, scale — and reports the rest as impossible.
import { FORGE_EXAMPLES } from './forgeExamples';

export type Role = 'clothes' | 'pants' | 'hair' | 'skin' | 'shoes' | 'eyes' | 'hat' | 'dress';

export type Edit =
  | { kind: 'recolor'; target: string; color: string }
  | { kind: 'scale'; axis: 'height' | 'width' | 'all'; factor: number }
  | { kind: 'param'; name: 'gender'; value: 'male' | 'female' }
  | { kind: 'param'; name: 'hairLength'; value: 0 | 1 | 2 }
  | { kind: 'param'; name: 'dress'; value: boolean };

export interface Parsed { edits: Edit[]; unparsed: string[] }

// ---------------------------------------------------------------------------------------------------------------------------------
// Words → meaning

const COLORS: Array<[string[], string]> = [
  [['red', 'lal', 'laal', 'लाल'], '#c62828'], [['blue', 'neela', 'nila', 'नीला', 'नीले'], '#1e5bb8'], [['green', 'hara', 'हरा', 'हरे'], '#2e7d32'],
  [['yellow', 'peela', 'pila', 'पीला', 'पीले'], '#f2c230'], [['orange', 'narangi', 'नारंगी'], '#ef6c00'], [['pink', 'gulabi', 'गुलाबी'], '#ec6aa5'],
  [['purple', 'violet', 'baingani', 'jamuni', 'बैंगनी', 'जामुनी'], '#7b3fa0'], [['white', 'safed', 'safaid', 'सफेद', 'सफ़ेद'], '#f4f4f4'],
  [['black', 'kala', 'kaala', 'काला', 'काले'], '#1a1a1a'], [['brown', 'bhura', 'भूरा', 'भूरे'], '#6b4423'], [['grey', 'gray', 'dhusar', 'slate', 'सलेटी'], '#808080'],
  [['golden', 'gold', 'sunehri', 'sunahri', 'blonde', 'सुनहरा', 'सुनहरी'], '#d4a72c'], [['maroon', 'marun'], '#800000'], [['navy'], '#14285a'],
  [['cyan', 'firozi', 'turquoise', 'फिरोज़ी'], '#12a4b4'], [['beige', 'cream', 'kreem'], '#e8d9b5'], [['silver', 'chandi', 'चांदी'], '#c0c0c0'],
];
const SKIN_TONES: Array<[string[], string]> = [
  [['fair', 'gora', 'gori', 'गोरा', 'गोरी'], '#f1c9a5'], [['wheatish', 'genhuan', 'gehua', 'गेहुआं'], '#d9a273'], [['dusky', 'saanwla', 'sanwla', 'saanwli', 'सांवला', 'सांवली'], '#a9744f'],
];
const DARKER = ['dark', 'darker', 'gehra', 'gehre', 'गहरा', 'गहरे'];
const LIGHTER = ['light', 'lighter', 'halka', 'halke', 'हल्का', 'हल्के'];

const ROLE_WORDS: Array<[Role, string[]]> = [
  ['hair', ['hair', 'baal', 'baalon', 'बाल', 'balon', 'zulf']],
  ['skin', ['skin', 'chamdi', 'tvacha', 'त्वचा', 'complexion', 'rang-roop']],
  ['shoes', ['shoes', 'shoe', 'joote', 'joota', 'जूते', 'boots', 'sandal', 'chappal']],
  ['pants', ['pants', 'pant', 'jeans', 'trouser', 'trousers', 'paijama', 'pajama', 'पैंट']],
  ['hat', ['hat', 'cap', 'topi', 'टोपी', 'helmet']],
  ['eyes', ['eyes', 'eye', 'aankh', 'aankhen', 'आंख', 'आँखें']],
  ['dress', ['dress', 'frock', 'skirt', 'lehenga', 'saree', 'sari', 'gown']],
  ['clothes', ['clothes', 'cloth', 'kapde', 'kapda', 'कपड़े', 'shirt', 'tshirt', 'kurta', 'कुर्ता', 'top', 'jacket', 'coat', 'vest', 'sweater']],
];
const FEMALE = ['ladki', 'ladkiya', 'girl', 'female', 'woman', 'lady', 'women', 'aurat', 'लड़की', 'महिला', 'stree'];
const MALE = ['ladka', 'boy', 'male', 'man', 'mard', 'gents', 'लड़का', 'पुरुष', 'aadmi'];
const BIGGER = ['bade', 'bada', 'badi', 'lambe', 'lambi', 'lamba', 'long', 'longer', 'bigger', 'zyada', 'jyada', 'बड़े', 'लंबे', 'लंबी', 'ज्यादा'];
const SMALLER = ['chhote', 'chhota', 'chhoti', 'chote', 'short', 'shorter', 'smaller', 'kam', 'छोटे', 'छोटी', 'कम'];
const TALL = ['tall', 'taller', 'lamba', 'lambi', 'lamba', 'unchi', 'ooncha', 'लंबा', 'लंबी'];
const SHORT_BODY = ['chhota', 'chhoti', 'chota', 'short', 'shorter', 'ठिगना', 'छोटा', 'छोटी'];
const FAT = ['mota', 'moti', 'fat', 'fatter', 'heavy', 'broad', 'bulky', 'sturdy', 'healthy', 'मोटा', 'मोटी'];
const THIN = ['patla', 'patli', 'thin', 'thinner', 'slim', 'slimmer', 'lean', 'skinny', 'पतला', 'पतली'];
const WEAR = ['pehna', 'pehnao', 'pehnaao', 'pahna', 'pahnao', 'wear', 'wearing', 'put on', 'पहना', 'पहनाओ'];
const VERY = ['bahut', 'very', 'ekdum', 'kaafi', 'kafi', 'extra', 'बहुत', 'काफी'];
const LITTLE = ['thoda', 'thodi', 'slightly', 'bit', 'little', 'थोड़ा', 'थोड़ी'];

const norm = (s: string): string => s.toLowerCase().normalize('NFC');
const tokensOf = (s: string): string[] => norm(s).split(/[^\p{L}\p{M}\p{N}#]+/u).filter(Boolean);
const has = (tokens: string[], words: string[]): boolean => words.some((w) => (w.includes(' ') ? tokens.join(' ').includes(w) : tokens.includes(w)));

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  const r = c(((n >> 16) & 255) * factor); const g = c(((n >> 8) & 255) * factor); const b = c((n & 255) * factor);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** The colour a clause names, with a "dark" or "light" shade applied, or null. A #rrggbb in the text wins. */
export function colorIn(text: string): string | null {
  const t = tokensOf(text);
  const hex = /#([0-9a-f]{6})\b/i.exec(text);
  if (hex) return '#' + hex[1].toLowerCase();
  let found: string | null = null;
  for (const [names, value] of [...COLORS, ...SKIN_TONES]) if (has(t, names)) { found = value; break; }
  if (!found) return null;
  if (has(t, DARKER)) return shade(found, 0.7);
  if (has(t, LIGHTER)) return shade(found, 1.25);
  return found;
}

const CLAUSE_SPLIT = /[,;।\n]+|\s+(?:and|aur|phir|then|tatha|also)\s+|\s+और\s+/i;

/**
 * Read a sentence of wishes. `known` lists what the object actually has (material keys and node names), so "door ka rang lal" and "roof
 * neela" name a real thing; anything not read is returned in `unparsed`, never guessed.
 */
export function parseCustomisation(text: string, known: { materialKeys?: string[]; nodeNames?: string[] } = {}): Parsed {
  const edits: Edit[] = [];
  const unparsed: string[] = [];
  const keys = (known.materialKeys ?? []).map((k) => k.toLowerCase());
  const nodes = (known.nodeNames ?? []).filter((n) => !/_mirror$|_\d+$/.test(n));
  for (const raw of String(text ?? '').split(CLAUSE_SPLIT).map((c) => c.trim()).filter(Boolean)) {
    const t = tokensOf(raw);
    const before = edits.length;
    const color = colorIn(raw);
    const more = has(t, VERY) ? 2 : has(t, LITTLE) ? 0.5 : 1;

    // What is being coloured. A ROLE word (dress, hair, shoes...) wins: it means the same on every object that has one. Otherwise a part
    // named in the sentence (a node, then a material key): "door ka rang lal", "roof neela".
    let role: Role | null = null;
    for (const [r, words] of ROLE_WORDS) if (has(t, words)) { role = r; break; }
    let target: string | null = role ? 'role:' + role : null;
    if (!target) {
      const named = nodes.find((n) => { const parts = n.toLowerCase().split('_'); return parts.every((q) => t.includes(q)); });
      if (named) target = 'node:' + named;
    }
    if (!target) { const key = keys.find((k) => t.includes(k)); if (key) target = 'material:' + key; }

    // Putting a dress ON is a structural wish, not a colour.
    if (role === 'dress' && has(t, WEAR) && !color) { edits.push({ kind: 'param', name: 'dress', value: true }); continue; }
    if (color && target) { edits.push({ kind: 'recolor', target, color }); }
    else if (color && !target && /rang|color|colour|रंग/.test(norm(raw))) unparsed.push(raw + ' (which part? say dress, hair, shoes, skin, or the part by name)');
    else if (color && !target) unparsed.push(raw + ' (which part?)');

    if (!color) {
      if (role === 'hair') {
        if (has(t, BIGGER)) edits.push({ kind: 'param', name: 'hairLength', value: 2 });
        else if (has(t, SMALLER)) edits.push({ kind: 'param', name: 'hairLength', value: 0 });
      }
    }
    if (has(t, FEMALE)) edits.push({ kind: 'param', name: 'gender', value: 'female' });
    else if (has(t, MALE)) edits.push({ kind: 'param', name: 'gender', value: 'male' });
    if (!role && !color) {
      if (has(t, FAT)) edits.push({ kind: 'scale', axis: 'width', factor: 1 + 0.15 * more });
      else if (has(t, THIN)) edits.push({ kind: 'scale', axis: 'width', factor: 1 - 0.12 * more });
      else if (has(t, TALL)) edits.push({ kind: 'scale', axis: 'height', factor: 1 + 0.1 * more });
      else if (has(t, SHORT_BODY)) edits.push({ kind: 'scale', axis: 'height', factor: 1 - 0.1 * more });
      else if (has(t, BIGGER) && !has(t, TALL)) edits.push({ kind: 'scale', axis: 'all', factor: 1 + 0.2 * more });
      else if (has(t, SMALLER)) edits.push({ kind: 'scale', axis: 'all', factor: 1 - 0.15 * more });
    }
    if (edits.length === before && !unparsed.some((u) => u.startsWith(raw))) unparsed.push(raw);
  }
  return { edits, unparsed };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The person is regenerated from parameters

export interface PersonParams {
  gender: 'male' | 'female';
  hairLength: 0 | 1 | 2;
  dress: boolean;
  /** Height in metres of the finished figure. */
  height: number;
  /** Width factor: 1 is average, 1.2 sturdy, 0.85 slim. */
  build: number;
  colors: { skin: string; hair: string; top: string; bottom: string; shoes: string; eye: string; dress: string };
}

export const DEFAULT_PERSON: PersonParams = {
  gender: 'male', hairLength: 0, dress: false, height: 1.8, build: 1,
  colors: { skin: '#d9a273', hair: '#2b1d14', top: '#3b6ea5', bottom: '#2f3640', shoes: '#1b1b1f', eye: '#101010', dress: '#b3366b' },
};

type SpecNode = Record<string, unknown> & { name: string; children?: SpecNode[] };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function find(nodes: SpecNode[], name: string): SpecNode | null {
  for (const n of nodes) { if (n.name === name) return n; const c = n.children ? find(n.children, name) : null; if (c) return c; }
  return null;
}

/** Build the person for these parameters from the worked example. Pure and deterministic: the same parameters give the same spec. */
export function personSpecFor(input: Partial<PersonParams> = {}): Record<string, unknown> {
  const p: PersonParams = { ...DEFAULT_PERSON, ...input, colors: { ...DEFAULT_PERSON.colors, ...(input.colors ?? {}) } };
  const spec = clone(FORGE_EXAMPLES.person.spec) as { id: string; name: string; materials: Record<string, Record<string, unknown>>; nodes: SpecNode[]; params?: PersonParams };
  const m = spec.materials;
  m.skin.color = p.colors.skin; m.hair.color = p.colors.hair; m.shirt.color = p.colors.top; m.pants.color = p.colors.bottom; m.shoes.color = p.colors.shoes; m.eye.color = p.colors.eye;
  const female = p.gender === 'female';
  const chest = find(spec.nodes, 'chest'); const pelvis = find(spec.nodes, 'pelvis'); const shoulder = find(spec.nodes, 'shoulder'); const hip = find(spec.nodes, 'hip');
  if (female && chest && pelvis && shoulder && hip) {
    chest.scale = [1.0, 1, 0.78]; (chest.shape as { radius: number }).radius = 0.14;
    (pelvis.shape as { size: number[] }).size = [0.36, 0.2, 0.21];
    shoulder.position = [0.175, 0.5, 0]; hip.position = [0.1, -0.1, 0];
  }
  const head = find(spec.nodes, 'head');
  if (head) {
    const back = (length: number, y: number): SpecNode => ({ name: 'hair_back', shape: { type: 'capsule', radius: 0.085, length }, material: 'hair', position: [0, y, -0.065], scale: [1.15, 1, 0.7] });
    if (p.hairLength === 1) head.children!.push(back(0.12, 0.0));
    if (p.hairLength === 2) { head.children!.push(back(0.34, -0.1)); }
    if (p.hairLength === 2 && female) head.children!.push({ name: 'hair_side', shape: { type: 'capsule', radius: 0.03, length: 0.22 }, material: 'hair', position: [0.085, -0.02, -0.01], mirror: 'x' });
  }
  if (p.dress) {
    m.dress = { color: p.colors.dress, roughness: 0.85 };
    const torso = find(spec.nodes, 'torso');
    // A skirt from the waist, wider at the hem, over the thighs; the legs below it are skin.
    torso?.children?.push({ name: 'skirt', shape: { type: 'cylinder', radiusTop: female ? 0.15 : 0.17, radiusBottom: female ? 0.3 : 0.32, height: 0.5, seg: 14 }, material: 'dress', position: [0, -0.12, 0] });
    for (const leg of ['thigh', 'shin']) { const n = find(spec.nodes, leg); if (n) n.material = 'skin'; }
  }
  // Height and build: the example is 1.82 m; the wrapper keeps the base on y = 0.
  const w = p.build; const h = p.height / 1.82;
  spec.nodes = [{ name: 'figure', scale: [w, h, w], children: spec.nodes }];
  spec.params = p;
  return spec as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Applying edits to a spec

type Spec = { id: string; name: string; materials: Record<string, Record<string, unknown>>; nodes: SpecNode[]; params?: PersonParams };

const ROLE_MATERIALS: Record<Role, RegExp> = {
  clothes: /shirt|cloth|textile|top|jacket|coat|robe|vest|kurta|sweater|fabric/i,
  pants: /pant|trouser|jean|denim|bottom/i,
  hair: /hair|fur|mane|wool/i,
  skin: /skin|flesh|body|face/i,
  shoes: /shoe|boot|sandal|rubber|foot/i,
  eyes: /eye/i,
  hat: /hat|cap|helmet/i,
  dress: /dress|skirt|gown|robe|saree|lehenga/i,
};

export interface Applied { spec: Record<string, unknown>; applied: string[]; unsupported: string[] }

function nodesWithMaterial(nodes: SpecNode[], key: string, out: SpecNode[] = []): SpecNode[] {
  for (const n of nodes) { if (n.material === key) out.push(n); if (n.children) nodesWithMaterial(n.children, key, out); }
  return out;
}

/** Apply edits to ANY Forge spec. A person (a spec carrying `params`) is regenerated from its parameters, so every edit compounds. */
export function applyEdits(specIn: Record<string, unknown>, edits: Edit[]): Applied {
  const applied: string[] = []; const unsupported: string[] = [];
  const base = specIn as unknown as Spec;
  if (base.params && typeof base.params === 'object') return applyToPerson(base, edits);

  const spec = clone(base);
  for (const e of edits) {
    if (e.kind === 'recolor') {
      const [what, name] = [e.target.slice(0, e.target.indexOf(':')), e.target.slice(e.target.indexOf(':') + 1)];
      if (what === 'material') {
        if (spec.materials[name]) { spec.materials[name].color = e.color; applied.push(`${name} → ${e.color}`); } else unsupported.push(`there is no material called ${name}`);
      } else if (what === 'node') {
        const node = find(spec.nodes, name);
        if (!node?.material || typeof node.material !== 'string') { unsupported.push(`${name} has no colour of its own`); continue; }
        const key = node.material;
        // A material shared with other parts is split, so "door" does not repaint every wooden part.
        const users = nodesWithMaterial(spec.nodes, key);
        if (users.length > 1) {
          const split = `${key}_${name}`.replace(/[^A-Za-z0-9_]/g, '_');
          spec.materials[split] = { ...spec.materials[key], color: e.color }; node.material = split;
        } else spec.materials[key].color = e.color;
        applied.push(`${name} → ${e.color}`);
      } else {
        const role = name as Role;
        const keys = Object.keys(spec.materials).filter((k) => ROLE_MATERIALS[role].test(k));
        if (keys.length === 0) { unsupported.push(`this object has no ${role} (its materials: ${Object.keys(spec.materials).join(', ')})`); continue; }
        for (const k of keys) spec.materials[k].color = e.color;
        applied.push(`${role} (${keys.join(', ')}) → ${e.color}`);
      }
    } else if (e.kind === 'scale') {
      const f = Math.max(0.3, Math.min(3, e.factor));
      const root = spec.nodes.length === 1 && spec.nodes[0].name === 'figure' ? spec.nodes[0] : null;
      const s = (root?.scale as number[] | undefined) ?? [1, 1, 1];
      const next = e.axis === 'height' ? [s[0], s[1] * f, s[2]] : e.axis === 'width' ? [s[0] * f, s[1], s[2] * f] : [s[0] * f, s[1] * f, s[2] * f];
      if (root) root.scale = next; else spec.nodes = [{ name: 'figure', scale: next, children: spec.nodes }];
      applied.push(`${e.axis} × ${f.toFixed(2)}`);
    } else {
      unsupported.push(`${e.name} cannot be changed on this object: it is not a person built by the Forge (ask for a person, or build one with author_object)`);
    }
  }
  return { spec: spec as unknown as Record<string, unknown>, applied, unsupported };
}

function applyToPerson(base: Spec, edits: Edit[]): Applied {
  const p: PersonParams = { ...DEFAULT_PERSON, ...base.params!, colors: { ...DEFAULT_PERSON.colors, ...(base.params!.colors ?? {}) } };
  const applied: string[] = []; const unsupported: string[] = [];
  const COLOR_KEY: Record<Role, keyof PersonParams['colors'] | null> = { clothes: 'top', pants: 'bottom', hair: 'hair', skin: 'skin', shoes: 'shoes', eyes: 'eye', hat: null, dress: 'dress' };
  for (const e of edits) {
    if (e.kind === 'recolor') {
      const name = e.target.slice(e.target.indexOf(':') + 1);
      const what = e.target.slice(0, e.target.indexOf(':'));
      const role = (what === 'role' ? name : what === 'material' ? (['skin', 'hair', 'shirt', 'pants', 'shoes', 'eye'].includes(name) ? ({ shirt: 'clothes', eye: 'eyes' } as Record<string, Role>)[name] ?? (name as Role) : null) : null) as Role | null;
      const key = role ? COLOR_KEY[role] : null;
      if (!key) { unsupported.push(`a person has no ${name} to colour (it has skin, hair, clothes, pants, shoes, eyes and, once worn, a dress)`); continue; }
      if (role === 'dress' && !p.dress) { p.dress = true; }
      p.colors[key] = e.color; applied.push(`${role} → ${e.color}`);
    } else if (e.kind === 'scale') {
      const f = Math.max(0.3, Math.min(3, e.factor));
      if (e.axis === 'height') p.height = Math.max(0.5, Math.min(3.5, p.height * f)); else if (e.axis === 'width') p.build = Math.max(0.6, Math.min(1.6, p.build * f)); else { p.height = Math.max(0.5, Math.min(3.5, p.height * f)); p.build = Math.max(0.6, Math.min(1.6, p.build * f)); }
      applied.push(`${e.axis} × ${f.toFixed(2)}`);
    } else if (e.name === 'gender') { p.gender = e.value; applied.push(`gender → ${e.value}`); }
    else if (e.name === 'hairLength') { p.hairLength = e.value; applied.push(`hair length → ${['short', 'medium', 'long'][e.value]}`); }
    else if (e.name === 'dress') { p.dress = e.value; applied.push(e.value ? 'wearing a dress' : 'dress removed'); }
  }
  const out = personSpecFor(p) as Record<string, unknown>;
  out.id = base.id; out.name = base.name;
  return { spec: out, applied, unsupported };
}

/** The sentence for the builder: what changed, what could not, what was not understood. */
export function customiseSummary(r: { applied: string[]; unsupported: string[] }, unparsed: string[]): string {
  const lines: string[] = [];
  lines.push(r.applied.length ? 'Changed: ' + r.applied.join('; ') + '.' : 'Nothing could be changed.');
  if (r.unsupported.length) lines.push('CANNOT be done: ' + r.unsupported.join('; ') + '.');
  if (unparsed.length) lines.push('NOT UNDERSTOOD (ask the user, or say it differently): ' + unparsed.join(' | '));
  return lines.join('\n');
}

/** Every node name in a spec's tree (what the user can point at: "door", "left_arm"). */
export function nodeNamesOf(nodes: unknown): string[] {
  const out: string[] = [];
  const walk = (list: unknown): void => { if (!Array.isArray(list)) return; for (const n of list as SpecNode[]) { if (n && typeof n.name === 'string') out.push(n.name); if (n?.children) walk(n.children); } };
  walk(nodes);
  return out;
}

/** The spec inside an object file the Forge wrote (src/game/objects/<id>.ts), or null when the file is not one of ours. */
export function specFromObjectFile(source: string): Record<string, unknown> | null {
  const start = source.indexOf('export const SPEC: ObjectSpec = ');
  if (start < 0) return null;
  const from = start + 'export const SPEC: ObjectSpec = '.length;
  const end = source.indexOf(';\n\n/**', from);
  if (end < 0) return null;
  try { const v: unknown = JSON.parse(source.slice(from, end)); return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null; } catch { return null; }
}
