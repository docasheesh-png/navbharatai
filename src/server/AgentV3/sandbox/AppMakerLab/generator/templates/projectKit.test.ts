import { describe, it, expect, afterEach } from 'vitest';
import { projectKitEnabled, projectKitFiles } from './projectKit';
import { ViteReactProvider } from './ViteReactProvider';
import { packageJson } from './ViteReactProviderContents';

describe('vite-react project kit (D-7, flag default off)', () => {
  const prev = process.env.AGENTV3_SCAFFOLD_PROJECT_KIT;
  afterEach(() => { if (prev === undefined) delete process.env.AGENTV3_SCAFFOLD_PROJECT_KIT; else process.env.AGENTV3_SCAFFOLD_PROJECT_KIT = prev; });

  it('is off unless the flag is exactly on', () => {
    expect(projectKitEnabled({})).toBe(false);
    expect(projectKitEnabled({ AGENTV3_SCAFFOLD_PROJECT_KIT: 'true' })).toBe(false);
    expect(projectKitEnabled({ AGENTV3_SCAFFOLD_PROJECT_KIT: 'on' })).toBe(true);
  });

  it('flag off: the starter is byte-identical to before (no kit files, same package.json)', () => {
    delete process.env.AGENTV3_SCAFFOLD_PROJECT_KIT;
    const files = new ViteReactProvider().getFiles([]);
    expect(files['README.md']).toBeUndefined();
    expect(files['.env.example']).toBeUndefined();
    expect(files['package.json']).toBe(packageJson);
  });

  it('flag on: adds README, .env.example, env helper + test, folders, and a runnable test script', () => {
    process.env.AGENTV3_SCAFFOLD_PROJECT_KIT = 'on';
    const files = new ViteReactProvider().getFiles([]);
    for (const p of ['README.md', '.env.example', 'src/lib/env.ts', 'src/lib/env.test.ts', 'src/components/.gitkeep', 'src/pages/.gitkeep']) {
      expect(files[p], p).toBeDefined();
    }
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.devDependencies.vitest).toBeTruthy();
    expect(pkg.scripts.build).toBe(JSON.parse(packageJson).scripts.build);
    expect(files['.env.example']).not.toMatch(/SECRET|sk_live/);
  });

  it('is pure: same input, same files', () => {
    expect(projectKitFiles(packageJson)).toEqual(projectKitFiles(packageJson));
  });
});
