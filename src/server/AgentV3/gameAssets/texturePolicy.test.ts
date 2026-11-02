import { expect, it } from 'vitest';
import { textureDimensions } from './texturePolicy';
import { jpegFixtures } from '../../../../tests/fixtures/gameTextureJpeg';
import { paddedSyntheticGlb, encodeFixtureGlb } from '../../../../tests/fixtures/gameAssetFixtures';
import { bundleGltf } from './gltfBundle';
import { validateGlb } from './assetPolicy';
for (const [kind, encoded] of Object.entries(jpegFixtures)) it(`admits bounded ${kind} JPEG through actual glTF bundling and policy`, () => {
  const jpeg = Buffer.from(encoded, 'base64');
  expect(textureDimensions(jpeg, 'image/jpeg')).toEqual({ width: 8, height: 8 });
  const b = Buffer.from(paddedSyntheticGlb()), n = b.readUInt32LE(12);
  const doc = JSON.parse(b.subarray(20, 20+n).toString()), bin = b.subarray(28+n);
  doc.buffers[0].uri = 'model.bin'; doc.images[0] = { uri: 'texture.jpg', mimeType: 'image/jpeg' };
  const resources = new Map([['model.bin', bin], ['texture.jpg', jpeg]]);
  const glb = bundleGltf(Buffer.from(JSON.stringify(doc)), resources);
  expect(validateGlb(glb).triangles).toBe(4);
  doc.images[0].mimeType = 'image/png';
  expect(() => bundleGltf(Buffer.from(JSON.stringify(doc)), resources)).toThrow('MIME mismatch');
});
it('rejects truncated, trailing, mismatched MIME, excessive dimensions, unsupported frames and malformed marker lengths', () => {
  const b = Buffer.from(jpegFixtures.baseline, 'base64');
  for (const length of [0, 2, 20, b.length-2]) expect(() => textureDimensions(b.subarray(0,length), 'image/jpeg')).toThrow();
  expect(() => textureDimensions(Buffer.concat([b, Buffer.from([0])]), 'image/jpeg')).toThrow();
  expect(() => textureDimensions(b, 'image/png')).toThrow();
  const sof = b.indexOf(Buffer.from([255,192]));
  for (const [offset,value] of [[sof+1,195], [sof+4,12], [sof+5,255], [sof+7,255], [3,1]]) {
    const altered = Buffer.from(b); altered[offset] = value;
    expect(() => textureDimensions(altered, 'image/jpeg')).toThrow();
  }
});
it('rejects a JPEG dimension bomb before a decoder is called', () => {
  const b = Buffer.from(paddedSyntheticGlb()), n = b.readUInt32LE(12);
  const doc = JSON.parse(b.subarray(20,20+n).toString());
  const jpeg = Buffer.from(jpegFixtures.baseline,'base64');const sof=jpeg.indexOf(Buffer.from([255,192]));jpeg.writeUInt16BE(65535,sof+7);
  const start=b.length-28-n;const bin=Buffer.concat([b.subarray(28+n),jpeg,Buffer.alloc((4-jpeg.length%4)%4)]);
  doc.buffers[0].byteLength=bin.length;doc.images[0]={mimeType:'image/jpeg',bufferView:doc.bufferViews.length};doc.bufferViews.push({buffer:0,byteOffset:start,byteLength:jpeg.length});
  expect(()=>validateGlb(encodeFixtureGlb(doc,bin))).toThrow('texture');
});
