/**
 * AUTOPSY f496c75b (open since 2026-09-30): three deterministic writers that run after the app may be
 * latched green — the vite-config guard, the HTML entry guard and the import dedupe — wrote with no pass
 * name. To the green freeze an unnamed write is an unknown writer, and its refusal was reported with no
 * owner. Worse, the pre-verdict import dedupe saved its change to the durable store even when the live
 * write had been refused, so the next session restored a change the working app never had.
 *
 * Source guards, because tsc and vitest cannot see that a write carries no name: each of these writers
 * runs inside a named pass, and the dedupe saves only after its live write landed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

describe('every late deterministic writer names itself', () => {
  const named: Array<[string, RegExp]> = [
    ['vite-config-guard', /runInPass\('vite-config-guard', \(\) => actuator\.writeFile\(workspaceId, cfg\.path, cfg\.content\)\)/],
    ['html-entry-guard', /runInPass\('html-entry-guard', \(\) => actuator\.writeFile\(workspaceId, htmlKey, fixed\)\)/],
    ['dangling-css-guard', /runInPass\('dangling-css-guard', \(\) => actuator\.writeFile\(workspaceId, file, fixed\)\)/],
    ['duplicate-import-dedupe', /runInPass\('duplicate-import-dedupe', \(\) => actuator\.writeFile\(workspaceId, p, deduped\)\)/],
    ['stylesheet-dedupe', /runInPass\('stylesheet-dedupe', \(\) => actuator\.writeFile\(workspaceId, r\.from, next\)\)/],
  ];
  for (const [name, re] of named) it(name, () => expect(route).toMatch(re));

  it('no bare live write is left in those blocks', () => {
    expect(route).not.toMatch(/await actuator\.writeFile\(workspaceId, cfg\.path, cfg\.content\);/);
    expect(route).not.toMatch(/await actuator\.writeFile\(workspaceId, htmlKey, fixed\);/);
    expect(route).not.toMatch(/try \{ await actuator\.writeFile\(workspaceId, p, deduped\); \}/);
  });

  it('the import dedupe saves only after its live write landed', () => {
    const i = route.indexOf("runInPass('duplicate-import-dedupe'");
    const block = route.slice(i - 200, i + 900);
    expect(block).toMatch(/if \(!\(await writeUnlessFrozen\(/);
    expect(block.indexOf('writeUnlessFrozen')).toBeLessThan(block.indexOf('writtenFiles.set(p, deduped)'));
    expect(block.indexOf('writeUnlessFrozen')).toBeLessThan(block.indexOf('saveWorkspaceFiles(workspaceId, { [p]: deduped })'));
  });
});
