/** Shared generated browser gate: decode every embedded image, including unused images. */
export function gameAssetTextureVerifier(typed = false): string {
  return `async function verifyGameAssetTextures(bytes${typed ? ': Uint8Array' : ''}) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  const images = doc.images || [];
  if (images.length > 16) throw Error('Texture count budget');
  let pixels = 0;
  for (const image of images) {
    if (image.uri !== undefined || !['image/png', 'image/jpeg'].includes(image.mimeType)) throw Error('Unsupported texture');
    const resource = doc.bufferViews?.[image.bufferView];
    if (!resource || resource.buffer !== 0) throw Error('Invalid texture buffer');
    const start = 28 + length + (resource.byteOffset || 0), end = start + resource.byteLength;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 28 + length || end > bytes.length || end <= start) throw Error('Texture bounds');
    const bitmap = await createImageBitmap(new Blob([bytes.slice(start, end)], { type: image.mimeType }));
    try {
      if (!bitmap.width || !bitmap.height || bitmap.width > 2048 || bitmap.height > 2048) throw Error('Decoded texture budget');
      pixels += bitmap.width * bitmap.height;
      if (pixels > 8 * 2048 * 2048) throw Error('Decoded total texture budget');
    } finally { bitmap.close(); }
  }
}
`;
}
