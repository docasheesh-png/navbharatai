import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { grepCommand, readGrepOutput } from '../src/server/AgentV3/grepTool';
import { makeTempDir } from './helpers/tempDir';

describe('cdffbb71: an empty optional grep path searches the project root', () => {
  const dir = makeTempDir('colour-game-grep-');
  mkdirSync(join(dir, 'wallet folder'));
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'wallet folder/input.ts'), 'wallet.balance\nuseState(1)\n');
  writeFileSync(join(dir, 'node_modules/noise.ts'), 'wallet.noise\n');
  const search = (pattern: string, path: string) => readGrepOutput(
    execFileSync('/bin/sh', ['-c', grepCommand(pattern, path, ['node_modules'])], { cwd: dir, encoding: 'utf8' }), pattern,
  );

  it.each(['', ' ', '\t\n', '.'])('searches root for %j, with generated directories excluded', (path) => {
    const result = search('wallet', path);
    expect(result.failed).toBe(false);
    expect(result.text).toContain('wallet.balance');
    expect(result.text).not.toContain('wallet.noise');
  });

  it('preserves spaces in an explicit real path', () => {
    expect(search('wallet', 'wallet folder/input.ts').text).toContain('wallet.balance');
  });

  it('preserves true misses, literal fallback and genuine filesystem errors as distinct states', () => {
    expect(search('absent', '').text).toBe('(no matches)');
    expect(search('useState(', '').text).toContain('useState(1)');
    const failed = search('wallet', 'does-not-exist');
    expect(failed.failed).toBe(true);
    expect(failed.text).toContain('NOT a "no matches" answer');
  });
});
