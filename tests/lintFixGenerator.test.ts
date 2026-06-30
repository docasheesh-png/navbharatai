import { describe, it, expect } from 'vitest';
import { chooseLintFixCommand, LintFixGenerator } from '../src/server/AppMakerLab/generator/LintFixGenerator';

/** P-CGE.7 — Lint Fix Generator: pure command chooser + best-effort no-throw on a missing workspace. */

describe('chooseLintFixCommand', () => {
  it("uses the project's own lint script when present", () => {
    expect(chooseLintFixCommand({ scripts: { lint: 'eslint src' } })).toBe('npm run lint -- --fix');
  });
  it('falls back to a direct eslint --fix when there is no lint script', () => {
    expect(chooseLintFixCommand({ scripts: { build: 'tsc' } })).toBe('npx --no-install eslint . --ext .ts,.tsx,.js,.jsx,.mjs,.cjs --fix');
    expect(chooseLintFixCommand(null)).toContain('eslint . ');
    expect(chooseLintFixCommand({})).toContain('eslint . ');
  });
});

describe('LintFixGenerator.fix', () => {
  it('returns ran:false (no throw) when the workspace has no package.json', async () => {
    const res = await new LintFixGenerator().fix('/tmp/__nb_nonexistent_workspace__');
    expect(res.ran).toBe(false);
    expect(res.note).toContain('no package.json');
  });
});
