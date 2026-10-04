/**
 * QUEUE Q-145: A TOOL NAME THE MODEL MADE UP IS RUN AS THE TOOL IT MEANT.
 *
 * Cheap models called `execute` with a `command`, or `write` with a `path` and `content`. The dispatcher
 * answered `Unknown tool`, and the model spent a turn (sometimes the rest of the build) learning the name.
 * The class: a call whose INTENT is unambiguous, refused for its spelling. `toolAlias.ts` renames only
 * when the name is in a fixed table, the input already has the real tool's required fields, and the real
 * tool is one this agent was offered.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveToolAlias, toolAliasNote } from '../src/server/AgentV3/toolAlias';

const ALL = new Set(['bash', 'write_file', 'read_file', 'edit_file']);

describe('resolveToolAlias', () => {
  it('runs `execute` with a command as bash, and `write` with path + content as write_file', () => {
    expect(resolveToolAlias('execute', { command: 'npm run build' }, ALL)).toBe('bash');
    expect(resolveToolAlias('run_command', { command: 'ls' }, ALL)).toBe('bash');
    expect(resolveToolAlias('write', { path: 'src/a.ts', content: 'x' }, ALL)).toBe('write_file');
    expect(resolveToolAlias('open_file', { path: 'src/a.ts' }, ALL)).toBe('read_file');
  });

  it('never renames when the input lacks the real tool\'s required fields', () => {
    expect(resolveToolAlias('execute', { cmd: 'ls' }, ALL)).toBeNull();
    expect(resolveToolAlias('execute', { command: '' }, ALL)).toBeNull();
    expect(resolveToolAlias('write', { path: 'a.ts' }, ALL)).toBeNull();
    expect(resolveToolAlias('write', { path: 'a.ts', content: 42 }, ALL)).toBeNull();
    expect(resolveToolAlias('execute', null, ALL)).toBeNull();
    expect(resolveToolAlias('execute', 'ls', ALL)).toBeNull();
  });

  it('never gives an agent a tool it was not offered (a reviewer gets no shell)', () => {
    const reviewer = new Set(['read_file', 'grep']);
    expect(resolveToolAlias('execute', { command: 'rm -rf src' }, reviewer)).toBeNull();
    expect(resolveToolAlias('write', { path: 'a.ts', content: 'x' }, reviewer)).toBeNull();
    expect(resolveToolAlias('open_file', { path: 'a.ts' }, reviewer)).toBe('read_file');
  });

  it('never renames a name the agent WAS offered, and never guesses an unlisted name', () => {
    expect(resolveToolAlias('execute', { command: 'ls' }, new Set(['execute', 'bash']))).toBeNull();
    expect(resolveToolAlias('exec_sql', { command: 'select 1' }, ALL)).toBeNull();
    expect(resolveToolAlias('bash', { command: 'ls' }, ALL)).toBeNull();
    expect(resolveToolAlias('', { command: 'ls' }, ALL)).toBeNull();
  });

  it('tells the model the right name in the same result', () => {
    expect(toolAliasNote('execute', 'bash')).toContain('Call "bash" directly next time');
  });
});

describe('the wiring — proven by reversion', () => {
  const runner = readFileSync(join(__dirname, '..', 'src/server/AgentV3/AgentRunner.ts'), 'utf8');

  it('the runner resolves an alias against the tools THIS agent was offered, before dispatch', () => {
    expect(runner).toContain('const offeredToolNames = new Set(tools.map((t) => t.name));');
    expect(runner).toContain('resolveToolAlias(tu.name, tu.input, offeredToolNames)');
    const alias = runner.indexOf('resolveToolAlias(tu.name');
    const dispatch = runner.indexOf("if (toolTimeoutMs <= 0 || tu.name === 'task') return dispatcher.dispatch(tu, agentRole);");
    expect(alias).toBeGreaterThan(0);
    expect(alias).toBeLessThan(dispatch);
  });

  it('the banned-probe guard still runs first, so an alias cannot launder a banned call', () => {
    expect(runner.indexOf('isProbeBanned(repeatProbe, tu.name, tu.input)')).toBeLessThan(runner.indexOf('resolveToolAlias(tu.name'));
  });
});
