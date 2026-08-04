import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Admin 2026-07-24: "Other AI ki API call = Professional AI". The Other-AI tools must call the SAME
// resilient chain the 70+ professionals use — via the ONE shared helper (no drift). These tests lock
// that wiring so a future edit that silently reverts a tool to the flat 'free' router fails CI.

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('Shared professional routing is the single source of truth', () => {
  it('professionalRouting.ts exposes callProfessionalAI over the professional namespaces', () => {
    const src = read('src/server/lib/professionalRouting.ts');
    expect(src).toContain('export async function callProfessionalAI');
    expect(src).toContain("'professional-free'");
    expect(src).toContain("'professional-free-fallback'");
    expect(src).toContain("'professional'");
  });

  it('the professionals engine delegates to the shared helper (one implementation, no drift)', () => {
    const src = read('src/server/professionals/engine.ts');
    expect(src).toContain('callProfessionalAI');
    // The engine no longer holds its own copy of the router chain.
    expect(src).not.toContain("AIRouterManager.getRouter('professional-free')");
  });
});

describe('Other AI tools now use the Professional-AI engine, not the flat free router', () => {
  const tools: Array<[string, string]> = [
    ['AI Debugger (single error)', 'src/server/routes/debug.ts'],
    ['AI Debugger (full-app scan + investigate)', 'src/server/routes/appDebug.ts'],
    ['Design pass (Design System / Dark Mode / Components)', 'src/server/routes/design.ts'],
  ];
  for (const [name, path] of tools) {
    it(`${name} calls callProfessionalAI and no longer uses getRouter('free')`, () => {
      const src = read(path);
      expect(src).toContain('callProfessionalAI');
      expect(src).not.toContain("getRouter('free')");
    });
  }
});
