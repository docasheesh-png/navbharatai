import { it, expect } from 'vitest';
import { syntheticGlb } from '../../../../tests/fixtures/gameAssetFixtures';
import { bundleGltf, safeGltfResourcePath } from './gltfBundle';
import { validateGlb } from './assetPolicy';
function pack() {
  const bytes=syntheticGlb(); const length=bytes.readUInt32LE(12);
  const doc=JSON.parse(bytes.subarray(20,20+length).toString());doc.buffers[0].uri='mesh.bin';
  return {doc,resources:new Map([['mesh.bin',bytes.subarray(28+length)]])};
}
it('bundles relative glTF buffers into a deterministic animation-preserving GLB',()=>{
  const {doc,resources}=pack();const json=Buffer.from(JSON.stringify(doc));
  const a=bundleGltf(json,resources);expect(a).toEqual(bundleGltf(json,resources));
  expect(validateGlb(a)).toMatchObject({triangles:4,animations:['Move']});
});
it.each(['../secret','/etc/passwd','https://host/model','data:foo','a\\b','a/%2e%2e/b','a//b','./b'])('rejects unsafe glTF path %s',p=>expect(safeGltfResourcePath(p)).toBe(false));
it('rejects missing, extra or out-of-bounds resources',()=>{
  const {doc,resources}=pack();
  expect(()=>bundleGltf(Buffer.from(JSON.stringify(doc)),new Map())).toThrow('Missing');
  expect(()=>bundleGltf(Buffer.from(JSON.stringify(doc)),new Map([...resources,['extra.bin',Buffer.alloc(4)]]))).toThrow('Unreferenced');
  doc.bufferViews[0].byteOffset=9999;
  expect(()=>bundleGltf(Buffer.from(JSON.stringify(doc)),resources)).toThrow('bounds');
});
