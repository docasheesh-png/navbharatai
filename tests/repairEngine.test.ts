/**
 * Tests for BuildEngine/RepairEngine — pure error-detection logic.
 * Uses a temp file so no project-directory files are created.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { RepairEngine } from '../src/server/BuildEngine/RepairEngine';

let tmpDir: string;
let testFile: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 're-test-'));
  testFile = path.join(tmpDir, 'Broken.tsx');
  fs.writeFileSync(testFile, 'import { foo } from "missing-module";\nexport default function Broken() { return foo(); }');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('RepairEngine.repair', () => {
  const engine = new RepairEngine();

  it('returns true when error contains "Cannot find module"', async () => {
    const result = await engine.repair(testFile, 'Cannot find module "missing-module"');
    expect(result).toBe(true);
  });

  it('returns true when error contains "not found"', async () => {
    const result = await engine.repair(testFile, 'Module not found: react');
    expect(result).toBe(true);
  });

  it('returns false for an unrecognized error', async () => {
    const result = await engine.repair(testFile, 'SyntaxError: unexpected token');
    expect(result).toBe(false);
  });
});
