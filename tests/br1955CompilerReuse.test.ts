import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { sharedBareTypecheckCommand } from '../src/server/AgentV3/tscCommand';
import { makeTempDir } from './helpers/tempDir';

describe('BR1955 F6: manual noEmit probes reuse compiler-owned data without skipping verification', () => {
  it.each(['./node_modules/.bin/tsc --noEmit', 'node_modules/.bin/tsc --noEmit', 'npx tsc --noEmit'])(
    'uses the same per-dispatcher build-info path for %s', (command) => {
      const effective = sharedBareTypecheckCommand(command, 'abc-123');
      expect(effective).toBe(command + ' --incremental --tsBuildInfoFile /tmp/agentv3-abc-123.tsbuildinfo');
    });
  it.each(['tsc --noEmit', 'npx tsc@latest --noEmit', 'npx tsc --noEmit -p other/tsconfig.json', './node_modules/.bin/tsc --noEmit --watch', 'cd server && npx tsc --noEmit', 'npx tsc --noEmit; echo ok', 'npx tsc --noEmit --incremental false'])(
    'does not reinterpret a different compiler/scope/mode/shell command: %s', (command) => expect(sharedBareTypecheckCommand(command, 'abc')).toBe(command));
  it('does not interpolate untrusted cache identifiers', () => expect(sharedBareTypecheckCommand('npx tsc --noEmit', 'x;touch /tmp/no')).toBe('npx tsc --noEmit'));
  it('real compiler: clean cache exists, an edit still fails with TS2322, and a real correction passes', () => {
    const dir = makeTempDir('br1955-compiler-');
    const id = 'br1955-' + randomUUID();
    const cache = `/tmp/agentv3-${id}.tsbuildinfo`;
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true, strict: true, skipLibCheck: true, types: [], lib: ['ES2020'] }, files: ['app.ts'] }));
    const command = sharedBareTypecheckCommand('./node_modules/.bin/tsc --noEmit', id);
    try {
      writeFileSync(join(dir, 'app.ts'), 'const speed: number = 1;');
      execFileSync('bash', ['-c', command], { cwd: dir, encoding: 'utf8' });
      expect(existsSync(cache)).toBe(true);
      writeFileSync(join(dir, 'app.ts'), "const speed: number = 'stalled';");
      const failed = spawnSync('bash', ['-c', command], { cwd: dir, encoding: 'utf8' });
      expect(failed.status).not.toBe(0); expect(failed.stdout).toContain('TS2322');
      writeFileSync(join(dir, 'app.ts'), 'const speed: number = 2;');
      expect(() => execFileSync('bash', ['-c', command], { cwd: dir, encoding: 'utf8' })).not.toThrow();
    } finally { rmSync(cache, { force: true }); }
  });
  it('the real shell tool, not just a test helper, normalizes the bare command using its write-time cache identity', () => {
    const source = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(source).toContain('const command = sharedBareTypecheckCommand(cdFix.command, this.tsBuildInfoId);');
    expect(source).toContain('writeTypecheckCommand(this.tsBuildInfoId)');
  });
});
