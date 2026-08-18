import { describe, it, expect } from 'vitest';
import {
  buildRuntimeLogCommand,
  parseRuntimeLogOutput,
  runtimeLogGapNotice,
  RUNTIME_LOG_MAX_BYTES,
} from './runtimeLogs';

/** Build the exact stdout the sandbox command produces, so the parser is tested against reality. */
function stdoutFor(size: number, data: string): string {
  return `NBAI_LOGSIZE:${size}\nNBAI_LOGDATA:\n${data}`;
}

describe('buildRuntimeLogCommand', () => {
  it('uses a 1-BASED byte offset — tail -c +N counts from 1, so offset 0 must ask for +1', () => {
    expect(buildRuntimeLogCommand(0)).toContain('o=0');
    expect(buildRuntimeLogCommand(0)).toContain('tail -c +$((o+1))');
  });

  // Without this, a log that was truncated or replaced makes `tail -c +N` return nothing FOREVER — and
  // an app that restarted would look like an app that stopped logging.
  it('resets the offset in-shell when the file shrank (a restarted server truncates its log)', () => {
    expect(buildRuntimeLogCommand(900)).toContain('if [ "$o" -gt "$s" ]; then o=0; fi');
  });

  it('caps the window so the sandbox\'s 64 KB stdout limit can never truncate the response', () => {
    expect(RUNTIME_LOG_MAX_BYTES).toBeLessThan(64_000);
    expect(buildRuntimeLogCommand(0)).toContain(`tail -c ${RUNTIME_LOG_MAX_BYTES}`);
  });

  it('refuses a nonsense offset instead of passing it to the shell', () => {
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildRuntimeLogCommand(bad), String(bad)).toContain('o=0');
    }
    expect(buildRuntimeLogCommand(12.7)).toContain('o=12'); // floored, never a fractional byte
  });

  it('emits the size BEFORE the data, so log content can never be read as a marker', () => {
    const cmd = buildRuntimeLogCommand(0);
    expect(cmd.indexOf('NBAI_LOGSIZE')).toBeLessThan(cmd.indexOf('NBAI_LOGDATA'));
  });
});

describe('parseRuntimeLogOutput', () => {
  it('returns the log text and the next offset', () => {
    const w = parseRuntimeLogOutput(stdoutFor(42, 'listening on 5173\n'), 0);
    expect(w.hasLog).toBe(true);
    expect(w.text).toBe('listening on 5173\n');
    expect(w.nextOffset).toBe(42);
    expect(w.restarted).toBe(false);
    expect(w.skipped).toBe(false);
  });

  it('a missing log file is "nothing has run yet", NOT an error', () => {
    const w = parseRuntimeLogOutput('NBAI_LOGMISSING\n', 0);
    expect(w.hasLog).toBe(false);
    expect(w.text).toBe('');
  });

  it('an empty log reads as present-but-silent, not as missing', () => {
    const w = parseRuntimeLogOutput(stdoutFor(0, ''), 0);
    expect(w.hasLog).toBe(true);
    expect(w.text).toBe('');
    expect(w.nextOffset).toBe(0);
  });

  // A silent jump backwards would read as corrupted output. The user must be told the server restarted.
  it('flags a RESTART when the file is smaller than the offset we asked from', () => {
    const w = parseRuntimeLogOutput(stdoutFor(10, 'boot\n'), 5_000);
    expect(w.restarted).toBe(true);
    expect(w.nextOffset).toBe(10);
  });

  it('flags SKIPPED bytes when the app out-logged the poller (never hide a gap)', () => {
    const w = parseRuntimeLogOutput(stdoutFor(RUNTIME_LOG_MAX_BYTES + 5_000, 'tail end'), 0);
    expect(w.skipped).toBe(true);
  });

  it('does NOT flag a gap on the normal path — a clean pane must stay clean', () => {
    const w = parseRuntimeLogOutput(stdoutFor(300, 'more output\n'), 100);
    expect(w.restarted).toBe(false);
    expect(w.skipped).toBe(false);
  });

  it('keeps blank lines that are REAL output, dropping only the marker\'s own newline', () => {
    // i.e. the data comes back byte-for-byte: both leading newlines belong to the app's output, and
    // only the newline that terminates the NBAI_LOGDATA: marker line is consumed.
    const data = '\n\nreal blank lines above\n';
    expect(parseRuntimeLogOutput(stdoutFor(20, data), 0).text).toBe(data);
  });

  it('preserves log text that happens to contain the marker words (they are not re-parsed)', () => {
    const w = parseRuntimeLogOutput(stdoutFor(30, 'app printed NBAI_LOGDATA: haha\n'), 0);
    expect(w.text).toBe('app printed NBAI_LOGDATA: haha\n');
  });

  // Inventing a log line is worse than showing an empty pane — a user would debug a phantom.
  it('degrades to empty on garbage rather than fabricating content', () => {
    for (const junk of ['', 'sh: command not found', 'NBAI_LOGSIZE:abc\nNBAI_LOGDATA:\nx', 'NBAI_LOGDATA:\nx']) {
      expect(parseRuntimeLogOutput(junk, 0).hasLog, JSON.stringify(junk)).toBe(false);
    }
    expect(parseRuntimeLogOutput(null as unknown as string, 0).hasLog).toBe(false);
  });
});

describe('runtimeLogGapNotice — say something only when something was actually lost', () => {
  it('stays silent on a continuous window', () => {
    expect(runtimeLogGapNotice({ restarted: false, skipped: false })).toBe('');
  });

  it('explains a restart, and prefers that over the skip wording (a restart explains the jump)', () => {
    expect(runtimeLogGapNotice({ restarted: true, skipped: true })).toMatch(/restarted/i);
  });

  it('explains skipped lines in plain words', () => {
    expect(runtimeLogGapNotice({ restarted: false, skipped: true })).toMatch(/skipped/i);
  });
});
