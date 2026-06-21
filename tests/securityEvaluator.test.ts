/**
 * Tests for SecurityEvaluator — scans directories for exposed secrets.
 * Uses temp directories to avoid touching real project files.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { SecurityEvaluator } from '../src/server/QualityEvaluationEngine/SecurityEvaluator';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sec-eval-'));
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('SecurityEvaluator', () => {
  it('returns PASS for a directory with no sensitive patterns', async () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'app.ts'), 'export const greeting = "hello world";');
      const evaluator = new SecurityEvaluator();
      const result = await evaluator.evaluate(dir);
      expect(result.status).toBe('PASS');
      expect(result.errors).toHaveLength(0);
    } finally {
      cleanup(dir);
    }
  });

  it('returns FAIL when a file contains an API_KEY pattern', async () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'config.ts'), 'const API_KEY = "sk-abcdef1234567890abcd";');
      const evaluator = new SecurityEvaluator();
      const result = await evaluator.evaluate(dir);
      expect(result.status).toBe('FAIL');
      expect(result.errors.length).toBeGreaterThan(0);
    } finally {
      cleanup(dir);
    }
  });

  it('returns FAIL when a file contains a SECRET pattern', async () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'env.ts'), 'const JWT_SECRET = "mysecretkey1234567890";');
      const evaluator = new SecurityEvaluator();
      const result = await evaluator.evaluate(dir);
      expect(result.status).toBe('FAIL');
    } finally {
      cleanup(dir);
    }
  });

  it('returns PASS for an empty directory', async () => {
    const dir = makeTempDir();
    try {
      const evaluator = new SecurityEvaluator();
      const result = await evaluator.evaluate(dir);
      expect(result.status).toBe('PASS');
    } finally {
      cleanup(dir);
    }
  });

  it('scans nested directories', async () => {
    const dir = makeTempDir();
    try {
      const subDir = path.join(dir, 'src', 'config');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, 'secrets.ts'), 'export const PRIVATE_KEY = "privatekey1234567890abcdef";');
      const evaluator = new SecurityEvaluator();
      const result = await evaluator.evaluate(dir);
      expect(result.status).toBe('FAIL');
      expect(result.errors.some(e => e.includes('secrets.ts'))).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('skips node_modules directory', async () => {
    const dir = makeTempDir();
    try {
      const nmDir = path.join(dir, 'node_modules', 'some-pkg');
      fs.mkdirSync(nmDir, { recursive: true });
      fs.writeFileSync(path.join(nmDir, 'index.js'), 'const API_KEY = "sk-abcdef1234567890abcd";');
      const evaluator = new SecurityEvaluator();
      const result = await evaluator.evaluate(dir);
      // node_modules is skipped — no errors expected
      expect(result.status).toBe('PASS');
    } finally {
      cleanup(dir);
    }
  });
});
