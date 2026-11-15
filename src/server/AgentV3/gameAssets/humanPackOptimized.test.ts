import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HUMAN_PACK } from './humanPack';
import { validateRecoveredHumanGlb } from './humanPackPolicy';

function unpack(b: Buffer) {
  const length = b.readUInt32LE(12);
  return { doc: JSON.parse(b.subarray(20, 20 + length).toString('utf8')), binary: b.subarray(28 + length) };
}
describe('supplied human clothing-only derivatives', () => {
  it.each(HUMAN_PACK)('preserves $id identity data and stays below geometry ceiling', async model => {
    const original = await readFile(`private-game-assets/humans/${model.file}`);
    const copy = await readFile(`private-game-assets/humans/optimized/${model.file}`);
    expect(createHash('sha256').update(original).digest('hex')).toBe(model.sha256);
    const validated = validateRecoveredHumanGlb(copy);
    expect(validated.triangles).toBeLessThan(60_000);
    expect(copy.length).toBeLessThan(original.length);
    const a = unpack(original), b = unpack(copy);
    for (const key of ['skins', 'nodes', 'animations', 'materials', 'images', 'textures', 'samplers']) expect(b.doc[key]).toEqual(a.doc[key]);
    expect(b.doc.meshes).toEqual(a.doc.meshes);
    const changed = new Set<number>();
    const changedAccessors = new Set<number>();
    for (const mesh of a.doc.meshes) for (const primitive of mesh.primitives) {
      if (['Textile', 'Leather'].includes(a.doc.materials[primitive.material].name)) {
        changed.add(a.doc.accessors[primitive.indices].bufferView);
        changedAccessors.add(primitive.indices);
      }
    }
    expect(b.doc.accessors.length).toBe(a.doc.accessors.length);
    for (let index = 0; index < a.doc.accessors.length; index++) {
      const x = { ...a.doc.accessors[index] }, y = { ...b.doc.accessors[index] };
      if (changedAccessors.has(index)) {
        expect(y.count).toBeLessThanOrEqual(x.count);
        for (const field of ['count', 'min', 'max']) { delete x[field]; delete y[field]; }
      }
      expect(y).toEqual(x);
    }
    for (let index = 0; index < a.doc.bufferViews.length; index++) {
      if (changed.has(index)) continue;
      const x = a.doc.bufferViews[index], y = b.doc.bufferViews[index];
      expect(b.binary.subarray(y.byteOffset ?? 0, (y.byteOffset ?? 0) + y.byteLength)).toEqual(a.binary.subarray(x.byteOffset ?? 0, (x.byteOffset ?? 0) + x.byteLength));
    }
  });
});
