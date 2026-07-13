import { describe, it, expect } from 'vitest';
import {
  downsampleFloat32,
  floatToInt16,
  float32ToBase64PCM16,
  base64PCM16ToFloat32,
} from './sonicAudio';

describe('sonicAudio PCM conversion (the bug-prone core, unit-locked)', () => {
  it('downsample keeps rate-equal input unchanged and halves 32k→16k length', () => {
    const a = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    expect(downsampleFloat32(a, 16000, 16000)).toBe(a);
    const half = downsampleFloat32(new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]), 32000, 16000);
    expect(half.length).toBe(4);
  });

  it('never upsamples (returns empty) — Nova Sonic wants 16k mic input, not more', () => {
    expect(downsampleFloat32(new Float32Array([0.5]), 16000, 24000).length).toBe(0);
  });

  it('floatToInt16 clamps out-of-range samples', () => {
    expect(floatToInt16(2)).toBe(0x7fff);
    expect(floatToInt16(-2)).toBe(-0x8000);
    expect(floatToInt16(0)).toBe(0);
  });

  it('base64 PCM16 round-trips a Float32 buffer within quantization error', () => {
    const original = new Float32Array([0, 0.25, -0.5, 0.75, -1, 1]);
    const restored = base64PCM16ToFloat32(float32ToBase64PCM16(original));
    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(restored[i] - original[i])).toBeLessThan(0.001);
    }
  });

  it('produces a non-empty base64 string for real audio', () => {
    const b64 = float32ToBase64PCM16(new Float32Array([0.1, 0.2, 0.3]));
    expect(typeof b64).toBe('string');
    expect(b64.length).toBeGreaterThan(0);
  });
});
