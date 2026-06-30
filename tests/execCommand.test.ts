import { describe, it, expect } from 'vitest';
import { wrapBoundedCommand, capOutput, isRunnableCommand, EXEC_OUTPUT_CAP } from '../src/server/AgentV3/execCommand';

/** Real terminal bounding: hard timeout wrap, safe quoting, output cap, runnable check. */

describe('wrapBoundedCommand', () => {
  it('wraps in timeout + bash -lc with the default timeout', () => {
    expect(wrapBoundedCommand('ls -la')).toBe("timeout 30 bash -lc 'ls -la'");
  });
  it('respects a custom timeout (floored, min 1)', () => {
    expect(wrapBoundedCommand('ls', 10)).toBe("timeout 10 bash -lc 'ls'");
    expect(wrapBoundedCommand('ls', 0)).toBe("timeout 1 bash -lc 'ls'");
  });
  it('escapes single quotes so quotes/operators cannot break out', () => {
    // echo 'hi' → the inner quotes are POSIX-escaped as '\'' so the whole thing stays one argument.
    expect(wrapBoundedCommand("echo 'hi'")).toBe("timeout 30 bash -lc 'echo '\\''hi'\\'''");
  });
  it('keeps pipes and && intact inside the quoted arg', () => {
    expect(wrapBoundedCommand('cat a.txt | wc -l && echo done')).toBe("timeout 30 bash -lc 'cat a.txt | wc -l && echo done'");
  });
});

describe('capOutput', () => {
  it('passes short output through unchanged', () => {
    expect(capOutput('hello')).toBe('hello');
    expect(capOutput(undefined)).toBe('');
  });
  it('truncates output longer than the cap', () => {
    const big = 'x'.repeat(EXEC_OUTPUT_CAP + 50);
    const out = capOutput(big);
    expect(out.length).toBeLessThan(big.length);
    expect(out.endsWith('…(output truncated)')).toBe(true);
  });
});

describe('isRunnableCommand', () => {
  it('accepts a real command, rejects empty/whitespace/oversize/non-string', () => {
    expect(isRunnableCommand('ls')).toBe(true);
    expect(isRunnableCommand('')).toBe(false);
    expect(isRunnableCommand('   ')).toBe(false);
    expect(isRunnableCommand(123 as any)).toBe(false);
    expect(isRunnableCommand('x'.repeat(5000))).toBe(false);
  });
});
