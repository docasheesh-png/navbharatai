/**
 * Tests for BuildVerifier — verifies generated files exist, have valid content,
 * and do not contain forbidden patterns.
 * Uses temp files so no project-directory files are created.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BuildVerifier } from '../src/server/BuildEngine/BuildVerifier';
import type { VerificationTarget } from '../src/server/BuildEngine/types';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-test-'));

  // good.tsx — valid content, no forbidden patterns, length > 20
  fs.writeFileSync(path.join(tmpDir, 'good.tsx'), 'export default function App() { return null; }');

  // forbidden_todo.tsx — contains "TODO"
  fs.writeFileSync(path.join(tmpDir, 'forbidden_todo.tsx'), 'export default function App() { /* TODO: implement */ }');

  // forbidden_stub.tsx — contains "stub"
  fs.writeFileSync(path.join(tmpDir, 'forbidden_stub.tsx'), 'export default function stub() { return null; }');

  // forbidden_placeholder.tsx — contains "placeholder"
  fs.writeFileSync(path.join(tmpDir, 'forbidden_placeholder.tsx'), 'const x = "placeholder for real code";');

  // too_small.tsx — fewer than 20 chars
  fs.writeFileSync(path.join(tmpDir, 'too_small.tsx'), 'export {}');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function target(filename: string): VerificationTarget {
  // Use relative path from CWD so path.resolve(cwd, relPath) yields the actual temp file
  const rel = path.relative(process.cwd(), path.join(tmpDir, filename));
  return { filePath: rel, verificationType: 'exists' };
}

const verifier = new BuildVerifier();

describe('BuildVerifier.verify — passing cases', () => {
  it('returns true for a single valid file', () => {
    expect(verifier.verify([target('good.tsx')])).toBe(true);
  });

  it('returns true for an empty targets array', () => {
    expect(verifier.verify([])).toBe(true);
  });
});

describe('BuildVerifier.verify — failing cases', () => {
  it('returns false when the file does not exist', () => {
    const t: VerificationTarget = { filePath: 'nonexistent/file.tsx', verificationType: 'exists' };
    expect(verifier.verify([t])).toBe(false);
  });

  it('returns false when the file contains "TODO"', () => {
    expect(verifier.verify([target('forbidden_todo.tsx')])).toBe(false);
  });

  it('returns false when the file contains "stub"', () => {
    expect(verifier.verify([target('forbidden_stub.tsx')])).toBe(false);
  });

  it('returns false when the file contains "placeholder"', () => {
    expect(verifier.verify([target('forbidden_placeholder.tsx')])).toBe(false);
  });

  it('returns false when the file content is shorter than 20 characters', () => {
    expect(verifier.verify([target('too_small.tsx')])).toBe(false);
  });

  it('returns false if ANY target in a list fails (fail-fast)', () => {
    // First target is good, second is missing — should still fail
    const t: VerificationTarget = { filePath: 'nonexistent.tsx', verificationType: 'exists' };
    expect(verifier.verify([target('good.tsx'), t])).toBe(false);
  });
});
