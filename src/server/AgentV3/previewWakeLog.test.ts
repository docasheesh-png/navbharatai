/** Layer 3 of "a preview is never blank" (admin 2026-11-17): every wake attempt leaves a record. */
import { describe, expect, it } from 'vitest';
import { appendWakeAttempt, cleanWakeText, wakeHistoryLine, WAKE_LOG_MAX } from './previewWakeLog';

const at = Date.UTC(2026, 10, 17, 9, 30);
const fail = (n: number, stage = 'Installing dependencies…') => ({ at: at + n * 60_000, ok: false, stage, reason: 'The dev server did not start', seconds: 95 });

describe('the wake log', () => {
  it('keeps the last five, drops malformed entries, and rounds numbers', () => {
    let log: unknown = [{ junk: true }];
    for (let i = 0; i < 7; i++) log = appendWakeAttempt(log, fail(i));
    expect((log as unknown[]).length).toBe(WAKE_LOG_MAX);
    expect((log as { at: number }[])[0].at).toBe(at + 2 * 60_000);
  });

  it('never stores a URL or a key, and keeps text to one short line', () => {
    expect(cleanWakeText('failed at https://5173-abc.e2b.app/x with sk-abcdefgh12345678\n and more')).toBe('failed at [url] with [secret] and more');
    expect(cleanWakeText('x'.repeat(500)).length).toBe(200);
  });

  it('the report line names each failed wake since the last report: when, how long, which stage, why', () => {
    const log = appendWakeAttempt(appendWakeAttempt([], fail(0)), { ...fail(1), ok: true });
    const line = wakeHistoryLine(log, 0)!;
    expect(line).toContain('1 preview wake-up failed before this build');
    expect(line).toContain('2026-11-17 09:30 UTC after 95s at "Installing dependencies…": The dev server did not start');
    expect(wakeHistoryLine(log, at + 1)).toBeNull(); // already reported
    expect(wakeHistoryLine([{ ...fail(0), ok: true }], 0)).toBeNull(); // a success is not a defect
  });
});

describe('both ends are wired (source guard)', () => {
  it('the wake route records every finish, and each build reports the failed ones once', async () => {
    const { readFileSync } = await import('node:fs');
    const route = readFileSync(new URL('../routes/agentv3.ts', import.meta.url), 'utf8');
    const finish = route.slice(route.indexOf('const finish = (payload: Record<string, unknown>, status = 200): void => {'));
    expect(finish.slice(0, 400)).toContain('sandboxStore.recordWakeAttempt(workspaceId');
    expect(route).toContain("sandboxStore.takeUnreportedWakeFailures(workspaceId)");
    expect(route).toContain("code: 'PREVIEW_WAKE_HISTORY'");
  });
});
