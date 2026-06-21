/**
 * Tests for BuildEngine type shapes and the BuildVerifier content validator.
 * BuildVerifier reads real filesystem; we use a temp dir via Node's tmp mechanism.
 */
import { describe, it, expect } from 'vitest';
import type { BuildManifest, VerificationTarget, Feature, AtomicComponent, LogicHandler } from '../src/server/BuildEngine/types';
import { BuildVerifier } from '../src/server/BuildEngine/BuildVerifier';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Type shape tests (compile-time + runtime) ────────────────────────────────

describe('BuildEngine types', () => {
  it('BuildManifest has expected fields', () => {
    const manifest: BuildManifest = {
      projectType: 'react-app',
      features: ['auth'],
      components: ['Button'],
      logicHandlers: ['loginHandler'],
      filesToGenerate: ['src/App.tsx'],
      dependencies: ['react'],
    };
    expect(manifest.projectType).toBe('react-app');
    expect(manifest.features).toContain('auth');
  });

  it('VerificationTarget accepts all verificationType values', () => {
    const targets: VerificationTarget[] = [
      { filePath: 'a.ts', verificationType: 'exists' },
      { filePath: 'b.tsx', verificationType: 'react-component' },
      { filePath: 'c.ts', verificationType: 'typescript' },
      { filePath: 'd.ts', verificationType: 'api-route' },
      { filePath: 'e.ts', verificationType: 'database-model' },
    ];
    expect(targets).toHaveLength(5);
  });

  it('Feature has all required fields', () => {
    const feature: Feature = {
      id: 'auth',
      dependencies: ['database'],
      capabilities: ['login', 'logout'],
      components: ['LoginForm'],
      logicHandlers: [{ category: 'auth', inputs: {}, outputs: {} }],
    };
    expect(feature.id).toBe('auth');
    expect(feature.capabilities).toContain('login');
  });
});

// ── BuildVerifier tests using a real temp directory ──────────────────────────

describe('BuildVerifier', () => {
  function withTempFile(name: string, content: string, fn: (p: string) => void) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-test-'));
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, content);
    try {
      fn(filePath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('returns true for a valid file', () => {
    withTempFile('valid.ts', 'export const x = 1; // real content here', (fp) => {
      const verifier = new BuildVerifier();
      const result = verifier.verify([{ filePath: fp, verificationType: 'exists' }]);
      expect(result).toBe(true);
    });
  });

  it('returns false when file does not exist', () => {
    const verifier = new BuildVerifier();
    const result = verifier.verify([{ filePath: '/tmp/__nonexistent_file__.ts', verificationType: 'exists' }]);
    expect(result).toBe(false);
  });

  it('returns false when file contains "TODO"', () => {
    withTempFile('todo.ts', 'export const x = 1; // TODO: implement this properly', (fp) => {
      const verifier = new BuildVerifier();
      const result = verifier.verify([{ filePath: fp, verificationType: 'exists' }]);
      expect(result).toBe(false);
    });
  });

  it('returns false when file contains "stub"', () => {
    withTempFile('stub.ts', 'export function auth() { /* stub implementation */ }', (fp) => {
      const verifier = new BuildVerifier();
      const result = verifier.verify([{ filePath: fp, verificationType: 'exists' }]);
      expect(result).toBe(false);
    });
  });

  it('returns false when file is too small (< 20 chars)', () => {
    withTempFile('tiny.ts', 'const x=1;', (fp) => {
      const verifier = new BuildVerifier();
      const result = verifier.verify([{ filePath: fp, verificationType: 'exists' }]);
      expect(result).toBe(false);
    });
  });

  it('returns true for empty target array', () => {
    const verifier = new BuildVerifier();
    expect(verifier.verify([])).toBe(true);
  });
});
