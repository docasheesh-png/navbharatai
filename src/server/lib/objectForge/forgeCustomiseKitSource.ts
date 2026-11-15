// OBJECT FORGE — the emitted source of src/game/forge/customise.ts: change a LOADED model (a downloaded .glb, a character pack) by the
// names of its materials. This is the part of "change what the user asks" that IS possible on a baked model: recolour a named material and
// scale the whole. What is NOT possible — a longer haircut, another gender, another face, another shape — needs a different model (or
// the Forge person, which is built from parameters); `customiseModel` never pretends: it returns what it applied, what it could not find
// and why.
//
// PURE source string; the generator writes it. Rule for editing: no backticks and no dollar-brace inside the string below.
export const FORGE_CUSTOMISE = `// Object Forge — customise a loaded three.js model: recolour materials by name or role, scale it. Never claims what it cannot do.
// Technique: traverse the scene graph, match material names with role patterns, clone shared materials before editing. Own implementation.

export type Role = 'clothes' | 'pants' | 'hair' | 'skin' | 'shoes' | 'eyes' | 'hat' | 'dress';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = any;

/** Which material names a role means (the same words on every model). A role you name that matches no material is reported as missing. */
export const ROLE_PATTERNS: Record<Role, RegExp> = {
  clothes: /shirt|cloth|textile|top|jacket|coat|robe|vest|kurta|sweater|fabric/i,
  pants: /pant|trouser|jean|denim|bottom/i,
  hair: /hair|fur|mane|wool/i,
  skin: /skin|flesh|body/i,
  shoes: /shoe|boot|sandal|rubber|foot/i,
  eyes: /eye/i,
  hat: /hat|cap|helmet/i,
  dress: /dress|skirt|gown|saree|lehenga/i,
};

export interface ModelEdits {
  /** A role (clothes, hair, ...) or an exact material name, to a #rrggbb colour. */
  colors?: Record<string, string>;
  /** Multiplies the height (y). */
  height?: number;
  /** Multiplies the width and depth (x and z). */
  width?: number;
}

export interface CustomiseReport {
  applied: string[];
  /** Things asked for that this model has no part for, or whose part is a picture that cannot be recoloured. */
  missing: string[];
}

/** What a baked model cannot do, in words the builder can tell the user. */
export const BAKED_LIMITS = 'A loaded model keeps its shape: its hair length, gender, face and body cannot be changed by words. Colours of its named materials, and its size, can.';

export function customiseModel(root: Obj, edits: ModelEdits): CustomiseReport {
  const report: CustomiseReport = { applied: [], missing: [] };
  const meshes: Obj[] = [];
  root.traverse((o: Obj) => { if (o.isMesh && o.material) meshes.push(o); });
  // Each instance owns its materials, so recolouring one character never recolours another made from the same file.
  for (const mesh of meshes) {
    if (mesh.userData.forgeOwnMaterials) continue;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m: Obj) => m.clone()) : mesh.material.clone();
    mesh.userData.forgeOwnMaterials = true;
  }
  const materials = (): Obj[] => meshes.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material]));
  for (const [target, color] of Object.entries(edits.colors ?? {})) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) { report.missing.push(target + ': ' + color + ' is not a #rrggbb colour'); continue; }
    const pattern = (ROLE_PATTERNS as Record<string, RegExp | undefined>)[target];
    const matched = materials().filter((m) => (pattern ? pattern.test(String(m.name)) : String(m.name).toLowerCase() === target.toLowerCase()));
    const plain = matched.filter((m) => !m.map);
    if (matched.length === 0) { report.missing.push(target + ': this model has no material that means ' + target); continue; }
    if (plain.length === 0) { report.missing.push(target + ': its material is a picture (a texture), which a colour cannot change'); continue; }
    for (const m of plain) m.color.set(color);
    report.applied.push(target + ' (' + [...new Set(plain.map((m) => String(m.name)))].join(', ') + ') -> ' + color);
    if (plain.length < matched.length) report.missing.push(target + ': part of it is a picture and was left as it was');
  }
  const h = edits.height ?? 1; const w = edits.width ?? 1;
  if (h !== 1 || w !== 1) {
    if (!(h > 0.2 && h < 5 && w > 0.2 && w < 5)) report.missing.push('size: a factor must be between 0.2 and 5');
    else { root.scale.x *= w; root.scale.z *= w; root.scale.y *= h; report.applied.push('size: height x ' + h.toFixed(2) + ', width x ' + w.toFixed(2)); }
  }
  return report;
}
`;
