import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { missingViteEnvTypes, viteEnvTypesNote, VITE_ENV_DTS_PATH } from '../src/server/AgentV3/viteEnvTypes';

/**
 * ADMIN REPORT 2026-08-12 — the dukaan stock app. Four type-checks, 106 seconds, one missing line.
 *
 * The build's sandbox log:
 *
 *     776s  tsc --noEmit  →  "src/api/client.ts(1,29): error TS2339:
 *                             Property 'env' does not exist on type 'ImportMeta'."
 *     821s  tsc --noEmit  →  exit 2
 *     853s  tsc --noEmit  →  exit 2
 *     882s  tsc --noEmit  →  exit 0
 *
 * `import.meta.env` is the ONLY way a Vite app reads its configuration, and TypeScript does not know it
 * exists until something in the project references `vite/client`. In a `npm create vite` project that
 * something is one generated line in `src/vite-env.d.ts` — and that file is absent from the shipped
 * app's manifest. Our own scaffolds DO write it, so this is what a build looks like when the scaffold's
 * copy never survived to the project the agent ended up compiling.
 *
 * The agent then had to DISCOVER the problem from a compiler error, guess at it, and re-run the whole
 * type-check to learn whether the guess worked — three times. That is the wrong kind of work to spend a
 * model on: the condition is mechanical, the fix is a fixed string, and a types-only triple-slash
 * directive has ZERO runtime effect. It cannot change what the app does, only what the compiler knows.
 */

describe('the missing line that cost three type-check rounds', () => {
  it('fires on the report\'s exact file', () => {
    const fix = missingViteEnvTypes({
      'src/api/client.ts': "const base = import.meta.env.VITE_API_URL ?? '/api';\nexport default base;",
      'src/App.tsx': 'export default function App() { return null; }',
    });
    expect(fix).toEqual({ path: VITE_ENV_DTS_PATH, content: '/// <reference types="vite/client" />\n' });
  });

  it('stays silent on an app that never reads import.meta.env', () => {
    // The overwhelming majority of builds. A guard that fires on a plain app is a guard nobody trusts.
    expect(missingViteEnvTypes({ 'src/App.tsx': 'export default () => null;' })).toBeNull();
    expect(missingViteEnvTypes({})).toBeNull();
    expect(missingViteEnvTypes(null as any)).toBeNull();
  });

  it('matches the real spellings, and not a lookalike', () => {
    const uses = (src: string) => missingViteEnvTypes({ 'src/a.ts': src }) !== null;
    expect(uses('import.meta.env.VITE_X')).toBe(true);
    expect(uses('import.meta .env.MODE')).toBe(true);       // formatter-spaced
    expect(uses('const { VITE_X } = import.meta.env')).toBe(true);
    expect(uses("process.env.VITE_X")).toBe(false);          // Node env is a different mechanism
    expect(uses("const s = 'import.meta.environment'")).toBe(false);
  });
});

describe('a project that already solved this is left completely alone', () => {
  const client = { 'src/api/client.ts': 'export const u = import.meta.env.VITE_API_URL;' };

  it('the scaffold\'s own vite-env.d.ts wins', () => {
    expect(missingViteEnvTypes({ ...client, [VITE_ENV_DTS_PATH]: '/// <reference types="vite/client" />' })).toBeNull();
  });

  it('a d.ts under ANY other name counts', () => {
    expect(missingViteEnvTypes({ ...client, 'env.d.ts': '/// <reference types="vite/client" />' })).toBeNull();
    expect(missingViteEnvTypes({ ...client, 'types/globals.d.ts': '/// <reference types="vite/client" />' })).toBeNull();
  });

  it('a tsconfig "types" array counts exactly as much as a d.ts', () => {
    /**
     * The point of checking EVERY file rather than only sources: `"types": ["vite/client"]` in a
     * tsconfig solves this completely, and adding a second declaration on top of it would be noise in
     * a project whose author had already made the decision.
     */
    expect(missingViteEnvTypes({ ...client, 'tsconfig.json': '{"compilerOptions":{"types":["vite/client"]}}' })).toBeNull();
  });

  it('an EXISTING src/vite-env.d.ts is never overwritten, whatever it holds', () => {
    // It is the user's file. A guard that rewrites a file it did not create is not a guard.
    const fix = missingViteEnvTypes({ ...client, [VITE_ENV_DTS_PATH]: '// deliberately emptied' });
    expect(fix).toBeNull();
  });

  it('node_modules and build output are not evidence either way', () => {
    // A vendored copy proves nothing about THIS project's compilation, in either direction.
    expect(missingViteEnvTypes({ 'node_modules/vite/client.d.ts': 'vite/client', ...client })).not.toBeNull();
    expect(missingViteEnvTypes({ 'dist/assets/x.js': 'import.meta.env.VITE_X' })).toBeNull();
  });
});

describe('the report says what it did and what it saved', () => {
  it('names the compiler error the user would otherwise have paid to rediscover', () => {
    const n = viteEnvTypesNote();
    expect(n).toMatch(/Property 'env' does not exist on type 'ImportMeta'/);
    expect(n).toContain(VITE_ENV_DTS_PATH);
    expect(n).toMatch(/no runtime effect/);
    expect(n).toMatch(/instead of spending a repair round/);
  });

  it('names no provider or model — white-label law', () => {
    expect(viteEnvTypesNote()).not.toMatch(/\b(glm|kimi|claude|anthropic|openai|gemini|grok|sonnet|opus)\b/i);
  });
});

describe('WIRING — both build paths, and neither can break an app', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  const simple = readFileSync(join(process.cwd(), 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8');

  it('the AGENTIC path repairs it — the path the reported build actually took', () => {
    expect(route).toContain('const dts = missingViteEnvTypes(integrityFiles);');
    expect(route).toContain("code: 'VITE_ENV_TYPES_ADDED'");
  });

  it('the FAST lane repairs it too, before its own tsc gate runs', () => {
    // Fixing only the path that happened to fail this time is how a sibling failure comes back.
    expect(simple).toContain('const dts = missingViteEnvTypes(');
    const at = simple.indexOf('missingViteEnvTypes(');
    const gate = simple.indexOf('VERIFY GATE + bounded AUTO-REPAIR');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(gate); // written before the type-check it exists to satisfy
  });

  it('it never runs on an IMPORT turn — the user said do not change files', () => {
    const at = route.indexOf('const dts = missingViteEnvTypes(integrityFiles);');
    expect(route.slice(route.lastIndexOf('if (process.env.AGENTV3_VITE_ENV_TYPES', at), at)).toContain('!isImportTurn');
  });

  it('has a kill switch on both paths', () => {
    expect(route).toContain("process.env.AGENTV3_VITE_ENV_TYPES !== 'off'");
    expect(simple).toContain("process.env.AGENTV3_VITE_ENV_TYPES !== 'off'");
  });

  it('a sandbox write failure cannot fail the build', () => {
    const at = route.indexOf('const dts = missingViteEnvTypes(integrityFiles);');
    expect(route.slice(at, at + 700)).toMatch(/catch \{ \/\* sandbox write best-effort/);
  });
});
