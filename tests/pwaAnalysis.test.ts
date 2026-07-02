import { describe, it, expect } from 'vitest';
import { analyzePwa, pwaSummary } from '../src/server/AgentV3/PwaAnalysis';

/** P-PIPE.84 — PWA/installability advisory (pure, opt-in by intent). */

const src = (path: string, content: string) => ({ path, content });

describe('analyzePwa — silent unless there is PWA intent', () => {
  it('a plain app (no manifest/SW/meta/plugin) is NOT assessed → the line is omitted', () => {
    const r = analyzePwa([src('src/App.tsx', 'export default function App(){return null}')], ['src/App.tsx'], ['react']);
    expect(r.assessed).toBe(false);
    expect(pwaSummary(r)).toBe('');
  });

  it('a PWA build plugin → complete, no nag', () => {
    const r = analyzePwa([src('index.html', '<html></html>')], ['index.html', 'vite.config.ts'], ['vite-plugin-pwa']);
    expect(r.assessed).toBe(true);
    expect(r.complete).toBe(true);
    expect(pwaSummary(r)).toContain('installable');
  });
});

describe('analyzePwa — flags the concrete missing piece when intent is present', () => {
  it('manifest linked but no manifest file → medium (link will 404)', () => {
    const r = analyzePwa([src('index.html', '<link rel="manifest" href="/manifest.json">')], ['index.html'], []);
    expect(r.assessed).toBe(true);
    expect(r.findings.some((f) => f.level === 'medium' && /404/.test(f.message))).toBe(true);
  });

  it('manifest file present but not linked → medium (undiscoverable)', () => {
    const r = analyzePwa([src('index.html', '<html></html>')], ['index.html', 'public/manifest.json'], []);
    expect(r.findings.some((f) => /not linked/.test(f.message))).toBe(true);
  });

  it('manifest present (linked + file) but no service worker → low (installable, no offline)', () => {
    const r = analyzePwa(
      [src('index.html', '<link rel="manifest" href="/manifest.json">')],
      ['index.html', 'manifest.json'],
      [],
    );
    expect(r.complete).toBe(false);
    expect(r.findings.some((f) => f.level === 'low' && /offline/.test(f.message))).toBe(true);
  });

  it('service worker registered but no manifest → low (can\'t add to home screen)', () => {
    const r = analyzePwa([src('src/main.tsx', "navigator.serviceWorker.register('/sw.js')")], ['src/main.tsx'], []);
    expect(r.assessed).toBe(true);
    expect(r.findings.some((f) => /home screen/.test(f.message))).toBe(true);
  });

  it('a complete static PWA (manifest linked + file + SW) → complete tick', () => {
    const r = analyzePwa(
      [src('index.html', '<link rel="manifest" href="/manifest.json">'), src('src/main.tsx', "navigator.serviceWorker.register('/sw.js')")],
      ['index.html', 'manifest.json', 'sw.js', 'src/main.tsx'],
      [],
    );
    expect(r.complete).toBe(true);
    expect(pwaSummary(r)).toContain('✓');
  });
});
