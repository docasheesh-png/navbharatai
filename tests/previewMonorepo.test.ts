import { describe, it, expect } from 'vitest';
import { buildReactPreview, nearestPackageJson } from '../src/server/runtime/ReactPreview';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

/**
 * PHASE 1b — imported GitHub projects are frequently monorepos, and the importmap could not see them.
 *
 * It read `package.json` at the ROOT only. In a workspace repo — `apps/web/`, `packages/ui/`, a pnpm
 * workspace — the root manifest lists no runtime dependencies at all, so every one of the app's
 * packages was absent from the importmap and resolved with no version pin: whatever the CDN considered
 * latest, which is not the version the project was written against.
 *
 * Generated apps never hit this, because the scaffold puts one manifest at the root. Imported ones hit
 * it constantly — the exact asymmetry the whole import phase exists to correct.
 */

const vfs = (files: Record<string, string>) => VirtualFileSystem.fromRecord(files);
const pkg = (deps: Record<string, string>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...extra, dependencies: deps });

describe('finding the manifest that actually governs the app', () => {
  it('a monorepo app finds its OWN manifest, not the workspace root', () => {
    const v = vfs({
      'package.json': JSON.stringify({ name: 'monorepo', private: true, workspaces: ['apps/*'] }),
      'apps/web/package.json': pkg({ react: '18.3.1', axios: '1.6.0' }),
      'apps/web/src/main.tsx': 'export default () => null;',
    });
    expect(nearestPackageJson(v, 'apps/web/src/main.tsx')).toBe('apps/web/package.json');
  });

  it('a normal single-package project is unchanged', () => {
    // The property that makes this safe to ship: every app this engine generates takes exactly the
    // path it took before. The change can only ADD a manifest that was previously invisible.
    const v = vfs({ 'package.json': pkg({ react: '18.3.1' }), 'src/main.tsx': 'x' });
    expect(nearestPackageJson(v, 'src/main.tsx')).toBe('package.json');
  });

  it('falls back to the root when the app has no manifest of its own', () => {
    const v = vfs({ 'package.json': pkg({ react: '18.3.1' }), 'apps/web/src/main.tsx': 'x' });
    expect(nearestPackageJson(v, 'apps/web/src/main.tsx')).toBe('package.json');
  });

  it('walks PAST a manifest that declares no dependencies', () => {
    // A `packages/ui/package.json` carrying only a name describes nothing the importmap needs.
    // Stopping there would hand back an empty dependency set and lose the real one above it.
    const v = vfs({
      'package.json': pkg({ react: '18.3.1' }),
      'packages/ui/package.json': JSON.stringify({ name: '@acme/ui' }),
      'packages/ui/src/index.tsx': 'x',
    });
    expect(nearestPackageJson(v, 'packages/ui/src/index.tsx')).toBe('package.json');
  });

  it('an unreadable manifest does not stop the walk', () => {
    const v = vfs({
      'package.json': pkg({ react: '18.3.1' }),
      'apps/web/package.json': '{ this is not json',
      'apps/web/src/main.tsx': 'x',
    });
    expect(nearestPackageJson(v, 'apps/web/src/main.tsx')).toBe('package.json');
  });

  it('no entry at all still answers with the root', () => {
    expect(nearestPackageJson(vfs({ 'package.json': pkg({ react: '18' }) }), null)).toBe('package.json');
    expect(nearestPackageJson(vfs({ 'package.json': pkg({ react: '18' }) }), '')).toBe('package.json');
  });

  it('picks the NEAREST when manifests are nested', () => {
    const v = vfs({
      'package.json': pkg({ react: '17.0.0' }),
      'apps/web/package.json': pkg({ react: '18.3.1' }),
      'apps/web/src/main.tsx': 'x',
    });
    expect(nearestPackageJson(v, 'apps/web/src/main.tsx')).toBe('apps/web/package.json');
  });
});

describe('what the rendered page actually contains', () => {
  const monorepo = vfs({
    'package.json': JSON.stringify({ name: 'monorepo', private: true, workspaces: ['apps/*'] }),
    'apps/web/package.json': pkg({ react: '18.3.1', 'react-dom': '18.3.1', axios: '1.6.0' }),
    'apps/web/index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
    'apps/web/src/main.tsx': "import axios from 'axios'; export default () => null;",
  });

  it('the workspace app\'s dependencies reach the importmap, version-pinned', () => {
    const html = buildReactPreview(monorepo);
    expect(html).toContain('axios@1.6.0');
    expect(html).toContain('react@18.3.1');
  });

  it('a single-package app renders exactly as before', () => {
    const html = buildReactPreview(vfs({
      'package.json': pkg({ react: '18.3.1', 'react-dom': '18.3.1', axios: '1.6.0' }),
      'index.html': '<div id="root"></div>',
      'src/main.tsx': "import axios from 'axios'; export default () => null;",
    }));
    expect(html).toContain('axios@1.6.0');
  });
});
