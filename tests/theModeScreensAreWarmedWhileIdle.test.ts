import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { shouldWarmModeChunks, WARMED_SCREENS } from '../src/lib/warmModeChunks';

/**
 * THE SCREENS A MODE PICK OPENS ARE FETCHED WHILE THE BROWSER IS IDLE (admin 2026-10-14: "mode change karne
 * me bahut time lag raha hai"). Measured on the production build (4x CPU, 150 ms RTT, 1.5 Mbps): the first
 * switch to Teacher AI 490 ms -> 357 ms and to the image studio 590 ms -> 409 ms once their chunks are
 * already in the cache; later switches were 60-110 ms either way.
 *
 * The policy is pure so it is pinned here; the real fetch was verified in a browser (no click, four chunk
 * requests at ~3 s).
 */
describe('when the warm-up runs', () => {
  const web = { production: true, nativeShell: false };
  it('on the website in a production build', () => {
    expect(shouldWarmModeChunks(web)).toBe(true);
    expect(shouldWarmModeChunks({ ...web, effectiveType: '4g' })).toBe(true);
  });
  it('never in a dev build, never in the native apps (the bundle is on the device)', () => {
    expect(shouldWarmModeChunks({ ...web, production: false })).toBe(false);
    expect(shouldWarmModeChunks({ ...web, nativeShell: true })).toBe(false);
  });
  it('never on a data-saver or 2G connection — it must not spend a user\'s data', () => {
    expect(shouldWarmModeChunks({ ...web, saveData: true })).toBe(false);
    expect(shouldWarmModeChunks({ ...web, effectiveType: '2g' })).toBe(false);
    expect(shouldWarmModeChunks({ ...web, effectiveType: 'slow-2g' })).toBe(false);
  });
});

describe('what it warms', () => {
  it('the four screens a Mode pick opens, each a real dynamic import', () => {
    expect(WARMED_SCREENS.map((s) => s.name)).toEqual(['free-chat', 'professional-chat', 'doctor-ai', 'image-studio']);
    for (const s of WARMED_SCREENS) expect(typeof s.load).toBe('function');
  });
});

describe('🔒 the class: "native" is never read off window.Capacitor', () => {
  // The first build of the warm-up asked `typeof window.Capacitor !== "undefined"` — and fetched nothing on the
  // website, because Capacitor core defines that global in every browser. Native is asked of isNativeApp().
  const src = readFileSync('src/lib/warmModeChunks.ts', 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  it('uses isNativeApp(), not the mere presence of the global', () => {
    expect(src).toContain('nativeShell: isNativeApp()');
    expect(src).not.toMatch(/window as \{ Capacitor/);
  });
  it('App starts the warm-up once, from an effect with no dependencies', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain("import { warmModeChunksWhenIdle } from './lib/warmModeChunks';");
    expect(app).toContain('useEffect(() => { warmModeChunksWhenIdle(); }, []);');
  });
});

describe('🔒 the sibling: the cold-start sample does not call every website launch "app"', () => {
  it('main.tsx asks isNativeApp(), not whether window.Capacitor exists', () => {
    const main = readFileSync('src/main.tsx', 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(main).toContain('nativeShell: isNativeApp(),');
    expect(main).not.toMatch(/window as \{ Capacitor\?: unknown \}/);
  });
  it('no client file decides "native" from the bare presence of window.Capacitor', () => {
    const files = ['src/main.tsx', 'src/lib/warmModeChunks.ts', 'src/App.tsx'];
    for (const f of files) {
      const code = readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      expect(code, f).not.toMatch(/typeof \(?window[^)]*\)?\.Capacitor\s*!==\s*['"]undefined['"]/);
    }
  });
});
