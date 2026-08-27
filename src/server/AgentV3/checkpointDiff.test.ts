import { describe, it, expect } from 'vitest';
import {
  parseNumstatLine, parseNumstat, diffSummaryMessage, runCheckpointDiff,
  diffNumstatCommand, shaPairExistsCommand, DIFF_FILES_MAX,
} from './checkpointDiff';

describe('parseNumstat', () => {
  it('parses ordinary, binary and malformed lines', () => {
    const rows = parseNumstat('12\t3\tsrc/App.tsx\n-\t-\tlogo.png\nnot a numstat line\n');
    expect(rows).toEqual([
      { path: 'src/App.tsx', added: 12, removed: 3 },
      { path: 'logo.png', added: null, removed: null },
    ]);
  });

  it('reads both rename forms git emits with -M', () => {
    expect(parseNumstatLine('5\t5\tsrc/{Header.tsx => TopBar.tsx}')).toEqual({
      path: 'src/TopBar.tsx', added: 5, removed: 5, renamedFrom: 'src/Header.tsx',
    });
    expect(parseNumstatLine('0\t0\told.ts => new.ts')).toEqual({
      path: 'new.ts', added: 0, removed: 0, renamedFrom: 'old.ts',
    });
  });
});

describe('diffSummaryMessage', () => {
  it('identical versions say so in plain words', () => {
    expect(diffSummaryMessage([], false)).toContain('identical');
  });
  it('totals + binary count + truncation are all stated', () => {
    const msg = diffSummaryMessage([
      { path: 'a.ts', added: 10, removed: 2 },
      { path: 'b.png', added: null, removed: null },
    ], true);
    expect(msg).toContain('2+ files changed');
    expect(msg).toContain('10 lines added');
    expect(msg).toContain('1 binary file');
    expect(msg).toContain(String(DIFF_FILES_MAX));
  });
});

describe('runCheckpointDiff — every branch honest', () => {
  const SHA_A = 'a'.repeat(10);
  const SHA_B = 'b'.repeat(10);
  const warm = async () => true;

  it('refuses an invalid sha before any command runs — nothing user-typed reaches a shell', async () => {
    let ran = 0;
    const r = await runCheckpointDiff('$(rm -rf /)', SHA_B, { run: async () => { ran += 1; return { stdout: '' }; }, sandboxWarm: warm });
    expect(r.ok).toBe(false);
    expect(ran).toBe(0);
  });

  it('a cold sandbox is an honest "open the app first" — never a boot', async () => {
    const r = await runCheckpointDiff(SHA_A, SHA_B, { run: async () => ({ stdout: '' }), sandboxWarm: async () => false });
    expect(r.reason).toBe('sandbox-cold');
    expect(r.message).toContain('not running right now');
  });

  it('a missing commit says which situation it is, not a bare failure', async () => {
    const r = await runCheckpointDiff(SHA_A, SHA_B, { run: async () => ({ stdout: '' }), sandboxWarm: warm });
    expect(r.reason).toBe('version-not-in-sandbox');
  });

  it('the happy path returns files + totals + the summary', async () => {
    const r = await runCheckpointDiff(SHA_A, SHA_B, {
      sandboxWarm: warm,
      run: async (cmd: string) => {
        if (cmd === shaPairExistsCommand(SHA_A, SHA_B)) return { stdout: 'HAVE_BOTH\n' };
        if (cmd === diffNumstatCommand(SHA_A, SHA_B)) return { stdout: '7\t1\tsrc/App.tsx\n' };
        throw new Error(`unexpected command: ${cmd}`);
      },
    });
    expect(r.ok).toBe(true);
    expect(r.files).toEqual([{ path: 'src/App.tsx', added: 7, removed: 1 }]);
    expect(r.added).toBe(7);
    expect(r.message).toContain('1 file changed');
  });

  it('caps a huge diff and says so', async () => {
    const lines = Array.from({ length: DIFF_FILES_MAX + 20 }, (_, i) => `1\t0\tf${i}.ts`).join('\n');
    const r = await runCheckpointDiff(SHA_A, SHA_B, {
      sandboxWarm: warm,
      run: async (cmd: string) => ({ stdout: cmd.includes('cat-file') ? 'HAVE_BOTH' : lines }),
    });
    expect(r.truncated).toBe(true);
    expect(r.files.length).toBe(DIFF_FILES_MAX);
    expect(r.message).toContain('+');
  });
});
