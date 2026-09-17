/**
 * ADMIN 2026-09-17: *"jab build report copy ki jaye to json formate me hi copy ho. abhi text me copy
 * ho rahi hai."*
 *
 * The floating admin Copy button copies the page as TEXT, which is correct for an ordinary screen and
 * wrong for a build report — a 153-issue JSON document rendered as a DOM outline is flattened,
 * truncated and unparseable. These pin the choice, and the two properties that make it safe.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { chooseAdminCopyPayload, copyStatusText } from '../src/lib/adminCopyPayload';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const REPORT = { label: '2nd part', json: '{"buildId":"cc8c9075"}' };

describe('a build report copies as JSON, not as page text', () => {
  it('an open build report wins over the page', () => {
    expect(chooseAdminCopyPayload({ buildReport: REPORT })).toEqual(REPORT);
    expect(copyStatusText(REPORT, 240)).toMatch(/copied as JSON/);
  });

  it('the APK modal wins when it is the overlay on top', () => {
    const apk = { label: 'APK build report', json: '{"run":1}' };
    expect(chooseAdminCopyPayload({ apkReport: apk, buildReport: REPORT })).toEqual(apk);
  });

  it('🔒 NO REPORT OPEN ⇒ THE PAGE-TEXT COPY IS BYTE-IDENTICAL TO BEFORE', () => {
    for (const c of [{}, { buildReport: null }, { apkReport: null, buildReport: null }]) {
      expect(chooseAdminCopyPayload(c)).toBeNull();
    }
    expect(copyStatusText(null, 240)).toBe('Page copied (240 lines) — paste it in the chat');
  });

  it('🔒 AN EMPTY PAYLOAD FALLS BACK TO THE PAGE — it never copies nothing', () => {
    // copyTextToClipboard refuses empty text, so an empty candidate would leave the admin's old
    // clipboard in place while the button said "copied". A page copy is strictly better than that.
    for (const json of ['', '   ']) {
      expect(chooseAdminCopyPayload({ buildReport: { label: 'x', json } })).toBeNull();
    }
    expect(chooseAdminCopyPayload({ buildReport: { label: '', json: '{}' } })?.label).toBe('Report');
  });
});

describe('the wiring — a choice nothing reaches is no fix at all', () => {
  it('the button asks this module before reading the page', () => {
    const src = read('src/components/admin/AdminCopyButton.tsx');
    const at = src.indexOf('chooseAdminCopyPayload(jsonPayload');
    expect(at, 'the button must consult the payload chooser').toBeGreaterThan(0);
    // Before the page read: a report must never be flattened into an outline on the way.
    expect(at).toBeLessThan(src.indexOf('outlinePage(document.body)'));
  });

  it('the dashboard registers BOTH open reports, keyed off the modals’ own state', () => {
    const src = read('src/components/AdminDashboard.tsx');
    expect(src).toMatch(/jsonPayload=\{copyJsonPayload\}/);
    // The SAME strings the panels' own Copy buttons use — a second, separately-built payload is how
    // the floating copy and the panel copy come to disagree about what the report says.
    expect(src).toMatch(/buildReport: selectedReport && selectedPartJson/);
    expect(src).toMatch(/apkReport: openApkReport && !openApkReport\.loading && !openApkReport\.error/);
  });
});
