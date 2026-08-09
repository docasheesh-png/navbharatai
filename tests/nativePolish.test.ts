import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { playTapTone, TAP_TONE_DURATION_S, TAP_TONE_GAIN, type AudioContextLike } from '../src/lib/tapTone';

/**
 * ADMIN 2026-08-09 — three native-feel reports, locked here:
 *  1. Desktop Apple login: the click handler fetched the firebase/auth chunk INSIDE the click, the
 *     network wait consumed the browser's transient user activation, so the popup was blocked and
 *     the redirect fallback died on desktop Chrome's storage-partitioned return. The module promise
 *     must start at MODULE LOAD, never inside the handler.
 *  2. Splash: the stock Capacitor artwork must be gone — every density bucket carries a GENERATED
 *     NavBharatAI splash (tagged by the generator), and the minimum splash time is 1s, not 2s.
 *  3. Tap feedback is SOUND, not vibration (nativeShell.test.ts covers the listener; here the tone).
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('1. Apple sign-in keeps its user activation (desktop popup fix)', () => {
  const auth = read('src/components/AuthComponent.tsx');

  it('the firebase/auth module promise starts at module load', () => {
    expect(auth).toContain("const firebaseAuthModuleForApple = import('firebase/auth');");
  });

  it('the click handler awaits the PREFETCHED promise — never a fresh import()', () => {
    expect(auth).toContain('await firebaseAuthModuleForApple');
    const handlerAt = auth.indexOf('const handleAppleSignIn');
    const handler = auth.slice(handlerAt, handlerAt + 2000);
    expect(handler).not.toContain("await import('firebase/auth')");
  });
});

describe('2. Splash — NavBharatAI branding, snappier minimum', () => {
  const BUCKETS = [
    'drawable', 'drawable-land-mdpi', 'drawable-land-hdpi', 'drawable-land-xhdpi',
    'drawable-land-xxhdpi', 'drawable-land-xxxhdpi', 'drawable-port-mdpi', 'drawable-port-hdpi',
    'drawable-port-xhdpi', 'drawable-port-xxhdpi', 'drawable-port-xxxhdpi',
  ];

  it('every density bucket carries the GENERATED splash, not the stock Capacitor artwork', () => {
    for (const b of BUCKETS) {
      const bytes = readFileSync(join(process.cwd(), `android/app/src/main/res/${b}/splash.png`));
      // The generator stamps a PNG tEXt marker — stock Capacitor artwork has no such tag.
      expect(bytes.includes(Buffer.from('navbharatai-splash-generator')), `${b} still stock`).toBe(true);
    }
  });

  it('portrait/landscape buckets have the right orientation dimensions (IHDR)', () => {
    const dims = (rel: string) => {
      const b = readFileSync(join(process.cwd(), rel));
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    };
    const land = dims('android/app/src/main/res/drawable-land-xxhdpi/splash.png');
    const port = dims('android/app/src/main/res/drawable-port-xxhdpi/splash.png');
    expect(land.w).toBeGreaterThan(land.h);
    expect(port.h).toBeGreaterThan(port.w);
  });

  it('the splash minimum is 1s (was 2s) and auto-hide REMAINS true (the anti-brick rule)', () => {
    const cfg = read('capacitor.config.ts');
    expect(cfg).toContain('launchShowDuration: 1000');
    expect(cfg).toContain('launchAutoHide: true');
    expect(cfg).toContain("backgroundColor: '#0d1117'");
  });
});

describe('3. The tap tone — a soft synthesised "tak"', () => {
  function fakeAudio() {
    const calls: string[] = [];
    const osc = {
      type: '', frequency: { value: 0 },
      connect: () => calls.push('osc.connect'),
      start: () => calls.push('osc.start'),
      stop: () => calls.push('osc.stop'),
    };
    const gain = {
      gain: {
        setValueAtTime: (v: number) => calls.push(`gain=${v}`),
        exponentialRampToValueAtTime: () => calls.push('decay'),
      },
      connect: () => calls.push('gain.connect'),
    };
    const ctx: AudioContextLike = {
      currentTime: 0, state: 'running', destination: {},
      createOscillator: () => osc, createGain: () => gain,
    };
    return { ctx, osc, calls };
  }

  it('plays one short, quiet tick', () => {
    const f = fakeAudio();
    playTapTone(() => f.ctx);
    expect(f.calls).toContain('osc.start');
    expect(f.calls).toContain('osc.stop');
    expect(f.calls).toContain(`gain=${TAP_TONE_GAIN}`);
    expect(f.calls).toContain('decay');
    expect(TAP_TONE_DURATION_S).toBeLessThanOrEqual(0.05); // a tick, never a beep
    expect(TAP_TONE_GAIN).toBeLessThanOrEqual(0.15);       // feedback, never a notification
  });

  it('resumes a suspended context (the tap IS the user gesture audio needs)', () => {
    const f = fakeAudio();
    const resume = vi.fn(async () => {});
    playTapTone(() => ({ ...f.ctx, state: 'suspended', resume }));
    expect(resume).toHaveBeenCalled();
  });

  it('never throws — no audio stack means silence, not a broken tap', () => {
    expect(() => playTapTone(() => null)).not.toThrow();
    expect(() => playTapTone(() => { throw new Error('no audio'); })).not.toThrow();
  });

  it('the send button in chat uses the tone, and navigator.vibrate is gone from the tree', () => {
    expect(read('src/components/ide/AIChat.tsx')).toContain('playTapTone()');
    const { execSync } = require('child_process') as typeof import('child_process');
    const hits = execSync("grep -rn 'navigator.vibrate' src/components src/lib src/App.tsx || true", { encoding: 'utf8' }).trim();
    expect(hits).toBe('');
  });
});
