// THE CUSTOMISER: a user's words (English, Hinglish, Hindi) change a real object; what cannot be done is SAID; what was not understood is
// RETURNED. Tested through the real parser, the real spec editor, the real Forge check on the result, and — for a loaded model — the
// emitted kit file run against real three.js meshes.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import ts from 'typescript';
import { parseCustomisation, applyEdits, personSpecFor, customiseSummary, colorIn, DEFAULT_PERSON, specFromObjectFile, nodeNamesOf, type Edit } from './forgeCustomise';
import { authorObject, objectFileSource } from './forgeRuntime';
import { FORGE_EXAMPLES } from './forgeExamples';
import { FORGE_CUSTOMISE } from './forgeCustomiseKitSource';

const person = FORGE_EXAMPLES.person.spec;
const house = FORGE_EXAMPLES.house.spec;
const known = (spec: any) => ({ materialKeys: Object.keys(spec.materials), nodeNames: nodeNamesOf(spec.nodes) });
const parse = (text: string, spec: any = person) => parseCustomisation(text, known(spec));

describe('colours, in three languages', () => {
  const cases: Array<[string, string]> = [
    ['red', '#c62828'], ['lal', '#c62828'], ['लाल', '#c62828'], ['neela', '#1e5bb8'], ['नीला', '#1e5bb8'], ['hara', '#2e7d32'], ['peela', '#f2c230'],
    ['gulabi', '#ec6aa5'], ['safed', '#f4f4f4'], ['kala', '#1a1a1a'], ['काला', '#1a1a1a'], ['sunehri', '#d4a72c'], ['blonde', '#d4a72c'], ['gora', '#f1c9a5'], ['saanwla', '#a9744f'],
  ];
  for (const [word, hex] of cases) it(`${word} → ${hex}`, () => expect(colorIn(word)).toBe(hex));
  it('an exact #rrggbb in the text wins over a word', () => expect(colorIn('make it #AABBCC not red')).toBe('#aabbcc'));
  it('dark and light shade the colour (gehra neela is darker than neela, halka is lighter)', () => {
    const base = parseInt(colorIn('neela')!.slice(1, 3), 16) + parseInt(colorIn('neela')!.slice(3, 5), 16) + parseInt(colorIn('neela')!.slice(5, 7), 16);
    const sum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(sum(colorIn('gehra neela')!)).toBeLessThan(base);
    expect(sum(colorIn('halka neela')!)).toBeGreaterThan(base);
  });
  it('no colour word, no colour', () => expect(colorIn('make it bigger')).toBeNull());
});

describe('the user\'s sentence becomes edits', () => {
  const E = (text: string, spec?: any): Edit[] => parse(text, spec).edits;

  it('the admin\'s own examples: a dress colour, long hair, a girl', () => {
    expect(E('dress color badal kar neela karo')).toEqual([{ kind: 'recolor', target: 'role:dress', color: '#1e5bb8' }]);
    expect(E('baal bade karo')).toEqual([{ kind: 'param', name: 'hairLength', value: 2 }]);
    expect(E('is module ko ladki banao do')).toEqual([{ kind: 'param', name: 'gender', value: 'female' }]);
  });

  it('several wishes in one sentence, split on commas, "aur" and "and"', () => {
    const edits = E('shirt ka rang lal karo, baal lambe karo aur joote kaale karo and thoda lamba');
    expect(edits).toContainEqual({ kind: 'recolor', target: 'role:clothes', color: '#c62828' });
    expect(edits).toContainEqual({ kind: 'param', name: 'hairLength', value: 2 });
    expect(edits).toContainEqual({ kind: 'recolor', target: 'role:shoes', color: '#1a1a1a' });
    expect(edits.find((e) => e.kind === 'scale')).toMatchObject({ axis: 'height' });
  });

  it('Hindi script works the same', () => {
    expect(E('कपड़े का रंग नीला करो')).toEqual([{ kind: 'recolor', target: 'role:clothes', color: '#1e5bb8' }]);
    expect(E('बाल काले करो')).toEqual([{ kind: 'recolor', target: 'role:hair', color: '#1a1a1a' }]);
    expect(E('लड़की बना दो')).toEqual([{ kind: 'param', name: 'gender', value: 'female' }]);
  });

  it('wearing a dress is a wish; a dress COLOUR is a colour', () => {
    expect(E('dress pehna do')).toEqual([{ kind: 'param', name: 'dress', value: true }]);
    expect(E('dress ka rang lal')).toEqual([{ kind: 'recolor', target: 'role:dress', color: '#c62828' }]);
  });

  it('sizes: tall, short, fat, thin, bigger, smaller, with "very" and "a little"', () => {
    const f = (t: string) => (E(t).find((e) => e.kind === 'scale') as any);
    expect(f('lamba karo')).toMatchObject({ axis: 'height' }); expect(f('lamba karo').factor).toBeGreaterThan(1);
    expect(f('chhota karo').factor).toBeLessThan(1);
    expect(f('mota karo')).toMatchObject({ axis: 'width' }); expect(f('mota karo').factor).toBeGreaterThan(1);
    expect(f('patla karo').factor).toBeLessThan(1);
    expect(f('bahut lamba').factor).toBeGreaterThan(f('lamba').factor);
    expect(f('thoda lamba').factor).toBeLessThan(f('lamba').factor);
    expect(f('bada karo')).toMatchObject({ axis: 'all' });
  });

  it('a named part of THIS object: the door, the roof', () => {
    expect(E('door ka rang lal karo', house)).toEqual([{ kind: 'recolor', target: 'node:door', color: '#c62828' }]);
    expect(E('roof neela', house)).toEqual([{ kind: 'recolor', target: 'material:roof', color: '#1e5bb8' }]);
  });

  it('what it could not read is RETURNED, not guessed', () => {
    const r = parse('neela karo, kuch aur jaadu karo');
    expect(r.unparsed.length).toBe(2);
    expect(r.unparsed.join(' ')).toMatch(/which part/);
    expect(r.unparsed.join(' ')).toMatch(/kuch aur jaadu karo/);
    expect(r.edits).toEqual([]);
  });

  it('empty and rubbish never throw', () => {
    for (const t of ['', '   ', ',,,', '!!!', 'x'.repeat(5000), '\u0000']) expect(() => parseCustomisation(t)).not.toThrow();
    expect(parseCustomisation('').edits).toEqual([]);
  });
});

describe('the person is regenerated from parameters', () => {
  const combos = (): Array<Partial<typeof DEFAULT_PERSON>> => {
    const out: Array<Partial<typeof DEFAULT_PERSON>> = [];
    for (const gender of ['male', 'female'] as const) for (const hairLength of [0, 1, 2] as const) for (const dress of [false, true]) for (const [height, build] of [[1.8, 1], [1.5, 0.85], [2.1, 1.3]]) out.push({ gender, hairLength, dress, height, build });
    return out;
  };

  it('EVERY combination is a valid object with no warnings (parts touch, stands on the ground, centred) and walks without tearing', () => {
    for (const c of combos()) {
      const r = authorObject(personSpecFor(c));
      expect(r.errors, JSON.stringify(c)).toEqual([]);
      expect(r.report!.warnings, JSON.stringify(c)).toEqual([]);
    }
  });

  it('the height asked for is the height built', () => {
    for (const h of [1.5, 1.8, 2.1]) {
      const r = authorObject(personSpecFor({ height: h }));
      expect(r.report!.size[1]).toBeGreaterThan(h * 0.96); expect(r.report!.size[1]).toBeLessThan(h * 1.04);
    }
  });

  it('a woman is built differently from a man: narrower shoulders, wider hips', () => {
    const m = authorObject(personSpecFor({ gender: 'male' })).report!; const f = authorObject(personSpecFor({ gender: 'female' })).report!;
    expect(f.size[0]).toBeLessThan(m.size[0]);
  });

  it('longer hair is more hair: more triangles in the hair material, and it hangs lower', () => {
    const tri = (n: 0 | 1 | 2) => authorObject(personSpecFor({ hairLength: n })).report!.perMaterial.hair;
    expect(tri(1)).toBeGreaterThan(tri(0)); expect(tri(2)).toBeGreaterThan(tri(1));
  });

  it('a dress adds a skirt and bares the legs (the legs take the skin colour)', () => {
    const spec: any = personSpecFor({ dress: true, colors: { dress: '#112233' } as any });
    expect(spec.materials.dress.color).toBe('#112233');
    expect(nodeNamesOf(spec.nodes)).toContain('skirt');
    const r = authorObject(spec).report!;
    expect(r.perMaterial.dress).toBeGreaterThan(0);
    expect(authorObject(personSpecFor({ dress: false })).report!.perMaterial.dress).toBeUndefined();
  });

  it('is deterministic: the same parameters, the same spec', () => {
    expect(personSpecFor({ gender: 'female', hairLength: 2 })).toEqual(personSpecFor({ gender: 'female', hairLength: 2 }));
  });
});

describe('applying edits', () => {
  it('a recolour on a person changes ITS colour and keeps everything else (and compounds with a later edit)', () => {
    const first = applyEdits(personSpecFor(), parse('shirt ka rang lal, ladki').edits);
    expect(first.unsupported).toEqual([]);
    const p1: any = first.spec;
    expect(p1.materials.shirt.color).toBe('#c62828'); expect(p1.params.gender).toBe('female');
    const second = applyEdits(p1, parse('baal lambe karo, dress pehna do').edits);
    const p2: any = second.spec;
    expect(p2.params).toMatchObject({ gender: 'female', hairLength: 2, dress: true });
    expect(p2.params.colors.top).toBe('#c62828'); // the first edit survived the second
    expect(authorObject(p2).errors).toEqual([]);
  });

  it('on the person: hat is not a part it has, and that is SAID', () => {
    const r = applyEdits(personSpecFor(), parse('topi ka rang lal').edits);
    expect(r.applied).toEqual([]);
    expect(r.unsupported.join(' ')).toMatch(/no hat to colour/);
  });

  it('a recolour of one node splits the shared material: the door changes, the walls do not', () => {
    const r = applyEdits(house, parse('door ka rang neela', house).edits);
    const s: any = r.spec;
    const door = s.nodes.find((n: any) => n.name === 'door');
    expect(s.materials[door.material].color).toBe('#1e5bb8');
    expect(s.materials.wall.color).toBe((house as any).materials.wall.color);
    expect(authorObject(s).errors).toEqual([]);
  });

  it('a role recolours EVERY material that means it (two skin-like materials, both change)', () => {
    const two: any = { id: 'x', name: 'X', materials: { skin_face: { color: '#111111' }, skin_body: { color: '#222222' }, cloth: { color: '#333333' } }, nodes: [{ name: 'a', shape: { type: 'box', size: [1, 1, 1] }, material: 'skin_face', position: [0, 0.5, 0] }, { name: 'b', shape: { type: 'box', size: [1, 1, 1] }, material: 'skin_body', position: [0, 1.5, 0] }, { name: 'c', shape: { type: 'box', size: [1, 1, 1] }, material: 'cloth', position: [0, 2.5, 0] }] };
    const r: any = applyEdits(two, [{ kind: 'recolor', target: 'role:skin', color: '#abcdef' }]);
    expect(r.spec.materials.skin_face.color).toBe('#abcdef'); expect(r.spec.materials.skin_body.color).toBe('#abcdef'); expect(r.spec.materials.cloth.color).toBe('#333333');
    expect(r.applied[0]).toMatch(/skin \(skin_face, skin_body\)/);
  });

  it('what an object has no part for is reported as cannot-be-done, naming what it does have', () => {
    const r = applyEdits(house, parse('baal ka rang lal', house).edits);
    expect(r.applied).toEqual([]);
    expect(r.unsupported.join(' ')).toMatch(/no hair \(its materials: wall, roof, wood, glass, stone\)/);
  });

  it('a gender or hair length on a house is refused honestly', () => {
    const r = applyEdits(house, parse('ladki banao, baal bade karo', house).edits);
    expect(r.applied).toEqual([]);
    expect(r.unsupported.length).toBe(2);
    expect(r.unsupported[0]).toMatch(/not a person built by the Forge/);
  });

  it('scaling any object wraps it so its base stays on the ground and the numbers are what was asked', () => {
    const base = authorObject(house).report!;
    const r = applyEdits(house, [{ kind: 'scale', axis: 'height', factor: 1.5 }]);
    const after = authorObject(r.spec).report!;
    expect(after.size[1]).toBeCloseTo(base.size[1] * 1.5, 3);
    expect(after.size[0]).toBeCloseTo(base.size[0], 3);
    expect(Math.abs(after.min[1])).toBeLessThan(1e-6);
    const twice: any = applyEdits(r.spec, [{ kind: 'scale', axis: 'height', factor: 2 }]).spec;
    expect(twice.nodes.length).toBe(1); // wrapped once, not nested
    expect(authorObject(twice).report!.size[1]).toBeCloseTo(base.size[1] * 3, 3);
  });

  it('refuses nonsense factors by clamping, never by producing a broken object', () => {
    const r = applyEdits(house, [{ kind: 'scale', axis: 'all', factor: 1e9 }]);
    expect(authorObject(r.spec).errors).toEqual([]);
  });

  it('the summary says what changed, what cannot be done and what was not understood', () => {
    const wished = parse('shirt ka rang lal, topi neela, kuch aur');
    const r = applyEdits(personSpecFor(), wished.edits);
    const text = customiseSummary(r, wished.unparsed);
    expect(text).toMatch(/Changed: clothes/); expect(text).toMatch(/CANNOT be done: .*no hat/); expect(text).toMatch(/NOT UNDERSTOOD.*kuch aur/);
    expect(customiseSummary({ applied: [], unsupported: [] }, [])).toBe('Nothing could be changed.');
  });
});

describe('the spec inside an object file is recovered exactly', () => {
  it('round-trips every example', () => {
    for (const e of Object.values(FORGE_EXAMPLES)) expect(specFromObjectFile(objectFileSource(e.spec))).toEqual(e.spec);
  });
  it('is null for a file that is not one of ours', () => {
    expect(specFromObjectFile('export const x = 1;')).toBeNull();
    expect(specFromObjectFile('export const SPEC: ObjectSpec = {broken;\n\n/**')).toBeNull();
  });
});

describe('a LOADED model (the emitted kit file, against real three.js meshes)', () => {
  const js = ts.transpileModule(FORGE_CUSTOMISE, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exportsObj: Record<string, any> = {};
  // eslint-disable-next-line no-new-func
  new Function('exports', js)(exportsObj);
  const { customiseModel, BAKED_LIMITS } = exportsObj;

  /** A character shaped like the real pack: one skinned mesh would do, but materials by NAME are what matters. */
  function character() {
    const root = new THREE.Group();
    const names = ['Face', 'Skin', 'Textile', 'Leather', 'Hair', 'Rubber', 'Metal'];
    const tex = new THREE.Texture();
    const mats = names.map((n) => { const m = new THREE.MeshStandardMaterial({ color: '#888888' }); m.name = n; if (n === 'Face') m.map = tex; return m; });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), mats);
    root.add(mesh);
    return { root, mats, mesh };
  }

  it('recolours by ROLE (clothes → Textile, hair → Hair, shoes → Rubber) and by exact material name', () => {
    const { root, mesh } = character();
    const r = customiseModel(root, { colors: { clothes: '#ff0000', hair: '#00ff00', shoes: '#0000ff', Metal: '#ffff00' } });
    const by = (n: string) => (mesh.material as THREE.MeshStandardMaterial[]).find((m) => m.name === n)!;
    expect(by('Textile').color.getHexString()).toBe('ff0000');
    expect(by('Hair').color.getHexString()).toBe('00ff00');
    expect(by('Rubber').color.getHexString()).toBe('0000ff');
    expect(by('Metal').color.getHexString()).toBe('ffff00');
    expect(by('Leather').color.getHexString()).toBe('888888'); // untouched
    expect(r.applied.length).toBe(4); expect(r.missing).toEqual([]);
  });

  it('a textured material (the Face photo) is NOT recoloured, and that is reported', () => {
    const { root, mesh } = character();
    const r = customiseModel(root, { colors: { Face: '#ff0000' } });
    expect((mesh.material as THREE.MeshStandardMaterial[])[0].color.getHexString()).toBe('888888');
    expect(r.applied).toEqual([]);
    expect(r.missing.join(' ')).toMatch(/picture \(a texture\)/);
  });

  it('a role the model has no material for is reported missing', () => {
    const { root } = character();
    expect(customiseModel(root, { colors: { dress: '#ff0000' } }).missing.join(' ')).toMatch(/no material that means dress/);
  });

  it('recolouring one character does not recolour another made from the same file', () => {
    const a = character(); const shared = a.mesh.material as THREE.Material[];
    const b = new THREE.Group(); b.add(new THREE.Mesh(a.mesh.geometry, shared));
    customiseModel(a.root, { colors: { clothes: '#ff0000' } });
    const other = (b.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial[];
    expect(other.find((m) => m.name === 'Textile')!.color.getHexString()).toBe('888888');
  });

  it('a second edit on the same character keeps working (materials are cloned once)', () => {
    const { root, mesh } = character();
    customiseModel(root, { colors: { clothes: '#ff0000' } });
    customiseModel(root, { colors: { clothes: '#00ff00' } });
    expect((mesh.material as THREE.MeshStandardMaterial[]).find((m) => m.name === 'Textile')!.color.getHexString()).toBe('00ff00');
  });

  it('scales height and width, and refuses a nonsense factor', () => {
    const { root } = character();
    const r = customiseModel(root, { height: 1.1, width: 0.9 });
    expect(root.scale.y).toBeCloseTo(1.1); expect(root.scale.x).toBeCloseTo(0.9); expect(root.scale.z).toBeCloseTo(0.9);
    expect(r.applied[0]).toMatch(/size/);
    const bad = customiseModel(character().root, { height: 50 });
    expect(bad.missing.join(' ')).toMatch(/between 0.2 and 5/);
  });

  it('a bad colour string is refused, not applied', () => {
    const { root } = character();
    expect(customiseModel(root, { colors: { clothes: 'red' } }).missing.join(' ')).toMatch(/not a #rrggbb/);
  });

  it('states what a baked model cannot do', () => {
    expect(BAKED_LIMITS).toMatch(/hair length, gender, face and body cannot be changed/);
  });
});
