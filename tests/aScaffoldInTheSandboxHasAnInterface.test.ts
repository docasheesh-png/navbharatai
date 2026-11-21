/**
 * failedbr #669 (queue Q-3221): a build that wrote no files was told "this project has no user interface" about a
 * React scaffold. The e2e decision read the durable store, which never holds a scaffold the build did not touch; the
 * integrity pass had already read the sandbox's index.html and src/main.tsx, and now feeds the same decision.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasUserInterface } from '../src/server/AgentV3/e2eAutoScaffold';

describe('the sandbox scaffold counts as the app\'s interface', () => {
  it('the integrity map\'s entry files are an interface; a store with only config is not', () => {
    expect(hasUserInterface({ 'package.json': '{}' })).toBe(false);
    expect(hasUserInterface({ 'package.json': '{}', 'index.html': '<div id="root"></div>', 'src/main.tsx': '' })).toBe(true);
  });
  it('wired: the e2e decision reads the whole project map, sandbox entry files included', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('const e2eFiles = { ...projectFiles, ...wholeProjectFiles, ...Object.fromEntries(writtenFiles) };');
  });
});
