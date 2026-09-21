// A REPORT THAT LEAVES THE ADMIN PANEL MUST STILL BE READABLE WHEN IT ARRIVES.
//
// ADMIN 2026-09-21: *"un sab reports par direct copy/download option dedo, jisse woh report apko di
// jaye to aur aap performance sudhar sako!"* — so the test of this feature is not "a button exists",
// it is "what lands in the chat can be acted on". Three things decide that: the envelope names the
// report, an EMPTY card refuses rather than wiping the clipboard, and the Download control is absent
// where a download cannot happen.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  downloadWorksHere, exportStatusText, reportEnvelope, reportExportText, reportFilename, reportSlug,
} from '../src/lib/reportExport';

const NOW = Date.parse('2026-09-21T09:30:00.000Z');

describe('the envelope carries what an autopsy asks for first', () => {
  it('names the report, the time, the window and the source', () => {
    const env = reportEnvelope({
      label: 'Build costs', data: { rows: [1, 2] }, tab: 'Revenue',
      window: 'last 30 days', source: '/api/admin/build-costs', now: NOW,
    });
    expect(env.report).toBe('Build costs');
    expect(env.takenAt).toBe('2026-09-21T09:30:00.000Z');
    expect(env.tab).toBe('Revenue');
    expect(env.window).toBe('last 30 days');
    expect(env.source).toBe('/api/admin/build-costs');
    expect(env.data).toEqual({ rows: [1, 2] });
  });

  it('leaves optional keys OUT rather than writing them as undefined', () => {
    const env = reportEnvelope({ label: 'X', data: 1, now: NOW });
    expect('tab' in env).toBe(false);
    expect('window' in env).toBe(false);
    expect('source' in env).toBe(false);
  });

  it('an unnamed card still gets a name — a report with no title is unusable', () => {
    expect(reportEnvelope({ label: '', data: 1, now: NOW }).report).toBe('Admin report');
  });

  it('the data is the card\'s own payload, unmodified', () => {
    const data = { nested: { deep: [{ a: 1 }] }, n: null, zero: 0 };
    const parsed = JSON.parse(reportExportText({ label: 'X', data, now: NOW }));
    expect(parsed.data).toEqual(data);
  });
});

describe('an empty card REFUSES — it never hands over a document that reads as measured zero', () => {
  it('null data yields no text at all', () => {
    expect(reportExportText({ label: 'X', data: null, now: NOW })).toBe('');
  });

  it('undefined data (the card has not loaded) yields no text', () => {
    expect(reportExportText({ label: 'X', data: undefined, now: NOW })).toBe('');
  });

  it('an empty array yields no text — "no rows yet" is not a report', () => {
    expect(reportExportText({ label: 'X', data: [], now: NOW })).toBe('');
  });

  it('a cyclic payload yields no text rather than a half-written document', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(reportExportText({ label: 'X', data: cyclic, now: NOW })).toBe('');
  });

  it('but a REAL zero is exported — 0 and "no data" are different facts', () => {
    const text = reportExportText({ label: 'X', data: { failures: 0 }, now: NOW });
    expect(text).not.toBe('');
    expect(JSON.parse(text).data).toEqual({ failures: 0 });
  });

  it('and an empty OBJECT is exported — a card that really returned {} said something', () => {
    expect(reportExportText({ label: 'X', data: {}, now: NOW })).not.toBe('');
  });
});

describe('the filename names the card and sorts by day', () => {
  it('slugs the heading and stamps the date', () => {
    expect(reportFilename('Where does a sandbox\'s billed time go?', NOW))
      .toBe('nbai-where-does-a-sandbox-s-billed-time-go-2026-09-21.json');
  });

  it('a heading of pure punctuation still produces a usable name', () => {
    expect(reportFilename('!!! ???', NOW)).toBe('nbai-report-2026-09-21.json');
  });

  it('a very long heading is bounded', () => {
    expect(reportSlug('a'.repeat(200)).length).toBeLessThanOrEqual(48);
  });
});

describe('🔴 DOWNLOAD IS HIDDEN WHERE A DOWNLOAD CANNOT HAPPEN', () => {
  it('the web can download', () => {
    expect(downloadWorksHere(false)).toBe(true);
  });

  it('the native app cannot — Capacitor\'s WebView has no download handler', () => {
    expect(downloadWorksHere(true)).toBe(false);
  });

  it('the Android shell really registers no DownloadListener — the premise, not an assumption', () => {
    const main = readFileSync(
      resolve(__dirname, '../android/app/src/main/java/com/navbharatai/app/MainActivity.java'),
      'utf8',
    );
    expect(main).not.toMatch(/DownloadListener/i);
  });
});

describe('the confirmation tells the truth about what happened', () => {
  it('a successful copy names the report and says where it goes', () => {
    expect(exportStatusText('Build costs', true, 'copy'))
      .toBe('Build costs copied as JSON — paste it in the chat.');
  });

  it('a blocked copy says nothing was copied — never a fake success', () => {
    expect(exportStatusText('Build costs', false, 'copy')).toMatch(/nothing was copied/);
  });

  it('a failed download says nothing was saved', () => {
    expect(exportStatusText('Build costs', false, 'download')).toMatch(/nothing was saved/);
  });
});

describe('🔒 REVERSION GUARDS — these hold the reasoning, not just the behaviour', () => {
  const buttons = readFileSync(
    resolve(__dirname, '../src/components/admin/ReportExportButtons.tsx'), 'utf8',
  );

  it('the Download control is gated on downloadWorksHere, not rendered unconditionally', () => {
    expect(buttons).toMatch(/downloadWorksHere\(isNative\)\s*\?/);
  });

  it('the controls carry data-nb-no-copy so a page copy does not echo them back', () => {
    expect(buttons).toMatch(/data-nb-no-copy/);
  });

  it('an empty payload short-circuits BOTH controls before any clipboard or blob call', () => {
    // Both handlers must refuse on falsy text. Two guards, one per action.
    const guards = buttons.match(/if \(!text\)/g) ?? [];
    expect(guards.length).toBe(2);
  });
});
