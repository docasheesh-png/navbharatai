/** Bounded JPEG marker inspection (ITU T.81 Annex B), not an entropy decoder. */
export function textureDimensions(input: Uint8Array, mime: unknown): { width: number; height: number } {
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const fail = (): never => { throw new Error('Unsafe GLB: texture format or dimensions'); };
  if (b.length > 5 * 1024 * 1024) fail();
  const dimensions = (width: number, height: number) => {
    if (!width || !height || width > 2048 || height > 2048) fail();
    return { width, height };
  };
  if (mime === 'image/png') {
    if (b.length < 33 || b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || b.toString('ascii', 12, 16) !== 'IHDR') fail();
    return dimensions(b.readUInt32BE(16), b.readUInt32BE(20));
  }
  if (mime !== 'image/jpeg' || b.length < 4 || b.readUInt16BE(0) !== 0xffd8) fail();
  let p = 2, segments = 0, scans = 0;
  let frame: { width: number; height: number } | undefined;
  let components = new Set<number>();
  while (p < b.length) {
    if (++segments > 256 || b[p++] !== 0xff) fail();
    while (b[p] === 0xff) p++;
    const marker = b[p++];
    if (marker === 0xd9) {
      if (!frame || !scans || p !== b.length) fail();
      return frame!;
    }
    // Only 8-bit baseline/progressive Huffman JPEG. No arithmetic, lossless, hierarchy or DNL.
    if (![0xc0, 0xc2, 0xc4, 0xdb, 0xdd, 0xda, 0xfe].includes(marker) && !(marker >= 0xe0 && marker <= 0xef)) fail();
    if (p + 2 > b.length) fail();
    const length = b.readUInt16BE(p), end = p + length;
    if (length < 2 || end > b.length) fail();
    if (marker === 0xc0 || marker === 0xc2) {
      if (frame || length < 8 || b[p + 2] !== 8) fail();
      const count = b[p + 7];
      if (![1, 3].includes(count) || length !== 8 + 3 * count) fail();
      frame = dimensions(b.readUInt16BE(p + 5), b.readUInt16BE(p + 3));
      components = new Set(Array.from({ length: count }, (_, i) => b[p + 8 + i * 3]));
      if (components.size !== count) fail();
    }
    if (marker === 0xdd && length !== 4) fail();
    if (marker === 0xda) {
      if (!frame || ++scans > 64 || length < 6) fail();
      const count = b[p + 2];
      if (!count || count > components.size || length !== 6 + 2 * count) fail();
      const selected = Array.from({ length: count }, (_, i) => b[p + 3 + 2 * i]);
      if (new Set(selected).size !== count || selected.some(id => !components.has(id))) fail();
      p = end;
      // Scan entropy bytes linearly; stuffed FF00 and restart markers do not end a scan.
      while (p < b.length) {
        if (b[p] !== 0xff) { p++; continue; }
        let next = p + 1; while (b[next] === 0xff) next++;
        if (b[next] === 0 || (b[next] >= 0xd0 && b[next] <= 0xd7)) { p = next + 1; continue; }
        break;
      }
    } else p = end;
  }
  return fail();
}
