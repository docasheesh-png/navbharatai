import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  reportKey,
  reportSendCount,
  bumpReportSendCount,
  reportButtonLabel,
  reportAlreadySentHint,
} from './reportSendCount';

/** In-memory Storage stub — the suite runs in the node environment (vitest.config.ts). */
function makeStorage(): Storage {
  let data: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = String(v); },
    removeItem: (k: string) => { delete data[k]; },
    clear: () => { data = {}; },
    key: (i: number) => Object.keys(data)[i] ?? null,
    get length() { return Object.keys(data).length; },
  } as Storage;
}

// Admin 2026-08-04: "report (1), report (2) aise — jisse duplicate report na ho". The old button
// flashed "Report sent" for 4 seconds and then looked untouched, so the same build got reported
// several times. These tests lock the visible truth: the count is per build, only a real send
// increments it, and it survives a reload (localStorage).
beforeEach(() => { vi.stubGlobal('localStorage', makeStorage()); });

describe('reportKey — identity of "this build\'s report"', () => {
  it('combines workspace and build so a NEW build starts a fresh count', () => {
    expect(reportKey('ws-1', 'b-1')).not.toBe(reportKey('ws-1', 'b-2'));
    expect(reportKey('ws-1', 'b-1')).toBe(reportKey('ws-1', 'b-1'));
  });

  it('is empty when there is nothing to report yet (no workspace, no build)', () => {
    expect(reportKey(null, null)).toBe('');
    expect(reportKey('', undefined)).toBe('');
  });

  it('a workspace with no build id yet is still a usable key', () => {
    expect(reportKey('ws-1', null)).not.toBe('');
  });
});

describe('the count itself', () => {
  it('starts at zero and increments only when told', () => {
    const k = reportKey('ws-1', 'b-1');
    expect(reportSendCount(k)).toBe(0);
    expect(bumpReportSendCount(k)).toBe(1);
    expect(bumpReportSendCount(k)).toBe(2);
    expect(reportSendCount(k)).toBe(2);
  });

  it('persists across a reload — the exact moment a user re-sends out of doubt', () => {
    const k = reportKey('ws-1', 'b-1');
    bumpReportSendCount(k);
    // A fresh module read (same localStorage) still sees it — no in-memory state involved.
    expect(reportSendCount(k)).toBe(1);
  });

  it('counts are independent per build', () => {
    bumpReportSendCount(reportKey('ws-1', 'b-1'));
    bumpReportSendCount(reportKey('ws-1', 'b-1'));
    expect(reportSendCount(reportKey('ws-1', 'b-2'))).toBe(0);
  });

  it('an empty key is a no-op — a build with nothing to report never records a send', () => {
    expect(bumpReportSendCount('')).toBe(0);
    expect(reportSendCount('')).toBe(0);
  });

  it('corrupt storage never throws and reads as zero', () => {
    localStorage.setItem('nbv3:report-send-counts', '{not json');
    expect(reportSendCount(reportKey('ws-1', 'b-1'))).toBe(0);
    expect(bumpReportSendCount(reportKey('ws-1', 'b-1'))).toBe(1);
  });

  it('bounded: tracking many builds never grows without limit', () => {
    for (let i = 0; i < 60; i++) bumpReportSendCount(reportKey('ws', `b-${i}`));
    const stored = JSON.parse(localStorage.getItem('nbv3:report-send-counts') || '{}');
    expect(Object.keys(stored).length).toBeLessThanOrEqual(40);
    // The most recent builds are the ones kept.
    expect(reportSendCount(reportKey('ws', 'b-59'))).toBe(1);
  });
});

describe('reportButtonLabel — what the user actually reads', () => {
  it('never sent: the plain label (no misleading zero)', () => {
    expect(reportButtonLabel({ sending: false, justSent: false, count: 0 })).toBe('Report');
  });

  it('sent before: the count is visible so a second send is a choice, not a guess', () => {
    expect(reportButtonLabel({ sending: false, justSent: false, count: 1 })).toBe('Report (1)');
    expect(reportButtonLabel({ sending: false, justSent: false, count: 3 })).toBe('Report (3)');
  });

  it('sending wins over everything — the in-flight state is never hidden by a count', () => {
    expect(reportButtonLabel({ sending: true, justSent: false, count: 2 })).toBe('Sending…');
    expect(reportButtonLabel({ sending: true, justSent: true, count: 2 })).toBe('Sending…');
  });

  it('just sent: acknowledges, and shows the tally when it was not the first time', () => {
    expect(reportButtonLabel({ sending: false, justSent: true, count: 1 })).toBe('Report sent');
    expect(reportButtonLabel({ sending: false, justSent: true, count: 2 })).toBe('Report sent (2)');
  });
});

describe('reportAlreadySentHint — says outright that re-sending adds nothing', () => {
  it('is silent when nothing has been sent', () => {
    expect(reportAlreadySentHint(0)).toBe('');
  });

  it('singular and plural read naturally', () => {
    expect(reportAlreadySentHint(1)).toContain('once');
    expect(reportAlreadySentHint(3)).toContain('3 times');
    expect(reportAlreadySentHint(2)).toContain('no need to send it again');
  });
});
