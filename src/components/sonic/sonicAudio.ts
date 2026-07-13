// Pure audio helpers for the Sonic Chat voice surface. Kept framework-free and side-effect
// free so the sample-rate + PCM conversion (the fiddly, bug-prone part) is unit-tested,
// even though the live mic/speaker round-trip can only be exercised in a real browser.
//
// Nova Sonic expects mic input as base64 LPCM, 16 kHz, 16-bit, mono; it returns audio as
// LPCM, 24 kHz, 16-bit, mono.

/** Linearly downsample a Float32 mono buffer from `inRate` to `outRate`. Returns the input
 *  unchanged when the rates match, and an empty array for a non-downsample (upsample) ask. */
export function downsampleFloat32(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate === inRate) return input;
  if (outRate > inRate || outRate <= 0 || inRate <= 0) return new Float32Array(0);
  const ratio = inRate / outRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    // Average the source window mapped to this output sample (cheap anti-alias).
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) { sum += input[j]; n++; }
    out[i] = n > 0 ? sum / n : 0;
  }
  return out;
}

/** Clamp a Float32 sample [-1,1] to a signed 16-bit integer. */
export function floatToInt16(sample: number): number {
  const s = Math.max(-1, Math.min(1, sample));
  return s < 0 ? s * 0x8000 : s * 0x7fff;
}

/** Encode a Float32 mono buffer to a base64 little-endian 16-bit PCM string. */
export function float32ToBase64PCM16(input: Float32Array): string {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) view.setInt16(i * 2, floatToInt16(input[i]), true);
  return bytesToBase64(new Uint8Array(buffer));
}

/** Decode a base64 16-bit PCM string to a Float32 buffer in [-1,1]. */
export function base64PCM16ToFloat32(b64: string): Float32Array {
  const bytes = base64ToBytes(b64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

// Base64 helpers that work in both the browser and Node (tests) without atob/btoa quirks.
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
