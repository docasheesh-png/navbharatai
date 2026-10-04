import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installedExportsCommand, parseInstalledExports } from './installedExports';

const decoded = (cmd: string): string => Buffer.from(/echo ([A-Za-z0-9+/=]+) \| base64 -d/.exec(cmd)![1], 'base64').toString('utf8');

describe('installedExportsCommand (Q-115)', () => {
  it('carries only identifiers into the script — nothing from a file can reach the shell', () => {
    const script = decoded(installedExportsCommand(['Clock', 'bad name;rm -rf /', '$(id)', 'default', 'IndianRupee']));
    expect(script).toContain('["Clock","IndianRupee"]');
    expect(script).not.toContain('rm -rf');
    expect(script).not.toContain('$(id)');
    expect(script).not.toMatch(/"default"/);
  });

  it('asks the real installed package and reads only true named exports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-ie-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'lucide-react': '*' } }));
      symlinkSync(resolve(process.cwd(), 'node_modules'), join(dir, 'node_modules'));
      const out = execSync(installedExportsCommand(['Clock', 'IndianRupee', 'NotAnIcon']), { cwd: dir, shell: '/bin/bash' }).toString();
      expect(parseInstalledExports(out)).toEqual({ 'lucide-react': ['Clock', 'IndianRupee'] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('parseInstalledExports', () => {
  it('reads the marked line and nothing else', () => {
    expect(parseInstalledExports('noise\nNBAI_INSTALLED_EXPORTS {"lucide-react":["Clock"]}\n')).toEqual({ 'lucide-react': ['Clock'] });
  });

  it('an unreadable or hostile answer is an empty answer, never a guess', () => {
    expect(parseInstalledExports('')).toEqual({});
    expect(parseInstalledExports('NBAI_INSTALLED_EXPORTS not json')).toEqual({});
    expect(parseInstalledExports('NBAI_INSTALLED_EXPORTS ["Clock"]')).toEqual({});
    expect(parseInstalledExports('NBAI_INSTALLED_EXPORTS {"../evil":["Clock"],"ok":["a b", 3, "Fine"]}')).toEqual({ ok: ['Fine'] });
  });
});
